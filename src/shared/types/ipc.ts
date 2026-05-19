// ══════════════════════════════════════════════
// Shared IPC types — used by main, preload, and renderer
// ══════════════════════════════════════════════

import type { PlaybackPhase } from './playback'

/** Stable playback identity attached to a main-process playback session */
export interface PlaybackIdentity {
  requestId: string
  sessionId: number
  generation: number
}

/** Player status broadcast from main → renderer */
export interface PlayerStatus {
  phase: PlaybackPhase
  currentTime: number
  duration: number
  volume: number
  path: string | null
  isSeeking: boolean
  isNetworkBuffering: boolean
  networkBufferingPercent: number
  bufferRanges: Array<{ start: number; end: number }>
  errorMessage?: string
  /** Whether the player is switching between videos (managed by backend) */
  isSwitching?: boolean
  hdrEnabled?: boolean
  /** Ownership metadata for rejecting stale async results across play sessions */
  requestId?: string
  sessionId?: number
  generation?: number
}

/** Audio/subtitle/video track info from mpv */
export interface TrackInfo {
  id: number
  type: 'audio' | 'sub' | 'video'
  lang?: string
  title?: string
  codec?: string
  selected: boolean
  source: 'internal' | 'external'
}

/** Playlist item passed between main and renderer */
export interface PlaylistItem {
  name: string
  path: string
  startTime?: number
}

/** Watch progress record */
export interface WatchProgress {
  mediaPath: string
  currentTime: number
  duration: number
  lastWatched: number
  status: 'unwatched' | 'watching' | 'completed'
}

/** Media info returned by playerProperty.getMediaInfo() */
export interface MediaInfo {
  video: { width: number; height: number; codec: string; pixFmt: string; fps: number }
  audio: { codec: string; channels: number; sampleRate: number }
  file: { size: number; duration: number }
  chapters: Array<{ title: string; time: number }>
}

/** Thumbnail ready event payload */
export interface ThumbnailReady {
  filePath: string
  thumbnailPath: string
}

/** Backend-persisted settings (flat structure matching IPC settings:get/set) */
export interface BackendSettings {
  hwdec: string
  hwdecCodec: string
  rememberProgress: boolean
  autoLoadSubtitle: boolean
  autoLoadAudio: boolean
  defaultSpeed: number
  chapterNav: boolean
  windowFollowVideo: boolean
  autoThumbnail: boolean
  httpProxy: string
  bufferSize: number
  mpvOptions: string
  logLevel: string
  cacheSize: number
  language: string
  preferredLang: string
  videoEnhancement: string
}

/** Theme preference */
export interface ThemeState {
  preference: 'system' | 'light' | 'dark'
  resolved: 'light' | 'dark'
}

/** Audio equalizer state */
export const EQUALIZER_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export const EQ_BAND_COUNT = 10
export const EQ_GAIN_MIN = -12
export const EQ_GAIN_MAX = 12

export interface EqualizerState {
  enabled: boolean
  bands: number[]              // 10 values, -12 ~ +12 dB
  currentPreset: string        // 'flat' | 'pop' | 'rock' | 'classical' | 'jazz' | 'vocal' | 'custom'
  customPresets: Record<string, number[]>
}

export const DEFAULT_EQUALIZER_STATE: EqualizerState = {
  enabled: false,
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  currentPreset: 'flat',
  customPresets: {},
}

export const BUILTIN_PRESETS: Record<string, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pop: [1, 3, 4, 5, 3, 1, -1, -1, 1, 1],
  rock: [4, 3, 2, 1, -1, -2, 1, 3, 4, 4],
  classical: [2, 2, 1, 1, 1, 1, 2, 2, 3, 4],
  jazz: [3, 2, 1, 2, 3, 2, 1, 2, 3, 3],
  vocal: [-2, -2, -1, 1, 3, 4, 3, 1, -1, -2],
}

/** Mount path resource event */
export interface MountPathScanned {
  id: string
  resources: any[]
  resourceCount?: number
}
