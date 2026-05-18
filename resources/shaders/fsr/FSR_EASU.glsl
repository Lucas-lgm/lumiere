// FidelityFX FSR1 EASU trial preset for mpv/libplacebo
// Adapted from AMD FSR1 EASU logic and the reviewed ShaderToy example.
// Single-pass spatial upscaler for low-resolution content.

//!HOOK LUMA
//!BIND HOOKED
//!DESC FidelityFX FSR1 EASU (trial)
//!WHEN OUTPUT.w OUTPUT.h * LUMA.w LUMA.h * / 1.0 >
//!WIDTH OUTPUT.w
//!HEIGHT OUTPUT.h

float FsrLuma(vec4 c) {
    return c.r;
}

float FsrSample(ivec2 px) {
    return texelFetch(HOOKED_raw, clamp(px, ivec2(0), HOOKED_size - ivec2(1)), 0).r * HOOKED_mul;
}

void FsrEasuTap(
    inout float accumColor,
    inout float accumWeight,
    vec2 off,
    vec2 dir,
    vec2 len,
    float lob,
    float clp,
    float c
) {
    vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x)));
    v *= len;
    float d2 = min(dot(v, v), clp);
    float wB = 0.4 * d2 - 1.0;
    float wA = lob * d2 - 1.0;
    wB *= wB;
    wA *= wA;
    wB = 1.5625 * wB - 0.5625;
    float w = wB * wA;
    accumColor += c * w;
    accumWeight += w;
}

void FsrEasuSet(
    inout vec2 dir,
    inout float len,
    float w,
    float lA, float lB, float lC, float lD, float lE
) {
    float lenX = max(abs(lD - lC), abs(lC - lB));
    float dirX = lD - lB;
    dir.x += dirX * w;
    lenX = clamp(abs(dirX) / max(lenX, 1e-4), 0.0, 1.0);
    lenX *= lenX;
    len += lenX * w;

    float lenY = max(abs(lE - lC), abs(lC - lA));
    float dirY = lE - lA;
    dir.y += dirY * w;
    lenY = clamp(abs(dirY) / max(lenY, 1e-4), 0.0, 1.0);
    lenY *= lenY;
    len += lenY * w;
}

vec4 hook() {
    vec2 outPx = HOOKED_pos * HOOKED_size;
    vec2 srcSize = vec2(HOOKED_size);
    vec2 dstSize = vec2(OUTPUT_size);

    vec2 pp = outPx * (srcSize / dstSize) - 0.5;
    vec2 fp = floor(pp);
    vec2 sub = pp - fp;
    ivec2 base = ivec2(fp);

    float b = FsrSample(base + ivec2(0, -1));
    float c = FsrSample(base + ivec2(1, -1));
    float e = FsrSample(base + ivec2(-1, 0));
    float f = FsrSample(base + ivec2(0, 0));
    float g = FsrSample(base + ivec2(1, 0));
    float h = FsrSample(base + ivec2(2, 0));
    float i = FsrSample(base + ivec2(-1, 1));
    float j = FsrSample(base + ivec2(0, 1));
    float k = FsrSample(base + ivec2(1, 1));
    float l = FsrSample(base + ivec2(2, 1));
    float n = FsrSample(base + ivec2(0, 2));
    float o = FsrSample(base + ivec2(1, 2));

    vec2 dir = vec2(0.0);
    float len = 0.0;

    FsrEasuSet(dir, len, (1.0 - sub.x) * (1.0 - sub.y), b, e, f, g, j);
    FsrEasuSet(dir, len, sub.x * (1.0 - sub.y), c, f, g, h, k);
    FsrEasuSet(dir, len, (1.0 - sub.x) * sub.y, f, i, j, k, n);
    FsrEasuSet(dir, len, sub.x * sub.y, g, j, k, l, o);

    float dirLen2 = dot(dir, dir);
    bool zeroDir = dirLen2 < (1.0 / 32768.0);
    if (zeroDir) {
        dir = vec2(1.0, 0.0);
    } else {
        dir *= inversesqrt(dirLen2);
    }

    len = 0.5 * len;
    len *= len;
    float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
    vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    float lob = 0.5 - 0.29 * len;
    float clp = 1.0 / lob;

    float min4 = min(min(f, g), min(j, k));
    float max4 = max(max(f, g), max(j, k));

    float accum = 0.0;
    float weight = 0.0;
    FsrEasuTap(accum, weight, vec2(0, -1) - sub, dir, len2, lob, clp, b);
    FsrEasuTap(accum, weight, vec2(1, -1) - sub, dir, len2, lob, clp, c);
    FsrEasuTap(accum, weight, vec2(-1, 1) - sub, dir, len2, lob, clp, i);
    FsrEasuTap(accum, weight, vec2(0, 1) - sub, dir, len2, lob, clp, j);
    FsrEasuTap(accum, weight, vec2(0, 0) - sub, dir, len2, lob, clp, f);
    FsrEasuTap(accum, weight, vec2(-1, 0) - sub, dir, len2, lob, clp, e);
    FsrEasuTap(accum, weight, vec2(1, 1) - sub, dir, len2, lob, clp, k);
    FsrEasuTap(accum, weight, vec2(2, 1) - sub, dir, len2, lob, clp, l);
    FsrEasuTap(accum, weight, vec2(2, 0) - sub, dir, len2, lob, clp, h);
    FsrEasuTap(accum, weight, vec2(1, 0) - sub, dir, len2, lob, clp, g);
    FsrEasuTap(accum, weight, vec2(1, 2) - sub, dir, len2, lob, clp, o);
    FsrEasuTap(accum, weight, vec2(0, 2) - sub, dir, len2, lob, clp, n);

    float value = clamp(accum / max(weight, 1e-5), min4, max4);
    return vec4(value, 0.0, 0.0, 1.0);
}
