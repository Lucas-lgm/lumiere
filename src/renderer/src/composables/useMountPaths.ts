/**
 * 挂载路径管理 Composable
 */
import { ref } from 'vue'
import type { MountPath } from '../types/mount'

export function useMountPaths() {
  const mountPaths = ref<MountPath[]>([])
  const loading = ref(false)

  /**
   * 添加挂载路径
   */
  const addMountPath = async (path: string): Promise<MountPath | null> => {
    if (!window.electronAPI) return null

    loading.value = true
    try {
      // 发送IPC消息添加挂载路径
      return new Promise((resolve) => {
        const cleanup = window.electronAPI.fileSystem.onMountPathAdded((data) => {
          // 检查是否已存在
          if (!mountPaths.value.find(mp => mp.id === data.mountPath.id)) {
            mountPaths.value.push(data.mountPath)
          }
          cleanup()
          loading.value = false
          resolve(data.mountPath)
        })
        window.electronAPI.fileSystem.addMountPath(path)
        
        // 超时处理
        setTimeout(() => {
          cleanup()
          loading.value = false
          resolve(null)
        }, 30000) // 30秒超时
      })
    } catch (error) {
      console.error('添加挂载路径失败:', error)
      loading.value = false
      return null
    }
  }

  /**
   * 移除挂载路径
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
   * 刷新扫描挂载路径
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
      console.error('刷新扫描失败:', error)
      loading.value = false
    }
  }

  /**
   * 获取挂载路径
   */
  const getMountPath = (id: string): MountPath | undefined => {
    return mountPaths.value.find(mp => mp.id === id)
  }

  /**
   * 初始化挂载路径列表（从主进程获取）
   */
  const initMountPaths = () => {
    if (!window.electronAPI?.fileSystem) return () => {}

    // 请求挂载路径列表
    window.electronAPI.fileSystem.getMountPaths()
    
    // 监听挂载路径列表更新
    const cleanup = window.electronAPI.fileSystem.onMountPathsUpdated((data) => {
      mountPaths.value = data.mountPaths
    })
    
    return cleanup
  }

  return {
    // 状态
    mountPaths,
    loading,
    // 方法
    addMountPath,
    removeMountPath,
    refreshMountPath,
    getMountPath,
    initMountPaths
  }
}
