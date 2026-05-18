/**
 * Thumbnail Generator
 *
 * Generates video thumbnails using GPU offscreen rendering (OpenGL FBO).
 * Uses the same GPU pipeline as playback:
 *   hwdec -> gpu-next -> tone mapping -> color management -> FBO -> glReadPixels
 * Ensures thumbnails for DV/HDR/MOV etc. match playback appearance.
 *
 * Designed to be called from a background thread (via N-API AsyncWorker), does not block the JS main thread.
 *
 * Underlying infrastructure reuses mpv_headless.h / mpv_headless.mm.
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
#include <mutex>
#include <atomic>

#include "mpv_headless.h"

extern "C" bool mpv_generate_thumbnail(const char *video_path,
                                       const char *output_path,
                                       double seek_percent,
                                       int thumb_width) {
    if (!video_path || !output_path || thumb_width < 2) return false;

    // ── 1. Create headless context, set start position ──
    char start_str[32];
    snprintf(start_str, sizeof(start_str), "%.0f%%", seek_percent * 100);

    HeadlessContext ctx = {};
    if (!headless_create(&ctx, false, start_str)) return false;

    // ── 2. Load file (Blu-ray ISO auto goes to bd://) ──
    if (!headless_loadfile(&ctx, video_path)) {
        headless_destroy(&ctx);
        return false;
    }

    // ── 3. Detect Dolby Vision ──
    headless_detect_dv(&ctx);

    // ── 4. Get video dimensions, calculate thumbnail height ──
    int64_t video_w = 0, video_h = 0;
    mpv_get_property(ctx.mpv, "width", MPV_FORMAT_INT64, &video_w);
    mpv_get_property(ctx.mpv, "height", MPV_FORMAT_INT64, &video_h);

    if (video_w <= 0 || video_h <= 0) {
        video_w = 1920;
        video_h = 1080;
    }

    int render_w = thumb_width;
    int render_h = (int)((double)thumb_width * video_h / video_w);
    if (render_w < 2) render_w = 2;
    if (render_h < 2) render_h = 2;

    // ── 5. Create FBO (dimensions now known) ──
    if (!headless_setup_fbo(&ctx, render_w, render_h)) {
        headless_destroy(&ctx);
        return false;
    }

    // ── 6. Wait for render frame ready ──
    bool frame_ready = false;
    for (int i = 0; i < 100 && !frame_ready; i++) {
        mpv_wait_event(ctx.mpv, 0.1);
        uint64_t flags = mpv_render_context_update(ctx.render_ctx);
        if (flags & MPV_RENDER_UPDATE_FRAME) frame_ready = true;
    }

    if (!frame_ready) {
        headless_destroy(&ctx);
        return false;
    }

    // ── 7. Render + read pixels ──
    bool success = headless_render_and_read(&ctx);

    // ── 8. Encode as JPEG ──
    if (success) {
        success = write_jpeg(output_path, ctx.pixels, ctx.width, ctx.height, 0.8f);
    }

    // ── 9. Cleanup ──
    headless_destroy(&ctx);
    return success;
}

// ── Sprite Sheet config constants ──
static const int STRIP_DEFAULT_WIDTH     = 160;
static const int STRIP_DEFAULT_HEIGHT    = 90;

/**
 * Generate sprite sheet for progress bar preview (N thumbnails horizontally concatenated)
 *
 * Each frame seeks at duration / count intervals, GPU offscreen renders then horizontally concatenates.
 * Output is a single JPEG: width = thumb_width * count, height = thumb_height.
 */
extern "C" bool mpv_generate_thumbnail_strip(
    const char *video_path,
    const char *output_path,
    int thumb_width,
    int thumb_height,
    int count,
    double duration)
{
    if (!video_path || !output_path || count <= 0 || duration <= 0.0) return false;
    if (thumb_width  < 2) thumb_width  = STRIP_DEFAULT_WIDTH;
    if (thumb_height < 2) thumb_height = STRIP_DEFAULT_HEIGHT;

    // ── 1. Create headless context (no start position, will seek later) ──
    HeadlessContext ctx = {};
    if (!headless_create(&ctx, false, nullptr)) return false;

    // ── 2. Create FBO (dimensions known) ──
    if (!headless_setup_fbo(&ctx, thumb_width, thumb_height)) {
        headless_destroy(&ctx);
        return false;
    }

    // ── 3. Allocate sprite sheet buffer ──
    int strip_width    = thumb_width * count;
    int strip_height   = thumb_height;
    int row_bytes_thumb = thumb_width * 4;
    int row_bytes_strip = strip_width * 4;

    uint8_t *strip_pixels = (uint8_t *)calloc((size_t)strip_width * strip_height, 4);
    if (!strip_pixels) {
        headless_destroy(&ctx);
        return false;
    }

    // ── 4. Load file and wait for ready ──
    if (!headless_loadfile(&ctx, video_path)) {
        free(strip_pixels);
        headless_destroy(&ctx);
        return false;
    }

    headless_detect_dv(&ctx);

    // ── 5. Per-frame seek -> render -> composite into strip ──
    double interval = duration / count;

    for (int i = 0; i < count; i++) {
        double seek_time = interval * (i + 0.5);
        if (seek_time > duration) seek_time = duration - 0.5;
        if (seek_time < 0.0)     seek_time = 0.0;

        char seek_str[64];
        snprintf(seek_str, sizeof(seek_str), "%.3f", seek_time);
        const char *seek_cmd[] = {"seek", seek_str, "absolute+exact", NULL};
        mpv_command(ctx.mpv, seek_cmd);

        // Wait for render frame ready
        bool frame_ready = false;
        for (int j = 0; j < 100 && !frame_ready; j++) {
            mpv_wait_event(ctx.mpv, 0.05);
            uint64_t flags = mpv_render_context_update(ctx.render_ctx);
            if (flags & MPV_RENDER_UPDATE_FRAME) frame_ready = true;
        }
        if (!frame_ready) continue;

        if (!headless_render_and_read(&ctx)) continue;

        // Copy frame horizontally into strip (row by row)
        int x_offset = i * thumb_width * 4;
        for (int y = 0; y < thumb_height; y++) {
            uint8_t *src = ctx.pixels + y * row_bytes_thumb;
            uint8_t *dst = strip_pixels + y * row_bytes_strip + x_offset;
            memcpy(dst, src, row_bytes_thumb);
        }
    }

    // ── 6. Write sprite sheet JPEG ──
    bool success = write_jpeg(output_path, strip_pixels, strip_width, strip_height, 0.8f);

    // ── 7. Cleanup ──
    free(strip_pixels);
    headless_destroy(&ctx);
    return success;
}

// ══════════════════════════════════════════════════════════════════════
// Persistent thumbnail instance (progress bar dynamic on-demand seek preview)
//
// Design:
//   - When video loads, call mpv_thumb_seek_init() to create persistent mpv instance
//   - When frontend hovers on progress bar, call mpv_thumb_seek_at() on demand to generate single-frame JPEG
//   - When video switches/stops, call mpv_thumb_seek_destroy() to destroy instance
//   - std::mutex protects global state, AsyncWorker serializes for thread safety
// ══════════════════════════════════════════════════════════════════════

static std::mutex g_seek_mutex;

/** Destroy request flag: seekAt checks this flag at wait points, exits immediately to release lock */
static std::atomic<bool> g_seek_abort{false};

/** Global state for persistent thumbnail instance */
static struct {
    HeadlessContext hctx;
    /** Currently loaded video path (for reuse check) */
    char current_video[4096];
} g_seek_ctx;

/** Destroy persistent instance, release all resources (caller must hold g_seek_mutex) */
static void destroy_seek_ctx_locked() {
    headless_destroy(&g_seek_ctx.hctx);
    g_seek_ctx.current_video[0] = '\0';
}

/**
 * Initialize persistent seek thumbnail instance
 *
 * - If instance already exists with same video path/dimensions, reuses it and returns true
 * - If different video, destroys old instance then rebuilds
 *
 * @param video_path   Video file path
 * @param thumb_width  Output thumbnail width (pixels)
 * @param thumb_height Output thumbnail height (pixels)
 * @return true on successful initialization
 */
extern "C" bool mpv_thumb_seek_init(const char *video_path, int thumb_width, int thumb_height) {
    if (!video_path) return false;
    if (thumb_width  < 2) thumb_width  = 160;
    if (thumb_height < 2) thumb_height = 90;

    std::lock_guard<std::mutex> lock(g_seek_mutex);

    // Reuse: same video + same dimensions
    if (g_seek_ctx.hctx.mpv &&
        g_seek_ctx.hctx.width  == thumb_width &&
        g_seek_ctx.hctx.height == thumb_height &&
        strncmp(g_seek_ctx.current_video, video_path, sizeof(g_seek_ctx.current_video) - 1) == 0) {
        return true;
    }

    // Destroy old instance (if any)
    destroy_seek_ctx_locked();

    // ── Create new instance ──
    HeadlessContext &hctx = g_seek_ctx.hctx;

    if (!headless_create(&hctx, false, nullptr)) return false;

    if (!headless_setup_fbo(&hctx, thumb_width, thumb_height)) {
        headless_destroy(&hctx);
        return false;
    }

    if (!headless_loadfile(&hctx, video_path)) {
        headless_destroy(&hctx);
        return false;
    }

    headless_detect_dv(&hctx);

    strncpy(g_seek_ctx.current_video, video_path, sizeof(g_seek_ctx.current_video) - 1);
    g_seek_ctx.current_video[sizeof(g_seek_ctx.current_video) - 1] = '\0';

    return true;
}

/**
 * Seek to specified time and generate single-frame thumbnail JPEG
 *
 * Must be initialized via mpv_thumb_seek_init() before calling.
 *
 * @param time_sec    Target time (seconds, absolute)
 * @param output_path Output JPEG path
 * @return true on success
 */
extern "C" bool mpv_thumb_seek_at(double time_sec, const char *output_path) {
    if (!output_path) return false;

    std::lock_guard<std::mutex> lock(g_seek_mutex);

    HeadlessContext &hctx = g_seek_ctx.hctx;
    if (!hctx.mpv || !hctx.render_ctx) return false;

    CGLSetCurrentContext(hctx.cglCtx);

    // Consume old pending frames (prevent reading stale seek frames)
    if (mpv_render_context_update(hctx.render_ctx) & MPV_RENDER_UPDATE_FRAME) {
        // Temporarily render and discard frame
        mpv_opengl_fbo discard_fbo = {};
        discard_fbo.fbo             = (int)hctx.fbo;
        discard_fbo.w               = hctx.width;
        discard_fbo.h               = hctx.height;
        discard_fbo.internal_format = GL_RGBA8;
        int discard_flip_y = 1;
        int discard_block  = 0;
        mpv_render_param discard_params[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO,            &discard_fbo},
            {MPV_RENDER_PARAM_FLIP_Y,                &discard_flip_y},
            {MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &discard_block},
            {MPV_RENDER_PARAM_INVALID,               nullptr}
        };
        mpv_render_context_render(hctx.render_ctx, discard_params);
        glFinish();
    }

    // Drain event queue
    while (true) {
        mpv_event *ev = mpv_wait_event(hctx.mpv, 0);
        if (ev->event_id == MPV_EVENT_NONE) break;
    }

    // Seek to target time
    char seek_str[64];
    snprintf(seek_str, sizeof(seek_str), "%.3f", time_sec);
    const char *seek_cmd[] = {"seek", seek_str, "absolute+exact", NULL};
    mpv_command(hctx.mpv, seek_cmd);

    // Wait for PLAYBACK_RESTART to confirm seek completion (no timeout, controlled by business layer abort)
    bool restart_received = false;
    while (!restart_received) {
        if (g_seek_abort.load()) return false;
        mpv_event *ev = mpv_wait_event(hctx.mpv, 0.1);
        if (ev->event_id == MPV_EVENT_PLAYBACK_RESTART) restart_received = true;
        if (ev->event_id == MPV_EVENT_END_FILE) return false;
    }

    // Render + read pixels
    if (!headless_render_and_read(&hctx)) return false;

    return write_jpeg(output_path, hctx.pixels, hctx.width, hctx.height, 0.8f);
}

/**
 * Destroy persistent seek thumbnail instance, release all resources
 */
extern "C" void mpv_thumb_seek_destroy() {
    // Set abort flag first, so running seekAt exits immediately to release lock
    g_seek_abort.store(true);
    std::lock_guard<std::mutex> lock(g_seek_mutex);
    destroy_seek_ctx_locked();
    g_seek_abort.store(false);
}
