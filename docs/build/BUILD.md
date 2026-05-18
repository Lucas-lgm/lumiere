# Build Guide

> **Last Updated**: 2026-05-19
> **Purpose**: macOS build process

## Build Prerequisites

```bash
# Install build tools
brew install cmake pkg-config
```

> **Note**: mpv and its dependency build scripts are maintained in a private repository.

## Build Process

### Step 1: Build Native Binding

```bash
# Compile for current architecture
npm run build:native

# Or specify architecture
npm run build:native:arm64
npm run build:native:x64
```

Generates `native/build/Release/mpv_binding.node` and copies it to `resources/` directory.

### Step 2: Build Electron Application

```bash
# Build frontend + main process
npm run build

# Package
npm run package:mac
```

---

## Verify Build

### Check minos (Deployment Target)

```bash
# Check single library
otool -l vendor/mpv/darwin-x64/lib/libmpv.2.dylib | grep minos

# Batch check all libraries
for f in vendor/mpv/darwin-x64/lib/*.dylib; do
  [ -L "$f" ] && continue
  m=$(otool -l "$f" 2>/dev/null | grep -A5 LC_BUILD_VERSION | grep minos | awk '{print $2}')
  [ -n "$m" ] && echo "$(basename $f): minos=$m"
done
```

### Check Architecture

```bash
file vendor/mpv/darwin-x64/lib/libmpv.2.dylib
# Should output: Mach-O 64-bit dynamically linked shared library x86_64

file vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
# Should output: Mach-O 64-bit dynamically linked shared library arm64
```

### Check rpath

```bash
otool -l vendor/mpv/darwin-x64/lib/libmpv.2.dylib | grep -A2 LC_RPATH
# Should only have @loader_path relative paths, no hardcoded paths
```

---

## Quick Command Reference

| Task | Command |
|------|---------|
| Compile Native Binding | `npm run build:native` |
| Build frontend | `npm run build` |
| Dev mode | `npm run dev` |
| Package application | `npm run package:mac` |
