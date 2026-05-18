import { inject, type InjectionKey, type Ref, type ComputedRef } from 'vue'
import type { ChapterInfo } from './useChapter'
import type { HudState, HudType } from './useTrackpadGestures'
import type { ABLoopResult } from './useABLoop'
import type { PanelName } from './usePanelManager'
import type { TrackInfo } from '../../../shared/types/ipc'
import type { HoverThumbnail, BufferRange } from './useProgressBar'

// ── Helper ──

export function injectStrict<T>(key: InjectionKey<T>): T {
  const value = inject(key)
  if (!value) throw new Error(`Missing injection: ${key.description ?? String(key)}`)
  return value
}

// ── Key 1: Core playback state ──

export interface PlayerCoreContext {
  isPlaying: Ref<boolean>
  currentTime: Ref<number>
  duration: Ref<number>
  isScrubbing: Ref<boolean>
  controlsVisible: Ref<boolean>
  currentVideoName: Ref<string>
  currentPath: Ref<string | null>
  isLoading: Ref<boolean>
  isSeeking: Ref<boolean>
  isNetworkBuffering: Ref<boolean>
  networkBufferingPercent: Ref<number | null>
  isSwitchingVideo: Ref<boolean>
  isVideoReady: Ref<boolean>
  isMaximized: Ref<boolean>
  isFullscreen: Ref<boolean>
  resumeHint: Ref<string | null>
  togglePlayPause: () => void
  seekRelative: (delta: number) => void
  toggleFullscreen: () => void
  onUserInteraction: () => void
  onControlBarEnter: () => void
  onControlBarLeave: () => void
  playPrevFromPlaylist: () => void
  playNextFromPlaylist: () => void
  handleWindowAction: (action: 'close' | 'minimize' | 'maximize') => void
}

export const playerCoreKey: InjectionKey<PlayerCoreContext> = Symbol('player-core')

// ── Key 2: Timeline (progress + chapters + AB loop) ──

export interface PlayerTimelineContext {
  progHover: Ref<boolean>
  progHoverPercent: Ref<number>
  progHoverTime: Ref<number>
  bufferRanges: Ref<Array<{ start: number; end: number }>>
  bufferPercents: ComputedRef<BufferRange[]>
  progressPercent: ComputedRef<number>
  progWrapRef: Ref<HTMLDivElement | null>
  hoverThumbnail: Ref<HoverThumbnail | null>
  thumbLoading: Ref<boolean>
  onProgressMouseDown: (e: MouseEvent) => void
  onProgressHoverMove: (e: MouseEvent) => void
  chapters: ComputedRef<ChapterInfo[]>
  hoveredChapter: Ref<ChapterInfo | null>
  hoveredChapterIndex: Ref<number>
  hoveredChapterEndTime: ComputedRef<number>
  chapterTooltipLeft: ComputedRef<number>
  onChapterHover: (ch: ChapterInfo, index: number) => void
  onChapterLeave: () => void
  onChapterClick: (ch: ChapterInfo) => void
  abLoop: Ref<{ a: number | null; b: number | null }>
}

export const playerTimelineKey: InjectionKey<PlayerTimelineContext> = Symbol('player-timeline')

// ── Key 3: Volume + Speed + Audio tracks ──

export interface PlayerControlsContext {
  volume: Ref<number>
  volumePercent: ComputedRef<number>
  volumeIconName: ComputedRef<string>
  onVolumeMouseDown: (e: MouseEvent) => void
  toggleMute: () => void
  playbackSpeed: Ref<number>
  speedPresets: number[]
  toggleSpeedPicker: () => void
  selectSpeed: (speed: number) => void
  onSpeedSliderInput: (e: Event) => void
  audioTracks: ComputedRef<TrackInfo[]>
  selectedAudioTrackId: Ref<number | null>
  switchAudioTrack: (id: number) => void
}

export const playerControlsKey: InjectionKey<PlayerControlsContext> = Symbol('player-controls')

// ── Key 4: Panels ──

export interface PlayerPanelContext {
  activePanel: Ref<PanelName | null>
  togglePanel: (name: PanelName) => void
  closePanel: () => void
}

export const playerPanelKey: InjectionKey<PlayerPanelContext> = Symbol('player-panel')

// ── Key 5: PIP + HUD + Media meta + Error ──

export interface PlayerOverlayContext {
  isPipMode: Ref<boolean>
  pipHover: Ref<boolean>
  togglePipMode: () => void
  closePip: () => void
  returnFromPip: () => void
  hud: Ref<HudState>
  showHud: (type: HudType, value: string) => void
  toggleAbLoop: () => Promise<ABLoopResult>
  formatAbLoopHud: (result: ABLoopResult) => string
  abLoopActive: Ref<boolean>
  isHdr: Ref<boolean>
  hdrEnabled: Ref<boolean>
  actualVideoWidth: Ref<number>
  actualVideoHeight: Ref<number>
  playerError: Ref<string | null>
  playerErrorType: ComputedRef<'codec' | 'not-found' | 'network' | 'generic'>
  retryPlay: () => void
  retrySoftDecode: () => void
  relocateFile: () => void
  removeCurrentFromPlaylist: () => void
}

export const playerOverlayKey: InjectionKey<PlayerOverlayContext> = Symbol('player-overlay')
