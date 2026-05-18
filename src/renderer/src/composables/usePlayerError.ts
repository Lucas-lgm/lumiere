import { ref, computed, type Ref } from 'vue'

interface UsePlayerErrorOptions {
  currentPath: Ref<string | null>
  currentVideoName: Ref<string>
  sdk: {
    play: (item: { name: string; path: string }) => void
    removeFromPlaylist: (index: number) => void
  }
  playlist: Ref<{ path: string }[]>
  refreshPlaylist: () => void
  playNext: () => void
}

export function usePlayerError(options: UsePlayerErrorOptions) {
  const { currentPath, currentVideoName, sdk, playlist, refreshPlaylist, playNext } = options

  const playerError = ref<string | null>(null)

  const playerErrorType = computed<'codec' | 'not-found' | 'network' | 'generic'>(() => {
    if (!playerError.value) return 'generic'
    const msg = playerError.value.toLowerCase()
    if (msg.includes('codec') || msg.includes('decode') || msg.includes('不支持')) return 'codec'
    if (msg.includes('not found') || msg.includes('不存在') || msg.includes('no such file')) return 'not-found'
    if (msg.includes('network') || msg.includes('网络') || msg.includes('connection') || msg.includes('timeout')) return 'network'
    return 'generic'
  })

  function retryPlay() {
    playerError.value = null
    if (currentPath.value && window.electronAPI) {
      const name = currentVideoName.value || currentPath.value.split(/[/\\]/).pop() || ''
      sdk.play({ name, path: currentPath.value })
    }
  }

  async function retrySoftDecode() {
    playerError.value = null
    await window.electronAPI?.playerProperty?.set('hwdec', 'no')
    retryPlay()
  }

  function relocateFile() {
    window.electronAPI?.fileSystem?.selectVideoFile()
  }

  function removeCurrentFromPlaylist() {
    playerError.value = null
    const idx = playlist.value.findIndex(item => item.path === currentPath.value)
    if (idx >= 0) {
      sdk.removeFromPlaylist(idx)
      refreshPlaylist()
      playNext()
    }
  }

  return {
    playerError,
    playerErrorType,
    retryPlay,
    retrySoftDecode,
    relocateFile,
    removeCurrentFromPlaylist
  }
}
