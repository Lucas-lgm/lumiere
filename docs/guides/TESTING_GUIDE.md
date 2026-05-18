# Semantic Refactoring Testing Guide

> **Created**: 2026-01-25  
> **Last Updated**: 2026-01-25  
> **Status**: Active  
> **Scope**: Domain model, adapter layer, application layer tests

## Quick Start (Recommended)

### Method 1: Using IPC Commands (Simplest)

```bash
# 1. Compile code
npm run build

# 2. Start application
npm run dev

# 3. In the renderer process console (browser console), run:
window.electronAPI.send('test-semantic-refactoring')

# 4. Check main process console output
```

**Note**: If a security warning appears in the console ("Don't paste code..."), this is a normal security prompt:
- If the code is from a trusted source (e.g., copied from project documentation), you can safely type `allow pasting` and press Enter
- Or manually type the code instead of pasting

### Method 2: Dev Mode Auto-Test

The application is configured to automatically run tests in dev mode:

```bash
# Start dev mode (will automatically run tests)
NODE_ENV=development npm run dev
```

After startup, the main process console will automatically display test results.

---

## Test Levels

### 1. Domain Model Tests (Can Test Immediately)

**Scope**: `src/main/domain/models/`

**Features**: 
- Pure logic, no external dependencies
- Can be tested immediately
- Does not require Electron environment

**Testing Methods**:

#### In Electron Main Process Console

1. Start the app: `npm run dev`
2. Open main process console (`Cmd+Option+I`, select Main Process)
3. Run test code:

```javascript
// Test Media model
const { Media } = require('./out/main/domain/models/Media.js')
const media = Media.create('/test/video.mp4', { title: 'Test Video' })
console.log('Media:', media.displayName, media.isLocalFile)

// Test Playlist model  
const { Playlist } = require('./out/main/domain/models/Playlist.js')
const playlist = new Playlist()
playlist.add(media)
console.log('Playlist size:', playlist.size)

// Test PlaybackSession
const { PlaybackSession, PlaybackStatus } = require('./out/main/domain/models/Playback.js')
const session = PlaybackSession.create(media, PlaybackStatus.PLAYING, { currentTime: 30, duration: 120 }, 75)
console.log('Session:', session.isPlaying, session.canSeek)
```

**Note**: Since electron-vite bundles code into a single `main.js` file, if the above method doesn't work, please use the IPC command (Method 1).

### 2. Adapter Layer Tests

**Scope**: `src/main/infrastructure/mpv/MpvAdapter.ts`

**Testing Method**:

```javascript
// In main process console
const { MpvAdapter } = require('./out/main/infrastructure/mpv/MpvAdapter.js')
const { Media } = require('./out/main/domain/models/Media.js')

const media = Media.create('/test.mp4', { title: 'Test' })
const mpvStatus = {
  position: 45,
  duration: 180,
  volume: 80,
  path: '/test.mp4',
  phase: 'playing',
  isSeeking: false,
  isNetworkBuffering: false,
  networkBufferingPercent: 0
}

const adapted = MpvAdapter.toPlaybackSession(mpvStatus, media)
console.log('Adapter:', adapted.status, adapted.progress.percentage.toFixed(1) + '%')
```

### 3. Application Layer Tests

**Scope**: `src/main/application/`

**Testing Method**:

Requires creating an `ApplicationService` instance and testing various command and query handlers. Integration testing in the Electron environment is recommended.

---

## Checking Compiled Files

Run the following commands to check if files are compiled:

```bash
# Check domain model files
ls -la out/main/domain/models/

# Check adapter files
ls -la out/main/infrastructure/mpv/

# Check application layer files
ls -la out/main/application/
```

**Note**: electron-vite only compiles files directly or indirectly imported by `main.ts`. If a file doesn't exist, it means it hasn't been imported.

---

## Common Issues

### Issue 0: Console Security Warning

**Symptom**:
```
Warning: Don't paste code into the DevTools Console that you don't understand...
Please type 'allow pasting' below to allow pasting.
```

**Cause**: This is an Electron DevTools security feature to prevent accidental pasting of malicious code.

**Solution**:
1. **If the code source is trustworthy** (e.g., copied from project documentation):
   - Type `allow pasting` then press Enter
   - Then paste the code

2. **Recommended approach** (safer):
   - Manually type the code instead of pasting
   - Or use the IPC command (Method 1) to avoid pasting in console

### Issue 1: Module Not Found

```
Error: Cannot find module './out/main/domain/models/Media.js'
```

**Cause**: electron-vite bundles all code into a single `main.js` file.

**Solution**: Use IPC command testing (Method 1), or use dev mode auto-test (Method 2).

### Issue 2: Where is the Main Process Console?

- In the Electron window, press `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Windows)
- Make sure to select the **Main Process** tab (not Renderer)

### Issue 3: Files Not Compiled

electron-vite only compiles files directly or indirectly imported by `main.ts`.

**Solution**: 
- Use IPC command (recommended)
- Or ensure test files are imported by `main.ts` (already configured)

---

## Testing Checklist

After running tests, confirm:

- [ ] Media model can be created
- [ ] Media property access works
- [ ] Playlist add, remove, switch work
- [ ] PlaybackSession state transitions correct
- [ ] MpvAdapter conversion correct
- [ ] No error output

---

## Recommended Test Workflow

### Quick Verification

1. Compile: `npm run build`
2. Start: `npm run dev`
3. Use IPC command: In renderer process console run `window.electronAPI.send('test-semantic-refactoring')`
4. Check main process console output

### Full Testing

1. Start dev mode: `NODE_ENV=development npm run dev`
2. Check auto-run test results
3. Manually test individual models as needed

---

## Related Files

- Test code: `src/main/test_semantic_refactoring.ts`
- IPC handler: `src/main/ipcHandlers.ts` (includes `test-semantic-refactoring` command)
- Main entry: `src/main/main.ts` (runs tests automatically in dev mode)
