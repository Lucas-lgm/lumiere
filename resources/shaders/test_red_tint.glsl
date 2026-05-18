//!HOOK MAIN
//!BIND HOOKED
//!DESC Test Red Tint (verify shader pipeline works)

vec4 hook() {
    vec4 color = HOOKED_texOff(vec2(0.0, 0.0));
    color.r = min(color.r + 0.3, 1.0);
    color.g = color.g * 0.7;
    color.b = color.b * 0.7;
    return color;
}
