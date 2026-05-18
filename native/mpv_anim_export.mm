/**
 * Animated Image Export
 *
 * Dual encoder, auto-selected by file extension:
 * - .png/.apng -> apng_encoder.h (24-bit true color, per-frame zlib compression)
 * - .gif -> anim_gif_encoder.h (Median-Cut 256 colors + LZW)
 * - .webp -> webp_anim_encoder.h (lossy/lossless)
 * - .avif -> avif_anim_encoder.h (AV1, supports HDR 10-bit PQ/BT.2020)
 *
 * Frame extraction: reuses HeadlessContext (mpv_headless.h) offscreen rendering infrastructure.
 * First frame seek-positioned, subsequent frames use frame-step sequential advancing (much faster than per-frame seek).
 * Writes frames sequentially throughout, does not cache all frames, avoids memory blowup.
 */

#import <Foundation/Foundation.h>
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>

extern "C" {
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
}

#include <cstdlib>
#include <cstring>
#include <cstdio>
#include "anim_gif_encoder.h"
#include "apng_encoder.h"
#include "webp_anim_encoder.h"
#include "avif_anim_encoder.h"
#include "mpv_headless.h"

// ── Frame Extractor ──
// Adds animation export specific state on top of HeadlessContext

struct FrameExtractor {
    HeadlessContext hctx;
    bool source_is_hdr;     // Whether source video is HDR
    // Render params (avoid rebuilding per frame)
    mpv_opengl_fbo mpv_fbo;
    int flip_y, block;
    mpv_render_param render_params[4];
};

static bool extractor_init(FrameExtractor &ex, const char *video_path,
                           int output_width, int output_height, double start_time,
                           bool request_hdr = false) {
    memset(&ex, 0, sizeof(ex));

    // Align width/height to even numbers
    output_width  = (output_width  + 1) & ~1;
    output_height = (output_height + 1) & ~1;
    if (output_width  < 2) output_width  = 2;
    if (output_height < 2) output_height = 2;

    // ── 1. Create headless context (set start time) ──
    char start_str[64];
    snprintf(start_str, sizeof(start_str), "%.3f", start_time);

    if (!headless_create(&ex.hctx, request_hdr, start_str)) return false;

    // ── 2. Load file (no Blu-ray detection — anim export does not handle Blu-ray ISO) ──
    {
        const char *cmd[] = {"loadfile", video_path, NULL};
        mpv_command(ex.hctx.mpv, cmd);
        bool loaded = false;
        for (int i = 0; i < 200; i++) {
            mpv_event *ev = mpv_wait_event(ex.hctx.mpv, 0.1);
            if (ev->event_id == MPV_EVENT_FILE_LOADED) { loaded = true; break; }
            if (ev->event_id == MPV_EVENT_END_FILE) break;
        }
        if (!loaded) {
            headless_destroy(&ex.hctx);
            return false;
        }
    }

    // ── 3. Render one frame with temporary small FBO to trigger mpv decoding and fill video-params ──
    // Color space parameters may not be ready at FILE_LOADED
    {
        GLuint tmp_fbo, tmp_tex;
        glGenFramebuffers(1, &tmp_fbo); glBindFramebuffer(GL_FRAMEBUFFER, tmp_fbo);
        glGenTextures(1, &tmp_tex); glBindTexture(GL_TEXTURE_2D, tmp_tex);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 16, 16, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tmp_tex, 0);

        mpv_opengl_fbo tmp_mpv_fbo = {};
        tmp_mpv_fbo.fbo = (int)tmp_fbo; tmp_mpv_fbo.w = 16; tmp_mpv_fbo.h = 16;
        tmp_mpv_fbo.internal_format = GL_RGBA8;
        int tmp_flip = 1, tmp_block = 0;
        mpv_render_param tmp_params[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO,            &tmp_mpv_fbo},
            {MPV_RENDER_PARAM_FLIP_Y,                &tmp_flip},
            {MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &tmp_block},
            {MPV_RENDER_PARAM_INVALID,               nullptr}
        };

        for (int w = 0; w < 100; w++) {
            mpv_wait_event(ex.hctx.mpv, 0.05);
            if (mpv_render_context_update(ex.hctx.render_ctx) & MPV_RENDER_UPDATE_FRAME) {
                mpv_render_context_render(ex.hctx.render_ctx, tmp_params);
                break;
            }
        }

        glDeleteTextures(1, &tmp_tex);
        glDeleteFramebuffers(1, &tmp_fbo);
    }

    // ── 4. Detect if source video is HDR (consistent with player's update_hdr_mode) ──
    ex.source_is_hdr = false;
    char *gamma    = mpv_get_property_string(ex.hctx.mpv, "video-params/gamma");
    char *primaries = mpv_get_property_string(ex.hctx.mpv, "video-params/primaries");

    if (gamma && (strcmp(gamma, "pq") == 0 || strcmp(gamma, "hlg") == 0)) {
        bool isSdrPrimaries = primaries && strcmp(primaries, "bt.709") == 0;
        if (!isSdrPrimaries) {
            ex.source_is_hdr = true;
        }
    }

    if (gamma)    mpv_free(gamma);
    if (primaries) mpv_free(primaries);

    // ── 5. Determine final HDR mode ──
    // headless_create may fall back if float context fails, hctx.hdr_mode reflects actual state
    bool effective_hdr = ex.hctx.hdr_mode && ex.source_is_hdr;

    if (effective_hdr) {
        // HDR: read source video signal peak, set as target-peak (source peak = target peak -> near lossless)
        double sig_peak = 0;
        mpv_get_property(ex.hctx.mpv, "video-params/sig-peak", MPV_FORMAT_DOUBLE, &sig_peak);
        int64_t peak_nits = (sig_peak > 0) ? (int64_t)(sig_peak * 100.0) : 1000;
        if (peak_nits < 100) peak_nits = 100;
        mpv_set_property(ex.hctx.mpv, "target-peak", MPV_FORMAT_INT64, &peak_nits);
    } else if (ex.hctx.hdr_mode && !ex.source_is_hdr) {
        // HDR requested but source is SDR -> fall back mpv parameters to SDR
        mpv_set_property_string(ex.hctx.mpv, "target-prim", "bt.709");
        mpv_set_property_string(ex.hctx.mpv, "target-trc", "srgb");
        mpv_set_property_string(ex.hctx.mpv, "target-peak", "auto");
        mpv_set_property_string(ex.hctx.mpv, "hdr-compute-peak", "auto");
        mpv_set_property_string(ex.hctx.mpv, "tone-mapping", "bt.2390");
        mpv_set_property_string(ex.hctx.mpv, "dither-depth", "8");
        // Update hdr_mode to actual value
        ex.hctx.hdr_mode = false;
    }

    // DV detection: only switch tone mapping in SDR mode
    headless_detect_dv(&ex.hctx);

    // ── 6. Create final FBO (now know final hdr_mode) ──
    if (!headless_setup_fbo(&ex.hctx, output_width, output_height)) {
        headless_destroy(&ex.hctx);
        return false;
    }

    return true;
}

// Wait for mpv render ready and read pixels
static bool extractor_render_and_read(FrameExtractor &ex) {
    bool ready = false;
    for (int w = 0; w < 100; w++) {
        mpv_wait_event(ex.hctx.mpv, 0.05);
        if (mpv_render_context_update(ex.hctx.render_ctx) & MPV_RENDER_UPDATE_FRAME) {
            ready = true;
            break;
        }
    }
    if (!ready) return false;
    return headless_render_and_read(&ex.hctx);
}

// Seek to specified time and grab one frame (only used for first frame positioning)
static bool extractor_seek_and_grab(FrameExtractor &ex, double time) {
    char time_str[64];
    snprintf(time_str, sizeof(time_str), "%.4f", time);
    const char *seek_cmd[] = {"seek", time_str, "absolute+exact", NULL};
    mpv_command(ex.hctx.mpv, seek_cmd);
    return extractor_render_and_read(ex);
}

// Frame-step advance n frames and grab (for subsequent frames, much faster than seek)
// Intermediate frames only advance the decoder, skip GPU rendering and pixel readback
// HDR/DV dynamic metadata is handled by decoder CPU side, does not depend on GPU render state
static bool extractor_step_and_grab(FrameExtractor &ex, int steps) {
    const char *step_cmd[] = {"frame-step", NULL};
    for (int s = 0; s < steps; s++) {
        mpv_command(ex.hctx.mpv, step_cmd);
        for (int w = 0; w < 50; w++) {
            mpv_wait_event(ex.hctx.mpv, 0.02);
            if (mpv_render_context_update(ex.hctx.render_ctx) & MPV_RENDER_UPDATE_FRAME) break;
        }
    }
    return extractor_render_and_read(ex);
}

static void extractor_cleanup(FrameExtractor &ex) {
    headless_destroy(&ex.hctx);
}

// ── Public entry point ──

extern "C" bool mpv_export_gif(
    const char *video_path, const char *output_path,
    double start_time, double end_time,
    int fps, int output_width, int output_height,
    int quality,
    void (*progress_callback)(int current_frame, int total_frames, void *ctx),
    void *callback_ctx, volatile bool *cancel_flag
) {
    if (end_time <= start_time || fps <= 0) return false;

    int total_frames = (int)((end_time - start_time) * fps);
    if (total_frames <= 0) return false;
    if (total_frames > 720) total_frames = 720;

    // AVIF supports HDR passthrough (10-bit PQ/BT.2020), other formats use SDR tone mapping
    bool request_hdr = false;
    {
        const char *ext_check = strrchr(output_path, '.');
        if (ext_check && strcasecmp(ext_check, ".avif") == 0)
            request_hdr = true;
    }
    FrameExtractor ex;
    if (!extractor_init(ex, video_path, output_width, output_height, start_time, request_hdr))
        return false;

    // Query source video frame rate, calculate source frames to step per output frame
    double src_fps = 0;
    mpv_get_property(ex.hctx.mpv, "container-fps", MPV_FORMAT_DOUBLE, &src_fps);
    if (src_fps <= 0) src_fps = 30.0; // fallback
    int step_per_frame = (int)(src_fps / fps + 0.5);
    if (step_per_frame < 1) step_per_frame = 1;

    // Select encoder by file extension
    enum AnimFormat { FMT_GIF, FMT_APNG, FMT_WEBP, FMT_AVIF };
    AnimFormat fmt = FMT_GIF;
    const char *ext = strrchr(output_path, '.');
    if (ext) {
        if (strcasecmp(ext, ".png") == 0 || strcasecmp(ext, ".apng") == 0)
            fmt = FMT_APNG;
        else if (strcasecmp(ext, ".webp") == 0)
            fmt = FMT_WEBP;
        else if (strcasecmp(ext, ".avif") == 0)
            fmt = FMT_AVIF;
    }

    bool success = true;

    if (fmt == FMT_AVIF) {
        // AVIF: AV1 encoding, supports HDR (10-bit BT.2020 PQ)
        AvifAnimEncoder avif;
        bool high = (quality >= 1);
        int avif_q = high ? 80 : 60;
        if (!avif_anim_begin(&avif, output_path, ex.hctx.width, ex.hctx.height, fps, avif_q, ex.hctx.hdr_mode)) {
            extractor_cleanup(ex); return false;
        }
        if (!high) avif.enc->speed = 8;
        for (int i = 0; i < total_frames; i++) {
            if (cancel_flag && *cancel_flag) { success = false; break; }
            bool got = (i == 0)
                ? extractor_seek_and_grab(ex, start_time)
                : extractor_step_and_grab(ex, step_per_frame);
            if (got) avif_anim_add_frame(&avif, ex.hctx.pixels);
            if (progress_callback) progress_callback(i + 1, total_frames, callback_ctx);
        }
        if (success) {
            success = avif_anim_end(&avif);
        } else {
            avif_anim_end(&avif);
            remove(output_path);
        }
    } else if (fmt == FMT_WEBP) {
        // WebP: lossy or lossless, libwebp encoding
        WebpAnimEncoder webp;
        bool lossless = (quality >= 1);
        float q = lossless ? 75.0f : 75.0f; // lossy quality 75
        if (!webp_anim_begin(&webp, output_path, ex.hctx.width, ex.hctx.height, fps, q, lossless ? 1 : 0)) {
            extractor_cleanup(ex); return false;
        }
        for (int i = 0; i < total_frames; i++) {
            if (cancel_flag && *cancel_flag) { success = false; break; }
            bool got = (i == 0)
                ? extractor_seek_and_grab(ex, start_time)
                : extractor_step_and_grab(ex, step_per_frame);
            if (got) webp_anim_add_frame(&webp, ex.hctx.pixels);
            if (progress_callback) progress_callback(i + 1, total_frames, callback_ctx);
        }
        if (success) {
            success = webp_anim_end(&webp);
        } else {
            webp_anim_end(&webp);
            remove(output_path);
        }
    } else if (fmt == FMT_APNG) {
        // APNG: 24-bit true color, per-frame zlib compression
        ApngEncoder apng;
        if (!apng_begin(&apng, output_path, ex.hctx.width, ex.hctx.height)) {
            extractor_cleanup(ex); return false;
        }
        for (int i = 0; i < total_frames; i++) {
            if (cancel_flag && *cancel_flag) { success = false; break; }
            bool got = (i == 0)
                ? extractor_seek_and_grab(ex, start_time)
                : extractor_step_and_grab(ex, step_per_frame);
            if (got) apng_add_frame(&apng, ex.hctx.pixels, 1, fps);
            if (progress_callback) progress_callback(i + 1, total_frames, callback_ctx);
        }
        apng_end(&apng);
    } else {
        // GIF: Median-Cut 256 colors + LZW
        GifEncoder gif;
        if (!gif_begin(&gif, output_path, ex.hctx.width, ex.hctx.height, 0)) {
            extractor_cleanup(ex); return false;
        }
        int delay_cs = (int)(100.0f / fps + 0.5f);
        for (int i = 0; i < total_frames; i++) {
            if (cancel_flag && *cancel_flag) { success = false; break; }
            bool got = (i == 0)
                ? extractor_seek_and_grab(ex, start_time)
                : extractor_step_and_grab(ex, step_per_frame);
            if (got) gif_add_frame(&gif, ex.hctx.pixels, delay_cs);
            if (progress_callback) progress_callback(i + 1, total_frames, callback_ctx);
        }
        gif_end(&gif);
    }

    if (!success) remove(output_path);
    extractor_cleanup(ex);
    return success;
}
