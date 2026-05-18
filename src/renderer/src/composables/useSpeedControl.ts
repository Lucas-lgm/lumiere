import { ref } from 'vue'
import { useAdjustableValue } from './useAdjustableValue'

export function useSpeedControl(onUserInteraction: () => void) {
  const speedAdjustable = useAdjustableValue<number>({
    initial: 1,
    justChangedWindowMs: 300,
    sendOnInput: true,
    sendCommand: (speed: number) => {
      window.electronAPI?.playerProperty?.set('speed', speed)
    }
  })
  const playbackSpeed = speedAdjustable.value
  const speedPresets = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]
  const speedPickerOpen = ref(false)

  function setSpeed(speed: number) {
    speedAdjustable.onUserCommit(speed)
  }

  function toggleSpeedPicker() {
    speedPickerOpen.value = !speedPickerOpen.value
    onUserInteraction()
  }

  function selectSpeed(speed: number) {
    setSpeed(speed)
    speedPickerOpen.value = false
  }

  function onSpeedSliderInput(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value)
    const rounded = Math.round(val * 100) / 100
    speedAdjustable.onUserInput(rounded)
  }

  async function fetchSpeed() {
    if (!window.electronAPI?.playerProperty?.get) return
    try {
      const raw = await window.electronAPI.playerProperty.get('speed')
      const speed = Number(raw)
      if (isFinite(speed) && speed > 0) {
        speedAdjustable.reset(speed)
      }
    } catch { /* ignore */ }
  }

  return {
    speedAdjustable,
    playbackSpeed,
    speedPresets,
    speedPickerOpen,
    setSpeed,
    toggleSpeedPicker,
    selectSpeed,
    onSpeedSliderInput,
    fetchSpeed
  }
}
