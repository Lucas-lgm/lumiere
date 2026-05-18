/**
 * Headless mpv + OpenGL common infrastructure implementation
 *
 * Shared offscreen render code extracted from mpv_thumbnail.mm and mpv_anim_export.mm.
 * See mpv_headless.h for interface description.
 */

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>

extern "C" {
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
}

#include <cstdlib>
#include <cstring>
#include <dlfcn.h>

#include "mpv_headless.h"

// ── OpenGL proc address (mpv callback) ──
static void *headless_get_proc_address(void *ctx, const char *name) {
    (void)ctx;
    return dlsym(RTLD_DEFAULT, name);
}

// ── Utility functions ──

bool is_bluray_iso(const char *path) {
    if (!path) return false;
    size_t len = strlen(path);
    if (len < 4) return false;
    const char *ext = path + len - 4;
    return (strcasecmp(ext, ".iso") == 0);
}

int headless_mpv_loadfile(mpv_handle *mpv, const char *video_path) {
    if (is_bluray_iso(video_path)) {
        // After initialization, must use mpv_set_property_string (mpv_set_option_string is only before init)
        mpv_set_property_string(mpv, "bluray-device", video_path);
        const char *cmd[] = {"loadfile", "bd://", NULL};
        return mpv_command(mpv, cmd);
    }
    const char *cmd[] = {"loadfile", video_path, NULL};
    return mpv_command(mpv, cmd);
}

void flip_rows_rgba(uint8_t *pixels, int width, int height, int bytes_per_pixel) {
    int row_bytes = width * bytes_per_pixel;
    uint8_t *tmp = (uint8_t *)malloc(row_bytes);
    if (!tmp) return;
    for (int y = 0; y < height / 2; y++) {
        uint8_t *top = pixels + y * row_bytes;
        uint8_t *bot = pixels + (height - 1 - y) * row_bytes;
        memcpy(tmp, top, row_bytes);
        memcpy(top, bot, row_bytes);
        memcpy(bot, tmp, row_bytes);
    }
    free(tmp);
}

bool write_jpeg(const char *path, const uint8_t *pixels, int width, int height, float quality) {
    @autoreleasepool {
        CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
        if (!colorSpace) colorSpace = CGColorSpaceCreateDeviceRGB();
        if (!colorSpace) return false;

        CGBitmapInfo bitmapInfo = kCGImageAlphaNoneSkipLast | kCGBitmapByteOrder32Big;
        CGContextRef ctx = CGBitmapContextCreate(
            (void *)pixels, width, height, 8, width * 4,
            colorSpace, bitmapInfo
        );
        CGColorSpaceRelease(colorSpace);
        if (!ctx) return false;

        CGImageRef image = CGBitmapContextCreateImage(ctx);
        CGContextRelease(ctx);
        if (!image) return false;

        NSString *nsPath = [NSString stringWithUTF8String:path];
        NSURL *url = [NSURL fileURLWithPath:nsPath];
        CGImageDestinationRef dest = CGImageDestinationCreateWithURL(
            (__bridge CFURLRef)url,
            CFSTR("public.jpeg"), 1, NULL
        );
        if (!dest) {
            CGImageRelease(image);
            return false;
        }

        NSDictionary *opts = @{
            (__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @(quality)
        };
        CGImageDestinationAddImage(dest, image, (__bridge CFDictionaryRef)opts);
        bool ok = CGImageDestinationFinalize(dest);

        CFRelease(dest);
        CGImageRelease(image);
        return ok;
    }
}

// ── Core API ──

bool headless_create(HeadlessContext *ctx, bool request_hdr, const char *start_pos) {
    if (!ctx) return false;

    // ── 1. Create mpv instance and set options (before initialize) ──
    ctx->mpv = mpv_create();
    if (!ctx->mpv) return false;

    mpv_set_option_string(ctx->mpv, "vo", "libmpv");
    mpv_set_option_string(ctx->mpv, "ao", "null");
    mpv_set_option_string(ctx->mpv, "hwdec", "auto");
    mpv_set_option_string(ctx->mpv, "sid", "no");
    mpv_set_option_string(ctx->mpv, "aid", "no");
    mpv_set_option_string(ctx->mpv, "pause", "yes");

    // Scale quality (shared by SDR and HDR)
    mpv_set_option_string(ctx->mpv, "scale", "lanczos");
    mpv_set_option_string(ctx->mpv, "cscale", "lanczos");
    mpv_set_option_string(ctx->mpv, "dscale", "mitchell");
    mpv_set_option_string(ctx->mpv, "correct-downscaling", "yes");

    if (request_hdr) {
        // HDR passthrough: BT.2020 PQ, near lossless (same as player)
        mpv_set_option_string(ctx->mpv, "target-prim", "bt.2020");
        mpv_set_option_string(ctx->mpv, "target-trc", "pq");
        mpv_set_option_string(ctx->mpv, "target-colorspace-hint", "yes");
        mpv_set_option_string(ctx->mpv, "tone-mapping", "bt.2390");
        mpv_set_option_string(ctx->mpv, "hdr-compute-peak", "no");
        mpv_set_option_string(ctx->mpv, "dither-depth", "no");
    } else {
        // SDR: tone mapping to BT.709/sRGB
        mpv_set_option_string(ctx->mpv, "target-prim", "bt.709");
        mpv_set_option_string(ctx->mpv, "target-trc", "srgb");
        mpv_set_option_string(ctx->mpv, "target-peak", "auto");
        mpv_set_option_string(ctx->mpv, "target-colorspace-hint", "yes");
        mpv_set_option_string(ctx->mpv, "hdr-compute-peak", "auto");
        mpv_set_option_string(ctx->mpv, "tone-mapping", "bt.2390");
        mpv_set_option_string(ctx->mpv, "dither-depth", "8");
    }

    if (start_pos && start_pos[0] != '\0') {
        mpv_set_option_string(ctx->mpv, "start", start_pos);
    }

    if (mpv_initialize(ctx->mpv) < 0) {
        mpv_terminate_destroy(ctx->mpv);
        ctx->mpv = nullptr;
        return false;
    }

    // ── 2. Create CGL context ──
    CGLPixelFormatObj pix = nil;
    GLint npix = 0;
    bool got_hdr_ctx = false;

    if (request_hdr) {
        // HDR: float pixel format supports GL_RGBA16F
        CGLPixelFormatAttribute hdr_attrs[] = {
            kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
            kCGLPFAColorSize, (CGLPixelFormatAttribute)64,
            kCGLPFAColorFloat,
            kCGLPFADepthSize, (CGLPixelFormatAttribute)0,
            kCGLPFAAccelerated,
            kCGLPFAAllowOfflineRenderers,
            (CGLPixelFormatAttribute)0
        };
        CGLError err = CGLChoosePixelFormat(hdr_attrs, &pix, &npix);
        if (err == kCGLNoError && pix) {
            got_hdr_ctx = true;
        }
    }

    if (!pix) {
        // SDR (or float context failure fallback): ColorSize=32
        if (request_hdr) {
            // Fallback to SDR: reset mpv properties (already initialized, use set_property_string)
            mpv_set_property_string(ctx->mpv, "target-prim", "bt.709");
            mpv_set_property_string(ctx->mpv, "target-trc", "srgb");
            mpv_set_property_string(ctx->mpv, "target-peak", "auto");
            mpv_set_property_string(ctx->mpv, "hdr-compute-peak", "auto");
            mpv_set_property_string(ctx->mpv, "tone-mapping", "bt.2390");
            mpv_set_property_string(ctx->mpv, "dither-depth", "8");
        }
        CGLPixelFormatAttribute sdr_attrs[] = {
            kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
            kCGLPFAColorSize, (CGLPixelFormatAttribute)32,
            kCGLPFADepthSize, (CGLPixelFormatAttribute)0,
            kCGLPFAAccelerated,
            kCGLPFAAllowOfflineRenderers,
            (CGLPixelFormatAttribute)0
        };
        CGLError err = CGLChoosePixelFormat(sdr_attrs, &pix, &npix);
        if (err != kCGLNoError || !pix) {
            mpv_terminate_destroy(ctx->mpv);
            ctx->mpv = nullptr;
            return false;
        }
    }

    // hdr_mode is determined by the actual created context type
    ctx->hdr_mode = got_hdr_ctx;

    CGLError cglErr = CGLCreateContext(pix, nil, &ctx->cglCtx);
    CGLReleasePixelFormat(pix);
    if (cglErr != kCGLNoError || !ctx->cglCtx) {
        mpv_terminate_destroy(ctx->mpv);
        ctx->mpv = nullptr;
        ctx->cglCtx = nullptr;
        return false;
    }

    CGLSetCurrentContext(ctx->cglCtx);

    // ── 3. Create mpv OpenGL render context ──
    mpv_opengl_init_params gl_init = {};
    gl_init.get_proc_address = headless_get_proc_address;
    gl_init.get_proc_address_ctx = nullptr;

    mpv_render_param init_params[] = {
        {MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_OPENGL},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init},
        {MPV_RENDER_PARAM_INVALID, nullptr}
    };

    if (mpv_render_context_create(&ctx->render_ctx, ctx->mpv, init_params) < 0) {
        CGLSetCurrentContext(nil);
        CGLReleaseContext(ctx->cglCtx);
        mpv_terminate_destroy(ctx->mpv);
        ctx->cglCtx = nullptr;
        ctx->mpv = nullptr;
        ctx->render_ctx = nullptr;
        return false;
    }

    return true;
}

bool headless_setup_fbo(HeadlessContext *ctx, int width, int height) {
    if (!ctx || !ctx->cglCtx || !ctx->render_ctx) return false;

    // Align to even numbers
    width  = (width  + 1) & ~1;
    height = (height + 1) & ~1;
    if (width  < 2) width  = 2;
    if (height < 2) height = 2;

    ctx->width  = width;
    ctx->height = height;

    CGLSetCurrentContext(ctx->cglCtx);

    GLenum internal_fmt = ctx->hdr_mode ? GL_RGBA16F : GL_RGBA8;
    GLenum pixel_type   = ctx->hdr_mode ? GL_HALF_FLOAT : GL_UNSIGNED_BYTE;
    int    bpp          = ctx->hdr_mode ? 8 : 4;

    glGenFramebuffers(1, &ctx->fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, ctx->fbo);

    glGenTextures(1, &ctx->tex);
    glBindTexture(GL_TEXTURE_2D, ctx->tex);
    glTexImage2D(GL_TEXTURE_2D, 0, internal_fmt, width, height, 0,
                 GL_RGBA, pixel_type, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
                           GL_TEXTURE_2D, ctx->tex, 0);

    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        glDeleteTextures(1, &ctx->tex);
        glDeleteFramebuffers(1, &ctx->fbo);
        ctx->fbo = 0;
        ctx->tex = 0;
        return false;
    }

    ctx->pixel_buf_size = (size_t)width * height * bpp;
    ctx->pixels = (uint8_t *)malloc(ctx->pixel_buf_size);
    if (!ctx->pixels) {
        glDeleteTextures(1, &ctx->tex);
        glDeleteFramebuffers(1, &ctx->fbo);
        ctx->fbo = 0;
        ctx->tex = 0;
        return false;
    }

    return true;
}

bool headless_loadfile(HeadlessContext *ctx, const char *video_path) {
    if (!ctx || !ctx->mpv || !video_path) return false;

    headless_mpv_loadfile(ctx->mpv, video_path);

    // Wait for FILE_LOADED, timeout 10s (100 times x 0.1s)
    for (int i = 0; i < 100; i++) {
        mpv_event *ev = mpv_wait_event(ctx->mpv, 0.1);
        if (ev->event_id == MPV_EVENT_FILE_LOADED) return true;
        if (ev->event_id == MPV_EVENT_END_FILE)    return false;
    }
    return false;
}

void headless_detect_dv(HeadlessContext *ctx) {
    if (!ctx || !ctx->mpv) return;
    // Only switch tone mapping in SDR mode (HDR passthrough doesn't need it)
    char *codec = mpv_get_property_string(ctx->mpv, "video-codec-info");
    if (codec) {
        if (strstr(codec, "Dolby Vision") || strstr(codec, "DOVI")) {
            if (!ctx->hdr_mode) {
                mpv_set_property_string(ctx->mpv, "tone-mapping", "st2094-10");
            }
        }
        mpv_free(codec);
    }
}

bool headless_render_and_read(HeadlessContext *ctx) {
    if (!ctx || !ctx->render_ctx || !ctx->fbo || !ctx->pixels) return false;

    CGLSetCurrentContext(ctx->cglCtx);

    GLenum internal_fmt = ctx->hdr_mode ? GL_RGBA16F : GL_RGBA8;
    GLenum pixel_type   = ctx->hdr_mode ? GL_HALF_FLOAT : GL_UNSIGNED_BYTE;
    int    bpp          = ctx->hdr_mode ? 8 : 4;

    mpv_opengl_fbo mpv_fbo = {};
    mpv_fbo.fbo             = (int)ctx->fbo;
    mpv_fbo.w               = ctx->width;
    mpv_fbo.h               = ctx->height;
    mpv_fbo.internal_format = (int)internal_fmt;

    int flip_y = 1;
    int block  = 0;
    mpv_render_param render_params[] = {
        {MPV_RENDER_PARAM_OPENGL_FBO,            &mpv_fbo},
        {MPV_RENDER_PARAM_FLIP_Y,                &flip_y},
        {MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block},
        {MPV_RENDER_PARAM_INVALID,               nullptr}
    };

    if (mpv_render_context_render(ctx->render_ctx, render_params) < 0) return false;
    glFinish();

    glBindFramebuffer(GL_FRAMEBUFFER, ctx->fbo);
    glReadPixels(0, 0, ctx->width, ctx->height, GL_RGBA, pixel_type, ctx->pixels);

    flip_rows_rgba(ctx->pixels, ctx->width, ctx->height, bpp);

    return true;
}

void headless_destroy(HeadlessContext *ctx) {
    if (!ctx) return;

    // Release order: pixels -> FBO/tex -> render_ctx -> CGL -> mpv
    if (ctx->pixels) {
        free(ctx->pixels);
        ctx->pixels = nullptr;
    }

    if (ctx->fbo || ctx->tex) {
        if (ctx->cglCtx) CGLSetCurrentContext(ctx->cglCtx);
        if (ctx->tex) {
            glDeleteTextures(1, &ctx->tex);
            ctx->tex = 0;
        }
        if (ctx->fbo) {
            glDeleteFramebuffers(1, &ctx->fbo);
            ctx->fbo = 0;
        }
    }

    if (ctx->render_ctx) {
        mpv_render_context_free(ctx->render_ctx);
        ctx->render_ctx = nullptr;
    }

    if (ctx->cglCtx) {
        CGLSetCurrentContext(nil);
        CGLReleaseContext(ctx->cglCtx);
        ctx->cglCtx = nullptr;
    }

    if (ctx->mpv) {
        mpv_terminate_destroy(ctx->mpv);
        ctx->mpv = nullptr;
    }

    ctx->width          = 0;
    ctx->height         = 0;
    ctx->pixel_buf_size = 0;
    ctx->hdr_mode       = false;
}
