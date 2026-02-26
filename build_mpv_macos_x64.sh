#!/bin/bash
set -e

# Directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$DIR"

echo "================================"
echo "开始构建 mpv (macOS x64)"
echo "================================"

# Check if mpv directory exists
if [ ! -d "$PROJECT_ROOT/mpv" ]; then
    echo "Error: mpv directory not found in $PROJECT_ROOT"
    echo "请先执行: git submodule update --init --recursive"
    exit 1
fi


 # 若当前是 arm64，则自动切到 x86_64 shell 重新执行自己
if [ "$(uname -m)" = "arm64" ]; then
    exec arch -x86_64 /bin/zsh "$0" "$@"
fi

# 这里开始已经在 x86_64 进程里
eval "$(/usr/local/bin/brew shellenv zsh)"

export ARCH=x64
export HOMEBREW_PREFIX=/usr/local

# 优先使用 /usr/local 这套 x86_64 工具链（包含 ninja 等）
export PATH="$HOMEBREW_PREFIX/bin:$HOMEBREW_PREFIX/sbin:/usr/bin:/bin:/usr/sbin:/sbin"

# pkg-config 搜索路径（ffmpeg/libplacebo/libass/harfbuzz/vulkan 等）
export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:/usr/local/opt/ffmpeg-full/lib/pkgconfig:/usr/local/opt/ffmpeg/lib/pkgconfig:/usr/local/opt/vulkan-loader/lib/pkgconfig:/usr/local/opt/harfbuzz/lib/pkgconfig:/usr/local/opt/libass/lib/pkgconfig"

export LDFLAGS="-L/usr/local/lib"
export CPPFLAGS="-I/usr/local/include"

# 为了兼容旧版 macOS，在新 SDK 上构建时强制设置最小系统版本（可被外部覆盖）
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-11.0}"

cd "$PROJECT_ROOT/mpv"

echo "Configuring mpv build (macOS x64)..."

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
        -Dlua=enabled \
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
        -Dlua=enabled \
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

echo "Copying libmpv and all dependencies to vendor (darwin-x64)..."

# 运行依赖复制脚本（x64 架构）
if [ -f "$PROJECT_ROOT/copy_dependencies.sh" ]; then
    "$PROJECT_ROOT/copy_dependencies.sh" x64
    echo ""
    echo "所有依赖已复制到 vendor/mpv/darwin-x64 目录"
else
    echo "Warning: copy_dependencies.sh not found, only copying libmpv..."
    LIB_SRC="build/libmpv.2.dylib"
    LIB_DEST="$PROJECT_ROOT/vendor/mpv/darwin-x64/lib/libmpv.2.dylib"

    if [ -f "$LIB_SRC" ]; then
        mkdir -p "$(dirname "$LIB_DEST")"
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
echo "mpv build complete (macOS x64)."
echo "vendor 目录: vendor/mpv/darwin-x64"
echo "================================"

