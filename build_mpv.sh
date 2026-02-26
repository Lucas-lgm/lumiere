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

export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-11.0}"

# Add ffmpeg pkg-config paths
export PKG_CONFIG_PATH="/opt/homebrew/opt/ffmpeg-full/lib/pkgconfig:/opt/homebrew/opt/ffmpeg/lib/pkgconfig:$PKG_CONFIG_PATH"

cd "$PROJECT_ROOT/mpv"

echo "Configuring mpv build..."
# Ensure build directory exists
if [ ! -d "build" ]; then
    meson setup build --buildtype=release \
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
        -Dlibbluray=disabled \
        -Dvapoursynth=disabled \
        -Dx11-clipboard=disabled \
        -Djavascript=disabled \
        -Dcplugins=disabled
else
    echo "Build directory exists, reconfiguring..."
    meson setup build --reconfigure --buildtype=release \
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
        -Dlibbluray=disabled \
        -Dvapoursynth=disabled \
        -Dx11-clipboard=disabled \
        -Djavascript=disabled \
        -Dcplugins=disabled
fi

echo "Compiling mpv..."
meson compile -C build

echo "Copying libmpv and all dependencies to vendor..."

# 运行依赖复制脚本
if [ -f "$PROJECT_ROOT/copy_dependencies.sh" ]; then
    "$PROJECT_ROOT/copy_dependencies.sh"
    echo ""
    echo "所有依赖已复制到 vendor 目录"
else
    echo "Warning: copy_dependencies.sh not found, only copying libmpv..."
    LIB_SRC="build/libmpv.2.dylib"
    LIB_DEST="$PROJECT_ROOT/vendor/mpv/darwin-arm64/lib/libmpv.2.dylib"
    
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
