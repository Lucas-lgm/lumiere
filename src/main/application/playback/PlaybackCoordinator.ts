import type { PlaySessionConfig } from '../config/appSettingsBridge'
import { createMedia, type Media } from '../../../shared/types/playback'
import type { PlaylistItem } from '../types'
import type { PlayVideoRequest } from '../command/ipcTypes'
import { VIDEO_PLAYER_DELAYS } from '../constants'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('PlaybackCoordinator')

// ── Narrow port interfaces ──
//
// The coordinator references its dependencies through narrow typed
// contracts — the same decoupling pattern used system-wide:
//   - PlayerEventSource (projector ← MediaPlayer)
//   - SchedulerPhaseSource (scheduler ← projector)
//   - PlayerSurface / PlaybackControlPort (windowManager ← player/scheduler)
//   - PlayerConfigPort (settingsBridge ← MediaPlayer)
//   - PlayerDirectPort / PlaybackCommands (IPC handlers ← player/scheduler)
//
// This makes the coordinator's dependency surface explicit and
// testable — each interface documents exactly which capabilities
// the orchestration layer requires from each boundary.

/**
 * Narrow interface for session-state operations used by the
 * coordinator.
 *
 * Covers the session-lifecycle protocol: phase reads, transition
 * management, session preparation, error injection, and session
 * teardown.  PlaybackStateProjector satisfies this interface
 * structurally — the subsystem factory passes it directly.
 *
 * The coordinator does NOT need the projector's event-subscription
 * methods (bind, unbind, onPhaseChange) — those are consumed by the
 * factory and the scheduler respectively.
 */
export interface SessionStatePort {
  /** Whether a video is actively loaded (loading, playing, or paused). */
  hasActiveVideo(): boolean
  /** Read the current player phase. */
  getPlayerPhase(): string
  /** Mark the start of a video transition (auto-clears on playing/error/ended). */
  beginTransition(): void
  /** Abort a transition that failed before a new session was established. */
  cancelTransition(): void
  /** Prepare the projection layer for a new playback session (teardown old + establish identity). */
  prepareNewSession(target: { path: string }): void
  /** Inject an error state into the player status. */
  handlePlayError(message: string): void
  /** Reset all session and projection state, producing a clean idle snapshot. */
  resetSession(): void
}

/**
 * Narrow interface for session-level player commands used by the
 * coordinator.
 *
 * Covers the three scheduled commands the orchestration layer needs:
 * stop (pre-play, window-close, teardown), play (session-start),
 * and resume (play-vs-resume decision).  PlaybackScheduler satisfies
 * this interface structurally.
 *
 * Simple IPC-driven commands (pause, stop, seek) are routed directly
 * to PlaybackCommands — they bypass the coordinator entirely.
 */
export interface SessionCommandPort {
  stop(): Promise<void>
  play(media: Media, startTime?: number, startPaused?: boolean): Promise<void>
  resume(): Promise<void>
}

/**
 * Narrow interface for session-level window operations used by the
 * coordinator.
 *
 * Covers window preparation (create/bind/warm-up), session broadcast,
 * auto-fit scheduling, and teardown.  PlaybackWindowManager satisfies
 * this interface structurally.
 *
 * The coordinator does NOT need the window manager's message-delivery
 * methods (send, sendToControl, broadcastPlayerStatus, etc.) — those
 * are consumed by the PlaybackEffectHandler and IPC handlers.
 * prepareForPlayback() returns boolean (success/failure) — the
 * coordinator doesn't need the BrowserWindow reference; window-to-
 * player surface binding is handled internally by the window manager.
 */
export interface SessionWindowPort {
  /** Prepare a playback window and bind it to the media player. Returns false on failure. */
  prepareForPlayback(): Promise<boolean>
  /** Broadcast current-changed notification to playback UIs. */
  broadcastCurrentChanged(info: { name: string; path: string }): void
  /** Schedule an auto-fit for the given video path (consumed on playback-restart). */
  scheduleAutoFit(path: string): void
  /** Silently release the playback window during app shutdown. */
  teardown(): void
}

/**
 * Narrow interface for play-session configuration used by the
 * coordinator.
 *
 * Covers the two pre/post-play configuration steps: settings
 * preparation (global + per-play mpv properties, start-time
 * resolution, startPaused decision) and post-play volume restoration.
 * AppSettingsBridge satisfies this interface structurally.
 *
 * The coordinator does NOT need the settings bridge's full API
 * (setAppSetting, resetAppSettings, applyInitialReactions, etc.) —
 * those are consumed by the IPC layer and VideoPlayerApp startup.
 */
export interface PlayConfigPort {
  prepareForPlay(targetPath: string, explicitStartTime?: number): Promise<PlaySessionConfig>
  restorePlaybackVolume(): Promise<void>
}

/**
 * Application-level callbacks for lifecycle concerns that the
 * coordinator cannot own (macOS platform integration, main-window
 * restoration).
 */
export interface PlaybackCoordinatorDeps {
  /** Called after a successful play session start (macOS Recent Documents + dock menu). */
  onPlayStarted: (target: { path: string; name: string }) => void
  /** Called after window-close playback cleanup completes (main window restoration). */
  onPlaybackWindowClosed: () => void
}

/**
 * Pure application-layer orchestration boundary for the playback
 * session lifecycle.
 *
 * Owns:
 *  1. **Playback intent routing** — normalises raw play intents from
 *     IPC / menu into session-start calls
 *  2. **Session-start orchestration** — the full play sequence: stop
 *     existing → prepare window → establish session identity → pre-play
 *     preparation (via playConfig) → execute scheduled play →
 *     post-play volume restoration (via playConfig) → post-play
 *  3. **Window-close playback reaction** — stop playback + reset
 *     session state when the playback window is closed
 *  4. **Session teardown** — clean session-level shutdown (stop
 *     playback → release window → reset state), called by the subsystem
 *     factory's shutdown function as part of the symmetric lifecycle
 *     protocol
 *
 * The coordinator is a **pure orchestrator** — it does NOT relay
 * simple playback commands (pause, stop, seek).  Those route directly
 * from IPC handlers to the PlaybackScheduler via the PlaybackCommands
 * interface exposed by the subsystem factory.  The coordinator only
 * uses the scheduler internally for orchestration steps (pre-play
 * stop, session teardown, play-vs-resume decisions).
 *
 * All dependencies are referenced through narrow port interfaces:
 *   - **SessionStatePort**: session-state reads, transitions, resets
 *     (satisfied by PlaybackStateProjector)
 *   - **SessionCommandPort**: scheduled player commands for
 *     orchestration (satisfied by PlaybackScheduler)
 *   - **SessionWindowPort**: window preparation, broadcasts, teardown
 *     (satisfied by PlaybackWindowManager)
 *   - **PlayConfigPort**: pre-play settings + volume restoration
 *     (satisfied by AppSettingsBridge)
 *
 * VideoPlayerApp retains app lifecycle (startup/shutdown), settings
 * API, file-open routing, main-window restoration, and macOS
 * platform integration.
 */
export class PlaybackCoordinator {
  constructor(
    private readonly sessionState: SessionStatePort,
    private readonly sessionWindow: SessionWindowPort,
    private readonly sessionCommands: SessionCommandPort,
    private readonly playConfig: PlayConfigPort,
    private readonly deps: PlaybackCoordinatorDeps,
  ) {}

  // ═══════════════════════════════════════════════════════════════════
  //  Playback intent intake
  //
  //  Receives raw play intents from IPC handlers and menu actions,
  //  normalises them into play targets, and delegates to the
  //  session-start sequence below.
  // ═══════════════════════════════════════════════════════════════════

  /** Handle play-video IPC: play a specified file */
  async handlePlayVideo(file: PlayVideoRequest): Promise<void> {
    await this.playSession({ path: file.path, name: file.name, startTime: file.startTime })
  }

  /** Handle play-url IPC: play a URL */
  async handlePlayUrl(url: string): Promise<void> {
    await this.playSession({ path: url, name: url })
  }

  /**
   * Resume playback.
   *
   * IPC control:play routes here; simple pause/stop/seek commands route
   * directly to PlaybackCommands (the scheduler).
   */
  async handleControlPlay(): Promise<void> {
    await this.sessionCommands.resume()
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Session-start sequencing
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Full play orchestration — the complete session-start sequence:
   *
   *  1. Stop existing video if active (scheduled)
   *  2. Prepare playback window
   *  3. Begin playback session (identity + player-state reset via
   *     projector — the projector owns all session-boundary resets)
   *  4. Pre-play preparation (settings + start time via
   *     playConfig.prepareForPlay — the single boundary for all
   *     config/settings reads before a play command)
   *  5. Execute play (via sessionCommands — the single execution boundary)
   *  6. Restore volume (via playConfig — post-play config apply)
   *  7. Post-play callback (macOS integration via deps.onPlayStarted)
   */
  private async playSession(target: PlaylistItem, startTimeOverride?: number): Promise<void> {
    const { sessionState, sessionWindow, sessionCommands, playConfig } = this

    // ── Pre-play: stop active video, reset state, prepare window ──

    if (sessionState.hasActiveVideo()) {
      sessionState.beginTransition()
      try {
        await sessionCommands.stop()
        await new Promise(resolve => setTimeout(resolve, VIDEO_PLAYER_DELAYS.STOP_WAIT_MS))
      } catch (error) {
        logger.error('Failed to stop current video', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const ready = await sessionWindow.prepareForPlayback()
    if (!ready) {
      sessionState.cancelTransition()
      return
    }

    // ── Session identity + current-changed broadcast ──

    sessionState.prepareNewSession({ path: target.path })
    sessionWindow.broadcastCurrentChanged({ name: target.name, path: target.path })

    // ── Pre-play preparation ──
    //
    // PlayConfigPort.prepareForPlay() owns the complete pre-play
    // preparation pipeline: mpv property application (global + per-play),
    // start-time resolution (explicit > saved progress), and startPaused
    // decision (windowFollowVideo).  The coordinator only resolves which
    // explicit start time takes priority (override vs playlist startTime);
    // the bridge resolves explicit vs persisted.

    const explicitStart =
      typeof startTimeOverride === 'number' && isFinite(startTimeOverride) && startTimeOverride > 0
        ? startTimeOverride
        : target.startTime

    const media = createMedia(target.path, target.name)

    try {
      const config = await playConfig.prepareForPlay(target.path, explicitStart)

      logger.info('Play', { path: target.path, startTime: config.startTime })

      if (config.startPaused) {
        sessionWindow.scheduleAutoFit(target.path)
      }
      await sessionCommands.play(media, config.startTime, config.startPaused || undefined)
      await playConfig.restorePlaybackVolume()

      this.deps.onPlayStarted({ path: target.path, name: target.name })
    } catch (error) {
      sessionState.handlePlayError(error instanceof Error ? error.message : 'Unknown error')
      logger.error('Play failed', {
        path: target.path,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Window-close playback reaction
  //
  //  Handles the playback-level cleanup when the playback window is
  //  closed.  The window manager handles window-level cleanup (resize
  //  handlers, controller disposal, auto-fit state) and then notifies
  //  here for playback lifecycle cleanup.  The coordinator is the
  //  single boundary for lifecycle transitions: session-start
  //  (playSession), window-close (here), and shutdown (below).
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle playback window closure — playback-level cleanup.
   *
   * Called by PlaybackWindowManager (via deps.onWindowClosed) AFTER
   * the window manager has completed its own window-level cleanup
   * (controller disposal, resize handler cleanup, auto-fit state
   * clearance).
   *
   * Owns the playback-level reaction to window close:
   *  1. Stop playback (fire-and-forget — the window is already gone)
   *  2. Reset session state (clear session identity + emit idle)
   *  3. Notify VideoPlayerApp for main window restoration
   *
   * This is distinct from teardownSession() (used during shutdown):
   *  - No await on stop (fire-and-forget — window is already gone)
   *  - No window teardown (already handled by the window manager)
   */
  handlePlaybackWindowClosed(): void {
    this.sessionCommands.stop().catch(() => {})
    this.sessionState.resetSession()
    this.deps.onPlaybackWindowClosed()
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Session teardown
  //
  //  Clean session-level shutdown — the coordinator is the single
  //  owner of all session lifecycle transitions (session-start via
  //  playSession, window-close reaction, teardown here).
  //  Called by the subsystem factory's shutdown function as part of
  //  the symmetric lifecycle — the factory owns the complete teardown
  //  protocol (session → infrastructure) just as it owns assembly.
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Tear down the current playback session — session-level cleanup
   * without infrastructure release.
   *
   * Called by the subsystem factory's shutdown function as the first
   * phase of the complete subsystem teardown.  The factory encapsulates
   * the two-phase protocol (session teardown → infrastructure release)
   * so VideoPlayerApp only sees a single shutdown call.
   *
   * Session teardown: stop → release window → reset session state.
   * The idle emission flows through the projection pipeline with
   * listeners still attached (infrastructure release happens after
   * this method returns).
   */
  async teardownSession(): Promise<void> {
    await this.sessionCommands.stop()
    this.sessionWindow.teardown()
    this.sessionState.resetSession()
  }
}
