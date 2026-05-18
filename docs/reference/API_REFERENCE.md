# API Quick Reference

> **Last Updated**: 2026-01-25  
> **Based on Architecture Version**: ARCHITECTURE.md v1.0  
> **Status**: Production Ready

## Core Interface Overview

### 1. CorePlayer
**File**: `src/main/application/core/corePlayer.ts`  
**Description**: Main entry point of the application, manages playback sessions and windows.

```typescript
// Get instance
import { createCorePlayer } from './application/core/corePlayer'
import { Media } from './domain/models/Media'

const corePlayer = createCorePlayer()

// Basic playback control
await corePlayer.play(new Media('/path/to/video.mp4', 'video.mp4'), 0)  // Play video
await corePlayer.pause()                     // Pause
await corePlayer.resume()                    // Resume playback
await corePlayer.stop()                      // Stop playback
await corePlayer.seek(120)                   // Seek to 120 seconds
await corePlayer.setVolume(75)               // Set volume to 75%

// Window management
await corePlayer.setVideoWindow(window)      // Set video window
await corePlayer.ensureMediaPlayerReadyForPlayback({ show: true, warmup: true }) // Prepare player

// Status queries
const status = corePlayer.getPlayerStatus()  // Get current status
corePlayer.on('player-status', listener)     // Listen for status changes
corePlayer.off('player-status', listener)    // Remove listener

// Utility functions
await corePlayer.sendKey('SPACE')             // Send key
await corePlayer.debugVideoState()            // Debug video state
await corePlayer.debugHdrStatus()             // Debug HDR status
corePlayer.setHdrEnabled(true)                // Enable HDR
await corePlayer.cleanup()                    // Clean up resources

// Session management
const session = corePlayer.getCurrentSession() // Get current playback session
```

### 2. LibMPVController
**File**: `src/main/infrastructure/mpv/LibMPVController.ts`  
**Description**: Main interface between business logic layer and native binding layer.

```typescript
import { LibMPVController, isLibMPVAvailable } from './infrastructure/mpv/LibMPVController'

// Check if libmpv is available
if (!isLibMPVAvailable()) {
  console.warn('libmpv native binding not available')
}

const controller = new LibMPVController()

// Initialization and configuration
await controller.initialize(windowId)         // Initialize MPV instance (optional windowId)
controller.setWindowId(windowId)              // Set window ID
await controller.setWindowSize(1920, 1080)    // Set window size

// Playback control
await controller.loadFile('/path/to/video.mp4', 0) // Load file (optional start time)
await controller.play()                       // Play
await controller.pause()                      // Pause
await controller.togglePause()                // Toggle pause/play
await controller.seek(150)                    // Seek to 150 seconds
await controller.setVolume(80)                // Set volume
await controller.stop()                       // Stop

// Property management
const width = await controller.getProperty('width')      // Get width
await controller.setProperty('pause', true)              // Set pause
await controller.command('set', 'pause', 'yes')          // Execute command (faster)
await controller.setOption('hwdec', 'auto-safe')         // Set option

// Render control (macOS specific)
controller.setJsDrivenRenderMode(true)        // Enable JS-driven render mode
const isJsDriven = controller.getJsDrivenRenderMode()   // Get current render mode
controller.requestRender()                    // Request render
controller.setHdrEnabled(true)                // Enable HDR

// Debugging
await controller.debugVideoState()            // Debug video state
await controller.debugHdrStatus()             // Debug HDR status
await controller.destroy()                    // Destroy instance
```

### 3. RenderManager
**File**: `src/main/infrastructure/rendering/renderManager.ts`  
**Description**: Manages the render loop and rendering decisions.

```typescript
import { RenderManager } from './infrastructure/rendering/renderManager'

const renderManager = new RenderManager(mediaPlayer, () => getPlayerStatus())

// Lifecycle
renderManager.start()                         // Start render loop
renderManager.stop()                          // Stop render loop
renderManager.isActive()                      // Check if active
renderManager.cleanup()                       // Clean up resources

// Configuration
renderManager.setMediaPlayer(mediaPlayer)     // Set media player (dynamic update)
renderManager.updateFps(60)                   // Update render interval based on framerate
renderManager.markSeekComplete()              // Mark Seek complete (needs render)
renderManager.markResizeStart()               // Mark Resize start
```

### 4. PlayerStateMachine
**File**: `src/main/application/state/playerState.ts`  
**Description**: Manages player state, inherits from EventEmitter.

```typescript
import { PlayerStateMachine } from './application/state/playerState'

const stateMachine = new PlayerStateMachine()

// State management
const state = stateMachine.getState()         // Get current state
stateMachine.setPhase('playing')              // Set playback phase
stateMachine.setError('Playback failed')      // Set error state
stateMachine.updateFromStatus(playerStatus)   // Update from player status
stateMachine.resetToIdle()                    // Reset to idle state
stateMachine.setSwitching(true)               // Set switching state

// Event listening
stateMachine.on('state', listener)            // Listen for state changes
stateMachine.off('state', listener)           // Remove listener
```

---

## Data Structures

### 1. PlayerStatus
```typescript
interface PlayerStatus {
  phase: PlayerPhase        // Playback phase
  position: number          // Current time (seconds)
  duration: number          // Total duration (seconds)
  volume: number            // Volume (0-100)
  path: string | null       // File path
  error: string | null      // Error message
  isSeeking: boolean        // Whether seeking
  isNetworkBuffering: boolean      // Network buffering
  networkBufferingPercent: number  // Buffer percentage
  errorMessage?: string     // Error message
  errorLogSnippet?: string[] // Error log snippet
}
```

### 2. PlayerPhase
```typescript
type PlayerPhase = 
  | 'idle'      // Idle state
  | 'loading'   // Loading
  | 'playing'   // Playing
  | 'paused'    // Paused
  | 'stopped'   // Stopped
  | 'ended'     // Playback ended
  | 'error'     // Error state
```

### 3. MPVStatus
```typescript
interface MPVStatus {
  position: number          // Current playback position (seconds)
  duration: number          // Video total duration (seconds)
  volume: number            // Volume (0-100)
  path: string | null       // Current file path
  phase: PlayerPhase        // Playback phase
  isSeeking: boolean        // Whether seeking
  isNetworkBuffering: boolean      // Whether network buffering
  networkBufferingPercent: number  // Network buffer percentage
  errorMessage?: string     // Error message
  errorLogSnippet?: string[] // Error log snippet
}
```

---

## IPC Communication

### 1. Player API
**Namespace**: `window.electronAPI.player`

#### Method Calls
```typescript
// Playback control
window.electronAPI.player.playMedia({ 
  name: 'video.mp4', 
  path: '/path/to/video.mp4',
  startTime: 0 
})
window.electronAPI.player.pause()
window.electronAPI.player.resume()
window.electronAPI.player.stop()
window.electronAPI.player.seek(120)
window.electronAPI.player.setVolume(75)
window.electronAPI.player.toggleFullscreen()

// Window control
window.electronAPI.player.windowAction('close')    // or 'minimize', 'maximize'

// Playlist
window.electronAPI.player.playNext()
window.electronAPI.player.playPrev()
```

#### Event Listeners (need cleanup handling)
```typescript
// Listen for status updates
const cleanup = window.electronAPI.player.onStatus((status) => {
  console.log('Player status:', status)
})

// Cleanup on component unmount
onUnmounted(() => {
  cleanup()
})

// Other events
window.electronAPI.player.onCurrentVideoChanged((video) => { ... })
window.electronAPI.player.onPlaylistUpdated((items) => { ... })
```

### 2. NAS API
**Namespace**: `window.electronAPI.nas`

#### Method Calls
```typescript
// Connection management
window.electronAPI.nas.getConnections()
window.electronAPI.nas.addConnection({ name: 'MyNAS', config: { ... } })
window.electronAPI.nas.testConnection({ config: { ... } })

// File browsing
window.electronAPI.nas.readDirectory({ connectionId: '...', path: '/' })
```

#### Event Listeners
```typescript
window.electronAPI.nas.onConnectionsUpdated(({ connections }) => { ... })
window.electronAPI.nas.onTestConnectionResult(({ success, error }) => { ... })
```

### 3. FileSystem API
**Namespace**: `window.electronAPI.fileSystem`

#### Method Calls
```typescript
// File selection
window.electronAPI.fileSystem.selectVideoFile()

// Mount path management
window.electronAPI.fileSystem.getMountPaths()
window.electronAPI.fileSystem.addMountPath('D:/Movies')
```

#### Event Listeners
```typescript
window.electronAPI.fileSystem.onVideoFileSelected(({ name, path }) => { ... })
window.electronAPI.fileSystem.onMountPathsUpdated(({ mountPaths }) => { ... })
```

### Common IPC Messages

| Message Channel | Parameter Type | Description | Handler Location |
|---------|---------|------|------------|
| `play-video` | `{name: string, path: string}` | Play video | `src/main/application/command/handlers/playbackHandlers.ts` |
| `control-pause` | None | Pause playback | `src/main/application/command/handlers/playbackHandlers.ts` |
| `control-play` | None | Resume playback | `src/main/application/command/handlers/playbackHandlers.ts` |
| `control-seek` | `number` | Seek to time | `src/main/application/command/handlers/playbackHandlers.ts` |
| `control-volume` | `number` | Set volume | `src/main/application/command/handlers/playbackHandlers.ts` |
| `control-hdr` | `boolean` | Set HDR | `src/main/application/command/handlers/playbackHandlers.ts` |
| `debug-hdr-status` | None | Debug HDR status | `src/main/application/command/handlers/debugHandlers.ts` |

---

## Platform-Specific APIs

### macOS Specific Features
```typescript
// JavaScript-driven render mode (replaces CVDisplayLink)
controller.setJsDrivenRenderMode(true)  // Enable
controller.getJsDrivenRenderMode()      // Get current mode
controller.requestRender()              // Request render

// HDR configuration
controller.setHdrEnabled(true)          // Enable HDR
await controller.debugHdrStatus()       // Debug HDR status
```

### Windows Specific Features
```typescript
// Windows uses dual window mode
corePlayer.setControlWindow(controlWindow)  // Set control window
corePlayer.setVideoWindow(videoWindow)      // Set video window
```

---

## Utility Functions

### NativeHelper (Platform Window Handle Retrieval)
```typescript
import { getNSViewPointer, getHWNDPointer } from './nativeHelper'

// macOS: Get NSView pointer
const viewPtr = getNSViewPointer(window)  // BrowserWindow → NSView pointer

// Windows: Get HWND pointer  
const hwndPtr = getHWNDPointer(window)    // BrowserWindow → HWND pointer
```

### Timeline Management
```typescript
// Timeline class provides time update functionality
timeline.start()                          // Start timeline
timeline.stop()                           // Stop timeline
timeline.dispose()                        // Clean up resources
```

---

## Quick Usage Examples

### Basic Playback Flow
```typescript
import { createCorePlayer } from './application/core/corePlayer'
import { Media } from './domain/models/Media'

const corePlayer = createCorePlayer()

// 1. Set video window
await corePlayer.setVideoWindow(window)
await corePlayer.ensureMediaPlayerReadyForPlayback({ show: true })

// 2. Play video
await corePlayer.play(new Media('/path/to/video.mp4', 'video.mp4'), 0)

// 3. Listen for status changes
corePlayer.on('player-status', (status) => {
  console.log('Current status:', status.phase)
  console.log('Current time:', status.position, '/', status.duration)
})

// 4. Control playback
await corePlayer.pause()
await corePlayer.seek(60)  // Seek to 1 minute
await corePlayer.setVolume(80)
await corePlayer.resume()

// 5. Debugging
await corePlayer.debugVideoState()
await corePlayer.debugHdrStatus()

// 6. Cleanup
await corePlayer.cleanup()
```

### Integration into UI Components
```vue
<script setup lang="ts">
// Vue component example
import { onMounted, onUnmounted, ref } from 'vue'

const playerStatus = ref(null)

onMounted(() => {
  // Listen for player status
  window.electronAPI.player.onStatus((status) => {
    playerStatus.value = status
  })
})

onUnmounted(() => {
  // Clean up listeners
  // Note: Specific cleanup method depends on implementation in preload.ts
})

// Control playback
function playVideo(path: string) {
  window.electronAPI.player.playMedia({ 
    name: path.split('/').pop(), 
    path, 
    startTime: 0 
  })
}

function pauseVideo() {
  window.electronAPI.player.pause()
}

function seekTo(time: number) {
  window.electronAPI.player.seek(time)
}
</script>
```

---

## Performance Optimization APIs

### Render Performance Configuration
```typescript
// RenderManager performance parameters
const renderManager = new RenderManager(controller, getState)

// Dynamically adjust render interval
renderManager.updateFps(60)  // Optimize based on video framerate

// Default render interval
DEFAULT_RENDER_INTERVAL_MS = 20ms  // 50fps
MIN_RENDER_INTERVAL_MS = 16ms      // 60fps limit
```

### Apple Silicon Hardware Acceleration
```typescript
// Automatically enabled during initialization
if (process.arch === 'arm64' && process.platform === 'darwin') {
  await controller.setOption('hwdec', 'videotoolbox')
}
```

### Responsiveness Optimization
```typescript
// Recommended MPV configuration options
await controller.setOption('osd-level', 1)           // Reduce OSD complexity
await controller.setOption('video-sync', 'audio')    // Audio sync mode
await controller.setOption('input-queue-size', 2)    // Reduce input queue
await controller.setOption('video-latency-hacks', true) // Video latency optimization
```

---

## Debug APIs

### Video State Debugging
```typescript
// Print detailed video parameters
await controller.debugVideoState()

// Sample output:
// === MPV Video State Debug ===
// Video size: 1920x1080
// primaries: bt.2020
// gamma (transfer): pq
// tone-mapping: bt.2390
// target-peak: 1000
// ============================
```

### HDR Status Debugging
```typescript
// Print HDR related information
await controller.debugHdrStatus()

// Sample output:
// [debug-hdr-status] dvProfile=5 primaries=bt.2020 gamma=pq
```

### Network Buffer Monitoring
```typescript
// Listen for network buffering status
controller.on('status', (status) => {
  if (status.isNetworkBuffering) {
    console.log(`Buffering: ${status.networkBufferingPercent}%`)
  }
})
```

---

## API Compatibility

### Version Compatibility
| API | Introduced Version | Status | Notes |
|-----|---------|------|------|
| `createCorePlayer()` | v1.0 | Stable | Core player factory |
| `corePlayer.play(Media)` | v1.0 | Stable | Basic playback functionality |
| `setJsDrivenRenderMode()` | v1.2 | Stable | macOS optimization |
| `setHdrEnabled()` | v1.3 | Stable | HDR support |
| `debugHdrStatus()` | v1.4 | Stable | Debug tool |
| `ensureMediaPlayerReadyForPlayback()` | v1.5 | Stable | Player preparation |

### Platform Support
| API | macOS | Windows | Linux |
|-----|-------|---------|-------|
| `setJsDrivenRenderMode()` | ✅ | ❌ | ❌ |
| `requestRender()` | ✅ | ❌ | ❌ |
| `setHdrEnabled()` | ✅ | ❌ | ❌ |
| `ensureMediaPlayerReadyForPlayback()` | ✅ | ✅ | ❌ |

---

## Related Documentation

- [Full Architecture Document](../ARCHITECTURE.md) - Detailed interface descriptions and architecture design
- [Development Environment Guide](./SETUP_GUIDE.md) - Environment setup and build instructions
- [Troubleshooting Guide](./TROUBLESHOOTING.md) - Common issue solutions
- [Deployment Guide](../deployment/DEPLOYMENT.md) - Packaging and distribution guide

---

## Change Log

| Date | Changes |
|------|---------|
| 2026-02-05 | Updated API documentation to match actual code implementation, corrected file paths and method signatures |
| 2026-01-25 | Created API quick reference |
| 2026-01-21 | Extracted core APIs based on ARCHITECTURE.md v1.0 |

## Usage Tips

1. **Async Handling**: All playback control APIs are async, use `await` or `.then()`
2. **Error Handling**: Use try-catch to handle potential errors
3. **Resource Cleanup**: Call `cleanup()` or `destroy()` after use to release resources
4. **Status Listening**: Use event listeners instead of polling status
5. **Platform Detection**: Use `process.platform` to detect platform and call corresponding APIs
