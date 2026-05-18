import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/**
 * §21 Trackpad gestures — macOS two-finger/pinch gestures
 *
 * - Two-finger left/right swipe → seek forward/backward (HUD preview while swiping, seek on release)
 * - Two-finger up/down swipe → volume ± (real-time response)
 * - Two-finger pinch → enter/exit fullscreen
 *
 * Volume uses rAF for real-time response; progress uses rAF to update HUD, seeks once on release.
 */

export type HudType = 'seek' | 'volume' | 'zoom' | 'loop' | null

export interface TrackpadGestureCallbacks {
  onSeekRelative: (delta: number) => void
  onVolumeChange: (delta: number) => void
  onToggleFullscreen: () => void
  onUserInteraction: () => void
}

export interface HudState {
  type: HudType
  value: string
}

export function useTrackpadGestures(
  _isPlaying: Ref<boolean>,
  volume: Ref<number>,
  callbacks: TrackpadGestureCallbacks
) {
  const hud = ref<HudState>({ type: null, value: '' })
  let hudTimer: ReturnType<typeof setTimeout> | null = null

  // Per-frame accumulators (batched within one rAF)
  let frameAccumX = 0
  let frameAccumY = 0
  let rafId: number | null = null

  // Gesture axis locking — once a gesture starts, lock to X or Y
  let gestureAxis: 'x' | 'y' | null = null
  let gestureResetTimer: ReturnType<typeof setTimeout> | null = null

  // Sub-integer residuals for smooth accumulation
  let seekResidue = 0
  let volResidue = 0

  // Cumulative seek for HUD display within one gesture
  let cumulativeSeek = 0

  // Pinch gesture state
  let pinchScale = 1
  let pinchTriggered = false

  function showHud(type: HudType, value: string) {
    hud.value = { type, value }
    if (hudTimer) clearTimeout(hudTimer)
    hudTimer = setTimeout(() => {
      hud.value = { type: null, value: '' }
    }, 1000)
  }

  function processFrame() {
    rafId = null

    const absX = Math.abs(frameAccumX)
    const absY = Math.abs(frameAccumY)

    // Lock axis on first significant movement
    if (!gestureAxis) {
      if (absX > absY && absX > 1) gestureAxis = 'x'
      else if (absY >= absX && absY > 1) gestureAxis = 'y'
      else {
        frameAccumX = 0
        frameAccumY = 0
        return
      }
    }

    if (gestureAxis === 'x') {
      // Horizontal → seek preview (natural scrolling: positive deltaX = swipe left = rewind)
      // ~10px deltaX → 1s seek. Only update HUD; actual seek fires on gesture end.
      seekResidue += -(frameAccumX * 0.1)
      const intSeek = Math.trunc(seekResidue)
      if (intSeek !== 0) {
        seekResidue -= intSeek
        cumulativeSeek += intSeek
        const sign = cumulativeSeek >= 0 ? '+' : ''
        showHud('seek', `${sign}${cumulativeSeek}s`)
        callbacks.onUserInteraction()
      }
    } else if (gestureAxis === 'y') {
      // Vertical → volume (natural scrolling: positive deltaY = swipe down = quieter)
      // ~5px deltaY → 1 volume unit
      volResidue += -(frameAccumY * 0.2)
      const intVol = Math.trunc(volResidue)
      if (intVol !== 0) {
        callbacks.onVolumeChange(intVol)
        volResidue -= intVol
        const newVol = Math.max(0, Math.min(130, volume.value + intVol))
        showHud('volume', `${newVol}%`)
        callbacks.onUserInteraction()
      }
    }

    frameAccumX = 0
    frameAccumY = 0
  }

  function handleWheel(e: WheelEvent) {
    // Scroll within panels/popup menus should not trigger gestures
    const target = e.target as HTMLElement
    if (target?.closest?.('.slide-panel, .more-menu, .spd-picker')) return

    // Pinch-to-zoom: on macOS, Ctrl+wheel = pinch gesture
    if (e.ctrlKey) {
      e.preventDefault()
      if (e.deltaY < -10 && !pinchTriggered) {
        pinchTriggered = true
        callbacks.onToggleFullscreen()
        showHud('zoom', 'Fullscreen')
        setTimeout(() => { pinchTriggered = false }, 500)
      } else if (e.deltaY > 10 && !pinchTriggered) {
        pinchTriggered = true
        callbacks.onToggleFullscreen()
        showHud('zoom', 'Exit fullscreen')
        setTimeout(() => { pinchTriggered = false }, 500)
      }
      callbacks.onUserInteraction()
      return
    }

    e.preventDefault()

    // Accumulate within the current animation frame
    frameAccumX += e.deltaX
    frameAccumY += e.deltaY

    // Schedule rAF if not already pending
    if (rafId === null) {
      rafId = requestAnimationFrame(processFrame)
    }

    // Gesture end detection: 200ms idle = finger lifted
    if (gestureResetTimer) clearTimeout(gestureResetTimer)
    gestureResetTimer = setTimeout(() => {
      // Commit pending seek on gesture end
      if (gestureAxis === 'x' && cumulativeSeek !== 0) {
        callbacks.onSeekRelative(cumulativeSeek)
      }
      gestureAxis = null
      seekResidue = 0
      volResidue = 0
      cumulativeSeek = 0
    }, 200)
  }

  // macOS native gesture events (pinch)
  function handleGestureStart() {
    pinchScale = 1
  }

  function handleGestureChange(e: Event) {
    const ge = e as unknown as { scale: number }
    if (typeof ge.scale !== 'number') return
    pinchScale = ge.scale
  }

  function handleGestureEnd() {
    if (pinchScale > 1.3) {
      callbacks.onToggleFullscreen()
      showHud('zoom', 'Fullscreen')
    } else if (pinchScale < 0.7) {
      callbacks.onToggleFullscreen()
      showHud('zoom', 'Exit fullscreen')
    }
    pinchScale = 1
    callbacks.onUserInteraction()
  }

  onMounted(() => {
    window.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('gesturestart', handleGestureStart)
    window.addEventListener('gesturechange', handleGestureChange)
    window.addEventListener('gestureend', handleGestureEnd)
  })

  onUnmounted(() => {
    window.removeEventListener('wheel', handleWheel)
    window.removeEventListener('gesturestart', handleGestureStart)
    window.removeEventListener('gesturechange', handleGestureChange)
    window.removeEventListener('gestureend', handleGestureEnd)
    if (hudTimer) clearTimeout(hudTimer)
    if (rafId) cancelAnimationFrame(rafId)
    if (gestureResetTimer) clearTimeout(gestureResetTimer)
  })

  return { hud }
}
