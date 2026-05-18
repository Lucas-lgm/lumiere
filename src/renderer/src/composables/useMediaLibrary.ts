/**
 * Media library management Composable
 */
import { ref, computed } from 'vue'
import type { MediaResource, ResourceFilter, ViewMode } from '../types/media'

const ADDED_AT_KEY = 'lumiere-added-at'

function loadAddedAtMap(): Map<string, number> {
  try {
    const data = localStorage.getItem(ADDED_AT_KEY)
    return data ? new Map(JSON.parse(data)) : new Map()
  } catch {
    return new Map()
  }
}

function saveAddedAtMap(map: Map<string, number>) {
  try {
    localStorage.setItem(ADDED_AT_KEY, JSON.stringify([...map]))
  } catch { /* ignore */ }
}

const addedAtMap = loadAddedAtMap()

function resolveAddedAt(resource: MediaResource): Date {
  const stored = addedAtMap.get(resource.path)
  if (stored) return new Date(stored)
  const now = resource.addedAt || new Date()
  addedAtMap.set(resource.path, now instanceof Date ? now.getTime() : new Date(now).getTime())
  saveAddedAtMap(addedAtMap)
  return now instanceof Date ? now : new Date(now)
}

export function useMediaLibrary() {
  const resources = ref<MediaResource[]>([])
  const activeFilter = ref<ResourceFilter>('all')
  const selectedMountPath = ref<string | null>(null)
  const viewMode = ref<ViewMode>('grid')
  const searchQuery = ref('')

  /**
   * Filtered resources
   */
  const filteredResources = computed(() => {
    let filtered = resources.value

    // Filter by activeFilter
    if (activeFilter.value === 'local') {
      filtered = filtered.filter(r => r.source === 'local')
    } else if (activeFilter.value === 'network') {
      filtered = filtered.filter(r => r.source === 'network')
    } else if (activeFilter.value && activeFilter.value !== 'all') {
      // Mount path filter (activeFilter.value is mount path ID)
      // Need to find the corresponding mount path, then filter resources matching mountPath
      // Note: The mountPaths list needs to be passed in from outside, or obtained through other means
      // Temporarily filter through selectedMountPath (selectedMountPath stores the path of the mount path)
      if (selectedMountPath.value) {
        filtered = filtered.filter(r => r.mountPath === selectedMountPath.value)
      }
    }

    // Filter by search keyword
    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase()
      filtered = filtered.filter(r =>
        r.name.toLowerCase().includes(query) ||
        r.path.toLowerCase().includes(query)
      )
    }

    return filtered
  })

  /**
   * Statistics
   */
  const stats = computed(() => {
    const all = resources.value.length
    const local = resources.value.filter(r => r.source === 'local').length
    const network = resources.value.filter(r => r.source === 'network').length
    const mounted = resources.value.filter(r => r.source === 'mounted').length

    return { all, local, network, mounted }
  })

  /**
   * Add resource
   */
  const addResource = (resource: MediaResource) => {
    // Deduplicate by path to avoid adding the same file repeatedly
    if (!resources.value.find(r => r.path === resource.path)) {
      resource.addedAt = resolveAddedAt(resource)
      resources.value.push(resource)
    }
  }

  /**
   * Batch add resources
   */
  const addResources = (newResources: MediaResource[]) => {
    newResources.forEach(resource => {
      if (!resources.value.find(r => r.path === resource.path)) {
        resource.addedAt = resolveAddedAt(resource)
        resources.value.push(resource)
      }
    })
  }

  /**
   * Remove resource
   */
  const removeResource = (id: string) => {
    const index = resources.value.findIndex(r => r.id === id)
    if (index !== -1) {
      const removed = resources.value[index]
      addedAtMap.delete(removed.path)
      saveAddedAtMap(addedAtMap)
      resources.value.splice(index, 1)
    }
  }

  /**
   * Remove all resources of mount path
   */
  const removeResourcesByMountPath = (mountPath: string) => {
    resources.value.filter(r => r.mountPath === mountPath).forEach(r => addedAtMap.delete(r.path))
    saveAddedAtMap(addedAtMap)
    resources.value = resources.value.filter(r => r.mountPath !== mountPath)
  }

  /**
   * Set filter
   */
  const setFilter = (filter: ResourceFilter) => {
    activeFilter.value = filter
    if (filter !== 'all' && !['local', 'network', 'nas'].includes(filter)) {
      // If it's a mount path ID, selectedMountPath should be set externally (find the corresponding path through the mount path list)
      // Not set here, the caller is responsible for setting the correct path
    } else {
      selectedMountPath.value = null
    }
  }

  /**
   * Set mount path filter (needs the path of the mount path)
   */
  const setMountPathFilter = (mountPathId: string, mountPath: string) => {
    activeFilter.value = mountPathId
    selectedMountPath.value = mountPath
  }

  /**
   * Set search keyword
   */
  const setSearchQuery = (query: string) => {
    searchQuery.value = query
  }

  /**
   * Set view mode
   */
  const setViewMode = (mode: ViewMode) => {
    viewMode.value = mode
  }

  /**
   * Clear all resources
   */
  const clearResources = () => {
    resources.value = []
  }

  return {
    // State
    resources,
    activeFilter,
    selectedMountPath,
    viewMode,
    searchQuery,
    // Computed properties
    filteredResources,
    stats,
    // Methods
    addResource,
    addResources,
    removeResource,
    removeResourcesByMountPath,
    setFilter,
    setMountPathFilter,
    setSearchQuery,
    setViewMode,
    clearResources
  }
}
