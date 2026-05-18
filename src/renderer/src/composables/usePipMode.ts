import { ref, type Ref } from 'vue'

interface UsePipModeOptions {
  isPlaying: Ref<boolean>
  togglePlayPause: () => void
}

export function usePipMode(options: UsePipModeOptions) {
  const { isPlaying, togglePlayPause } = options

  const isPipMode = ref(false)
  const pipHover = ref(false)
  const pipDragging = ref(false)
  let pipHideTimer: ReturnType<typeof setTimeout> | null = null

  async function togglePipMode() {
    if (!window.electronAPI?.window?.togglePip) return
    try {
      const inPip = await window.electronAPI.window.togglePip()
      isPipMode.value = inPip
      if (!inPip) {
        pipHover.value = false
        if (pipHideTimer) { clearTimeout(pipHideTimer); pipHideTimer = null }
      }
    } catch (err) {
      console.error('[ControlView] PIP toggle failed:', err)
    }
  }

  function onRootMouseEnter() {
    if (isPipMode.value) {
      pipHover.value = true
      if (pipHideTimer) { clearTimeout(pipHideTimer); pipHideTimer = null }
    }
  }

  function onRootMouseLeave() {
    if (isPipMode.value) {
      if (pipHideTimer) clearTimeout(pipHideTimer)
      pipHideTimer = setTimeout(() => { pipHover.value = false }, 1500)
    }
  }

  function onRootMouseDown(e: MouseEvent) {
    if (!isPipMode.value) return
    const target = e.target as HTMLElement
    if (target.closest('.pip-btn, .cb, .pip-prog, .pip-idle-prog')) return
    pipDragging.value = true
    const onUp = () => {
      pipDragging.value = false
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mouseup', onUp)
  }

  function onRootDblClick(e: MouseEvent) {
    if (!isPipMode.value) return
    const target = e.target as HTMLElement
    if (target.closest('.pip-btn, .cb, .pip-prog, .pip-idle-prog')) return
    window.electronAPI?.window?.togglePipSize()
  }

  function closePip() {
    if (isPlaying.value) togglePlayPause()
    togglePipMode()
  }

  function returnFromPip() {
    togglePipMode()
  }

  return {
    isPipMode,
    pipHover,
    pipDragging,
    togglePipMode,
    onRootMouseEnter,
    onRootMouseLeave,
    onRootMouseDown,
    onRootDblClick,
    closePip,
    returnFromPip
  }
}
