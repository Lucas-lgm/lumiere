#ifndef MPV_HDR_H
#define MPV_HDR_H

struct GLRenderContext;  // Forward declaration

#include <mpv/client.h>
#import <QuartzCore/QuartzCore.h>

void update_hdr_mode(GLRenderContext *rc);
void init_default_sdr_config(GLRenderContext *rc);
void set_render_icc_profile(GLRenderContext *rc);
bool check_dolby_vision_track(mpv_handle *mpv);
const char* get_optimal_tone_mapping(mpv_handle *mpv);
void log_hdr_config(GLRenderContext *rc);
void set_layer_colorspace_if_supported(CALayer *layer, CGColorSpaceRef cs);
CGColorSpaceRef create_hdr_pq_colorspace_for_primaries(const char *primaries);
CALayer *get_render_layer(GLRenderContext *rc);

#endif // MPV_HDR_H
