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

/** Mount path resource event */
export interface MountPathScanned {
  id: string
  resources: any[]
  resourceCount?: number
}
