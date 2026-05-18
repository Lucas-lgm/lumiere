#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="$SCRIPT_DIR/deps/win64"

echo "==> Regenerating FFmpeg import libs for lld compatibility..."

for fflib in avcodec avformat avfilter avutil swscale swresample avdevice; do
    dll=$(ls "$PREFIX/bin/${fflib}-"*.dll "$PREFIX/bin/lib${fflib}-"*.dll 2>/dev/null | head -1 || true)
    if [ -z "$dll" ] || [ ! -f "$dll" ]; then
        echo "  SKIP: ${fflib} (no DLL found)"
        continue
    fi

    dllname=$(basename "$dll")
    implib="$PREFIX/lib/lib${fflib}.dll.a"
    deffile=$(mktemp /tmp/implib-XXXXXX.def)

    echo "  Processing $dllname..."
    gendef - "$dll" > "$deffile" 2>/dev/null

    export_count=$(sed -n '/^EXPORTS/,$ { /^EXPORTS/d; /^$/d; /^;/d; p; }' "$deffile" | wc -l) || export_count=0
    export_count=$((export_count + 0))

    if [ "$export_count" -gt 0 ]; then
        llvm-dlltool -d "$deffile" -l "$implib" -D "$dllname" -m i386:x86-64
        echo "    OK: $export_count exports -> $implib"
    else
        echo "    WARNING: no exports found in $dllname"
    fi
    rm -f "$deffile"
done

echo "==> Done."
