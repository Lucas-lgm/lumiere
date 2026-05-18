// src/main/application/core/MediaPlayer.ts

import { EventEmitter } from 'events'
import type { Media } from '../../../shared/types/playback'
import type { PlaybackPhase } from '../../../shared/types/playback'

/**
 * Universal player status interface
 *
 * Unified status representation, used for:
 * - Return value of MediaPlayer interface methods
 * - Cross-process communication (replaces the previous PlayerState)
 * - State machine status output
 */
export interface PlayerStatus {
  phase: PlaybackPhase
  currentTime: number
  duration: number
  volume: number
  path: string | null
  isPaused: boolean
  isSeeking: boolean
  isNetworkBuffering: boolean
  networkBufferingPercent: number
  bufferRanges: Array<{ start: number; end: number }>
  errorMessage?: string
  isSwitching?: boolean
  hdrEnabled?: boolean
  requestId?: string
  sessionId?: number
  generation?: number
}

/**
 * Player track information (audio / subtitle / video)
 *
 * This structure is used to pass mpv track-list data between the core layer,
 * application layer, and IPC, enabling the frontend to display and select
 * audio tracks and subtitles.
 */
export interface PlayerTrack {
  /** mpv internal track id (used by properties like aid/sid) */
  id: number
  /** Track type: audio / sub / video */
  type: 'audio' | 'sub' | 'video'
  /** Language code (e.g. zh-CN, en, ja), if available */
  lang?: string
  /** Track title (e.g. “Simplified Chinese subtitle”, “English 5.1 audio”), if available */
  title?: string
  /** Codec (e.g. subrip, ass, hdmv_pgs_subtitle), if available */
  codec?: string
  /** Whether this is the currently selected track */
  selected: boolean
  /** Track source: internal (embedded) or external file */
  source: 'internal' | 'external'
}

/**
 * Pre-initialization options for the player engine.
 *
 * These are set once before the player's first initialisation and
 * configure engine-level behaviours (hardware decoding, language
 * preference, extra options) that cannot be changed at runtime via
 * property setting.
 */
export interface PlayerInitSettings {
  hwdec?: string
  alang?: string
  slang?: string
  extraOptions?: string[]
  msgLevel?: string
}

/**
 * Media player service interface (core playback contract for the application, held directly by VideoPlayerApp)
 */
export interface MediaPlayer extends EventEmitter {
  // Playback control
  /**
   * Play media
   * @param media Media object
   * @param startTime Start playback time (seconds, optional). If provided, starts from the specified time.
   */
  play(media: Media, startTime?: number, startPaused?: boolean): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  /**
   * Get the track list for the current media (including audio / subtitle / video)
   */
  getTracks(): Promise<PlayerTrack[]>
  /**
   * Switch audio track (pass null or invalid id to disable audio / return to default behavior)
   */
  setAudioTrack(trackId: number | null): Promise<void>
  /**
   * Switch subtitle track (pass null or invalid id to disable subtitles)
   */
  setSubtitleTrack(trackId: number | null): Promise<void>
  
  // Status change events (used for status update optimization)
  /**
   * Listen for player status changes
   * When the player status updates, a PlayerStatus event is emitted directly
   * This is the primary status update event, more direct than session-change
   */
  onStatusChange(listener: (status: PlayerStatus) => void): void
  
  /**
   * Remove a status change listener
   */
  offStatusChange(listener: (status: PlayerStatus) => void): void
  
  /**
   * Set window size (for window size synchronization)
   * @param width Window width (physical pixels)
   * @param height Window height (physical pixels)
   */
  setWindowSize(width: number, height: number): Promise<void>
  
  // Player-specific features
  /**
   * Set HDR enabled status
   * @param enabled Whether to enable HDR
   */
  setHdrEnabled(enabled: boolean): void
  
  /**
   * Send a key press event
   * @param key Key name
   */
  sendKey(key: string): Promise<void>

  /**
   * Execute an mpv command
   * @param args Command arguments array, e.g. ['frame-step'] or ['screenshot']
   */
  command(...args: string[]): Promise<void>

  /**
   * Debug: dump video state information
   */
  debugVideoState(): Promise<void>
  
  /**
   * Debug: dump HDR status information
   */
  debugHdrStatus(): Promise<void>

  /**
   * Get a player property (generic property read interface)
   * @param name Property name
   */
  getProperty(name: string): Promise<any>

  /**
   * Set a player property (generic property write interface)
   * @param name Property name
   * @param value Property value
   */
  setProperty(name: string, value: any): Promise<void>

  /**
   * Set native window handle (platform-specific ID, for video render target binding)
   * @param windowId Native window handle
   */
  setWindowId(windowId: number): void

  /**
   * Ensure the player is initialized and ready to accept playback commands.
   * Call before the first play() to pre-warm the underlying engine.
   */
  ensureReady(): Promise<void>

  /**
   * Set pre-initialization options (before the player engine starts).
   *
   * Called once during application construction to configure options
   * that must be set before the player's first initialisation.  The
   * options are player-engine-specific and may be partially or fully
   * ignored by implementations that do not support them.
   */
  setInitSettings(settings: PlayerInitSettings): void

  // Lifecycle
  cleanup(): Promise<void>
}
