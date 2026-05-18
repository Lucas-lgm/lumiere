import { ref, type Ref } from 'vue'

export interface UseControlBarAutoHideOptions {
  /** Hide delay (milliseconds), default 3000ms */
  hideDelay?: number
  /** Whether to enable auto-hide, default true */
  enabled?: boolean
  /** Whether currently playing */
  isPlaying: Ref<boolean>
  /** Whether currently loading */
  isLoading: Ref<boolean>
  /** Whether currently dragging the progress bar */
  isScrubbing: Ref<boolean>
  /** Whether a panel is open (control bar is not hidden when panel is open) */
  isPanelOpen?: Ref<boolean>
  /** Whether hovering over the progress bar (control bar is not hidden when hovering) */
  isProgressHovering?: Ref<boolean>
}

export interface UseControlBarAutoHideReturn {
  /** Whether the control bar is visible */
  controlsVisible: Ref<boolean>
  /** Show control bar */
  showControls: () => void
  /** Schedule hide control bar */
  scheduleHide: () => void
  /** Mouse enters control bar area */
  onControlBarEnter: () => void
  /** Mouse leaves control bar area */
  onControlBarLeave: () => void
  /** Keep visible on user interaction */
  onUserInteraction: () => void
  /** Handle playback state change */
  handlePlayerStateChange: (wasPlaying: boolean) => void
  /** Clean up resources */
  cleanup: () => void
}

/**
 * Control bar auto-hide Composable
 *
 * @param options Configuration options
 * @returns Control bar auto-hide related state and methods
 */
export function useControlBarAutoHide(
  options: UseControlBarAutoHideOptions
): UseControlBarAutoHideReturn {
  const {
    hideDelay = 3000,
    enabled = true,
    isPlaying,
    isLoading,
    isScrubbing,
    isPanelOpen,
    isProgressHovering
  } = options

  // State
  const controlsVisible = ref(true)
  const autoHideEnabled = ref(enabled)
  const hideTimer = ref<NodeJS.Timeout | null>(null)
  const isHovering = ref(false)

  // Window-level mouse event handlers
  let windowMouseMoveHandler: (() => void) | null = null
  let windowMouseLeaveHandler: (() => void) | null = null
  let windowMouseMoveTimer: NodeJS.Timeout | null = null

  // Clear hide timer
  const clearHideTimer = () => {
    if (hideTimer.value) {
      clearTimeout(hideTimer.value)
      hideTimer.value = null
    }
  }

  // Show control bar
  const showControls = () => {
    controlsVisible.value = true
    clearHideTimer()
  }

  // Hide control bar
  const hideControls = () => {
    if (!autoHideEnabled.value) return
    if (isLoading.value) return
    if (!isPlaying.value) return
    if (isScrubbing.value) return
    if (isPanelOpen?.value) return
    if (isProgressHovering?.value) return

    controlsVisible.value = false
  }

  // Schedule hide control bar
  const scheduleHide = () => {
    if (!autoHideEnabled.value) return
    if (isLoading.value) return
    if (!isPlaying.value) return
    if (isScrubbing.value) return

    clearHideTimer()

    hideTimer.value = setTimeout(() => {
      // Clear timer reference so it can be reset next time
      hideTimer.value = null
      // When mouse hasn't moved inside window for 3 seconds, hide the control bar if playing and not loading/dragging
      if (isPlaying.value && !isScrubbing.value && !isLoading.value) {
        hideControls()
      }
    }, hideDelay)
  }

  // Mouse enters control bar area
  const onControlBarEnter = () => {
    isHovering.value = true
    showControls()
  }

  // Mouse leaves control bar area
  const onControlBarLeave = () => {
    isHovering.value = false
    // When playing and not loading/dragging, hide immediately when mouse leaves control bar
    if (isPlaying.value && !isLoading.value && !isScrubbing.value) {
      clearHideTimer()
      hideControls()
    }
  }

  // Window-level mouse move
  const onMouseMove = () => {
    // If control bar is hidden, show it on mouse move
    if (!controlsVisible.value) {
      showControls()
    }

    // Regardless of whether the mouse is on the control bar, as long as playing and not loading/dragging,
    // reset the hide timer on mouse move, implementing “auto-hide after 3 seconds of mouse inactivity on screen”
    if (
      isPlaying.value &&
      !isLoading.value &&
      !isScrubbing.value
    ) {
      scheduleHide()
    }
  }

  // Keep visible on user interaction
  const onUserInteraction = () => {
    showControls()
    scheduleHide()
  }

  // Handle playback state change
  const handlePlayerStateChange = (wasPlaying: boolean) => {
    // If changing from playing to paused, show control bar
    if (wasPlaying && !isPlaying.value) {
      showControls()
    }

    // If loading, paused, or dragging the progress bar, keep visible
    if (isLoading.value || !isPlaying.value || isScrubbing.value) {
      showControls()
      return // No need to set hide timer in these states
    }

    // When video is playing and mouse is not on the control bar, ensure a hide timer is running
    // This handles the following cases:
    // 1. Changing from paused to playing
    // 2. Changing from loading to playing
    // 3. Video starts in playing state
    if (isPlaying.value && !isHovering.value) {
      // If no timer is running, set a new timer
      // If a timer is already running, don't reset it (avoid frequent resets)
      if (!hideTimer.value) {
        scheduleHide()
      }
    }
  }

  // Set up window-level mouse event listeners
  const setupWindowMouseListeners = () => {
    windowMouseMoveHandler = () => {
      if (windowMouseMoveTimer) {
        clearTimeout(windowMouseMoveTimer)
      }
      windowMouseMoveTimer = setTimeout(() => {
        onMouseMove()
      }, 100)
    }

    windowMouseLeaveHandler = () => {
      if (windowMouseMoveTimer) {
        clearTimeout(windowMouseMoveTimer)
        windowMouseMoveTimer = null
      }
      // When mouse leaves window, if playing and not on control bar, schedule hide
      if (
        isPlaying.value &&
        !isLoading.value &&
        !isScrubbing.value &&
        !isHovering.value
      ) {
        scheduleHide()
      }
    }

    window.addEventListener('mousemove', windowMouseMoveHandler)
    window.addEventListener('mouseleave', windowMouseLeaveHandler)
  }

  // Clean up resources
  const cleanup = () => {
    clearHideTimer()

    // Clean up global mouse event listeners
    if (windowMouseMoveHandler) {
      window.removeEventListener('mousemove', windowMouseMoveHandler)
      windowMouseMoveHandler = null
    }
    if (windowMouseLeaveHandler) {
      window.removeEventListener('mouseleave', windowMouseLeaveHandler)
      windowMouseLeaveHandler = null
    }
    if (windowMouseMoveTimer) {
      clearTimeout(windowMouseMoveTimer)
      windowMouseMoveTimer = null
    }
  }

  // Set up window mouse event listeners on initialization
  setupWindowMouseListeners()

  return {
    controlsVisible,
    showControls,
    scheduleHide,
    onControlBarEnter,
    onControlBarLeave,
    onUserInteraction,
    handlePlayerStateChange,
    cleanup
  }
}
