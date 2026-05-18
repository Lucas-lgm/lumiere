# Deployment Guide - Electron App Packaging and Distribution

> **Last Updated**: 2026-01-25  
> **Status**: Production Ready  
> **Target Platform**: macOS (ARM64)

## Overview

This guide covers the complete packaging and distribution process for the mpv-player application, ensuring new users can use it directly without installing dependencies like Homebrew.

### Core Principles
**All dependency libraries must be packaged inside the application**, cannot rely on system Homebrew installation  
**Use relative paths** (`@loader_path`) instead of absolute paths (`/opt/homebrew`)  
**Native addon must be in the unpacked directory**, cannot be compressed into asar

---

## Build Configuration

### 1. Dynamic Library Approach (Recommended)

**Why choose dynamic libraries**:
- **Simple deployment**: Dynamic libraries can be placed inside the app bundle and referenced via `@rpath`
- **Reasonable file size**: Approximately 10-20MB (vs static library 50-100MB+)
- **Good compatibility**: Compatible with current code, supports runtime loading
- **Developer friendly**: Only need to replace the `.dylib` file after modification

**Current Implementation**:
```bash
vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
```

### 2. Path Configuration Verification

**Dependency Library Path Configuration**:
```bash
# libmpv.2.dylib dependencies use relative paths
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib | grep "@loader_path"

# Should see:
@loader_path/bundled/libavcodec.60.dylib
@loader_path/bundled/libplacebo.73.dylib
# ... other dependencies
```

**Native Addon rpath Configuration**:
```bash
otool -l native/build/Release/mpv_binding.node | grep -A 2 "LC_RPATH"

# Should see:
@loader_path/../../../vendor/mpv/darwin-arm64/lib
@loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled
```

### 3. Path Resolution Logic

**Development Environment**:
```
native/build/Release/mpv_binding.node
  @loader_path = native/build/Release/
  @loader_path/../../../vendor/mpv/darwin-arm64/lib = vendor/mpv/darwin-arm64/lib
  @loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled = vendor/mpv/darwin-arm64/lib/bundled
```

**Production Environment (after packaging)**:
```
YourApp.app/Contents/Resources/app.asar.unpacked/native/build/Release/mpv_binding.node
  @loader_path = app.asar.unpacked/native/build/Release/
  @loader_path/../../../vendor/mpv/darwin-arm64/lib = app.asar.unpacked/vendor/mpv/darwin-arm64/lib
  @loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled = app.asar.unpacked/vendor/mpv/darwin-arm64/lib/bundled
```

---

## Deployment Checklist

### Pre-build Checks
- [ ] Verify dependencies use `@loader_path` relative paths
- [ ] Confirm bundled directory contains all libraries
- [ ] Check native addon rpath configuration is correct

### Build Script Configuration

cd mpv

meson setup build \
  --buildtype=release \
  -Dlibmpv=true \
  -Dcplayer=false \
  -Dswift-build=enabled \
  -Dmanpage-build=disabled \
  -Dhtml-build=disabled \
  -Dtests=false \
  -Dgpl=true \
  -Dgl=enabled \
  -Diconv=auto \
  -Dlcms2=enabled \
  -Djpeg=enabled \
  -Dzlib=enabled \
  -Dcocoa=enabled \
  -Dcoreaudio=enabled \
  -Dgl-cocoa=enabled \
  -Dvideotoolbox-gl=enabled \
  -Dvideotoolbox-pl=enabled \
  -Dmacos-cocoa-cb=enabled \
  -Dmacos-media-player=enabled \
  -Dplain-gl=enabled

meson compile -C build

# Copy to vendor directory
cp build/libmpv.2.dylib vendor/mpv/darwin-arm64/lib/
install_name_tool -id "@rpath/libmpv.2.dylib" vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
```

### binding.gyp Configuration
```json
{
  "link_settings": {
    "libraries": [
      "<(module_root_dir)/../vendor/mpv/darwin-arm64/lib/libmpv.2.dylib"
    ],
    "library_dirs": [
      "<(module_root_dir)/../vendor/mpv/darwin-arm64/lib"
    ]
  },
  "xcode_settings": {
    "LD_RUNPATH_SEARCH_PATHS": [
      "@loader_path/../../../vendor/mpv/darwin-arm64/lib"
    ]
  }
}
```

---

## Electron Packaging Configuration

### electron-vite Packaging
`electron-vite` will by default:
- Automatically include the `vendor/` directory (if it exists)
- Automatically handle native addon (won't be compressed into asar)
- Native addon will automatically be placed in the unpacked directory

### Verify Package Result
```bash
# 1. Check app package structure
ls -R "dist/mac-arm64/YourApp.app/Contents/"

# 2. Check native addon location
find "dist/mac-arm64/YourApp.app" -name "mpv_binding.node"

# 3. Check vendor directory
find "dist/mac-arm64/YourApp.app" -path "*/vendor/mpv/darwin-arm64/lib/*"

# 4. Check bundled directory
find "dist/mac-arm64/YourApp.app" -path "*/bundled/*.dylib"
```

**Should see**:
- `mpv_binding.node` in the unpacked directory
- `vendor/mpv/darwin-arm64/lib/libmpv.2.dylib` exists
- `vendor/mpv/darwin-arm64/lib/bundled/*.dylib` all libraries exist

### In-App Package Structure
```
YourApp.app/
  Contents/
    Resources/
      app.asar.unpacked/
        vendor/mpv/darwin-arm64/lib/
          libmpv.2.dylib
          bundled/*.dylib
        native/build/Release/
          mpv_binding.node
    MacOS/
      YourApp
```

---

## Verification Steps

### Step 1: Verify Dependency Paths
```bash
# Check libmpv dependencies
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib | grep -E "@loader_path|@rpath"

# Check all bundled library dependencies
for lib in vendor/mpv/darwin-arm64/lib/bundled/*.dylib; do
    echo "=== $(basename $lib) ==="
    otool -L "$lib" | grep -E "/opt/homebrew|@loader_path"
done
```

**Should see**:
- All dependencies use `@loader_path/bundled/...`
- No `/opt/homebrew/...` paths

### Step 2: Test Loading
```bash
# Test local loading
node -e "require('./native/build/Release/mpv_binding.node'); console.log('Native addon loaded successfully')"

# Test Electron environment (if installed)
npx electron -e "require('./native/build/Release/mpv_binding.node'); console.log('Electron environment loaded successfully')"
```

### Step 3: Verification Script
Create `scripts/verify_distribution.sh`:
```bash
#!/bin/bash
echo "=== Distribution Verification Script ==="

# Check libmpv exists
if [ ! -f "vendor/mpv/darwin-arm64/lib/libmpv.2.dylib" ]; then
    echo "libmpv.2.dylib does not exist"
    exit 1
fi

# Check dependency paths
echo "Checking dependency paths..."
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib | grep -q "/opt/homebrew"
if [ $? -eq 0 ]; then
    echo "libmpv contains absolute path dependencies"
    exit 1
fi

# Check bundled directory
if [ ! -d "vendor/mpv/darwin-arm64/lib/bundled" ]; then
    echo "bundled directory does not exist"
    exit 1
fi

echo "All checks passed"
```

---

## Common Issues and Solutions

### Issue 1: Native Addon Compressed into asar
**Symptom**: Cannot find native addon when application starts

**Solutions**:
- Configure `asarUnpack` to include native addon
- Native addon must be in the unpacked directory

### Issue 2: Path Resolution Failure
**Symptom**: Loading libmpv fails

**Check**:
- `@loader_path` resolves correctly
- Relative paths are correct (`../../../` is correct)
- Use `DYLD_PRINT_LIBRARIES=1` to view library loading process

### Issue 3: Missing Dependencies
**Symptom**: Missing dependency libraries at runtime

**Check**:
```bash
# Check all dependencies
for lib in vendor/mpv/darwin-arm64/lib/bundled/*.dylib; do
    otool -L "$lib" | grep "/opt/homebrew"
done
```

**Solution**: Ensure all dependencies are copied to the bundled directory

---

## Testing on a New User's Machine

### Test Steps
1. **On a machine without Homebrew**:
   - Extract the installation package
   - Run the application
   - Check if it starts normally
   - Check if native addon loads

2. **If it fails, check**:
   - Path errors in console logs
   - Use `otool -L` to check dependencies
   - Use `DYLD_PRINT_LIBRARIES=1` to view library loading process

### Quick Verification Commands
```bash
# Check app package integrity
codesign -dv --verbose=4 YourApp.app

# Check dynamic library dependencies
otool -L YourApp.app/Contents/Resources/app.asar.unpacked/vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
```

---

## Notes

1. **Native addon cannot be compressed into asar**:
   - electron-vite handles this automatically, but needs confirmation
   - Native addon must be in the unpacked directory

2. **vendor directory must be packaged**:
   - electron-vite includes it by default, but needs confirmation
   - If using electron-builder, must explicitly specify in `files`

3. **Paths must use relative paths**:
   - `@loader_path` - based on the loading library's location
   - `@rpath` - resolved through rpath
   - `/opt/homebrew/...` - absolute paths, new users won't have them

---

## Summary

The current configuration should work directly on new user machines because:
1. All dependencies use relative paths (`@loader_path`)
2. All dependency libraries are packaged inside the application
3. Native addon rpath configuration is correct
4. Does not rely on system Homebrew installation

**Suggested Workflow**:
1. Ensure all dependencies are copied
2. Run `./scripts/verify_distribution.sh` to verify configuration
3. Build the application: `npm run build`
4. Test on a machine without Homebrew after actual packaging

---

## Change Log

| Date | Changes |
|------|---------|
| 2026-01-25 | Created merged deployment guide, consolidated DISTRIBUTION_CHECKLIST.md, PACKAGING_GUIDE.md, ELECTRON_BUILD_RECOMMENDATION.md |
| 2026-01-21 | Initial packaging guide created |

## Related Documentation

- [Architecture Document](../ARCHITECTURE.md) - Understanding application architecture
- [GPU-NEXT Integration](../features/GPU_NEXT_INTEGRATION.md) - HDR rendering configuration
- [Development Guide](../development/SETUP_GUIDE.md) - Development environment setup
