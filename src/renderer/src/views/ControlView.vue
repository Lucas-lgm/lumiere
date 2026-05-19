<template>
  <div
    class="control-view"
    :class="{
      'controls-hidden': !controlsVisible,
      'video-not-ready': !isVideoReady,
      'pip-mode': isPipMode,
      'pip-hover': pipHover,
      'pip-dragging': pipDragging
    }"
    @mouseenter="onRootMouseEnter"
    @mouseleave="onRootMouseLeave"
    @mousedown="onRootMouseDown"
    @dblclick="onRootDblClick"
  >
    <PlayerTopBar v-if="!isPipMode" />
    <PlayerHud />
    <PlayerLoadingOverlay />

    <!-- ═══ Panels (SlidePanel-based, mutually exclusive) ═══ -->
    <SubtitlePanel
      :visible="activePanel === 'subtitle'"
      context="player"
      @close="closePanel"
    />
    <PicturePanel
      :visible="activePanel === 'picture'"
      context="player"
      :is-hdr="isHdr"
      :hdr-enabled="hdrEnabled"
      @close="closePanel"
    />
    <EqualizerPanel
      :visible="activePanel === 'equalizer'"
      context="player"
      @close="closePanel"
    />
    <MediaInfoPanel
      :visible="activePanel === 'mediaInfo'"
      context="player"
      :media-path="currentPath || ''"
      :video-ready="isVideoReady"
      @close="closePanel"
    />
    <PlaylistPanel
      :visible="activePanel === 'playlist'"
      context="player"
      :current-path="currentPath || ''"
      @close="closePanel"
      @play-item="playFromPlaylist"
    />
    <CropPanel
      :visible="activePanel === 'crop'"
      context="player"
      :video-width="actualVideoWidth"
      :video-height="actualVideoHeight"
      @close="closePanel"
    />
    <AnimExportPanel
      :visible="activePanel === 'animExport'"
      context="player"
      @close="closePanel"
    />
    <ErrorOverlay
      :visible="!!playerError"
      :error-type="playerErrorType"
      :error-message="playerError || ''"
      :file-path="currentPath || ''"
      @retry="retryPlay"
      @soft-decode="retrySoftDecode"
      @relocate="relocateFile"
      @remove="removeCurrentFromPlaylist"
    />

    <PlayerPipOverlay v-if="isPipMode" />

    <!-- ═══ Bottom bar: gradient + progress + controls (normal mode) ═══ -->
    <main
      v-else
      class="p-ctrl"
      @mouseenter="onControlBarEnter"
      @mouseleave="onControlBarLeave"
    >
      <PlayerProgressBar />
      <PlayerControlRow />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, provide, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import SubtitlePanel from '../components/panels/SubtitlePanel.vue'
import PicturePanel from '../components/panels/PicturePanel.vue'
import MediaInfoPanel from '../components/panels/MediaInfoPanel.vue'
import PlaylistPanel from '../components/panels/PlaylistPanel.vue'
import CropPanel from '../components/panels/CropPanel.vue'
import AnimExportPanel from '../components/panels/AnimExportPanel.vue'
import EqualizerPanel from '../components/panels/EqualizerPanel.vue'
import ErrorOverlay from '../components/player/ErrorOverlay.vue'
import PlayerTopBar from '../components/player/PlayerTopBar.vue'
import PlayerHud from '../components/player/PlayerHud.vue'
import PlayerLoadingOverlay from '../components/player/PlayerLoadingOverlay.vue'
import PlayerPipOverlay from '../components/player/PlayerPipOverlay.vue'
import PlayerProgressBar from '../components/player/PlayerProgressBar.vue'
import PlayerControlRow from '../components/player/PlayerControlRow.vue'
import { useControlBarAutoHide } from '../composables/useControlBarAutoHide'
import { useAdjustableValue } from '../composables/useAdjustableValue'
import { usePanelManager, type PanelName } from '../composables/usePanelManager'
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts'
import { useTrackpadGestures } from '../composables/useTrackpadGestures'
import { useSettings } from '../composables/useSettings'
import { useChapter } from '../composables/useChapter'
import { usePlayerError } from '../composables/usePlayerError'
import { useABLoop } from '../composables/useABLoop'
import { useProgressBar, formatTime } from '../composables/useProgressBar'
import { useVolumeControl } from '../composables/useVolumeControl'
import { useSpeedControl } from '../composables/useSpeedControl'
import { usePipMode } from '../composables/usePipMode'
import { useMediaMeta } from '../composables/useMediaMeta'
import { getPlayerSDK } from '../core/sdk'
import {
  playerCoreKey, playerTimelineKey, playerControlsKey,
  playerPanelKey, playerOverlayKey
} from '../composables/playerInjectKeys'
import type { PlayerStatus, TrackInfo, PlaylistItem } from '../../../shared/types/ipc'

const { t } = useI18n()
const sdk = getPlayerSDK()

// ═══════════════════════════════════════════
// Shared state
// ═══════════════════════════════════════════

const isPlaying = ref(false)
let lastPlayerPhase: string = 'idle'
const currentVideoName = ref<string>('')
const currentPath = ref<string | null>(null)
const isLoading = ref(false)
const isSeeking = ref(false)
const isNetworkBuffering = ref(false)
const networkBufferingPercent = ref<number | null>(null)
const isSwitchingVideo = ref(false)
const isVideoReady = ref(false)
const isMaximized = ref(false)
const isFullscreen = ref(false)
const isScrubbing = ref(false)
let lastSessionId: number | null = null

// Timeline adjustable value
const currentTimeAdjustable = useAdjustableValue<number>({
  initial: 0,
  justChangedWindowMs: 1000,
  sendOnInput: false,
  sendCommand: (val: number) => {
    if (window.electronAPI) {
      const dur = typeof duration.value === 'number' ? duration.value : 0
      const target = dur > 0 ? Math.max(0, Math.min(dur, val)) : val
      window.electronAPI.player.seek(target)
    }
  }
})
const currentTime = currentTimeAdjustable.value
const duration = ref(0)

const playlist = ref<PlaylistItem[]>([])
const tracks = ref<TrackInfo[]>([])
const audioTracks = computed(() => tracks.value.filter(tr => tr.type === 'audio'))
const subtitleTracks = computed(() => tracks.value.filter(tr => tr.type === 'sub'))
const selectedAudioTrackId = ref<number | null>(null)
const selectedSubtitleTrackId = ref<number | 'none' | null>(null)

// ═══════════════════════════════════════════
// Composables
// ═══════════════════════════════════════════

// Progress bar hover state bridge (needed by autoHide, but progHover is only created in useProgressBar)
const _progHoverBridge = ref(false)

// Panel manager
const { activePanel, isPanelOpen, togglePanel, closePanel } = usePanelManager()

watch(isPanelOpen, (open) => {
  const prop = window.electronAPI?.playerProperty
  if (!prop) return
  prop.set('sub-margin-x', open ? 260 : 0)
})

// Auto-hide
const autoHide = useControlBarAutoHide({
  isPlaying,
  isLoading,
  isScrubbing,
  isPanelOpen,
  isProgressHovering: _progHoverBridge
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

// Volume control
const {
  volumeAdjustable,
  volume,
  isVolumeScrubbing,
  volumePercent,
  volumeIconName,
  onVolumeMouseDown,
  toggleMute,
  changeVolume
} = useVolumeControl(onUserInteraction)

// Progress bar
const {
  progHover,
  progHoverPercent,
  progHoverTime,
  bufferRanges,
  bufferPercents,
  progressPercent,
  progWrapRef,
  hoverThumbnail,
  thumbLoading,
  onProgressMouseDown,
  onProgressHoverMove
} = useProgressBar({
  duration,
  currentTime,
  currentTimeAdjustable,
  currentPath,
  isScrubbing,
  onUserInteraction
})

// Sync progHover to bridge ref (for autoHide use)
watch(progHover, (v) => { _progHoverBridge.value = v })

// Speed control
const {
  speedAdjustable,
  playbackSpeed,
  speedPresets,
  speedPickerOpen,
  setSpeed,
  toggleSpeedPicker,
  selectSpeed,
  onSpeedSliderInput,
  fetchSpeed
} = useSpeedControl(onUserInteraction)

// Chapter
const {
  rawChapters,
  chapters,
  hoveredChapter,
  hoveredChapterIndex,
  hoveredChapterEndTime,
  chapterTooltipLeft,
  onChapterHover,
  onChapterLeave,
  onChapterClick,
  chapterPrev,
  chapterNext,
  fetchChapters
} = useChapter({
  duration,
  currentTime,
  onUserInteraction,
  commitSeek: (time: number) => currentTimeAdjustable.onUserCommit(time)
})

// AB loop
const { abLoop, fetchAbLoop, toggleAbLoop, formatAbLoopHud, resetAbLoop } = useABLoop()
const abLoopActive = computed(() => abLoop.value.a !== null)

// Media metadata
const {
  isHdr,
  hdrEnabled,
  actualVideoWidth,
  actualVideoHeight,
  mediaMetaFetched,
  detectHdr,
  resetMetaGuard
} = useMediaMeta()

// ═══════════════════════════════════════════
// Playlist management
// ═══════════════════════════════════════════

function refreshPlaylistFromSDK() {
  playlist.value = sdk.getPlaylist().map((m) => ({
    name: m.name,
    path: m.path,
    startTime: m.startTime
  }))
}

// Player error (needs playlist + sdk refs)
const {
  playerError,
  playerErrorType,
  retryPlay,
  retrySoftDecode,
  relocateFile,
  removeCurrentFromPlaylist
} = usePlayerError({
  currentPath,
  currentVideoName,
  sdk,
  playlist,
  refreshPlaylist: refreshPlaylistFromSDK,
  playNext: () => playNextFromPlaylist()
})

// PIP mode
const {
  isPipMode,
  pipHover,
  pipDragging,
  togglePipMode,
  onRootMouseEnter,
  onRootMouseLeave,
  onRootMouseDown,
  onRootDblClick,
  closePip,
  returnFromPip
} = usePipMode({
  isPlaying,
  togglePlayPause: () => togglePlayPause()
})


// ═══════════════════════════════════════════
// Playback actions
// ═══════════════════════════════════════════

const togglePlayPause = () => {
  onUserInteraction()
  if (window.electronAPI) {
    isPlaying.value ? window.electronAPI.player.pause() : window.electronAPI.player.resume()
  }
}

function seekRelative(delta: number) {
  if (!duration.value || duration.value <= 0) return
  onUserInteraction()
  const target = Math.max(0, Math.min(duration.value, currentTime.value + delta))
  currentTimeAdjustable.onUserCommit(target)
}

const toggleFullscreen = () => {
  controlsVisible.value = false
  if (window.electronAPI) {
    window.electronAPI.window.toggleFullscreen()
  }
}

const handleWindowAction = (action: 'close' | 'minimize' | 'maximize') => {
  if (window.electronAPI) {
    window.electronAPI.window.action(action)
  }
}

function backToLibrary() {
  if (window.electronAPI) {
    window.electronAPI.player.quit()
  }
}

function openFile() {
  if (window.electronAPI?.fileSystem) {
    window.electronAPI.fileSystem.selectVideoFile()
  }
}

async function pasteUrl() {
  try {
    const text = await navigator.clipboard.readText()
    if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('rtsp://'))) {
      const name = text.split('/').pop() || text
      sdk.play({ name, path: text })
    }
  } catch { /* Clipboard read failed */ }
}

// ═══════════════════════════════════════════
// Playlist navigation
// ═══════════════════════════════════════════

const playFromPlaylist = (item: PlaylistItem) => {
  sdk.setPlaylistCurrentByPath(item.path)
  handlePlayVideo(item)
  sdk.play({ name: item.name, path: item.path, startTime: item.startTime })
}

const playPrevFromPlaylist = () => {
  const prev = sdk.getPrevFromPlaylist()
  if (prev) {
    sdk.setPlaylistCurrentByPath(prev.path)
    handlePlayVideo(prev)
    sdk.play(prev)
  }
}

const playNextFromPlaylist = () => {
  const next = sdk.getNextFromPlaylist()
  if (next) {
    sdk.setPlaylistCurrentByPath(next.path)
    handlePlayVideo(next)
    sdk.play(next)
  }
}

// ═══════════════════════════════════════════
// Track management
// ═══════════════════════════════════════════

const refreshTracks = async () => {
  try {
    const result = await sdk.getTracks()
    if (Array.isArray(result)) {
      tracks.value = result as TrackInfo[]
      const currentAudio = audioTracks.value.find(tr => tr.selected) || null
      const currentSub = subtitleTracks.value.find(tr => tr.selected) || null
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

function switchAudioTrack(id: number) {
  selectedAudioTrackId.value = id
  sdk.setAudioTrack(id)
}

// ═══════════════════════════════════════════
// Resume hint
// ═══════════════════════════════════════════

const resumeHint = ref<string | null>(null)

async function fetchResumeHint() {
  if (!currentPath.value || !window.electronAPI?.watchProgress) return
  try {
    const progress = await window.electronAPI.watchProgress.get(currentPath.value)
    if (progress && progress.status === 'watching' && progress.currentTime > 0) {
      resumeHint.value = formatTime(progress.currentTime)
    } else {
      resumeHint.value = null
    }
  } catch {
    resumeHint.value = null
  }
}

// ═══════════════════════════════════════════
// Video switch handler
// ═══════════════════════════════════════════

const handlePlayVideo = (file: { name: string; path: string }) => {
  currentVideoName.value = file.name
  currentPath.value = file.path
  playerError.value = null
  isVideoReady.value = false
  isScrubbing.value = false
  isSeeking.value = false
  isNetworkBuffering.value = false
  networkBufferingPercent.value = null
  currentTimeAdjustable.reset(0)
  duration.value = 0
  rawChapters.value = []
  resetAbLoop()
  resetMetaGuard()
  // Reset all picture adjustments when switching videos (consistent with IINA/VLC)
  const propApi = window.electronAPI?.playerProperty
  if (propApi) {
    propApi.set('vf', '')
    propApi.set('video-rotate', 0)
    propApi.set('brightness', 0)
    propApi.set('contrast', 0)
    propApi.set('saturation', 0)
    propApi.set('hue', 0)
    propApi.set('sharpen', 0)
    propApi.set('gamma', 0)
  }
  isLoading.value = true
  fetchResumeHint()
  refreshTracks().catch((error) => {
    console.error('[ControlView] Failed to refresh tracks on handlePlayVideo:', error)
  })
}

// ═══════════════════════════════════════════
// Player status handler (central orchestration)
// ═══════════════════════════════════════════

const handlePlayerState = (status: PlayerStatus) => {
  // Session-change detection + stale-status rejection
  const incomingSessionId = typeof status.sessionId === 'number' ? status.sessionId : null
  if (incomingSessionId !== null && incomingSessionId !== lastSessionId) {
    if (lastSessionId !== null && incomingSessionId < lastSessionId) {
      // Stale status from an older session — drop silently
      return
    }
    lastSessionId = incomingSessionId
    // Reset duration and time to prevent cross-session leakage
    duration.value = 0
    currentTimeAdjustable.reset(0)
  }

  const wasSeeking = isSeeking.value

  isSwitchingVideo.value = !!status.isSwitching
  if (typeof status.hdrEnabled === 'boolean') hdrEnabled.value = status.hdrEnabled

  isSeeking.value = !!status.isSeeking
  isNetworkBuffering.value = !!status.isNetworkBuffering
  networkBufferingPercent.value =
    typeof status.networkBufferingPercent === 'number' ? status.networkBufferingPercent : null
  if (Array.isArray(status.bufferRanges)) {
    bufferRanges.value = status.bufferRanges
  }
  isLoading.value = status.phase === 'loading' || isSeeking.value || isNetworkBuffering.value
  const wasPlaying = isPlaying.value
  isPlaying.value = status.phase === 'playing'

  if (status.phase === 'error') {
    playerError.value = status.errorMessage || t('player.error.playbackError')
    currentVideoName.value = `${t('player.error.playbackError')}: ${playerError.value}`
  } else {
    playerError.value = null
  }

  isVideoReady.value = status.phase === 'playing' || status.phase === 'paused'
  if (typeof status.path === 'string') currentPath.value = status.path

  handlePlayerStateChange(wasPlaying)

  if (typeof status.duration === 'number' && status.duration > 0) {
    duration.value = status.duration
  }

  if (status.phase === 'ended') {
    if (duration.value > 0) currentTimeAdjustable.applyServerState(duration.value)
    isPlaying.value = false
    if (lastPlayerPhase === 'playing') playNextFromPlaylist()
  }

  lastPlayerPhase = status.phase || 'idle'

  if (wasSeeking && !isSeeking.value && isScrubbing.value) {
    isScrubbing.value = false
    if (typeof status.currentTime === 'number') currentTimeAdjustable.reset(status.currentTime)
  }

  if (!isScrubbing.value && !isSeeking.value && currentTimeAdjustable.isAdjusting) {
    console.warn('[ControlView] Auto-correcting stuck adjusting state')
    currentTimeAdjustable.forceEndAdjusting()
  }

  if (typeof status.currentTime === 'number' && !isScrubbing.value && !isSeeking.value && status.phase !== 'ended') {
    currentTimeAdjustable.applyServerState(status.currentTime)
  }

  if (typeof status.volume === 'number') {
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

  if ((status.phase === 'playing' || status.phase === 'paused') && duration.value > 0) {
    refreshTracks().catch((error) => {
      console.error('[ControlView] Failed to refresh tracks on state change:', error)
    })
  }
}

// ═══════════════════════════════════════════
// Keyboard & trackpad
// ═══════════════════════════════════════════

const { settings: appSettings } = useSettings()

useKeyboardShortcuts(playbackSpeed, {
  onTogglePlayPause: togglePlayPause,
  onSeekRelative: seekRelative,
  onVolumeChange: changeVolume,
  onToggleMute: toggleMute,
  onToggleFullscreen: toggleFullscreen,
  onPlayPrev: playPrevFromPlaylist,
  onPlayNext: playNextFromPlaylist,
  onSpeedChange: setSpeed,
  onTogglePanel: togglePanel,
  onUserInteraction,
  onBackToLibrary: backToLibrary,
  onOpenFile: openFile,
  onPasteUrl: pasteUrl,
  onChapterPrev: chapterPrev,
  onChapterNext: chapterNext,
  onToggleAbLoop: async () => {
    const result = await toggleAbLoop()
    showHud('loop', formatAbLoopHud(result))
  },
}, {
  isFullscreen,
  chapterNav: computed(() => appSettings.value.chapterNav),
  chapters: rawChapters,
  currentTime: computed(() => currentTime.value),
})

const { hud } = useTrackpadGestures(isPlaying, volume, {
  onSeekRelative: seekRelative,
  onVolumeChange: changeVolume,
  onToggleFullscreen: toggleFullscreen,
  onUserInteraction,
})

let hudTimer: ReturnType<typeof setTimeout> | null = null
function showHud(type: import('../composables/useTrackpadGestures').HudType, value: string) {
  hud.value = { type, value }
  if (hudTimer) clearTimeout(hudTimer)
  hudTimer = setTimeout(() => { hud.value = { type: null, value: '' } }, 1000)
}

// ═══════════════════════════════════════════
// Provide to children (eliminate props drilling)
// ═══════════════════════════════════════════

provide(playerCoreKey, {
  isPlaying, currentTime, duration, isScrubbing, controlsVisible,
  currentVideoName, currentPath, isLoading, isSeeking,
  isNetworkBuffering, networkBufferingPercent,
  isSwitchingVideo, isVideoReady, isMaximized, isFullscreen, resumeHint,
  togglePlayPause, seekRelative, toggleFullscreen,
  onUserInteraction, onControlBarEnter, onControlBarLeave,
  playPrevFromPlaylist, playNextFromPlaylist, handleWindowAction,
})

provide(playerTimelineKey, {
  progHover, progHoverPercent, progHoverTime,
  bufferRanges, bufferPercents, progressPercent, progWrapRef,
  hoverThumbnail, thumbLoading, onProgressMouseDown, onProgressHoverMove,
  chapters, hoveredChapter, hoveredChapterIndex,
  hoveredChapterEndTime, chapterTooltipLeft,
  onChapterHover, onChapterLeave, onChapterClick,
  abLoop,
})

provide(playerControlsKey, {
  volume, volumePercent, volumeIconName,
  onVolumeMouseDown, toggleMute,
  playbackSpeed, speedPresets,
  toggleSpeedPicker, selectSpeed, onSpeedSliderInput,
  audioTracks, selectedAudioTrackId, switchAudioTrack,
})

provide(playerPanelKey, {
  activePanel, togglePanel, closePanel,
})

provide(playerOverlayKey, {
  isPipMode, pipHover, togglePipMode, closePip, returnFromPip,
  hud, showHud, toggleAbLoop, formatAbLoopHud, abLoopActive,
  isHdr, hdrEnabled, actualVideoWidth, actualVideoHeight,
  playerError, playerErrorType,
  retryPlay, retrySoftDecode, relocateFile, removeCurrentFromPlaylist,
})

// ═══════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════

const unsubs: (() => void)[] = []

onMounted(() => {
  if (window.electronAPI) {
    unsubs.push(window.electronAPI.player.onCurrentVideoChanged(handlePlayVideo))
    unsubs.push(window.electronAPI.player.onStatus((status: PlayerStatus) => {
      handlePlayerState(status)
      if (status.phase === 'playing' || status.phase === 'paused') {
        if (!mediaMetaFetched.value) {
          mediaMetaFetched.value = true
          fetchChapters()
          fetchAbLoop()
          detectHdr()
          fetchSpeed()
        }
      }
    }))
    if (window.electronAPI.player.onPlaylistUpdated) {
      unsubs.push(window.electronAPI.player.onPlaylistUpdated(() => refreshPlaylistFromSDK()))
    }
    unsubs.push(window.electronAPI.player.onControlBarShow(() => showControls()))
    unsubs.push(window.electronAPI.player.onControlBarScheduleHide(() => {
      if (isPlaying.value && !isLoading.value && !isScrubbing.value) scheduleHide()
    }))
    unsubs.push(window.electronAPI.player.onControlBarHideImmediate(() => {
      controlsVisible.value = false
    }))
    if (window.electronAPI.player.onTracksChanged) {
      unsubs.push(window.electronAPI.player.onTracksChanged(() => {
        refreshTracks().catch((error) => {
          console.error('[ControlView] Failed to refresh tracks on tracks-changed event:', error)
        })
      }))
    }
    if (window.electronAPI.player.onFullscreenChanged) {
      unsubs.push(window.electronAPI.player.onFullscreenChanged((val) => {
        isFullscreen.value = val
      }))
    }
    if (window.electronAPI.player.onMaximizedChanged) {
      unsubs.push(window.electronAPI.player.onMaximizedChanged((val) => {
        isMaximized.value = val
      }))
    }
    if (window.electronAPI.player.onPropertyChange) {
      unsubs.push(window.electronAPI.player.onPropertyChange(({ name, value }) => {
        switch (name) {
          case 'speed':
            if (typeof value === 'number' && value > 0) speedAdjustable.applyServerState(value)
            break
          case 'chapter-list':
            fetchChapters()
            break
        }
      }))
    }
  }
})

onUnmounted(() => {
  cleanupAutoHide()
  unsubs.forEach(unsub => unsub())
})
</script>

<style scoped>
/* ═══════════════════════════════════════════════════════
   §04 Control Bar — Design-spec-aligned styles
   ═══════════════════════════════════════════════════════ */

:root {
  --accent: var(--p-acc);
}

.control-view {
  --accent: var(--p-acc);
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
}

/* Hide mouse cursor when control bar is hidden for a clean viewing experience */
.control-view.controls-hidden {
  cursor: none;
}

/* ════════════════════════════════════
   Bottom bar (p-ctrl)
   ════════════════════════════════════ */
.p-ctrl {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0 14px 13px;
  background: linear-gradient(to top, rgba(0,0,0,.88) 0%, rgba(0,0,0,.55) 65%, transparent 100%);
  pointer-events: auto;
  -webkit-app-region: no-drag;
  opacity: 1;
  transition: opacity var(--dur-slow) ease, transform var(--dur-slow) ease;
  will-change: opacity, transform;
  z-index: 20;
}

/* ── Auto-hide animation ── */
.control-view.controls-hidden :deep(.p-top) {
  opacity: 0;
  transform: translateY(-10px);
  pointer-events: none;
}

.control-view.controls-hidden .p-ctrl {
  opacity: 0;
  transform: translateY(10px);
  pointer-events: none;
}

/* Ensure overlays stay visible when controls are hidden */
.control-view.controls-hidden :deep(.loading-overlay) {
  opacity: 1;
  pointer-events: auto;
}

/* ════════════════════════════════════
   PIP mode
   ════════════════════════════════════ */

/* Whole PIP window draggable, cursor grab */
.pip-mode {
  -webkit-app-region: drag;
  cursor: grab;
}

.pip-mode.controls-hidden {
  cursor: grab;
}

/* PIP dragging state */
.pip-mode.pip-dragging {
  opacity: 0.9;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .3);
  cursor: grabbing;
}

/* pip-idle-bar hidden when pip-hover */
.pip-hover :deep(.pip-idle-bar) {
  opacity: 0;
}
</style>
