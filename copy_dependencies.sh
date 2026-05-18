#!/bin/bash
set -e

# Script to copy all mpv dependency libraries
# This script will:
# 1. Copy all dependencies of libmpv to the vendor directory
# 2. Recursively copy dependencies of dependencies
# 3. Modify install_name and dependency paths of all libraries to @rpath

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$DIR"

# Architecture parameter, defaults to arm64, can pass x64 etc.
ARCH="${1:-arm64}"
VENDOR_LIB="$PROJECT_ROOT/vendor/mpv/darwin-$ARCH/lib"

# Ensure the target directory exists
mkdir -p "$VENDOR_LIB"

# List of already processed libraries (avoid duplicates) - space-delimited string
PROCESSED_LIBS=""

# System library prefixes to exclude
SYSTEM_PREFIXES=(
    "/usr/lib/"
    "/System/"
)

# Check if it is a system library
is_system_lib() {
    local lib_path="$1"
    for prefix in "${SYSTEM_PREFIXES[@]}"; do
        if [[ "$lib_path" == "$prefix"* ]]; then
            return 0
        fi
    done
    return 1
}

# Get the actual path of a library (handle symlinks)
get_real_path() {
    local lib_path="$1"

    # If the path is not absolute, try to find it in homebrew
    if [[ "$lib_path" != /* ]]; then
        echo "Warning: Non-absolute path: $lib_path" >&2
        return 1
    fi

    if [ -f "$lib_path" ]; then
        # If it is a symlink, get the real file
        if [ -L "$lib_path" ]; then
            readlink -f "$lib_path" 2>/dev/null || echo "$lib_path"
        else
            echo "$lib_path"
        fi
    else
        echo "Warning: Library not found: $lib_path" >&2
        return 1
    fi
}

# Copy library and its dependencies
copy_lib_and_deps() {
    local lib_path="$1"
    local depth="${2:-0}"

    # Limit recursion depth
    if [ "$depth" -gt 10 ]; then
        echo "Warning: Max recursion depth reached for $lib_path"
        return
    fi

    # If it is a system library, skip
    if is_system_lib "$lib_path"; then
        return
    fi

    # Get the actual path
    local real_path
    real_path=$(get_real_path "$lib_path") || return

    # If already processed, skip
    if [[ " $PROCESSED_LIBS " == *" $real_path "* ]]; then
        return
    fi

    # Mark as processed
    PROCESSED_LIBS="$PROCESSED_LIBS $real_path"

    echo "Processing: $real_path (depth: $depth)"

    # Get library filename
    local lib_name=$(basename "$real_path")
    local dest_path="$VENDOR_LIB/$lib_name"

    # Copy library file
    if [ -f "$real_path" ]; then
        # If target file already exists, delete it first
        [ -f "$dest_path" ] && rm -f "$dest_path"
        cp "$real_path" "$dest_path"
        echo "  Copied: $lib_name"

        # Modify library install name to @rpath relative path
        install_name_tool -id "@rpath/$lib_name" "$dest_path" 2>/dev/null || true

        # Get all dependencies of this library
        local deps=$(otool -L "$real_path" | tail -n +2 | awk '{print $1}')

        # Process each dependency
        while IFS= read -r dep; do
            [ -z "$dep" ] && continue

            # Skip self-reference
            if [[ "$dep" == *"$lib_name"* ]]; then
                continue
            fi

            # If it is an @rpath/ or @loader_path/ reference, try to find the actual file in Homebrew
            if [[ "$dep" == "@rpath/"* ]] || [[ "$dep" == "@loader_path/"* ]]; then
                local rpath_name=$(basename "$dep")
                # Search in Homebrew lib directory
                local resolved=""
                local deps_lib="$PROJECT_ROOT/deps/macos-$ARCH/lib"
                for search_dir in "$deps_lib" /opt/homebrew/lib /opt/homebrew/opt/*/lib; do
                    if [ -f "$search_dir/$rpath_name" ]; then
                        resolved="$search_dir/$rpath_name"
                        break
                    fi
                done
                if [ -n "$resolved" ]; then
                    copy_lib_and_deps "$resolved" $((depth + 1))
                fi
                continue
            fi

            # If it is a system library, skip
            if is_system_lib "$dep"; then
                continue
            fi

            # Recursively copy dependencies
            copy_lib_and_deps "$dep" $((depth + 1))

            # Modify dependency path to @rpath
            local dep_name=$(basename "$dep")
            install_name_tool -change "$dep" "@rpath/$dep_name" "$dest_path" 2>/dev/null || true
        done <<< "$deps"
    else
        echo "  Warning: File does not exist: $real_path"
    fi
}

echo "================================"
echo "Starting to copy mpv dependency libraries"
echo "================================"

# Main libmpv library path (arch-specific build dir)
LIBMPV_SOURCE="$PROJECT_ROOT/mpv/build-$ARCH/libmpv.2.dylib"
# Fallback to old build dir
[ -f "$LIBMPV_SOURCE" ] || LIBMPV_SOURCE="$PROJECT_ROOT/mpv/build/libmpv.2.dylib"
LIBMPV_DEST="$VENDOR_LIB/libmpv.2.dylib"

if [ ! -f "$LIBMPV_SOURCE" ]; then
    echo "Error: libmpv source file does not exist: $LIBMPV_SOURCE"
    echo "Please run build_mpv.sh first to build mpv"
    exit 1
fi

# First copy libmpv
echo "Copying main library: libmpv.2.dylib"
[ -f "$LIBMPV_DEST" ] && rm -f "$LIBMPV_DEST"
cp "$LIBMPV_SOURCE" "$LIBMPV_DEST"

# Process all dependencies of libmpv
echo ""
echo "Analyzing and copying libmpv dependencies..."
LIBMPV_DEPS=$(otool -L "$LIBMPV_SOURCE" | tail -n +2 | awk '{print $1}')

while IFS= read -r dep; do
    [ -z "$dep" ] && continue

    # Skip self-reference
    if [[ "$dep" == *"libmpv"* ]]; then
        continue
    fi

    # If it is an @rpath reference, resolve to actual file
    if [[ "$dep" == "@rpath/"* ]] || [[ "$dep" == "@loader_path/"* ]]; then
        rpath_name=$(basename "$dep")
        resolved=""
        _deps_lib="$PROJECT_ROOT/deps/macos-$ARCH/lib"
        for search_dir in "$_deps_lib" /opt/homebrew/lib /opt/homebrew/opt/*/lib; do
            if [ -f "$search_dir/$rpath_name" ]; then
                resolved="$search_dir/$rpath_name"
                break
            fi
        done
        if [ -n "$resolved" ]; then
            echo ""
            copy_lib_and_deps "$resolved"
        else
            echo "Warning: Cannot resolve $dep"
        fi
        continue
    fi

    # If it is a system library, skip
    if is_system_lib "$dep"; then
        continue
    fi

    echo ""
    copy_lib_and_deps "$dep"
done <<< "$LIBMPV_DEPS"

# Modify libmpv dependency paths
echo ""
echo "Updating libmpv dependency paths..."
install_name_tool -id "@rpath/libmpv.2.dylib" "$LIBMPV_DEST"

while IFS= read -r dep; do
    [ -z "$dep" ] && continue

    if [[ "$dep" == *"libmpv"* ]] || [[ "$dep" == "@rpath/"* ]] || [[ "$dep" == "@loader_path/"* ]]; then
        continue
    fi

    if is_system_lib "$dep"; then
        continue
    fi

    dep_name=$(basename "$dep")
    install_name_tool -change "$dep" "@rpath/$dep_name" "$LIBMPV_DEST" 2>/dev/null || true
done <<< "$LIBMPV_DEPS"

echo ""
echo "================================"
echo "Dependency copy complete!"
echo "================================"
echo ""
echo "Copied library list:"
ls -lh "$VENDOR_LIB"/*.dylib | awk '{print "  " $9, "(" $5 ")"}'

echo ""
echo "Verifying libmpv dependencies:"
otool -L "$LIBMPV_DEST" | head -20

echo ""
echo "Info: All dependencies copied to $VENDOR_LIB"
echo "Info: All dependency paths changed to @rpath for easy packaging and distribution"

# Create symlinks
echo ""
echo "================================"
echo "Creating symlinks..."
echo "================================"
cd "$VENDOR_LIB"

# Create simplified version symlinks for libraries with full version numbers
for lib in *.dylib; do
    # Skip existing symlinks
    [ -L "$lib" ] && continue
    [ ! -f "$lib" ] && continue

    # Get library name and version (e.g.: libfoo.1.2.3.dylib -> libfoo.1.dylib)
    if [[ "$lib" =~ ^(.+)\.([0-9]+)\.([0-9]+)\.([0-9]+)\.dylib$ ]]; then
        base="${BASH_REMATCH[1]}"
        major="${BASH_REMATCH[2]}"
        minor="${BASH_REMATCH[3]}"

        # Create major.minor version link
        link_name="${base}.${major}.${minor}.dylib"
        if [ ! -e "$link_name" ]; then
            ln -sf "$lib" "$link_name"
        fi

        # Create major version link
        link_name="${base}.${major}.dylib"
        if [ ! -e "$link_name" ]; then
            ln -sf "$lib" "$link_name"
        fi
    # Handle X.Y.dylib format (e.g.: libnettle.8.11.dylib -> libnettle.8.dylib)
    elif [[ "$lib" =~ ^(.+)\.([0-9]+)\.([0-9]+)\.dylib$ ]]; then
        base="${BASH_REMATCH[1]}"
        major="${BASH_REMATCH[2]}"

        link_name="${base}.${major}.dylib"
        if [ ! -e "$link_name" ]; then
            ln -sf "$lib" "$link_name"
        fi
    fi
done

echo "Symlink creation complete!"

# Supplement SONAME symlinks (some libraries have SONAME versions that differ from filename versions, e.g. libopenjp2.7.dylib -> libopenjp2.2.5.4.dylib)
echo ""
echo "================================"
echo "Checking and creating SONAME symlinks..."
echo "================================"

for lib in *.dylib; do
    [ -L "$lib" ] && continue
    [ ! -f "$lib" ] && continue

    otool -L "$lib" 2>/dev/null | tail -n +2 | awk '{print $1}' | while IFS= read -r dep; do
        # Handle @rpath references and residual homebrew absolute paths
        if [[ "$dep" != @rpath/* ]] && [[ "$dep" != /opt/homebrew/* ]] && [[ "$dep" != /usr/local/* ]]; then
            continue
        fi
        dep_name=$(basename "$dep")
        # If the dependency filename does not exist in vendor directory, try fuzzy matching and create symlink
        if [ ! -f "$dep_name" ] && [ ! -L "$dep_name" ]; then
            # Extract library base name (remove version and .dylib suffix)
            # e.g. libopenjp2.7.dylib -> libopenjp2
            base_name=$(echo "$dep_name" | sed -E 's/\.[0-9]+(\.[0-9]+)*\.dylib$//' | sed 's/\.dylib$//')
            # Find matching real file (with full version number)
            target=$(ls -1 "${base_name}".[0-9]*.dylib 2>/dev/null | grep -v "^${dep_name}$" | while read f; do [ ! -L "$f" ] && echo "$f"; done | head -1)
            if [ -n "$target" ]; then
                ln -sf "$target" "$dep_name"
                echo "  SONAME link: $dep_name -> $target"
            else
                echo "  Warning: Cannot find matching library file for $dep_name (required by: $lib)"
            fi
        fi
    done
done

echo "SONAME symlink check complete!"

# Final fix of all library paths (ensure all dependencies use @rpath)
echo ""
echo "================================"
echo "Final fix of dependency paths to @rpath..."
echo "================================"

for lib in *.dylib; do
    # Skip symlinks
    [ -L "$lib" ] && continue
    [ ! -f "$lib" ] && continue

    # Modify library install name to @rpath
    install_name_tool -id "@rpath/$lib" "$lib" 2>/dev/null || true

    # Get all dependencies
    deps=$(otool -L "$lib" | tail -n +2 | awk '{print $1}')

    while IFS= read -r dep; do
        [ -z "$dep" ] && continue

        # Skip system libraries and already fixed paths
        [[ "$dep" == /usr/lib/* ]] && continue
        [[ "$dep" == /System/* ]] && continue
        [[ "$dep" == @rpath/* ]] && continue
        [[ "$dep" == @loader_path/* ]] && continue

        # Get dependency library filename
        dep_name=$(basename "$dep")

        # Check if file exists in vendor directory
        if [ -f "$dep_name" ] || [ -L "$dep_name" ]; then
            # Modify dependency path to @rpath
            install_name_tool -change "$dep" "@rpath/$dep_name" "$lib" 2>/dev/null || true
        else
            # Filename mismatch (e.g. libmbedcrypto.16.dylib vs libmbedcrypto.3.6.5.dylib)
            # Try fuzzy matching by library base name, create symlink then fix path
            base_name=$(echo "$dep_name" | sed -E 's/\.[0-9]+(\.[0-9]+)*\.dylib$//' | sed 's/\.dylib$//')
            target=$(ls -1 "${base_name}"*.dylib 2>/dev/null | while read f; do [ ! -L "$f" ] && echo "$f"; done | head -1)
            if [ -n "$target" ]; then
                ln -sf "$target" "$dep_name"
                echo "  Auto-created symlink: $dep_name -> $target"
                install_name_tool -change "$dep" "@rpath/$dep_name" "$lib" 2>/dev/null || true
            else
                echo "  Warning: Cannot find matching library file for $dep_name (required by: $lib, original path: $dep)"
            fi
        fi
    done <<< "$deps"
done

echo "Path fix complete!"

# Clean LC_RPATH: remove all homebrew paths, add @loader_path (so libraries find dependencies in their own directory)
echo ""
echo "================================"
echo "Cleaning LC_RPATH (removing homebrew paths, adding @loader_path)..."
echo "================================"

for lib in *.dylib; do
    [ -L "$lib" ] && continue
    [ ! -f "$lib" ] && continue

    # Remove all rpaths pointing to /opt/homebrew
    otool -l "$lib" 2>/dev/null | grep -A2 "LC_RPATH" | grep "path " | awk '{print $2}' | while IFS= read -r rpath; do
        if [[ "$rpath" == /opt/homebrew/* ]]; then
            install_name_tool -delete_rpath "$rpath" "$lib" 2>/dev/null || true
            echo "  Deleted rpath: $rpath (from $lib)"
        fi
    done

    # Add @loader_path (if not already present)
    has_loader_path=$(otool -l "$lib" 2>/dev/null | grep -A2 "LC_RPATH" | grep "path @loader_path" || true)
    if [ -z "$has_loader_path" ]; then
        install_name_tool -add_rpath "@loader_path" "$lib" 2>/dev/null || true
    fi
done

echo "LC_RPATH cleanup complete!"

# Re-sign all modified dylibs (install_name_tool invalidates signatures)
echo ""
echo "================================"
echo "Re-signing all dylibs..."
echo "================================"

for lib in *.dylib; do
    [ -L "$lib" ] && continue
    [ ! -f "$lib" ] && continue
    codesign --force --sign - "$lib" 2>/dev/null || true
done

echo "Signing complete!"

# Final verification: check for residual hardcoded homebrew paths
echo ""
echo "================================"
echo "Final verification: checking for residual hardcoded paths..."
echo "================================"

FOUND_ISSUES=0
for lib in *.dylib; do
    [ -L "$lib" ] && continue
    [ ! -f "$lib" ] && continue
    otool -L "$lib" 2>/dev/null | tail -n +2 | awk '{print $1}' | while IFS= read -r dep; do
        if [[ "$dep" == /opt/homebrew/* ]] || [[ "$dep" == /usr/local/* ]]; then
            echo "  Error: $lib still references $dep"
            # Write to temp file to mark failure (subshell cannot modify parent variable)
            echo "1" > /tmp/_dylib_check_fail
        fi
    done
done

if [ -f /tmp/_dylib_check_fail ]; then
    rm -f /tmp/_dylib_check_fail
    echo ""
    echo "!!! Found residual hardcoded paths, will not run on other machines after packaging !!!"
    exit 1
else
    echo "  All passed, no residual hardcoded paths"
fi
