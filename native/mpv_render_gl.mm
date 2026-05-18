/**
 * Video Render Module
 *
 * Provides video rendering on macOS, including:
 * - OpenGL render context management
 * - HDR/EDR support
 * - Render loop and scheduling
 * - Color space management
 *
 * Architecture Notes:
 * - Uses CAOpenGLLayer for hardware-accelerated rendering
 * - Supports both CVDisplayLink and JavaScript-driven render modes
 * - Integrates with MPV player via mpv_render API
 */

// ==================== Shared Headers (GLRenderContext definition + global declarations) ====================
#include "mpv_render_gl.h"
#include "mpv_hdr.h"

// ==================== Additional System Framework Imports (not included in mpv_render_gl.h) ====================
#import <objc/message.h>
#include <dlfcn.h>
#include <cmath>
#include <algorithm>  // for std::max, std::min
#include <chrono>

// ==================== Global State Definitions ====================
std::map<int64_t, std::shared_ptr<GLRenderContext>> g_renderContexts;
std::mutex g_renderMutex;

/** Look up render context under lock, return shared_ptr to extend lifetime. */
std::shared_ptr<GLRenderContext> getRenderContext(int64_t instanceId) {
    std::lock_guard<std::mutex> lock(g_renderMutex);
    auto it = g_renderContexts.find(instanceId);
    if (it == g_renderContexts.end()) return nullptr;
    return it->second;
}

// ==================== Public C API Declarations ====================
extern "C" void mpv_render_frame_for_instance(int64_t instanceId);
extern "C" void mpv_request_render(int64_t instanceId);
extern "C" void mpv_set_force_black_mode(int64_t instanceId, int enabled);
extern "C" void mpv_set_hdr_mode(int64_t instanceId, int enabled);

// ==================== OpenGL Render Layer ====================
/**
 * MPV OpenGL Render Layer
 *
 * Inherits from CAOpenGLLayer, implements core video rendering logic.
 * Includes render scheduling, HDR support, render throttling, etc.
 */
@interface MPVOpenGLLayer : CAOpenGLLayer
@property(nonatomic, assign) GLRenderContext *renderCtx;
@end

@implementation MPVOpenGLLayer
- (BOOL)canDrawInCGLContext:(CGLContextObj)ctx
                pixelFormat:(CGLPixelFormatObj)pf
               forLayerTime:(CFTimeInterval)t
                displayTime:(const CVTimeStamp *)ts {
    (void)ctx;
    (void)pf;
    (void)t;
    (void)ts;
    GLRenderContext *rc = self.renderCtx;
    if (!rc) return NO;

    // Load atomics once to reduce repeated access
    bool isDestroying = rc->isDestroying.load();
    if (isDestroying) return NO;
    if (!rc->mpvRenderCtx) return YES;

    // In JavaScript-driven mode, only allow rendering when displayScheduled is true
    // displayScheduled is set by mpv_request_render, indicating JS requested rendering
    bool jsDrivenMode = rc->jsDrivenRenderMode.load();
    if (jsDrivenMode) {
        bool displayScheduled = rc->displayScheduled.load();
        bool needRedraw = rc->needRedraw.load();
        return displayScheduled && needRedraw;
    }

    return rc->needRedraw.load();
}

- (void)drawInCGLContext:(CGLContextObj)ctx
             pixelFormat:(CGLPixelFormatObj)pf
            forLayerTime:(CFTimeInterval)t
             displayTime:(const CVTimeStamp *)ts {
    (void)pf;
    (void)t;
    (void)ts;

    GLRenderContext *rc = self.renderCtx;
    if (!rc || !ctx) return;

    // Load atomics at once
    bool isDestroying = rc->isDestroying.load();
    if (isDestroying) return;

    ScopedCGLock lock(ctx);
    CGLSetCurrentContext(ctx);

    rc->needRedraw.store(false);
    rc->displayScheduled.store(false);

    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    if (!rc->mpvRenderCtx) {
        glFlush();
        return;
    }

    // Persistent black screen mode (controlled by JS during loadFile)
    bool forceBlackMode = rc->forceBlackMode.load();
    if (forceBlackMode) {
        rc->forceBlackFrame.store(false);
        glFlush();
        return;
    }

    uint64_t nowMs = (uint64_t)(CACurrentMediaTime() * 1000.0);
    rc->lastRenderTimeMs.store(nowMs);

    // Async HDR/frame rate update: first frame (lastHdrUpdateMs==0) or every 1 second check.
    // Does not interrupt current frame rendering; property changes are only seen by mpv on the next frame.
    uint64_t lastHdrMs = rc->lastHdrUpdateMs.load();
    if (lastHdrMs == 0 || nowMs - lastHdrMs > 1000) {
        rc->lastHdrUpdateMs.store(nowMs);
        int64_t capturedId = rc->instanceId;
        dispatch_async(dispatch_get_main_queue(), ^{
            std::shared_ptr<GLRenderContext> asyncRc = getRenderContext(capturedId);
            if (asyncRc && !asyncRc->isDestroying.load()) {
                double estimatedFps = 0.0;
                if (asyncRc->mpvHandle) {
                    int err = mpv_get_property(asyncRc->mpvHandle, "estimated-vf-fps", MPV_FORMAT_DOUBLE, &estimatedFps);
                    if (err >= 0 && estimatedFps > 0.1) {
                        asyncRc->videoFps.store(estimatedFps);
                    } else {
                        double containerFps = 0.0;
                        if (mpv_get_property(asyncRc->mpvHandle, "container-fps", MPV_FORMAT_DOUBLE, &containerFps) >= 0 && containerFps > 0.1) {
                            asyncRc->videoFps.store(containerFps);
                        }
                    }
                }
                update_hdr_mode(asyncRc.get());
            }
        });
    }

    // Single frame blackout (one-shot, set by other code paths)
    bool forceBlackFrame = rc->forceBlackFrame.load();
    if (forceBlackFrame) {
        rc->forceBlackFrame.store(false);
        glFlush();
        return;
    }

    GLint fboBinding = 0;
    glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &fboBinding);

    GLint viewport[4] = {0, 0, 0, 0};
    glGetIntegerv(GL_VIEWPORT, viewport);
    int w = (int)viewport[2];
    int h = (int)viewport[3];
    if (w <= 0 || h <= 0) {
        glFlush();
        return;
    }

    {
        std::lock_guard<std::mutex> sl(rc->sizeMutex);
        rc->width = w;
        rc->height = h;
    }

    mpv_opengl_fbo fbo;
    memset(&fbo, 0, sizeof(fbo));
    fbo.fbo = fboBinding != 0 ? (int)fboBinding : 0;
    fbo.w = w;
    fbo.h = h;
    // Tell mpv the real internal format of the FBO
    // CA's FBO is actually GL_RGBA16F (64-bit float pixel format)
    fbo.internal_format = rc->fboInternalFormat;

    int flip_y = 1;

    int block_for_target_time = 0;

    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_OPENGL_FBO, &fbo },
        { MPV_RENDER_PARAM_FLIP_Y, &flip_y },
        { MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block_for_target_time },
        { MPV_RENDER_PARAM_INVALID, nullptr }
    };

    bool sizeChanged = (w != rc->lastRenderedWidth || h != rc->lastRenderedHeight);
    if (sizeChanged) {
        // Query actual color bit depth of CA's FBO (critical! Mismatch with what we told mpv causes jagged edges)
        GLint redBits = 0, greenBits = 0, blueBits = 0, alphaBits = 0;
        GLint componentType = 0;
        GLenum attachment = (fboBinding != 0) ? GL_COLOR_ATTACHMENT0 : GL_BACK;
        glGetFramebufferAttachmentParameteriv(GL_DRAW_FRAMEBUFFER, attachment,
            GL_FRAMEBUFFER_ATTACHMENT_RED_SIZE, &redBits);
        glGetFramebufferAttachmentParameteriv(GL_DRAW_FRAMEBUFFER, attachment,
            GL_FRAMEBUFFER_ATTACHMENT_GREEN_SIZE, &greenBits);
        glGetFramebufferAttachmentParameteriv(GL_DRAW_FRAMEBUFFER, attachment,
            GL_FRAMEBUFFER_ATTACHMENT_BLUE_SIZE, &blueBits);
        glGetFramebufferAttachmentParameteriv(GL_DRAW_FRAMEBUFFER, attachment,
            GL_FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE, &alphaBits);
        glGetFramebufferAttachmentParameteriv(GL_DRAW_FRAMEBUFFER, attachment,
            GL_FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE, &componentType);
        // 0x1406=GL_FLOAT, 0x140B=GL_HALF_FLOAT, 0x1403=GL_UNSIGNED_SHORT, 0x1401=GL_UNSIGNED_BYTE
        const char *typeStr = "unknown";
        if (componentType == GL_FLOAT) typeStr = "FLOAT";
        else if (componentType == 0x140B) typeStr = "HALF_FLOAT";
        else if (componentType == 0x8D70) typeStr = "UNSIGNED_NORMALIZED";  // GL_UNSIGNED_NORMALIZED
        else if (componentType == 0x8F9C) typeStr = "SIGNED_NORMALIZED";    // GL_SIGNED_NORMALIZED

        // CGFloat scale = self.contentsScale;
        // NSLog(@"[mpv_render_gl] Render %dx%d, FBO=%d, told_mpv=0x%X, actual=R%dG%dB%dA%d(%s), contentsScale=%.1f",
        //       w, h, fbo.fbo, fbo.internal_format,
        //       redBits, greenBits, blueBits, alphaBits, typeStr, scale);
    }

    // Remove manual RunLoop call:
    // Rendering should run efficiently on a dedicated thread (CVDisplayLink), should not try to handle main thread events.
    // Let the main thread (Electron UI) have exclusive CPU time slice for best UI responsiveness.
    // CFRunLoopRef runLoop = CFRunLoopGetCurrent();
    // if (runLoop) {
    //    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.0, false);
    // }

    int res = mpv_render_context_render(rc->mpvRenderCtx, params);
    if (res < 0) {
        NSLog(@"[mpv_render_gl] ❌ mpv_render_context_render failed: %d (win %dx%d, FBO %dx%d)",
              res, w, h, fbo.w, fbo.h);
    } else if (sizeChanged) {
        rc->lastRenderedWidth = w;
        rc->lastRenderedHeight = h;
    }

    glFlush();
}

- (CGLPixelFormatObj)copyCGLPixelFormatForDisplayMask:(uint32_t)mask {
    (void)mask;
    GLRenderContext *rc = self.renderCtx;
    if (!rc || !rc->cglPixelFormat) return [super copyCGLPixelFormatForDisplayMask:mask];
    CGLRetainPixelFormat(rc->cglPixelFormat);
    return rc->cglPixelFormat;
}

- (CGLContextObj)copyCGLContextForPixelFormat:(CGLPixelFormatObj)pf {
    (void)pf;
    GLRenderContext *rc = self.renderCtx;
    if (!rc || !rc->cglContext) return [super copyCGLContextForPixelFormat:pf];
    CGLRetainContext(rc->cglContext);
    return rc->cglContext;
}
@end

// ------------------ helper: dlsym for mpv GL ------------------
static void *get_proc_address(void *ctx, const char *name) {
    (void)ctx;
    return dlsym(RTLD_DEFAULT, name);
}

// ==================== Helper Functions: Thread Management ====================
/**
 * Check if running on main thread
 */
static bool isMainThread() {
    return [NSThread isMainThread];
}

/**
 * Execute code block asynchronously on main thread
 */
static void runOnMainAsync(dispatch_block_t block) {
    if (!block) return;
    if (isMainThread()) {
        block();
    } else {
        dispatch_async(dispatch_get_main_queue(), block);
    }
}

// ==================== MPV Callback Functions ====================
/**
 * MPV redraw callback
 *
 * Called by MPV on any thread. Note: OpenGL operations must not be performed here.
 */
static void on_mpv_redraw(void *ctx) {
    int64_t instanceId = (int64_t)(intptr_t)ctx;
    std::shared_ptr<GLRenderContext> rc = getRenderContext(instanceId);
    if (!rc || rc->isDestroying.load()) return;

    rc->needRedraw.store(true);

    if (rc->isNonAccelerated) {
        // Non-accelerated path: directly wake dedicated render thread
        {
            std::lock_guard<std::mutex> lk(rc->renderMutex);
            rc->renderRequested.store(true);
        }
        rc->renderCV.notify_one();
        return;
    }

    // Accelerated path (original logic)
    // In JavaScript-driven mode, only mark needRedraw, do not trigger rendering automatically
    // Rendering is controlled by the JavaScript render loop
    if (!rc->jsDrivenRenderMode.load()) {
        // In CVDisplayLink-driven mode, can trigger rendering automatically
        // But don't trigger here, let the DisplayLink callback handle it
    }
}

// ==================== CVDisplayLink Callback ====================
/**
 * CVDisplayLink callback function
 *
 * Called by CVDisplayLink on display refresh (typically 60Hz or 120Hz).
 * This callback must be very lightweight and must not block the main thread, otherwise Electron UI responsiveness is affected.
 *
 * Key to Electron render synchronization:
 * 1. Only perform necessary operations (report_swap and mark need render)
 * 2. Do not perform actual rendering here (rendering happens asynchronously in drawInCGLContext)
 * 3. Use async dispatch to let Electron UI events be processed first
 */
static CVReturn DisplayLinkCallback(CVDisplayLinkRef displayLink,
                                    const CVTimeStamp *now,
                                    const CVTimeStamp *outputTime,
                                    CVOptionFlags flagsIn,
                                    CVOptionFlags *flagsOut,
                                    void *displayLinkContext) {
    GLRenderContext *rc = (GLRenderContext *)displayLinkContext;
    if (!rc) return kCVReturnSuccess;

    // Load atomics at once
    bool isDestroying = rc->isDestroying.load();
    if (isDestroying) return kCVReturnSuccess;

    @autoreleasepool {
        // Report swap completion (required for audio-video sync)
        // Even in JavaScript-driven mode, must call report_swap to maintain audio-video sync
        if (rc->mpvRenderCtx) {
            mpv_render_context_report_swap(rc->mpvRenderCtx);
        }

        // In JavaScript-driven mode, do not trigger rendering here, controlled by JavaScript
        bool jsDrivenMode = rc->jsDrivenRenderMode.load();
        if (jsDrivenMode) {
            return kCVReturnSuccess;
        }

        // CVDisplayLink-driven mode:
        // As long as mpv marks needRedraw, trigger render request.
        // mpv_request_render dispatches main thread to update layer, which triggers drawInCGLContext.
        // No need for throttling here; rely on CVDisplayLink's frequency (VSync) and mpv's own clock.
        bool needRedraw = rc->needRedraw.load();
        if (needRedraw) {
            mpv_request_render(rc->instanceId);
        }
    }
    return kCVReturnSuccess;
}

// ==================== Non-Accelerated Render Path Helpers ====================

/**
 * Create/recreate IOSurface and FBO (Non-Accelerated Render Path)
 *
 * Called on dedicated render thread or GL initialization.
 * Caller must hold CGLContext lock.
 * @return true on success, false on failure
 */
static bool createIOSurfaceAndFBO(GLRenderContext *rc, int w, int h) {
    if (!rc || w <= 0 || h <= 0) return false;

    // Release old resources
    if (rc->ioRenderFBO) { glDeleteFramebuffers(1, &rc->ioRenderFBO); rc->ioRenderFBO = 0; }
    if (rc->ioRenderTex) { glDeleteTextures(1, &rc->ioRenderTex); rc->ioRenderTex = 0; }

    {
        std::lock_guard<std::mutex> iol(rc->ioSurfaceMutex);
        if (rc->ioSurface) { CFRelease(rc->ioSurface); rc->ioSurface = nullptr; }

        // Create BGRA IOSurface (matching WindowServer/CoreAnimation expected format)
        NSDictionary *props = @{
            (__bridge NSString *)kIOSurfaceWidth:           @(w),
            (__bridge NSString *)kIOSurfaceHeight:          @(h),
            (__bridge NSString *)kIOSurfaceBytesPerElement: @4,
            (__bridge NSString *)kIOSurfaceBytesPerRow:     @(w * 4),
            (__bridge NSString *)kIOSurfaceAllocSize:       @(w * h * 4),
            (__bridge NSString *)kIOSurfacePixelFormat:     @(kCVPixelFormatType_32BGRA),
        };
        rc->ioSurface = IOSurfaceCreate((__bridge CFDictionaryRef)props);
        if (!rc->ioSurface) {
            NSLog(@"[mpv_render_gl] ❌ IOSurfaceCreate failed (%dx%d)", w, h);
            return false;
        }
        rc->ioSurfaceW = w;
        rc->ioSurfaceH = h;
    }

    // Create standard RGBA8 FBO (mpv render target, not associated with IOSurface)
    glGenFramebuffers(1, &rc->ioRenderFBO);
    glBindFramebuffer(GL_FRAMEBUFFER, rc->ioRenderFBO);

    glGenTextures(1, &rc->ioRenderTex);
    glBindTexture(GL_TEXTURE_2D, rc->ioRenderTex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, rc->ioRenderTex, 0);

    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        NSLog(@"[mpv_render_gl] ❌ Non-accel FBO incomplete: 0x%X", status);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glDeleteFramebuffers(1, &rc->ioRenderFBO); rc->ioRenderFBO = 0;
        glDeleteTextures(1, &rc->ioRenderTex); rc->ioRenderTex = 0;
        return false;
    }
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glBindTexture(GL_TEXTURE_2D, 0);

    NSLog(@"[mpv_render_gl] ✅ Non-accel IOSurface+FBO created: %dx%d", w, h);
    return true;
}

/**
 * Non-accelerated dedicated render thread main function
 *
 * Wait for signal -> render to FBO -> glReadPixels to IOSurface -> main thread updates layer.contents
 * Fully decoupled from WindowServer: CGLContext lock only on this thread, does not interfere with WindowServer compositing
 */
static void nonAccelRenderThreadFunc(std::shared_ptr<GLRenderContext> rc) {
    pthread_setname_np("mpv-nonaccel-render");

    CGLSetCurrentContext(rc->cglContext);

    while (rc->renderThreadRunning.load()) {
        {
            std::unique_lock<std::mutex> lk(rc->renderMutex);
            rc->renderCV.wait(lk, [&rc]{
                return rc->renderRequested.load() || !rc->renderThreadRunning.load();
            });
            if (!rc->renderThreadRunning.load()) break;
            rc->renderRequested.store(false);
        }

        if (rc->isDestroying.load()) break;
        if (!rc->mpvRenderCtx) continue;

        // Read target dimensions
        int w, h;
        {
            std::lock_guard<std::mutex> sl(rc->sizeMutex);
            w = rc->width;
            h = rc->height;
        }
        if (w <= 0 || h <= 0) continue;

        // Size change: rebuild IOSurface and FBO
        bool needRebuild = false;
        {
            std::lock_guard<std::mutex> iol(rc->ioSurfaceMutex);
            needRebuild = (!rc->ioSurface || rc->ioSurfaceW != w || rc->ioSurfaceH != h);
        }
        if (needRebuild) {
            CGLLockContext(rc->cglContext);
            CGLSetCurrentContext(rc->cglContext);
            bool ok = createIOSurfaceAndFBO(rc.get(), w, h);
            CGLUnlockContext(rc->cglContext);
            if (!ok) continue;
        }

        rc->needRedraw.store(false);

        // ---- Render ----
        CGLLockContext(rc->cglContext);
        CGLSetCurrentContext(rc->cglContext);

        glBindFramebuffer(GL_FRAMEBUFFER, rc->ioRenderFBO);
        glViewport(0, 0, w, h);
        glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT);

        // Black screen mode (controlled by JS during loadFile)
        bool forceBlack = rc->forceBlackMode.load() || rc->forceBlackFrame.exchange(false);
        if (!forceBlack && rc->mpvRenderCtx) {
            mpv_opengl_fbo fbo = {};
            fbo.fbo = (int)rc->ioRenderFBO;
            fbo.w = w;
            fbo.h = h;
            fbo.internal_format = GL_RGBA8;

            // flip_y=0: glReadPixels reads from Y=0 (OpenGL bottom = video top),
            // writes to IOSurface row 0 (display top), image orientation is correct.
            // CAOpenGLLayer path uses flip_y=1 because CA compositing automatically compensates for OpenGL coordinate system,
            // glReadPixels path has no such compensation, must invert.
            int flip_y = 0;
            int block = 0;
            mpv_render_param params[] = {
                { MPV_RENDER_PARAM_OPENGL_FBO,            &fbo    },
                { MPV_RENDER_PARAM_FLIP_Y,                &flip_y },
                { MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block  },
                { MPV_RENDER_PARAM_INVALID,               nullptr }
            };
            int res = mpv_render_context_render(rc->mpvRenderCtx, params);
            if (res < 0) {
                NSLog(@"[mpv_render_gl] ❌ nonAccel mpv_render_context_render: %d", res);
            }
        }

        // ---- Write to IOSurface (BGRA): glReadPixels does format conversion, no extra CPU overhead ----
        IOSurfaceRef surface = nullptr;
        {
            std::lock_guard<std::mutex> iol(rc->ioSurfaceMutex);
            if (rc->ioSurface && rc->ioSurfaceW == w && rc->ioSurfaceH == h) {
                surface = rc->ioSurface;
                CFRetain(surface);
            }
        }

        if (surface) {
            glBindFramebuffer(GL_READ_FRAMEBUFFER, rc->ioRenderFBO);
            IOSurfaceLock(surface, 0, nullptr);
            void *baseAddr = IOSurfaceGetBaseAddress(surface);
            if (baseAddr) {
                glReadPixels(0, 0, w, h, GL_BGRA, GL_UNSIGNED_INT_8_8_8_8_REV, baseAddr);
            }
            IOSurfaceUnlock(surface, 0, nullptr);
        }

        glFlush();
        CGLUnlockContext(rc->cglContext);

        // ---- Main thread updates layer.contents (pointer swap, ~1us, does not hold CGL lock) ----
        if (surface && !rc->isDestroying.load()) {
            CALayer *layer = rc->contentLayer;
            if (layer) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (!rc->isDestroying.load()) {
                        layer.contents = (__bridge id)surface;
                    }
                    CFRelease(surface);
                });
            } else {
                CFRelease(surface);
            }
        } else if (surface) {
            CFRelease(surface);
        }

        // Notify mpv frame presented (audio-video sync)
        if (rc->mpvRenderCtx) {
            mpv_render_context_report_swap(rc->mpvRenderCtx);
        }
    }

    CGLSetCurrentContext(nullptr);
    NSLog(@"[mpv_render_gl] Non-accel render thread exited");
}

// ==================== Render Context Lifecycle Management ====================
/**
 * Create OpenGL render context for a view
 *
 * Must be called on the main thread.
 *
 * @param rc Render context
 * @return true on success, false on failure
 */
static bool createGLForView(GLRenderContext *rc) {
    if (!rc || !rc->view) return false;

    if (![rc->view wantsLayer]) {
        [rc->view setWantsLayer:YES];
    }
    if ([rc->view respondsToSelector:@selector(setLayerContentsRedrawPolicy:)]) {
        rc->view.layerContentsRedrawPolicy = NSViewLayerContentsRedrawDuringViewResize;
    }

    CGLPixelFormatObj pix = nil;
    GLint npix = 0;
    // Note: Do not use kCGLPFADoubleBuffer because CAOpenGLLayer manages double buffering itself
    // Use kCGLPFASupportsAutomaticGraphicsSwitching for multi-GPU switching support

    // 1st attempt: 64-bit float color (HDR / wide gamut)
    CGLPixelFormatAttribute attrsFloat[] = {
        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
        kCGLPFAColorSize, (CGLPixelFormatAttribute)64,
        kCGLPFAColorFloat,
        kCGLPFADepthSize, (CGLPixelFormatAttribute)16,
        kCGLPFAAccelerated,
        kCGLPFANoRecovery,
        kCGLPFASupportsAutomaticGraphicsSwitching,
        (CGLPixelFormatAttribute)0
    };
    bool useFloatFbo = false;
    CGLError err = CGLChoosePixelFormat(attrsFloat, &pix, &npix);
    if (err == kCGLNoError && pix) {
        useFloatFbo = true;
        NSLog(@"[mpv_render_gl] Using 64-bit float pixel format (GL_RGBA16F)");
    } else {
        NSLog(@"[mpv_render_gl] Float pixel format failed (err=%d), trying 32-bit accelerated", err);
        // 2nd attempt: hardware accelerated + 32-bit color (most common success path)
        CGLPixelFormatAttribute attrsAccel[] = {
            kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
            kCGLPFAColorSize, (CGLPixelFormatAttribute)32,
            kCGLPFADepthSize, (CGLPixelFormatAttribute)16,
            kCGLPFAAccelerated,
            kCGLPFANoRecovery,
            kCGLPFASupportsAutomaticGraphicsSwitching,
            (CGLPixelFormatAttribute)0
        };
        err = CGLChoosePixelFormat(attrsAccel, &pix, &npix);
        if (err != kCGLNoError || !pix) {
            NSLog(@"[mpv_render_gl] Accelerated pixel format failed (err=%d), trying without kCGLPFANoRecovery", err);
            // 3rd attempt: accelerated without NoRecovery
            CGLPixelFormatAttribute attrsAccel2[] = {
                kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
                kCGLPFAColorSize, (CGLPixelFormatAttribute)32,
                kCGLPFADepthSize, (CGLPixelFormatAttribute)16,
                kCGLPFAAccelerated,
                kCGLPFASupportsAutomaticGraphicsSwitching,
                (CGLPixelFormatAttribute)0
            };
            err = CGLChoosePixelFormat(attrsAccel2, &pix, &npix);
            if (err != kCGLNoError || !pix) {
                NSLog(@"[mpv_render_gl] All accelerated attempts failed (err=%d), trying minimal accelerated", err);
                // 4th attempt: minimal accelerated
                CGLPixelFormatAttribute attrsMinAccel[] = {
                    kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
                    kCGLPFAAccelerated,
                    (CGLPixelFormatAttribute)0
                };
                err = CGLChoosePixelFormat(attrsMinAccel, &pix, &npix);
                if (err != kCGLNoError || !pix) {
                    NSLog(@"[mpv_render_gl] All accelerated attempts failed (err=%d), trying non-accelerated 3.2 Core", err);
                    // 5th attempt: non-accelerated 3.2 Core (VM / software renderer)
                    CGLPixelFormatAttribute attrsNoAccel[] = {
                        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
                        kCGLPFAColorSize, (CGLPixelFormatAttribute)32,
                        kCGLPFADepthSize, (CGLPixelFormatAttribute)16,
                        (CGLPixelFormatAttribute)0
                    };
                    err = CGLChoosePixelFormat(attrsNoAccel, &pix, &npix);
                    if (err != kCGLNoError || !pix) {
                        NSLog(@"[mpv_render_gl] 3.2 Core non-accelerated failed (err=%d), trying Legacy profile", err);
                        // 6th attempt: Legacy OpenGL 2.1 (VirtualBox / oldest fallback)
                        CGLPixelFormatAttribute attrsLegacy[] = {
                            kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_Legacy,
                            kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
                            kCGLPFADepthSize, (CGLPixelFormatAttribute)16,
                            (CGLPixelFormatAttribute)0
                        };
                        err = CGLChoosePixelFormat(attrsLegacy, &pix, &npix);
                        if (err != kCGLNoError || !pix) {
                            NSLog(@"[mpv_render_gl] All pixel format attempts failed (err=%d), cannot create GL context", err);
                            return false;
                        }
                        NSLog(@"[mpv_render_gl] Using Legacy OpenGL profile fallback (VM/software renderer)");
                        rc->isNonAccelerated = true;
                    } else {
                        NSLog(@"[mpv_render_gl] Using non-accelerated 3.2 Core pixel format fallback");
                        rc->isNonAccelerated = true;
                    }
                } else {
                    NSLog(@"[mpv_render_gl] Using minimal accelerated pixel format");
                }
            }
        }
    }
    rc->fboInternalFormat = useFloatFbo ? GL_RGBA16F : GL_RGBA8;

    CGLContextObj cglCtx = nil;
    err = CGLCreateContext(pix, nil, &cglCtx);
    if (err != kCGLNoError || !cglCtx) {
        CGLReleasePixelFormat(pix);
        return false;
    }

    GLint swapInt = 1;
    CGLSetParameter(cglCtx, kCGLCPSwapInterval, &swapInt);
    if (!rc->isNonAccelerated) {
        // Accelerated path: enable GL multi-thread engine for better render performance
        CGLError mpErr = CGLEnable(cglCtx, kCGLCEMPEngine);
        if (mpErr != kCGLNoError) {
            NSLog(@"[mpv_render_gl] kCGLCEMPEngine not supported (err=%d), continuing without multi-threaded GL", mpErr);
        }
    } else {
        // Non-accelerated path disables kCGLCEMPEngine:
        // Software rendering gets no performance benefit, and it creates an OpenGLMT pack thread.
        // The pack thread shares the same GL context with the dedicated render thread (Thread 46) causing race -> SIGBUS (PAC failure).
        NSLog(@"[mpv_render_gl] Non-accel: skipping kCGLCEMPEngine to avoid OpenGLMT pack thread conflict");
    }
    CGLSetCurrentContext(cglCtx);

    rc->cglContext = cglCtx;
    rc->cglPixelFormat = pix;

    if (rc->isNonAccelerated) {
        // ---- Non-accelerated path: plain CALayer + IOSurface, no CAOpenGLLayer ----
        rc->fboInternalFormat = GL_RGBA8; // Non-accelerated path fixed RGBA8
        CALayer *layer = [[CALayer alloc] init];
        layer.opaque = YES;
        layer.backgroundColor = [[NSColor blackColor] CGColor];
        layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
        layer.contentsGravity = kCAGravityResize;
        CGFloat scale = 1.0;
        if (rc->view.window) {
            scale = rc->view.window.backingScaleFactor;
        } else {
            NSScreen *screen = [NSScreen mainScreen];
            if (screen) scale = screen.backingScaleFactor;
        }
        layer.contentsScale = scale > 0 ? scale : 1.0;
        [rc->view setLayer:layer];
        layer.frame = rc->view.bounds;
        rc->contentLayer = layer;
        NSLog(@"[mpv_render_gl] Non-accel: using plain CALayer + IOSurface render path");
    } else {
        // ---- Accelerated path: CAOpenGLLayer (original logic unchanged) ----
        MPVOpenGLLayer *layer = [[MPVOpenGLLayer alloc] init];
        layer.renderCtx = rc;
        // Critical: enable async rendering to ensure Electron UI synchronization
        // asynchronous=YES lets Core Animation prepare render content on a background thread
        // This allows the main thread to prioritize Electron UI events (e.g., clicks, scrolling)
        layer.asynchronous = YES;
        layer.needsDisplayOnBoundsChange = YES;
        layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
        // Video layer is fully opaque — tell CA to skip alpha blending, avoid precision loss during compositing
        layer.opaque = YES;

        CGFloat scale = 1.0;
        if (rc->view.window) {
            scale = rc->view.window.backingScaleFactor;
        } else {
            NSScreen *screen = [NSScreen mainScreen];
            if (screen) scale = screen.backingScaleFactor;
        }
        if (scale <= 0.0) scale = 1.0;
        layer.contentsScale = scale;

        [rc->view setLayer:layer];
        layer.frame = rc->view.bounds;

        rc->glLayer = layer;
    }

    // Read initial backing size on main thread
    @try {
        NSRect bounds = [rc->view bounds];
        NSSize backing = [rc->view convertSizeToBacking:bounds.size]; // consider Retina
        int initialW = (int)backing.width;
        int initialH = (int)backing.height;
        if (initialW <= 0 || initialH <= 0) {
            initialW = (int)bounds.size.width;
            initialH = (int)bounds.size.height;
        }
        if (initialW <= 0) initialW = 1;
        if (initialH <= 0) initialH = 1;
        {
            std::lock_guard<std::mutex> sl(rc->sizeMutex);
            rc->width = initialW;
            rc->height = initialH;
        }
        // NSLog(@"[mpv_render_gl] GL context created, initial pixel size %dx%d", rc->width, rc->height);
    } @catch (NSException *ex) {
        // NSLog(@"[mpv_render_gl] Warning: failed to read initial view size");
    }

    // init mpv render context (GL) using this OpenGL context
    // Re-ensure CGL context is the active context of the current thread
    // setLayer: may trigger Core Animation to switch context, causing mpv's glGetString call to return NULL
    CGLSetCurrentContext(rc->cglContext);

    mpv_opengl_init_params gl_init_params = {};
    gl_init_params.get_proc_address = get_proc_address;
    gl_init_params.get_proc_address_ctx = nullptr;

    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_API_TYPE, (void*)MPV_RENDER_API_TYPE_OPENGL },
        { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params },
        { MPV_RENDER_PARAM_INVALID, nullptr }
    };

    int createErr = mpv_render_context_create(&rc->mpvRenderCtx, rc->mpvHandle, params);
    if (createErr < 0) {
        NSLog(@"[mpv_render_gl] ❌ mpv_render_context_create failed: %d", createErr);
        if (rc->glLayer) {
            MPVOpenGLLayer *layer = (MPVOpenGLLayer *)rc->glLayer;
            layer.renderCtx = nullptr;
            [layer release];
            rc->glLayer = nil;
        }
        if (rc->cglContext) {
            CGLSetCurrentContext(nil);
            CGLReleaseContext(rc->cglContext);
            rc->cglContext = nil;
        }
        if (rc->cglPixelFormat) {
            CGLReleasePixelFormat(rc->cglPixelFormat);
            rc->cglPixelFormat = nil;
        }
        return false;
    }

    mpv_render_context_set_update_callback(rc->mpvRenderCtx, on_mpv_redraw, (void*)(intptr_t)rc->instanceId);
    set_render_icc_profile(rc);

    // Initialize default SDR color space configuration
    // This ensures correct color space settings even when the first opened video is SDR
    init_default_sdr_config(rc);

    if (!rc->isNonAccelerated) {
        // Accelerated path: use CVDisplayLink to drive render pacing
        // Setup CVDisplayLink (for mpv_render_context_report_swap timing)
        CVReturn cvRet = CVDisplayLinkCreateWithActiveCGDisplays(&rc->displayLink);
        if (cvRet == kCVReturnSuccess) {
            CVDisplayLinkSetOutputCallback(rc->displayLink, DisplayLinkCallback, rc);
            CVDisplayLinkSetCurrentCGDisplayFromOpenGLContext(rc->displayLink, rc->cglContext, rc->cglPixelFormat);
            CVDisplayLinkStart(rc->displayLink);
            // NSLog(@"[mpv_render_gl] CVDisplayLink started");
        } else {
            NSLog(@"[mpv_render_gl] Failed to create CVDisplayLink: %d", cvRet);
        }
    } else {
        // Non-accelerated path: no CVDisplayLink (rendering is event-driven on dedicated thread)
        // Initialize IOSurface + FBO (render thread started by upper layer after registration)
        int initW = 0, initH = 0;
        {
            std::lock_guard<std::mutex> sl(rc->sizeMutex);
            initW = rc->width;
            initH = rc->height;
        }
        if (initW > 0 && initH > 0) {
            createIOSurfaceAndFBO(rc, initW, initH);
        }
        NSLog(@"[mpv_render_gl] Non-accel: IOSurface path initialized, render thread will start after registration");
    }

    // Listen for window cross-screen events, re-evaluate HDR mode and ICC configuration.
    // Replaces the previous 250ms periodic polling, only triggers on display change.
    int64_t capturedId = rc->instanceId;
    rc->screenObserver = [[NSNotificationCenter defaultCenter]
        addObserverForName:NSWindowDidChangeScreenNotification
                    object:nil
                     queue:[NSOperationQueue mainQueue]
                usingBlock:^(NSNotification * _Nonnull note) {
        std::shared_ptr<GLRenderContext> obsRc = getRenderContext(capturedId);
        if (!obsRc || obsRc->isDestroying.load()) return;
        // Check if window matches
        if (note.object != obsRc->view.window) return;
        // Non-accelerated path: VM has no real screen change, ICC/HDR update is pointless.
        // More importantly: set_render_icc_profile triggers GL operations on the main thread,
        // competing with the dedicated render thread for the same GL context -> crash. Just trigger a redraw.
        if (obsRc->isNonAccelerated) {
            mpv_request_render(capturedId);
            return;
        }
        // Reset HDR cache, trigger isFirstCall warmup to re-evaluate
        obsRc->lastHdrUpdateMs.store(0);
        obsRc->lastHdrPrimaries.clear();
        obsRc->lastHdrGamma.clear();
        // Update ICC profile (new display may have different ICC)
        set_render_icc_profile(obsRc.get());
        mpv_request_render(capturedId);
    }];

    return true;
}

/**
 * Destroy OpenGL render context
 *
 * Release all render resources, including OpenGL context, render layer, etc.
 *
 * @param rc Render context (shared_ptr)
 */
static void destroyGL(std::shared_ptr<GLRenderContext> rc) {
    if (!rc) return;

    rc->isDestroying.store(true);

    // Stop non-accelerated dedicated render thread (before releasing GL resources)
    if (rc->isNonAccelerated && rc->renderThreadRunning.load()) {
        {
            std::lock_guard<std::mutex> lk(rc->renderMutex);
            rc->renderThreadRunning.store(false);
            rc->renderRequested.store(true);
        }
        rc->renderCV.notify_one();
        if (rc->renderThread.joinable()) {
            rc->renderThread.join();
        }
    }

    // Unregister cross-screen notification
    if (rc->screenObserver) {
        [[NSNotificationCenter defaultCenter] removeObserver:rc->screenObserver];
        rc->screenObserver = nil;
    }

    // Stop DisplayLink
    if (rc->displayLink) {
        CVDisplayLinkStop(rc->displayLink);
        CVDisplayLinkRelease(rc->displayLink);
        rc->displayLink = nullptr;
    }

    // release GL resources (must be on main thread and in the correct OpenGL context)
    // Critical: mpv_render_context_free calls OpenGL functions, must be executed in the correct context
    auto cleanupBlock = ^{
        @autoreleasepool {
            // Set OpenGL context (if exists)
            CGLContextObj savedContext = nil;
            if (rc->cglContext) {
                CGLLockContext(rc->cglContext);
                savedContext = CGLGetCurrentContext();
                CGLSetCurrentContext(rc->cglContext);
            }

            // Free mpv render context (must be in correct OpenGL context)
            if (rc->mpvRenderCtx) {
                mpv_render_context_set_update_callback(rc->mpvRenderCtx, nullptr, nullptr);
                mpv_render_context_free(rc->mpvRenderCtx);
                rc->mpvRenderCtx = nullptr;
            }

            // Restore previous context
            if (rc->cglContext) {
                CGLSetCurrentContext(savedContext);
                CGLUnlockContext(rc->cglContext);
            }

            // Disconnect layer from view first, then release layer
            if (rc->glLayer && rc->view) {
                MPVOpenGLLayer *layer = (MPVOpenGLLayer *)rc->glLayer;
                layer.renderCtx = nullptr;
                if (rc->view.layer == layer) {
                    rc->view.layer = nil;
                }
                [layer release];
                rc->glLayer = nil;
            } else if (rc->glLayer) {
                MPVOpenGLLayer *layer = (MPVOpenGLLayer *)rc->glLayer;
                layer.renderCtx = nullptr;
                [layer release];
                rc->glLayer = nil;
            }

            // Release non-accelerated render resources
            if (rc->isNonAccelerated && rc->cglContext) {
                CGLLockContext(rc->cglContext);
                CGLSetCurrentContext(rc->cglContext);
                if (rc->ioRenderFBO) { glDeleteFramebuffers(1, &rc->ioRenderFBO); rc->ioRenderFBO = 0; }
                if (rc->ioRenderTex) { glDeleteTextures(1, &rc->ioRenderTex); rc->ioRenderTex = 0; }
                CGLUnlockContext(rc->cglContext);
            }
            if (rc->ioSurface) { CFRelease(rc->ioSurface); rc->ioSurface = nullptr; }
            if (rc->contentLayer) {
                if (rc->view && rc->view.layer == rc->contentLayer) {
                    rc->view.layer = nil;
                }
                [rc->contentLayer release];
                rc->contentLayer = nil;
            }

            if (rc->cglContext) {
                CGLSetCurrentContext(nil);
                CGLReleaseContext(rc->cglContext);
                rc->cglContext = nil;
            }
            if (rc->cglPixelFormat) {
                CGLReleasePixelFormat(rc->cglPixelFormat);
                rc->cglPixelFormat = nil;
            }

            if (rc->view) {
                [rc->view release];
                rc->view = nil;
            }
        }
    };

    if (isMainThread()) {
        cleanupBlock();
    } else {
        dispatch_sync(dispatch_get_main_queue(), cleanupBlock);
    }

    rc->mpvHandle = nullptr;
}

// ------------------ public: create context ------------------
/**
 * Create Video Render Context for View
 *
 * Creates OpenGL render context and render layer for the specified NSView, used for video rendering.
 *
 * @param instanceId Player instance ID
 * @param nsViewPtr NSView pointer (macOS)
 * @param mpv MPV handle
 * @return Render context pointer, nullptr on failure
 */
extern "C" GLRenderContext *mpv_create_gl_context_for_view(int64_t instanceId, void *nsViewPtr, mpv_handle *mpv) {
    if (!nsViewPtr || !mpv) return nullptr;

    auto rc = std::make_shared<GLRenderContext>();
    NSView *view = reinterpret_cast<NSView*>(nsViewPtr);
    rc->view = view;
    rc->instanceId = instanceId;
    if (rc->view) {
        [rc->view retain]; // Retain view to prevent dangling pointer

        if (![rc->view wantsLayer]) {
            [rc->view setWantsLayer:YES];
        }
    }
    rc->mpvHandle = mpv;

    // create GL layer + context and read initial size - must be on main thread
    if (!isMainThread()) {
        __block bool result = false;
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        GLRenderContext* rawRc = rc.get();
        runOnMainAsync(^{
            result = createGLForView(rawRc);
            dispatch_semaphore_signal(sem);
        });
        dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
        dispatch_release(sem);
        if (!result) {
            destroyGL(rc);
            return nullptr;
        }
    } else {
        if (!createGLForView(rc.get())) {
            destroyGL(rc);
            return nullptr;
        }
    }

    // Register to global map
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        g_renderContexts[instanceId] = rc;
    }

    // Non-accelerated path: start dedicated render thread after registration (needs shared_ptr in map)
    if (rc->isNonAccelerated) {
        std::shared_ptr<GLRenderContext> rcShared = rc;
        rc->renderThreadRunning.store(true);
        rc->renderThread = std::thread([rcShared]() {
            nonAccelRenderThreadFunc(rcShared);
        });
        NSLog(@"[mpv_render_gl] Non-accel render thread started (instanceId=%lld)", (long long)instanceId);
    }

    return rc.get();
}

// ------------------ public: destroy context ------------------
/**
 * Destroy Video Render Context
 *
 * Release all resources of the render context, including OpenGL context, render layer, etc.
 *
 * @param instanceId Player instance ID
 */
extern "C" void mpv_destroy_gl_context(int64_t instanceId) {
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
        g_renderContexts.erase(it);
    }

    if (rc) {
        destroyGL(rc);
    }
}

// ------------------ public: set window size (pixel) ------------------
/**
 * Set Render Viewport Size
 *
 * Called when window size changes, updates the render viewport pixel dimensions.
 * To avoid inconsistency between JS-side scaling factor and macOS actual backing size,
 * this does not directly use the passed width/height, but reads the actual pixel size
 * from NSView's backing size on the main thread.
 *
 * @param instanceId Player instance ID
 * @param width Window width (logical pixels, actually uses backing size)
 * @param height Window height (logical pixels, actually uses backing size)
 */
extern "C" void mpv_set_window_size(int64_t instanceId, int width, int height) {
    if (width <= 0 || height <= 0) return;

    std::shared_ptr<GLRenderContext> rc = getRenderContext(instanceId);
    if (!rc) return;

    bool wasScheduled = rc->resizeScheduled.exchange(true);
    if (wasScheduled) return;

    runOnMainAsync(^{
        rc->resizeScheduled.store(false);
        if (rc->isDestroying) return;
        if (!rc->view) return;

        int pixelW = 0;
        int pixelH = 0;

        @try {
            NSRect bounds = [rc->view bounds];
            NSSize backing = [rc->view convertSizeToBacking:bounds.size];
            pixelW = (int)backing.width;
            pixelH = (int)backing.height;
        } @catch (NSException *ex) {
            return;
        }

        if (pixelW <= 0 || pixelH <= 0) return;

        bool sizeChanged = false;
        {
            std::lock_guard<std::mutex> sl(rc->sizeMutex);
            if (rc->width != pixelW || rc->height != pixelH) {
                rc->width = pixelW;
                rc->height = pixelH;
                sizeChanged = true;
            }
        }

        if (sizeChanged) {
            rc->needRedraw.store(true);
            if (rc->isNonAccelerated) {
                // Non-accelerated path: wake render thread, which will detect size change and rebuild IOSurface
                {
                    std::lock_guard<std::mutex> lk(rc->renderMutex);
                    rc->renderRequested.store(true);
                }
                rc->renderCV.notify_one();
                // Synchronously update contentLayer frame (on main thread, already on main thread)
                if (rc->contentLayer) {
                    rc->contentLayer.frame = rc->view.bounds;
                    CGFloat scale = rc->view.window ? rc->view.window.backingScaleFactor : [NSScreen mainScreen].backingScaleFactor;
                    rc->contentLayer.contentsScale = scale > 0 ? scale : 1.0;
                }
            } else {
                if (rc->glLayer) {
                    rc->glLayer.frame = rc->view.bounds;
                    CGFloat scale = 1.0;
                    if (rc->view.window) {
                        scale = rc->view.window.backingScaleFactor;
                    } else {
                        NSScreen *screen = [NSScreen mainScreen];
                        if (screen) scale = screen.backingScaleFactor;
                    }
                    if (scale <= 0.0) scale = 1.0;
                    rc->glLayer.contentsScale = scale;
                    [rc->glLayer setNeedsDisplay];
                }
            }
        }
    });
}

/**
 * Request Render
 *
 * Request to render a video frame. Rendering is controlled by the render loop, this function only marks need to render.
 *
 * @param instanceId Player instance ID
 */
extern "C" void mpv_request_render(int64_t instanceId) {
    std::shared_ptr<GLRenderContext> rc = getRenderContext(instanceId);
    if (!rc || rc->isDestroying.load()) return;

    rc->needRedraw.store(true);

    if (rc->isNonAccelerated) {
        // Non-accelerated path: wake dedicated render thread
        {
            std::lock_guard<std::mutex> lk(rc->renderMutex);
            rc->renderRequested.store(true);
        }
        rc->renderCV.notify_one();
        return;
    }

    // Accelerated path
    bool wasScheduled = rc->displayScheduled.exchange(true);
    if (wasScheduled) return;

    if (rc->glLayer) {
        [rc->glLayer setNeedsDisplay];
    }
}

// ------------------ render entry (exposed) ------------------
/**
 * Request Render Video Frame
 *
 * Called from render thread (background thread, not main thread), requests to render a video frame.
 * Actual rendering is controlled by the render loop.
 *
 * @param instanceId Player instance ID
 */
extern "C" void mpv_render_frame_for_instance(int64_t instanceId) {
    mpv_request_render(instanceId);
}

// ------------------ JavaScript-Driven Render Mode Control ------------------
/**
 * Set JavaScript-Driven Render Mode
 *
 * Controls whether rendering is driven by JavaScript (e.g. requestAnimationFrame) or by CVDisplayLink automatically.
 *
 * @param instanceId Player instance ID
 * @param enabled 1 = JavaScript-driven mode (rendering controlled by JS), 0 = CVDisplayLink-driven mode (default)
 */
extern "C" void mpv_set_js_driven_render_mode(int64_t instanceId, int enabled) {
    std::shared_ptr<GLRenderContext> rc = getRenderContext(instanceId);
    if (!rc || rc->isDestroying.load()) return;

    bool jsMode = (enabled != 0);
    bool wasJsMode = rc->jsDrivenRenderMode.exchange(jsMode);

    if (jsMode != wasJsMode) {
        // NSLog(@"[mpv_render_gl] JavaScript-driven render mode: %s", jsMode ? "enabled" : "disabled");

        // If switching to JavaScript-driven mode, trigger a render immediately
        // So JavaScript can start controlling the render loop right away
        if (jsMode) {
            rc->needRedraw.store(true);
            mpv_request_render(instanceId);
        }
    }
}

/**
 * Get JavaScript-Driven Render Mode
 *
 * @param instanceId Player instance ID
 * @return 1 = JavaScript-driven mode, 0 = CVDisplayLink-driven mode
 */
extern "C" int mpv_get_js_driven_render_mode(int64_t instanceId) {
    std::shared_ptr<GLRenderContext> rc = getRenderContext(instanceId);
    if (!rc || rc->isDestroying.load()) return 0;

    return rc->jsDrivenRenderMode.load() ? 1 : 0;
}

/**
 * Set Blackout Mode
 *
 * Enable or disable forced black screen mode, used to display black screen when paused.
 *
 * @param instanceId Player instance ID
 * @param enabled 1 = enable blackout, 0 = disable blackout
 */
extern "C" void mpv_set_force_black_mode(int64_t instanceId, int enabled) {
    std::shared_ptr<GLRenderContext> rc = getRenderContext(instanceId);
    if (!rc || rc->isDestroying.load()) return;

    rc->forceBlackMode.store(enabled != 0);
    mpv_request_render(instanceId);
}

/**
 * Set HDR Mode
 *
 * Enable or disable HDR rendering mode. Configuration is applied immediately when toggling HDR in paused state.
 *
 * @param instanceId Player instance ID
 * @param enabled 1 = enable HDR, 0 = disable HDR (use SDR)
 */
extern "C" void mpv_set_hdr_mode(int64_t instanceId, int enabled) {
    std::shared_ptr<GLRenderContext> rc = getRenderContext(instanceId);
    if (!rc || rc->isDestroying.load()) return;

    rc->hdrUserEnabled.store(enabled != 0);
    rc->lastHdrUpdateMs.store(0);

    // Invalidate cached state to ensure update_hdr_mode does not early return due to state match.
    // Invert hdrActive to guarantee shouldEnable != hdrActive, then update_hdr_mode will set it back to the correct value.
    rc->hdrActive = !(enabled != 0);
    rc->lastHdrPrimaries.clear();
    rc->lastHdrGamma.clear();

    // Apply HDR configuration immediately (on the main thread). update_hdr_mode needs to access NSView, must run on main thread.
    if (isMainThread()) {
        update_hdr_mode(rc.get());
        mpv_request_render(instanceId);
    } else {
        dispatch_sync(dispatch_get_main_queue(), ^{
            std::shared_ptr<GLRenderContext> inner = getRenderContext(instanceId);
            if (inner && !inner->isDestroying.load()) {
                update_hdr_mode(inner.get());
                mpv_request_render(instanceId);
            }
        });
    }
}

// ------------------ HDR Debug Functions ------------------
/**
 * Debug HDR Status
 *
 * Output detailed information about the current HDR configuration, for debugging.
 *
 * @param instanceId Player instance ID
 */
extern "C" void mpv_debug_hdr_status(int64_t instanceId) {
    std::shared_ptr<GLRenderContext> rc = getRenderContext(instanceId);
    if (!rc || !rc->mpvHandle) return;

    // Get current video params
    char *primaries = mpv_get_property_string(rc->mpvHandle, "video-params/primaries");
    char *gamma = mpv_get_property_string(rc->mpvHandle, "video-params/gamma");
    double sigPeak = 0.0;
    mpv_get_property(rc->mpvHandle, "video-params/sig-peak", MPV_FORMAT_DOUBLE, &sigPeak);

    // Get current mpv configuration
    char *targetPrim = mpv_get_property_string(rc->mpvHandle, "target-prim");
    char *targetTrc = mpv_get_property_string(rc->mpvHandle, "target-trc");
    char *targetPeak = mpv_get_property_string(rc->mpvHandle, "target-peak");
    char *toneMapping = mpv_get_property_string(rc->mpvHandle, "tone-mapping");

    // Get display information
    CGFloat edr = 1.0;
    if (rc->view.window && rc->view.window.screen) {
        if (@available(macOS 10.15, *)) {
            edr = rc->view.window.screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
        }
    }

    NSLog(@"[mpv_hdr_debug] ======= HDR Status Debug =======");
    NSLog(@"[mpv_hdr_debug] Video params: primaries=%s, gamma=%s, sig-peak=%.2f",
          primaries ? primaries : "(null)",
          gamma ? gamma : "(null)",
          sigPeak);
    NSLog(@"[mpv_hdr_debug] MPV config: target-prim=%s, target-trc=%s, target-peak=%s, tone-mapping=%s",
          targetPrim ? targetPrim : "(null)",
          targetTrc ? targetTrc : "(null)",
          targetPeak ? targetPeak : "(null)",
          toneMapping ? toneMapping : "(null)");
    NSLog(@"[mpv_hdr_debug] Display EDR capability: %.2f", edr);
    NSLog(@"[mpv_hdr_debug] User settings: enabled=%d, active=%d",
          rc->hdrUserEnabled.load() ? 1 : 0,
          rc->hdrActive ? 1 : 0);
    NSLog(@"[mpv_hdr_debug] ================================");

    // Clean up memory
    if (primaries) mpv_free(primaries);
    if (gamma) mpv_free(gamma);
    if (targetPrim) mpv_free(targetPrim);
    if (targetTrc) mpv_free(targetTrc);
    if (targetPeak) mpv_free(targetPeak);
    if (toneMapping) mpv_free(toneMapping);
}
