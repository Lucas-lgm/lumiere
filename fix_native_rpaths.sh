#!/bin/bash
set -e

# Fix dynamic library references and rpath for mpv_binding.node
# Run after node-gyp rebuild
#
# Solves two problems:
# 1. node-gyp writes full version numbers at link time (e.g. libwebp.7.2.0.dylib), which breaks on library upgrade
# 2. Build environment may leak homebrew rpath into .node

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ARCH="${1:-arm64}"
NODE_FILE="$DIR/native/build/Release/mpv_binding.node"
VENDOR_LIB="$DIR/vendor/mpv/darwin-$ARCH/lib"

if [ ! -f "$NODE_FILE" ]; then
    echo "Error: $NODE_FILE does not exist, please run node-gyp rebuild first"
    exit 1
fi

echo "================================"
echo "Fixing mpv_binding.node dynamic library references"
echo "================================"

# 1. Change full version references to SONAME (compatible versions)
#    e.g. @rpath/libwebp.7.2.0.dylib -> @rpath/libwebp.7.dylib
echo ""
echo "--- Normalizing library references (full version -> SONAME) ---"

otool -L "$NODE_FILE" | tail -n +2 | awk '{print $1}' | while IFS= read -r dep; do
    [[ "$dep" == @rpath/* ]] || continue

    dep_name=$(basename "$dep")

    # Check if it is full version format (X.Y.Z.dylib or X.Y.Z.W.dylib)
    # e.g. libwebp.7.2.0.dylib, libavif.16.3.0.dylib
    if [[ "$dep_name" =~ ^(.+)\.([0-9]+)\.([0-9]+)\.([0-9]+)\.dylib$ ]]; then
        base="${BASH_REMATCH[1]}"
        major="${BASH_REMATCH[2]}"
        soname="${base}.${major}.dylib"

        # Confirm that the corresponding SONAME file or symlink exists in vendor directory
        if [ -f "$VENDOR_LIB/$soname" ] || [ -L "$VENDOR_LIB/$soname" ]; then
            install_name_tool -change "$dep" "@rpath/$soname" "$NODE_FILE" 2>/dev/null || true
            echo "  $dep_name -> $soname"
        fi
    fi
done

# 2. Clean homebrew rpath, ensure only necessary @loader_path paths remain
echo ""
echo "--- Cleaning LC_RPATH ---"

otool -l "$NODE_FILE" 2>/dev/null | grep -A2 "LC_RPATH" | grep "path " | awk '{print $2}' | while IFS= read -r rpath; do
    if [[ "$rpath" == /opt/homebrew/* ]] || [[ "$rpath" == /usr/local/* ]]; then
        install_name_tool -delete_rpath "$rpath" "$NODE_FILE" 2>/dev/null || true
        echo "  Deleted: $rpath"
    fi
done

# 3. Ensure both dev and production rpaths exist
EXPECTED_RPATHS=(
    "@loader_path/../../../vendor/mpv/darwin-${ARCH}/lib"   # Dev environment
    "@loader_path/../lib"                                     # Production environment
)

for expected in "${EXPECTED_RPATHS[@]}"; do
    has=$(otool -l "$NODE_FILE" 2>/dev/null | grep -A2 "LC_RPATH" | grep "path $expected" || true)
    if [ -z "$has" ]; then
        install_name_tool -add_rpath "$expected" "$NODE_FILE" 2>/dev/null || true
        echo "  Added: $expected"
    fi
done

# 4. Re-sign
echo ""
echo "--- Re-signing ---"
codesign --force --sign - "$NODE_FILE" 2>/dev/null || true

echo ""
echo "================================"
echo "Fix complete! Current state:"
echo "================================"
echo ""
echo "Dependencies:"
otool -L "$NODE_FILE" | tail -n +2 | grep "@rpath" | awk '{print "  " $1}'
echo ""
echo "RPATH:"
otool -l "$NODE_FILE" | grep -A2 "LC_RPATH" | grep "path " | awk '{print "  " $2}'
