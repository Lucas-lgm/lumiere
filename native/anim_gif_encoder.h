/**
 * Minimal GIF89a encoder (single-header)
 *
 * Features:
 * - Writes frame by frame without caching all frames (avoids ImageIO crash)
 * - Per-frame independent Local Color Table + LZW compression
 * - Simple uniform quantization (256 colors)
 * - Supports animation loop (NETSCAPE 2.0 Application Extension)
 */
#ifndef GIF_ENCODER_H
#define GIF_ENCODER_H

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>

struct GifEncoder {
    FILE *fp;
    int width, height;
    bool started;
};

// ── LZW compressor ──

#define GIF_LZW_MAX_BITS 12
#define GIF_LZW_MAX_CODE (1 << GIF_LZW_MAX_BITS)

struct LzwState {
    int min_code_size;
    int clear_code;
    int eoi_code;
    int next_code;
    int code_size;
    int bit_buf;
    int bit_count;
    uint8_t block[256];
    int block_len;
    FILE *fp;

    // Hash table for code lookup
    int16_t table_prefix[GIF_LZW_MAX_CODE];
    int16_t table_suffix[GIF_LZW_MAX_CODE];
    int16_t hash_table[GIF_LZW_MAX_CODE * 2]; // open addressing
};

static void lzw_emit_code(LzwState *s, int code) {
    s->bit_buf |= (code << s->bit_count);
    s->bit_count += s->code_size;
    while (s->bit_count >= 8) {
        s->block[s->block_len++] = s->bit_buf & 0xFF;
        s->bit_buf >>= 8;
        s->bit_count -= 8;
        if (s->block_len == 255) {
            fputc(s->block_len, s->fp);
            fwrite(s->block, 1, s->block_len, s->fp);
            s->block_len = 0;
        }
    }
}

static void lzw_flush(LzwState *s) {
    if (s->bit_count > 0) {
        s->block[s->block_len++] = s->bit_buf & 0xFF;
    }
    if (s->block_len > 0) {
        fputc(s->block_len, s->fp);
        fwrite(s->block, 1, s->block_len, s->fp);
        s->block_len = 0;
    }
    fputc(0, s->fp); // block terminator
}

static void lzw_reset(LzwState *s) {
    s->next_code = s->eoi_code + 1;
    s->code_size = s->min_code_size + 1;
    memset(s->hash_table, -1, sizeof(s->hash_table));
}

static int lzw_lookup(LzwState *s, int prefix, int suffix) {
    int hash = ((prefix * 257) ^ suffix) & (GIF_LZW_MAX_CODE * 2 - 1);
    for (int i = 0; i < GIF_LZW_MAX_CODE * 2; i++) {
        int idx = (hash + i) & (GIF_LZW_MAX_CODE * 2 - 1);
        int code = s->hash_table[idx];
        if (code == -1) return -(idx + 1); // not found, return slot
        if (s->table_prefix[code] == prefix && s->table_suffix[code] == suffix) return code;
    }
    return -1;
}

static void lzw_compress(LzwState *s, const uint8_t *indices, int count) {
    s->min_code_size = 8;
    s->clear_code = 256;
    s->eoi_code = 257;
    s->bit_buf = 0;
    s->bit_count = 0;
    s->block_len = 0;
    lzw_reset(s);

    fputc(s->min_code_size, s->fp); // LZW minimum code size

    lzw_emit_code(s, s->clear_code);

    int prefix = indices[0];
    for (int i = 1; i < count; i++) {
        int suffix = indices[i];
        int result = lzw_lookup(s, prefix, suffix);
        if (result >= 0) {
            prefix = result;
        } else {
            lzw_emit_code(s, prefix);
            if (s->next_code < GIF_LZW_MAX_CODE) {
                int slot = -(result + 1);
                s->table_prefix[s->next_code] = prefix;
                s->table_suffix[s->next_code] = suffix;
                s->hash_table[slot] = s->next_code;
                s->next_code++;
                if (s->next_code > (1 << s->code_size) && s->code_size < GIF_LZW_MAX_BITS) {
                    s->code_size++;
                }
            } else {
                lzw_emit_code(s, s->clear_code);
                lzw_reset(s);
            }
            prefix = suffix;
        }
    }
    lzw_emit_code(s, prefix);
    lzw_emit_code(s, s->eoi_code);
    lzw_flush(s);
}

// ── Color quantization (Median-Cut, generates optimal 256-color palette) ──

struct McBox {
    int r_min, r_max, g_min, g_max, b_min, b_max;
    int count;
    long r_sum, g_sum, b_sum;
};

// Build optimal 256-color palette from RGBA pixels (Median-Cut, full 8-bit precision)
// Uses 15-bit histogram (R5G5B5) for box splitting, then 8-bit precision for average color
static void gif_median_cut(const uint8_t *rgba, int npixels,
                            uint8_t *palette, int max_colors) {
    // 15-bit histogram + 8-bit accumulator
    struct HistBin { int count; long r_sum, g_sum, b_sum; };
    static HistBin hist[32768];
    memset(hist, 0, sizeof(hist));

    int step = npixels > 200000 ? 3 : 1;
    for (int i = 0; i < npixels; i += step) {
        uint8_t r = rgba[i * 4 + 0];
        uint8_t g = rgba[i * 4 + 1];
        uint8_t b = rgba[i * 4 + 2];
        int idx = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        hist[idx].count++;
        hist[idx].r_sum += r;  // Accumulate 8-bit precision
        hist[idx].g_sum += g;
        hist[idx].b_sum += b;
    }

    McBox boxes[256];
    int nboxes = 1;
    boxes[0] = {0, 31, 0, 31, 0, 31, 0, 0, 0, 0};

    // Count boxes from histogram
    auto recount_box = [&](McBox &b) {
        b.count = 0; b.r_sum = b.g_sum = b.b_sum = 0;
        int rn = 31, rx = 0, gn = 31, gx = 0, bn = 31, bx = 0;
        for (int r = b.r_min; r <= b.r_max; r++) {
            for (int g = b.g_min; g <= b.g_max; g++) {
                for (int bb = b.b_min; bb <= b.b_max; bb++) {
                    auto &h = hist[(r << 10) | (g << 5) | bb];
                    if (h.count > 0) {
                        b.count += h.count;
                        b.r_sum += h.r_sum; b.g_sum += h.g_sum; b.b_sum += h.b_sum;
                        if (r < rn) rn = r; if (r > rx) rx = r;
                        if (g < gn) gn = g; if (g > gx) gx = g;
                        if (bb < bn) bn = bb; if (bb > bx) bx = bb;
                    }
                }
            }
        }
        b.r_min = rn; b.r_max = rx;
        b.g_min = gn; b.g_max = gx;
        b.b_min = bn; b.b_max = bx;
    };
    recount_box(boxes[0]);

    while (nboxes < max_colors) {
        int best = -1, best_range = 0;
        for (int i = 0; i < nboxes; i++) {
            if (boxes[i].count <= 1) continue;
            int rr = boxes[i].r_max - boxes[i].r_min;
            int gr = boxes[i].g_max - boxes[i].g_min;
            int br = boxes[i].b_max - boxes[i].b_min;
            int range = rr > gr ? (rr > br ? rr : br) : (gr > br ? gr : br);
            if (range > best_range) { best_range = range; best = i; }
        }
        if (best < 0) break;

        McBox &box = boxes[best];
        int rr = box.r_max - box.r_min;
        int gr = box.g_max - box.g_min;
        int br = box.b_max - box.b_min;

        int axis;
        if (rr >= gr && rr >= br) axis = 0;
        else if (gr >= br) axis = 1;
        else axis = 2;

        int mid;
        if (axis == 0) mid = (box.r_min + box.r_max) / 2;
        else if (axis == 1) mid = (box.g_min + box.g_max) / 2;
        else mid = (box.b_min + box.b_max) / 2;

        McBox b1 = box, b2 = box;
        if (axis == 0) { b1.r_max = mid; b2.r_min = mid + 1; }
        else if (axis == 1) { b1.g_max = mid; b2.g_min = mid + 1; }
        else { b1.b_max = mid; b2.b_min = mid + 1; }

        recount_box(b1);
        recount_box(b2);

        if (b1.count == 0 || b2.count == 0) break;

        boxes[best] = b1;
        boxes[nboxes++] = b2;
    }

    // 8-bit precision average color -> palette
    for (int i = 0; i < nboxes && i < max_colors; i++) {
        if (boxes[i].count > 0) {
            palette[i * 3 + 0] = (uint8_t)(boxes[i].r_sum / boxes[i].count);
            palette[i * 3 + 1] = (uint8_t)(boxes[i].g_sum / boxes[i].count);
            palette[i * 3 + 2] = (uint8_t)(boxes[i].b_sum / boxes[i].count);
        } else {
            palette[i * 3 + 0] = palette[i * 3 + 1] = palette[i * 3 + 2] = 0;
        }
    }
    for (int i = nboxes; i < 256; i++) {
        palette[i * 3 + 0] = palette[i * 3 + 1] = palette[i * 3 + 2] = 0;
    }
}

// Find the closest color in the palette
static uint8_t gif_nearest_color(uint8_t r, uint8_t g, uint8_t b,
                                  const uint8_t *palette, int ncolors) {
    int best = 0, best_dist = INT32_MAX;
    for (int i = 0; i < ncolors; i++) {
        int dr = (int)r - palette[i * 3 + 0];
        int dg = (int)g - palette[i * 3 + 1];
        int db = (int)b - palette[i * 3 + 2];
        int dist = dr * dr + dg * dg + db * db;
        if (dist < best_dist) { best_dist = dist; best = i; }
        if (dist == 0) break;
    }
    return (uint8_t)best;
}

// ── GIF file structure writing ──

static inline void gif_write16(FILE *fp, uint16_t val) {
    fputc(val & 0xFF, fp);
    fputc((val >> 8) & 0xFF, fp);
}

static bool gif_begin(GifEncoder *enc, const char *path, int width, int height, int loop_count) {
    enc->fp = fopen(path, "wb");
    if (!enc->fp) return false;
    enc->width = width;
    enc->height = height;
    enc->started = true;

    // GIF89a Header
    fwrite("GIF89a", 1, 6, enc->fp);

    // Logical Screen Descriptor (no Global Color Table)
    gif_write16(enc->fp, width);
    gif_write16(enc->fp, height);
    fputc(0x00, enc->fp); // no GCT
    fputc(0x00, enc->fp); // bg color index
    fputc(0x00, enc->fp); // pixel aspect ratio

    // NETSCAPE 2.0 Application Extension (animation loop)
    fputc(0x21, enc->fp); // Extension introducer
    fputc(0xFF, enc->fp); // Application extension label
    fputc(11, enc->fp);   // Block size
    fwrite("NETSCAPE2.0", 1, 11, enc->fp);
    fputc(3, enc->fp);    // Sub-block size
    fputc(1, enc->fp);    // Loop sub-block ID
    gif_write16(enc->fp, loop_count); // 0 = infinite
    fputc(0, enc->fp);    // Block terminator

    return true;
}

static bool gif_add_frame(GifEncoder *enc, const uint8_t *rgba, int delay_cs, int quality = 1) {
    if (!enc->fp) return false;
    int w = enc->width, h = enc->height;
    int npixels = w * h;

    // Graphic Control Extension
    fputc(0x21, enc->fp);
    fputc(0xF9, enc->fp);
    fputc(4, enc->fp);
    fputc(0x00, enc->fp);
    gif_write16(enc->fp, delay_cs);
    fputc(0x00, enc->fp);
    fputc(0x00, enc->fp);

    uint8_t palette[256 * 3];
    uint8_t *indices = (uint8_t *)malloc(npixels);
    if (!indices) return false;

    gif_median_cut(rgba, npixels, palette, 256);
    for (int i = 0; i < npixels; i++) {
        indices[i] = gif_nearest_color(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2],
                                        palette, 256);
    }

    // Image Descriptor
    fputc(0x2C, enc->fp);
    gif_write16(enc->fp, 0);
    gif_write16(enc->fp, 0);
    gif_write16(enc->fp, w);
    gif_write16(enc->fp, h);
    fputc(0x87, enc->fp); // Local Color Table, 256 entries

    // Local Color Table
    fwrite(palette, 1, 256 * 3, enc->fp);

    // LZW Compressed Image Data
    LzwState lzw;
    lzw.fp = enc->fp;
    lzw_compress(&lzw, indices, npixels);

    free(indices);
    return true;
}

static bool gif_end(GifEncoder *enc) {
    if (!enc->fp) return false;
    fputc(0x3B, enc->fp); // GIF Trailer
    fclose(enc->fp);
    enc->fp = nullptr;
    return true;
}

#endif // GIF_ENCODER_H
