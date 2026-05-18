import { ref } from 'vue'
import { formatTime } from './useProgressBar'

export type ABLoopResult =
  | { state: 'set-a'; a: number }
  | { state: 'set-b'; a: number; b: number }
  | { state: 'cleared' }

export function useABLoop() {
  const abLoop = ref<{ a: number | null; b: number | null }>({ a: null, b: null })

  function parseLoopValue(val: unknown): number | null {
    if (typeof val === 'number' && isFinite(val) && val >= 0) return val
    if (typeof val === 'string' && val !== 'no' && val !== '') {
      const n = Number(val)
      if (isFinite(n) && n >= 0) return n
    }
    return null
  }

  async function fetchAbLoop() {
    const propApi = window.electronAPI?.playerProperty
    if (!propApi?.get) return
    try {
      const a = await propApi.get('ab-loop-a')
      const b = await propApi.get('ab-loop-b')
      abLoop.value = { a: parseLoopValue(a), b: parseLoopValue(b) }
    } catch {
      abLoop.value = { a: null, b: null }
    }
  }

  /**
   * Toggle AB loop: none → set point A → set point B → clear
   * Directly operate mpv properties to avoid depending on ab-loop input command
   */
  async function toggleAbLoop(): Promise<ABLoopResult> {
    const propApi = window.electronAPI?.playerProperty
    if (!propApi?.get || !propApi?.set) return { state: 'cleared' }

    const rawA = await propApi.get('ab-loop-a')
    const rawB = await propApi.get('ab-loop-b')
    const a = parseLoopValue(rawA)
    const b = parseLoopValue(rawB)

    if (a !== null && b !== null) {
      // Both points set → clear
      await propApi.set('ab-loop-a', 'no')
      await propApi.set('ab-loop-b', 'no')
      abLoop.value = { a: null, b: null }
      return { state: 'cleared' }
    }

    // Read current playback time
    const rawPos = await propApi.get('time-pos')
    const currentTime = parseLoopValue(rawPos) ?? 0

    if (a === null) {
      // No point A → set point A
      await propApi.set('ab-loop-a', currentTime)
      abLoop.value = { a: currentTime, b: null }
      return { state: 'set-a', a: currentTime }
    }

    // Point A set, no point B → set point B
    await propApi.set('ab-loop-b', currentTime)
    abLoop.value = { a, b: currentTime }
    return { state: 'set-b', a, b: currentTime }
  }

  function formatAbLoopHud(result: ABLoopResult): string {
    switch (result.state) {
      case 'set-a': return `A: ${formatTime(result.a)}`
      case 'set-b': return `${formatTime(result.a)} → ${formatTime(result.b)}`
      case 'cleared': return 'OFF'
    }
  }

  function resetAbLoop() {
    abLoop.value = { a: null, b: null }
  }

  return { abLoop, fetchAbLoop, toggleAbLoop, formatAbLoopHud, resetAbLoop }
}
