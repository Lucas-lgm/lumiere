import { ref, computed, watch, type Ref } from 'vue'
import type { AdjustableValue } from './useAdjustableValue'

interface UseProgressBarOptions {
  duration: Ref<number>
  currentTime: Ref<number>
  currentTimeAdjustable: AdjustableValue<number>
  currentPath: Ref<string | null>
  /** Shared ref — created externally to break circular dependency with autoHide */
  isScrubbing: Ref<boolean>
  onUserInteraction: () => void
}

/**
 * Calculate percentage (0-100) from a mouse event relative to an element.
 * Shared by progress bar and volume slider.
 */
export function calcPercent(e: MouseEvent, el: HTMLElement): number {
  const rect = el.getBoundingClientRect()
  const x = e.clientX - rect.left
  return Math.max(0, Math.min(100, (x / rect.width) * 100))
}

export function formatTime(seconds: number): string {
  if (seconds == null || isNaN(seconds)) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Single thumbnail (dynamically generated on seek demand) */
export interface HoverThumbnail {
  /** thumb:// protocol URL */
  url: string
  /** Corresponding time (seconds, rounded) */
  time: number
}

export interface BufferRange {
  left: number   // Percentage 0-100
  width: number  // Percentage 0-100
}

export function useProgressBar(options: UseProgressBarOptions) {
  const { duration, currentTime, currentTimeAdjustable, currentPath, isScrubbing, onUserInteraction } = options

  const progHover = ref(false)
  const progHoverPercent = ref(0)
  const progHoverTime = ref(0)
  const bufferRanges = ref<Array<{ start: number; end: number }>>([])

  const bufferPercents = computed<BufferRange[]>(() => {
    if (duration.value <= 0) return []
    return bufferRanges.value.map(r => ({
      left: (r.start / duration.value) * 100,
      width: ((r.end - r.start) / duration.value) * 100,
    }))
  })

  const progWrapRef = ref<HTMLElement | null>(null)
  const hoverThumbnail = ref<HoverThumbnail | null>(null)
  const thumbLoading = ref(false)

  // ── Seek preview cache and flow control state ──
  /** time(seconds, rounded) → thumb:// URL */
  const thumbnailCache = new Map<number, string>()
  let seekInitialized = false
  let lastThumbTime = -1
  let thumbTimer: ReturnType<typeof setTimeout> | null = null
  /** Incremented when video path changes, used to discard outdated seek responses */
  let pathGeneration = 0
  /** Whether a seekAt request is currently executing */
  let seekInFlight = false
  /** Latest request waiting to execute (replace semantics: keep only the last one) */
  let pendingSeek: { path: string; time: number; gen: number } | null = null

  // Watch currentPath: reset seek state on video switch and initialize new instance
  watch(currentPath, (newPath) => {
    // Increment path generation (must be before other cleanup)
    pathGeneration++
    // Clean up previous video's state
    hoverThumbnail.value = null
    thumbLoading.value = false
    thumbnailCache.clear()
    seekInitialized = false
    seekInFlight = false
    pendingSeek = null
    lastThumbTime = -1
    if (thumbTimer) {
      clearTimeout(thumbTimer)
      thumbTimer = null
    }

    if (!newPath) return

    // fire-and-forget: notify backend to initialize seek instance
    if (window.electronAPI?.thumbnail?.seekInit) {
      window.electronAPI.thumbnail.seekInit(newPath)
        .then(ok => {
          seekInitialized = !!ok
        })
        .catch(() => {
          seekInitialized = false
        })
    }
  })

  const progressPercent = computed(() => {
    if (!duration.value || duration.value <= 0) return 0
    return Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100))
  })

  function onProgressMouseDown(e: MouseEvent) {
    if (!duration.value || duration.value <= 0) return
    e.preventDefault()
    isScrubbing.value = true
    onUserInteraction()

    const wrap = e.currentTarget as HTMLElement
    const pct = calcPercent(e, wrap)
    const time = (pct / 100) * duration.value
    currentTimeAdjustable.onUserInput(time)

    const onMove = (ev: MouseEvent) => {
      const p = calcPercent(ev, wrap)
      const t = (p / 100) * duration.value
      currentTimeAdjustable.onUserInput(t)
      onUserInteraction()
    }

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const p = calcPercent(ev, wrap)
      const t = Math.max(0, Math.min(duration.value, (p / 100) * duration.value))
      currentTimeAdjustable.onUserCommit(t)
      isScrubbing.value = false
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function onProgressHoverMove(e: MouseEvent) {
    if (isScrubbing.value) return
    if (!duration.value || duration.value <= 0) return
    const wrap = e.currentTarget as HTMLElement
    const pct = calcPercent(e, wrap)
    progHoverPercent.value = pct
    progHoverTime.value = (pct / 100) * duration.value

    // ── Dynamic seek thumbnail request (throttled 150ms) ──
    if (!currentPath.value) return
    if (!window.electronAPI?.thumbnail?.seekAt) return

    const roundedTime = Math.round(progHoverTime.value)
    if (roundedTime < 0) return
    if (roundedTime === lastThumbTime) return
    lastThumbTime = roundedTime

    // Check local cache first
    const cached = thumbnailCache.get(roundedTime)
    if (cached) {
      hoverThumbnail.value = { url: cached, time: roundedTime }
      return
    }

    // Cache miss → enter loading state
    hoverThumbnail.value = null
    thumbLoading.value = true

    const targetPath = currentPath.value
    const targetTime = roundedTime
    const gen = pathGeneration

    // Request already in flight → replace pending, don't queue
    if (seekInFlight) {
      pendingSeek = { path: targetPath, time: targetTime, gen }
      return
    }

    // Send request after 150ms throttle
    if (thumbTimer) clearTimeout(thumbTimer)
    thumbTimer = setTimeout(() => {
      thumbTimer = null
      executeSeek(targetPath, targetTime, gen)
    }, 150)
  }

  /** Execute seekAt and handle pending request after completion */
  async function executeSeek(path: string, time: number, gen: number): Promise<void> {
    seekInFlight = true
    try {
      const url = await window.electronAPI!.thumbnail.seekAt(path, time)
      if (gen !== pathGeneration) return
      if (url) {
        thumbnailCache.set(time, url)
        hoverThumbnail.value = { url, time }
        thumbLoading.value = false
      } else {
        if (lastThumbTime === time) lastThumbTime = -1
      }
    } catch {
      if (lastThumbTime === time) lastThumbTime = -1
    } finally {
      seekInFlight = false
      // Has pending → take the latest and execute immediately (replace semantics)
      const next = pendingSeek
      if (next) {
        pendingSeek = null
        if (next.gen === pathGeneration) {
          executeSeek(next.path, next.time, next.gen)
        } else {
          thumbLoading.value = false
        }
      } else {
        // No pending and no thumbnail successfully displayed → end loading
        if (!hoverThumbnail.value) thumbLoading.value = false
      }
    }
  }

  return {
    progHover,
    progHoverPercent,
    progHoverTime,
    bufferRanges,
    bufferPercents,
    isScrubbing,
    progressPercent,
    progWrapRef,
    hoverThumbnail,
    thumbLoading,
    onProgressMouseDown,
    onProgressHoverMove
  }
}
