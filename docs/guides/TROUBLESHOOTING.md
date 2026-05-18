# Troubleshooting Guide

> **Last Updated**: 2026-01-25  
> **Applicable Version**: mpv-player v1.4+  
> **Target Platform**: macOS (primary), Windows (secondary)

## Emergency Issues

### Application Won't Start
**Symptom**: Clicking the app icon does nothing, or it crashes immediately

**Resolution Steps**:
1. **Check Console Log**
   ```bash
   # Launch app via terminal to view logs
   /Applications/mpv-player.app/Contents/MacOS/mpv-player
   ```

2. **Check Dependency Libraries**
   ```bash
   # Check if libmpv loads correctly
   otool -L /Applications/mpv-player.app/Contents/Resources/app.asar.unpacked/vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
   ```

3. **Check Native Addon**
   ```bash
   # Check if native addon exists
   find /Applications/mpv-player.app -name "mpv_binding.node"
   ```

**Common Causes**:
- Native addon compressed into asar
- libmpv dependency uses absolute paths (`/opt/homebrew/...`)
- Missing dependency libraries

### Black Screen / No Video Output
**Symptom**: App starts normally, but video window is completely black

**Diagnostic Command**:
```bash
# Send debug command
window.electronAPI.send('debug-hdr-status')
```

**Resolution Steps**:
1. **Check MPV Initialization**
   - Check console for MPV initialization errors
   - Check if native addon loads correctly

2. **Check Window Binding**
   - macOS: Verify NSView pointer is passed correctly
   - Windows: Verify HWND is passed correctly

3. **Check Render Mode**
   ```typescript
   // Try switching render mode (macOS)
   controller.setJsDrivenRenderMode(!controller.getJsDrivenRenderMode())
   ```

---

## Playback Issues

### Video Won't Play
**Symptom**: No response after selecting a file, or immediate error

**Diagnostic Flow**:
```
1. Check file path → 2. Check file permissions → 3. Check codec support → 4. Check MPV log
```

**Detailed Steps**:
1. **File Check**
   ```bash
   # Confirm file exists and is readable
   ls -la "/path/to/video.mp4"
   file "/path/to/video.mp4"
   ```

2. **Codec Check**
   ```bash
   # Use ffprobe to check video format
   ffprobe -v error -show_format -show_streams "/path/to/video.mp4"
   ```

3. **MPV Log**
   ```typescript
   // Enable verbose logging
   await controller.setOption('log-file', '/tmp/mpv.log')
   await controller.setOption('msg-level', 'all=v')
   ```

### Playback Stuttering / Dropped Frames
**Symptom**: Video playback is not smooth, frequent stuttering

**Performance Optimization**:
1. **Hardware Decoding**
   ```typescript
   // Enable hardware decoding (Apple Silicon)
   await controller.setOption('hwdec', 'videotoolbox')
   ```

2. **Rendering Optimization**
   ```typescript
   // Adjust render parameters
   await controller.setOption('video-sync', 'audio')      // Audio sync
   await controller.setOption('interpolation', 'yes')     // Frame interpolation
   await controller.setOption('tscale', 'oversample')     // Time scaling
   ```

3. **Cache Adjustment**
   ```typescript
   // Increase cache
   await controller.setOption('demuxer-max-bytes', '150M')
   await controller.setOption('demuxer-readahead-secs', '60')
   ```

### Audio Out of Sync
**Symptom**: Audio and video are not synchronized

**Solutions**:
```typescript
// Adjust audio delay
await controller.setProperty('audio-delay', 0.1)  // Add 0.1 second delay
await controller.setProperty('audio-delay', -0.1) // Remove 0.1 second delay

// Or adjust video delay
await controller.setProperty('video-delay', 0.1)
```

---

## HDR / Dolby Vision Issues

### HDR Content Overexposed
**Symptom**: HDR video appears too bright, white areas blown out

**Status**: Resolved (v1.3+)

**Current Solution**:
1. **Conservative target-peak Settings**
   - EDR ≤ 2.0: 500 nits
   - EDR ≤ 3.0: 700 nits  
   - EDR > 3.0: 1000 nits

2. **Correct Tone Mapping**
   ```typescript
   // Auto configuration
   // HDR10: bt.2390
   // Dolby Vision: st2094-10
   // Disable dynamic peak detection
   await controller.setOption('hdr-compute-peak', 'no')
   ```

**Debug Commands**:
```bash
# Check HDR status
window.electronAPI.send('debug-hdr-status')

# Manual adjustment
await controller.setProperty('target-peak', 800)  # Adjust based on display
```

### Dolby Vision Color Issues
**Symptom**: DV content shows green/purple artifacts

**Status**: Resolved (v1.4+)

**Solutions**:
1. **Use gpu-next backend**
2. **Correctly configure libplacebo**
3. **Fixed version**: Use libplacebo version supporting Profile 5/8

**Checklist**:
- [ ] Use gpu-next backend (`vo=gpu-next`)
- [ ] libplacebo version ≥ 4.0
- [ ] macOS version ≥ 14.0 (full EDR support)

### SDR Content Looks Washed Out
**Symptom**: SDR video colors are dull, grayish

**Status**: Resolved (v1.2+)

**Solutions**:
```typescript
// Explicitly set SDR color space
await controller.setOption('target-trc', 'srgb')
await controller.setOption('target-colorspace-hint', 'yes')
```

---

## Rendering Issues

### Subtitle Rendering Issues
**Symptom**: Subtitles positioned incorrectly, rotated, or flickering

**Status**: Resolved (v1.3+)

**Specific Issues**:
1. **Subtitle Position Errors**
   - **Cause**: Y-coordinate flipping issue (FLIP_Y=1)
   - **Solution**: Fixed coordinate conversion in gpu-next backend

2. **Subtitle Rotation**
   - **Cause**: Subtitles not rotated with video rotation
   - **Solution**: Correctly handle video-params/rotate metadata

**Check Commands**:
```typescript
// Check video rotation
const rotate = await controller.getProperty('video-params/rotate')
console.log('Video rotation:', rotate)

// Check subtitle format
const subFormat = await controller.getProperty('current-tracks/sub/codec')
console.log('Subtitle format:', subFormat)
```

### Video Rotation Issues
**Symptom**: Incorrect orientation for iPhone-recorded videos

**Status**: Resolved (v1.3+)

**Solutions**:
1. **Correctly parse rotation metadata**
2. **Apply rotation in libplacebo**
3. **Synchronize rotation of subtitles and video**

**Related Properties**:
```typescript
// Check video parameters
const rotate = await controller.getProperty('video-params/rotate')  // 90, 180, 270
const width = await controller.getProperty('video-params/w')
const height = await controller.getProperty('video-params/h')
```

---

## Window / UI Issues

### Window Size / Position Issues
**Symptom**: Window position wrong, size abnormal

**Solutions**:
```typescript
// Reset window size
corePlayer.setVideoWindow(null)
corePlayer.setVideoWindow(window)  // Re-set

// Or manually adjust
window.setSize(1920, 1080)
window.center()
```

### Control Bar Not Showing / Hiding
**Symptom**: Control bar won't auto-hide, or won't display

**IPC Check**:
```typescript
// Send control bar commands
window.electronAPI.send('control-bar-show')
window.electronAPI.send('control-bar-schedule-hide')

// Check IPC handling
// ipcHandlers.ts:202-224
```

---

## Build / Deployment Issues

### Build Failed
**Common Errors and Solutions**:

#### Error 1: node-gyp Build Failed
```
gyp ERR! find Python
gyp ERR! stack Error: Can't find Python executable "python"
```
**Solution**:
```bash
# Set Python3
npm config set python python3
export PYTHON=python3

# Or install python2
brew install python@2
```

#### Error 2: Electron Download Failed
```
RequestError: connect ETIMEDOUT
```
**Solution**:
```bash
# Set mirror
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

#### Error 3: Missing Meson/Ninja
```
meson: command not found
```
**Solution**:
```bash
brew install meson ninja
```

### Crashes After Packaging
**Symptom**: Works in dev environment, crashes after packaging

**Checklist**:
- [ ] Native addon in unpacked directory (`app.asar.unpacked/`)
- [ ] libmpv uses relative paths (`@loader_path/...`)
- [ ] All dependency libraries are packaged
- [ ] Correct permissions (`chmod +x`)

**Verification Commands**:
```bash
# Check package structure
find YourApp.app -name "*.dylib" -exec otool -L {} \;
find YourApp.app -name "mpv_binding.node"
```

---

## Network / Streaming Issues

### Network Stream Won't Play
**Symptom**: URL won't play, or long buffering time

**Debug Steps**:
1. **Check URL Format**
   ```typescript
   // Correct format
   await controller.loadFile('https://example.com/video.m3u8')
   
   // May need protocol prefix
   await controller.loadFile('http://example.com/video.mp4')
   ```

2. **Adjust Buffer Settings**
   ```typescript
   // Increase network buffer
   await controller.setOption('cache', 'yes')
   await controller.setOption('cache-secs', '300')  // 300 second cache
   await controller.setOption('demuxer-max-bytes', '150M')
   ```

3. **Check Network Permissions**
   - macOS: Check network access permissions
   - Electron: Check if network features are enabled

### Live Stream Issues
**Symptom**: Live stream stuttering, interruptions

**Optimization Configuration**:
```typescript
// Live stream optimization settings
await controller.setOption('stream-lavf-o', 'reconnect=1')
await controller.setOption('stream-lavf-o', 'reconnect_streamed=1')
await controller.setOption('stream-lavf-o', 'reconnect_delay_max=30')

// HLS specific settings
await controller.setOption('hls-bitrate', 'max')
await controller.setOption('prefetch-playlist', 'yes')
```

---

## Memory / Performance Issues

### Memory Leaks
**Symptom**: Memory usage continuously growing

**Detection Methods**:
1. **Use Activity Monitor** (macOS) or **Task Manager** (Windows)
2. **Check memory usage patterns**
3. **Use Electron memory analysis tools**

**Common Leak Points**:
- Event listeners not removed
- Timers not cleaned up
- Large objects not released

**Code Checks**:
```typescript
// Proper event listener management
controller.on('status', handler)
// Clean up after use
controller.removeAllListeners('status')

// Proper timer management
const timer = setInterval(() => {}, 1000)
// Clean up after use
clearInterval(timer)
```

### High CPU Usage
**Symptom**: High CPU usage during playback

**Optimization Measures**:
1. **Enable Hardware Decoding**
   ```typescript
   await controller.setOption('hwdec', 'videotoolbox')  // macOS
   await controller.setOption('hwdec', 'd3d11va')       // Windows
   ```

2. **Reduce Render Load**
   ```typescript
   // Reduce OSD complexity
   await controller.setOption('osd-level', 1)
   
   // Reduce filters
   await controller.setOption('vf', '')
   ```

3. **Adjust Decoding Threads**
   ```typescript
   await controller.setOption('vd-lavc-threads', '4')
   ```

---

## Debugging Tools

### Built-in Debug Commands
```typescript
// Video state debugging
await corePlayer.debugVideoState()

// HDR state debugging
await corePlayer.debugHdrStatus()

// Send key for debugging
await corePlayer.sendKey('i')  // Show statistics
```

### External Debug Tools
1. **Electron DevTools**
   ```javascript
   // In main process
   mainWindow.webContents.openDevTools()
   ```

2. **Console Logs**
   ```bash
   # Enable verbose logging on startup
   ./mpv-player --log-level=debug
   ```

3. **Performance Analysis**
   ```bash
   # Use Instruments (macOS)
   instruments -t Time Profiler
   ```

### Log Collection
```typescript
// Enable MPV verbose logging
await controller.setOption('log-file', '/tmp/mpv-debug.log')
await controller.setOption('msg-level', 'all=v')

// View logs
tail -f /tmp/mpv-debug.log
```

---

## Issue Report Template

Encountering a new problem? Please provide the following information:

### Basic Information
- **App Version**: 
- **Operating System**: macOS/Windows version
- **Hardware**: CPU, GPU, Memory
- **Display**: Model, HDR support

### Problem Description
- **Issue**: 
- **Reproduction Steps**:
- **Expected Behavior**:
- **Actual Behavior**:

### Error Information
- **Console Output**:
- **Error Stack Trace**:
- **Log Files**:

### Environment Information
```bash
# Run diagnostic commands
./scripts/verify_environment.sh
./scripts/verify_distribution.sh

# Check HDR status
window.electronAPI.send('debug-hdr-status')
```

---

## Change Log

| Date | Changes |
|------|---------|
| 2026-01-25 | Created comprehensive troubleshooting guide |
| 2026-01-21 | Initial FAQ in README.md |

## Related Documentation

- [Development Environment Guide](./SETUP_GUIDE.md) - Environment setup issues
- [API Reference](./API_REFERENCE.md) - API usage issues
- [Deployment Guide](../deployment/DEPLOYMENT.md) - Packaging and deployment issues
- [Architecture Document](../ARCHITECTURE.md) - Understanding system architecture

## Emergency Support

If the issue cannot be resolved:
1. **Check GitHub Issues** - See if there's a known issue
2. **Submit a New Issue** - Use the issue report template
3. **Provide Diagnostic Information** - Run diagnostic commands and provide output
4. **Provide Sample Files** - If possible, provide video files that reproduce the issue
