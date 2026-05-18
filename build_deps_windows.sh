#!/bin/bash
set -eo pipefail

# ============================================================
# build_deps_windows.sh
# Build all mpv dependencies from source for Windows x64 (MSYS2 CLANG64)
#
# Usage (in MSYS2 CLANG64 terminal):
#   ./build_deps_windows.sh              # Build all dependencies
#   ./build_deps_windows.sh clean        # Remove all build artifacts
#   SKIP_SHADERC=1 ./build_deps_windows.sh  # Skip slow shaderc build
#
# Re-runnable: skips already-built libraries (stamp files).
# To rebuild a single lib: rm deps/stamps-win64/<libname>
#
# Mirrors build_deps_macos.sh — same minimal feature set,
# producing ~50–60 MB of DLLs instead of ~178 MB from MSYS2 packages.
# ============================================================

# ---- Check MSYS2 environment ----
if [[ -z "$MSYSTEM" ]]; then
    echo "ERROR: Run this script inside MSYS2 CLANG64 terminal."
    echo "       pacman -S mingw-w64-clang-x86_64-toolchain"
    exit 1
fi

# Prefer CLANG64 for smaller binaries and better LTO support
TOOLCHAIN_PREFIX="${MSYSTEM_PREFIX:-/clang64}"
echo "==> Using MSYS2 environment: $MSYSTEM ($TOOLCHAIN_PREFIX)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="$SCRIPT_DIR/deps/win64"
SRC="$SCRIPT_DIR/deps/src"
STAMPS="$SCRIPT_DIR/deps/stamps-win64"
JOBS=$(nproc 2>/dev/null || echo 4)

# ---- Handle 'clean' command ----
if [ "${1:-}" = "clean" ]; then
    echo "Removing all Windows build artifacts..."
    rm -rf "$PREFIX" "$STAMPS"
    echo "Done. Run ./build_deps_windows.sh to rebuild."
    exit 0
fi

# ---- Library versions (match build_deps_macos.sh, 2026-03) ----
V_ZSTD="1.5.7"
V_XZ="5.8.2"
V_PCRE2="10.47"
V_OPENSSL="3.6.1"
V_PNG="1.6.55"
V_JPEGTURBO="3.1.3"
V_DAV1D="1.5.3"
V_OPUS="1.6.1"
V_FRIBIDI="1.0.16"
V_LCMS2="2.18"
V_ZIMG="3.0.6"
V_UNIBREAK="6.1"
V_GETTEXT="1.0"
V_FREETYPE="2.14.2"
V_GLIB="2.88.0"
V_HARFBUZZ="13.2.1"
V_FONTCONFIG="2.17.1"
V_LIBASS="0.17.4"
V_VULKAN="1.4.341.0"
V_SHADERC="2026.1"
V_SPIRV_CROSS="vulkan-sdk-1.4.341.0"
V_PLACEBO="7.360.1"
V_FFMPEG="8.1"

# ---- Environment ----
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig:${TOOLCHAIN_PREFIX}/lib/pkgconfig:${TOOLCHAIN_PREFIX}/share/pkgconfig"
export PATH="$PREFIX/bin:$PATH"
export CC=clang
export CXX=clang++
# Only override DLLTOOL — other tools (ar, nm, ranlib) in /clang64/bin/ are
# already LLVM-based. Setting NM=llvm-nm breaks libtool (binary doesn't exist).
export DLLTOOL=llvm-dlltool
export CFLAGS="-O2 -I$PREFIX/include"
export CXXFLAGS="-O2 -I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib"
export CPPFLAGS="-I$PREFIX/include"

CMAKE_ARGS=(
    -DCMAKE_INSTALL_PREFIX="$PREFIX"
    -DCMAKE_PREFIX_PATH="$PREFIX"
    -DCMAKE_BUILD_TYPE=Release
    -DCMAKE_FIND_ROOT_PATH="$PREFIX"
    -G Ninja
)

MESON_ARGS="--prefix=$PREFIX --buildtype=release --default-library=shared --strip"

mkdir -p "$PREFIX"/{lib/pkgconfig,include,bin,share/pkgconfig} "$SRC" "$STAMPS"

# ============================================================
# Utility
# ============================================================

check_prereqs() {
    local missing=()
    for cmd in cmake meson ninja make pkg-config nasm python3 git curl strip llvm-dlltool; do
        command -v "$cmd" &>/dev/null || missing+=("$cmd")
    done
    if [ ${#missing[@]} -gt 0 ]; then
        echo "ERROR: Missing build tools: ${missing[*]}"
        echo "Install with: pacman -S pactoys && pacboy -S ${missing[*]}"
        exit 1
    fi
    echo "All build tools found."
}

step_done() { [ -f "$STAMPS/$1" ]; }
mark_done() { touch "$STAMPS/$1"; }

dl() { # $1=url $2=filename
    [ -f "$SRC/$2" ] || { echo "  Downloading $2..."; curl -sL -o "$SRC/$2" "$1"; }
}

# Windows/MSYS2 tar cannot create symlinks — extract and ignore symlink errors
untar() { # $1=archive  (optional extra tar flags after)
    local archive="$1"; shift
    tar xf "$archive" "$@" 2>&1 | grep -v 'Cannot create symlink' || true
}

# Regenerate import library using llvm-dlltool (fixes GNU libtool + lld incompatibility)
regen_implib() { # $1=dll_path $2=output .dll.a path
    local dll="$1" implib="$2"
    local deffile
    deffile=$(mktemp /tmp/implib-XXXXXX.def)
    local dllname
    dllname=$(basename "$dll")
    echo "  Regenerating import lib for $dllname..."
    # Try gendef first
    gendef - "$dll" > "$deffile" 2>/dev/null
    if [ ! -s "$deffile" ] || grep -q "definition file empty" "$deffile" 2>/dev/null; then
        # gendef failed — fall back to llvm-nm to extract exports
        echo "    gendef failed, using llvm-nm fallback..."
        echo "LIBRARY $dllname" > "$deffile"
        echo "EXPORTS" >> "$deffile"
        llvm-nm --extern-only --defined-only "$dll" 2>/dev/null | \
            awk '/^[0-9a-fA-F]+ [TtDdBb] / {print $3}' | \
            grep -v -E '^(__mingw|__gcc|__imp_|_CRT_|_tls_|_IMPORT_|DllMain|DllEntryPoint|_onexit|_amsg|__security|__report|__acrt|_Init_|_Fini_|__do_global|__cxa_|_register_|_gnu_|__dso_|__newcleanup|__lib[cm]_|_+GLOBAL_|_decode_pointer|_encode_pointer|_execute_onexit|_matherr|_set_app_type|atexit$|_fini$|_init$|_?_?real@)' | \
            sed 's/^/  /' >> "$deffile"
    fi
    local export_count
    # Count exported symbols: lines after EXPORTS that start with a letter (gendef)
    # or with leading spaces (llvm-nm fallback)
    export_count=$(sed -n '/^EXPORTS/,$ { /^EXPORTS/d; /^$/d; /^;/d; p; }' "$deffile" | wc -l) || export_count=0
    export_count=$((export_count + 0))  # ensure integer
    if [ "$export_count" -gt 0 ]; then
        llvm-dlltool -d "$deffile" -l "$implib" -D "$dllname" -m i386:x86-64
        echo "    OK: $export_count exports"
    else
        echo "    WARNING: no exports found in $dllname, keeping original import lib"
    fi
    rm -f "$deffile"
}

strip_dll() { # $1=path  — strip debug symbols from DLL
    local f="$1"
    if [ -f "$f" ] && file "$f" | grep -q "PE32"; then
        strip --strip-unneeded "$f" 2>/dev/null || true
    fi
}

# ============================================================
# Layer 0: No external dependencies
# ============================================================

build_zstd() {
    step_done zstd && return
    echo "==> [1/24] zstd $V_ZSTD"
    dl "https://github.com/facebook/zstd/archive/refs/tags/v${V_ZSTD}.tar.gz" "zstd.tar.gz"
    cd "$SRC" && [ -d "zstd-${V_ZSTD}" ] || untar zstd.tar.gz
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
    cd "$SRC" && [ -d "xz-${V_XZ}" ] || untar xz.tar.gz
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
    cd "$SRC" && [ -d "pcre2-${V_PCRE2}" ] || untar pcre2.tar.bz2
    cd "pcre2-${V_PCRE2}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DBUILD_SHARED_LIBS=ON -DBUILD_STATIC_LIBS=OFF \
        -DPCRE2_BUILD_TESTS=OFF -DPCRE2_BUILD_PCRE2GREP=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done pcre2
}

# ============================================================
# Layer 1: No cross-library dependencies
# ============================================================

build_openssl() {
    step_done openssl && return
    echo "==> [4/24] openssl $V_OPENSSL"
    dl "https://github.com/openssl/openssl/releases/download/openssl-${V_OPENSSL}/openssl-${V_OPENSSL}.tar.gz" "openssl.tar.gz"
    cd "$SRC" && [ -d "openssl-${V_OPENSSL}" ] || untar openssl.tar.gz
    cd "openssl-${V_OPENSSL}"
    make clean 2>/dev/null || true
    ./Configure mingw64 \
        --prefix="$PREFIX" \
        --openssldir="$PREFIX/etc/openssl" \
        shared no-tests no-docs no-quic
    make -j$JOBS
    make install_sw
    mark_done openssl
}

build_libpng() {
    step_done libpng && return
    echo "==> [5/24] libpng $V_PNG"
    dl "https://downloads.sourceforge.net/project/libpng/libpng16/${V_PNG}/libpng-${V_PNG}.tar.xz" "libpng.tar.xz"
    cd "$SRC" && [ -d "libpng-${V_PNG}" ] || untar libpng.tar.xz
    cd "libpng-${V_PNG}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DPNG_SHARED=ON -DPNG_STATIC=OFF -DPNG_TESTS=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done libpng
}

build_jpeg_turbo() {
    step_done jpeg_turbo && return
    echo "==> [6/24] libjpeg-turbo $V_JPEGTURBO"
    dl "https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/${V_JPEGTURBO}/libjpeg-turbo-${V_JPEGTURBO}.tar.gz" "jpegturbo.tar.gz"
    cd "$SRC" && [ -d "libjpeg-turbo-${V_JPEGTURBO}" ] || untar jpegturbo.tar.gz
    cd "libjpeg-turbo-${V_JPEGTURBO}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DENABLE_SHARED=ON -DENABLE_STATIC=OFF -DWITH_TURBOJPEG=ON
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done jpeg_turbo
}

build_dav1d() {
    step_done dav1d && return
    echo "==> [7/24] dav1d $V_DAV1D"
    dl "https://code.videolan.org/videolan/dav1d/-/archive/${V_DAV1D}/dav1d-${V_DAV1D}.tar.bz2" "dav1d.tar.bz2"
    cd "$SRC" && [ -d "dav1d-${V_DAV1D}" ] || untar dav1d.tar.bz2
    cd "dav1d-${V_DAV1D}" && rm -rf _b
    meson setup _b $MESON_ARGS \
        -Denable_tests=false -Denable_tools=false
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done dav1d
}

build_opus() {
    step_done opus && return
    echo "==> [8/24] opus $V_OPUS"
    dl "https://ftp.osuosl.org/pub/xiph/releases/opus/opus-${V_OPUS}.tar.gz" "opus.tar.gz"
    cd "$SRC" && [ -d "opus-${V_OPUS}" ] || untar opus.tar.gz
    cd "opus-${V_OPUS}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DBUILD_SHARED_LIBS=ON -DOPUS_BUILD_TESTING=OFF -DOPUS_BUILD_PROGRAMS=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done opus
}

build_fribidi() {
    step_done fribidi && return
    echo "==> [9/24] fribidi $V_FRIBIDI"
    dl "https://github.com/fribidi/fribidi/releases/download/v${V_FRIBIDI}/fribidi-${V_FRIBIDI}.tar.xz" "fribidi.tar.xz"
    cd "$SRC" && [ -d "fribidi-${V_FRIBIDI}" ] || untar fribidi.tar.xz
    cd "fribidi-${V_FRIBIDI}" && rm -rf _b
    meson setup _b $MESON_ARGS \
        -Dtests=false -Ddocs=false
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done fribidi
}

build_lcms2() {
    step_done lcms2 && return
    echo "==> [10/24] lcms2 $V_LCMS2"
    dl "https://downloads.sourceforge.net/project/lcms/lcms/${V_LCMS2}/lcms2-${V_LCMS2}.tar.gz" "lcms2.tar.gz"
    cd "$SRC" && [ -d "lcms2-${V_LCMS2}" ] || untar lcms2.tar.gz
    cd "lcms2-${V_LCMS2}" && rm -rf _b
    meson setup _b $MESON_ARGS
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done lcms2
}

build_zimg() {
    step_done zimg && return
    echo "==> [11/24] zimg $V_ZIMG"
    dl "https://github.com/sekrit-twc/zimg/archive/refs/tags/release-${V_ZIMG}.tar.gz" "zimg.tar.gz"
    cd "$SRC" && [ -d "zimg-release-${V_ZIMG}" ] || untar zimg.tar.gz
    cd "zimg-release-${V_ZIMG}"
    # Patch: use _msvc/zimg.def to export symbols (same as MSYS2 package)
    # zimg sets ZIMG_VISIBILITY to empty on _WIN32 and relies on export maps,
    # but the upstream Makefile.am doesn't pass -export-symbols to libtool.
    sed -i 's/^LIBRARY z$//' _msvc/zimg.def 2>/dev/null || true
    sed -i '/libzimg_la_LDFLAGS/s|-version-info 2$|-version-info 2 -export-symbols $(srcdir)/_msvc/zimg.def|' Makefile.am
    autoreconf -fi
    make clean 2>/dev/null || true
    LDFLAGS="-L$PREFIX/lib" \
    lt_cv_deplibs_check_method=pass_all \
        ./configure --prefix="$PREFIX" --disable-static --enable-shared
    make -j$JOBS
    make install
    # libtool on MSYS2 puts DLLs in bin/ — copy to lib/ for runtime discovery
    for dll in "$PREFIX"/bin/libzimg*.dll; do
        [ -f "$dll" ] && cp "$dll" "$PREFIX/lib/"
    done
    # Regenerate import lib with llvm-dlltool for lld compatibility
    local zimg_dll="$PREFIX/bin/libzimg-2.dll"
    [ -f "$zimg_dll" ] && regen_implib "$zimg_dll" "$PREFIX/lib/libzimg.dll.a"
    mark_done zimg
}

build_libunibreak() {
    step_done libunibreak && return
    echo "==> [12/24] libunibreak $V_UNIBREAK"
    dl "https://github.com/adah1972/libunibreak/releases/download/libunibreak_$(echo ${V_UNIBREAK} | tr . _)/libunibreak-${V_UNIBREAK}.tar.gz" "libunibreak.tar.gz"
    cd "$SRC" && [ -d "libunibreak-${V_UNIBREAK}" ] || untar libunibreak.tar.gz
    cd "libunibreak-${V_UNIBREAK}"
    [ -f configure ] || autoreconf -fi
    make clean 2>/dev/null || true
    ./configure --prefix="$PREFIX" --disable-static --enable-shared \
        LDFLAGS="-L$PREFIX/lib -Wl,--export-all-symbols"
    make -j$JOBS
    make install
    # libtool on MSYS2 puts DLLs in bin/
    for dll in "$PREFIX"/bin/libunibreak*.dll; do
        [ -f "$dll" ] && cp "$dll" "$PREFIX/lib/"
    done
    # Regenerate import lib for lld compatibility
    local ub_dll=$(ls "$PREFIX"/bin/libunibreak*.dll 2>/dev/null | head -1)
    [ -f "$ub_dll" ] && regen_implib "$ub_dll" "$PREFIX/lib/libunibreak.dll.a"
    mark_done libunibreak
}

# ============================================================
# Layer 2: Intermediate dependencies
# ============================================================

build_gettext() {
    step_done gettext && return
    echo "==> [13/24] gettext $V_GETTEXT (libintl only)"
    dl "https://ftpmirror.gnu.org/gnu/gettext/gettext-${V_GETTEXT}.tar.gz" "gettext.tar.gz"
    cd "$SRC" && [ -d "gettext-${V_GETTEXT}" ] || untar gettext.tar.gz
    cd "gettext-${V_GETTEXT}/gettext-runtime/intl"
    if [ ! -f Makefile ]; then
        cd "$SRC/gettext-${V_GETTEXT}/gettext-runtime"
        ./configure --prefix="$PREFIX" --disable-static --enable-shared \
            --disable-java --disable-csharp --disable-libasprintf \
            --with-included-gettext --without-emacs \
            --disable-curses --disable-acl --disable-openmp \
            --disable-threads --disable-nls
        cd intl
    fi
    make -j$JOBS
    make install
    # libtool + lld fixup
    local intl_dll=$(ls "$PREFIX"/bin/libintl*.dll 2>/dev/null | head -1)
    [ -f "$intl_dll" ] && regen_implib "$intl_dll" "$PREFIX/lib/libintl.dll.a"
    mark_done gettext
}

build_freetype() {
    local pass="${1:-1}"
    local stamp="freetype_p${pass}"
    step_done "$stamp" && return
    echo "==> freetype $V_FREETYPE (pass $pass)"
    dl "https://downloads.sourceforge.net/project/freetype/freetype2/${V_FREETYPE}/freetype-${V_FREETYPE}.tar.xz" "freetype.tar.xz"
    cd "$SRC" && [ -d "freetype-${V_FREETYPE}" ] || untar freetype.tar.xz
    cd "freetype-${V_FREETYPE}" && rm -rf _b
    local hb_flag="disabled"
    [ "$pass" = "2" ] && hb_flag="enabled"
    meson setup _b $MESON_ARGS \
        -Dharfbuzz=$hb_flag \
        -Dpng=enabled \
        -Dbrotli=disabled \
        -Dbzip2=disabled \
        -Dmmap=disabled
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
    cd "$SRC" && [ -d "glib-${V_GLIB}" ] || untar glib.tar.xz
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
    cd "$SRC" && [ -d "harfbuzz-${V_HARFBUZZ}" ] || untar harfbuzz.tar.xz
    cd "harfbuzz-${V_HARFBUZZ}" && rm -rf _b
    meson setup _b $MESON_ARGS \
        -Dglib=enabled -Dfreetype=enabled -Dcoretext=disabled \
        -Ddirectwrite=enabled \
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
    cd "$SRC" && [ -d "fontconfig-${V_FONTCONFIG}" ] || untar fontconfig.tar.gz
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
    cd "$SRC" && [ -d "libass-${V_LIBASS}" ] || untar libass.tar.xz
    cd "libass-${V_LIBASS}" && rm -rf _b
    if [ -f meson.build ]; then
        meson setup _b $MESON_ARGS \
            -Dcoretext=disabled -Ddirectwrite=enabled -Dfontconfig=enabled
        meson compile -C _b -j$JOBS
        meson install -C _b
    else
        [ -f configure ] || autoreconf -fi
        ./configure --prefix="$PREFIX" --disable-static --enable-shared
        make -j$JOBS
        make install
    fi
    mark_done libass
}

# ============================================================
# Layer 5: GPU rendering (Vulkan + Shaderc + libplacebo)
# ============================================================

build_vulkan_headers() {
    step_done vulkan_headers && return
    echo "==> [20/24] vulkan-headers $V_VULKAN"
    dl "https://github.com/KhronosGroup/Vulkan-Headers/archive/refs/tags/vulkan-sdk-${V_VULKAN}.tar.gz" "vulkan-headers.tar.gz"
    cd "$SRC" && [ -d "Vulkan-Headers-vulkan-sdk-${V_VULKAN}" ] || untar vulkan-headers.tar.gz
    cd "Vulkan-Headers-vulkan-sdk-${V_VULKAN}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}"
    cmake --install _b
    # Generate vulkan.pc so meson can find headers via pkg-config.
    # The Vulkan loader DLL is provided by the GPU driver; we only link
    # against the system import lib but need our own headers.
    cat > "$PREFIX/lib/pkgconfig/vulkan.pc" <<VPKG
prefix=$PREFIX
exec_prefix=\${prefix}
libdir=${TOOLCHAIN_PREFIX}/lib
includedir=\${prefix}/include

Name: Vulkan-Loader
Description: Vulkan Loader
Version: ${V_VULKAN%.0}
Libs: -L\${libdir} -lvulkan-1
Cflags: -I\${includedir}
VPKG
    mark_done vulkan_headers
}

# On Windows, the Vulkan loader is provided by the GPU driver / Vulkan SDK.
# No need to build it from source — just install headers above.

build_shaderc() {
    if [ -n "${SKIP_SHADERC:-}" ]; then
        echo "==> [22/24] shaderc SKIPPED (SKIP_SHADERC=1)"
        echo "    Using system shaderc from: $(pkg-config --libs shaderc 2>/dev/null || echo 'not found')"
        return
    fi
    step_done shaderc && return
    echo "==> [22/24] shaderc $V_SHADERC"
    cd "$SRC"
    if [ ! -d "shaderc" ]; then
        git clone --depth 1 https://github.com/google/shaderc.git
    fi
    cd shaderc
    git fetch --tags --depth 1
    git checkout "v${V_SHADERC}" 2>/dev/null || git checkout "tags/v${V_SHADERC}" 2>/dev/null || true
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

build_spirv_cross() {
    step_done spirv_cross && return
    echo "==> [21.5/24] spirv-cross $V_SPIRV_CROSS"
    dl "https://github.com/KhronosGroup/SPIRV-Cross/archive/refs/tags/${V_SPIRV_CROSS}.tar.gz" "spirv-cross.tar.gz"
    cd "$SRC" && [ -d "SPIRV-Cross-${V_SPIRV_CROSS}" ] || untar spirv-cross.tar.gz
    cd "SPIRV-Cross-${V_SPIRV_CROSS}" && rm -rf _b
    cmake -S . -B _b "${CMAKE_ARGS[@]}" \
        -DSPIRV_CROSS_SHARED=ON -DSPIRV_CROSS_STATIC=OFF \
        -DSPIRV_CROSS_CLI=OFF -DSPIRV_CROSS_ENABLE_TESTS=OFF
    cmake --build _b -j$JOBS
    cmake --install _b
    mark_done spirv_cross
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
        -Dd3d11=enabled \
        -Dtests=false -Ddemos=false -Dbench=false
    meson compile -C _b -j$JOBS
    meson install -C _b
    mark_done libplacebo
}

# ============================================================
# Layer 6: FFmpeg (minimal, playback-only — matching macOS)
# ============================================================

build_ffmpeg() {
    step_done ffmpeg && return
    echo "==> [24/24] FFmpeg $V_FFMPEG"
    dl "https://ffmpeg.org/releases/ffmpeg-${V_FFMPEG}.tar.xz" "ffmpeg.tar.xz"
    cd "$SRC" && [ -d "ffmpeg-${V_FFMPEG}" ] || untar ffmpeg.tar.xz
    cd "ffmpeg-${V_FFMPEG}"
    make clean 2>/dev/null || true

    PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig" \
    PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig:${TOOLCHAIN_PREFIX}/lib/pkgconfig:${TOOLCHAIN_PREFIX}/share/pkgconfig" \
    ./configure \
        --cc=clang --cxx=clang++ \
        --prefix="$PREFIX" \
        --enable-shared --disable-static \
        --enable-gpl --enable-nonfree \
        --enable-openssl \
        --enable-libdav1d \
        --enable-libopus \
        --enable-libplacebo \
        --enable-libfreetype \
        --enable-libharfbuzz \
        --enable-libfontconfig \
        --enable-libass \
        --enable-libzimg \
        --enable-d3d11va \
        --enable-dxva2 \
        --disable-programs \
        --disable-doc \
        --disable-debug \
        --disable-filter=gfxcapture \
        --disable-xlib \
        --disable-libxcb \
        --disable-libxcb-shm \
        --disable-libxcb-xfixes \
        --disable-libxcb-shape \
        --extra-cflags="-I$PREFIX/include" \
        --extra-cxxflags="-I$PREFIX/include" \
        --extra-ldflags="-L$PREFIX/lib"

    make -j$JOBS
    make install

    # FFmpeg import libs are generated by GNU dlltool, which is incompatible with lld
    # Regenerate with llvm-dlltool to fix link errors like "avfilter was replaced"
    echo "  Regenerating FFmpeg import libs for lld compatibility..."
    for fflib in avcodec avformat avfilter avutil swscale swresample; do
        local ff_dll=""
        # FFmpeg DLLs may be named with or without 'lib' prefix
        ff_dll=$(ls "$PREFIX/bin/lib${fflib}-"*.dll "$PREFIX/bin/${fflib}-"*.dll 2>/dev/null | head -1 || true)
        if [ -n "$ff_dll" ] && [ -f "$ff_dll" ]; then
            regen_implib "$ff_dll" "$PREFIX/lib/lib${fflib}.dll.a"
        else
            echo "  Not found ${fflib}-*.dll, skipping"
        fi
    done

    mark_done ffmpeg
}

# ============================================================
# Post-build: Strip + collect DLLs
# ============================================================

strip_all_dlls() {
    echo ""
    echo "==> Stripping all DLLs..."
    local count=0
    local saved=0
    for dll in "$PREFIX"/bin/*.dll "$PREFIX"/lib/*.dll; do
        [ -f "$dll" ] || continue
        local before after
        before=$(stat -c%s "$dll" 2>/dev/null || stat -f%z "$dll" 2>/dev/null)
        strip --strip-unneeded "$dll" 2>/dev/null || true
        after=$(stat -c%s "$dll" 2>/dev/null || stat -f%z "$dll" 2>/dev/null)
        if [ "$before" -gt "$after" ]; then
            local diff=$(( (before - after) / 1024 ))
            echo "  Stripped $(basename "$dll"): -${diff}KB"
            saved=$((saved + before - after))
        fi
        count=$((count + 1))
    done
    echo "  Stripped $count DLLs, saved $((saved / 1024 / 1024))MB total"
}

collect_dlls() {
    echo ""
    echo "==> Collecting DLLs to vendor directory..."
    local VENDOR_DIR="$SCRIPT_DIR/vendor/mpv/win32-x64"
    mkdir -p "$VENDOR_DIR/lib"

    # On Windows/MSYS2, shared libs may be in bin/ or lib/
    local total=0
    for dll in "$PREFIX"/bin/*.dll "$PREFIX"/lib/*.dll; do
        [ -f "$dll" ] || continue
        local name=$(basename "$dll")
        cp "$dll" "$VENDOR_DIR/lib/$name"
        total=$((total + 1))
    done

    echo "  Collected $total DLLs to $VENDOR_DIR/lib/"

    # Report total size
    local size
    size=$(du -sh "$VENDOR_DIR/lib/" 2>/dev/null | cut -f1)
    echo "  Total DLL size: $size"
}

# ============================================================
# Main
# ============================================================

main() {
    echo "============================================="
    echo " Building mpv dependencies from source"
    echo " Target: Windows x64 (MSYS2 $MSYSTEM)"
    echo " Prefix: $PREFIX"
    echo " CPUs:   $JOBS"
    echo "============================================="
    echo ""

    check_prereqs

    # Layer 0: No deps
    build_zstd
    build_xz
    build_pcre2

    # Layer 1: No cross-deps
    build_openssl
    build_libpng
    build_jpeg_turbo
    build_dav1d
    build_opus
    build_fribidi
    build_lcms2
    build_zimg
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

    # Layer 5: GPU
    build_vulkan_headers
    build_shaderc
    build_spirv_cross
    build_libplacebo

    # Layer 6: FFmpeg
    build_ffmpeg

    # Post-build
    strip_all_dlls

    echo ""
    echo "============================================="
    echo " BUILD COMPLETE"
    echo "============================================="
    echo ""
    echo "Next steps:"
    echo "  1. Build mpv (using local deps):"
    echo "     ./build_mpv_windows_msys2.sh --local-deps"
    echo ""
    echo "  2. Or collect DLLs to vendor directory:"
    echo "     Run this script's collect step manually, or"
    echo "     the mpv build script will handle it."
    echo ""
}

main
