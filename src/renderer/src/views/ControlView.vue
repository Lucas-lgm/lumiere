<template>
  <div 
    class="control-view" 
    :class="{ 
      'controls-hidden': !controlsVisible,
      'video-not-ready': !isVideoReady
    }"
  >
    <header 
      class="header"
      @mouseenter="onControlBarEnter"
      @mouseleave="onControlBarLeave"
    >
      <div class="window-controls">
        <button class="window-btn close" @click.stop="handleWindowAction('close')"></button>
        <button class="window-btn minimize" @click.stop="handleWindowAction('minimize')"></button>
        <button class="window-btn maximize" @click.stop="handleWindowAction('maximize')"></button>
      </div>
      <h1 class="title">{{ currentVideoName || '视频播放器' }}</h1>
    </header>
    <!-- 播放错误提示（全屏遮罩，居中显示） -->
    <div v-if="playerError" class="error-overlay">
      <div class="error-content">
        <div class="error-title">播放出错</div>
        <div class="error-message">{{ playerError }}</div>
      </div>
    </div>
    <!-- 加载 / 切换 / 跳转 / 缓冲 提示（统一使用一个 overlay，只切换文案） -->
    <div v-if="isLoading || isSwitchingVideo" class="loading-overlay">
      <div class="loading-content">
        <span class="loading-text">
          {{
            isSwitchingVideo
              ? '正在切换视频...'
              : isNetworkBuffering
                  ? networkBufferingPercent !== null
                    ? `网络缓冲中... ${networkBufferingPercent}%`
                    : '网络缓冲中...'
                  : isSeeking
                    ? '正在跳转...'
                    : '加载中...'
          }}
        </span>
      </div>
    </div>
    <div v-if="showSettings" class="settings-panel">
      <div class="settings-header">
        <span class="settings-title">设置</span>
        <button class="settings-close" @click="toggleSettings">×</button>
      </div>
      <div class="settings-body">
        <div class="settings-section">
          <span class="settings-label">音轨</span>
          <el-select
            v-if="audioTracks.length > 0"
            v-model="selectedAudioTrackId"
            class="settings-select"
            size="small"
            placeholder="音轨"
            @change="onAudioTrackChange"
          >
            <el-option
              v-for="track in audioTracks"
              :key="`audio-${track.id}`"
              :label="formatAudioTrackLabel(track)"
              :value="track.id"
            />
          </el-select>
          <span v-else class="settings-hint">无可用音轨</span>
        </div>
        <div class="settings-section">
          <span class="settings-label">字幕</span>
          <el-select
            v-if="subtitleTracks.length > 0"
            v-model="selectedSubtitleTrackId"
            class="settings-select"
            size="small"
            placeholder="字幕"
            @change="onSubtitleTrackChange"
          >
            <el-option :key="'sub-none'" label="无字幕" :value="'none'" />
            <el-option
              v-for="track in subtitleTracks"
              :key="`sub-${track.id}`"
              :label="formatSubtitleTrackLabel(track)"
              :value="track.id"
            />
          </el-select>
          <span v-else class="settings-hint">无可用字幕</span>
        </div>
        <div class="settings-section settings-row">
          <span class="settings-label">循环播放</span>
          <button
            type="button"
            class="settings-toggle"
            :class="{ active: sdk.getLoop() }"
            @click="toggleLoop"
          >
            {{ sdk.getLoop() ? '🔁 开' : '➡️ 关' }}
          </button>
        </div>
        <div class="settings-section settings-row">
          <span class="settings-label">随机播放</span>
          <button
            type="button"
            class="settings-toggle"
            :class="{ active: sdk.getShuffle() }"
            @click="toggleShuffle"
          >
            {{ sdk.getShuffle() ? '🔀 开' : '▶️ 关' }}
          </button>
        </div>
        <div v-if="!isWindows" class="settings-section settings-row">
          <span class="settings-label">HDR</span>
          <button
            type="button"
            class="settings-toggle"
            :class="{ active: hdrEnabled }"
            @click="toggleHdr"
          >
            {{ hdrEnabled ? 'HDR 开' : 'SDR' }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="showPlaylist" class="playlist-panel">
      <div class="playlist-header">
        <span class="playlist-title">播放列表</span>
        <button class="playlist-close" @click="togglePlaylist">×</button>
      </div>
      <div class="playlist-body">
        <div
          v-if="playlist.length === 0"
          class="playlist-empty"
        >
          暂无播放列表
        </div>
        <div
          v-for="(item, index) in playlist"
          :key="item.path"
          :class="['playlist-item', { active: item.path === currentPath }]"
          @click="playFromPlaylist(item)"
          draggable="true"
          @dragstart="onDragStart($event, index)"
          @dragover.prevent
          @drop="onDrop($event, index)"
        >
          <div class="playlist-item-content">
            <div class="playlist-item-name">{{ item.name }}</div>
            <div class="playlist-item-path">{{ item.path }}</div>
          </div>
          <button 
            class="playlist-item-remove" 
            @click.stop="removeFromPlaylist(index)"
            title="从播放列表移除"
          >
            ×
          </button>
        </div>
      </div>
    </div>
    <main 
      class="playback-controls"
      @mouseenter="onControlBarEnter"
      @mouseleave="onControlBarLeave"
    >
      <div class="control-bar">
        <div class="progress-container">
          <el-slider
            :model-value="sliderValue"
            :min="0"
            :max="sliderMax"
            :step="0.1"
            :show-tooltip="true"
            :format-tooltip="formatTime"
            @mousedown="onSeekStart"
            @touchstart.prevent="onSeekStart"
            @input="onSeek"
            @change="onSeekEnd"
            class="progress-slider"
          />
          <div class="time-display">
            <span class="time-current">{{ formatTime(currentTime) }}</span>
            <span class="time-total">{{ formatTime(duration) }}</span>
          </div>
        </div>
        <div class="control-row">
          <div class="control-left">
            <button @click="playPrevFromPlaylist" class="btn-control" title="上一首">⏮</button>
            <button @click="togglePlayPause" class="btn-control play-pause" :title="isPlaying ? '暂停' : '播放'">
              {{ isPlaying ? '⏸' : '▶' }}
            </button>
            <button @click="playNextFromPlaylist" class="btn-control" title="下一首">⏭</button>
            <button @click="stop" class="btn-control" title="停止">⏹</button>
          </div>
          <div class="control-right">
            <button @click="togglePlaylist" class="btn-control" title="播放列表">📋</button>
            <button @click="toggleFullscreen" class="btn-control" title="全屏">⛶</button>
            <div class="volume-control">
              <button @click="toggleMute" class="btn-control" :title="volume > 0 ? '静音' : '取消静音'">
                {{ volume > 0 ? '🔊' : '🔇' }}
              </button>
              <el-slider
                class="volume-slider-el"
                :model-value="volume"
                :min="0"
                :max="100"
                :step="1"
                :show-tooltip="true"
                :format-tooltip="formatVolumeTooltip"
                @mousedown="onVolumeSeekStart"
                @touchstart.prevent="onVolumeSeekStart"
                @input="onVolumeInput"
                @change="onVolumeChangeEnd"
              />
              <span class="volume-percent">{{ volume }}%</span>
            </div>
            <button @click="toggleSettings" class="btn-control" title="设置">⚙️</button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useControlBarAutoHide } from '../composables/useControlBarAutoHide'
import { useAdjustableValue } from '../composables/useAdjustableValue'
import { getPlayerSDK } from '../core/sdk'

const isPlaying = ref(false)
// 跟踪上一个播放状态，用于检测从 playing 到 ended 的转换
let lastPlayerPhase: string = 'idle'
// 进度条使用可调值模式（短暂保护期 + 正在拖动时本地优先）
const currentTimeAdjustable = useAdjustableValue<number>({
  initial: 0,
  // 增加保护期到 1s，防止 seek 回弹闪烁
  justChangedWindowMs: 1000,
  // debugLabel: 'timeline',
  // 进度条目前只在松手时真正 seek，这里不在 input 阶段发送命令
  sendOnInput: false,
  sendCommand: (t: number) => {
    if (window.electronAPI) {
      const dur = typeof duration.value === 'number' ? duration.value : 0
      const target = dur > 0 ? Math.max(0, Math.min(dur, t)) : t
      console.log('[ControlView] send control-seek', { target, raw: t, duration: dur })
      window.electronAPI.player.seek(target)
    }
  }
})
const currentTime = currentTimeAdjustable.value
const duration = ref(0)

// 计算属性：确保传递给 Slider 的值永远不会超过 Max
// 这能防止 Element Plus 因自动 Clamp 而触发意外的 input 事件
const sliderMax = computed(() => (duration.value > 0 ? duration.value : 100))
const sliderValue = computed(() => Math.min(currentTime.value, sliderMax.value))

const currentVideoName = ref<string>('')
const isLoading = ref(false)
const isSeeking = ref(false)
const isNetworkBuffering = ref(false)
const networkBufferingPercent = ref<number | null>(null)
const isScrubbing = ref(false)
const isVolumeScrubbing = ref(false)
const playerError = ref<string | null>(null)

const isSwitchingVideo = ref(false)

interface PlaylistItem {
  name: string
  path: string
  startTime?: number
}

interface PlayerTrack {
  id: number
  type: 'audio' | 'sub' | 'video'
  lang?: string
  title?: string
  selected: boolean
  source: 'internal' | 'external'
}

const sdk = getPlayerSDK()
const playlist = ref<PlaylistItem[]>([])
const showPlaylist = ref(false)
const showSettings = ref(false)
const currentPath = ref<string | null>(null)
const tracks = ref<PlayerTrack[]>([])
const audioTracks = computed(() => tracks.value.filter(t => t.type === 'audio'))
const subtitleTracks = computed(() => tracks.value.filter(t => t.type === 'sub'))
const selectedAudioTrackId = ref<number | null>(null)
const selectedSubtitleTrackId = ref<number | 'none' | null>(null)

function refreshPlaylistFromSDK() {
  playlist.value = sdk.getPlaylist().map((m) => ({
    name: m.name,
    path: m.path,
    startTime: m.startTime
  }))
}

// 从主进程获取播放列表状态，确保初始化时与其他窗口一致
async function loadPlaylistFromMain() {
  if (window.electronAPI) {
    try {
      const items = await window.electronAPI.player.getPlaylist();
      if (items && items.length > 0) {
        const mediaItems = items.map((item) => ({
          name: item.name,
          path: item.path,
          startTime: item.startTime
        }))
        sdk.setPlaylist(mediaItems)
        refreshPlaylistFromSDK()
      }
    } catch (error) {
      console.error('Error loading playlist from main:', error);
    }
  }
}
const hdrEnabled = ref(true)

// 音量采用通用可调值模式（短暂保护期）
const volumeAdjustable = useAdjustableValue<number>({
  initial: 100,
  // debugLabel: 'volume',
  // 音量希望拖动时实时生效，所以在 onUserInput 阶段就发送命令
  sendOnInput: true,
  sendCommand: (v: number) => {
    // eslint-disable-next-line no-console
    console.log('[ControlView] send control-volume', v)
    if (window.electronAPI) {
      window.electronAPI.player.setVolume(Math.round(v))
    }
  }
})
const volume = volumeAdjustable.value


// 判断视频是否已准备好（已加载完成，可以播放）
// 当 phase 为 'playing' 或 'paused' 时，说明视频已加载完成
const isVideoReady = ref(false)

// 使用控制栏自动隐藏 composable
const autoHide = useControlBarAutoHide({
  isPlaying,
  isLoading,
  isScrubbing,
  debug: false
})

const {
  controlsVisible,
  onControlBarEnter,
  onControlBarLeave,
  onUserInteraction,
  handlePlayerStateChange,
  showControls,
  scheduleHide,
  cleanup: cleanupAutoHide
} = autoHide

// 仅在 Electron 渲染进程运行，不考虑 SSR，直接用 window 判断平台
const isWindows =
  typeof window !== 'undefined' &&
  typeof window.electronAPI !== 'undefined' &&
  window.electronAPI.platform === 'win32'

type PlayerStatusSnapshot = {
  phase: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
  currentTime: number
  duration: number
  volume: number
  path: string | null
  isSeeking: boolean
  isNetworkBuffering: boolean
  networkBufferingPercent: number
  errorMessage?: string
  isSwitching?: boolean  // 是否正在切换视频（由后端管理）
}

const handlePlayVideo = (file: { name: string; path: string }) => {
  // 更新视频信息（切换状态由后端通过 player-status.isSwitching 管理）
  currentVideoName.value = file.name
  currentPath.value = file.path

  // 收到新的播放指令时，前端立即做一次乐观清理，
  // 避免等待后端 idle / loading 状态广播期间，UI 还停留在上一个错误 / 时间轴上。
  playerError.value = null
  isVideoReady.value = false
  isScrubbing.value = false
  isSeeking.value = false
  isNetworkBuffering.value = false
  networkBufferingPercent.value = null
  currentTimeAdjustable.reset(0)
  duration.value = 0
  // 先进入 loading 态，等后端真正广播 phase 再修正
  isLoading.value = true
  // 视频切换时刷新可用轨道信息
  refreshTracks().catch((error) => {
    console.error('[ControlView] Failed to refresh tracks on handlePlayVideo:', error)
  })
}

const refreshTracks = async () => {
  try {
    const result = await sdk.getTracks()
    if (Array.isArray(result)) {
      tracks.value = result as PlayerTrack[]
      const currentAudio = audioTracks.value.find(t => t.selected) || null
      const currentSub = subtitleTracks.value.find(t => t.selected) || null
      selectedAudioTrackId.value = currentAudio ? currentAudio.id : null
      selectedSubtitleTrackId.value = currentSub ? currentSub.id : 'none'
    } else {
      tracks.value = []
      selectedAudioTrackId.value = null
      selectedSubtitleTrackId.value = null
    }
  } catch (error) {
    console.error('[ControlView] Failed to get tracks:', error)
  }
}

const handlePlayerState = (status: PlayerStatusSnapshot) => {
  // console.log('status:', status)

  // 简化逻辑：不再进行 isAdjusting 与 UI 交互状态的自我纠正

  const wasSeeking = isSeeking.value
  
  // 更新切换状态（由后端管理）
  isSwitchingVideo.value = !!status.isSwitching
  
  isSeeking.value = !!status.isSeeking
  isNetworkBuffering.value = !!status.isNetworkBuffering
  networkBufferingPercent.value =
    typeof status.networkBufferingPercent === 'number' ? status.networkBufferingPercent : null
  isLoading.value = status.phase === 'loading' || isSeeking.value || isNetworkBuffering.value
  const wasPlaying = isPlaying.value
  isPlaying.value = status.phase === 'playing'

  // 记录错误信息（由后端通过 PlayerState.error 传递而来）
  if (status.phase === 'error') {
    playerError.value = status.errorMessage || '播放出错'
    // 错误时也同步一下标题，避免依赖额外的 player-error 通道
    currentVideoName.value = `播放出错: ${playerError.value}`
  } else {
    playerError.value = null
  }
  
  // 判断是否应该显示黑色背景（只在视频真正开始播放或暂停时，背景才透明）
  isVideoReady.value = 
    status.phase === 'playing' || 
    status.phase === 'paused'

  // 前端控制播放列表，不需要从主进程同步当前项
  // 但需要更新 currentPath 以保持 UI 显示一致
  if (typeof status.path === 'string') {
    currentPath.value = status.path
  }
  
  // 使用 composable 处理播放状态变化
  handlePlayerStateChange(wasPlaying)
  
  // 更新 duration（只在有有效值时更新，避免覆盖）
  if (typeof status.duration === 'number' && status.duration > 0) {
    duration.value = status.duration
  }
  
  // 处理播放结束状态：将 currentTime 设置为 duration
  if (status.phase === 'ended') {
    if (duration.value > 0) {
      currentTimeAdjustable.applyServerState(duration.value)
    }
    isPlaying.value = false
    if (lastPlayerPhase === 'playing' && status.phase === 'ended') {
      playNextFromPlaylist()
    }
  }
  
  // 更新上一个播放状态
  lastPlayerPhase = status.phase || 'idle'
  
  // 当跳转完成时（isSeeking 从 true 变为 false），重置 isScrubbing
  if (wasSeeking && !isSeeking.value && isScrubbing.value) {
    isScrubbing.value = false
    // 跳转完成后，强制进行一次同步，忽略保护期
    // 这样可以确保如果用户松手后，后端状态已经跳到了新位置，UI 能立刻跟上，而不是被旧的保护逻辑挡住
    if (typeof status.currentTime === 'number') {
      currentTimeAdjustable.reset(status.currentTime)
    }
  }

  // 状态自愈：如果 UI 不再处于拖动状态，且后端也不在跳转中，
  // 那么 adjustable 也不应该处于 adjusting 状态。
  // 这可以解决因异常事件（如 Element Plus 自动触发的 input）导致的死锁。
  if (!isScrubbing.value && !isSeeking.value && currentTimeAdjustable.isAdjusting) {
    console.warn('[ControlView] Auto-correcting stuck adjusting state')
    currentTimeAdjustable.forceEndAdjusting()
  }

  // console.log('[ControlView] handlePlayerState phase',status, isScrubbing.value, isSeeking.value)
  
  // 更新 currentTime（只在非拖动、非跳转状态下更新，且不是播放结束状态）
  if (typeof status.currentTime === 'number' && !isScrubbing.value && !isSeeking.value && status.phase !== 'ended') {
    currentTimeAdjustable.applyServerState(status.currentTime)
  }
  
  if (typeof status.volume === 'number') {
    // eslint-disable-next-line no-console
    volumeAdjustable.applyServerState(status.volume)
  }
  if (typeof status.path === 'string') {
    currentPath.value = status.path
    const found = playlist.value.find((item: PlaylistItem) => item.path === status.path)
    if (found) {
      currentVideoName.value = found.name
    } else {
      const parts = status.path.split(/[/\\]/)
      currentVideoName.value = parts[parts.length - 1] || status.path
    }
  }

  // 在首次进入 playing/paused 时刷新轨道信息，以确保列表与后端一致
  if ((status.phase === 'playing' || status.phase === 'paused') && duration.value > 0) {
    refreshTracks().catch((error) => {
      console.error('[ControlView] Failed to refresh tracks on state change:', error)
    })
  }
}

const formatAudioTrackLabel = (track: PlayerTrack): string => {
  const parts: string[] = []
  if (track.lang) parts.push(track.lang)
  if (track.title) parts.push(track.title)
  if (track.source === 'external') parts.push('外部')
  return parts.length > 0 ? parts.join(' / ') : `音轨 ${track.id}`
}

const formatSubtitleTrackLabel = (track: PlayerTrack): string => {
  const parts: string[] = []
  if (track.lang) parts.push(track.lang)
  if (track.title) parts.push(track.title)
  if (track.source === 'external') parts.push('外部')
  return parts.length > 0 ? parts.join(' / ') : `字幕 ${track.id}`
}

const onAudioTrackChange = async (value: number | null) => {
  selectedAudioTrackId.value = value
  try {
    const id = typeof value === 'number' && value > 0 ? value : null
    await sdk.setAudioTrack(id)
  } catch (error) {
    console.error('[ControlView] Failed to set audio track:', error)
  }
}

const onSubtitleTrackChange = async (value: number | 'none') => {
  selectedSubtitleTrackId.value = value
  try {
    const id = typeof value === 'number' && value > 0 ? value : null
    await sdk.setSubtitleTrack(id)
  } catch (error) {
    console.error('[ControlView] Failed to set subtitle track:', error)
  }
}

const formatTime = (seconds: number): string => {
  // 明确检查是否为 NaN 或 undefined/null，而不是使用 !seconds（因为 0 也是 falsy）
  if (seconds == null || isNaN(seconds)) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const togglePlaylist = () => {
  showPlaylist.value = !showPlaylist.value
  if (showPlaylist.value) {
    showSettings.value = false
    refreshPlaylistFromSDK()
  }
}

const toggleSettings = () => {
  showSettings.value = !showSettings.value
  if (showSettings.value) {
    showPlaylist.value = false
  }
}

const toggleLoop = () => {
  const newState = sdk.toggleLoop()
  console.log('Loop mode:', newState)
}

const toggleShuffle = () => {
  const newState = sdk.toggleShuffle()
  console.log('Shuffle mode:', newState)
  // 刷新播放列表显示
  if (showPlaylist.value) {
    refreshPlaylistFromSDK()
  }
}

const removeFromPlaylist = (index: number) => {
  sdk.removeFromPlaylist(index)
  refreshPlaylistFromSDK()
}

const movePlaylistItem = (fromIndex: number, toIndex: number) => {
  const success = sdk.movePlaylistItem(fromIndex, toIndex)
  if (success) {
    refreshPlaylistFromSDK()
  }
}

let draggedIndex: number | null = null

const onDragStart = (event: DragEvent, index: number) => {
  draggedIndex = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

const onDrop = (event: DragEvent, targetIndex: number) => {
  event.preventDefault()
  if (draggedIndex !== null && draggedIndex !== targetIndex) {
    movePlaylistItem(draggedIndex, targetIndex)
  }
  draggedIndex = null
}

const toggleFullscreen = () => {
  // 全屏切换时，先立即隐藏控制栏，避免渲染延迟导致的视觉问题
  // 网页渲染比原生窗口慢，先隐藏可以避免看到渲染延迟
  controlsVisible.value = false
  
  if (window.electronAPI) {
    window.electronAPI.player.toggleFullscreen()
  }
  
  // 延迟恢复控制栏显示（如果需要）
  // 全屏时通常控制栏会自动隐藏，所以这里不需要立即恢复
  // 如果进入全屏，控制栏会保持隐藏直到用户交互
  // 如果退出全屏，控制栏会在用户交互时显示
}

const handleWindowAction = (action: 'close' | 'minimize' | 'maximize') => {
  if (window.electronAPI) {
    window.electronAPI.player.windowAction(action)
  }
}

const toggleHdr = () => {
  hdrEnabled.value = !hdrEnabled.value
  if (window.electronAPI) {
    window.electronAPI.player.setHdr(hdrEnabled.value)
  }
}

const playFromPlaylist = (item: PlaylistItem) => {
  // 前端完全控制视频切换逻辑
  console.log('Playing from playlist:', item)
  
  // 1. 设置当前播放项
  sdk.setPlaylistCurrentByPath(item.path)
  
  // 2. 更新前端状态
  handlePlayVideo(item)
  
  // 3. 执行播放
  sdk.play({ name: item.name, path: item.path, startTime: item.startTime })
}

const togglePlayPause = () => {
  onUserInteraction()
  if (window.electronAPI) {
    isPlaying.value ? window.electronAPI.player.pause() : window.electronAPI.player.resume()
  }
}

const playPrevFromPlaylist = () => {
  // 前端完全控制上一首逻辑
  const prev = sdk.getPrevFromPlaylist()
  if (prev) {
    console.log('Playing previous:', prev)
    
    // 1. 设置当前播放项
    sdk.setPlaylistCurrentByPath(prev.path)
    
    // 2. 更新前端状态
    handlePlayVideo(prev)
    
    // 3. 同步播放列表到主进程（确保状态一致）
    sdk.syncPlaylistToMain()
    
    // 4. 执行播放
    sdk.play(prev)
  }
}

const playNextFromPlaylist = () => {
  // 前端完全控制下一首逻辑
  const next = sdk.getNextFromPlaylist()
  if (next) {
    console.log('Playing next:', next)
    
    // 1. 设置当前播放项
    sdk.setPlaylistCurrentByPath(next.path)
    
    // 2. 更新前端状态
    handlePlayVideo(next)
    
    // 3. 同步播放列表到主进程（确保状态一致）
    sdk.syncPlaylistToMain()
    
    // 4. 执行播放
    sdk.play(next)
  }
}

const stop = () => {
  // 不立即改变 isPlaying，等待主进程响应回来的状态（phase === 'stopped'）
  if (window.electronAPI) {
    window.electronAPI.player.stop()
  }
}

// 控制栏显示/隐藏逻辑已移至 useControlBarAutoHide composable

const onSeekStart = () => {
  console.log('[ControlView] onSeekStart')
  isScrubbing.value = true
  onUserInteraction()
}

const onSeek = (value: number) => {
  // 防止 Element Plus 在接收 model-value 更新时反向触发 input 事件导致的死循环
  // 只有在明确的拖动状态下（mousedown）才接受 seek 输入
  // 修改：点击进度条时可能不会先触发 mousedown (isScrubbing=true)，
  // 但我们仍然应该处理 input 事件来更新 UI，并等待 change 事件提交。
  // 统一走 onUserInput，不直接提交，避免重复 seek。
  
  // FIX: 如果 duration 无效（如尚未加载完成），忽略 seek 输入
  // 这防止 Element Plus 在 duration=0 时因 clamp 触发的自动 input 事件导致死循环 (isAdjusting 卡死)
  if (!duration.value || duration.value <= 0) return

  const clampedValue = Math.max(0, Math.min(duration.value || 0, value))
  console.log('[ControlView] onSeek input', { raw: value, clamped: clampedValue, duration: duration.value, isScrubbing: isScrubbing.value })
  currentTimeAdjustable.onUserInput(clampedValue)
  onUserInteraction()
}

const onSeekEnd = (value: number) => {
  onUserInteraction()
  const clampedValue = Math.max(0, Math.min(duration.value || 0, value))
  console.log('[ControlView] onSeekEnd commit', { raw: value, clamped: clampedValue, duration: duration.value })
  // 使用可调值模式提交最终进度（发送 seek 命令）
  currentTimeAdjustable.onUserCommit(clampedValue)
  // 立即结束拖动状态，不依赖后端的 isSeeking 信号，防止因信号丢失导致进度条卡死
  isScrubbing.value = false
}

// 音量滑块（Element Plus）
const onVolumeSeekStart = () => {
  isVolumeScrubbing.value = true
  onUserInteraction()
}

const onVolumeInput = (value: number) => {
  // 移除 !isVolumeScrubbing 检查，确保点击操作也能生效
  // Element Plus 的 slider 在点击时会触发 input，此时可能尚未触发 mousedown
  onUserInteraction()
  volumeAdjustable.onUserInput(Math.round(value))
}

const onVolumeChangeEnd = (value: number) => {
  onUserInteraction()
  volumeAdjustable.onUserCommit(Math.round(value))
  isVolumeScrubbing.value = false
}

const formatVolumeTooltip = (value: number): string => {
  return `${Math.round(value)}%`
}

const toggleMute = () => {
  if (volume.value > 0) {
    // 静音：直接提交 0
    volumeAdjustable.onUserCommit(0)
  } else {
    // 恢复默认音量（目前简单使用 50%，如需记忆上次音量可在此扩展）
    volumeAdjustable.onUserCommit(50)
  }
}

const unsubs: (() => void)[] = []

onMounted(async () => {
  // 初始化时从主进程加载播放列表状态
  await loadPlaylistFromMain()
  
  if (window.electronAPI) {
    unsubs.push(window.electronAPI.player.onCurrentVideoChanged(handlePlayVideo))
    unsubs.push(window.electronAPI.player.onStatus(handlePlayerState))
    unsubs.push(window.electronAPI.player.onControlBarShow(() => {
      showControls()
    }))
    unsubs.push(window.electronAPI.player.onControlBarScheduleHide(() => {
      if (isPlaying.value && !isLoading.value && !isScrubbing.value) {
        scheduleHide()
      }
    }))
    unsubs.push(window.electronAPI.player.onControlBarHideImmediate(() => {
      controlsVisible.value = false
    }))
    // 监听主进程的播放列表更新事件，确保跨窗口同步
    unsubs.push(window.electronAPI.player.onPlaylistUpdated((items: any[]) => {
      if (items && items.length > 0) {
        const mediaItems = items.map((item) => ({
          name: item.name,
          path: item.path,
          startTime: item.startTime
        }))
        sdk.setPlaylist(mediaItems)
        refreshPlaylistFromSDK()
      } else {
        sdk.clearPlaylist()
        refreshPlaylistFromSDK()
      }
    }))
    // 监听轨道列表变化事件，收到后刷新 tracks 列表
    if (window.electronAPI.player.onTracksChanged) {
      unsubs.push(window.electronAPI.player.onTracksChanged(() => {
        refreshTracks().catch((error) => {
          console.error('[ControlView] Failed to refresh tracks on tracks-changed event:', error)
        })
      }))
    }
  }
})

onUnmounted(() => {
  // 清理自动隐藏 composable 的资源
  cleanupAutoHide()
  
  unsubs.forEach(unsub => unsub())
})
</script>

<style scoped>
.control-view {
  width: 100%;
  height: 100vh;
  background: transparent;
  display: flex;
  flex-direction: column;
  contain: layout style paint;
  transform: translateZ(0);
  will-change: transform;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  transition: background 0.3s ease;
}

/* 当控制栏隐藏时，同时隐藏鼠标指针，获得纯净观感 */
.control-view.controls-hidden {
  cursor: none;
}

.video-not-ready {
  background: rgba(0, 0, 0, 1);
}

/* Removed .control-view.video-not-ready background to prevent blocking video window */

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  pointer-events: auto;
}

.loading-content {
  padding: 0.75rem 1.5rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.85);
}

.loading-text {
  color: #ffffff;
  font-size: 0.9rem;
}

.header {
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  -webkit-app-region: drag;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 1;
  transition: opacity 0.3s ease;
  will-change: opacity;
  position: relative;
  z-index: 20;
}

/* 控制栏隐藏时，优化性能：减少 backdrop-filter 的性能消耗 */
.control-view.controls-hidden .header {
  /* 隐藏时使用更简单的背景，减少 backdrop-filter 的性能消耗 */
  backdrop-filter: blur(5px);
  /* 或者完全禁用 backdrop-filter */
  /* backdrop-filter: none; */
  /* background: rgba(0, 0, 0, 0.6); */
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
  pointer-events: auto;
}

.title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: center;
}

.window-btn {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  background-color: #808080;
  opacity: 0.9;
  transition: opacity 0.15s ease;
}

.window-btn.close {
  background-color: #ff5f57;
}

.window-btn.minimize {
  background-color: #febc2e;
}

.window-btn.maximize {
  background-color: #28c840;
}

.window-btn:hover {
  opacity: 1;
}

.settings-panel {
  position: absolute;
  top: 40px;
  right: 0;
  bottom: 80px;
  width: 280px;
  background: rgba(0, 0, 0, 0.85);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  will-change: transform, opacity;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  color: #fff;
  font-size: 0.9rem;
}

.settings-title {
  font-weight: 500;
}

.settings-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-size: 1.1rem;
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-section.settings-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.settings-label {
  color: #ddd;
  font-size: 0.85rem;
}

.settings-select {
  width: 100%;
}

.settings-hint {
  color: #888;
  font-size: 0.8rem;
}

.settings-toggle {
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #ddd;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.settings-toggle:hover {
  background: rgba(255, 255, 255, 0.12);
}

.settings-toggle.active {
  background: rgba(79, 70, 229, 0.5);
  border-color: #4f46e5;
  color: #fff;
}

.playlist-panel {
  position: absolute;
  top: 40px;
  right: 0;
  bottom: 80px;
  width: 280px;
  background: rgba(0, 0, 0, 0.85);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  /* 移除 backdrop-filter 以提高性能，特别是在 8K 视频上 */
  /* backdrop-filter: blur(12px); */
  /* 使用 will-change 优化渲染性能 */
  will-change: transform, opacity;
}

.playlist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  color: #fff;
  font-size: 0.9rem;
}

.error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  pointer-events: auto;
  z-index: 10;
}

.error-content {
  max-width: 60%;
  padding: 1rem 1.75rem;
  border-radius: 12px;
  background: rgba(255, 59, 48, 0.15);
  border: 1px solid rgba(255, 95, 87, 0.7);
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.55);
  color: #ffe9e7;
}

.error-title {
  font-weight: 600;
  margin-bottom: 6px;
  font-size: 1rem;
}

.error-message {
  word-break: break-word;
  font-size: 0.9rem;
  line-height: 1.5;
}

.playlist-title {
  font-weight: 500;
}

.playlist-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-size: 1.1rem;
}

.playlist-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 8px;
}

.playlist-empty {
  padding: 12px;
  font-size: 0.85rem;
  color: #aaa;
}

.playlist-item {
  padding: 8px 12px;
  font-size: 0.85rem;
  color: #ddd;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: all 0.2s ease;
}

.playlist-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.playlist-item.active {
  background: #4f46e5;
  color: #fff;
}

.playlist-item.dragging {
  opacity: 0.5;
}

.playlist-item.drag-over {
  background: rgba(79, 70, 229, 0.2);
  border-top: 2px solid #4f46e5;
}

.playlist-item-content {
  flex: 1;
  margin-right: 8px;
  min-width: 0;
}

.playlist-item-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-item-path {
  margin-top: 2px;
  font-size: 0.75rem;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-item-remove {
  width: 20px;
  height: 20px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-radius: 50%;
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.playlist-item:hover .playlist-item-remove {
  opacity: 1;
}

.playlist-item-remove:hover {
  background: rgba(255, 59, 48, 0.8);
  transform: scale(1.1);
}

.playlist-item.active .playlist-item-remove {
  background: rgba(255, 255, 255, 0.2);
}

.playlist-item.active .playlist-item-remove:hover {
  background: rgba(255, 59, 48, 0.8);
}

.playback-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: block;
  padding: 0;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  opacity: 1;
  transition: opacity 0.3s ease;
  will-change: opacity;
  z-index: 20;
  transform: none !important;
}

/* 只隐藏控制栏，不影响其他元素（如 loading-overlay、playlist-panel） */
.control-view.controls-hidden .header,
.control-view.controls-hidden .playback-controls {
  opacity: 0;
  pointer-events: none;
  /* 隐藏时禁用 transition，提升性能 */
  transition: none;
}

/* 确保 loading-overlay 和 playlist-panel 始终可见（如果它们需要显示） */
.control-view.controls-hidden .loading-overlay,
.control-view.controls-hidden .settings-panel,
.control-view.controls-hidden .playlist-panel {
  opacity: 1;
  pointer-events: auto;
}

.control-bar {
  width: 100%;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 0;
  overflow: hidden;
}

.progress-container {
  padding: 6px 12px 0;
  margin-bottom: 0;
}

/* Element Plus Slider 自定义样式 */
.progress-slider {
  width: 100%;
}

.progress-slider :deep(.el-slider__runway) {
  height: 6px;
  background-color: #3a3a3a;
  border-radius: 3px;
  margin: 0;
}

.progress-slider :deep(.el-slider__bar) {
  height: 6px;
  background-color: #ffffff;
  border-radius: 3px;
}

.progress-slider :deep(.el-slider__button-wrapper) {
  width: 16px;
  height: 16px;
  top: 0;
  margin-top: -7px;
}

.progress-slider :deep(.el-slider__button) {
  width: 16px;
  height: 16px;
  border: none;
  background-color: #ffffff;
  box-shadow: 0 2px 8px rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.progress-slider :deep(.el-slider__button):hover {
  width: 18px;
  height: 18px;
  box-shadow: 0 2px 12px rgba(255, 255, 255, 0.5);
}

.progress-slider :deep(.el-slider__button-wrapper):hover {
  width: 18px;
  height: 18px;
}

.progress-slider :deep(.el-slider__button-wrapper):hover .el-slider__button {
  width: 18px;
  height: 18px;
}

/* Tooltip 样式 */
.progress-slider :deep(.el-slider__button-wrapper .el-tooltip__trigger) {
  width: 100%;
  height: 100%;
}

.progress-slider :deep(.el-tooltip__popper) {
  background-color: rgba(0, 0, 0, 0.85);
  border: none;
  color: #ffffff;
  font-size: 0.85rem;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  padding: 4px 8px;
  border-radius: 4px;
}

.time-display {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2px;
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}

.time-current {
  color: #ffffff;
  font-weight: 500;
}

.time-total {
  color: #ccc;
  font-weight: 400;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 10px;
  gap: 12px;
}

.control-buttons {
  display: flex;
  justify-content: center;
  gap: 1rem;
}

.btn-control {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #ffffff;
  border-radius: 0;
  font-size: 1.2rem;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-control:hover {
  background: rgba(255, 255, 255, 0.08);
}

.btn-control:active {
  transform: scale(0.95);
}

.btn-control.play-pause {
  width: 40px;
  height: 40px;
  font-size: 1.5rem;
}

.progress-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.time-info {
  display: flex;
  justify-content: space-between;
  color: #ccc;
  font-size: 0.875rem;
}


.volume-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.control-right {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ccc;
  justify-content: flex-end;
}


.volume-icon {
  font-size: 0.9rem;
}

.volume-percent {
  font-size: 0.85rem;
  min-width: 40px;
  text-align: right;
  color: #ccc;
}

.volume-slider-el {
  width: 80px;
}

.volume-slider-el :deep(.el-slider__runway) {
  height: 4px;
  background-color: #3a3a3a;
  border-radius: 2px;
  margin: 0;
}

.volume-slider-el :deep(.el-slider__bar) {
  height: 4px;
  background-color: #ffffff;
  border-radius: 2px;
}

.volume-slider-el :deep(.el-slider__button-wrapper) {
  width: 12px;
  height: 12px;
  top: 0;
  margin-top: -4px; /* 圆心对齐 4px 轨道中线 */
}

.volume-slider-el :deep(.el-slider__button) {
  width: 12px;
  height: 12px;
  border: none;
  background-color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: all 0.2s;
  margin-top: -7px;
}
</style>
