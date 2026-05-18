# Build Guide

> **Last Updated**: 2026-03-27
> **Purpose**: macOS/Windows complete build process

## macOS Complete Build Process (From Source)

### Prerequisites

```bash
# Install build tools
brew install cmake meson ninja pkg-config nasm python3 git autoconf automake libtool
```

### Step 1: Build All Dependency Libraries

Compile 24 dependency libraries from source (ffmpeg, libass, harfbuzz, etc.) ensuring consistent deployment target.

Build scripts are maintained in [lumiere-build](https://github.com/Lucas-lgm/lumiere-build).

```bash
# Clone the build repo
git clone https://github.com/Lucas-lgm/lumiere-build.git
cd lumiere-build

# arm64 (Apple Silicon, target macOS 11.0+)
./build_deps_macos.sh arm64

# x64 (Intel Mac, target macOS 10.15+)
./build_deps_macos.sh x64

# Clean all build artifacts
./build_deps_macos.sh clean
```

**Output directory**: `deps/macos-arm64/` or `deps/macos-x64/`

The script will automatically:
- Download and compile all dependencies (in layer order, resumable)
- Set correct cross-compilation parameters
- Verify all libraries' `minos` <= target version

**macOS Version Strategy**:
| Architecture | Minimum macOS Version | Reason |
|------|----------------|------|
| arm64 | 11.0 (Big Sur) | Minimum system version for M1 chips |
| x64 | 10.15 (Catalina) | Supports more Intel Macs |

**Rebuild a single library**: Remove the corresponding stamp file and re-run
```bash
rm deps/stamps-arm64/ffmpeg
./build_deps_macos.sh arm64   # Will only rebuild ffmpeg
```

> Note: Run `./build_deps_macos.sh` from the `lumiere-build` repo, not from lumiere root.

### Step 2: Compile libmpv

> Run from the `lumiere-build` repo.

```bash
# arm64
./build_mpv.sh arm64

# x64 (cross-compile on arm64 machine)
./build_mpv.sh x64
```

The script will automatically:
- Configure and compile libmpv using meson
- Copy libmpv and all runtime dependencies to `vendor/mpv/darwin-{arch}/lib/`
- Fix all dylib rpath and install_name
- Re-sign

### Step 3: Compile Native Binding

```bash
# Compile for current architecture
npm run build:native

# Or specify architecture
npm run build:native:arm64
npm run build:native:x64
```

Generates `native/build/Release/mpv_binding.node` and copies it to `resources/` directory.

### Step 4: Build Electron Application

```bash
# Build frontend + main process
npm run build

# Package
npm run package:mac
```

### One-Click Build (Compile only, no dependencies)

```bash
# Compile mpv + binding + frontend + package (run from lumiere-build)
cd /path/to/lumiere-build && ./build_mpv.sh arm64 && cd /path/to/lumiere && npm run build:native && npm run package:mac
```

---

## Cross-Compilation Notes

On arm64 Mac, you can cross-compile x64 versions. The script handles this automatically:

1. **build_deps_macos.sh** (from [lumiere-build](https://github.com/Lucas-lgm/lumiere-build)) -- Generates meson cross file (`deps/stamps-x64/meson-cross-x86_64.ini`), includes `-arch x86_64` and `-I/-L` prefix paths
2. **build_mpv.sh** (from lumiere-build) -- Compiles mpv using the same cross file
3. **build-native.cjs** -- Cross-compiles native binding via `node-gyp --arch=x64`

**Note**: Cross-compilation requires the host Xcode toolchain to support the target architecture.

---

## Dependency Layers

```
Layer 0: zstd, xz, pcre2, uchardet          (No external dependencies)
Layer 1: openssl, libpng, jpeg-turbo, dav1d,  (No cross-dependencies)
         opus, fribidi, lcms2, zimg,
         libsamplerate, libunibreak
Layer 2: gettext, freetype(pass 1)            (Intermediate dependencies)
Layer 3: glib, harfbuzz, freetype(pass 2),    (Text/Font stack)
         fontconfig
Layer 4: libass                               (Subtitle rendering)
Layer 5: vulkan-headers, vulkan-loader,       (GPU rendering)
         shaderc, libplacebo
Layer 6: FFmpeg                               (Audio/Video decoding)
   ↓
   mpv (libmpv.2.dylib)
   ↓
   mpv_binding.node (Native Binding)
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

### Check Dependency Consistency

```bash
# Confirm glib and fontconfig use the same libintl
otool -L vendor/mpv/darwin-x64/lib/libglib-2.0.0.dylib | grep intl
nm -u vendor/mpv/darwin-x64/lib/libfontconfig.1.dylib | grep intl
nm -gU vendor/mpv/darwin-x64/lib/libintl.8.dylib | grep ngettext
# All three symbols should match (all _libintl_* standard symbols)
```

### Check rpath

```bash
otool -l vendor/mpv/darwin-x64/lib/libmpv.2.dylib | grep -A2 LC_RPATH
# Should only have @loader_path relative paths, no hardcoded paths
```

---

## Common Issues

### glib Build Failed: `libintl.type_name() == 'internal'`

glib 2.88+ requires libintl as an internal subproject. This is usually because Homebrew's libintl interferes with detection.

**Solution**: Ensure `build_gettext` correctly installs `libintl.8.dylib` to `$PREFIX/lib/`, and the meson cross file includes `-L$PREFIX/lib`.

### fontconfig Link Failed: `Undefined symbol _g_libintl_dgettext`

**Cause**: glib uses proxy-libintl (exports `g_libintl_*` symbols), but fontconfig links to Homebrew's libintl (standard symbols).

**Solution**: Ensure `--force-fallback-for=proxy-libintl` is not used, allow glib to use external GNU gettext.

### libintl.dylib Not Installed After Cross-Compiling Gettext

**Cause**: gettext's `make install` may skip dylib installation during cross-compilation.

**Solution**: `build_deps_macos.sh` (from [lumiere-build](https://github.com/Lucas-lgm/lumiere-build)) already has manual installation logic as a fallback.

### All Pixel Formats Failed: `err=10002`

See `docs/knowledge/gl-context-creation.md`.

---

## Quick Command Reference

| Task | Command |
|------|---------|
| Compile all dependencies (arm64) | `./build_deps_macos.sh arm64` (from lumiere-build) |
| Compile all dependencies (x64) | `./build_deps_macos.sh x64` (from lumiere-build) |
| Compile mpv | `./build_mpv.sh arm64` / `./build_mpv.sh x64` (from lumiere-build) |
| Compile Native Binding | `npm run build:native` |
| Build frontend | `npm run build` |
| Dev mode | `npm run dev` |
| Package application | `npm run package:mac` |
| Clean dependencies | `./build_deps_macos.sh clean` (from lumiere-build) |
