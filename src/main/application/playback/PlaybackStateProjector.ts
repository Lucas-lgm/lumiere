import type { PlayerStatus, PlayerTrack } from './MediaPlayer'
import type { PlaybackEventSink } from './PlaybackEffectHandler'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('PlaybackStateProjector')

// ── Player event source interface ──

/**
 * Narrow interface for the media-player events consumed by the
 * projector.
 *
 * Covers the four event types the projector subscribes to:
 *   - **player-status**: continuous status snapshots (typed methods)
 *   - **tracks-change**: track list updates (EventEmitter)
 *   - **property-change**: observed property updates (EventEmitter)
 *   - **playback-restart**: first-frame-decoded notification (EventEmitter)
 *
 * MediaPlayer satisfies this interface structurally — the subsystem
 * factory passes it directly, so the projector never needs the full
 * ~25-method MediaPlayer type.  This completes the narrow-port
 * decoupling pattern: every application-layer consumer of the media
 * player now sees only the contract it actually uses.
 */
export interface PlayerEventSource {
  /** Subscribe to validated player status updates. */
  onStatusChange(listener: (status: PlayerStatus) => void): void
  /** Unsubscribe from player status updates. */
  offStatusChange(listener: (status: PlayerStatus) => void): void
  /** Subscribe to a named player event (tracks-change, property-change, playback-restart). */
  on(event: 'tracks-change', listener: (tracks: PlayerTrack[]) => void): void
  on(event: 'property-change', listener: (name: string, value: unknown) => void): void
  on(event: 'playback-restart', listener: () => void): void
  /** Unsubscribe from a named player event. */
  off(event: string, listener: (...args: any[]) => void): void
}

// ── Session identity ──

type PlaybackIdentity = { requestId: string; sessionId: number; generation: number }

type PlaybackSessionState = {
  activeIdentity: PlaybackIdentity | null
  currentVideoPath: string | null
}

/**
 * Sole application-layer authority for playback state — both reactive
 * projection (event-driven) and imperative access (reads + mutations).
 *
 * All application-layer code that needs to read the player phase,
 * inject error state, or reset the player status routes through this
 * projector.
 *
 * **Session identity tracking**:
 *  - Owns playback session/generation counters and session path
 *    tracking (previously in PlaybackSessionCoordinator — absorbed
 *    because this projector is the sole consumer and already owns
 *    all session-boundary protocol methods)
 *
 * **State authority (imperative)**:
 *  - Owns the player state directly — currentStatus field with
 *    mutation methods; no sub-component delegation
 *  - Phase reads: getPlayerPhase(), hasActiveVideo() — used by
 *    VideoPlayerApp for pre-play stop decisioning and by the intent
 *    handler for play-vs-resume decisioning
 *  - Error injection: handlePlayError() → applyStatusUpdate(error)
 *  - Session-boundary resets: resetAll() → applyStatusUpdate(idle)
 *
 * **Refresh gating (reactive)**:
 *  - **Stale-status filter**: drops snapshots whose path doesn't match
 *    the active session (cross-session invalidation)
 *  - **Change-detection / deduplication**: compares the enriched
 *    snapshot against the last broadcast; skips if nothing changed
 *    (timeline-driven refresh gating)
 *
 * **Reactive projection (event-driven)**:
 *  - Subscribes to ALL player events via the PlayerEventSource contract
 *    (player-status, tracks-change, property-change, playback-restart)
 *  - Consistent session-aware event gateway: ALL event types are gated
 *    by active session — stale events from a previous or no-session
 *    state are dropped before reaching the application layer
 *  - Status events get the full projection pipeline (stale-path filter,
 *    session enrichment, deduplication)
 *  - Non-status events (tracks, properties, playback-restart) are
 *    session-gated and enriched with session context where applicable
 *  - Relays ALL events to the PlaybackEventSink (implemented by
 *    PlaybackEffectHandler) — the sole boundary between the projector
 *    and the rest of the application:
 *    - handleStatusProjected: validated, enriched, deduplicated status
 *    - handleTracksChanged: session-gated tracks-change
 *    - handlePropertyChange: session-gated property-change
 *    - handlePlaybackRestart: session-gated, enriched with currentVideoPath
 *
 * **Session-transition protocol (call-driven)**:
 *  - Sole gateway for session-related projection state: transition
 *    lifecycle (beginTransition / cancelTransition), new-session
 *    preparation (identity allocation), session teardown (resetSession)
 *  - Owns the complete session-close → idle transition: clears all
 *    session identity, switching, and dedup state, then resets the
 *    player status to idle (producing a clean idle snapshot that
 *    flows through the projection pipeline)
 *  - Single resetSession() method for all teardown paths (window close,
 *    shutdown, pre-new-session cleanup) — no semantic split
 *  - Session broadcast (current-changed) is owned by the coordinator —
 *    the projector is decoupled from broadcast delivery
 *
 * This class does NOT handle:
 *  - Business side-effects (watch progress, video-layer visibility,
 *    thumbnail init, auto-fit) — owned by the PlaybackEventSink
 *  - Broadcast delivery to playback UIs — owned by the
 *    PlaybackEventSink → PlaybackWindowManager chain
 *  - Playlist broadcasts (owned by VideoPlayerApp)
 */
export class PlaybackStateProjector {
  private removeListeners: (() => void) | null = null
  /** Whether the player is transitioning between videos (projection-layer state). */
  private isSwitching = false
  /** Last broadcast status — used for change-detection (deduplication). */
  private lastBroadcastStatus: PlayerStatus | null = null

  // ── Session identity state (absorbed from PlaybackSessionCoordinator) ──
  private sessionCounter = 0
  private generationCounter = 0
  private sessionState: PlaybackSessionState = { activeIdentity: null, currentVideoPath: null }

  // ── Phase-change notification for scheduler ──
  private phaseChangeListeners: Array<() => void> = []
  private lastNotifiedPhase: string = 'idle'

  /**
   * The single store for the latest PlayerStatus — owned directly by
   * the projector (previously delegated to a separate PlayerStateMachine
   * class).  All player-state reads and mutations at the application
   * layer operate on this field.
   */
  private currentStatus: PlayerStatus = PlaybackStateProjector.defaultStatus()

  constructor(private readonly eventSink: PlaybackEventSink) {
    // No event subscriptions needed — applyStatusUpdate() directly
    // drives both phase-change notifications and the projection
    // pipeline for all status changes (MediaPlayer-sourced, imperative
    // resets, error injections).
  }

  /**
   * Subscribe to phase-change notifications.
   *
   * Used by the PlaybackScheduler to drive task processing when the
   * player phase transitions (e.g. idle → loading → playing).  This
   * replaces the duplicate MediaPlayer status subscription that
   * CorePlayer previously maintained — the projector is now the sole
   * subscriber to MediaPlayer events and provides phase changes to
   * both the projection pipeline and the scheduler.
   */
  onPhaseChange(listener: () => void): void {
    this.phaseChangeListeners.push(listener)
  }

  /**
   * Subscribe to player events via the PlayerEventSource contract.
   *
   * The projector is the sole application-layer subscriber to player
   * events.  It receives the narrow PlayerEventSource interface (not
   * the full MediaPlayer) — the only four event types it actually
   * consumes are explicitly declared in the contract.
   *
   * Call once during subsystem assembly (createPlaybackSubsystem).
   */
  bind(eventSource: PlayerEventSource): void {
    // Ensure no double-binding
    this.unbind()

    // Status changes — feed directly into the projection pipeline
    // via applyStatusUpdate (no intermediate EventEmitter).
    const onStatus = (status: PlayerStatus) => {
      this.applyStatusUpdate(status)
    }

    // Session-gated relays — all non-status events are dropped when
    // no active session exists, making the projector a consistent
    // event validation boundary for ALL MediaPlayer events.  Events
    // are dispatched to the PlaybackEventSink (PlaybackEffectHandler)
    // which owns all business side-effects and broadcast delivery.

    const onTracks = (tracks: PlayerTrack[]) => {
      const identity = this.sessionState.activeIdentity
      if (!identity) return
      const gen = identity.generation
      if (this.sessionState.activeIdentity?.generation !== gen) return
      this.eventSink.handleTracksChanged(tracks)
    }

    const onProperty = (name: string, value: unknown) => {
      const identity = this.sessionState.activeIdentity
      if (!identity) return
      const gen = identity.generation
      if (this.sessionState.activeIdentity?.generation !== gen) return
      this.eventSink.handlePropertyChange(name, value)
    }

    const onPlaybackRestart = () => {
      const identity = this.sessionState.activeIdentity
      if (!identity) return
      const gen = identity.generation
      if (this.sessionState.activeIdentity?.generation !== gen) return
      this.eventSink.handlePlaybackRestart(this.sessionState.currentVideoPath)
    }

    eventSource.onStatusChange(onStatus)
    eventSource.on('tracks-change', onTracks)
    eventSource.on('property-change', onProperty)
    eventSource.on('playback-restart', onPlaybackRestart)

    this.removeListeners = () => {
      eventSource.offStatusChange(onStatus)
      eventSource.off('tracks-change', onTracks)
      eventSource.off('property-change', onProperty)
      eventSource.off('playback-restart', onPlaybackRestart)
    }
  }

  /** Remove all player event listeners. */
  unbind(): void {
    this.removeListeners?.()
    this.removeListeners = null
  }

  // ── Session-transition protocol ──
  //
  // The projector is the sole gateway for session-related state
  // changes.  VideoPlayerApp calls these methods at lifecycle
  // boundaries; the projector manages session identity, switching
  // flag, and dedup cache internally.

  /**
   * Mark the start of a video transition.
   * Called by VideoPlayerApp before stopping the current video.
   * The switching flag auto-clears when the projector sees a terminal
   * phase (playing / error / ended).
   */
  beginTransition(): void {
    this.isSwitching = true
  }

  /**
   * Abort a session-start attempt that failed before a new session was
   * established (e.g. playback-window preparation failed).
   *
   * Performs a full state reset — clears switching flag, session identity,
   * dedup cache, and resets the player status to idle.  If an
   * active video was stopped as part of the transition, this produces a
   * clean idle snapshot so the UI doesn't show stale video info.
   */
  cancelTransition(): void {
    this.resetAll()
  }

  /**
   * Prepare the projection layer for a new playback session.
   *
   * Two-phase operation:
   *  1. **Teardown**: full reset of the previous session — clears session
   *     identity, switching flag, dedup cache, and resets the player
   *     player status to idle.  The idle emission flows through the
   *     projection pipeline with no session annotation (identity was
   *     cleared first).  This makes the projector the sole owner of
   *     ALL player-state resets at session boundaries (start, close,
   *     shutdown) — VideoPlayerApp no longer calls resetStatus()
   *     directly.
   *  2. **Setup**: establishes new session identity.  The caller
   *     (VideoPlayerApp) is responsible for broadcasting the current-
   *     changed notification — the projector is decoupled from
   *     broadcast delivery.
   */
  prepareNewSession(target: { path: string }): void {
    // Phase 1: clean teardown of old session + player state
    this.resetAll()

    // Phase 2: establish new session identity
    this.sessionCounter += 1
    this.generationCounter += 1
    this.sessionState = {
      activeIdentity: {
        requestId: `play-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId: this.sessionCounter,
        generation: this.generationCounter,
      },
      currentVideoPath: target.path,
    }
    // Re-invalidate dedup cache so the first status of the new session
    // is always broadcast, even if field values happen to match the
    // idle snapshot emitted by resetAll().
    this.lastBroadcastStatus = null
  }

  /**
   * Reset all session and projection state, producing a clean idle
   * snapshot.
   *
   * Single public method for session teardown — called on playback
   * window close, app shutdown, and as a building block by
   * prepareNewSession (which resets before establishing a new session).
   *
   * Clears session identity, switching flag, dedup cache, and resets
   * the player status to idle.  The idle emission flows through the
   * projection pipeline and is broadcast as an identity-free snapshot.
   */
  resetSession(): void {
    this.resetAll()
  }

  // ── Player-state authority ──
  //
  // The projector is the sole application-layer authority for player-
  // state reads and imperative mutations.  All phase checks, error
  // injections, and status resets from VideoPlayerApp / intent handler
  // route through these methods.

  /**
   * Read the current player phase.
   *
   * Single authority for application-layer state reads — the
   * VideoPlayerApp uses this for pre-play stop decisioning, and the
   * intent handler for play-vs-resume decisioning.  Also serves as
   * the phase source for the PlaybackScheduler.
   */
  getPlayerPhase(): string {
    return this.currentStatus.phase
  }

  /**
   * Whether a video is actively loaded (loading, playing, or paused).
   *
   * Convenience wrapper over getPlayerPhase — VideoPlayerApp uses
   * this for pre-play stop decisioning.
   */
  hasActiveVideo(): boolean {
    const phase = this.getPlayerPhase()
    return phase === 'loading' || phase === 'playing' || phase === 'paused'
  }

  /**
   * Inject an error state into the player status.
   *
   * Called by VideoPlayerApp when a play attempt fails.  The status
   * update flows through applyStatusUpdate → projectStatus to
   * broadcast the error to the UI.
   */
  handlePlayError(message: string): void {
    this.applyStatusUpdate({
      ...this.currentStatus,
      phase: 'error',
      errorMessage: message,
      isSeeking: false,
    })
  }

  // ── Internal ──

  /**
   * Unified status-projection pipeline.
   *
   * All status updates (MediaPlayer-sourced, imperative resets, error
   * injections) flow through this single method:
   *
   *  1. Stale-status filter (path mismatch with active session)
   *  2. Enrich with session identity + switching flag
   *  3. Deduplication (skip unchanged snapshots)
   *  4. Dispatch to PlaybackEventSink for business side-effects +
   *     broadcast delivery
   */
  private projectStatus(status: PlayerStatus): void {
    // ── Stale-status filter ──
    // Two-layer check:
    //  1. Path mismatch: catches cross-file stale events
    //  2. Generation mismatch: catches same-file replay stale events
    //     (e.g. error retry on same video)
    const sessionState = this.sessionState
    if (!sessionState.activeIdentity) {
      // No active session — only allow idle/stopped phases through
      // (these come from resetAll and are legitimate)
      if (status.phase !== 'idle' && status.phase !== 'stopped') {
        return
      }
    } else {
      // Path mismatch filter
      if (sessionState.currentVideoPath && status.path && status.path !== sessionState.currentVideoPath) {
        logger.debug('Ignored stale player status by path mismatch', {
          expected: sessionState.currentVideoPath,
          received: status.path,
          phase: status.phase,
        })
        return
      }
    }
    // ── Assemble full UI-facing payload ──
    //  1. Attach session identity (requestId / sessionId / generation)
    //  2. Resolve switching state (auto-clears on playing/error/ended)
    const identity = sessionState.activeIdentity
    const isSwitching = this.resolveSwitchingForPhase(status.phase)
    const enriched: PlayerStatus = {
      ...status,
      ...(identity ? {
        requestId: identity.requestId,
        sessionId: identity.sessionId,
        generation: identity.generation,
      } : {}),
      ...(isSwitching ? { isSwitching: true } : {}),
    }
    // ── Deduplication (skip if enriched snapshot unchanged) ──
    if (this.lastBroadcastStatus && !this.hasStatusChanged(this.lastBroadcastStatus, enriched)) {
      return
    }
    this.lastBroadcastStatus = enriched
    // Dispatch to PlaybackEventSink — the effect handler applies
    // business side-effects (watch progress, video-layer visibility)
    // and then broadcasts to playback UIs.
    this.eventSink.handleStatusProjected(enriched)
  }

  /**
   * Clear all session / projection state and produce a clean idle
   * snapshot.
   *
   * Three-phase operation:
   *  1. Clear session identity and projection state (switching, dedup)
   *  2. Notify the event sink for session-scoped cleanup (seek-thumbnail
   *     release, etc.) — before the idle emission so resources are
   *     released while the pipeline is still connected
   *  3. Reset player status to idle — the update flows through
   *     applyStatusUpdate → projectStatus with no session identity
   *
   * The session-reset notification (phase 2) makes the projection
   * pipeline symmetric: playback-restart fires on session start (first
   * frame decoded), and handleSessionReset fires on session end (before
   * idle emission).  The effect handler uses these two events to manage
   * session-scoped resources (seek-thumbnail init/destroy).
   */
  private resetAll(): void {
    this.sessionState = { activeIdentity: null, currentVideoPath: null }
    this.isSwitching = false
    this.lastBroadcastStatus = null
    // Session-scoped cleanup — before idle emission so resources are
    // released while event listeners are still connected.
    this.eventSink.handleSessionReset()
    // Reset to idle, preserving volume and HDR across sessions
    this.applyStatusUpdate({
      ...PlaybackStateProjector.defaultStatus(),
      volume: this.currentStatus.volume,
      hdrEnabled: this.currentStatus.hdrEnabled,
    })
  }

  /**
   * Change-detection: compare two enriched PlayerStatus snapshots.
   * Returns `true` when at least one field differs — meaning the
   * projector should broadcast.
   *
   * This is the single place that decides whether a new snapshot is
   * worth propagating to the renderer (via IPC) and to side-effect
   * handlers.
   */
  private hasStatusChanged(prev: PlayerStatus, next: PlayerStatus): boolean {
    return (
      prev.phase !== next.phase ||
      prev.currentTime !== next.currentTime ||
      prev.duration !== next.duration ||
      prev.volume !== next.volume ||
      prev.path !== next.path ||
      prev.errorMessage !== next.errorMessage ||
      prev.isPaused !== next.isPaused ||
      prev.isSeeking !== next.isSeeking ||
      prev.isNetworkBuffering !== next.isNetworkBuffering ||
      prev.networkBufferingPercent !== next.networkBufferingPercent ||
      JSON.stringify(prev.bufferRanges) !== JSON.stringify(next.bufferRanges) ||
      prev.hdrEnabled !== next.hdrEnabled ||
      prev.isSwitching !== next.isSwitching ||
      prev.requestId !== next.requestId ||
      prev.sessionId !== next.sessionId ||
      prev.generation !== next.generation
    )
  }

  /**
   * Apply a new PlayerStatus: log phase transitions, store the status,
   * notify phase-change listeners (for the scheduler), and run the
   * projection pipeline.
   *
   * This is the single entry point for ALL state mutations — MediaPlayer-
   * sourced updates, imperative resets, and error injections all converge
   * here.  Previously this was a subscription to a separate
   * PlayerStateMachine's 'state' event; absorbing it eliminates the
   * intermediate EventEmitter layer.
   */
  private applyStatusUpdate(next: PlayerStatus): void {
    const prev = this.currentStatus
    if (prev.phase !== next.phase) {
      logger.debug('Player phase changed', {
        prev: prev.phase,
        next: next.phase,
      })
    }
    this.currentStatus = next

    // Notify phase-change listeners (for PlaybackScheduler) BEFORE
    // the projection pipeline — the scheduler needs to react to
    // phase transitions regardless of stale-status filtering.
    if (next.phase !== this.lastNotifiedPhase) {
      this.lastNotifiedPhase = next.phase
      for (const listener of this.phaseChangeListeners) {
        listener()
      }
    }
    this.projectStatus(next)
  }

  /** Construct a clean idle PlayerStatus with default values. */
  private static defaultStatus(): PlayerStatus {
    return {
      phase: 'idle',
      currentTime: 0,
      duration: 0,
      volume: 100,
      path: null,
      isPaused: false,
      isSeeking: false,
      isNetworkBuffering: false,
      networkBufferingPercent: 0,
      bufferRanges: [],
      hdrEnabled: false,
    }
  }

  /**
   * Auto-clear switching state based on a player phase transition.
   * Returns the (possibly updated) switching value to attach to the broadcast.
   */
  private resolveSwitchingForPhase(phase: string): boolean {
    if (!this.isSwitching) return false
    if (phase === 'playing' || phase === 'error' || phase === 'ended') {
      this.isSwitching = false
      return false
    }
    return true
  }
}
