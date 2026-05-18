/**
 * GLRenderContext public header
 *
 * Defines the video render context struct, shared between mpv_render_gl.mm and mpv_hdr.mm.
 */

#ifndef MPV_RENDER_GL_H
#define MPV_RENDER_GL_H

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreFoundation/CoreFoundation.h>
#import <IOSurface/IOSurface.h>

#include <map>
#include <mutex>
#include <atomic>
#include <thread>
#include <memory>
#include <condition_variable>
#include <vector>
#include <string>

extern "C" {
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
}

/**
 * Video Render Context
 *
 * Manages all resources needed for video rendering, including:
 * - OpenGL render context and render layer
 * - Render state and scheduling flags
 * - HDR configuration and color space management
 * - Render size and frame rate information
 *
 * Note: This struct uses the implementation name GLRenderContext to maintain correspondence with the underlying OpenGL.
 * In code you can use the VideoRenderContext type alias for better semantics.
 */
struct GLRenderContext {
    NSView *view = nil;
    CAOpenGLLayer *glLayer = nil;
    CGLContextObj cglContext = nil;
    CGLPixelFormatObj cglPixelFormat = nil;
    mpv_render_context *mpvRenderCtx = nullptr;
    mpv_handle *mpvHandle = nullptr;
    int64_t instanceId = 0;

    // pixel size (width/height) used for rendering (unit: pixels)
    int width = 0;
    int height = 0;
    std::mutex sizeMutex;

    // Last rendered dimensions (used to detect size changes)
    int lastRenderedWidth = 0;
    int lastRenderedHeight = 0;

    // FBO internal format — match actual pixel format (float→GL_RGBA16F, otherwise GL_RGBA8)
    int fboInternalFormat = GL_RGBA8;

    // render scheduling flag (atomic)
    std::atomic<bool> needRedraw;
    std::atomic<bool> displayScheduled;
    std::atomic<bool> resizeScheduled;
    std::atomic<bool> isDestroying;

    // CVDisplayLink
    CVDisplayLinkRef displayLink = nullptr;

    // NSView frame observer
    id frameObserver = nil;
    // Window cross-screen notification observer
    id screenObserver = nil;

    std::atomic<bool> forceBlackFrame;
    std::atomic<bool> forceBlackMode;

    std::atomic<bool> hdrUserEnabled;
    bool hdrActive;
    std::string lastHdrPrimaries;   // Last configured primaries (e.g. "bt.2020"), main thread only
    std::string lastHdrGamma;       // Last configured gamma (e.g. "pq"), main thread only
    std::atomic<uint64_t> lastHdrUpdateMs;

    std::atomic<uint64_t> lastRenderTimeMs;
    // Video frame rate (fps), used to dynamically calculate render interval
    std::atomic<double> videoFps;
    // Minimum render interval (ms), dynamically calculated from video frame rate
    // Default 16ms (~60fps), adjusted if video frame rate is higher
    static constexpr uint64_t DEFAULT_MIN_RENDER_INTERVAL_MS = 16; // ~60fps max

    // JavaScript-driven render mode flag
    // true: rendering driven by JavaScript (e.g. requestAnimationFrame)
    // false: rendering driven by CVDisplayLink automatically (default)
    std::atomic<bool> jsDrivenRenderMode;

    // ---- Non-accelerated render path (VM / software rendering) ----
    // When CGL selects a non-accelerated pixel format (no GPU acceleration), use this path instead of CAOpenGLLayer
    // Core idea: render on a dedicated thread, write results to IOSurface, main thread only swaps layer.contents pointer
    // WindowServer composites directly from IOSurface, never holds CGLContext lock, completely eliminates window drag lag
    bool isNonAccelerated = false;
    // IOSurface: render target (BGRA format, matching WindowServer's expected format)
    IOSurfaceRef ioSurface = nullptr;
    int ioSurfaceW = 0;   // Current IOSurface pixel width
    int ioSurfaceH = 0;   // Current IOSurface pixel height
    std::mutex ioSurfaceMutex;  // Protects IOSurface recreation
    // OpenGL FBO (plain RGBA8, non-IOSurface backing)
    GLuint ioRenderFBO = 0;
    GLuint ioRenderTex = 0;
    // Display CALayer (plain CALayer, not CAOpenGLLayer)
    CALayer *contentLayer = nil;
    // Dedicated render thread
    std::thread renderThread;
    std::mutex renderMutex;
    std::condition_variable renderCV;
    std::atomic<bool> renderRequested{false};
    std::atomic<bool> renderThreadRunning{false};

    std::mutex iccMutex;
    std::vector<uint8_t> iccProfileBytes;

    GLRenderContext()
        : width(0),
          height(0),
          lastRenderedWidth(0),
          lastRenderedHeight(0),
          needRedraw(false),
          displayScheduled(false),
          resizeScheduled(false),
          isDestroying(false),
          displayLink(nullptr),
          frameObserver(nil),
          forceBlackFrame(false),
          forceBlackMode(false),
          hdrUserEnabled(true),
          hdrActive(false),
          lastHdrUpdateMs(0),
          lastRenderTimeMs(0),
          videoFps(0.0),
          jsDrivenRenderMode(false),
          isNonAccelerated(false),
          ioSurface(nullptr),
          ioSurfaceW(0),
          ioSurfaceH(0),
          ioRenderFBO(0),
          ioRenderTex(0),
          contentLayer(nil),
          renderRequested(false),
          renderThreadRunning(false) {}
};

// Semantic type alias: use VideoRenderContext for better readability
using VideoRenderContext = GLRenderContext;

/**
 * OpenGL context locker (RAII pattern)
 *
 * Automatically manages OpenGL context locking and unlocking, ensuring thread safety.
 * Locks the context on construction, unlocks on destruction.
 */
struct ScopedCGLock {
    CGLContextObj ctx;
    ScopedCGLock(CGLContextObj c) : ctx(c) {
        if (ctx) CGLLockContext(ctx);
    }
    ~ScopedCGLock() {
        if (ctx) CGLUnlockContext(ctx);
    }
};

// ==================== Global State Declarations ====================
extern std::map<int64_t, std::shared_ptr<GLRenderContext>> g_renderContexts;
extern std::mutex g_renderMutex;

/** Look up render context under lock, return shared_ptr to extend lifetime. */
std::shared_ptr<GLRenderContext> getRenderContext(int64_t instanceId);

#endif // MPV_RENDER_GL_H
