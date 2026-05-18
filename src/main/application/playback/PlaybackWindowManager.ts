import { BrowserWindow, screen } from 'electron'
import type { WindowController } from '../windows/WindowController'
import { SingleWindowStrategy } from '../windows/strategies/SingleWindowStrategy'
import { WindowPool } from '../windows/WindowPool'
import type { PlayerStatus, PlayerTrack } from './MediaPlayer'
import type { PlaylistItem } from '../types'
import { createLogger } from '../../infrastructure/logging'
import { getNSViewPointer, getHWNDPointer } from '../../infrastructure/platform/nativeHelper'
import { VIDEO_PLAYER_DELAYS, WINDOW_DELAYS } from '../constants'

const logger = createLogger('PlaybackWindowManager')

// ── Player surface interface ──

/**
 * Narrow interface for player-surface operations used by the window
 * manager.
 *
 * Covers the complete window-to-player surface lifecycle: native handle
 * binding, surface size syncing, engine warm-up, key-event forwarding,
 * and video-dimension reads (for auto-fit).  MediaPlayer satisfies this
 * interface structurally — VideoPlayerApp passes it directly, eliminating
 * the previous callback-relay closures that bounced surface operations
 * through the app layer.
 */
export interface PlayerSurface {
  /** Bind the native window handle to the player (platform-specific ID). */
  setWindowId(id: number): void
  /** Warm up the player engine so it's ready to accept play commands. */
  ensureReady(): Promise<void>
  /** Sync the player's internal surface size (physical pixels). */
  setWindowSize(width: number, height: number): Promise<void>
  /** Forward a key-press event to the player. */
  sendKey(key: string): Promise<void>
  /** Read a player property by name (used for video-dimension reads). */
  getProperty(name: string): Promise<any>
}

// ── Playback control port ──

/**
 * Narrow interface for playback control commands intrinsically tied
 * to window lifecycle events (PIP, auto-fit).
 *
 * Satisfied structurally by PlaybackScheduler — the window manager
 * receives this directly so it can issue playback control commands
 * without callback-relaying through VideoPlayerApp.
 *
 * Note: stop is NOT included — window-close-triggered stop is handled
 * by PlaybackCoordinator (the single boundary for all playback
 * lifecycle transitions).
 */
export interface PlaybackControlPort {
  /** Pause playback (before exiting PIP). */
  pause(): Promise<void>
  /** Resume playback (after auto-fit window sizing). */
  resume(): Promise<void>
}

// ── Dependencies ──

/**
 * Window-close notification for the playback lifecycle boundary.
 *
 * After the window manager has completed its own window-level cleanup
 * (controller disposal, resize handlers, auto-fit state), it calls
 * onWindowClosed so the coordinator can handle playback-level cleanup
 * (stop + session reset) and then notify VideoPlayerApp for main
 * window restoration.
 *
 * The coordinator is the single boundary for all playback lifecycle
 * transitions — window-close-triggered reactions are no different
 * from explicit stop/play/shutdown commands.
 */
export interface PlaybackWindowManagerDeps {
  /** Called after the window manager has completed window-level cleanup in response to a window close. */
  onWindowClosed: () => void
}

// ── PlaybackWindowManager ──

/**
 * Owns the complete window infrastructure lifecycle, window-to-player
 * surface binding, window-event-triggered playback coordination, and
 * outbound message delivery:
 *  - **Window pool lifecycle**: creates and pre-warms the pool during
 *    construction, destroys it via clearPool() during shutdown —
 *    the single owner of the complete pool lifecycle (previously
 *    split between the subsystem factory and this class)
 *  - WindowController creation, initialisation, and release
 *  - Window operation facades (fullscreen, PIP, fit, aspect-ratio lock)
 *  - Window event binding (close, key-down, state)
 *  - Video-layer visibility toggling
 *  - Complete window-to-player surface lifecycle: native handle binding,
 *    engine warm-up, resize → surface-size syncing, key-event forwarding,
 *    and video-dimension reads (via PlayerSurface interface)
 *  - Complete auto-fit lifecycle: scheduling during play(), handling
 *    the playback-restart event (video dimension resolution → window
 *    fit → playback resume), and the unlock-ratio → fit → lock-ratio
 *    execution sequence
 *  - All outbound state publication to playback UIs (video window +
 *    control layer) — previously in PlaybackBroadcaster, absorbed
 *    because message routing is inseparable from the window topology
 *    this class already manages
 *  - Window-event-triggered playback coordination: pause on PIP close,
 *    resume after auto-fit — these route through PlaybackControlPort.
 *    Window-close playback reaction (stop + session reset) is owned
 *    by PlaybackCoordinator — the window manager only notifies via
 *    deps.onWindowClosed after completing window-level cleanup.
 *
 * Two distinct release paths:
 *  - **User-initiated close**: the WindowController emits 'close' →
 *    handleClose performs window-level cleanup (resize handlers,
 *    controller ref, auto-fit state) and calls deps.onWindowClosed —
 *    the coordinator handles playback-level cleanup (stop + session
 *    reset) and notifies VideoPlayerApp for main window restoration.
 *  - **App shutdown (teardown)**: the window manager silently disposes
 *    the controller (returns window to pool) without firing the close-
 *    event chain — VideoPlayerApp manages its own shutdown teardown.
 *    Pool destruction is handled by clearPool() (called by the
 *    subsystem factory's shutdown function after the player has
 *    released native handles).
 */
export class PlaybackWindowManager {
  private windowController: WindowController | null = null
  /**
   * Path of the video for which an auto-fit is pending (set during
   * play when windowFollowVideo is enabled; consumed on playback-
   * restart).  Null means no auto-fit is scheduled.
   */
  private pendingAutoFitPath: string | null = null

  // ── Video-surface resize sync state ──
  private pendingResizeTimer: NodeJS.Timeout | null = null
  private resizeHandler: (() => void) | null = null
  private lastPhysicalWidth: number = -1
  private lastPhysicalHeight: number = -1

  /**
   * Window pool — owned by this class as the single window-lifecycle
   * authority.  Created during construction, pre-warmed so a pooled
   * window is ready when the first play arrives, and destroyed during
   * clearPool() at shutdown.
   *
   * Previously the pool was created by the subsystem factory and
   * injected here.  Moving ownership inward consolidates the complete
   * window infrastructure lifecycle (pool creation → controller
   * acquisition → controller disposal → pool destruction) into this
   * single boundary, symmetric with its role as the window-lifecycle
   * authority for all other window operations.
   */
  private readonly pool: WindowPool

  constructor(
    private readonly deps: PlaybackWindowManagerDeps,
    /**
     * Direct access to the player surface — the narrow set of
     * MediaPlayer methods needed for window-to-player lifecycle:
     * native handle binding, surface size syncing, engine warm-up,
     * key-event forwarding, and video-dimension reads.
     */
    private readonly playerSurface: PlayerSurface,
    /**
     * Direct access to scheduled playback control commands.
     *
     * Used for window-event-triggered playback reactions that are
     * intrinsically tied to window operations: pause on PIP close,
     * resume after auto-fit.  Window-close playback reactions (stop
     * + session reset) are handled by the coordinator — not here.
     */
    private readonly playbackControl: PlaybackControlPort,
  ) {
    this.pool = new WindowPool()
    // Pre-warm so a pooled window is ready when the first play arrives.
    // Fire-and-forget: failure just means the first play creates the
    // window on-demand (slightly slower).
    this.pool.init().catch(err => {
      logger.error('Failed to init WindowPool', err)
    })
  }


  // ═══════════════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Ensure a playback window exists and prepare it for a new play
   * session: create/init the window controller, show the input window,
   * resolve the native window handle, bind the video surface to the
   * media player, set up resize syncing, and warm up the media player.
   *
   * Owns the complete window-to-player surface lifecycle:
   *  1. Window controller creation/init
   *  2. Show + focus the input window
   *  3. Native window handle resolution (NSView / HWND)
   *  4. Media-player window-ID binding
   *  5. Resize handler setup (window → media-player size sync)
   *  6. Media-player warmup
   *  7. Initial window-size sync
   *
   * Returns true on success, false on failure.  The BrowserWindow is
   * fully encapsulated — callers (the coordinator) only need to know
   * whether the window is ready, not hold the window reference.
   *
   * Previously the native handle resolution, resize syncing, and media-
   * player window binding was previously split from the window
   * lifecycle this class already manages.  Consolidating here makes the
   * window manager the single owner of the complete window-to-player
   * surface preparation sequence.
   */
  async prepareForPlayback(): Promise<boolean> {
    await this.initWindowController()

    const controller = this.windowController
    if (!controller) return false

    const videoWindow = controller.getVideoWindow()
    if (!videoWindow) return false

    const inputWindow = controller.getInputWindow()
    if (inputWindow) {
      if (!inputWindow.isVisible()) inputWindow.show()
      inputWindow.focus()
    }

    await new Promise(resolve => setTimeout(resolve, VIDEO_PLAYER_DELAYS.VIDEO_WINDOW_SHOW_WAIT_MS))

    // ── Bind video surface to media player ──
    const windowId = this.resolveNativeHandle(videoWindow)
    if (!windowId) {
      logger.error('Failed to resolve native window handle')
      return false
    }

    this.setupResizeHandler(videoWindow)
    await this.playerSurface.ensureReady()
    this.playerSurface.setWindowId(windowId)

    // Initial window-size sync so the media player knows the
    // current surface dimensions before the first frame renders.
    await this.syncWindowSize(videoWindow)

    return true
  }

  /**
   * Silently release the playback window during app shutdown.
   *
   * Unlike user-initiated close (which fires the close-event chain and
   * triggers the onWindowClosed callback), this method disposes the
   * controller directly — returning the window to the pool without
   * re-entering VideoPlayerApp through the event system.
   * VideoPlayerApp manages its own business teardown independently.
   */
  teardown(): void {
    const controller = this.windowController
    if (!controller) return

    // Clean up resize handler before detaching the controller
    this.cleanupResizeHandler(controller.getVideoWindow())

    // Detach all event listeners to prevent stale callbacks during dispose
    controller.removeAllListeners()

    // Release window resources (returns window to pool)
    controller.dispose()

    this.windowController = null
    this.pendingAutoFitPath = null
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Window operations
  // ═══════════════════════════════════════════════════════════════════

  toggleFullscreen(): void {
    this.windowController?.toggleFullscreen()
  }

  togglePip(): boolean {
    return this.windowController?.togglePip() ?? false
  }

  pipClose(): void {
    this.playbackControl.pause().catch(() => {})
    this.windowController?.pipClose()
  }

  pipReturn(): void {
    this.windowController?.pipReturn()
  }

  togglePipSize(): void {
    this.windowController?.togglePipSize()
  }

  fitToVideo(videoWidth: number, videoHeight: number): void {
    this.windowController?.fitToVideo(videoWidth, videoHeight)
  }

  setAspectRatioLock(ratio: number): void {
    this.windowController?.setAspectRatioLock(ratio)
  }

  handleWindowAction(action: 'close' | 'minimize' | 'maximize'): void {
    this.windowController?.handleWindowAction(action)
  }

  isPip(): boolean {
    return this.windowController?.isPip() ?? false
  }

  setVideoLayerVisible(visible: boolean): void {
    this.windowController?.setVideoLayerVisible(visible)
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Outbound message delivery (absorbed from PlaybackBroadcaster)
  //
  //  Owns all outbound state publication to playback UIs — both the
  //  video window and the control layer.  Previously lived in a
  //  separate PlaybackBroadcaster that held a parallel WindowController
  //  reference for message routing.  Absorbing it here eliminates the
  //  dual-reference coupling: the window manager already owns the
  //  controller lifecycle, and message routing is inseparable from
  //  the window topology it manages.
  //
  //  App-wide broadcasts (e.g. language:changed to ALL windows) are
  //  NOT included here — they are an application-level concern handled
  //  by VideoPlayerApp directly.
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Send a message to all playback UIs (video window + control layer).
   *
   * Previously delegated to buildPlaybackWindowMessageTargets utility
   * functions — inlined here because PlaybackWindowManager is the sole
   * consumer and already owns the controller reference.
   */
  send(channel: string, payload?: unknown): void {
    const controller = this.windowController
    if (!controller) return

    // Video window
    try {
      const videoWc = controller.getVideoWindow()?.webContents
      if (videoWc && !videoWc.isDestroyed()) {
        videoWc.send(channel, payload)
      }
    } catch {
      // Window may be closing
    }

    // Control layer
    try {
      controller.sendToControlLayer(channel, payload)
    } catch {
      // Window may be closing
    }
  }

  /** Send to the control layer only (not the video window). */
  sendToControl(channel: string, payload?: unknown): void {
    const controller = this.windowController
    if (!controller) return
    try {
      controller.sendToControlLayer(channel, payload)
    } catch {
      // Window may be closing
    }
  }

  // ── Typed broadcasts ──

  broadcastPlayerStatus(status: PlayerStatus): void {
    this.send('player:status', status)
  }

  broadcastTracksChanged(tracks: PlayerTrack[]): void {
    this.send('player:tracks-changed', tracks)
  }

  broadcastPropertyChange(name: string, value: unknown): void {
    this.send('player:property-change', { name, value })
  }

  broadcastCurrentChanged(info: { name: string; path: string }): void {
    this.send('player:current-changed', info)
  }

  broadcastPlaylistUpdated(items: PlaylistItem[]): void {
    this.send('playlist:updated', items)
  }

  broadcastWindowState(channel: string, value: boolean): void {
    this.sendToControl(channel, value)
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Auto-fit window lifecycle
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Schedule an auto-fit for the given video path.
   *
   * Called by VideoPlayerApp during playSession() when windowFollowVideo is
   * enabled.  The pending path is consumed by handlePlaybackRestart()
   * when the playback-restart event fires, and cleared on window close
   * or teardown.
   */
  scheduleAutoFit(path: string): void {
    this.pendingAutoFitPath = path
  }

  /**
   * Handle the playback-restart event (first frame decoded).
   *
   * If a pending auto-fit is scheduled for the given path:
   *  1. Resolve effective video display dimensions (accounting for
   *     display-size overrides and rotation)
   *  2. Execute the auto-fit sequence (unlock → fit → lock ratio)
   *  3. Resume playback (the video was started paused for fitting)
   *
   * Returns immediately for non-matching paths (stale restarts from
   * a previous session) — consumePendingAutoFit ensures at-most-once.
   *
   * Consolidated here because PlaybackWindowManager already owns
   * auto-fit scheduling, readiness checking, and the fit execution
   * sequence.
   *
   * @param currentPath — resolved by PlaybackStateProjector and shared
   *   to avoid redundant mpv property queries
   */
  async handlePlaybackRestart(currentPath: string | null): Promise<void> {
    if (!this.consumePendingAutoFit(currentPath)) return

    try {
      const { vw, vh } = await this.resolveDisplayDimensions()
      if (vw > 0 && vh > 0) {
        this.autoFitToVideo(vw, vh)
      }
    } catch (err) {
      logger.warn('Auto window fit failed', { error: err instanceof Error ? err.message : String(err) })
    }
    this.playbackControl.resume().catch(() => {})
  }

  async getVideoResolution(): Promise<{ width: number; height: number; fps: number }> {
    try {
      const [{ vw, vh }, fps] = await Promise.all([
        this.resolveDisplayDimensions(),
        this.playerSurface.getProperty('container-fps').then(Number).catch(() => 30),
      ])
      return { width: vw, height: vh, fps: fps > 0 ? fps : 30 }
    } catch {
      return { width: 0, height: 0, fps: 30 }
    }
  }

  // ── Internal auto-fit helpers ──

  /**
   * Consume the pending auto-fit if it matches the given path.
   *
   * Returns true if an auto-fit was pending and the path matches.
   * Returns false if no auto-fit was pending or the path doesn't
   * match (stale restart from a previous session).
   *
   * Consuming clears the pending state so the fit runs at most once.
   */
  private consumePendingAutoFit(currentPath: string | null): boolean {
    if (!this.pendingAutoFitPath) return false
    if (currentPath !== this.pendingAutoFitPath) return false
    this.pendingAutoFitPath = null
    return true
  }

  /**
   * Execute the auto-fit sequence: unlock the old aspect ratio, resize
   * the window to match the video dimensions, then lock the new ratio.
   */
  private autoFitToVideo(videoWidth: number, videoHeight: number): void {
    this.setAspectRatioLock(0)
    this.fitToVideo(videoWidth, videoHeight)
    this.setAspectRatioLock(videoWidth / videoHeight)
  }

  /**
   * Read video params from the player and compute effective display
   * dimensions (accounting for display-size overrides and rotation).
   *
   * Reads directly from the player surface — previously this logic
   * lived in VideoPlayerApp.getVideoParamsFromMediaPlayer() and was
   * callback-relayed through the deps interface.  Inlining it here
   * makes PlaybackWindowManager the single owner of auto-fit dimension
   * resolution (it already owns the fit execution sequence).
   */
  private async resolveDisplayDimensions(): Promise<{ vw: number; vh: number }> {
    const [dw, dh, w, h, metaRotate, userRotate] = await Promise.all([
      this.playerSurface.getProperty('video-params/dw'),
      this.playerSurface.getProperty('video-params/dh'),
      this.playerSurface.getProperty('width'),
      this.playerSurface.getProperty('height'),
      this.playerSurface.getProperty('video-params/rotate'),
      this.playerSurface.getProperty('video-rotate'),
    ])
    const totalRotate = ((Number(metaRotate) || 0) + (Number(userRotate) || 0)) % 360
    const needSwap = totalRotate === 90 || totalRotate === 270

    let vw = Number(dw) || Number(w) || 0
    let vh = Number(dh) || Number(h) || 0
    if (needSwap) [vw, vh] = [vh, vw]

    return { vw, vh }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Private
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Destroy all pooled windows — final infrastructure cleanup.
   *
   * Called by the subsystem factory's shutdown function as the last
   * step after the player has released native handles (scheduler
   * shutdown) and the controller has been returned to the pool
   * (coordinator teardownSession → teardown).
   *
   * This makes the window manager the symmetric lifecycle owner of
   * the pool: it creates and pre-warms the pool during construction,
   * and destroys it here during shutdown.
   */
  clearPool(): void {
    this.pool.clear()
  }

  private async initWindowController(): Promise<void> {
    if (!this.windowController) {
      const controller = new SingleWindowStrategy(this.pool)
      this.bindWindowControllerEvents(controller)
      await controller.init({
        title: 'Video Player',
        width: 1280,
        height: 720
      })
      this.windowController = controller
    }
  }

  private bindWindowControllerEvents(controller: WindowController): void {
    controller.on('close', this.handleClose)
    controller.on('key-down', this.handleKeyDown)

    // Forward window state changes to the control layer
    const windowStateEvents = [
      { event: 'fullscreen-enter', channel: 'window:fullscreen-changed', value: true },
      { event: 'fullscreen-exit', channel: 'window:fullscreen-changed', value: false },
      { event: 'maximize', channel: 'window:maximized-changed', value: true },
      { event: 'unmaximize', channel: 'window:maximized-changed', value: false },
    ] as const
    for (const { event, channel, value } of windowStateEvents) {
      controller.on(event, () => {
        this.broadcastWindowState(channel, value)
      })
    }
  }

  private readonly handleClose = (): void => {
    // ── Window-level cleanup ──
    // The window is hidden (not destroyed) to avoid the native-level
    // blocking caused by OpenGL context teardown during mpv stop.
    // Dispose is deferred — the controller and its resources are released
    // when a new controller is created or on app shutdown.
    this.cleanupResizeHandler(this.windowController?.getVideoWindow())
    // Dispose the controller (returns window to pool) — safe because
    // the window was already hidden by SingleWindowStrategy.hideAndNotify()
    this.windowController?.dispose()
    this.windowController = null
    this.pendingAutoFitPath = null

    // Notify the coordinator for playback-level cleanup (stop +
    // session reset) and VideoPlayerApp for main window restoration.
    this.deps.onWindowClosed()
  }

  private readonly handleKeyDown = (key: string): void => {
    this.playerSurface.sendKey(key).catch(() => {})
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Window-to-player surface infrastructure
  //
  //  Native handle resolution, resize syncing, key-event forwarding,
  //  and video-dimension reads — the complete window-to-player surface
  //  lifecycle.  PlaybackWindowManager owns this directly via the
  //  PlayerSurface interface (previously callback-relayed through dep
  //  closures in VideoPlayerApp).
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Resolve the platform-specific native window handle (NSView / HWND).
   */
  private resolveNativeHandle(window: BrowserWindow): number | null {
    try {
      if (process.platform === 'darwin') {
        return getNSViewPointer(window)
      } else if (process.platform === 'win32') {
        return getHWNDPointer(window)
      }
      return null
    } catch (error) {
      logger.error('Failed to resolve native window handle', {
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Set up throttled resize → media-player surface size sync.
   */
  private setupResizeHandler(window: BrowserWindow): void {
    this.cleanupResizeHandler(window)
    this.resizeHandler = () => {
      this.scheduleResizeSync(window)
    }
    window.on('resize', this.resizeHandler)
  }

  private cleanupResizeHandler(window: BrowserWindow | null | undefined): void {
    if (this.resizeHandler && window && !window.isDestroyed()) {
      window.off('resize', this.resizeHandler)
    }
    this.resizeHandler = null
    if (this.pendingResizeTimer) {
      clearTimeout(this.pendingResizeTimer)
      this.pendingResizeTimer = null
    }
  }

  private scheduleResizeSync(window: BrowserWindow): void {
    if (this.pendingResizeTimer) {
      clearTimeout(this.pendingResizeTimer)
    }
    this.pendingResizeTimer = setTimeout(() => {
      this.pendingResizeTimer = null
      this.syncWindowSize(window).catch(() => {})
    }, WINDOW_DELAYS.RESIZE_THROTTLE_MS)
  }

  /**
   * Sync the video window's physical pixel dimensions to the media player.
   * Deduplicates by comparing against the last-synced dimensions.
   */
  private async syncWindowSize(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed()) return
    const bounds = window.getContentBounds()
    const display = screen.getDisplayMatching(window.getBounds())
    const scaleFactor = display.scaleFactor
    const width = Math.round(bounds.width * scaleFactor)
    const height = Math.round(bounds.height * scaleFactor)
    if (width === this.lastPhysicalWidth && height === this.lastPhysicalHeight) return
    this.lastPhysicalWidth = width
    this.lastPhysicalHeight = height
    await this.playerSurface.setWindowSize(width, height)
  }
}
