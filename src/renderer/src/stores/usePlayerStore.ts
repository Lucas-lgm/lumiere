import { reactive, readonly } from 'vue'
import { getPlayerSDK } from '../core/sdk'

export type LoopMode = 'list' | 'single' | 'none' | 'shuffle'

interface PlaylistState {
  loopMode: LoopMode
}

interface PlayerStoreState {
  playlist: PlaylistState
}

// Module-level singleton — survives panel open/close cycles
const state = reactive<PlayerStoreState>({
  playlist: {
    loopMode: 'list'
  }
})

const LOOP_CYCLE: LoopMode[] = ['list', 'single', 'none', 'shuffle']

function setLoopMode(mode: LoopMode): void {
  const sdk = getPlayerSDK()

  state.playlist.loopMode = mode

  // Sync SDK loop flag: only 'list' enables list loop
  const nextIsLoop = mode === 'list'
  if (sdk.getLoop() !== nextIsLoop) {
    sdk.toggleLoop()
  }

  // Sync SDK single loop flag
  sdk.setSingleLoop(mode === 'single')

  // Sync SDK shuffle flag
  const nextIsShuffle = mode === 'shuffle'
  if (sdk.getShuffle() !== nextIsShuffle) {
    sdk.toggleShuffle()
  }
}

function cycleLoopMode(onShuffleToggled?: () => void): void {
  const idx = LOOP_CYCLE.indexOf(state.playlist.loopMode)
  const next = LOOP_CYCLE[(idx + 1) % LOOP_CYCLE.length]

  const wasShuffling = state.playlist.loopMode === 'shuffle'
  const willShuffle = next === 'shuffle'
  const shuffleChanged = wasShuffling !== willShuffle

  setLoopMode(next)

  if (shuffleChanged && onShuffleToggled) {
    onShuffleToggled()
  }
}

export function usePlayerStore() {
  return {
    playlist: readonly(state.playlist) as Readonly<PlaylistState>,
    setLoopMode,
    cycleLoopMode
  }
}
