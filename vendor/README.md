# MPV Vendor Dependencies

This directory contains all dependency libraries for the mpv player, used to build and package a standalone application.

## Directory Structure

```
vendor/
└── mpv/
    └── darwin-arm64/
        ├── include/          # MPV headers
        │   └── mpv/
        │       ├── client.h
        │       ├── render_gl.h
        │       ├── render.h
        │       └── stream_cb.h
        └── lib/              # MPV library and all dependencies
            ├── libmpv.2.dylib
            ├── libmpv.dylib -> libmpv.2.dylib
            └── [90+ dependency libraries]
```

## Build Scripts

Build scripts are maintained in a [separate repository](https://github.com/Lucas-lgm/lumiere-build).

### build_mpv.sh
Main build script for compiling mpv and automatically copying all dependencies:

```bash
git clone https://github.com/Lucas-lgm/lumiere-build.git
cd lumiere-build
./build_mpv.sh
```

This script will:
1. Configure the meson build environment
2. Compile libmpv
3. Automatically copy all dependencies to the vendor directory

### copy_dependencies.sh
Dependency copy script that copies all mpv dependencies to the vendor directory:

```bash
./copy_dependencies.sh
```

This script will:
1. Analyze libmpv's dependency tree
2. Recursively copy all non-system library dependencies (~101 library files)
3. Create version symlinks
4. Modify all library paths to @rpath

## Dependency Libraries

### Core
- **libmpv** - MPV player core library
- **ffmpeg** - Audio/video codecs (libavcodec, libavformat, libavfilter, libavutil, libswscale, libswresample, libavdevice)

### Video Codecs
- **libx264, libx265** - H.264/H.265 encoders
- **libvpx** - VP8/VP9 codec
- **libaom** - AV1 encoder
- **libdav1d** - AV1 decoder
- **librav1e** - Rust AV1 encoder
- **libSvtAv1Enc** - SVT-AV1 encoder
- **libtheora** - Theora codec

### Audio Codecs
- **libopus** - Opus audio codec
- **libvorbis** - Vorbis audio codec
- **libmp3lame** - MP3 encoder
- **libspeex** - Speex speech codec
- **libopencore-amr** - AMR audio codec

### Image Processing
- **libpng** - PNG image library
- **libjpeg** - JPEG image library
- **libwebp** - WebP image library
- **libjxl** - JPEG XL image library
- **libtiff** - TIFF image library
- **libgif** - GIF image library

### Subtitles & Text
- **libass** - Subtitle rendering library
- **libfribidi** - Unicode bidirectional text support
- **libharfbuzz** - Text shaping engine
- **libfreetype** - Font rendering library
- **libtesseract** - OCR text recognition

### Rendering & Graphics
- **libplacebo** - GPU accelerated video processing
- **libshaderc** - Shader compiler
- **libvulkan** - Vulkan graphics API
- **little-cms2** - Color management

### Audio Processing
- **librubberband** - Audio time stretching and pitch shifting
- **libsoxr** - Audio resampling
- **libsamplerate** - Sample rate conversion

### Network Protocols
- **gnutls** - TLS/SSL library
- **libsrt** - SRT streaming protocol
- **librist** - RIST streaming protocol
- **libssh** - SSH protocol
- **libzmq** - ZeroMQ message queue

### AI Features
- **libwhisper** - Whisper AI speech recognition
- **libggml** - Machine learning inference

### Other
- **libbluray** - Blu-ray disc support
- **libarchive** - Archive file support
- **luajit** - Lua JIT compiler (script support)
- **mujs** - JavaScript engine
- **vapoursynth** - Video processing framework

### System Dependencies (not copied)
The following system libraries are not copied, as they are built into macOS:
- `/usr/lib/libSystem.B.dylib`
- `/usr/lib/libiconv.2.dylib`
- `/System/Library/Frameworks/IOKit.framework`
- `/System/Library/Frameworks/QuartzCore.framework`

## Path Configuration

All dependency libraries use `@rpath` relative paths:

1. **Development**: Set correct rpath in the application
2. **Distribution**: All dependencies can be placed in the same directory
3. **Cross-platform**: Works across different macOS systems

### Usage in Electron

Configured in `native/binding.gyp`:

```json
{
  "xcode_settings": {
    "OTHER_LDFLAGS": [
      "-Wl,-rpath,@loader_path/../../../vendor/mpv/darwin-arm64/lib"
    ]
  }
}
```

## Updating Dependencies

After Homebrew updates certain dependencies, rebuild via:

```bash
git clone https://github.com/Lucas-lgm/lumiere-build.git
cd lumiere-build
./build_mpv.sh
```

## Disk Space

The complete vendor dependencies take approximately **60-80 MB** of disk space.

## License

Refer to each dependency library's respective project:
- MPV: GPLv2+
- FFmpeg: LGPLv2.1+ / GPLv2+ (depending on build options)
- Other dependencies: respective open source licenses

## Troubleshooting

### "Library not loaded" Error

1. Check rpath configuration
2. Confirm all dependencies are copied to the vendor directory
3. Use `otool -L` to check library dependency paths:

```bash
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
```

### Re-copy Dependencies

```bash
git clone https://github.com/Lucas-lgm/lumiere-build.git
cd lumiere-build
./copy_dependencies.sh
```

## Technical Details

- **Platform**: macOS (darwin-arm64)
- **Architecture**: ARM64 (Apple Silicon)
- **Compiler**: Clang (Apple)
- **Build System**: Meson + Ninja
- **Dependency Management**: Homebrew

---

Last updated: 2026-05-19
