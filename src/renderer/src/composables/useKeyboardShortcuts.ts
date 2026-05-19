import { onMounted, onUnmounted, type Ref } from 'vue'
import { usePanelManager, type PanelName } from './usePanelManager'

/**
 * §17 Keyboard shortcuts — Player context
 *
 * All shortcuts are listened for within ControlView (player WebContentsView),
 * isolated from the library MainView context.
 */

const SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]

export interface KeyboardShortcutCallbacks {
  onTogglePlayPause: () => void
  onSeekRelative: (delta: number) => void
  onVolumeChange: (delta: number) => void
  onToggleMute: () => void
  onToggleFullscreen: () => void
  onPlayPrev: () => void
  onPlayNext: () => void
  onSpeedChange: (speed: number) => void
  onTogglePanel: (panel: PanelName) => void
  onUserInteraction: () => void
  onBackToLibrary: () => void
  onOpenFile: () => void
  onPasteUrl: () => void
  onChapterPrev: () => void
  onChapterNext: () => void
  onToggleAbLoop: () => void
}

export function useKeyboardShortcuts(
  playbackSpeed: Ref<number>,
  callbacks: KeyboardShortcutCallbacks,
  options?: {
    isFullscreen?: Ref<boolean>
    chapterNav?: Ref<boolean>
    chapters?: Ref<{ time: number }[]>
    currentTime?: Ref<number>
  }
) {
  const isFullscreen = options?.isFullscreen
  const handleKeyDown = (e: KeyboardEvent) => {
    // Skip if user is typing in an input
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    const { metaKey, shiftKey, ctrlKey, altKey, key } = e

    // Notify auto-hide on every key
    callbacks.onUserInteraction()

    // ── Space: play / pause ──
    if (key === ' ' && !metaKey && !ctrlKey && !altKey) {
      e.preventDefault()
      callbacks.onTogglePlayPause()
      return
    }

    // ── Arrow Left / Right: seek ──
    if (key === 'ArrowLeft' && !ctrlKey && !altKey) {
      e.preventDefault()
      if (metaKey && shiftKey) {
        // ⇧⌘← : previous video
        callbacks.onPlayPrev()
      } else if (metaKey && !shiftKey) {
        // ⌘← : back to library
        callbacks.onBackToLibrary()
      } else if (shiftKey) {
        // ⇧← : seek -30s
        callbacks.onSeekRelative(-30)
      } else {
        // ← : seek -10s (or chapter prev if chapterNav enabled)
        if (options?.chapterNav?.value && (options?.chapters?.value?.length ?? 0) > 1) {
          callbacks.onChapterPrev()
        } else {
          callbacks.onSeekRelative(-10)
        }
      }
      return
    }

    if (key === 'ArrowRight' && !ctrlKey && !altKey) {
      e.preventDefault()
      if (metaKey && shiftKey) {
        // ⇧⌘→ : next video
        callbacks.onPlayNext()
      } else if (shiftKey) {
        // ⇧→ : seek +30s
        callbacks.onSeekRelative(30)
      } else if (!metaKey) {
        // → : seek +10s (or chapter next if chapterNav enabled)
        if (options?.chapterNav?.value && (options?.chapters?.value?.length ?? 0) > 1) {
          callbacks.onChapterNext()
        } else {
          callbacks.onSeekRelative(10)
        }
      }
      return
    }

    // ── Arrow Up / Down: volume ──
    if (key === 'ArrowUp' && !metaKey && !ctrlKey && !altKey) {
      e.preventDefault()
      callbacks.onVolumeChange(5)
      return
    }
    if (key === 'ArrowDown' && !metaKey && !ctrlKey && !altKey) {
      e.preventDefault()
      callbacks.onVolumeChange(-5)
      return
    }

    // ── M: mute ──
    if (key.toLowerCase() === 'm' && !metaKey && !ctrlKey && !altKey) {
      e.preventDefault()
      callbacks.onToggleMute()
      return
    }

    // ── F: fullscreen ──
    if (key.toLowerCase() === 'f' && !metaKey && !ctrlKey && !shiftKey && !altKey) {
      e.preventDefault()
      callbacks.onToggleFullscreen()
      return
    }

    // ── ⌘Enter: fullscreen ──
    if (key === 'Enter' && metaKey && !shiftKey) {
      e.preventDefault()
      callbacks.onToggleFullscreen()
      return
    }

    // ── ] / [: speed up / down ──
    if (key === ']' && !metaKey && !ctrlKey) {
      e.preventDefault()
      const idx = SPEED_STEPS.indexOf(playbackSpeed.value)
      if (idx >= 0 && idx < SPEED_STEPS.length - 1) {
        callbacks.onSpeedChange(SPEED_STEPS[idx + 1])
      } else if (idx < 0) {
        // current speed not in list, find next higher
        const next = SPEED_STEPS.find(s => s > playbackSpeed.value)
        if (next) callbacks.onSpeedChange(next)
      }
      return
    }
    if (key === '[' && !metaKey && !ctrlKey) {
      e.preventDefault()
      const idx = SPEED_STEPS.indexOf(playbackSpeed.value)
      if (idx > 0) {
        callbacks.onSpeedChange(SPEED_STEPS[idx - 1])
      } else if (idx < 0) {
        // current speed not in list, find next lower
        const prev = [...SPEED_STEPS].reverse().find(s => s < playbackSpeed.value)
        if (prev) callbacks.onSpeedChange(prev)
      }
      return
    }

    // ── , / .: frame step backward / forward ──
    if (key === ',' && !metaKey && !ctrlKey) {
      e.preventDefault()
      window.electronAPI?.playerProperty?.command('frame-back-step')
      return
    }
    if (key === '.' && !metaKey && !ctrlKey) {
      e.preventDefault()
      window.electronAPI?.playerProperty?.command('frame-step')
      return
    }

    // ── ⌘S: screenshot ──
    if (key.toLowerCase() === 's' && metaKey && !shiftKey && !ctrlKey) {
      e.preventDefault()
      window.electronAPI?.playerProperty?.command('screenshot')
      return
    }

    // ── ⌘L: AB loop toggle ──
    if (key.toLowerCase() === 'l' && metaKey && !shiftKey && !ctrlKey) {
      e.preventDefault()
      callbacks.onToggleAbLoop()
      return
    }

    // ── ⌘E: equalizer panel ──
    if (key.toLowerCase() === 'e' && metaKey && !shiftKey && !ctrlKey) {
      e.preventDefault()
      callbacks.onTogglePanel('equalizer')
      return
    }

    // ── ⌘P: playlist panel ──
    if (key.toLowerCase() === 'p' && metaKey && !shiftKey && !ctrlKey) {
      e.preventDefault()
      callbacks.onTogglePanel('playlist')
      return
    }

    // ── ⌘O: open file ──
    if (key.toLowerCase() === 'o' && metaKey && !shiftKey && !ctrlKey) {
      e.preventDefault()
      callbacks.onOpenFile()
      return
    }

    // ── ⌘N: paste URL ──
    if (key.toLowerCase() === 'n' && metaKey && !shiftKey && !ctrlKey) {
      e.preventDefault()
      callbacks.onPasteUrl()
      return
    }

    // ── Escape: close panel → exit fullscreen → back to library ──
    if (key === 'Escape' && !metaKey && !ctrlKey) {
      e.preventDefault()
      const { isPanelOpen, closePanel } = usePanelManager()
      if (isPanelOpen.value) {
        closePanel()
      } else if (isFullscreen?.value) {
        callbacks.onToggleFullscreen()
      } else {
        callbacks.onBackToLibrary()
      }
      return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
  })
}
