/**
 * HDR / Color Management Module
 *
 * Provides HDR rendering and color space management on macOS, including:
 * - HDR mode detection and switching (update_hdr_mode)
 * - SDR default color space initialization (init_default_sdr_config)
 * - Display ICC profile application (set_render_icc_profile)
 * - Dolby Vision track detection (check_dolby_vision_track)
 * - Optimal tone mapping algorithm selection (get_optimal_tone_mapping)
 * - CALayer color space setting helpers
 */

#include "mpv_render_gl.h"
#include "mpv_hdr.h"

#include <dlfcn.h>
#include <cmath>
#include <algorithm>

// ==================== Internal helpers (HDR module only) ====================

/**
 * Look up CoreGraphics color space constant by symbol name.
 * Uses dlsym for compatibility across macOS SDK versions, avoiding direct references to potentially nonexistent symbols.
 */
static CFStringRef get_colorspace_name_by_symbol(const char *symbolName) {
    if (!symbolName) return nullptr;
    void *sym = dlsym(RTLD_DEFAULT, symbolName);
    if (!sym) return nullptr;
    CFStringRef *p = (CFStringRef *)sym;
    return p ? *p : nullptr;
}

// ==================== Public function implementations ====================

void set_layer_colorspace_if_supported(CALayer *layer, CGColorSpaceRef cs) {
    if (!layer || !cs) return;
    if ([layer respondsToSelector:@selector(setColorspace:)]) {
        typedef void (*SetColorSpaceIMP)(id, SEL, CGColorSpaceRef);
        SetColorSpaceIMP imp = (SetColorSpaceIMP)[layer methodForSelector:@selector(setColorspace:)];
        if (imp) {
            imp(layer, @selector(setColorspace:), cs);
        }
    }
}

CGColorSpaceRef create_hdr_pq_colorspace_for_primaries(const char *primaries) {
    if (!primaries) return nullptr;

    if (strcmp(primaries, "display-p3") == 0) {
        CFStringRef name = get_colorspace_name_by_symbol("kCGColorSpaceDisplayP3_PQ");
        if (!name) {
            name = get_colorspace_name_by_symbol("kCGColorSpaceDisplayP3_PQ_EOTF");
        }
        if (name) return CGColorSpaceCreateWithName(name);
        return nullptr;
    }

    if (strcmp(primaries, "bt.2020") == 0) {
        CFStringRef name = get_colorspace_name_by_symbol("kCGColorSpaceITUR_2100_PQ");
        if (!name) {
            name = get_colorspace_name_by_symbol("kCGColorSpaceITUR_2020_PQ");
        }
        if (!name) {
            name = get_colorspace_name_by_symbol("kCGColorSpaceITUR_2020_PQ_EOTF");
        }
        if (name) return CGColorSpaceCreateWithName(name);
        return nullptr;
    }

    return nullptr;
}

CALayer *get_render_layer(GLRenderContext *rc) {
    if (!rc || !rc->view) return nil;
    if (rc->glLayer) return rc->glLayer;
    return rc->view.layer;
}

/**
 * Check whether the currently selected video track is Dolby Vision
 * @param mpv MPV handle
 * @return true if the current video is Dolby Vision, false otherwise
 */
bool check_dolby_vision_track(mpv_handle *mpv) {
    if (!mpv) return false;

    mpv_node tracks;
    if (mpv_get_property(mpv, "track-list", MPV_FORMAT_NODE, &tracks) < 0) {
        return false;
    }

    bool hasDolbyVision = false;
    if (tracks.format == MPV_FORMAT_NODE_ARRAY) {
        for (int i = 0; i < tracks.u.list->num; i++) {
            mpv_node track = tracks.u.list->values[i];
            if (track.format != MPV_FORMAT_NODE_MAP) continue;

            bool is_video = false;
            bool is_selected = false;
            bool has_dv = false;

            mpv_node_list *list = track.u.list;
            for (int j = 0; j < list->num; j++) {
                char *key = list->keys[j];
                mpv_node value = list->values[j];

                if (strcmp(key, "type") == 0 && value.format == MPV_FORMAT_STRING) {
                    if (strcmp(value.u.string, "video") == 0) is_video = true;
                } else if (strcmp(key, "selected") == 0 && value.format == MPV_FORMAT_FLAG) {
                    is_selected = value.u.flag;
                } else if (strcmp(key, "dolby-vision-profile") == 0 && value.format == MPV_FORMAT_INT64) {
                    if (value.u.int64 > 0) has_dv = true;
                }
            }

            if (is_video && is_selected && has_dv) {
                hasDolbyVision = true;
                break;
            }
        }
    }

    mpv_free_node_contents(&tracks);
    return hasDolbyVision;
}

void log_hdr_config(GLRenderContext *rc) {
    if (!rc || !rc->mpvHandle) return;

    int iccAuto = -1;
    int screenshotTag = -1;
    int targetPeakInt = 0;
    char *targetPrim = nullptr;
    char *targetTrc = nullptr;
    char *targetPeakStr = nullptr;
    char *toneMapping = nullptr;

    mpv_get_property(rc->mpvHandle, "icc-profile-auto", MPV_FORMAT_FLAG, &iccAuto);
    mpv_get_property(rc->mpvHandle, "screenshot-tag-colorspace", MPV_FORMAT_FLAG, &screenshotTag);
    mpv_get_property(rc->mpvHandle, "target-peak", MPV_FORMAT_INT64, &targetPeakInt);
    targetPrim = mpv_get_property_string(rc->mpvHandle, "target-prim");
    targetTrc = mpv_get_property_string(rc->mpvHandle, "target-trc");
    targetPeakStr = mpv_get_property_string(rc->mpvHandle, "target-peak");
    toneMapping = mpv_get_property_string(rc->mpvHandle, "tone-mapping");

    const char *primariesCfg = targetPrim ? targetPrim : "(null)";
    const char *trcCfg = targetTrc ? targetTrc : "(null)";
    const char *peakCfg = targetPeakStr ? targetPeakStr : "(null)";
    const char *toneCfg = toneMapping ? toneMapping : "(null)";

    CGFloat edr = 1.0;
    NSScreen *screen = nil;
    if (rc->view && rc->view.window) {
        screen = rc->view.window.screen;
    }
    if (screen) {
        if (@available(macOS 10.15, *)) {
            edr = screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
        } else {
            edr = 1.0;
        }
    }

    BOOL wantsEDR = NO;
    CGFloat contentsScale = 0.0;
    CALayer *layer = get_render_layer(rc);
    if (layer) {
        // Only compile EDR property access when using macOS 14+ SDK to avoid old SDK compilation errors
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 140000
        if (@available(macOS 14.0, *)) {
            wantsEDR = layer.wantsExtendedDynamicRangeContent;
        }
#endif
        contentsScale = layer.contentsScale;
    }

    if (targetPrim) mpv_free(targetPrim);
    if (targetTrc) mpv_free(targetTrc);
    if (targetPeakStr) mpv_free(targetPeakStr);
    if (toneMapping) mpv_free(toneMapping);
}

const char* get_optimal_tone_mapping(mpv_handle *mpv) {
    if (check_dolby_vision_track(mpv)) {
        return "st2094-10";
    }
    return "bt.2390";
}

/**
 * Apply HDR configuration implementation
 *
 * Configures HDR rendering mode based on user settings and video parameters.
 * Includes setting layer EDR support, color space, and mpv HDR options.
 */
void update_hdr_mode(GLRenderContext *rc) {
    if (!rc || !rc->mpvHandle || !rc->view) return;

    bool userEnabled = rc->hdrUserEnabled.load();
    bool shouldEnable = false;

    char *primaries = nullptr;
    char *gamma = nullptr;
    double sigPeak = 0.0;
    int sigPeakErr = mpv_get_property(rc->mpvHandle, "video-params/sig-peak", MPV_FORMAT_DOUBLE, &sigPeak);

    int64_t signalPeak = (int64_t) sigPeak * 100;

    if (userEnabled) {
        primaries = mpv_get_property_string(rc->mpvHandle, "video-params/primaries");
        gamma = mpv_get_property_string(rc->mpvHandle, "video-params/gamma");

        if (primaries && gamma) {
            bool isHdrGamma = strcmp(gamma, "hlg") == 0 || strcmp(gamma, "pq") == 0;
            bool isSdrPrimaries = strcmp(primaries, "bt.709") == 0;

            if (isHdrGamma && !isSdrPrimaries) {
                CGFloat edr = 1.0;
                NSScreen *screen = nil;
                if (rc->view.window) {
                    screen = rc->view.window.screen;
                }
                if (screen) {
                    if (@available(macOS 10.15, *)) {
                        edr = screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
                    } else {
                        edr = 1.0;
                    }
                }
                if (edr > 1.5) {
                    shouldEnable = true;
                }
            }
        }
    }


    // Return early when state already matches, avoid redundant property changes triggering GPU shader hot recompilation.
    // On macOS ARM's Metal translation layer, redundant property resets can cause shader recompilation resulting in white screen.
    if (shouldEnable == rc->hdrActive) {
        if (shouldEnable) {
            // Both are HDR — further compare primaries and gamma,
            // detect switches like PQ->HLG (both HDR but with different parameters)
            const char *p = primaries ? primaries : "";
            const char *g = gamma ? gamma : "";
            if (rc->lastHdrPrimaries == p && rc->lastHdrGamma == g) {
                if (primaries) mpv_free(primaries);
                if (gamma) mpv_free(gamma);
                return;
            }
        } else {
            // Both are SDR, no need to reconfigure
            if (primaries) mpv_free(primaries);
            if (gamma) mpv_free(gamma);
            return;
        }
    }

    if (shouldEnable) {
        // macOS system-level HDR (EDR) setup flow:
        // Optimization: configure mpv properties first, then update layer properties to reduce flickering
        // This ensures correct configuration is used during rendering, avoiding intermediate state display

        // 1. Configure mpv HDR options first (before changing layer properties)
        // Note: icc-profile-auto must be disabled because HDR uses PQ transfer function, color conversion through ICC should not occur
        // macOS EDR system handles HDR signals directly; ICC would interfere with this process
        int iccAuto = 0;
        mpv_set_property(rc->mpvHandle, "icc-profile-auto", MPV_FORMAT_FLAG, &iccAuto);

        // Set target color space
        if (primaries) {
            mpv_set_property_string(rc->mpvHandle, "target-prim", primaries);
        } else {
            mpv_set_property_string(rc->mpvHandle, "target-prim", "auto");
        }
        mpv_set_property_string(rc->mpvHandle, "target-trc", "pq");
        mpv_set_property_string(rc->mpvHandle, "target-colorspace-hint", "yes");

        // Disable dynamic peak detection (hdr-compute-peak), let system use static peak
        // This avoids overexposure caused by dynamic detection
        int hdrComputePeak = 0;
        mpv_set_property(rc->mpvHandle, "hdr-compute-peak", MPV_FORMAT_FLAG, &hdrComputePeak);

        CGFloat edr = 1.0;
        NSScreen *screen = nil;
        if (rc->view.window) {
            screen = rc->view.window.screen;
        }
        if (screen) {
            if (@available(macOS 10.15, *)) {
                edr = screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
            } else {
                edr = 1.0;
            }
        }

        int64_t targetPeakNits = edr * 100;

        if (edr <= 1.0) {
            targetPeakNits = 100;
        }

        bool isDolbyVision = check_dolby_vision_track(rc->mpvHandle);

        if (isDolbyVision) {
            if (edr <= 2.0) {
                targetPeakNits = 350;
            } else if (edr <= 3.0) {
                targetPeakNits = 450;
            } else {
                targetPeakNits = 450;  // High EDR display (e.g. Apple XDR)
            }

            // For Dolby Vision, further limit target-peak if video sig-peak is available and low
            if (sigPeakErr >= 0 && signalPeak > 0 && signalPeak < 2000) {
                int64_t maxFromSigPeak = (int64_t)signalPeak * 0.85;
                if (maxFromSigPeak < targetPeakNits) {
                    targetPeakNits = maxFromSigPeak;
                }
                if (targetPeakNits < 400) {
                    targetPeakNits = 400;
                }
            }
        }

         // NSLog(@"[mpv_render_gl] targetPeakNits=%lld",targetPeakNits);

        bool isHdrDisplay = false;
        if (@available(macOS 12.0, *)) {
            if (screen) {
                isHdrDisplay = screen.maximumReferenceExtendedDynamicRangeColorComponentValue > 1.0;
            }
        }

        int64_t finalPeakNits;
        if (isHdrDisplay && signalPeak > 0) {
            finalPeakNits = fmax(signalPeak, targetPeakNits);
        } else {
            finalPeakNits = fmin(signalPeak, targetPeakNits);
        }

        if (![NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){14, 0, 0}]) {
            int64_t edrPeak = (int64_t)(edr * 100.0);
            if (edrPeak < 100) edrPeak = 100;
            if (edrPeak > 400) edrPeak = 400;
            if (edrPeak < finalPeakNits) finalPeakNits = edrPeak;
        }

        // NSLog(@"[mpv_render_gl] finalPeakNits=%lld isHdrDisplay=%d signalPeak=%lld targetPeakNits=%lld",
        //       finalPeakNits, isHdrDisplay, signalPeak, targetPeakNits);

        mpv_set_property(rc->mpvHandle, "target-peak", MPV_FORMAT_INT64, &finalPeakNits);

        // Explicitly set tone mapping algorithm
        // gpu-next defaults to spline, which can cause overexposure
        // Using bt.2390 (ITU-R standard) is more conservative, suitable for most HDR content
        const char *algo = get_optimal_tone_mapping(rc->mpvHandle);
        if (strcmp(algo, "st2094-10") == 0) {
            // Dolby Vision requires a specific tone mapping algorithm
            mpv_set_property_string(rc->mpvHandle, "tone-mapping", "st2094-10");
        } else {
            // For regular HDR, use bt.2390 to avoid overexposure from default spline
            mpv_set_property_string(rc->mpvHandle, "tone-mapping", "bt.2390");
        }

        // mpv_set_property_string(rc->mpvHandle, "tone-mapping", "auto");

        rc->hdrActive = true;
        rc->lastHdrPrimaries = primaries ? primaries : "";
        rc->lastHdrGamma = gamma ? gamma : "";

        // 2. Use CATransaction to batch update layer properties, reducing redraw count
        // This avoids triggering multiple redraws during property updates, reducing flickering
        CALayer *layer = get_render_layer(rc);
        if (layer) {
            [CATransaction begin];
            [CATransaction setDisableActions:YES]; // Disable animations, apply immediately
            [CATransaction setAnimationDuration:0]; // Set animation duration to 0

            // Ensure view enables layer-backed rendering
            if (![rc->view wantsLayer]) {
                [rc->view setWantsLayer:YES];
            }

            // Enable layer EDR support (macOS 14.0+)
            // Below macOS 14, CAOpenGLLayer has no corresponding API, relies on PQ colorspace + mpv target-peak control
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 140000
            if (@available(macOS 14.0, *)) {
                if (layer.wantsExtendedDynamicRangeContent != YES) {
                    layer.wantsExtendedDynamicRangeContent = YES;
                }
            }
#endif

            // Set correct HDR color space (PQ)
            CGColorSpaceRef cs = create_hdr_pq_colorspace_for_primaries(primaries);
            if (cs) {
                set_layer_colorspace_if_supported(layer, cs);
                CGColorSpaceRelease(cs);
            }

            // Ensure layer contentsScale matches window backingScaleFactor
            // Important for correct HDR rendering
            if (rc->view.window) {
                CGFloat scale = rc->view.window.backingScaleFactor;
                if (scale > 0.0 && layer.contentsScale != scale) {
                    layer.contentsScale = scale;
                }
            }

            [CATransaction commit];
        }
    } else {
        // Restore SDR mode configuration
        set_render_icc_profile(rc);
        int iccAuto = 1;
        mpv_set_property(rc->mpvHandle, "icc-profile-auto", MPV_FORMAT_FLAG, &iccAuto);

        NSScreen *screen = nil;
        if (rc->view.window) {
            screen = rc->view.window.screen;
        }

        const char *targetPrim = "bt.709";
        if (screen && screen.colorSpace) {
            NSString *csName = screen.colorSpace.localizedName;
            if ([csName containsString:@"P3"] || [csName containsString:@"Display P3"]) {
                targetPrim = "display-p3";
            }
        }

        mpv_set_property_string(rc->mpvHandle, "target-prim", targetPrim);
        mpv_set_property_string(rc->mpvHandle, "target-trc", "srgb");
        mpv_set_property_string(rc->mpvHandle, "target-peak", "auto");
        mpv_set_property_string(rc->mpvHandle, "target-colorspace-hint", "yes");
        mpv_set_property_string(rc->mpvHandle, "hdr-compute-peak", "auto");

        rc->hdrActive = false;
        rc->lastHdrPrimaries.clear();
        rc->lastHdrGamma.clear();

        // Use CATransaction to batch update layer properties, reducing redraw count
        CALayer *layer = get_render_layer(rc);
        if (layer) {
            [CATransaction begin];
            [CATransaction setDisableActions:YES]; // Disable animations, apply immediately
            [CATransaction setAnimationDuration:0]; // Set animation duration to 0

            // Disable layer EDR support (macOS 14.0+)
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 140000
            if (@available(macOS 14.0, *)) {
                if (layer.wantsExtendedDynamicRangeContent != NO) {
                    layer.wantsExtendedDynamicRangeContent = NO;
                }
            }
#endif

            CGColorSpaceRef cs = nullptr;
            NSScreen *screen2 = nil;
            if (rc->view.window) {
                screen2 = rc->view.window.screen;
            }
            if (screen2 && screen2.colorSpace) {
                cs = screen2.colorSpace.CGColorSpace;
            } else {
                cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
            }
            if (cs) {
                set_layer_colorspace_if_supported(layer, cs);
                if (!(screen2 && screen2.colorSpace && cs == screen2.colorSpace.CGColorSpace)) {
                    CGColorSpaceRelease(cs);
                }
            }

            [CATransaction commit];
        }
    }

    if (primaries) mpv_free(primaries);
    if (gamma) mpv_free(gamma);

    log_hdr_config(rc);
}

/**
 * Initialize default SDR color space configuration implementation
 *
 * Called when creating the render context, ensures correct color space settings for the first SDR video playback.
 */
void init_default_sdr_config(GLRenderContext *rc) {
    if (!rc || !rc->mpvHandle || !rc->view) return;

    // Set layer color space
    CALayer *layer = get_render_layer(rc);
    if (layer) {
        // When initializing to SDR mode, ensure EDR is off (compile only on macOS 14.0+ SDK)
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 140000
        if (@available(macOS 14.0, *)) {
            layer.wantsExtendedDynamicRangeContent = NO;
        }
#endif

        CGColorSpaceRef cs = nullptr;
        NSScreen *screen = nil;
        if (rc->view.window) {
            screen = rc->view.window.screen;
        }
        if (screen && screen.colorSpace) {
            cs = screen.colorSpace.CGColorSpace;
        } else {
            cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
        }
        if (cs) {
            set_layer_colorspace_if_supported(layer, cs);
            if (!(screen && screen.colorSpace && cs == screen.colorSpace.CGColorSpace)) {
                CGColorSpaceRelease(cs);
            }
        }
    }

    // Set default SDR mpv configuration
    int iccAuto = 1;
    mpv_set_property(rc->mpvHandle, "icc-profile-auto", MPV_FORMAT_FLAG, &iccAuto);

    NSScreen *screen = nil;
    if (rc->view.window) {
        screen = rc->view.window.screen;
    }

    // Detect display primaries (usually bt.709 or display-p3)
    const char *targetPrim = "bt.709";
    if (screen && screen.colorSpace) {
        NSString *csName = screen.colorSpace.localizedName;
        if ([csName containsString:@"P3"] || [csName containsString:@"Display P3"]) {
            targetPrim = "display-p3";
        }
    }

    // Explicitly set SDR transfer function to sRGB
    // This ensures correct gamma curve, avoiding washed-out image
    mpv_set_property_string(rc->mpvHandle, "target-prim", targetPrim);
    mpv_set_property_string(rc->mpvHandle, "target-trc", "srgb");
    mpv_set_property_string(rc->mpvHandle, "target-peak", "auto");
    mpv_set_property_string(rc->mpvHandle, "target-colorspace-hint", "yes");
    mpv_set_property_string(rc->mpvHandle, "hdr-compute-peak", "auto");
}

/**
 * Apply display ICC profile implementation
 *
 * Gets the display's ICC profile from the system and applies it to the mpv render context.
 * Used for correct color management in SDR mode.
 */
void set_render_icc_profile(GLRenderContext *rc) {
    if (!rc || !rc->mpvRenderCtx || !rc->view) return;
    NSScreen *screen = rc->view.window ? rc->view.window.screen : [NSScreen mainScreen];
    NSColorSpace *cs = (screen && screen.colorSpace) ? screen.colorSpace : [NSColorSpace sRGBColorSpace];
    NSData *icc = cs.ICCProfileData;
    if (!icc || icc.length <= 0) return;

    std::vector<uint8_t> copy;
    {
        std::lock_guard<std::mutex> lock(rc->iccMutex);
        rc->iccProfileBytes.assign((const uint8_t *)icc.bytes, (const uint8_t *)icc.bytes + icc.length);
        copy = rc->iccProfileBytes;
    }
    if (copy.empty()) return;
    mpv_byte_array arr;
    memset(&arr, 0, sizeof(arr));
    arr.data = copy.data();
    arr.size = copy.size();
    mpv_render_param param = { MPV_RENDER_PARAM_ICC_PROFILE, &arr };
    mpv_render_context_set_parameter(rc->mpvRenderCtx, param);
}
