#!/bin/bash
# Build script: copy whisper-cli + dylibs from Homebrew and fix rpaths
#
# Prerequisites:
#   brew install whisper-cpp ffmpeg
#
# Usage:
#   cd vendor/whisper && bash build_whisper.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/darwin-arm64"
FFMPEG_OUT="$SCRIPT_DIR/../ffmpeg/darwin-arm64"

BREW_PREFIX="$(brew --prefix)"

echo "=== Cleaning previous build ==="
rm -rf "$OUT_DIR/bin" "$OUT_DIR/lib"
mkdir -p "$OUT_DIR/bin" "$OUT_DIR/lib"

echo "=== Copying whisper-cli ==="
cp "$BREW_PREFIX/bin/whisper-cli" "$OUT_DIR/bin/"
chmod u+w "$OUT_DIR/bin/whisper-cli"

echo "=== Copying whisper dylibs ==="
# Copy only the versioned .0.dylib (the real files) to avoid duplicates
# Then create unversioned symlinks
for lib in libwhisper.1.dylib libggml.0.dylib libggml-base.0.dylib libggml-cpu.0.dylib libggml-metal.0.dylib libggml-blas.0.dylib; do
  src="$BREW_PREFIX/lib/$lib"
  if [ -f "$src" ] || [ -L "$src" ]; then
    # Resolve symlink to get the actual file
    real_src="$(readlink -f "$src")"
    cp "$real_src" "$OUT_DIR/lib/$lib"
    chmod u+w "$OUT_DIR/lib/$lib"
    echo "  copied: $lib"
  fi
done

echo "=== Fixing rpaths ==="
# Homebrew uses @rpath/libXXX.N.dylib references.
# Strategy: replace @rpath with @executable_path/../lib in whisper-cli,
#           and replace @rpath with @loader_path in inter-dylib references.

# Helper: rewrite all @rpath references in a binary
fix_rpaths() {
  local binary="$1"
  local prefix="$2"  # @executable_path/../lib or @loader_path

  # Parse otool output, find @rpath references
  otool -L "$binary" | tail -n +2 | while read -r line; do
    dep="$(echo "$line" | awk '{print $1}')"
    if [[ "$dep" == @rpath/* ]]; then
      libfile="$(basename "$dep")"
      new_path="${prefix}/${libfile}"
      install_name_tool -change "$dep" "$new_path" "$binary" 2>/dev/null || true
    fi
  done
}

# Fix the install name (id) of each dylib
for lib in "$OUT_DIR/lib/"*.dylib; do
  libname="$(basename "$lib")"
  install_name_tool -id "@executable_path/../lib/$libname" "$lib" 2>/dev/null || true
done

# Fix whisper-cli: @rpath → @executable_path/../lib
fix_rpaths "$OUT_DIR/bin/whisper-cli" "@executable_path/../lib"

# Fix inter-dylib references: @rpath → @loader_path
for lib in "$OUT_DIR/lib/"*.dylib; do
  fix_rpaths "$lib" "@loader_path"
done

# Remove any existing rpaths from whisper-cli (optional cleanup)
for rp in $(otool -l "$OUT_DIR/bin/whisper-cli" | grep -A1 'LC_RPATH' | grep 'path ' | awk '{print $2}'); do
  install_name_tool -delete_rpath "$rp" "$OUT_DIR/bin/whisper-cli" 2>/dev/null || true
done

echo "=== Copying ffmpeg ==="
rm -rf "$FFMPEG_OUT/bin"
mkdir -p "$FFMPEG_OUT/bin"
# Find ffmpeg: brew Cellar → brew bin → PATH
FFMPEG_SRC=""
FFMPEG_CELLAR="$(find "${BREW_PREFIX}/Cellar/ffmpeg" -name ffmpeg -type f -path '*/bin/ffmpeg' 2>/dev/null | head -1)"
if [ -n "$FFMPEG_CELLAR" ]; then
  FFMPEG_SRC="$FFMPEG_CELLAR"
elif [ -f "${BREW_PREFIX}/bin/ffmpeg" ]; then
  FFMPEG_SRC="${BREW_PREFIX}/bin/ffmpeg"
else
  FFMPEG_SRC="$(which ffmpeg 2>/dev/null || true)"
fi
if [ -z "$FFMPEG_SRC" ] || [ ! -f "$FFMPEG_SRC" ]; then
  echo "ERROR: ffmpeg not found. Install via: brew install ffmpeg"
  exit 1
fi
echo "  using: $FFMPEG_SRC"
cp "$FFMPEG_SRC" "$FFMPEG_OUT/bin/"
chmod u+w "$FFMPEG_OUT/bin/ffmpeg"

echo "=== Ad-hoc codesigning ==="
codesign --force --sign - "$OUT_DIR/bin/whisper-cli"
for lib in "$OUT_DIR/lib/"*.dylib; do
  codesign --force --sign - "$lib"
done
codesign --force --sign - "$FFMPEG_OUT/bin/ffmpeg"

echo ""
echo "=== Done ==="
echo "whisper-cli: $OUT_DIR/bin/whisper-cli"
echo "ffmpeg:      $FFMPEG_OUT/bin/ffmpeg"
echo ""
echo "Verify with:"
echo "  otool -L $OUT_DIR/bin/whisper-cli"
