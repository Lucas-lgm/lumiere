/**
 * Minimal APNG encoder (single-header)
 *
 * Writes frame by frame without caching all frames (avoids ImageIO Finalize crash).
 * Each frame independently PNG compressed (zlib deflate), 24-bit true color, no quantization.
 *
 * APNG format: standard PNG + acTL/fcTL/fdAT extension chunks.
 * First frame uses IDAT (compatible with regular PNG viewers), subsequent frames use fdAT.
 */
#ifndef APNG_ENCODER_H
#define APNG_ENCODER_H

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <zlib.h>

struct ApngEncoder {
    FILE *fp;
    int width, height;
    int frame_count;
    int seq_num;       // APNG sequence number
    long actl_offset;  // acTL chunk position (needs backfill for num_frames)
    int frames_written;
};

// ── CRC32 for PNG chunks ──

static uint32_t apng_crc32(const uint8_t *data, size_t len) {
    return (uint32_t)crc32(0, data, (uInt)len);
}

// ── PNG chunk writing ──

static void apng_write32(FILE *fp, uint32_t val) {
    uint8_t buf[4] = {
        (uint8_t)(val >> 24), (uint8_t)(val >> 16),
        (uint8_t)(val >> 8), (uint8_t)(val)
    };
    fwrite(buf, 1, 4, fp);
}

static void apng_write_chunk(FILE *fp, const char *type, const uint8_t *data, uint32_t len) {
    apng_write32(fp, len);

    uint8_t type_buf[4];
    memcpy(type_buf, type, 4);
    fwrite(type_buf, 1, 4, fp);
    if (data && len > 0) fwrite(data, 1, len, fp);

    // CRC over type + data
    uint32_t crc = crc32(0, type_buf, 4);
    if (data && len > 0) crc = crc32(crc, data, len);
    apng_write32(fp, crc);
}

// ── zlib compress raw pixels → deflate stream ──

static uint8_t *apng_compress_frame(const uint8_t *rgba, int width, int height, size_t *out_len) {
    // PNG requires filter byte (0=None) before each row
    int row_bytes = width * 3; // RGB, no alpha for smaller files
    size_t raw_size = (size_t)height * (1 + row_bytes);
    uint8_t *raw = (uint8_t *)malloc(raw_size);
    if (!raw) return nullptr;

    for (int y = 0; y < height; y++) {
        raw[y * (1 + row_bytes)] = 0; // filter: None
        for (int x = 0; x < width; x++) {
            int src = (y * width + x) * 4;
            int dst = y * (1 + row_bytes) + 1 + x * 3;
            raw[dst + 0] = rgba[src + 0]; // R
            raw[dst + 1] = rgba[src + 1]; // G
            raw[dst + 2] = rgba[src + 2]; // B
        }
    }

    size_t bound = compressBound((uLong)raw_size);
    uint8_t *compressed = (uint8_t *)malloc(bound);
    if (!compressed) { free(raw); return nullptr; }

    uLongf dest_len = (uLongf)bound;
    int ret = compress2(compressed, &dest_len, raw, (uLong)raw_size, Z_DEFAULT_COMPRESSION);
    free(raw);

    if (ret != Z_OK) { free(compressed); return nullptr; }

    *out_len = (size_t)dest_len;
    return compressed;
}

// ── Public API ──

static bool apng_begin(ApngEncoder *enc, const char *path, int width, int height) {
    enc->fp = fopen(path, "wb");
    if (!enc->fp) return false;
    enc->width = width;
    enc->height = height;
    enc->frame_count = 0;
    enc->seq_num = 0;
    enc->frames_written = 0;

    // PNG signature
    const uint8_t sig[] = {137, 80, 78, 71, 13, 10, 26, 10};
    fwrite(sig, 1, 8, enc->fp);

    // IHDR
    uint8_t ihdr[13];
    ihdr[0] = (width >> 24) & 0xFF; ihdr[1] = (width >> 16) & 0xFF;
    ihdr[2] = (width >> 8) & 0xFF; ihdr[3] = width & 0xFF;
    ihdr[4] = (height >> 24) & 0xFF; ihdr[5] = (height >> 16) & 0xFF;
    ihdr[6] = (height >> 8) & 0xFF; ihdr[7] = height & 0xFF;
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // color type: RGB
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace
    apng_write_chunk(enc->fp, "IHDR", ihdr, 13);

    // acTL (Animation Control) — write placeholder, fill num_frames later
    enc->actl_offset = ftell(enc->fp);
    uint8_t actl[8] = {0,0,0,0, 0,0,0,0}; // num_frames=0, num_plays=0 (infinite)
    apng_write_chunk(enc->fp, "acTL", actl, 8);

    return true;
}

static bool apng_add_frame(ApngEncoder *enc, const uint8_t *rgba, int delay_num, int delay_den) {
    if (!enc->fp) return false;

    // fcTL (Frame Control)
    uint8_t fctl[26];
    memset(fctl, 0, 26);
    // sequence_number
    uint32_t seq = enc->seq_num++;
    fctl[0] = (seq >> 24) & 0xFF; fctl[1] = (seq >> 16) & 0xFF;
    fctl[2] = (seq >> 8) & 0xFF; fctl[3] = seq & 0xFF;
    // width
    fctl[4] = (enc->width >> 24) & 0xFF; fctl[5] = (enc->width >> 16) & 0xFF;
    fctl[6] = (enc->width >> 8) & 0xFF; fctl[7] = enc->width & 0xFF;
    // height
    fctl[8] = (enc->height >> 24) & 0xFF; fctl[9] = (enc->height >> 16) & 0xFF;
    fctl[10] = (enc->height >> 8) & 0xFF; fctl[11] = enc->height & 0xFF;
    // x_offset, y_offset = 0
    // delay_num
    fctl[20] = (delay_num >> 8) & 0xFF; fctl[21] = delay_num & 0xFF;
    // delay_den
    fctl[22] = (delay_den >> 8) & 0xFF; fctl[23] = delay_den & 0xFF;
    // dispose_op = 0 (APNG_DISPOSE_OP_NONE), blend_op = 0 (APNG_BLEND_OP_SOURCE)
    fctl[24] = 0; fctl[25] = 0;
    apng_write_chunk(enc->fp, "fcTL", fctl, 26);

    // Compress frame
    size_t comp_len = 0;
    uint8_t *comp = apng_compress_frame(rgba, enc->width, enc->height, &comp_len);
    if (!comp) return false;

    if (enc->frames_written == 0) {
        // First frame: use IDAT (compatible with non-APNG viewers)
        apng_write_chunk(enc->fp, "IDAT", comp, (uint32_t)comp_len);
    } else {
        // Subsequent frames: use fdAT (sequence_number + data)
        uint32_t fdat_len = 4 + (uint32_t)comp_len;
        uint8_t *fdat = (uint8_t *)malloc(fdat_len);
        if (!fdat) { free(comp); return false; }
        uint32_t fseq = enc->seq_num++;
        fdat[0] = (fseq >> 24) & 0xFF; fdat[1] = (fseq >> 16) & 0xFF;
        fdat[2] = (fseq >> 8) & 0xFF; fdat[3] = fseq & 0xFF;
        memcpy(fdat + 4, comp, comp_len);
        apng_write_chunk(enc->fp, "fdAT", fdat, fdat_len);
        free(fdat);
    }

    free(comp);
    enc->frames_written++;
    return true;
}

static bool apng_end(ApngEncoder *enc) {
    if (!enc->fp) return false;

    // 1. Backfill acTL num_frames
    //    acTL chunk layout: [length:4][type"acTL":4][num_frames:4][num_plays:4][crc:4]
    //    actl_offset points to length field
    fseek(enc->fp, enc->actl_offset, SEEK_SET);

    // Rewrite the entire acTL chunk
    uint8_t actl_data[8];
    // num_frames
    actl_data[0] = (enc->frames_written >> 24) & 0xFF;
    actl_data[1] = (enc->frames_written >> 16) & 0xFF;
    actl_data[2] = (enc->frames_written >> 8) & 0xFF;
    actl_data[3] = enc->frames_written & 0xFF;
    // num_plays = 0 (infinite)
    actl_data[4] = 0; actl_data[5] = 0; actl_data[6] = 0; actl_data[7] = 0;
    apng_write_chunk(enc->fp, "acTL", actl_data, 8);

    // 2. Seek to end of file and write IEND
    fseek(enc->fp, 0, SEEK_END);
    apng_write_chunk(enc->fp, "IEND", nullptr, 0);

    fclose(enc->fp);
    enc->fp = nullptr;
    return true;
}

#endif // APNG_ENCODER_H
