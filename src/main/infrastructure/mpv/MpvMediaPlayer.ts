// src/main/infrastructure/mpv/MpvMediaPlayer.ts

import { EventEmitter } from 'events'
import { LibMPVController, isLibMPVAvailable } from './LibMPVController'
import type { MPVStatus } from './types'
import type { MediaPlayer, PlayerStatus, PlayerTrack, PlayerInitSettings } from '../../application/playback/MediaPlayer'
import type { Media } from '../../../../shared/types/playback'
import type { PlaybackPhase } from '../../../../shared/types/playback'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('MpvMediaPlayer')

/**
 * MPV-based media player implementation
 *
 * Note: This implementation requires a window ID to initialize the MPV instance.
 * Window-related settings should be completed via setWindowId() before calling play().
 */
export class MpvMediaPlayer extends EventEmitter implements MediaPlayer {
  private controller: LibMPVController | null = null

  private windowId: number | null = null
  private isInitialized: boolean = false
  private statusChangeListeners: Set<(status: PlayerStatus) => void> = new Set()
  private pendingInitSettings: PlayerInitSettings | null = null

  constructor() {
    super()
    if (!isLibMPVAvailable()) {
      logger.warn('libmpv is not available')
    }
  }

  /**
   * Set mpv initialization options (must be called before initialize)
   */
  setInitSettings(settings: PlayerInitSettings): void {
    this.pendingInitSettings = settings
  }

  setWindowId(windowId: number) {
    this.windowId = windowId
    this.controller.setWindowId(this.windowId)
  }

  async ensureReady(): Promise<void> {
    await this.ensureInitialized()
  }

  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized && this.controller) return
    if (!isLibMPVAvailable()) throw new Error('libmpv is not available')
    this.controller = new LibMPVController()
    const initSettings = this.pendingInitSettings ?? undefined
    if (process.platform === 'win32') {
      await this.controller.initialize(this.windowId, initSettings)
    } else {
      await this.controller.initialize(undefined, initSettings)
    }
    this.setupEventHandlers()
    this.isInitialized = true
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    if (!this.controller) return

    // Listen for MPV status changes → emit PlayerStatus directly
    this.controller.on('status', (status: MPVStatus) => {
      this.emitStatus(this.adaptMPVStatusToPlayerStatus(status))
    })
    // Listen for track list changes and emit standardized PlayerTrack list upward
    this.controller.on('tracks-change', (rawTracks: any[]) => {
      try {
        const playerTracks = this.adaptRawTracksToPlayerTracks(rawTracks)
        this.emit('tracks-change', playerTracks)
      } catch (error) {
        logger.error('Error adapting tracks-change event', { error })
      }
    })
    
    // Pass through playback-restart event (first frame decoded, video-params ready)
    this.controller.on('playback-restart', () => {
      this.emit('playback-restart')
    })

    // Pass through property change events (speed, chapter-list, etc.)
    this.controller.on('property-change', (name: string, value: any) => {
      this.emit('property-change', name, value)
    })
  }
  
  /**
   * Emit a PlayerStatus to all status-change listeners.
   *
   * This is the sole status emission pathway — all status events
   * (MPV status callbacks, immediate play/volume emissions) converge
   * here.  The application layer (PlaybackStateProjector) subscribes
   * via onStatusChange and is the single consumer.
   */
  private emitStatus(status: PlayerStatus): void {
    this.statusChangeListeners.forEach(listener => {
      try {
        listener(status)
      } catch (error) {
        logger.error('Error in status change listener', { error })
      }
    })
  }

  /**
   * Play media
   * @param media Media object
   * @param startTime Start time in seconds (optional). If provided, uses libmpv's loadfile start=xxx
   *                  to play from the specified time directly, rather than seeking from 0.
   */
  async play(media: Media, startTime?: number, startPaused?: boolean): Promise<void> {
    await this.ensureInitialized()

    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }

    await this.controller.loadFile(media.uri, startTime, startPaused)

    // Emit immediate loading status so observers see the transition
    // before the first mpv status callback arrives.
    this.emitStatus({
      phase: 'loading',
      currentTime: startTime ?? 0,
      duration: 0,
      volume: this.controller?.getStatus()?.volume ?? 100,
      path: media.uri,
      isPaused: false,
      isSeeking: false,
      isNetworkBuffering: false,
      networkBufferingPercent: 0,
      hdrEnabled: this.controller?.isHdrEnabled() ?? false,
    })
  }

  /**
   * Pause playback
   */
  async pause(): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }

    await this.controller.pause()
    // Status will be updated via events
  }

  /**
   * Resume playback
   */
  async resume(): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }

    await this.controller.play()
    // Status will be updated via events
  }

  /**
   * Stop playback
   */
  async stop(): Promise<void> {
    if (!this.controller) {
      return
    }

    // Pause first, then stop: let mpv stop decoding and rendering first,
    // reducing resource contention during stop (especially for Blu-ray ISO scenarios)
    await this.controller.pause()
    await this.controller.stop()
  }

  async seek(time: number): Promise<void> {
    if (!this.controller) throw new Error('MPV controller not initialized')
    await this.controller.seek(time)
  }

  /**
   * Set volume
   */
  async setVolume(volume: number): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }

    const clampedVolume = Math.max(0, Math.min(130, volume))
    await this.controller.setVolume(clampedVolume)

    // Emit updated status with new volume for immediate UI feedback
    const current = this.getStatus()
    if (current) {
      this.emitStatus({ ...current, volume: clampedVolume })
    }
  }

  /**
   * Get the track list of the current media, adapted to PlayerTrack structure
   */
  async getTracks(): Promise<PlayerTrack[]> {
    if (!this.controller) {
      return []
    }

    const rawTracks = await this.controller.getTrackList()
    return this.adaptRawTracksToPlayerTracks(rawTracks)
  }

  /**
   * Adapt raw mpv track-list to PlayerTrack[]
   */
  private adaptRawTracksToPlayerTracks(rawTracks: any): PlayerTrack[] {
    if (!Array.isArray(rawTracks)) return []

    return rawTracks
      .filter((t: any) => t && typeof t.id === 'number' && typeof t.type === 'string')
      .map((t: any) => {
        const type = String(t.type) as string
        // mpv uses "audio" / "video" / "sub" to identify types
        const normalizedType: 'audio' | 'video' | 'sub' =
          type === 'audio' || type === 'video' || type === 'sub' ? type : 'video'

        return {
          id: t.id as number,
          type: normalizedType,
          lang: typeof t.lang === 'string' ? t.lang : undefined,
          title: typeof t.title === 'string' ? t.title : undefined,
          codec: typeof t.codec === 'string' ? t.codec : undefined,
          selected: !!t['selected'],
          source: t['external'] ? 'external' as const : 'internal' as const
        }
      })
  }

  /**
   * Switch audio track
   */
  async setAudioTrack(trackId: number | null): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }
    await this.controller.setAudioTrack(trackId)
  }

  /**
   * Switch subtitle track
   */
  async setSubtitleTrack(trackId: number | null): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }
    await this.controller.setSubtitleTrack(trackId)
  }

  /**
   * Listen for player status changes
   * When player status is updated, a PlayerStatus event is emitted directly
   */
  onStatusChange(listener: (status: PlayerStatus) => void): void {
    this.statusChangeListeners.add(listener)
    
    // If there is an existing status, notify immediately
    const currentStatus = this.getStatus()
    if (currentStatus) {
      try {
        listener(currentStatus)
      } catch (error) {
        logger.error('Error in initial status change notification', { error })
      }
    }
  }

  /**
   * Remove status change listener
   */
  offStatusChange(listener: (status: PlayerStatus) => void): void {
    this.statusChangeListeners.delete(listener)
  }

  /**
   * Read current player status (internal use — the application layer
   * reads state through PlaybackStateProjector, not this method).
   */
  private getStatus(): PlayerStatus | null {
    if (!this.controller || !this.isInitialized) return null
    
    const mpvStatus = this.controller.getStatus()
    return this.adaptMPVStatusToPlayerStatus(mpvStatus)
  }
  
  /**
   * Adapt MPVStatus to PlayerStatus
   */
  private adaptMPVStatusToPlayerStatus(mpvStatus: MPVStatus): PlayerStatus {
    return {
      currentTime: mpvStatus.position ?? 0,
      duration: mpvStatus.duration ?? 0,
      volume: mpvStatus.volume ?? 100,
      isPaused: mpvStatus.phase === 'paused',
      isSeeking: mpvStatus.isSeeking ?? false,
      isNetworkBuffering: mpvStatus.isNetworkBuffering ?? false,
      networkBufferingPercent: mpvStatus.networkBufferingPercent ?? 0,
      bufferRanges: mpvStatus.bufferRanges ?? [],
      path: mpvStatus.path,
      phase: (mpvStatus.phase ?? 'idle') as PlaybackPhase,
      errorMessage: mpvStatus.errorMessage,
      hdrEnabled: this.controller?.isHdrEnabled() ?? false
    }
  }
  
  /**
   * Set window size
   */
  async setWindowSize(width: number, height: number): Promise<void> {
    if (this.controller) {
      await this.controller.setWindowSize(width, height)
    }
  }
  
  /**
   * Set HDR enabled state
   */
  setHdrEnabled(enabled: boolean): void {
    this.controller?.setHdrEnabled(enabled)
  }
  
  /**
   * Send key event
   *
   * After the key press, immediately refreshes status so observers
   * (e.g. PlaybackStateProjector) see state changes without waiting
   * for the next periodic mpv status event.
   */
  async sendKey(key: string): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }
    await this.controller.keypress(key)
    // Immediately poll and broadcast the latest status so subscribers
    // see state changes from key presses (e.g. pause toggle) right away.
    this.emitStatus(this.adaptMPVStatusToPlayerStatus(this.controller.getStatus()))
  }

  async command(...args: string[]): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }
    await this.controller.command(...args)
  }
  
  /**
   * Debug: output video state information
   */
  async debugVideoState(): Promise<void> {
    if (this.controller) {
      await this.controller.debugVideoState()
    }
  }
  
  /**
   * Debug: output HDR status information
   */
  async debugHdrStatus(): Promise<void> {
    if (this.controller) {
      await this.controller.debugHdrStatus()
    }
  }

  /**
   * Get mpv property (generic interface, for panel/control bar to read chapter-list, ab-loop, etc.)
   */
  async getProperty(name: string): Promise<any> {
    if (!this.controller) throw new Error('MPV controller not initialized')
    return this.controller.getProperty(name)
  }

  /**
   * Set mpv property (generic interface, for panel to set brightness, sub-delay, etc.)
   */
  async setProperty(name: string, value: any): Promise<void> {
    if (!this.controller) throw new Error('MPV controller not initialized')
    await this.controller.setProperty(name, value)
  }

  async cleanup(): Promise<void> {
    logger.info('cleanup')

    this.statusChangeListeners.clear()
    this.removeAllListeners()

    // Controller is created and managed by this class, destroy it on cleanup
    if (this.controller) {
      try {
        await this.controller.stop()
        await this.controller.destroy()
      } catch (error) {
        logger.error('Error during cleanup', { error })
      }
    }
    this.controller = null
    this.isInitialized = false
    this.windowId = null
  }
}
