# Progress Bar Thumbnail Time Accuracy Fix

> Status: Pending Implementation
> Priority: P0 (Affects Core Experience)
> Involved Files: `native/mpv_thumbnail.mm` · `src/main/application/services/thumbnailService.ts` · `src/renderer/src/composables/useProgressBar.ts`

---

## 1. Problem Description

In the progress bar hover preview feature, there is an intermittent issue where the **thumbnail displayed does not match the hover time**:

- Hovering over time `a` shows an image much earlier than `a` (e.g., near the beginning of the video)
- Moving the mouse forward one second displays the correct image
- Moving back to `a`, due to L1/L2 cache hits, the incorrect image is still displayed

---

## 2. Root Cause Analysis

### 2.1 Decoding Timing of `absolute+exact` Seek

mpv's `absolute+exact` seek is not an atomic operation. It first needs to locate the nearest keyframe, then decode frame by frame to the exact target position. Throughout this process, `MPV_RENDER_UPDATE_FRAME` fires after **each frame is decoded**, not only at the target frame.

```
Video Timeline:
  ─────────────┬──────────────────────────┬────────────
               k (keyframe, e.g., 0s)     a (target, e.g., 80s)

mpv internal event stream (seek to a):
  seek command issued
  │
  ├─ MPV_EVENT_SEEK              ← seek started (notifying external)
  ├─ MPV_RENDER_UPDATE_FRAME     ← keyframe k can be rendered  ⚠️
  ├─ MPV_RENDER_UPDATE_FRAME     ← intermediate frame 1        ⚠️
  ├─ MPV_RENDER_UPDATE_FRAME     ← intermediate frame 2        ⚠️
  ├─ ...
  ├─ MPV_EVENT_PLAYBACK_RESTART  ← seek fully complete ✅
  └─ MPV_RENDER_UPDATE_FRAME     ← target frame a can render  ✅
```

### 2.2 Current Wait Logic (Flawed)

```c
// native/mpv_thumbnail.mm:854
for (int i = 0; i < 100 && !frame_ready; i++) {
    mpv_wait_event(g_seek_ctx.mpv, 0.05);
    uint64_t flags = mpv_render_context_update(g_seek_ctx.render_ctx);
    if (flags & MPV_RENDER_UPDATE_FRAME) frame_ready = true;  // ← Catches the first one, which could be the keyframe!
}
```

**Problem**: Catching the first `MPV_RENDER_UPDATE_FRAME` assumes the target frame is ready, but this flag could come from keyframe k (tens of seconds earlier than the target).

### 2.3 Incomplete Pre-flush

```c
// native/mpv_thumbnail.mm:840
while (mpv_render_context_update(g_seek_ctx.render_ctx) & MPV_RENDER_UPDATE_FRAME) {}
while (true) {
    mpv_event *ev = mpv_wait_event(g_seek_ctx.mpv, 0);  // timeout=0, non-blocking
    if (ev->event_id == MPV_EVENT_NONE) break;
}
```

`mpv_wait_event(0)` only clears **already queued** events, not the frame signals that mpv's decoding thread is **about to produce**. Additionally, `mpv_render_context_update` only reads and clears the flag, without actually consuming the frame -- the flag will reappear when the next frame arrives.

### 2.4 Permanent Dirty Cache Pollution

Once an incorrect frame is written to disk (`{hash}_t{N}.jpg`), both the L2 cache and the L1 memory cache will hit it until the user manually clears the cache. If an old request returns during a video switch, it may also write incorrect frames to the new video's cache path.

---

## 3. Complete Data Flow Architecture

```
Renderer Process
┌─────────────────────────────────────────────────────────────────┐
│  PlayerProgressBar.vue                                          │
│       @mousemove                                                │
│           │                                                     │
│  useProgressBar.ts                                              │
│       ├─ pct = x / width * 100                                 │
│       ├─ time = pct * duration / 100                           │
│       ├─ roundedTime = Math.round(time)                        │
│       ├─ dedup: roundedTime === lastThumbTime → skip            │
│       ├─ L1 hit? → display immediately ←─────────────────────┐ │
│       └─ throttle 150ms → IPC                                 │ │
│                                                               │ │
│       L1 Cache: Map<number, string>  ← in-memory, per-session │ │
│       (Once a dirty frame is written, the entire session      │ │
│        will hit the incorrect result)                          │ │
└───────┬───────────────────────────────────────────────────────┘ │
        │ IPC: thumbnail:seek-at(path, roundedTime)               │
        ▼                                                          │
Main Process                                                       │
┌─────────────────────────────────────────────────────────────────┤
│  ThumbnailService                                               │
│       ├─ L2 hit? (disk: {hash}_t{N}.jpg) → return URL ─────────┘
│       ├─ [NEW] seekGeneration check (prevent old results        │
│       │         from writing during video switch)               │
│       └─ generator.seekAt(roundedTime, cachePath)              │
│                                                                 │
│       L2 Cache: disk file {hash}_t{N}.jpg                      │
│       (Persists across sessions; requires manual cleanup        │
│        after dirty frame written)                               │
└───────┬─────────────────────────────────────────────────────────┘
        │ N-API AsyncWorker (libuv thread pool)
        │ g_seek_mutex (serializes all seekAt requests)
        ▼
Native Layer
┌─────────────────────────────────────────────────────────────────┐
│  mpv_thumb_seek_at()                                            │
│                                                                 │
│  g_seek_ctx (global singleton, persistent mpv instance)         │
│       ├─ mpv_handle + mpv_render_context                       │
│       ├─ OpenGL FBO (160x90)                                   │
│       └─ pixel buffer                                          │
│                                                                 │
│  Execution flow (after fix):                                    │
│   ① render consumes old frames (flush pipeline)                │
│   ② drain event queue (non-blocking)                           │
│   ③ seek(absolute)                                             │
│   ④ wait MPV_EVENT_PLAYBACK_RESTART (authoritative completion) │
│   ⑤ wait MPV_RENDER_UPDATE_FRAME (now trustworthy)             │
│   ⑥ render → glReadPixels → JPEG                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Bug Timing Diagram (Before Fix)

```
Timeline ──────────────────────────────────────────────────────────>

User Action:   hover(t=20s)
                    │
Frontend:    seekAt(path, 20)
                    │ IPC
Service:        ├─ disk miss
                └─ generator.seekAt(20, "hash_t20.jpg")
                        │ AsyncWorker enqueued
Native:                 │
                   [acquired mutex]
                        ├─ flush: mpv_wait_event(0)     ← non-blocking, may have residual
                        ├─ seek(20, "absolute+exact")
                        │
                        │  mpv starts decoding internally:
                        │    found keyframe k = 0s
                        │    MPV_RENDER_UPDATE_FRAME ←── frame at 0s can be rendered!
                        │                    │
                        ├─ wait loop detects flag ✓
                        ├─ render → gets frame at 0s
                        ├─ write hash_t20.jpg   ← ❌ writes incorrect frame (0s image)
                        └─ release mutex

Service:  return "thumb://hash_t20.jpg"
Frontend: L1 cache: { 20 → "thumb://hash_t20.jpg" }  ← ❌ polluted
          Display: 0s image

──── User moves forward 1 second ────

Frontend:    seekAt(path, 19)
Native:       seek(19) → keyframe near 18s → correct frame
              write hash_t19.jpg  ← ✅
Display: correct image at 19s

──── User returns to 20s ────

Frontend:    L1 cache hit: { 20 → "thumb://hash_t20.jpg" }
Display:    ❌ 0s image (dirty cache)
```

---

## 5. Fixed Timing Diagram

```
Timeline ──────────────────────────────────────────────────────────>

User Action:   hover(t=80s)
                    │
Native:    [acquired mutex]
                │
                ├─ ① PIPELINE FLUSH (actually consume old frames)
                │     check MPV_RENDER_UPDATE_FRAME
                │     if present → render to FBO, discard pixels
                │     glFinish()
                │     drain event queue (non-blocking)
                │
                ├─ ② SEEK (changed to absolute, without +exact)
                │     mpv_command("seek", "80.000", "absolute")
                │
                │     mpv internal event stream:
                │       MPV_EVENT_SEEK              ← started (ignore)
                │       MPV_RENDER_UPDATE_FRAME     ← keyframe, ignore ✗
                │       MPV_RENDER_UPDATE_FRAME     ← intermediate, ignore ✗
                │       MPV_EVENT_PLAYBACK_RESTART  ← wait for this! ✅
                │       MPV_RENDER_UPDATE_FRAME     ← target frame ✅
                │
                ├─ ③ WAIT PLAYBACK_RESTART (timeout = 3s)
                │     loop(100 times x 30ms):
                │       ev = mpv_wait_event(mpv, 0.03)
                │       END_FILE   → return false (file error)
                │       PLAYBACK_RESTART → break ✅ (seek complete)
                │     timeout → return false
                │
                ├─ ④ WAIT RENDER_UPDATE_FRAME (timeout = 0.3s)
                │     loop(30 times x 10ms):
                │       flags = mpv_render_context_update(render_ctx)
                │       MPV_RENDER_UPDATE_FRAME → break ✅
                │     (PLAYBACK_RESTART already confirmed; can proceed with
                │      rendering even if timeout occurs)
                │
                ├─ ⑤ RENDER + READ + JPEG
                │     mpv_render_context_render(render_ctx, params)
                │     glFinish()
                │     glReadPixels → pixels
                │     write_jpeg("hash_t80.jpg")  ← ✅ correct 80s frame
                │
                └─ release mutex

Service:  [seekGeneration check passed]
          return "thumb://hash_t80.jpg"
Frontend: L1 cache: { 80 → "thumb://hash_t80.jpg" }  ← ✅ correct
          Display: correct image at 80s
```

---

## 6. Protection During Video Switch (Generation Mechanism)

### Problem Scenario

```
seekGeneration = 1 (video A)

User:   seekAt(A, t=30)  → AsyncWorker enqueued, takes 200ms
        Switch to video B → seekGeneration = 2, seekInit(B) starts

Worker returns: success=true, path hash_t30.jpg
                 gen(1) ≠ seekGeneration(2) → ❌ discard, don't write to disk
                 → return null

Frontend:   null → don't update L1 cache, don't update display
```

### Service Layer Implementation

```
ThumbnailService

  private seekGeneration = 0               ← new

  initSeekThumbnail(videoPath):
    this.seekGeneration++                   ← increment on video switch
    const gen = this.seekGeneration
    ... existing init logic ...

  getSeekThumbnail(videoPath, time):
    const gen = this.seekGeneration         ← record generation at request time
    ... existing seek init check ...
    const success = await generator.seekAt(time, cachePath)
    if (gen !== this.seekGeneration)        ← switch occurred during operation, discard
        return null
    if (!success) return null
    return toThumbUrl(cachePath)
```

### Frontend Layer Implementation

```
useProgressBar.ts

  let pathGeneration = 0                    ← new

  watch(currentPath):
    pathGeneration++                        ← increment on path switch
    ... existing cleanup logic ...

  onProgressHoverMove (throttle callback):
    const gen = pathGeneration              ← record generation at request time
    setTimeout(async () => {
        const url = await seekAt(path, time)
        if (gen !== pathGeneration) return  ← path already switched, discard
        if (url) {
            thumbnailCache.set(time, url)
            hoverThumbnail.value = { url, time }
        }
    }, 150)
```

---

## 7. flip_y Flipping Notes (Maintain Current Behavior)

`flip_y=1` + manual flipping has been verified to produce correct image orientation and will remain unchanged.

In theory, `flip_y=1` should produce top-to-bottom output, but actual behavior depends on mpv version/driver. The current two-step combination produces correct results and will not be modified.

---

## 8. Change Summary Table

| Layer | File | Change | Priority |
|---|---|---|---|
| Native | `mpv_thumbnail.mm` | ① pipeline flush changed to render consumption; ② seek changed to `absolute`; ③ wait for `PLAYBACK_RESTART` then wait for `RENDER_UPDATE_FRAME` | P0 Required |
| Native | `mpv_thumbnail.mm` | flip_y + manual flipping: maintain current (verified correct orientation) | — |
| Service | `thumbnailService.ts` | Added `seekGeneration`, verify after seekAt returns | P1 Strongly Recommended |
| Frontend | `useProgressBar.ts` | Added `pathGeneration`, verify before writing to cache in callback | P1 Strongly Recommended |

---

## 9. Fix Effect Comparison

| Dimension | Before Fix | After Fix |
|---|---|---|
| Seek completion signal | `MPV_RENDER_UPDATE_FRAME` (could be keyframe) | `MPV_EVENT_PLAYBACK_RESTART` (authoritative) |
| Pre-flush | Non-blocking drain, old frames may remain | Render consumes old frames, pipeline fully cleared |
| Seek mode | `absolute+exact` (slow, many intermediate frames) | `absolute` (fast, keyframe precision sufficient) |
| Video switch protection | None | seekGeneration double layer (Service + Frontend) |
| Disk cache write timing | Write when native returns | Write only after generation check passes |
| Image orientation | flip_y=1 + manual flipping | Unchanged (verified correct, maintain current) |

---

## 10. Network Resource Boundary Cases

### 10.1 Current Behavior (Correct)

`ThumbnailService.initSeekThumbnail` has an `existsSync(videoPath)` check at the entry point:

```ts
// thumbnailService.ts:228
if (!existsSync(videoPath)) {
    return false   // URL → existsSync returns false → exit immediately
}
```

`http://`, `https://`, etc. URLs are intercepted at the Service layer; native code does not execute. **The current timeout design does not need to consider network scenarios.**

### 10.2 If Future Support for Network VOD

| Scenario | Local File | Network VOD (HTTP) | Live Stream (RTSP/HLS live) |
|---|---|---|---|
| seek latency | < 200ms | 1s ~ 30s (depends on bandwidth and server) | Cannot seek |
| `PLAYBACK_RESTART` 3s timeout | Sufficient | **Insufficient** | N/A |
| Is seek thumbnail meaningful | ✅ | ✅ (but slow response) | ❌ |

Required extensions:

```
1. isNetworkPath(path) check (http/https/rtsp/rtmp/ftp prefixes)

2. Service layer routing by type:
     Local file → existsSync check → use existing logic
     Network VOD → connectivity check (optional) → use seek logic, timeout x5 (≥15s)
     Live stream → skip entirely, don't generate seek thumbnail

3. Native layer parameterized timeout:
     mpv_thumb_seek_at(time, output_path, timeout_ms)
     Local default 3000ms, network pass 15000ms

4. Cache key strategy:
     Local file: MD5(file path)  —— stable
     Network URL: MD5(URL) + Response ETag/Last-Modified (optional)
                  If no ETag, MD5(URL) serves as fallback, accepting cache
                  not auto-invalidating on content change
```

**v1 does not need to handle this scenario.** The `existsSync` barrier remains unchanged; expansion can be done as needed when v2 NAS/Jellyfin is integrated.

---

## 11. Implementation Order

```
Phase 1 — Core Fix (native)
  mpv_thumbnail.mm: rewrite mpv_thumb_seek_at wait logic
  Recompile native binding (npm run build:native or node-gyp rebuild)
  Manual verification: drag progress bar back and forth on long videos, confirm thumbnail time is correct

Phase 2 — Defense Layer
  thumbnailService.ts: add seekGeneration
  useProgressBar.ts: add pathGeneration
  Verification: when switching videos quickly, progress bar should not show thumbnail from previous video

Phase 3 — Incidental Fixes
  mpv_thumbnail.mm: fix flip_y double flipping
  Verification: thumbnail orientation is correct (check with vertically asymmetric video frames)
```
