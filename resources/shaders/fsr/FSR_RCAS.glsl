// FidelityFX FSR1 RCAS trial preset for mpv/libplacebo
// Adaptive sharpening stage intended to run after FSR_EASU.glsl.

//!HOOK LUMA
//!BIND HOOKED
//!DESC FidelityFX FSR1 RCAS (trial)
//!WHEN OUTPUT.w OUTPUT.h * LUMA.w LUMA.h * / 1.0 >=

#define FSR_RCAS_LIMIT (0.25 - (1.0 / 16.0))
#define SHARPNESS 0.2

float FsrRcasLoad(ivec2 px) {
    return texelFetch(HOOKED_raw, clamp(px, ivec2(0), HOOKED_size - ivec2(1)), 0).r * HOOKED_mul;
}

vec4 hook() {
    ivec2 sp = ivec2(HOOKED_pos * HOOKED_size);

    float b = FsrRcasLoad(sp + ivec2(0, -1));
    float d = FsrRcasLoad(sp + ivec2(-1, 0));
    float e = FsrRcasLoad(sp);
    float f = FsrRcasLoad(sp + ivec2(1, 0));
    float h = FsrRcasLoad(sp + ivec2(0, 1));

    float nz = 0.25 * (b + d + f + h) - e;
    float localMin = min(min(b, d), min(e, min(f, h)));
    float localMax = max(max(b, d), max(e, max(f, h)));
    float range = max(localMax - localMin, 1e-4);
    nz = clamp(abs(nz) / range, 0.0, 1.0);
    nz = 1.0 - 0.5 * nz;

    float mn4 = min(min(b, f), h);
    float mx4 = max(max(b, f), h);
    float hitMin = mn4 / max(4.0 * mx4, 1e-4);
    float hitMax = (1.0 - mx4) / max(4.0 * mn4 - 4.0, -1e-4);
    float lobe = max(-hitMin, hitMax);
    lobe = max(-FSR_RCAS_LIMIT, min(lobe, 0.0)) * exp2(-SHARPNESS);
    lobe *= nz;

    float sharpened = (lobe * (b + d + h + f) + e) / (4.0 * lobe + 1.0);
    return vec4(clamp(sharpened, 0.0, 1.0), 0.0, 0.0, 1.0);
}
