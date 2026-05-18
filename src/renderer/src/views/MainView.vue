<template>
  <div class="main-view">
    <!-- title bar — macOS uses hiddenInset native traffic lights; Windows self-draws right-side buttons -->
    <div class="lib-titlebar">
      <div class="lib-titlebar-text">Lumiere</div>
      <div v-if="isWin32" class="lib-win-controls">
        <button class="win-btn" aria-label="Minimize" @click="winAction('minimize')">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1" fill="none"/></svg>
        </button>
        <button class="win-btn" aria-label="Maximize" @click="winAction('maximize')">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" fill="none"/></svg>
        </button>
        <button class="win-btn win-btn-close" aria-label="Close" @click="winAction('close')">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1" fill="none"/></svg>
        </button>
      </div>
    </div>

    <div class="lib-layout">
      <template v-if="showSettings">
        <SettingsView @close="showSettings = false" />
      </template>

      <template v-else>
      <Sidebar
        :active-filter="activeFilter"
        :mount-paths="mountPathsList"
        :selected-mount-path="selectedMountPath"
        @filter-change="handleFilterChange"
        @mount-path-select="handleMountPathSelect"
        @mount-path-add="handleMountPathAdd"
        @mount-path-remove="handleMountPathRemove"
        @mount-path-refresh="handleMountPathRefresh"
        @open-settings="handleSettings"
      />

      <div class="content-area-wrapper">
        <!-- Expanded page (view all) — has its own toolbar -->
        <ExpandedListView
          v-if="activeFilter === 'all' && expandedSection"
          :title="expandedTitle"
          :videos="expandedVideos"
          @back="expandedSection = null"
          @video-play="handlePlayVideo"
          @video-context-menu="handleContextMenu"
        />

        <template v-else>
        <Toolbar
          ref="toolbarRef"
          :view-mode="viewMode"
          :show-view-toggle="activeFilter !== 'all'"
          :search-query="searchQuery"
          @add-file="handleAddFile"
          @add-folder="handleMountPathAdd"
          @add-url="handleAddUrl"
          @update:view-mode="handleViewModeChange"
          @update:search-query="setSearchQuery($event)"
          @search="handleSearch"
        />

        <!-- Content-driven home page (home filter shows hero cards + grid) -->
        <LibraryHome
          v-if="activeFilter === 'all'"
          :videos="filteredResources"
          :loading="loading"
          :scanning="initialScanning"
          :scan-total="initialScanTotal"
          @video-play="handlePlayVideo"
          @video-context-menu="handleContextMenu"
          @play-resume="handlePlayResume"
          @show-all="handleShowAll"
          @add-file="handleAddFile"
          @add-folder="handleMountPathAdd"
          @add-url="handleAddUrl"
        />

        <!-- Series — folder group view -->
        <FolderGroupView
          v-else-if="activeFilter === 'series'"
          :videos="allResourcesForGrouping"
          :view-mode="viewMode"
          @video-play="handlePlayVideo"
          @video-context-menu="handleContextMenu"
          @folder-open="handleFolderOpen"
        />

        <!-- Non-home content (filtered views) -->
        <ContentArea
          v-else
          :title="contentTitle"
          :subtitle="contentSubtitle"
          :videos="filteredResources"
          :view-mode="viewMode"
          :loading="loading"
          @video-play="handlePlayVideo"
          @video-context-menu="handleContextMenu"
          @add-file="handleAddFile"
          @add-folder="handleMountPathAdd"
          @add-url="handleAddUrl"
        />
        </template>
      </div>
      </template>
    </div>

    <!-- URL input dialog -->
    <UrlDialog
      :visible="urlDialogVisible"
      @update:visible="urlDialogVisible = $event"
      @confirm="handleUrlConfirm"
    />

    <!-- Keyboard shortcuts help ⌘? -->
    <KeyboardHelp
      :visible="kbHelpVisible"
      @update:visible="kbHelpVisible = $event"
    />

    <!-- File drop feedback -->
    <DropZone
      @drop-videos="handleDropVideos"
      @drop-subtitles="handleDropSubtitles"
      @drop-folders="handleDropFolders"
      @drop-unsupported="handleDropUnsupported"
    />

    <!-- First-time onboarding tip bar -->
    <Transition name="onboarding">
      <div v-if="showOnboarding" class="onboarding-bar">
        <span class="onboarding-text">{{ t('onboarding.tip') }}</span>
        <button class="onboarding-close btn-s" @click="dismissOnboarding">{{ t('onboarding.dismiss') }}</button>
      </div>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Sidebar from '../components/library/Sidebar.vue'
import Toolbar from '../components/library/Toolbar.vue'
import ContentArea from '../components/library/ContentArea.vue'
import LibraryHome from '../components/library/LibraryHome.vue'
import FolderGroupView from '../components/library/FolderGroupView.vue'
import UrlDialog from '../components/library/UrlDialog.vue'
import SettingsView from '../components/settings/SettingsView.vue'
import KeyboardHelp from '../components/library/KeyboardHelp.vue'
import DropZone from '../components/base/DropZone.vue'
import ExpandedListView from '../components/library/ExpandedListView.vue'
import { useMediaLibrary } from '../composables/useMediaLibrary'
import { useMountPaths } from '../composables/useMountPaths'
import { useToast } from '../composables/useToast'
import { useContextMenu } from '../composables/useContextMenu'
import { getPlayerSDK } from '../core/sdk'
import type { MediaResource } from '../types/media'
import type { FolderGroup } from '../composables/useFolderGrouping'

// Using composables
const mediaLibrary = useMediaLibrary()
const mountPaths = useMountPaths()
const toast = useToast()
const { showMenu } = useContextMenu()

const { t } = useI18n()
const sdk = getPlayerSDK()

const isWin32 = window.electronAPI?.platform === 'win32'
const winAction = (action: 'close' | 'minimize' | 'maximize') => {
  window.electronAPI?.mainWindow?.action(action)
}

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
  removeResource,
  removeResourcesByMountPath,
  setFilter,
  setSearchQuery,
  setViewMode,
  setMountPathFilter
} = mediaLibrary

const { mountPaths: mountPathsList, removeMountPath, refreshMountPath, initMountPaths, initialScanning, initialScanTotal, markScanComplete } = mountPaths

const toolbarRef = ref<InstanceType<typeof Toolbar> | null>(null)
const loading = ref(false)
const ipcCleanups: (() => void)[] = []

// URL dialog related
const urlDialogVisible = ref(false)

// Settings page
const showSettings = ref(false)

// Keyboard shortcuts help
const kbHelpVisible = ref(false)

// First-time onboarding
const ONBOARDING_KEY = 'lumiere-onboarding-done'
const showOnboarding = ref(false)

function dismissOnboarding() {
  showOnboarding.value = false
  localStorage.setItem(ONBOARDING_KEY, '1')
}

// Expanded page (view all)
const expandedSection = ref<string | null>(null)

const expandedTitle = computed(() => {
  if (expandedSection.value === 'recent') return t('mainView.recentlyAdded')
  if (expandedSection.value === 'continue-watching') return t('mainView.continueWatching')
  return t('mainView.allResources')
})

const expandedVideos = computed(() => {
  return [...filteredResources.value].sort((a, b) => {
    const aTime = a.addedAt ? new Date(a.addedAt).getTime() : 0
    const bTime = b.addedAt ? new Date(b.addedAt).getTime() : 0
    return bTime - aTime
  })
})

// All resources for folder grouping (applies search but not filter)
const allResourcesForGrouping = computed(() => {
  let result = resources.value
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(r =>
      r.name.toLowerCase().includes(query) ||
      r.path.toLowerCase().includes(query)
    )
  }
  return result
})

// Content title and subtitle
const contentTitle = computed(() => {
  if (activeFilter.value === 'all') return t('mainView.allResources')
  if (activeFilter.value === 'local') return t('mainView.localFiles')
  if (activeFilter.value === 'network') return t('mainView.networkResources')
  if (selectedMountPath.value) {
    const mountPath = mountPathsList.value.find(mp => mp.id === selectedMountPath.value)
    return mountPath ? mountPath.path : t('mainView.mountPath')
  }
  return t('mainView.allResources')
})

const contentSubtitle = computed(() => {
  const { all, local, network, mounted } = stats.value
  if (activeFilter.value === 'all') {
    const parts: string[] = []
    if (local > 0) parts.push(t('mainView.localCount', { n: local }))
    if (network > 0) parts.push(t('mainView.networkCount', { n: network }))
    if (mounted > 0) parts.push(t('mainView.mountedCount', { n: mounted }))
    if (parts.length > 0) {
      return t('mainView.totalWithDetail', { total: all, detail: parts.join(', ') })
    }
    return t('mainView.totalResources', { total: all })
  }
  return t('mainView.totalResources', { total: filteredResources.value.length })
})

// Handle filter change
const handleFilterChange = (filter: string) => {
  expandedSection.value = null
  setFilter(filter)
}

// Handle mount path selection
const handleMountPathSelect = (id: string) => {
  const mountPath = mountPathsList.value.find(mp => mp.id === id)
  if (mountPath) {
    setMountPathFilter(id, mountPath.path)
  } else {
    setFilter(id)
  }
}

// Handle add file
const handleAddFile = () => {
  if (!window.electronAPI?.fileSystem) return
  window.electronAPI.fileSystem.selectVideoFile()
}

// Handle add URL
const handleAddUrl = () => {
  urlDialogVisible.value = true
}

// Confirm add URL
const handleUrlConfirm = (url: string) => {
  const resource: MediaResource = {
    id: `network-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: url,
    path: url,
    source: 'network',
    addedAt: new Date()
  }

  addResource(resource)
  syncPlaylist()
}

// Handle mount path add
const handleMountPathAdd = async () => {
  if (!window.electronAPI?.fileSystem) return
  window.electronAPI.fileSystem.selectMountPath()
}

// Handle mount path remove
const handleMountPathRemove = (id: string) => {
  const mountPath = mountPathsList.value.find(mp => mp.id === id)
  if (mountPath) {
    removeResourcesByMountPath(mountPath.path)
    removeMountPath(id)
  }
}

// Handle mount path refresh
const handleMountPathRefresh = async (id: string) => {
  await refreshMountPath(id)
}

// Handle resume playback (from Continue Watching hero card click)
const handlePlayResume = async (progress: { mediaPath: string; currentTime: number }) => {
  const video = resources.value.find(r => r.path === progress.mediaPath)
  const name = progress.mediaPath.split(/[/\\]/).pop() || progress.mediaPath
  const target = video || {
    id: `resume-${Date.now()}`,
    name,
    path: progress.mediaPath,
    source: 'local' as const
  }
  try {
    sdk.addToPlaylist(target)
    sdk.setPlaylistCurrentByPath(target.path)
    await sdk.play({ ...target, startTime: progress.currentTime })
  } catch (error) {
    console.error('Resume failed:', error)
    toast.error(t('mainView.resumeFailed'))
  }
}

// Handle play video
const handlePlayVideo = async (video: MediaResource) => {
  const videoToPlay = { ...video }

  try {
    sdk.addToPlaylist(videoToPlay)
    sdk.setPlaylistCurrentByPath(videoToPlay.path)
    await sdk.play(videoToPlay)
  } catch (error) {
    console.error('Failed to play video:', error)
    toast.error(t('mainView.playFailed'))
  }
}

// Context menu
const handleContextMenu = (event: MouseEvent, video: MediaResource) => {
  showMenu(event, [
    { id: 'play', icon: 'play', label: t('contextMenu.play') },
    { id: 'copy-path', icon: 'copy', label: t('contextMenu.copyPath') },
    { id: 'show-in-finder', icon: 'folder-open', label: t('contextMenu.showInFinder') }
  ], async (id) => {
    switch (id) {
      case 'play':
        handlePlayVideo(video)
        break
      case 'copy-path':
        try { await navigator.clipboard.writeText(video.path) } catch { /* ignore */ }
        break
      case 'show-in-finder':
        if (window.electronAPI?.fileSystem) {
          window.electronAPI.fileSystem.showInFinder(video.path)
        }
        break
    }
  })
}

// Handle folder open (from series view folder card click)
const handleFolderOpen = (group: FolderGroup) => {
  if (group.currentEpisode) {
    const progress = group.currentProgress
    handlePlayResume({
      mediaPath: group.currentEpisode.path,
      currentTime: progress?.currentTime || 0
    })
  } else if (group.items.length > 0) {
    handlePlayVideo(group.items[0])
  }
}

// Handle view all
const handleShowAll = (section: string) => {
  expandedSection.value = section
}

// Handle search
const handleSearch = (query: string) => {
  setSearchQuery(query)
}

// Handle view mode change
const handleViewModeChange = (mode: 'grid' | 'list') => {
  setViewMode(mode)
}

// Handle settings
const handleSettings = () => {
  showSettings.value = true
}

// Sync playlist
const syncPlaylist = () => {
  const items = resources.value.map((resource) => ({
    id: resource.id,
    name: resource.name,
    path: resource.path,
    source: resource.source
  }))
  sdk.setPlaylist(items)
}

// Handle file selection (Finder associated open / Dock drag-and-drop)
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
  handlePlayVideo(resource)
}

// Handle mount path add success
const handleMountPathAdded = (data: { mountPath: any; resources: any[] }) => {
  const newResources: MediaResource[] = data.resources.map((r: any) => ({
    id: r.id || `mounted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: r.name || r.path.split(/[/\\]/).pop() || 'Unknown',
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

// Handle mount path scan complete
const handleMountPathScanned = (data: { id: string; resources: any[] }) => {
  const mountPath = mountPathsList.value.find(mp => mp.id === data.id)
  if (mountPath) {
    removeResourcesByMountPath(mountPath.path)
  }

  const newResources: MediaResource[] = data.resources.map((r: any) => ({
    id: r.id || `mounted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: r.name || r.path.split(/[/\\]/).pop() || 'Unknown',
    path: r.path,
    source: 'mounted' as const,
    mountPath: mountPath?.path,
    duration: r.duration,
    size: r.size,
    addedAt: new Date()
  }))
  addResources(newResources)
  syncPlaylist()
  markScanComplete()
}

// Global keyboard shortcuts
function handleKeydown(e: KeyboardEvent) {
  if (e.metaKey && e.key === 'n') {
    e.preventDefault()
    urlDialogVisible.value = true
  }
  if (e.metaKey && e.key === '?') {
    e.preventDefault()
    kbHelpVisible.value = !kbHelpVisible.value
  }
  if (e.metaKey && e.key === 'f') {
    e.preventDefault()
    toolbarRef.value?.focusSearch()
  }
}

// File drop handling
const handleDropVideos = (files: File[]) => {
  for (const file of files) {
    const filePath = (file as any).path as string | undefined
    if (!filePath) continue
    const resource: MediaResource = {
      id: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      path: filePath,
      source: 'local',
      addedAt: new Date()
    }
    addResource(resource)
  }
  syncPlaylist()
  toast.success(`Added ${files.length} video files`)
}

const handleDropSubtitles = (files: File[]) => {
  for (const file of files) {
    const filePath = (file as any).path as string | undefined
    if (!filePath) continue
    // Notify player to load external subtitles
    if (window.electronAPI?.playerProperty) {
      window.electronAPI.playerProperty.set('sub-file-append', filePath)
    }
  }
  toast.success(`Loaded ${files.length} subtitle files`)
}

const handleDropFolders = (paths: string[]) => {
  for (const folderPath of paths) {
    if (window.electronAPI?.fileSystem) {
      window.electronAPI.fileSystem.scanFolder(folderPath)
    }
  }
  toast.info(`Scanning ${paths.length} folders...`)
}

const handleDropUnsupported = (count: number) => {
  toast.warning(`${count} files have unsupported formats, ignored`)
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  ipcCleanups.push(initMountPaths())

  // First-time onboarding
  if (!localStorage.getItem(ONBOARDING_KEY)) {
    showOnboarding.value = true
  }

  if (window.electronAPI?.fileSystem) {
    ipcCleanups.push(window.electronAPI.fileSystem.onVideoFileSelected(handleVideoFileSelected))
    ipcCleanups.push(window.electronAPI.fileSystem.onMountPathAdded(handleMountPathAdded))
    ipcCleanups.push(window.electronAPI.fileSystem.onMountPathScanned(handleMountPathScanned))
  }

  try {
    const playlist = sdk.getPlaylist()
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
    console.error('Failed to get playlist:', error)
  }

})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  ipcCleanups.forEach(cleanup => cleanup())
  ipcCleanups.length = 0
  sdk.destroy()
})
</script>

<style scoped>
.main-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  color: var(--t1);
  overflow: hidden;
}

/* title bar — macOS native traffic lights via hiddenInset, Windows uses right-side buttons */
.lib-titlebar {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  padding: 0 14px;
  background: var(--bg-s);
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
  -webkit-app-region: drag;
  position: relative;
}

.lib-titlebar-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--t2);
}

/* Windows window buttons: fixed on the right, does not occupy center title */
.lib-win-controls {
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
  display: flex;
  -webkit-app-region: no-drag;
}

.win-btn {
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--t1);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.12s ease;
}

.win-btn:hover {
  background: var(--bg-h);
}

.win-btn-close:hover {
  background: #e81123;
  color: #fff;
}

.lib-layout {
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

/* ===== RESPONSIVE ===== */
/* ≤500px: sidebar auto-collapses to icon width, content fills remaining space */
@media (max-width: 500px) {
  .lib-titlebar {
    padding: 0 8px;
  }
}

/* ≤400px: hide title bar text at very narrow widths, maximize content area */
@media (max-width: 400px) {
  .lib-titlebar-text {
    display: none;
  }
}

/* Onboarding banner */
.onboarding-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-e);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--bd);
  border-radius: var(--r2);
  box-shadow: var(--shadow-popover);
  z-index: 900;
  max-width: 560px;
  white-space: nowrap;
}

.onboarding-text {
  font-size: 12px;
  color: var(--t2);
  flex: 1;
}

.onboarding-close {
  font-size: 11px;
  padding: 3px 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.onboarding-enter-active,
.onboarding-leave-active {
  transition: opacity var(--dur-normal) ease, transform var(--dur-normal) ease;
}

.onboarding-enter-from,
.onboarding-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}
</style>
