#!/bin/bash
set -eo pipefail

# ============================================================
# build_deps_macos.sh
# Build all mpv dependencies from source for macOS 10.15+ (x64) / 11.0+ (arm64)
#
# Usage:
#   ./build_deps_macos.sh              # Build arm64
#   ./build_deps_macos.sh x64          # Build x86_64
#   ./build_deps_macos.sh clean        # Remove all build artifacts
#   ./build_deps_macos.sh clean arm64  # Remove arm64 only
#
# Re-runnable: skips already-built libraries (stamp files).
# To rebuild a single lib: rm deps/stamps-$ARCH/<libname>
# ============================================================

# Parse arguments
# ARCH = real arch name (arm64/x86_64), used for compiler flags
# ARCH_DIR = directory name (arm64/x64), matches Electron convention
case "${1:-}" in
    x64|x86_64)  ARCH="x86_64"; ARCH_DIR="x64" ;;
    arm64|"")    ARCH="arm64";  ARCH_DIR="arm64" ;;
    clean)
        SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
        echo "Cleaning all..."
        rm -rf "$SCRIPT_DIR/deps/macos-arm64" "$SCRIPT_DIR/deps/macos-x64" \
               "$SCRIPT_DIR/deps/stamps-arm64" "$SCRIPT_DIR/deps/stamps-x64" \
               "$SCRIPT_DIR/deps/src"
        echo "Done."
        exit 0
        ;;
    *) echo "Usage: $0 [arm64|x64|clean]"; exit 1 ;;
esac

# arm64 Mac minimum macOS 11.0 (M1 starts from Big Sur), x64 can go down to 10.15 (Catalina)
if [ "$ARCH" = "arm64" ]; then
    MIN_MACOS="11.0"
else
    MIN_MACOS="10.15"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PREFIX="$SCRIPT_DIR/deps/macos-$ARCH_DIR"
SRC="$SCRIPT_DIR/deps/src"
STAMPS="$SCRIPT_DIR/deps/stamps-$ARCH_DIR"
JOBS=$(sysctl -n hw.ncpu)

# ---- Library versions (from Homebrew stable, 2026-03) ----
V_ZSTD="1.5.7"
V_XZ="5.8.2"
V_PCRE2="10.47"
V_UCHARDET="0.0.8"
V_OPENSSL="3.6.1"
V_PNG="1.6.55"
V_JPEGTURBO="3.1.3"
V_DAV1D="1.5.3"
V_OPUS="1.6.1"
V_FRIBIDI="1.0.16"
V_LCMS2="2.18"
V_ZIMG="3.0.6"
V_SAMPLERATE="0.2.2"
V_UNIBREAK="6.1"
V_GETTEXT="1.0"
V_FREETYPE="2.14.2"
V_GLIB="2.88.0"
V_HARFBUZZ="13.2.1"
V_FONTCONFIG="2.17.1"
V_LIBASS="0.17.4"
V_VULKAN="1.4.341.0"
V_SHADERC="2026.1"
V_PLACEBO="7.360.1"
V_FFMPEG="8.1"
V_LIBBLURAY="1.3.4"

# ---- Environment ----
export MACOSX_DEPLOYMENT_TARGET="$MIN_MACOS"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig"
export PATH="$PREFIX/bin:$PATH"
ARCH_FLAG="-arch $ARCH"
export CFLAGS="$ARCH_FLAG -mmacosx-version-min=$MIN_MACOS -O2 -I$PREFIX/include"
export CXXFLAGS="$ARCH_FLAG -mmacosx-version-min=$MIN_MACOS -O2 -I$PREFIX/include"
export LDFLAGS="$ARCH_FLAG -mmacosx-version-min=$MIN_MACOS -L$PREFIX/lib"
export CPPFLAGS="-I$PREFIX/include"

CMAKE_ARGS=(
    -DCMAKE_INSTALL_PREFIX="$PREFIX"
    -DCMAKE_PREFIX_PATH="$PREFIX"
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$MIN_MACOS"
    -DCMAKE_OSX_ARCHITECTURES="$ARCH"
    -DCMAKE_BUILD_TYPE=Release
    -DCMAKE_FIND_ROOT_PATH="$PREFIX"
    -DCMAKE_MACOSX_RPATH=ON
)

# Create directories in advance (cross file writing requires STAMPS directory to exist)
mkdir -p "$PREFIX"/{lib/pkgconfig,include,bin,share/pkgconfig} "$SRC" "$STAMPS"

# Meson cross file for x86_64 on arm64 host
MESON_ARGS="--prefix=$PREFIX --buildtype=release --default-library=shared"
if [ "$ARCH" = "x86_64" ]; then
    MESON_CROSS="$STAMPS/meson-cross-x86_64.ini"
    cat > "$MESON_CROSS" << CROSSEOF
[binaries]
c = 'cc'
cpp = 'c++'
objc = 'cc'
objcpp = 'c++'
ar = 'ar'
strip = 'strip'
pkgconfig = 'pkg-config'

[built-in options]
c_args = ['-arch', 'x86_64', '-mmacosx-version-min=$MIN_MACOS', '-I$PREFIX/include']
c_link_args = ['-arch', 'x86_64', '-mmacosx-version-min=$MIN_MACOS', '-L$PREFIX/lib']
cpp_args = ['-arch', 'x86_64', '-mmacosx-version-min=$MIN_MACOS', '-I$PREFIX/include']
cpp_link_args = ['-arch', 'x86_64', '-mmacosx-version-min=$MIN_MACOS', '-L$PREFIX/lib']
objc_args = ['-arch', 'x86_64', '-mmacosx-version-min=$MIN_MACOS', '-I$PREFIX/include']
objc_link_args = ['-arch', 'x86_64', '-mmacosx-version-min=$MIN_MACOS', '-L$PREFIX/lib']
objcpp_args = ['-arch', 'x86_64', '-mmacosx-version-min=$MIN_MACOS', '-I$PREFIX/include']
objcpp_link_args = ['-arch', 'x86_64', '-mmacosx-version-min=$MIN_MACOS', '-L$PREFIX/lib']

[host_machine]
system = 'darwin'
subsystem = 'macos'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
CROSSEOF
    MESON_ARGS="$MESON_ARGS --cross-file=$MESON_CROSS"
fi

# Autotools cross-compile host triplet
AUTOTOOLS_HOST=""
if [ "$ARCH" = "x86_64" ]; then
    AUTOTOOLS_HOST="--host=x86_64-apple-darwin"
fi

# ---- Handle 'clean' command ----
if [ "${1:-}" = "clean" ]; then
    echo "Removing all build artifacts..."
    rm -rf "$PREFIX" "$SRC" "$STAMPS"
    echo "Done. Run ./build_deps_macos.sh to rebuild."
    exit 0
fi

mkdir -p "$PREFIX"/{lib/pkgconfig,include,bin,share/pkgconfig} "$SRC" "$STAMPS"

# ============================================================
# Utility
# ============================================================

check_prereqs() {
    local missing=()
    for cmd in cmake meson ninja pkg-config nasm python3 git curl autoconf automake libtool; do
        command -v "$cmd" &>/dev/null || missing+=("$cmd")
    done
    if [ ${#missing[@]} -gt 0 ]; then
        echo "ERROR: Missing build tools: ${missing[*]}"
        echo "Install with: brew install ${missing[*]}"
        exit 1
    fi
    echo "All build tools found."
}

step_done() { [ -f "$STAMPS/$1" ]; }
mark_done() { touch "$STAMPS/$1"; }

dl() { # $1=url $2=filename
    [ -f "$SRC/$2" ] || { echo "  Downloading $2..."; curl -sL -o "$SRC/$2" "$1"; }
}

# ============================================================
# Layer 0: No external dependencies
# ============================================================

build_zstd() {
    step_done zstd && return
    echo "==> [1/24] zstd $V_ZSTD"
    dl "https://github.com/facebook/zstd/archive/refs/tags/v${V_ZSTD}.tar.gz" "zstd.tar.gz"
    cd "$SRC" && [ -d "zstd-${V_ZSTD}" ] || tar xzf zstd.tar.gz
    cd "zstd-${V_ZSTD}" && rm -rf _b
    cmake -S build/cmake -B _b "${CMAKE_ARGS[@]}" \
        -DZSTD_BUILD_STATIC=OFF -DZSTD_BUILD_PROGRAMS=OFF -DZSTD_BUILD_TESTS=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done zstd
}

build_xz() {
    step_done xz && return
    echo "==> [2/24] xz $V_XZ"
    dl "https://github.com/tukaani-project/xz/releases/download/v${V_XZ}/xz-${V_XZ}.tar.gz" "xz.tar.gz"
    cd "$SRC" && [ -d "xz-${V_XZ}" ] || tar xzf xz.tar.gz
    cd "xz-${V_XZ}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DBUILD_SHARED_LIBS=ON -DBUILD_TESTING=OFF \
        -DCREATE_XZ_SYMLINKS=OFF -DCREATE_LZMA_SYMLINKS=OFF \
        -DXZ_NLS=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done xz
}

build_pcre2() {
    step_done pcre2 && return
    echo "==> [3/24] pcre2 $V_PCRE2"
    dl "https://github.com/PCRE2Project/pcre2/releases/download/pcre2-${V_PCRE2}/pcre2-${V_PCRE2}.tar.bz2" "pcre2.tar.bz2"
    cd "$SRC" && [ -d "pcre2-${V_PCRE2}" ] || tar xjf pcre2.tar.bz2
    cd "pcre2-${V_PCRE2}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DBUILD_SHARED_LIBS=ON -DBUILD_STATIC_LIBS=OFF \
        -DPCRE2_BUILD_TESTS=OFF -DPCRE2_BUILD_PCRE2GREP=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done pcre2
}

build_uchardet() {
    step_done uchardet && return
    echo "==> [4/24] uchardet $V_UCHARDET"
    dl "https://www.freedesktop.org/software/uchardet/releases/uchardet-${V_UCHARDET}.tar.xz" "uchardet.tar.xz"
    cd "$SRC" && [ -d "uchardet-${V_UCHARDET}" ] || tar xJf uchardet.tar.xz
    cd "uchardet-${V_UCHARDET}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DBUILD_SHARED_LIBS=ON -DBUILD_STATIC=OFF -DBUILD_BINARY=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done uchardet
}

# ============================================================
# Layer 1: No cross-library dependencies
# ============================================================

build_openssl() {
    step_done openssl && return
    echo "==> [5/24] openssl $V_OPENSSL"
    dl "https://github.com/openssl/openssl/releases/download/openssl-${V_OPENSSL}/openssl-${V_OPENSSL}.tar.gz" "openssl.tar.gz"
    cd "$SRC" && [ -d "openssl-${V_OPENSSL}" ] || tar xzf openssl.tar.gz
    cd "openssl-${V_OPENSSL}"
    # Clean previous build if any
    make clean 2>/dev/null || true
    local ssl_target="darwin64-arm64-cc"
    [ "$ARCH" = "x86_64" ] && ssl_target="darwin64-x86_64-cc"
    ./Configure "$ssl_target" \
        --prefix="$PREFIX" \
        --openssldir="$PREFIX/etc/openssl" \
        shared no-tests no-docs \
        -mmacosx-version-min=$MIN_MACOS
    make -j$JOBS
    make install_sw
    mark_done openssl
}

build_libpng() {
    step_done libpng && return
    echo "==> [6/24] libpng $V_PNG"
    dl "https://downloads.sourceforge.net/project/libpng/libpng16/${V_PNG}/libpng-${V_PNG}.tar.xz" "libpng.tar.xz"
    cd "$SRC" && [ -d "libpng-${V_PNG}" ] || tar xJf libpng.tar.xz
    cd "libpng-${V_PNG}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DPNG_SHARED=ON -DPNG_STATIC=OFF -DPNG_TESTS=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done libpng
}

build_jpeg_turbo() {
    step_done jpeg_turbo && return
    echo "==> [7/24] libjpeg-turbo $V_JPEGTURBO"
    dl "https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/${V_JPEGTURBO}/libjpeg-turbo-${V_JPEGTURBO}.tar.gz" "jpegturbo.tar.gz"
    cd "$SRC" && [ -d "libjpeg-turbo-${V_JPEGTURBO}" ] || tar xzf jpegturbo.tar.gz
    cd "libjpeg-turbo-${V_JPEGTURBO}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DENABLE_SHARED=ON -DENABLE_STATIC=OFF -DWITH_TURBOJPEG=ON
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done jpeg_turbo
}

build_dav1d() {
    step_done dav1d && return
    echo "==> [8/24] dav1d $V_DAV1D"
    dl "https://code.videolan.org/videolan/dav1d/-/archive/${V_DAV1D}/dav1d-${V_DAV1D}.tar.bz2" "dav1d.tar.bz2"
    cd "$SRC" && [ -d "dav1d-${V_DAV1D}" ] || tar xjf dav1d.tar.bz2
    cd "dav1d-${V_DAV1D}" && rm -rf _b
    meson setup _b $MESON_ARGS \
        -Denable_tests=false -Denable_tools=false
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done dav1d
}

build_opus() {
    step_done opus && return
    echo "==> [9/24] opus $V_OPUS"
    dl "https://ftp.osuosl.org/pub/xiph/releases/opus/opus-${V_OPUS}.tar.gz" "opus.tar.gz"
    cd "$SRC" && [ -d "opus-${V_OPUS}" ] || tar xzf opus.tar.gz
    cd "opus-${V_OPUS}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DBUILD_SHARED_LIBS=ON -DOPUS_BUILD_TESTING=OFF -DOPUS_BUILD_PROGRAMS=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done opus
}

build_fribidi() {
    step_done fribidi && return
    echo "==> [10/24] fribidi $V_FRIBIDI"
    dl "https://github.com/fribidi/fribidi/releases/download/v${V_FRIBIDI}/fribidi-${V_FRIBIDI}.tar.xz" "fribidi.tar.xz"
    cd "$SRC" && [ -d "fribidi-${V_FRIBIDI}" ] || tar xJf fribidi.tar.xz
    cd "fribidi-${V_FRIBIDI}" && rm -rf _b
    meson setup _b $MESON_ARGS \
        -Dtests=false -Ddocs=false
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done fribidi
}

build_lcms2() {
    step_done lcms2 && return
    echo "==> [11/24] lcms2 $V_LCMS2"
    dl "https://downloads.sourceforge.net/project/lcms/lcms/${V_LCMS2}/lcms2-${V_LCMS2}.tar.gz" "lcms2.tar.gz"
    cd "$SRC" && [ -d "lcms2-${V_LCMS2}" ] || tar xzf lcms2.tar.gz
    cd "lcms2-${V_LCMS2}" && rm -rf _b
    meson setup _b $MESON_ARGS
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done lcms2
}

build_zimg() {
    step_done zimg && return
    echo "==> [12/24] zimg $V_ZIMG"
    dl "https://github.com/sekrit-twc/zimg/archive/refs/tags/release-${V_ZIMG}.tar.gz" "zimg.tar.gz"
    cd "$SRC" && [ -d "zimg-release-${V_ZIMG}" ] || tar xzf zimg.tar.gz
    cd "zimg-release-${V_ZIMG}"
    [ -f configure ] || autoreconf -fi
    make clean 2>/dev/null || true
    ./configure --prefix="$PREFIX" --disable-static --enable-shared $AUTOTOOLS_HOST
    make -j$JOBS
    make install
    mark_done zimg
}

build_libsamplerate() {
    step_done libsamplerate && return
    echo "==> libsamplerate $V_SAMPLERATE"
    dl "https://github.com/libsndfile/libsamplerate/archive/refs/tags/${V_SAMPLERATE}.tar.gz" "samplerate.tar.gz"
    cd "$SRC" && [ -d "libsamplerate-${V_SAMPLERATE}" ] || tar xzf samplerate.tar.gz
    cd "libsamplerate-${V_SAMPLERATE}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DBUILD_SHARED_LIBS=ON -DBUILD_TESTING=OFF -DLIBSAMPLERATE_EXAMPLES=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done libsamplerate
}

build_libunibreak() {
    step_done libunibreak && return
    echo "==> libunibreak $V_UNIBREAK"
    dl "https://github.com/adah1972/libunibreak/releases/download/libunibreak_$(echo ${V_UNIBREAK} | tr . _)/libunibreak-${V_UNIBREAK}.tar.gz" "libunibreak.tar.gz"
    cd "$SRC" && [ -d "libunibreak-${V_UNIBREAK}" ] || tar xzf libunibreak.tar.gz
    cd "libunibreak-${V_UNIBREAK}"
    [ -f configure ] || autoreconf -fi
    make clean 2>/dev/null || true
    ./configure --prefix="$PREFIX" --disable-static --enable-shared $AUTOTOOLS_HOST
    make -j$JOBS
    make install
    mark_done libunibreak
}

# ============================================================
# Layer 2: Intermediate dependencies
# ============================================================

build_gettext() {
    step_done gettext && return
    echo "==> [13/24] gettext $V_GETTEXT (libintl only)"
    dl "https://ftpmirror.gnu.org/gnu/gettext/gettext-${V_GETTEXT}.tar.gz" "gettext.tar.gz"
    cd "$SRC" && [ -d "gettext-${V_GETTEXT}" ] || tar xzf gettext.tar.gz
    # Only build the intl library from gettext-runtime - skip everything else
    cd "gettext-${V_GETTEXT}/gettext-runtime/intl"
    if [ ! -f Makefile ]; then
        # Configure the parent to generate Makefile, but we only build intl
        cd "$SRC/gettext-${V_GETTEXT}/gettext-runtime"
        ./configure --prefix="$PREFIX" --disable-static --enable-shared $AUTOTOOLS_HOST \
            --disable-java --disable-csharp --disable-libasprintf \
            --with-included-gettext --without-emacs \
            --disable-curses --disable-acl --disable-openmp \
            --disable-threads --disable-nls
        cd intl
    fi
    make -j$JOBS
    make install
    # make install may not install dylib during cross-compilation, manually ensure it is in place
    if [ ! -f "$PREFIX/lib/libintl.8.dylib" ] && [ -f .libs/libgnuintl.8.dylib ]; then
        echo "  [gettext] make install missed dylib, installing manually..."
        cp .libs/libgnuintl.8.dylib "$PREFIX/lib/libintl.8.dylib"
        ln -sf libintl.8.dylib "$PREFIX/lib/libintl.dylib"
        install_name_tool -id "@rpath/libintl.8.dylib" "$PREFIX/lib/libintl.8.dylib"
    fi
    if [ ! -f "$PREFIX/include/libintl.h" ] && [ -f libgnuintl.h ]; then
        cp libgnuintl.h "$PREFIX/include/libintl.h"
    fi
    # Also install the pkg-config file if not present
    if [ ! -f "$PREFIX/lib/pkgconfig/intl.pc" ]; then
        cat > "$PREFIX/lib/pkgconfig/intl.pc" << PCEOF
prefix=$PREFIX
exec_prefix=\${prefix}
libdir=\${exec_prefix}/lib
includedir=\${prefix}/include

Name: libintl
Description: GNU Internationalization library
Version: $V_GETTEXT
Libs: -L\${libdir} -lintl
Cflags: -I\${includedir}
PCEOF
    fi
    mark_done gettext
}

build_freetype() {
    local pass="${1:-1}"
    local stamp="freetype_p${pass}"
    step_done "$stamp" && return
    echo "==> freetype $V_FREETYPE (pass $pass)"
    dl "https://downloads.sourceforge.net/project/freetype/freetype2/${V_FREETYPE}/freetype-${V_FREETYPE}.tar.xz" "freetype.tar.xz"
    cd "$SRC" && [ -d "freetype-${V_FREETYPE}" ] || tar xJf freetype.tar.xz
    cd "freetype-${V_FREETYPE}" && rm -rf _b
    local hb_flag="disabled"
    [ "$pass" = "2" ] && hb_flag="enabled"
    # Use meson for freetype (better macOS support)
    meson setup _b $MESON_ARGS \
        -Dharfbuzz=$hb_flag \
        -Dpng=enabled \
        -Dbrotli=disabled \
        -Dbzip2=disabled \
        -Dmmap=enabled
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done "$stamp"
}

# ============================================================
# Layer 3: Text / Font stack
# ============================================================

build_glib() {
    step_done glib && return
    echo "==> [15/24] glib $V_GLIB"
    local glib_minor
    glib_minor=$(echo "$V_GLIB" | cut -d. -f1-2)
    dl "https://download.gnome.org/sources/glib/${glib_minor}/glib-${V_GLIB}.tar.xz" "glib.tar.xz"
    cd "$SRC" && [ -d "glib-${V_GLIB}" ] || tar xJf glib.tar.xz
    cd "glib-${V_GLIB}" && rm -rf _b
    meson setup _b $MESON_ARGS \
        -Dtests=false -Dintrospection=disabled -Dnls=disabled \
        -Dgio_module_dir="$PREFIX/lib/gio/modules" \
        --force-fallback-for=gvdb
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done glib
}

build_harfbuzz() {
    step_done harfbuzz && return
    echo "==> [16/24] harfbuzz $V_HARFBUZZ"
    dl "https://github.com/harfbuzz/harfbuzz/releases/download/${V_HARFBUZZ}/harfbuzz-${V_HARFBUZZ}.tar.xz" "harfbuzz.tar.xz"
    cd "$SRC" && [ -d "harfbuzz-${V_HARFBUZZ}" ] || tar xJf harfbuzz.tar.xz
    cd "harfbuzz-${V_HARFBUZZ}" && rm -rf _b
    meson setup _b $MESON_ARGS \
        -Dglib=enabled -Dfreetype=enabled -Dcoretext=enabled \
        -Dcairo=disabled \
        -Dtests=disabled -Dintrospection=disabled -Ddocs=disabled -Dbenchmark=disabled
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done harfbuzz
}

build_fontconfig() {
    step_done fontconfig && return
    echo "==> [18/24] fontconfig $V_FONTCONFIG"
    dl "https://gitlab.freedesktop.org/fontconfig/fontconfig/-/archive/${V_FONTCONFIG}/fontconfig-${V_FONTCONFIG}.tar.gz" "fontconfig.tar.gz"
    cd "$SRC" && [ -d "fontconfig-${V_FONTCONFIG}" ] || tar xzf fontconfig.tar.gz
    cd "fontconfig-${V_FONTCONFIG}" && rm -rf _b
    meson setup _b $MESON_ARGS \
        -Dtests=disabled -Ddoc=disabled -Dcache-build=disabled
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done fontconfig
}

# ============================================================
# Layer 4: Subtitle
# ============================================================

build_libass() {
    step_done libass && return
    echo "==> [19/24] libass $V_LIBASS"
    dl "https://github.com/libass/libass/releases/download/${V_LIBASS}/libass-${V_LIBASS}.tar.xz" "libass.tar.xz"
    cd "$SRC" && [ -d "libass-${V_LIBASS}" ] || tar xJf libass.tar.xz
    cd "libass-${V_LIBASS}" && rm -rf _b
    # libass 0.17+ uses meson
    if [ -f meson.build ]; then
        meson setup _b $MESON_ARGS \
            -Dcoretext=enabled -Dfontconfig=enabled
        meson compile -C _b -j$JOBS
        meson install -C _b
    else
        # Fallback to autotools for older versions
        [ -f configure ] || autoreconf -fi
        ./configure --prefix="$PREFIX" --disable-static --enable-shared $AUTOTOOLS_HOST
        make -j$JOBS
        make install
    fi
    mark_done libass
}

# ============================================================
# Layer 4b: Blu-ray
# ============================================================

build_libbluray() {
    step_done libbluray && return
    echo "==> libbluray $V_LIBBLURAY"
    dl "https://code.videolan.org/videolan/libbluray/-/archive/${V_LIBBLURAY}/libbluray-${V_LIBBLURAY}.tar.bz2" "libbluray.tar.bz2"
    cd "$SRC" && [ -d "libbluray-${V_LIBBLURAY}" ] || tar xjf libbluray.tar.bz2
    cd "libbluray-${V_LIBBLURAY}"
    [ -f configure ] || autoreconf -fi
    make clean 2>/dev/null || true
    ./configure --prefix="$PREFIX" --disable-static --enable-shared $AUTOTOOLS_HOST \
        --disable-bdjava-jar \
        --without-bdj-type \
        --disable-doxygen-doc
    make -j$JOBS
    make install
    mark_done libbluray
}

# ============================================================
# Layer 5: GPU rendering (Vulkan + Shaderc + libplacebo)
# ============================================================

build_vulkan_headers() {
    step_done vulkan_headers && return
    echo "==> [20/24] vulkan-headers $V_VULKAN"
    dl "https://github.com/KhronosGroup/Vulkan-Headers/archive/refs/tags/vulkan-sdk-${V_VULKAN}.tar.gz" "vulkan-headers.tar.gz"
    cd "$SRC" && [ -d "Vulkan-Headers-vulkan-sdk-${V_VULKAN}" ] || tar xzf vulkan-headers.tar.gz
    cd "Vulkan-Headers-vulkan-sdk-${V_VULKAN}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}"
    cmake --install _b
    mark_done vulkan_headers
}

build_vulkan_loader() {
    step_done vulkan_loader && return
    echo "==> [21/24] vulkan-loader $V_VULKAN"
    dl "https://github.com/KhronosGroup/Vulkan-Loader/archive/refs/tags/vulkan-sdk-${V_VULKAN}.tar.gz" "vulkan-loader.tar.gz"
    cd "$SRC" && [ -d "Vulkan-Loader-vulkan-sdk-${V_VULKAN}" ] || tar xzf vulkan-loader.tar.gz
    cd "Vulkan-Loader-vulkan-sdk-${V_VULKAN}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DBUILD_SHARED_LIBS=ON -DBUILD_TESTS=OFF \
        -DVULKAN_HEADERS_INSTALL_DIR="$PREFIX"
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done vulkan_loader
}

build_shaderc() {
    step_done shaderc && return
    echo "==> [22/24] shaderc $V_SHADERC"
    cd "$SRC"
    if [ ! -d "shaderc" ]; then
        git clone --depth 1 https://github.com/google/shaderc.git
    fi
    cd shaderc
    git fetch --tags --depth 1
    git checkout "v${V_SHADERC}" 2>/dev/null || git checkout "tags/v${V_SHADERC}" 2>/dev/null || true
    # Sync sub-dependencies (spirv-tools, glslang, spirv-headers)
    python3 utils/git-sync-deps
    rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DSHADERC_SKIP_TESTS=ON -DSHADERC_SKIP_EXAMPLES=ON \
        -DSHADERC_SKIP_COPYRIGHT_CHECK=ON \
        -DSPIRV_SKIP_TESTS=ON -DSPIRV_SKIP_EXECUTABLES=ON \
        -DENABLE_GLSLANG_BINARIES=OFF \
        -DSPIRV_CHECK_CONTEXT=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done shaderc
}

build_libplacebo() {
    step_done libplacebo && return
    echo "==> [23/24] libplacebo $V_PLACEBO"
    cd "$SRC"
    if [ ! -d "libplacebo" ]; then
        git clone --depth 1 --branch "v${V_PLACEBO}" \
            --recurse-submodules --shallow-submodules \
            https://code.videolan.org/videolan/libplacebo.git
    fi
    cd libplacebo && rm -rf _b
    meson setup _b $MESON_ARGS \
        -Db_ndebug=true \
        -Dvulkan=enabled -Dshaderc=enabled -Dlcms=enabled \
        -Dd3d11=disabled -Dtests=false -Ddemos=false -Dbench=false
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done libplacebo
}

# ============================================================
# Layer 6: FFmpeg (minimal, playback-only)
# ============================================================

build_ffmpeg() {
    step_done ffmpeg && return
    echo "==> [24/24] FFmpeg $V_FFMPEG"
    dl "https://ffmpeg.org/releases/ffmpeg-${V_FFMPEG}.tar.xz" "ffmpeg.tar.xz"
    cd "$SRC" && [ -d "ffmpeg-${V_FFMPEG}" ] || tar xJf ffmpeg.tar.xz
    cd "ffmpeg-${V_FFMPEG}"
    make clean 2>/dev/null || true

    # FFmpeg cross-compile args
    local ff_arch_args=""
    if [ "$ARCH" = "x86_64" ]; then
        ff_arch_args="--arch=x86_64 --enable-cross-compile --target-os=darwin"
    fi

    ./configure \
        --prefix="$PREFIX" \
        --enable-shared --disable-static \
        --enable-gpl --enable-nonfree \
        --enable-pthreads \
        --enable-openssl \
        --enable-libdav1d \
        --enable-libopus \
        --enable-libplacebo \
        --enable-libfreetype \
        --enable-libharfbuzz \
        --enable-libfontconfig \
        --enable-libass \
        --enable-libzimg \
        --enable-videotoolbox \
        --enable-audiotoolbox \
        --disable-programs \
        --disable-doc \
        --disable-debug \
        --disable-xlib \
        --disable-libxcb \
        --disable-libxcb-shm \
        --disable-libxcb-xfixes \
        --disable-libxcb-shape \
        --extra-cflags="-arch $ARCH -I$PREFIX/include -mmacosx-version-min=$MIN_MACOS" \
        --extra-cxxflags="-arch $ARCH -I$PREFIX/include -mmacosx-version-min=$MIN_MACOS" \
        --extra-ldflags="-arch $ARCH -L$PREFIX/lib -mmacosx-version-min=$MIN_MACOS" \
        $ff_arch_args

    make -j$JOBS
    make install
    mark_done ffmpeg
}

# ============================================================
# Verification
# ============================================================

verify_minos() {
    echo ""
    echo "=== Verifying deployment targets ==="
    local bad=0
    local total=0
    local ok=0
    for lib in "$PREFIX"/lib/*.dylib; do
        [ -L "$lib" ] && continue
        [ ! -f "$lib" ] && continue
        total=$((total + 1))
        local m
        m=$(otool -l "$lib" 2>/dev/null | grep -A5 "LC_BUILD_VERSION" | grep "minos" | awk '{print $2}')
        if [ -z "$m" ]; then
            continue
        fi
        # Compare versions: convert X.Y to integer XYY for comparison
        local mv tv
        mv=$(echo "$m" | awk -F. '{printf "%d%02d", $1, ($2+0)}')
        tv=$(echo "$MIN_MACOS" | awk -F. '{printf "%d%02d", $1, ($2+0)}')
        if [ "$mv" -gt "$tv" ]; then
            echo "  FAIL: $(basename "$lib") minos=$m (need <=$MIN_MACOS)"
            bad=$((bad + 1))
        else
            ok=$((ok + 1))
        fi
    done
    echo "  Result: $ok/$total passed"
    if [ "$bad" -gt 0 ]; then
        echo "  WARNING: $bad libraries have minos > $MIN_MACOS"
        return 1
    fi
    echo "  All libraries have minos <= $MIN_MACOS"
}

# ============================================================
# Main
# ============================================================

main() {
    echo "============================================="
    echo " Building mpv dependencies from source"
    echo " Target: macOS $MIN_MACOS+ ($ARCH)"
    echo " Prefix: $PREFIX"
    echo " CPUs:   $JOBS"
    echo "============================================="
    echo ""

    check_prereqs

    # Layer 0: No deps
    build_zstd
    build_xz
    build_pcre2
    build_uchardet

    # Layer 1: No cross-deps
    build_openssl
    build_libpng
    build_jpeg_turbo
    build_dav1d
    build_opus
    build_fribidi
    build_lcms2
    build_zimg
    build_libsamplerate
    build_libunibreak

    # Layer 2: Intermediate
    build_gettext
    build_freetype 1    # pass 1: without harfbuzz

    # Layer 3: Text/Font
    build_glib
    build_harfbuzz
    build_freetype 2    # pass 2: with harfbuzz
    build_fontconfig

    # Layer 4: Subtitle
    build_libass

    # Layer 4b: Blu-ray
    build_libbluray

    # Layer 5: GPU
    build_vulkan_headers
    build_vulkan_loader
    build_shaderc
    build_libplacebo

    # Layer 6: FFmpeg
    build_ffmpeg

    # Verify
    verify_minos

    echo ""
    echo "============================================="
    echo " BUILD COMPLETE"
    echo "============================================="
    echo ""
    echo "Next steps:"
    echo "  1. Build mpv:"
    echo "     PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig ./build_mpv.sh"
    echo ""
    echo "  2. Copy dependencies:"
    echo "     ./copy_dependencies.sh"
    echo ""
}

main "$@"
