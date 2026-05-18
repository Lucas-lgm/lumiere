# Lumiere v1 — Project Guidelines

macOS video player (Electron + Vue 3 + TypeScript + libmpv).

## Development

```bash
# Build mpv submodule (scripts maintained internally)

# Build native addon
npm run build:native

# Development
npm run dev

# Build
npm run build
```

## Tech Stack

- Electron 28+ / Vue 3 / TypeScript
- libmpv render API (native addon via node-gyp)
- macOS CAOpenGLLayer HDR/EDR pipeline
- mpv gpu-next (libplacebo) backend

## Directory Structure

- `native/` — node-gyp native addon (libmpv binding + OpenGL rendering)
- `mpv/` — mpv git submodule (gpu-next backend)
- `src/main/` — Electron main process
- `src/preload/` — preload scripts
- `src/renderer/` — Vue renderer process
- `vendor/` — pre-built libmpv libraries
- `docs/` — documentation
