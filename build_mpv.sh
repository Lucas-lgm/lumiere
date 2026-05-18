#!/bin/bash
set -e

# Directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$DIR"

# Check if mpv directory exists
if [ ! -d "$PROJECT_ROOT/mpv" ]; then
    echo "Error: mpv directory not found in $PROJECT_ROOT"
    exit 1
fi

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# Architecture: ARCH=real name, ARCH_DIR=directory name
case "${1:-}" in
    x64|x86_64) ARCH="x86_64"; ARCH_DIR="x64" ;;
    *)          ARCH="arm64";   ARCH_DIR="arm64" ;;
esac

# arm64 Mac minimum macOS 11.0 (M1 starts from Big Sur), x64 can go down to 10.15 (Catalina)
if [ "$ARCH" = "arm64" ]; then
    DEFAULT_MIN="11.0"
else
    DEFAULT_MIN="10.15"
fi
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-$DEFAULT_MIN}"

# Prefer locally-built deps (from build_deps_macos.sh), fallback to Homebrew
DEPS_PREFIX="$PROJECT_ROOT/deps/macos-$ARCH_DIR"
if [ -d "$DEPS_PREFIX/lib/pkgconfig" ]; then
    echo "Using locally-built dependencies from $DEPS_PREFIX ($ARCH)"
    export PKG_CONFIG_PATH="$DEPS_PREFIX/lib/pkgconfig:$DEPS_PREFIX/share/pkgconfig:/opt/homebrew/lib/pkgconfig:$PKG_CONFIG_PATH"
else
    echo "Warning: Local deps not found for $ARCH_DIR. Using Homebrew (may have high minos)."
    echo "Run ./build_deps_macos.sh $ARCH_DIR first."
    export PKG_CONFIG_PATH="/opt/homebrew/lib/pkgconfig:/opt/homebrew/opt/ffmpeg-full/lib/pkgconfig:/opt/homebrew/opt/ffmpeg/lib/pkgconfig:$PKG_CONFIG_PATH"
fi

# Cross-compile support
MESON_CROSS_ARGS=""
if [ "$ARCH" = "x86_64" ]; then
    export CFLAGS="-arch x86_64 -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
    export CXXFLAGS="-arch x86_64 -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
    export LDFLAGS="-arch x86_64 -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
    CROSS_FILE="$PROJECT_ROOT/deps/stamps-$ARCH_DIR/meson-cross-x86_64.ini"
    if [ -f "$CROSS_FILE" ]; then
        MESON_CROSS_ARGS="--cross-file=$CROSS_FILE"
    else
        echo "Error: Meson cross file not found. Run ./build_deps_macos.sh x64 first."
        exit 1
    fi
fi

cd "$PROJECT_ROOT/mpv"

BUILD_DIR="build-$ARCH_DIR"

echo "Configuring mpv build ($ARCH_DIR)..."
if [ ! -d "$BUILD_DIR" ]; then
    meson setup "$BUILD_DIR" --buildtype=release $MESON_CROSS_ARGS \
        -Dlibmpv=true \
        -Dcplayer=false \
        -Dcocoa=disabled \
        -Dmacos-cocoa-cb=disabled \
        -Dmacos-media-player=disabled \
        -Dmacos-touchbar=disabled \
        -Dswift-build=disabled \
        -Dmanpage-build=disabled \
        -Dhtml-build=disabled \
        -Dpdf-build=disabled \
        -Dtests=false \
        -Dbuild-date=false \
        -Dlua=disabled \
        -Dcdda=disabled \
        -Ddvdnav=disabled \
        -Ddvbin=disabled \
        -Dlibarchive=disabled \
        -Dlibbluray=enabled \
        -Dvapoursynth=disabled \
        -Dx11-clipboard=disabled \
        -Djavascript=disabled \
        -Dcplugins=disabled \
        -Dvulkan=disabled
else
    echo "Build directory exists, reconfiguring..."
    meson setup "$BUILD_DIR" --reconfigure --buildtype=release $MESON_CROSS_ARGS \
        -Dlibmpv=true \
        -Dcplayer=false \
        -Dcocoa=disabled \
        -Dmacos-cocoa-cb=disabled \
        -Dmacos-media-player=disabled \
        -Dmacos-touchbar=disabled \
        -Dswift-build=disabled \
        -Dmanpage-build=disabled \
        -Dhtml-build=disabled \
        -Dpdf-build=disabled \
        -Dtests=false \
        -Dbuild-date=false \
        -Dlua=disabled \
        -Dcdda=disabled \
        -Ddvdnav=disabled \
        -Ddvbin=disabled \
        -Dlibarchive=disabled \
        -Dlibbluray=enabled \
        -Dvapoursynth=disabled \
        -Dx11-clipboard=disabled \
        -Djavascript=disabled \
        -Dcplugins=disabled \
        -Dvulkan=disabled
fi

echo "Compiling mpv ($ARCH_DIR)..."
meson compile -C "$BUILD_DIR"

echo "Copying libmpv and all dependencies to vendor..."

# Run dependency copy script
if [ -f "$PROJECT_ROOT/copy_dependencies.sh" ]; then
    "$PROJECT_ROOT/copy_dependencies.sh" "$ARCH_DIR"
    echo ""
    echo "All dependencies copied to vendor directory"
else
    echo "Warning: copy_dependencies.sh not found, only copying libmpv..."
    LIB_SRC="build/libmpv.2.dylib"
    LIB_DEST="$PROJECT_ROOT/vendor/mpv/darwin-$ARCH_DIR/lib/libmpv.2.dylib"
    
    if [ -f "$LIB_SRC" ]; then
        cp "$LIB_SRC" "$LIB_DEST"
        echo "Copied $LIB_SRC to $LIB_DEST"
        
        # Update install name to be @rpath relative
        install_name_tool -id "@rpath/libmpv.2.dylib" "$LIB_DEST"
        echo "Updated install name to @rpath/libmpv.2.dylib"
    else
        echo "Error: $LIB_SRC not found!"
        exit 1
    fi
fi

echo ""
echo "================================"
echo "mpv build complete."
echo "================================"
