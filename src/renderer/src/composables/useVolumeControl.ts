import { ref, computed } from 'vue'
import { useAdjustableValue } from './useAdjustableValue'
import { calcPercent } from './useProgressBar'

export function useVolumeControl(onUserInteraction: () => void) {
  const volumeAdjustable = useAdjustableValue<number>({
    initial: 100,
    sendOnInput: true,
    sendCommand: (v: number) => {
      window.electronAPI?.player?.setVolume(Math.round(v))
    }
  })
  const volume = volumeAdjustable.value
  const isVolumeScrubbing = ref(false)

  const volumePercent = computed(() => {
    return Math.min(100, Math.max(0, (volume.value / 130) * 100))
  })

  const volumeIconName = computed(() => {
    if (volume.value <= 0) return 'volume-x'
    if (volume.value <= 33) return 'volume'
    if (volume.value <= 66) return 'volume-1'
    return 'volume-2'
  })

  let preMuteVolume = 100

  function onVolumeMouseDown(e: MouseEvent) {
    e.preventDefault()
    isVolumeScrubbing.value = true
    onUserInteraction()

    const wrap = e.currentTarget as HTMLElement
    const pct = calcPercent(e, wrap)
    volumeAdjustable.onUserInput(Math.round((pct / 100) * 130))

    const onMove = (ev: MouseEvent) => {
      const p = calcPercent(ev, wrap)
      volumeAdjustable.onUserInput(Math.round((p / 100) * 130))
      onUserInteraction()
    }

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const p = calcPercent(ev, wrap)
      volumeAdjustable.onUserCommit(Math.round((p / 100) * 130))
      isVolumeScrubbing.value = false
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function toggleMute() {
    if (volume.value > 0) {
      preMuteVolume = volume.value
      volumeAdjustable.onUserCommit(0)
    } else {
      volumeAdjustable.onUserCommit(preMuteVolume)
    }
  }

  function changeVolume(delta: number) {
    const newVol = Math.max(0, Math.min(130, volume.value + delta))
    volumeAdjustable.onUserCommit(newVol)
  }

  return {
    volumeAdjustable,
    volume,
    isVolumeScrubbing,
    volumePercent,
    volumeIconName,
    onVolumeMouseDown,
    toggleMute,
    changeVolume
  }
}
