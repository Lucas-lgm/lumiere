import { computed, type Ref } from 'vue'
import type { MediaResource } from '../types/media'
import { useWatchProgress, type WatchProgress } from './useWatchProgress'

export interface FolderGroup {
  name: string
  path: string
  items: MediaResource[]
  totalCount: number
  watchedCount: number
  watchingCount: number
  currentEpisode?: MediaResource
  currentProgress?: WatchProgress
}

/**
 * Extract the parent directory name from a file path
 */
function getParentDir(filePath: string): { name: string; path: string } | null {
  // Skip URLs
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return null

  const parts = filePath.split(/[/\\]/)
  if (parts.length < 2) return null

  const parentPath = parts.slice(0, -1).join('/')
  const parentName = parts[parts.length - 2] || ''
  if (!parentName) return null

  return { name: parentName, path: parentPath }
}

export function useFolderGrouping(resources: Ref<MediaResource[]>) {
  const { allProgress } = useWatchProgress()

  const folderGroups = computed(() => {
    const groupMap = new Map<string, MediaResource[]>()
    const ungrouped: MediaResource[] = []

    for (const resource of resources.value) {
      const parent = getParentDir(resource.path)
      if (!parent) {
        ungrouped.push(resource)
        continue
      }

      const existing = groupMap.get(parent.path)
      if (existing) {
        existing.push(resource)
      } else {
        groupMap.set(parent.path, [resource])
      }
    }

    const groups: FolderGroup[] = []

    for (const [path, items] of groupMap) {
      // Only group if there are 2+ items; singles go to ungrouped
      if (items.length < 2) {
        ungrouped.push(...items)
        continue
      }

      // Sort items by name for episode ordering
      items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))

      const name = path.split(/[/\\]/).pop() || path
      let watchedCount = 0
      let watchingCount = 0
      let currentEpisode: MediaResource | undefined
      let currentProgress: WatchProgress | undefined

      for (const item of items) {
        const progress = allProgress.value.get(item.path)
        if (progress) {
          if (progress.status === 'completed') {
            watchedCount++
          } else if (progress.status === 'watching') {
            watchingCount++
            // Pick the most recently watched as current
            if (!currentProgress || progress.lastWatched > currentProgress.lastWatched) {
              currentEpisode = item
              currentProgress = progress
            }
          }
        }
      }

      groups.push({
        name,
        path,
        items,
        totalCount: items.length,
        watchedCount,
        watchingCount,
        currentEpisode,
        currentProgress
      })
    }

    // Sort groups: folders with active watching first, then by name
    groups.sort((a, b) => {
      if (a.currentProgress && !b.currentProgress) return -1
      if (!a.currentProgress && b.currentProgress) return 1
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    })

    return { groups, ungrouped }
  })

  return { folderGroups }
}
