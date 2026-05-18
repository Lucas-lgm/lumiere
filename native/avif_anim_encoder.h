/**
 * Animated AVIF encoder (single-header)
 *
 * Frame-by-frame encoding based on libavif avifEncoder API.
 * Supports SDR (8-bit BT.709) and HDR (10-bit BT.2020 PQ).
 *
 * SDR input: RGBA uint8 (glReadPixels GL_UNSIGNED_BYTE)
 * HDR input: RGBA half-float (glReadPixels GL_HALF_FLOAT)
 *   → internally converts to 16-bit uint RGBA → libavif converts to 10-bit YUV
 */
#ifndef AVIF_ANIM_ENCODER_H
#define AVIF_ANIM_ENCODER_H

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <cstdlib>
#include <avif/avif.h>

struct AvifAnimEncoder {
    avifEncoder *enc;
    int width, height;
    int frame_count;
    uint64_t timescale;     // Hz
    uint64_t frame_duration; // in timescale units
    int depth;              // 8 or 10
    bool hdr;
    int quality;
    const char *output_path;
};

// half-float to float conversion
static inline float half_to_float(uint16_t h) {
    uint32_t sign = (h >> 15) & 1;
    uint32_t exp = (h >> 10) & 0x1F;
    uint32_t mant = h & 0x3FF;
    float f;
    if (exp == 0) {
        f = (float)(mant) / 1024.0f * (1.0f / 32768.0f); // denorm
    } else if (exp == 31) {
        f = mant ? NAN : INFINITY;
    } else {
        f = ldexpf((float)(mant + 1024), (int)exp - 25);
    }
    return sign ? -f : f;
}

static bool avif_anim_begin(AvifAnimEncoder *ctx, const char *path,
                            int width, int height, int fps,
                            int quality, bool hdr) {
    memset(ctx, 0, sizeof(*ctx));
    ctx->width = width;
    ctx->height = height;
    ctx->quality = quality;
    ctx->hdr = hdr;
    ctx->depth = hdr ? 10 : 8;
    ctx->output_path = path;
    ctx->timescale = (uint64_t)fps;
    ctx->frame_duration = 1;

    ctx->enc = avifEncoderCreate();
    if (!ctx->enc) return false;

    ctx->enc->timescale = ctx->timescale;
    ctx->enc->quality = quality;
    ctx->enc->qualityAlpha = quality;
    ctx->enc->speed = 6;

    return true;
}

// SDR: rgba is uint8 RGBA; HDR: rgba is half-float RGBA (8 bytes per pixel)
static bool avif_anim_add_frame(AvifAnimEncoder *ctx, const uint8_t *rgba) {
    if (!ctx->enc) return false;

    avifImage *img = avifImageCreate(ctx->width, ctx->height, ctx->depth,
                                     AVIF_PIXEL_FORMAT_YUV444);
    if (!img) return false;

    if (ctx->hdr) {
        img->colorPrimaries = AVIF_COLOR_PRIMARIES_BT2020;
        img->transferCharacteristics = AVIF_TRANSFER_CHARACTERISTICS_PQ;
        img->matrixCoefficients = 9; // BT.2020 NCL
        img->yuvRange = AVIF_RANGE_LIMITED;
    } else {
        img->colorPrimaries = AVIF_COLOR_PRIMARIES_BT709;
        img->transferCharacteristics = AVIF_TRANSFER_CHARACTERISTICS_BT709;
        img->matrixCoefficients = 1; // BT.709
        img->yuvRange = AVIF_RANGE_FULL;
    }

    avifRGBImage rgb;
    avifRGBImageSetDefaults(&rgb, img);
    rgb.format = AVIF_RGB_FORMAT_RGBA;

    if (ctx->hdr) {
        // Input is half-float RGBA -> convert to 16-bit uint RGBA (libavif requires integer input)
        rgb.depth = 16;
        rgb.rowBytes = ctx->width * 8; // 4 channels * 2 bytes
        rgb.pixels = (uint8_t *)malloc(ctx->width * ctx->height * 8);
        if (!rgb.pixels) { avifImageDestroy(img); return false; }

        const uint16_t *src = (const uint16_t *)rgba;
        uint16_t *dst = (uint16_t *)rgb.pixels;
        int npixels = ctx->width * ctx->height;
        for (int i = 0; i < npixels * 4; i++) {
            float v = half_to_float(src[i]);
            // PQ range [0, 1] -> 16-bit [0, 65535]
            if (v < 0.0f) v = 0.0f;
            if (v > 1.0f) v = 1.0f;
            dst[i] = (uint16_t)(v * 65535.0f + 0.5f);
        }

        avifResult res = avifImageRGBToYUV(img, &rgb);
        free(rgb.pixels);
        if (res != AVIF_RESULT_OK) { avifImageDestroy(img); return false; }
    } else {
        // SDR: use uint8 RGBA directly
        rgb.depth = 8;
        rgb.pixels = (uint8_t *)rgba;
        rgb.rowBytes = ctx->width * 4;

        avifResult res = avifImageRGBToYUV(img, &rgb);
        if (res != AVIF_RESULT_OK) { avifImageDestroy(img); return false; }
    }

    avifResult res = avifEncoderAddImage(ctx->enc, img, ctx->frame_duration,
                                         AVIF_ADD_IMAGE_FLAG_NONE);
    avifImageDestroy(img);
    if (res != AVIF_RESULT_OK) return false;

    ctx->frame_count++;
    return true;
}

static bool avif_anim_end(AvifAnimEncoder *ctx) {
    if (!ctx->enc) return false;

    avifRWData output = AVIF_DATA_EMPTY;
    bool ok = false;

    if (avifEncoderFinish(ctx->enc, &output) == AVIF_RESULT_OK) {
        FILE *fp = fopen(ctx->output_path, "wb");
        if (fp) {
            ok = fwrite(output.data, 1, output.size, fp) == output.size;
            fclose(fp);
        }
    }

    avifRWDataFree(&output);
    avifEncoderDestroy(ctx->enc);
    ctx->enc = nullptr;
    return ok;
}

#endif // AVIF_ANIM_ENCODER_H
