/**
 * Resource filter Composable
 */
import { computed, type Ref } from 'vue'
import type { MediaResource, ResourceFilter } from '../types/media'

export function useResourceFilter(
  resources: Ref<MediaResource[]>,
  activeFilter: Ref<ResourceFilter>,
  selectedMountPath: Ref<string | null>,
  searchQuery: Ref<string>
) {
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
      // Mount path filter
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

  return {
    filteredResources,
    stats
  }
}
