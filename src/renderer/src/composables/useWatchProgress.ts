import { ref, onMounted } from 'vue'
import i18n from '../i18n'

export interface WatchProgress {
  mediaPath: string
  currentTime: number
  duration: number
  lastWatched: number
  status: 'unwatched' | 'watching' | 'completed'
}

const continueWatchingList = ref<WatchProgress[]>([])
const allProgress = ref<Map<string, WatchProgress>>(new Map())
const loading = ref(false)

export function useWatchProgress() {
  async function fetchContinueWatching() {
    if (!window.electronAPI?.watchProgress) return
    try {
      const items = await window.electronAPI.watchProgress.getContinueWatching()
      continueWatchingList.value = items || []
    } catch (e) {
      console.error('Failed to fetch continue watching:', e)
    }
  }

  async function fetchAll() {
    if (!window.electronAPI?.watchProgress) return
    try {
      loading.value = true
      const items = await window.electronAPI.watchProgress.getAll()
      const map = new Map<string, WatchProgress>()
      for (const item of items || []) {
        map.set(item.mediaPath, item)
      }
      allProgress.value = map
    } catch (e) {
      console.error('Failed to fetch all watch progress:', e)
    } finally {
      loading.value = false
    }
  }

  async function getProgress(mediaPath: string): Promise<WatchProgress | null> {
    // Check local cache first
    const cached = allProgress.value.get(mediaPath)
    if (cached) return cached

    if (!window.electronAPI?.watchProgress) return null
    try {
      return await window.electronAPI.watchProgress.get(mediaPath)
    } catch {
      return null
    }
  }

  async function clearProgress(mediaPath: string) {
    if (!window.electronAPI?.watchProgress) return
    try {
      await window.electronAPI.watchProgress.clear(mediaPath)
      allProgress.value.delete(mediaPath)
      continueWatchingList.value = continueWatchingList.value.filter(
        p => p.mediaPath !== mediaPath
      )
    } catch (e) {
      console.error('Failed to clear watch progress:', e)
    }
  }

  function formatResumeTime(progress: WatchProgress): string {
    const current = formatTime(progress.currentTime)
    const total = formatTime(progress.duration)
    return i18n.global.t('mainView.resumeAt', { current, total })
  }

  function getProgressPercent(progress: WatchProgress): number {
    if (!progress.duration) return 0
    return Math.min(100, Math.round((progress.currentTime / progress.duration) * 100))
  }

  onMounted(() => {
    fetchContinueWatching()
    fetchAll()
  })

  return {
    continueWatchingList,
    allProgress,
    loading,
    fetchContinueWatching,
    fetchAll,
    getProgress,
    clearProgress,
    formatResumeTime,
    getProgressPercent
  }
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}
