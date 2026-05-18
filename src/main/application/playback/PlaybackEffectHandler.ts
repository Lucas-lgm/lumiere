import type { PlayerStatus, PlayerTrack } from './MediaPlayer'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('PlaybackEffectHandler')

// ── Narrow port interfaces ──
//
// The effect handler references its external dependencies through narrow
// typed contracts — the same decoupling pattern used by all playback
// subsystem consumers:
//   - SessionStatePort / SessionCommandPort (coordinator ← projector/scheduler)
//   - SessionWindowPort (coordinator ← windowManager)
//   - PlayConfigPort (coordinator ← settingsBridge)
//   - PlayerSurface / PlaybackControlPort (windowManager ← player/scheduler)
//
// This makes the playback subsystem factory's external dependency surface
// fully explicit — every capability imported from outside the subsystem is
// declared through a minimal interface.

/**
 * Narrow interface for watch-progress persistence used by the effect
 * handler.
 *
 * Covers the two progress-mutation operations needed during playback:
 * mark a video as completed (ended phase) and update in-flight progress
 * (playing/paused/stopped phases).  ConfigManager satisfies this
 * interface structurally — the subsystem factory passes it directly.
 *
 * Policy enforcement (rememberProgress) is internal to the implementor —
 * the effect handler calls unconditionally; the ConfigManager no-ops
 * when the setting is disabled.
 */
export interface WatchProgressPort {
  /** Mark a video as completed (called on ended phase). */
  markCompleted(path: string): void
  /** Update in-flight watch progress (called on playing/paused/stopped phases). */
  updateWatchProgress(path: string, currentTime: number, duration: number): void
}

/**
 * Narrow interface for seek-thumbnail lifecycle used by the effect
 * handler.
 *
 * Covers the complete session-scoped seek-thumbnail lifecycle:
 *   - **initSeekThumbnail**: post-load initialisation (first frame
 *     decoded) — creates the persistent seek instance for the newly
 *     loaded video
 *   - **destroySeekThumbnail**: session-end cleanup — releases the
 *     persistent seek instance when the session resets (video ended,
 *     window close, app shutdown, new session start)
 *
 * ThumbnailService satisfies this interface structurally.
 *
 * Policy enforcement (autoThumbnail) is internal to the implementor —
 * initSeekThumbnail no-ops when the setting is disabled.
 *
 * Previously, the destroy half of the lifecycle was only reachable from
 * the renderer via IPC (THUMBNAIL_SEEK_DESTROY).  Adding it to the port
 * interface completes the subsystem's lifecycle ownership — the main
 * process can now manage both ends of the seek-thumbnail lifecycle
 * through playback lifecycle events, without depending on the renderer
 * to issue a cleanup call.
 */
export interface SeekThumbnailPort {
  /** Initialise a persistent seek-thumbnail instance for the given video. */
  initSeekThumbnail(videoPath: string): Promise<boolean>
  /** Release the persistent seek-thumbnail instance (session cleanup). */
  destroySeekThumbnail(): void
}

/**
 * Narrow interface for window-topology-dependent operations used by
 * the effect handler.
 *
 * Covers the five interaction patterns:
 *   - **setVideoLayerVisible**: toggle the native video layer based on
 *     the current playback phase
 *   - **broadcastPlayerStatus**: push validated status snapshots to all
 *     playback UIs
 *   - **broadcastTracksChanged**: push session-gated track updates
 *   - **broadcastPropertyChange**: push session-gated property updates
 *   - **handlePlaybackRestart**: trigger auto-fit window lifecycle on
 *     playback-restart (first frame decoded)
 *
 * PlaybackWindowManager satisfies this interface structurally — the
 * subsystem factory passes it directly.  This completes the
 * port-boundary pattern: every effect handler dependency is now
 * referenced through a narrow typed contract (WatchProgressPort,
 * SeekThumbnailPort, EffectDeliveryPort).
 */
/**
 * Narrow interface for video enhancement (shader) lifecycle.
 * AppSettingsBridge satisfies this interface.
 */
export interface VideoEnhancementPort {
  updateEnhancementForVideo(videoWidth: number, videoHeight: number, fps?: number): Promise<void>
}

export interface EffectDeliveryPort {
  /** Toggle the native video layer visibility. */
  setVideoLayerVisible(visible: boolean): void
  /** Push a validated player-status snapshot to playback UIs. */
  broadcastPlayerStatus(status: PlayerStatus): void
  /** Push a tracks-change update to playback UIs. */
  broadcastTracksChanged(tracks: PlayerTrack[]): void
  /** Push a property-change update to playback UIs. */
  broadcastPropertyChange(name: string, value: unknown): void
  /** Handle playback-restart event (auto-fit lifecycle). */
  handlePlaybackRestart(currentPath: string | null): Promise<void>
  /** Get current video resolution and frame rate. */
  getVideoResolution(): Promise<{ width: number; height: number; fps: number }>
}

// ── Projector event sink interface ──

/**
 * Typed contract for all playback lifecycle events emitted by the
 * PlaybackStateProjector.
 *
 * The projector is the sole subscriber to MediaPlayer events.  After
 * validation, enrichment, and deduplication, it relays events through
 * this interface to the application layer.  PlaybackEffectHandler
 * implements this interface — making it the single boundary between
 * the projector (state authority) and the rest of the application
 * (services, window manager, broadcasts).
 *
 * The interface covers the complete session lifecycle:
 *   - **handlePlaybackRestart**: session-start (first frame decoded)
 *   - **handleStatusProjected**: continuous session updates
 *   - **handleTracksChanged / handlePropertyChange**: session-gated relays
 *   - **handleSessionReset**: session-end (cleanup before idle emission)
 *
 * Previously these were 4 individual callback closures wired by
 * VideoPlayerApp in its constructor.  Consolidating into a typed
 * interface makes the projector → effect-handler relationship explicit
 * and eliminates the pass-through relay in VideoPlayerApp.
 */
export interface PlaybackEventSink {
  /** Validated, enriched, deduplicated player-status update. */
  handleStatusProjected(status: PlayerStatus): void
  /** Playback-restart event (first frame decoded), session-gated. */
  handlePlaybackRestart(currentPath: string | null): void
  /** Tracks-change event, session-gated. */
  handleTracksChanged(tracks: PlayerTrack[]): void
  /** Property-change event, session-gated. */
  handlePropertyChange(name: string, value: unknown): void
  /**
   * Session-reset event — fired by the projector when the session is
   * being torn down (before idle emission).
   *
   * Handles cleanup side-effects that should run at session boundaries:
   * seek-thumbnail instance release, and potentially other future
   * session-scoped resource cleanup.
   *
   * Fired on all resetAll() paths: explicit session end (window close,
   * shutdown), transition cancellation (failed session start), and
   * new-session preparation (cleanup old before establishing new).
   * Idempotent — safe to call multiple times in succession.
   */
  handleSessionReset(): void
}

/**
 * Sole application-layer handler for all playback lifecycle events
 * emitted by the PlaybackStateProjector.
 *
 * Implements the PlaybackEventSink interface — the projector relays
 * all validated events here.  This handler owns:
 *
 *  1. **handleStatusProjected** — the continuous status-update handler:
 *     - Watch-progress persistence (via WatchProgressPort, policy-gated
 *       internally by the implementor's rememberProgress enforcement)
 *     - Video-layer visibility toggling (window-state concern)
 *     - Status broadcast to playback UIs (window-topology concern)
 *
 *  2. **handlePlaybackRestart** — the post-load handler (first frame
 *     decoded):
 *     - Seek-thumbnail initialization (via SeekThumbnailPort, local
 *       files only, policy-gated internally by the implementor)
 *     - Auto-fit window lifecycle (fire-and-forget, errors handled
 *       internally by the EffectDeliveryPort implementor)
 *
 *  3. **handleTracksChanged** — session-gated tracks broadcast to
 *     playback UIs
 *
 *  4. **handlePropertyChange** — session-gated property broadcast to
 *     playback UIs
 *
 * All dependencies are referenced through narrow port interfaces:
 *   - **WatchProgressPort**: progress persistence (satisfied by ConfigManager)
 *   - **SeekThumbnailPort**: seek-thumbnail lifecycle (satisfied by ThumbnailService)
 *   - **EffectDeliveryPort**: window topology + message delivery
 *     (satisfied by PlaybackWindowManager)
 *
 * This consolidation makes the effect handler the complete "playback
 * lifecycle event boundary" — the single place where all projector
 * events are dispatched to services and broadcast to UIs.
 */
export class PlaybackEffectHandler implements PlaybackEventSink {
  constructor(
    private readonly watchProgress: WatchProgressPort,
    private readonly delivery: EffectDeliveryPort,
    private readonly seekThumbnail: SeekThumbnailPort,
    private readonly videoEnhancement?: VideoEnhancementPort,
  ) {}

  /**
   * Status-driven side-effects + broadcast — the single handler for
   * validated player status updates.
   *
   * Called by the PlaybackStateProjector after the projection pipeline
   * has validated, enriched, and deduplicated the status.  This handler
   * applies business side-effects first, then broadcasts to playback
   * UIs — ordering ensures the native video layer is visible before
   * the renderer processes the status update.
   *
   * Owns:
   *  - Watch progress persistence (ended → markCompleted; playing/
   *    paused/stopped → updateWatchProgress).  The rememberProgress
   *    policy is enforced internally by the WatchProgressPort
   *    implementor — the methods are no-ops when the setting is disabled.
   *  - Video-layer visibility toggling (visible when playing or paused)
   *  - Broadcast to playback UIs (via PlaybackWindowManager)
   */
  handleStatusProjected(status: PlayerStatus): void {
    const path = status.path

    if (path) {
      if (status.phase === 'ended') {
        this.watchProgress.markCompleted(path)
      } else {
        const currentTime = status.currentTime
        if (typeof currentTime === 'number' && isFinite(currentTime) && currentTime > 0) {
          if (
            status.phase === 'playing' ||
            status.phase === 'paused' ||
            status.phase === 'stopped'
          ) {
            this.watchProgress.updateWatchProgress(path, currentTime, status.duration)
          }
        }
      }
    }

    const videoVisible = status.phase === 'playing' || status.phase === 'paused'
    this.delivery.setVideoLayerVisible(videoVisible)

    // Broadcast to playback UIs — after side-effects so the native
    // video layer is already visible when the renderer processes this.
    this.delivery.broadcastPlayerStatus(status)
  }

  /**
   * Post-load lifecycle handler — playback-restart event (first frame
   * decoded).
   *
   * Called by the PlaybackStateProjector with the session's
   * currentVideoPath — the projector enriches this event so the
   * application layer doesn't need a redundant MediaPlayer property
   * query.  Session-gated: only fires when an active session exists.
   *
   * Application-level side-effects:
   *  - Seek-thumbnail initialization (local files only, fire-and-forget;
   *    autoThumbnail policy is enforced internally by the implementor)
   *  - Auto-fit window lifecycle (fire-and-forget, errors handled
   *    internally by PlaybackWindowManager)
   */
  handlePlaybackRestart(currentPath: string | null): void {
    // Seek-thumbnail initialization (local files, fire-and-forget).
    // SeekThumbnailPort implementor enforces the autoThumbnail policy
    // internally — initSeekThumbnail no-ops when disabled.
    if (currentPath) {
      this.seekThumbnail.initSeekThumbnail(currentPath).catch(() => {})
    }

    // Video enhancement: check resolution + fps and select shader variant
    if (this.videoEnhancement) {
      this.delivery.getVideoResolution()
        .then(({ width, height, fps }) => {
          if (width > 0 && height > 0) {
            this.videoEnhancement!.updateEnhancementForVideo(width, height, fps)
          }
        })
        .catch(() => {})
    }

    // Auto-fit lifecycle (fire-and-forget, errors handled internally)
    this.delivery.handlePlaybackRestart(currentPath).catch(() => {})
  }

  /**
   * Tracks-change relay — broadcast to playback UIs.
   *
   * Session-gated by the projector (only fires when an active session
   * exists).  Previously relayed through VideoPlayerApp as a callback
   * closure; consolidated here so all projector event dispatch lives
   * in a single boundary.
   */
  handleTracksChanged(tracks: PlayerTrack[]): void {
    this.delivery.broadcastTracksChanged(tracks)
  }

  /**
   * Property-change relay — broadcast to playback UIs.
   *
   * Session-gated by the projector (only fires when an active session
   * exists).  Previously relayed through VideoPlayerApp as a callback
   * closure; consolidated here so all projector event dispatch lives
   * in a single boundary.
   */
  handlePropertyChange(name: string, value: unknown): void {
    this.delivery.broadcastPropertyChange(name, value)
  }

  /**
   * Session-reset cleanup — release session-scoped resources.
   *
   * Called by the projector before emitting the idle status on all
   * session-reset paths (window close, shutdown, transition cancel,
   * new-session preparation).  This makes the effect handler the
   * symmetric boundary for session lifecycle side-effects:
   *   - **Start** (handlePlaybackRestart): init seek thumbnail, auto-fit
   *   - **End** (handleSessionReset): destroy seek thumbnail
   *
   * Previously, seek-thumbnail cleanup was only reachable from the
   * renderer via IPC (THUMBNAIL_SEEK_DESTROY).  Moving it here ensures
   * the main process cleans up at every session boundary — including
   * app shutdown, where the renderer may not have a chance to send the
   * IPC message.
   *
   * Idempotent: destroySeekThumbnail is a no-op when no instance exists.
   */
  handleSessionReset(): void {
    this.seekThumbnail.destroySeekThumbnail()
  }
}
