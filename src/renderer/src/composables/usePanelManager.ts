import { ref, computed, readonly } from 'vue'

export type PanelName = 'subtitle' | 'picture' | 'crop' | 'mediaInfo' | 'playlist' | 'animExport'

// Functional panels — mutually exclusive within group, and with playlist
const FUNCTIONAL_PANELS: PanelName[] = ['subtitle', 'picture', 'crop', 'mediaInfo']

const activePanel = ref<PanelName | null>(null)
const isAnimating = ref(false)

export function usePanelManager() {
  const isPanelOpen = computed(() => activePanel.value !== null)

  const openPanel = (name: PanelName) => {
    if (activePanel.value === name) return
    // All panels are mutually exclusive — opening any panel closes the current one
    activePanel.value = name
  }

  const closePanel = () => {
    activePanel.value = null
  }

  const togglePanel = (name: PanelName) => {
    if (activePanel.value === name) {
      closePanel()
    } else {
      openPanel(name)
    }
  }

  const isPanelActive = (name: PanelName) => {
    return computed(() => activePanel.value === name)
  }

  const isFunctionalPanel = computed(() => {
    return activePanel.value !== null && FUNCTIONAL_PANELS.includes(activePanel.value)
  })

  return {
    activePanel: readonly(activePanel),
    isPanelOpen,
    isFunctionalPanel,
    isAnimating: readonly(isAnimating),
    openPanel,
    closePanel,
    togglePanel,
    isPanelActive
  }
}
