# Lumiere

> macOS video player — Electron + Vue 3 + libmpv with native HDR/EDR pipeline and Dolby Vision support

[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/platform-macOS-black?logo=apple)](https://github.com/Lucas-lgm/lumiere)
[![Electron](https://img.shields.io/badge/electron-28%2B-47848f?logo=electron)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/vue-3-4fc08d?logo=vue.js)](https://vuejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Website](https://img.shields.io/badge/web-lumiere--player.app-8A2BE2)](https://lumiere-player.app)

Lumiere is a **macOS-first** video player that nails HDR playback — something most desktop video players get wrong. It embeds libmpv via a native addon and renders through `CAOpenGLLayer` with the system's full EDR (Extended Dynamic Range) pipeline.

If you've struggled with washed-out HDR, broken subtitle rendering, or inaccurate colors in other players, Lumiere is for you. It's also a practical reference implementation if you're building Electron + libmpv integrations.

> **Not on macOS yet?** Windows support is in progress. See [project board](https://github.com/users/Lucas-lgm/projects/1).

## Screenshots

| Library Home | Folder View | Subtitle Panel |
|---|---|---|
| ![Library](https://raw.githubusercontent.com/Lucas-lgm/lumiere/main/website/src/assets/screenshots/library-home.png) | ![Folders](https://raw.githubusercontent.com/Lucas-lgm/lumiere/main/website/src/assets/screenshots/folder-view.png) | ![Subtitles](https://raw.githubusercontent.com/Lucas-lgm/lumiere/main/website/src/assets/screenshots/subtitle-panel.png) |

## Why Lumiere?

Most desktop video players on macOS make HDR look bad:
- **VLC** washes out HDR to SDR gamut
- **IINA** (mpv-based) lacks proper EDR integration
- **mpv itself** needs manual config and CLI flags

Lumiere fixes this with a **zero-config HDR experience** — it auto-detects HDR content, configures the display for EDR, applies correct tone mapping, and just works. SDR content stays accurate too (no gray/washed-out colors).

Built-in features that matter:
- **GPU shader enhancement** — FSRCNNX, Anime4K, ArtCNN for upscaling and sharpening
- **Thumbnail seek** — preview thumbnails on hover (like YouTube)
- **Subtitle AI** — local Whisper integration for auto-generated subtitles
- **Playlist management** — folders, groups, search

## Features

### Display & HDR
- **Correct HDR out of the box** — PQ colorspace, EDR enablement, CAOpenGLLayer rendering. No config needed.
- **Dolby Vision** — Profile 5 (streaming) and Profile 8 (iPhone) with dynamic tone mapping
- **Intelligent tone mapping** — auto-selects `st2094-10` for Dolby Vision, `bt.2390` (ITU-R) for HDR10
- **SDR stays accurate** — explicit `target-trc=srgb` plus display primaries detection prevents gray/washed-out colors
- **Conservative peak brightness** — prevents overexposure from macOS inflated EDR values

### Video & Rendering
- **GPU shader pipeline** — FSRCNNX, Anime4K, ArtCNN, CAS sharpening for real-time upscaling
- **Hardware acceleration** — libmpv render API with gpu-next (libplacebo) backend
- **Subtitle fixes** — correct rendering for rotated and flipped content (including iPhone videos)
- **Thumbnail seek preview** — dynamic thumbnails on progress bar hover

### AI & Subtitles
- **On-device Whisper** — local speech-to-text for auto-generated subtitles (no cloud API needed)
- **Subtitle AI panel** — edit timing, merge segments, export

### Quality of Life
- **Customizable keyboard shortcuts** — full shortcut editor with preset support
- **Playlist management** — folder grouping, search, sort, multiple views
- **Video animation export** — export segments as GIF, APNG, WebP, AVIF
- **Seekbar chapter markers** — visual chapter navigation

## Quick Start

### Prerequisites

| Dependency | Version | Installation |
|---|---|---|
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) or `brew install node@20` |
| macOS | 14+ (Sonoma) | Required for full EDR/HDR support |
| Xcode CLI | - | `xcode-select --install` |
| Python | 3.x | Included with macOS / Xcode |
| Meson | 1.2+ | `brew install meson` |
| Ninja | 1.11+ | `brew install ninja` |

### Install & Build

```bash
# 1. Clone with submodules
git clone --recurse-submodules https://github.com/Lucas-lgm/lumiere.git
cd lumiere

# 2. Install JS dependencies
npm install

# 3. Build mpv with gpu-next backend
./build_mpv.sh

# 4. Build the native addon
npm run build:native

# 5. Start developing
npm run dev
```

> **Troubleshooting:** See [SETUP_GUIDE.md](docs/guides/SETUP_GUIDE.md) for common issues.
> **Caution:** Set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` before `npm install` to speed up Electron downloads.

## macOS HDR Deep Dive

Lumiere uses **gpu-next** (libplacebo) for HDR rendering, providing superior tone mapping and color accuracy over the legacy gpu backend.

### Tone Mapping

| Content Type | Tone Mapping | Details |
|---|---|---|
| HDR10 | `bt.2390` (ITU-R) | Prevents overexposure, ITU-recommended standard |
| Dolby Vision | `st2094-10` | Dynamic metadata mapping per frame |
| SDR | `target-trc=srgb` | Correct gamma curve, no washed-out colors |

### Peak Brightness

macOS may report inflated values via `target-colorspace-hint` (up to 10000 nits). Lumiere uses conservative defaults:

| Display EDR | `target-peak` |
|---|---|
| ≤ 2.0 | 500 nits |
| ≤ 3.0 | 700 nits |
| > 3.0 | 1000 nits |

For best results, set `target-peak` to your display's actual measured peak brightness.

### Architecture

```
 ┌──────────────┐     ┌─────────────────────┐     ┌───────────────────┐
 │  Vue 3 UI    │ ←→  │  Electron Main      │ ←→  │  Native Addon      │
 │  (renderer)  │ IPC  │  (src/main/)        │     │  (binding.cc)      │
 └──────────────┘     │  MediaPlayer        │     │  mpv_render_gl.mm  │
                      │  IPC Handlers       │     │  CAOpenGLLayer     │
                      │  Window Manager     │     └───────────────────┘
                      └─────────────────────┘              │
                                                  ┌───────────────────┐
                                                  │  libmpv (gpu-next)│
                                                  │  (mpv submodule)   │
                                                  └───────────────────┘
```

## Debugging

Send IPC `debug-hdr-status` to print full HDR pipeline state:

```
mpv-side:    video-params/*, target-*, tone-mapping
native-side: display EDR capability, layer EDR/PQ state
```

## Building mpv from Source

```bash
git submodule update --init --recursive
./build_mpv.sh
```

The submodule tracks `release/0.41` from `git@github.com:Lucas-lgm/mpv.git` and builds to `vendor/mpv/darwin-arm64/lib/`.

## Known Issues (Resolved)

| Issue | Fix |
|---|---|
| HDR overexposure | Conservative `target-peak` + `bt.2390` + disabled `hdr-compute-peak` |
| Subtitle rotation/flip | Fixed Y-coordinate in gpu-next backend with `FLIP_Y=1` |
| iPhone video rotation | Proper rotation metadata handling in gpu-next |
| SDR gray/washed out | Explicit `target-trc=srgb` + primaries detection |

## Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | System architecture, IPC flow, and design overview |
| [FRONTEND.md](docs/architecture/FRONTEND.md) | Frontend component architecture and state management |
| [GPU_NEXT_INTEGRATION.md](docs/design/GPU_NEXT_INTEGRATION.md) | gpu-next (libplacebo) backend migration details |
| [BUILD.md](docs/build/BUILD.md) | Building from source guide |
| [API_REFERENCE.md](docs/reference/API_REFERENCE.md) | Core APIs and usage examples |

## Contributing

We welcome contributions! Here's how you can help:

- **HDR/EDR** — display calibration, tone mapping improvements, Dolby Vision edge cases
- **Windows port** — help with the Windows libmpv embedding
- **UI/UX** — player controls, accessibility, theming
- **Bug reports** — clear steps to reproduce, include `debug-hdr-status` output

Small fixes and documentation improvements are welcome directly. For significant changes, [open an issue](https://github.com/Lucas-lgm/lumiere/issues) first.

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md) code of conduct.

## Related Projects

- [mpv](https://mpv.io/) — the media player engine powering Lumiere
- [libplacebo](https://code.videolan.org/videolan/libplacebo) — GPU-accelerated video processing
- [IINA](https://iina.io/) — another macOS mpv wrapper (inspiration for several design decisions)
- [VLC](https://www.videolan.org/vlc/) — reference media player

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

Lumiere embeds [mpv](https://github.com/mpv-player/mpv) which is GPL-licensed, so the combined work is distributed under GPL.

---

⭐ **Star the repo** if you find this project useful — it helps others discover it.
