# Progress Bar Thumbnail System Technical Design

> Document Type: Technical Architecture Design
> Coverage: Full implementation of progress bar hover preview thumbnails, from frontend interaction to native GPU rendering

---

## 1. Feature Overview

When the user hovers over the progress bar, a video frame preview (160x90px) of the corresponding time point is displayed above the mouse position, updating in real-time as the mouse moves.

**Core Requirements:**
- Frame content matches the hover time (accurate to the second)
- Fast response without blocking the UI
- Immediate display when hovering over the same time point again (no regeneration)
- Complete state isolation after video switch

---

## 2. Overall Architecture

The system is divided into four layers with clear separation of responsibilities:

```
┌───────────────────────────────────────────────────────────┐
│  Renderer Process                                          │
│                                                           │
│  PlayerProgressBar.vue   ← Display layer (160x90 preview) │
│        ↕                                                   │
│  useProgressBar.ts       ← Interaction layer (throttling,  │
│                            L1 cache, IPC calls)            │
└────────────────────┬──────────────────────────────────────┘
                     │ IPC (thumbnail:seek-at)
┌────────────────────▼──────────────────────────────────────┐
│  Main Process                                              │
│                                                           │
│  thumbnailHandlers.ts    ← IPC routing layer              │
│        ↕                                                   │
│  ThumbnailService        ← Business layer (L2 disk cache, │
│                            generation protection)          │
│        ↕                                                   │
│  MpvThumbnailGenerator   ← Native wrapper layer           │
└────────────────────┬──────────────────────────────────────┘
                     │ N-API AsyncWorker
┌────────────────────▼──────────────────────────────────────┐
│  Native (macOS)                                           │
│                                                           │
│  mpv_thumbnail.mm        ← GPU rendering layer            │
│                           (persistent mpv instance)        │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Cache Architecture

The system maintains two levels of cache for different hit scenarios:

```
Request seekAt(time)
        │
        ▼
  L1 Memory Cache (Renderer)
  Map<number, thumb:// URL>
  ├── Hit → display immediately, 0ms latency
  └── Miss ↓
        │
        ▼ IPC
  L2 Disk Cache (Main Process)
  {hash}_t{N}.jpg
  ├── Hit → return thumb:// URL, disk read latency
  └── Miss ↓
        │
        ▼ N-API AsyncWorker
  Native Generation
  mpv GPU render → JPEG write to disk
  → Write L2 → return URL → Write L1
```

| Level | Storage Location | Key | Lifecycle | Characteristics |
|---|---|---|---|---|
| L1 | Renderer Memory | Time (whole second) | During current video playback | 0ms, cleared on switch |
| L2 | User data directory/thumbnails/ | `{MD5(path)}_t{seconds}.jpg` | Persists across sessions | Reusable after restart |

---

## 4. Initialization Flow

After a video finishes loading, the seek thumbnail system needs to warm up a persistent mpv instance. This is a prerequisite for all seekAt requests.

```
Video file loaded successfully
        │
        ▼
Frontend watch(currentPath) triggers
        ├─ L1 cache cleared
        ├─ pathGeneration incremented (prevent old request pollution)
        └─ fire-and-forget: seekInit(newPath)
                │ IPC: thumbnail:seek-init
                ▼
        Service.initSeekThumbnail()
                ├─ seekGeneration incremented
                ├─ Check: same video already initialized? → reuse, return directly
                ├─ Different video: destroy old mpv instance
                └─ Initiate native seekInit (async)
                        │ AsyncWorker
                        ▼
                native mpv_thumb_seek_init()
                        ├─ Create mpv instance (ao=null, pause=yes)
                        ├─ Create headless OpenGL context (CGL, OpenGL 3.2 Core)
                        ├─ Create mpv render context
                        ├─ Allocate FBO (160x90 RGBA8 texture)
                        ├─ Load file, wait FILE_LOADED (max 10s)
                        ├─ Detect Dolby Vision → switch tone mapping
                        └─ Save to global g_seek_ctx
```

**Note**: seekInit is fire-and-forget and does not block video playback. If a seekAt request arrives before initialization is complete, the Service layer will await pendingSeekInit before proceeding.

---

## 5. Hover Request Complete Data Flow

```
User hovers over progress bar
        │
        ▼
useProgressBar: onProgressHoverMove()
        ├─ Calculate pct = mouseX / progress bar width
        ├─ time = pct x duration
        ├─ roundedTime = Math.round(time)  ← accurate to second
        ├─ Dedup: roundedTime === lastThumbTime? → return
        ├─ L1 hit? → immediately update hoverThumbnail, return
        ├─ Record gen = pathGeneration
        └─ Throttle 150ms
                │
                ▼ (150ms later, if not cancelled by new hover)
        IPC: seekAt(path, roundedTime)
                │
                ▼
        Service.getSeekThumbnail(path, time)
                ├─ Record gen = seekGeneration
                ├─ L2 hit? → return thumb:// URL
                ├─ seekInit ready? → seekAt directly
                │  Otherwise await pendingSeekInit
                ├─ gen check (prevent video switch during initialization)
                └─ generator.seekAt(roundedTime, cachePath)
                        │ AsyncWorker → g_seek_mutex (serialized)
                        ▼
                native mpv_thumb_seek_at()
                        ├─ ① Pipeline Flush (consume old frames)
                        │     Check pending frame → render and consume (discard)
                        │     Drain event queue (non-blocking)
                        ├─ ② Seek (absolute, keyframe precision)
                        ├─ ③ Wait PLAYBACK_RESTART (max 3s) ← authoritative completion signal
                        ├─ ④ Wait RENDER_UPDATE_FRAME (max 0.3s)
                        ├─ ⑤ GPU render to FBO
                        ├─ ⑥ glReadPixels → pixel buffer
                        ├─ ⑦ Row flip (OpenGL Y-axis adjustment)
                        └─ ⑧ Encode as JPEG, write to disk
                │
                ▼ Return thumb:// URL
        Service gen check (prevent video switch during seekAt)
        → Write L2 (disk file already exists)
        → Return URL
                │
                ▼
        Frontend gen check (prevent path switch during IPC return)
        → Write L1 cache
        → Update hoverThumbnail.value
                │
                ▼
        PlayerProgressBar.vue reactive rendering
        → Display <img src="thumb://...">
```

---

## 6. Generation Mechanism (Prevent Old Result Pollution)

The system has two independent generation counters, each responsible for one boundary:

```
pathGeneration (Frontend)
  Scope: Renderer process
  Trigger: At the start of watch(currentPath) callback
  Protection point: Before IPC async callback writes to L1 cache

seekGeneration (Service)
  Scope: Main process
  Trigger: At the start of initSeekThumbnail() call
  Protection point 1: After seekInit await completes, before writing to L2
  Protection point 2: After seekAt await completes, before writing to L2
```

**Typical scenario**: Video A's seekAt request is being executed in native (200ms), when the user switches to video B. Both generations increment simultaneously. When A's result returns, both layers of verification fail, the result is discarded, and no cache is written.

---

## 7. Concurrency and Thread Safety

```
JS Main Thread (Renderer)
  ← Throttle 150ms, only send one IPC per second

JS Main Thread (Main)
  ← Service layer async, serializes seekAt for the same video

libuv Thread Pool (N-API AsyncWorker)
  ← All native calls execute async via AsyncWorker
  ← g_seek_mutex ensures only one seekAt executes in native at a time

Native (any thread)
  ← g_seek_mutex (std::mutex) protects g_seek_ctx global state
```

The dual guarantee of AsyncWorker serialization + mutex ensures that only one frame is rendering on the GPU at any given time, eliminating the problem of multiple frames concurrently writing to the same FBO.

---

## 8. Native GPU Rendering Pipeline

Seek thumbnails use **exactly the same** GPU rendering pipeline as the player, ensuring that thumbnails for special content like HDR/DV match the playback image.

```
Video decoding (hwdec: auto)
        ↓
mpv video filter pipeline
        ↓
Color management
  ├─ target-prim: bt.709
  ├─ target-trc: srgb
  ├─ tone-mapping: bt.2390 (SDR output)
  └─ Dolby Vision: auto-switch st2094-10
        ↓
Scaling (scale: lanczos, dscale: mitchell)
        ↓
mpv render context → OpenGL FBO (160x90 RGBA8)
        ↓
glReadPixels → CPU pixel buffer
        ↓
Row flip (OpenGL Y-axis adjustment)
        ↓
CoreGraphics CGBitmapContext
        ↓
ImageIO CGImageDestination → JPEG (quality 0.8)
        ↓
Write to disk
```

**Why use GPU pipeline instead of software decode frame capture:**
- Ensures correct tone mapping for HDR/DV content; software decode frame capture gets raw HDR data, which would be overexposed when writing directly to JPEG
- Scaling quality matches playback (Lanczos interpolation)
- Reuses mpv's already initialized decoder and color management configuration

---

## 9. Seek Precision Design

Uses `absolute` (keyframe-aligned), not `absolute+exact`.

| Mode | Precision | Speed | Use Case |
|---|---|---|---|
| `absolute+exact` | Frame-level accurate | Slow (needs decode keyframe → target frame) | Precise editing |
| `absolute` | Keyframe-aligned (typically < 3s error) | Fast | Hover preview ✅ |

Hover preview semantics are "roughly see what's at this position"; keyframe precision is entirely sufficient and avoids race conditions caused by multiple `RENDER_UPDATE_FRAME` triggers from decoding intermediate frames.

**Wait signal selection:**

| Signal | Meaning | Reliability |
|---|---|---|
| `MPV_RENDER_UPDATE_FRAME` | Frame available for rendering | ❌ Could be intermediate frame during decoding |
| `MPV_EVENT_PLAYBACK_RESTART` | Seek fully complete, decoder in place | ✅ Authoritative signal |

The system waits for `PLAYBACK_RESTART` before capturing the frame, ensuring it gets the frame at the seek target position.

---

## 10. Custom Protocol thumb://

Thumbnail files are served to the Renderer via the custom protocol `thumb://`, avoiding CSP restrictions of the `file://` protocol.

```
thumb://{filename}.jpg
        ↓
bootstrap.ts: protocol.handle('thumb', handler)
        ↓
Path traversal protection: resolved path must be within thumbnailDir
        ↓
net.fetch(pathToFileURL(resolved))
        ↓
<img src="thumb://..."> loads normally
```

---

## 11. autoThumbnail Toggle

All IPC handlers respect user settings:

- `autoThumbnail = true`: Normal generation
- `autoThumbnail = false`: Only return existing disk cache, do not trigger any new generation; seekAt returns null directly

---

## 12. Network Resources

v1 currently does not support generating seek thumbnails for network resources. The Service layer returns false directly for non-local paths (`existsSync` returns false), and native code does not execute.

When v2 NAS/HTTP VOD support is added:
- Distinguish local/network paths, skip `existsSync` check for network paths
- Increase timeout appropriately (`PLAYBACK_RESTART` wait recommended ≥ 15s)
- Live streams (detect rtsp/rtmp/hls live) skip directly, do not generate

---

## 13. Disk Cache Cleanup

Cache directory: `~/Library/Application Support/lumiere/thumbnails/`

File naming rules:
- Video cover image: `{MD5(path)}.jpg`
- Seek preview frames: `{MD5(path)}_t{seconds}.jpg`
- Sprite Sheet: `{MD5(path)}_strip.jpg`

Currently no automatic cleanup strategy. Manual cleanup in settings during v1 phase.
