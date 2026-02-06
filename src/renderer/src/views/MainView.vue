<template>
  <div class="main-view">
    <header class="main-header">
      <div class="logo">
        <span>🎬</span>
        <span>MPV Player</span>
      </div>
      <div class="header-actions">
        <SearchBox
          v-model="searchQuery"
          placeholder="搜索视频、文件夹..."
          @search="handleSearch"
        />
        <button class="btn-icon" title="设置" @click="handleSettings">
          ⚙️
        </button>
      </div>
    </header>
    <div class="main-content-wrapper">
      <Sidebar
        :active-filter="activeFilter"
        :mount-paths="mountPathsList"
        :selected-mount-path="selectedMountPath"
        :nas-connections="nasConnectionsList"
        :selected-nas-connection="selectedNasConnection"
        @filter-change="handleFilterChange"
        @mount-path-select="handleMountPathSelect"
        @mount-path-add="handleMountPathAdd"
        @mount-path-remove="handleMountPathRemove"
        @mount-path-refresh="handleMountPathRefresh"
        @nas-add="handleNasAdd"
        @nas-select="handleNasSelect"
        @nas-open="handleNasOpen"
        @nas-remove="handleNasRemove"
        @nas-refresh="handleNasRefresh"
      />
      <div class="content-area-wrapper">
        <Toolbar
          :view-mode="viewMode"
          @add-file="handleAddFile"
          @add-url="handleAddUrl"
          @mount-path="handleMountPathAdd"
          @update:view-mode="handleViewModeChange"
        />
        <!-- NAS 文件浏览器 -->
        <NasFileBrowser
          v-if="showNasFileBrowser && selectedNasConnectionData"
          :nas-connection="selectedNasConnectionData"
          @file-play="handleNasFilePlay"
          @mount-share="handleNasFileBrowserMount"
        />
        <!-- 资源列表 -->
        <ContentArea
          v-else
          :title="contentTitle"
          :subtitle="contentSubtitle"
          :videos="filteredResources"
          :view-mode="viewMode"
          :loading="loading"
          @video-play="handlePlayVideo"
          @video-context-menu="handleContextMenu"
        />
      </div>
    </div>
    <!-- URL 输入对话框 -->
    <el-dialog
      v-model="urlDialogVisible"
      title="添加视频URL"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form>
        <el-form-item label="URL地址">
          <el-input
            v-model="urlInput"
            placeholder="请输入视频URL（http:// 或 https://）"
            @keyup.enter="handleUrlConfirm"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button class="url-dialog-cancel" @click="handleUrlCancel">取消</el-button>
          <el-button type="primary" class="url-dialog-confirm" @click="handleUrlConfirm">确定</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- NAS 配置对话框 -->
    <NasConfigDialog
      v-model="nasDialogVisible"
      @confirm="handleNasConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import Sidebar from '../components/Sidebar.vue'
import Toolbar from '../components/Toolbar.vue'
import ContentArea from '../components/ContentArea.vue'
import SearchBox from '../components/SearchBox.vue'
import NasConfigDialog from '../components/NasConfigDialog.vue'
import NasFileBrowser from '../components/NasFileBrowser.vue'
import { useMediaLibrary } from '../composables/useMediaLibrary'
import { useMountPaths } from '../composables/useMountPaths'
import { useNas } from '../composables/useNas'
import { VideoPlayerSDK } from '../core/sdk'
import type { MediaResource } from '../types/media'

// 使用 composables
const mediaLibrary = useMediaLibrary()
const mountPaths = useMountPaths()
const nas = useNas()

// 创建 VideoPlayerSDK 实例
const sdk = new VideoPlayerSDK()

const {
  resources,
  activeFilter,
  selectedMountPath,
  viewMode,
  searchQuery,
  filteredResources,
  stats,
  addResource,
  addResources,
  removeResourcesByMountPath,
  setFilter,
  setSearchQuery,
  setViewMode,
  setMountPathFilter
} = mediaLibrary

const { mountPaths: mountPathsList, removeMountPath, refreshMountPath, initMountPaths } = mountPaths
const { nasConnections: nasConnectionsList, addNasConnection, removeNasConnection, refreshNasConnection, initNasConnections } = nas

const loading = ref(false)
const selectedNasConnection = ref<string | null>(null)
const showNasFileBrowser = ref(false)
const ipcCleanups: (() => void)[] = []

// 计算选中的 NAS 连接数据
const selectedNasConnectionData = computed(() => {
  if (!selectedNasConnection.value) return null
  return nasConnectionsList.value.find(nc => nc.id === selectedNasConnection.value) || null
})

// URL 对话框相关
const urlDialogVisible = ref(false)
const urlInput = ref('')

// NAS 对话框相关
const nasDialogVisible = ref(false)

// 内容标题和副标题
const contentTitle = computed(() => {
  if (activeFilter.value === 'all') return '全部资源'
  if (activeFilter.value === 'local') return '本地文件'
  if (activeFilter.value === 'network') return '网络资源'
  if (selectedMountPath.value) {
    const mountPath = mountPathsList.value.find(mp => mp.id === selectedMountPath.value)
    return mountPath ? mountPath.path : '挂载路径'
  }
  return '全部资源'
})

const contentSubtitle = computed(() => {
  const { all, local, network, mounted } = stats.value
  if (activeFilter.value === 'all') {
    return `共 ${all} 个资源${local > 0 || network > 0 || mounted > 0 ? `（${local > 0 ? `${local} 个本地文件` : ''}${local > 0 && network > 0 ? '，' : ''}${network > 0 ? `${network} 个网络资源` : ''}${(local > 0 || network > 0) && mounted > 0 ? '，' : ''}${mounted > 0 ? `${mounted} 个挂载路径` : ''}）` : ''}`
  }
  return `共 ${filteredResources.value.length} 个资源`
})

// 处理筛选器改变
const handleFilterChange = (filter: string) => {
  setFilter(filter)
  // 切换到资源列表视图
  showNasFileBrowser.value = false
  selectedNasConnection.value = null
}

// 处理挂载路径选择
const handleMountPathSelect = (id: string) => {
  // 找到对应的挂载路径
  const mountPath = mountPathsList.value.find(mp => mp.id === id)
  if (mountPath) {
    // 使用专门的挂载路径筛选方法
    setMountPathFilter(id, mountPath.path)
  } else {
    // 如果找不到，只设置筛选器
    setFilter(id)
  }
}

// 处理添加文件
const handleAddFile = () => {
  if (!window.electronAPI?.fileSystem) return
  window.electronAPI.fileSystem.selectVideoFile()
}

// 处理添加URL
const handleAddUrl = () => {
  urlInput.value = ''
  urlDialogVisible.value = true
}

// 确认添加URL
const handleUrlConfirm = () => {
  const trimmedUrl = urlInput.value.trim()
  if (!trimmedUrl) {
    return
  }
  
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    ElMessage.error('请输入有效的URL（http:// 或 https://）')
    return
  }

  const resource: MediaResource = {
    id: `network-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: trimmedUrl,
    path: trimmedUrl,
    source: 'network',
    addedAt: new Date()
  }

  addResource(resource)
  syncPlaylist()
  urlDialogVisible.value = false
  urlInput.value = ''
}

// 取消添加URL
const handleUrlCancel = () => {
  urlDialogVisible.value = false
  urlInput.value = ''
}

// 处理挂载路径添加
const handleMountPathAdd = async () => {
  if (!window.electronAPI?.fileSystem) return
  
  // 发送IPC消息，打开文件夹选择对话框
  window.electronAPI.fileSystem.selectMountPath()
}

// 处理挂载路径移除
const handleMountPathRemove = (id: string) => {
  const mountPath = mountPathsList.value.find(mp => mp.id === id)
  if (mountPath) {
    // 移除该挂载路径的所有资源
    removeResourcesByMountPath(mountPath.path)
    // 移除挂载路径
    removeMountPath(id)
  }
}

// 处理挂载路径刷新
const handleMountPathRefresh = async (id: string) => {
  await refreshMountPath(id)
}

// 处理 NAS 添加
const handleNasAdd = () => {
  nasDialogVisible.value = true
}

// 处理 NAS 确认添加
const handleNasConfirm = async (data: { name: string; config: any }) => {
  const connection = await addNasConnection(data.name, data.config)
  if (connection) {
    ElMessage.success('NAS 连接添加成功')
  } else {
    ElMessage.error('添加 NAS 连接失败')
  }
}

// 处理 NAS 选择
const handleNasSelect = (id: string) => {
  selectedNasConnection.value = id
  const nasConnection = nasConnectionsList.value.find(nc => nc.id === id)
  if (nasConnection) {
    // 显示文件浏览器
    showNasFileBrowser.value = true
  }
}

// 处理 NAS 文件浏览器挂载请求
const handleNasFileBrowserMount = () => {
  if (selectedNasConnection.value) {
    handleNasOpen(selectedNasConnection.value)
  }
}

// 处理 NAS 文件播放
const handleNasFilePlay = async (file: any) => {
  if (!selectedNasConnectionData.value) return
  
  // 查找对应的 NAS 连接
  const nasConnection = selectedNasConnectionData.value
  
  // 构建播放路径
  let playPath = file.path
  
  // 根据协议类型处理路径
  if (nasConnection.config.protocol === 'smb') {
    // SMB 协议：MPV 不支持 smb:// URL，必须使用本地挂载路径
    // readNasDirectory 应该返回挂载点路径（/Volumes/ShareName/...）
    if (!playPath.startsWith('/Volumes/')) {
      // 如果路径是相对路径，需要构建完整的挂载点路径
      const shareName = nasConnection.config.share
      if (shareName) {
        const basePath = `/Volumes/${shareName}`
        // 如果路径以 / 开头，直接拼接
        if (playPath.startsWith('/')) {
          playPath = `${basePath}${playPath}`
        } else {
          // 否则作为相对路径拼接
          playPath = `${basePath}/${playPath}`
        }
      }
    }
    // 确保路径是绝对路径，MPV 需要本地文件系统路径
    // 注意：MPV 不支持 smb:// URL，所以必须使用挂载点路径
  } else if (nasConnection.config.protocol === 'webdav') {
    // WebDAV 协议：MPV 支持 http/https URL，直接使用
    // readNasDirectory 返回的路径已经是完整的 WebDAV URL
    // 不需要额外处理
  }
  
  // 使用 VideoPlayerSDK 播放视频
  const video = {
    id: `nas-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: file.name,
    path: playPath,
    source: 'nas'
  }
  
  try {
    // 添加到播放列表
    sdk.addToPlaylist(video)
    // 播放视频
    await sdk.play(video)
  } catch (error) {
    console.error('播放 NAS 文件失败:', error)
    ElMessage.error('播放视频失败')
  }
}

// 处理 NAS 移除
const handleNasRemove = (id: string) => {
  const nasConnection = nasConnectionsList.value.find(nc => nc.id === id)
  if (nasConnection) {
    // 移除该 NAS 连接的所有资源
    removeResourcesByMountPath(`nas://${nasConnection.config.host}/${nasConnection.config.share}`)
    // 移除 NAS 连接
    removeNasConnection(id)
  }
}

// 处理 NAS 打开/挂载
const handleNasOpen = async (id: string) => {
  if (!window.electronAPI?.nas) return

  try {
    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const cleanup = window.electronAPI.nas.onOpenShareResult((data) => {
        cleanup()
        resolve(data)
      })
      window.electronAPI.nas.openShare({ connectionId: id })
      
      // 超时处理
      setTimeout(() => {
        cleanup()
        resolve({ success: false, error: '操作超时' })
      }, 5000)
    })

    if (result.success) {
      ElMessage.success('正在打开共享，请在弹出的窗口中输入用户名和密码（如果需要）')
    } else {
      ElMessage.error(result.error || '打开共享失败')
    }
  } catch (error) {
    ElMessage.error('打开共享时发生错误')
    console.error('打开 NAS 共享失败:', error)
  }
}

// 处理 NAS 刷新
const handleNasRefresh = async (id: string) => {
  await refreshNasConnection(id)
}

// 处理播放视频
const handlePlayVideo = async (video: MediaResource) => {
  // 根据协议类型处理播放路径
  let playPath = video.path
  
  if (video.source === 'nas') {
    // 查找对应的 NAS 连接
    const nasConnection = nasConnectionsList.value.find(nc => {
      if (nc.config.protocol === 'smb') {
        // SMB 协议：检查路径是否匹配该 NAS 连接的挂载点
        return video.path.startsWith(`/Volumes/${nc.config.share}`) || 
               video.path.startsWith(`smb://${nc.config.host}/${nc.config.share}`)
      } else if (nc.config.protocol === 'webdav') {
        // WebDAV 协议：检查路径是否匹配该 NAS 连接的 URL
        const baseUrl = nc.config.useHttps 
          ? `https://${nc.config.host}`
          : `http://${nc.config.host}`
        return video.path.startsWith(baseUrl)
      }
      return false
    })
    
    if (nasConnection) {
      if (nasConnection.config.protocol === 'smb') {
        // SMB 协议：MPV 不支持 smb:// URL，必须使用本地挂载路径
        if (playPath.startsWith('/Volumes/')) {
          // 已经是正确的格式，不需要转换
          // MPV 可以直接播放挂载点路径
        } else if (playPath.startsWith('smb://')) {
          // 如果是 smb:// URL，需要转换为挂载点路径
          const shareName = nasConnection.config.share
          if (shareName) {
            const smbPrefix = `smb://${nasConnection.config.host}/${shareName}`
            if (playPath.startsWith(smbPrefix)) {
              const relativePath = playPath.replace(smbPrefix, '')
              playPath = `/Volumes/${shareName}${relativePath}`
            }
          }
        }
      } else if (nasConnection.config.protocol === 'webdav') {
        // WebDAV 协议：MPV 支持 http/https URL，直接使用
        // 路径应该已经是完整的 WebDAV URL，不需要转换
      }
    }
  }
  
  // 使用 VideoPlayerSDK 播放视频
  const videoToPlay = {
    ...video,
    path: playPath
  }
  
  try {
    // 添加到播放列表
    sdk.addToPlaylist(videoToPlay)
    // 播放视频
    await sdk.play(videoToPlay)
  } catch (error) {
    console.error('播放视频失败:', error)
    ElMessage.error('播放视频失败')
  }
}

// 处理右键菜单
const handleContextMenu = (_event: MouseEvent, video: MediaResource) => {
  // TODO: 实现右键菜单
  console.log('Context menu:', video)
}

// 处理搜索
const handleSearch = (query: string) => {
  setSearchQuery(query)
}

// 处理视图模式改变
const handleViewModeChange = (mode: 'grid' | 'list') => {
  setViewMode(mode)
}

// 处理设置
const handleSettings = () => {
  // TODO: 打开设置窗口
  console.log('Settings clicked')
}

// 同步播放列表
const syncPlaylist = () => {
  const items = resources.value.map((resource) => ({
    id: resource.id,
    name: resource.name,
    path: resource.path,
    source: resource.source
  }))
  sdk.setPlaylist(items)
}

// 处理文件选择
const handleVideoFileSelected = (file: { name: string; path: string }) => {
  const resource: MediaResource = {
    id: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: file.name,
    path: file.path,
    source: 'local',
    addedAt: new Date()
  }
  addResource(resource)
  syncPlaylist()
}

// 处理挂载路径添加成功
const handleMountPathAdded = (data: { mountPath: any; resources: any[] }) => {
  // 将扫描到的资源添加到媒体库
  const newResources: MediaResource[] = data.resources.map((r: any) => ({
    id: r.id || `mounted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: r.name || r.path.split(/[/\\]/).pop() || '未知文件',
    path: r.path,
    source: 'mounted' as const,
    mountPath: data.mountPath.path,
    duration: r.duration,
    size: r.size,
    addedAt: new Date()
  }))
  addResources(newResources)
  syncPlaylist()
}

// 处理挂载路径扫描完成
const handleMountPathScanned = (data: { id: string; resources: any[] }) => {
  // 先移除该挂载路径的旧资源
  const mountPath = mountPathsList.value.find(mp => mp.id === data.id)
  if (mountPath) {
    removeResourcesByMountPath(mountPath.path)
  }
  
  // 添加新扫描到的资源
  const newResources: MediaResource[] = data.resources.map((r: any) => ({
    id: r.id || `mounted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: r.name || r.path.split(/[/\\]/).pop() || '未知文件',
    path: r.path,
    source: 'mounted' as const,
    mountPath: mountPath?.path,
    duration: r.duration,
    size: r.size,
    addedAt: new Date()
  }))
  addResources(newResources)
  syncPlaylist()
}

// 处理 NAS 连接添加成功
const handleNasConnectionAdded = (data: { connection: any; resources: any[] }) => {
  // 将扫描到的资源添加到媒体库
  const newResources: MediaResource[] = data.resources.map((r: any) => ({
    id: r.id || `nas-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: r.name || r.path.split(/[/\\]/).pop() || '未知文件',
    path: r.path,
    source: 'nas' as const,
    duration: r.duration,
    size: r.size,
    addedAt: new Date()
  }))
  addResources(newResources)
  syncPlaylist()
}

// 处理 NAS 连接扫描完成
const handleNasConnectionScanned = (data: { id: string; resources: any[] }) => {
  // 先移除该 NAS 连接的旧资源
  const nasConnection = nasConnectionsList.value.find(nc => nc.id === data.id)
  if (nasConnection) {
    removeResourcesByMountPath(`nas://${nasConnection.config.host}/${nasConnection.config.share}`)
  }
  
  // 添加新扫描到的资源
  const newResources: MediaResource[] = data.resources.map((r: any) => ({
    id: r.id || `nas-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: r.name || r.path.split(/[/\\]/).pop() || '未知文件',
    path: r.path,
    source: 'nas' as const,
    duration: r.duration,
    size: r.size,
    addedAt: new Date()
  }))
  addResources(newResources)
  syncPlaylist()
}

onMounted(async () => {
  // 初始化挂载路径
  ipcCleanups.push(initMountPaths())
  
  // 初始化 NAS 连接并保存清理函数
  ipcCleanups.push(initNasConnections())
  
  // 请求 NAS 连接列表
  if (window.electronAPI?.nas) {
    window.electronAPI.nas.getConnections()
    
    // 监听文件选择
    ipcCleanups.push(window.electronAPI.fileSystem.onVideoFileSelected(handleVideoFileSelected))
    
    // 监听挂载路径相关事件
    ipcCleanups.push(window.electronAPI.fileSystem.onMountPathAdded(handleMountPathAdded))
    ipcCleanups.push(window.electronAPI.fileSystem.onMountPathScanned(handleMountPathScanned))
    
    // 监听 NAS 连接相关事件
    ipcCleanups.push(window.electronAPI.nas.onConnectionAdded(handleNasConnectionAdded))
    ipcCleanups.push(window.electronAPI.nas.onConnectionScanned(handleNasConnectionScanned))
    ipcCleanups.push(window.electronAPI.nas.onConnectionsUpdated((data) => {
      nasConnectionsList.value = data.connections
    }))
  }
  
  // 监听播放器状态变化
  const cleanupStateListener = sdk.onStateChange((state) => {
    console.log('Player state changed:', state)
  })
  
  // 获取现有播放列表
  try {
    const playlist = sdk.getPlaylist()
    // 将播放列表项转换为资源（如果还没有）
    playlist.forEach(item => {
      const existing = resources.value.find(r => r.path === item.path)
      if (!existing) {
        const source: MediaResource['source'] = item.path.startsWith('http://') || item.path.startsWith('https://')
          ? 'network'
          : 'local'
        const resource: MediaResource = {
          id: `${source}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: item.name,
          path: item.path,
          source,
          addedAt: new Date()
        }
        addResource(resource)
      }
    })
  } catch (error) {
    console.error('获取播放列表失败:', error)
  }
  
  // 添加状态监听器清理函数
  ipcCleanups.push(cleanupStateListener)
})

onUnmounted(() => {
  // 清理所有 IPC 监听器
  ipcCleanups.forEach(cleanup => cleanup())
  ipcCleanups.length = 0
  
  // 销毁 SDK 实例
  sdk.destroy()
})
</script>

<style scoped>
.main-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1e1e24;
  color: #fff;
  overflow: hidden;
}

.main-header {
  background: #25252d;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #2d2d35;
  flex-shrink: 0;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 600;
  color: #ffffff;
  font-size: 1.1rem;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.btn-icon {
  background: transparent;
  border: none;
  color: #ccc;
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  transition: all 0.2s;
  font-size: 1.1rem;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon:hover {
  background: #2a2a32;
  color: #fff;
}

.main-content-wrapper {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.content-area-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* URL 对话框样式 - 统一项目风格 */
:deep(.el-dialog) {
  background: #25252d;
  border: 1px solid #2d2d35;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

:deep(.el-dialog__header) {
  background: #25252d;
  border-bottom: 1px solid #2d2d35;
  padding: 16px 20px;
}

:deep(.el-dialog__title) {
  color: #ffffff;
  font-weight: 600;
  font-size: 1rem;
}

:deep(.el-dialog__headerbtn) {
  top: 16px;
  right: 20px;
}

:deep(.el-dialog__close) {
  color: #ccc;
  font-size: 18px;
}

:deep(.el-dialog__close:hover) {
  color: #ffffff;
}

:deep(.el-dialog__body) {
  background: #25252d;
  padding: 20px;
  color: #ffffff;
}

:deep(.el-form-item__label) {
  color: #cccccc;
  font-size: 0.9rem;
}

:deep(.el-input__wrapper) {
  background: #1e1e24;
  border: 1px solid #2d2d35;
  border-radius: 6px;
  box-shadow: none;
}

:deep(.el-input__wrapper:hover) {
  border-color: #4a9eff;
}

:deep(.el-input__wrapper.is-focus) {
  border-color: #4a9eff;
  box-shadow: 0 0 0 1px #4a9eff inset;
}

:deep(.el-input__inner) {
  color: #ffffff;
  background: transparent;
}

:deep(.el-input__inner::placeholder) {
  color: #888888;
}

:deep(.el-dialog__footer) {
  background: #25252d;
  border-top: 1px solid #2d2d35;
  padding: 12px 20px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

:deep(.el-button) {
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 500;
  transition: all 0.2s;
}

/* 取消按钮样式 - 使用更高优先级 */
:deep(.url-dialog-cancel),
:deep(.el-button--default),
:deep(.el-button:not(.el-button--primary)) {
  background: #2a2a32 !important;
  border-color: #2d2d35 !important;
  color: #cccccc !important;
}

:deep(.url-dialog-cancel:hover),
:deep(.el-button--default:hover),
:deep(.el-button:not(.el-button--primary):hover) {
  background: #2d2d35 !important;
  border-color: #3a3a42 !important;
  color: #ffffff !important;
}

:deep(.el-button--primary) {
  background: #4a9eff;
  border-color: #4a9eff;
  color: #ffffff;
}

:deep(.el-button--primary:hover) {
  background: #5aaaff;
  border-color: #5aaaff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(74, 158, 255, 0.3);
}

:deep(.el-button--primary:active) {
  transform: translateY(0);
}
</style>
