/**
 * Minimal Animated WebP encoder (single-header)
 *
 * Frame-by-frame encoding based on libwebp WebPAnimEncoder API.
 * Supports lossy and lossless modes.
 * Input: RGBA pixels, Output: WebP file.
 *
 * Note: WebPAnimEncoder internally caches frames for optimization (inter-frame dedup),
 * so it does not flush each frame completely to disk like GIF/APNG, but memory usage is controlled.
 */
#ifndef WEBP_ANIM_ENCODER_H
#define WEBP_ANIM_ENCODER_H

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <webp/encode.h>
#include <webp/mux.h>

struct WebpAnimEncoder {
    WebPAnimEncoder *enc;
    int width, height;
    int frame_count;
    int timestamp_ms;   // accumulated timestamp
    int delay_ms;       // per-frame delay
    float quality;      // 0-100, lossy quality
    int lossless;       // 1=lossless, 0=lossy
    const char *output_path;
};

static bool webp_anim_begin(WebpAnimEncoder *ctx, const char *path,
                            int width, int height, int fps,
                            float quality, int lossless) {
    memset(ctx, 0, sizeof(*ctx));
    ctx->width = width;
    ctx->height = height;
    ctx->quality = quality;
    ctx->lossless = lossless;
    ctx->output_path = path;
    ctx->delay_ms = (fps > 0) ? (1000 / fps) : 100;

    WebPAnimEncoderOptions enc_options;
    if (!WebPAnimEncoderOptionsInit(&enc_options)) return false;

    enc_options.anim_params.loop_count = 0; // infinite loop
    enc_options.allow_mixed = 0;

    ctx->enc = WebPAnimEncoderNew(width, height, &enc_options);
    return ctx->enc != nullptr;
}

static bool webp_anim_add_frame(WebpAnimEncoder *ctx, const uint8_t *rgba) {
    if (!ctx->enc) return false;

    WebPConfig config;
    if (!WebPConfigInit(&config)) return false;

    config.lossless = ctx->lossless;
    if (ctx->lossless) {
        config.quality = 75;    // effort level for lossless
        config.method = 4;      // speed/quality tradeoff
    } else {
        config.quality = ctx->quality;
        config.method = 4;
    }

    WebPPicture pic;
    if (!WebPPictureInit(&pic)) return false;
    pic.width = ctx->width;
    pic.height = ctx->height;
    pic.use_argb = 1;

    if (!WebPPictureImportRGBA(&pic, rgba, ctx->width * 4)) {
        WebPPictureFree(&pic);
        return false;
    }

    int ok = WebPAnimEncoderAdd(ctx->enc, &pic, ctx->timestamp_ms, &config);
    WebPPictureFree(&pic);

    if (!ok) return false;

    ctx->timestamp_ms += ctx->delay_ms;
    ctx->frame_count++;
    return true;
}

static bool webp_anim_end(WebpAnimEncoder *ctx) {
    if (!ctx->enc) return false;

    // Signal end of frames
    WebPAnimEncoderAdd(ctx->enc, NULL, ctx->timestamp_ms, NULL);

    WebPData webp_data;
    WebPDataInit(&webp_data);

    bool ok = false;
    if (WebPAnimEncoderAssemble(ctx->enc, &webp_data)) {
        FILE *fp = fopen(ctx->output_path, "wb");
        if (fp) {
            ok = fwrite(webp_data.bytes, 1, webp_data.size, fp) == webp_data.size;
            fclose(fp);
        }
    }

    WebPDataClear(&webp_data);
    WebPAnimEncoderDelete(ctx->enc);
    ctx->enc = nullptr;
    return ok;
}

#endif // WEBP_ANIM_ENCODER_H
