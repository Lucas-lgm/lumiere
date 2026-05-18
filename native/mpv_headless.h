/**
 * Headless mpv + OpenGL common infrastructure
 *
 * Provides shared offscreen render context for mpv_thumbnail.mm and mpv_anim_export.mm,
 * eliminating the duplicate ~150 lines of mpv + CGL + FBO initialization code in both modules.
 *
 * Lifecycle:
 *   headless_create     — Create mpv + CGL + render context (without FBO)
 *   headless_setup_fbo  — Create FBO + pixel buffer (needs exact width/height)
 *   headless_loadfile   — Load file and wait for FILE_LOADED
 *   headless_render_and_read — Render to FBO + glReadPixels + row flip
 *   headless_detect_dv  — Detect Dolby Vision and switch tone mapping
 *   headless_destroy    — Release all resources
 */

#pragma once

#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>

extern "C" {
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
}

#include <cstdint>
#include <cstddef>

/**
 * Offscreen render context
 *
 * Encapsulates mpv instance, CGL context, FBO, and pixel buffer.
 * When hdr_mode=true, FBO format is GL_RGBA16F, pixel buffer uses half-float (8 bytes/pixel);
 * When hdr_mode=false, FBO format is GL_RGBA8, pixel buffer uses RGBA8 (4 bytes/pixel).
 */
struct HeadlessContext {
    mpv_handle          *mpv;
    mpv_render_context  *render_ctx;
    CGLContextObj        cglCtx;
    GLuint               fbo;
    GLuint               tex;
    int                  width;
    int                  height;
    uint8_t             *pixels;
    size_t               pixel_buf_size;
    bool                 hdr_mode;
};

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Check whether the path is a Blu-ray ISO file (by .iso extension)
 */
bool is_bluray_iso(const char *path);

/**
 * Load a file into mpv (Blu-ray ISO automatically uses bd:// protocol)
 *
 * Called after initialization, uses mpv_set_property_string to set bluray-device.
 */
int headless_mpv_loadfile(mpv_handle *mpv, const char *video_path);

/**
 * Flip row order of RGBA pixel buffer
 *
 * glReadPixels reads from bottom to top, so row order must be flipped to get the correct image.
 * bytes_per_pixel: RGBA8 = 4, RGBA16F = 8.
 */
void flip_rows_rgba(uint8_t *pixels, int width, int height, int bytes_per_pixel);

/**
 * Encode RGBA8 pixel data as JPEG and write to file
 *
 * Uses CoreGraphics ImageIO encoding. quality range 0.0–1.0.
 * Note: Only supports RGBA8 (SDR) pixel data; HDR needs conversion first.
 */
bool write_jpeg(const char *path, const uint8_t *pixels, int width, int height, float quality);

/**
 * Phase 1: Create mpv instance, CGL context, and mpv render context
 *
 * @param ctx        Output context struct (memset to 0 before calling)
 * @param request_hdr true = attempt to create floating-point CGL context (ColorSize=64 + ColorFloat);
 *                    falls back to SDR automatically on failure
 * @param start_pos  mpv "start" option value (e.g. "10%", "12.345"); NULL means not set.
 *                   Must be set before mpv_initialize, so it is handled in this function.
 * @return true on success, false on failure (resources in ctx are freed)
 */
bool headless_create(HeadlessContext *ctx, bool request_hdr, const char *start_pos);

/**
 * Phase 2: Create FBO + pixel buffer
 *
 * Must be called after the exact dimensions are known. For mpv_generate_thumbnail,
 * you need to load the file first to get video dimensions before calling this.
 *
 * width/height are aligned to even numbers (required by JPEG/video encoders).
 *
 * @return true on success, false on failure (FBO resources freed, but mpv/CGL/render_ctx remain valid)
 */
bool headless_setup_fbo(HeadlessContext *ctx, int width, int height);

/**
 * Phase 3: Load video file and wait for FILE_LOADED
 *
 * Blu-ray ISO automatically uses bd:// protocol.
 * Timeout of 10s (100 times x 0.1s) without FILE_LOADED returns false.
 *
 * @return true on file load success, false on timeout or END_FILE
 */
bool headless_loadfile(HeadlessContext *ctx, const char *video_path);

/**
 * Detect Dolby Vision and switch tone mapping to st2094-10
 *
 * Determined via the video-codec-info property.
 * Only meaningful in SDR mode (hdr_mode=false); HDR passthrough mode doesn't need switching.
 */
void headless_detect_dv(HeadlessContext *ctx);

/**
 * Render the current frame to FBO and read pixels (without frame wait)
 *
 * Ensure a frame is ready before calling (check with mpv_render_context_update).
 * Automatically flips row order after reading.
 *
 * @return true on render and read success, false on mpv_render_context_render failure
 */
bool headless_render_and_read(HeadlessContext *ctx);

/**
 * Release all resources
 *
 * Release order: pixels -> FBO/tex -> render_ctx -> CGL -> mpv.
 * All fields are zeroed after release, safe to call multiple times.
 */
void headless_destroy(HeadlessContext *ctx);

#ifdef __cplusplus
}
#endif
