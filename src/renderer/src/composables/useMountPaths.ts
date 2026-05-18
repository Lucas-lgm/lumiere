/**
 * Mount path management Composable
 */
import { ref } from 'vue'
import type { MountPath } from '../types/mount'

export function useMountPaths() {
  const mountPaths = ref<MountPath[]>([])
  const loading = ref(false)
  const initialScanning = ref(false)
  const initialScanTotal = ref(0)
  let pendingScanCount = 0

  /**
   * Add mount path
   */
  const addMountPath = async (path: string): Promise<MountPath | null> => {
    if (!window.electronAPI) return null

    loading.value = true
    try {
      // Send IPC message to add mount path
      return new Promise((resolve) => {
        const cleanup = window.electronAPI.fileSystem.onMountPathAdded((data) => {
          // Check if already exists
          if (!mountPaths.value.find(mp => mp.id === data.mountPath.id)) {
            mountPaths.value.push(data.mountPath)
          }
          cleanup()
          loading.value = false
          resolve(data.mountPath)
        })
        window.electronAPI.fileSystem.addMountPath(path)
        
        // Timeout handling
        setTimeout(() => {
          cleanup()
          loading.value = false
          resolve(null)
        }, 30000) // 30 second timeout
      })
    } catch (error) {
      console.error('Failed to add mount path:', error)
      loading.value = false
      return null
    }
  }

  /**
   * Remove mount path
   */
  const removeMountPath = (id: string) => {
    if (!window.electronAPI?.fileSystem) return

    const index = mountPaths.value.findIndex(mp => mp.id === id)
    if (index !== -1) {
      mountPaths.value.splice(index, 1)
      window.electronAPI.fileSystem.removeMountPath(id)
    }
  }

  /**
   * Refresh scan mount path
   */
  const refreshMountPath = async (id: string): Promise<void> => {
    if (!window.electronAPI) return

    const mountPath = mountPaths.value.find(mp => mp.id === id)
    if (!mountPath) return

    loading.value = true
    try {
      return new Promise((resolve) => {
        const cleanup = window.electronAPI.fileSystem.onMountPathScanned((data) => {
          if (data.id === id) {
            const index = mountPaths.value.findIndex(mp => mp.id === id)
            if (index !== -1) {
              mountPaths.value[index].resourceCount = data.resourceCount || 0
              mountPaths.value[index].lastScanned = new Date()
            }
            cleanup()
            loading.value = false
            resolve()
          }
        })
        window.electronAPI.fileSystem.refreshMountPath(id)
      })
    } catch (error) {
      console.error('Refresh scan failed:', error)
      loading.value = false
    }
  }

  /**
   * Get mount path
   */
  const getMountPath = (id: string): MountPath | undefined => {
    return mountPaths.value.find(mp => mp.id === id)
  }

  /**
   * Initialize mount path list (fetched from main process)
   */
  const initMountPaths = () => {
    if (!window.electronAPI?.fileSystem) return () => {}

    // Show skeleton screen immediately, don't wait for IPC round trip
    initialScanning.value = true

    // Request mount path list
    window.electronAPI.fileSystem.getMountPaths()

    // Listen for mount path list updates
    let initialScanDone = false
    const cleanup = window.electronAPI.fileSystem.onMountPathsUpdated((data) => {
      mountPaths.value = data.mountPaths
      // Automatically trigger scan on first list receipt, subsequent updates don't re-scan
      if (!initialScanDone) {
        initialScanDone = true
        if (data.mountPaths.length > 0) {
          initialScanTotal.value = data.mountPaths.length
          pendingScanCount = data.mountPaths.length
          for (const mp of data.mountPaths) {
            window.electronAPI.fileSystem.refreshMountPath(mp.id)
          }
        } else {
          // No mount folders, close skeleton screen
          initialScanning.value = false
        }
      }
    })

    return cleanup
  }

  /**
   * Mark one initial scan as complete
   */
  const markScanComplete = () => {
    pendingScanCount--
    if (pendingScanCount <= 0) {
      initialScanning.value = false
    }
  }

  return {
    // State
    mountPaths,
    loading,
    initialScanning,
    initialScanTotal,
    // Methods
    addMountPath,
    removeMountPath,
    refreshMountPath,
    getMountPath,
    initMountPaths,
    markScanComplete
  }
}
