import { ref, type Ref } from 'vue'

export interface AdjustableValueOptions<T> {
  /** Initial value (usually overridden by backend state or configuration) */
  initial: T
  /** Protection window (milliseconds), default 200ms */
  justChangedWindowMs?: number
  /** Function to send command to backend */
  sendCommand: (value: T) => void
  /** Whether to send command in real-time during onUserInput phase (e.g., volume) */
  sendOnInput?: boolean
}

export interface AdjustableValue<T> {
  /** Value used by current UI (bound to controls) */
  value: Ref<T>
  /** Called when user is adjusting (dragging/inputting), only updates local UI */
  onUserInput: (v: T) => void
  /** Called when user confirms the adjustment (release/enter): records time and sends command */
  onUserCommit: (v: T) => void
  /** Apply backend-broadcast state value with short protection period filtering */
  applyServerState: (serverValue: T) => void
  /** Used to align with backend value during initialization or reset (does not trigger protection period) */
  reset: (serverValue: T) => void
  /** Whether in adjusting state */
  isAdjusting: boolean
  /** Force end adjusting state (for external state correction) */
  forceEndAdjusting: () => void
}

/**
 * General adjustable value pattern: handle race conditions between "command channel + state broadcast channel"
 * Applicable to scalar adjustable controls such as volume, progress, playback speed.
 */
export function useAdjustableValue<T>(options: AdjustableValueOptions<T>): AdjustableValue<T> {
  const { initial, justChangedWindowMs, sendCommand, sendOnInput } = options
  const value = ref(initial) as Ref<T>

  const JUST_CHANGED_WINDOW = justChangedWindowMs ?? 200

  let lastLocalValue: T = initial
  let lastChangeAt = 0
  let isAdjusting = false

  const onUserInput = (v: T) => {
    isAdjusting = true
    value.value = v
    if (sendOnInput) {
      sendCommand(v)
    }
  }

  const onUserCommit = (v: T) => {
    const now = Date.now()
    lastLocalValue = v
    lastChangeAt = now
    value.value = v
    sendCommand(v)
    // Immediately end “adjusting” state after commit, allowing subsequent backend state to take effect
    isAdjusting = false
  }

  const applyServerState = (serverValue: T) => {
    // When user is manually adjusting, do not accept any backend write-backs to avoid being overridden during dragging
    if (isAdjusting) return

    const now = Date.now()
    const inProtectWindow = now - lastChangeAt < JUST_CHANGED_WINDOW
    const looksLikeOldValue = serverValue !== lastLocalValue

    // Within protection period and looks like old value → ignore, avoid overwriting the newly committed value
    if (inProtectWindow && looksLikeOldValue) return

    value.value = serverValue
  }

  const reset = (serverValue: T) => {
    lastLocalValue = serverValue
    lastChangeAt = 0
    value.value = serverValue
    isAdjusting = false
  }

  const forceEndAdjusting = () => {
    isAdjusting = false
  }

  return {
    value,
    onUserInput,
    onUserCommit,
    applyServerState,
    reset,
    get isAdjusting() { return isAdjusting },
    forceEndAdjusting
  }
}

