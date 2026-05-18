import { ref, onMounted } from 'vue'

// Global thumbnail cache shared across all consumers
const cache = ref<Map<string, string>>(new Map())

export function useThumbnail() {
  async function getThumbnail(filePath: string): Promise<string | null> {
    // Check cache first
    const cached = cache.value.get(filePath)
    if (cached) return cached

    if (!window.electronAPI?.thumbnail) return null

    try {
      const result = await window.electronAPI.thumbnail.get(filePath)
      if (result) {
        cache.value.set(filePath, result)
      }
      return result
    } catch {
      return null
    }
  }

  async function generateBatch(filePaths: string[]) {
    if (!window.electronAPI?.thumbnail) return
    // Filter out already cached paths
    const uncached = filePaths.filter(p => !cache.value.has(p))
    if (uncached.length === 0) return

    try {
      await window.electronAPI.thumbnail.generateBatch(uncached)
    } catch (e) {
      console.error('Failed to generate batch thumbnails:', e)
    }
  }

  function getCachedUrl(filePath: string): string | null {
    return cache.value.get(filePath) || null
  }

  return {
    getThumbnail,
    generateBatch,
    getCachedUrl,
    cache
  }
}
