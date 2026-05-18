import { PlaybackScheduler, type PlaybackCommands, type PlaybackCommandTarget } from './PlaybackScheduler'
import { PlaybackCoordinator, type PlaybackCoordinatorDeps, type PlayConfigPort } from './PlaybackCoordinator'
import { PlaybackWindowManager, type PlayerSurface } from './PlaybackWindowManager'
import { PlaybackStateProjector, type PlayerEventSource } from './PlaybackStateProjector'
import { PlaybackEffectHandler, type WatchProgressPort, type SeekThumbnailPort, type VideoEnhancementPort } from './PlaybackEffectHandler'
import { TaskQueue } from '../../infrastructure/scheduling/TaskQueue'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('PlaybackSubsystem')

// ── Composite player port ──
//
// The playback subsystem requires three distinct capability slices from
// the media player, consumed by three internal components:
//   - PlayerEventSource → projector (event subscription / unsubscription)
//   - PlayerSurface → windowManager (native handle binding, surface sync,
//     engine warm-up, key forwarding, property reads)
//   - PlaybackCommandTarget → scheduler (play, stop, pause, resume, seek,
//     terminal cleanup)
//
// The intersection type makes the factory's player requirements explicit
// at the function signature — callers see exactly which capabilities the
// subsystem needs, rather than the full ~25-method MediaPlayer interface.

/**
 * Composite port interface for the media player as seen by the playback
 * subsystem.
 *
 * Intersection of the three narrow port interfaces consumed by internal
 * components.  MediaPlayer satisfies this type structurally — the app
 * container passes it directly.
 *
 * Completing the port-boundary pattern: every external dependency
 * crossing the subsystem boundary is now declared through an explicit
 * typed contract (WatchProgressPort, PlayConfigPort, SeekThumbnailPort,
 * PlaybackCoordinatorDeps, and now SubsystemPlayerPort).
 */
export type SubsystemPlayerPort = PlayerEventSource & PlayerSurface & PlaybackCommandTarget

// Note: ALL subsystem-internal consumers reference their dependencies
// through narrow port interfaces — the factory wires concrete objects
// that satisfy these interfaces structurally:
//   - coordinator: SessionStatePort ← projector, SessionCommandPort ← scheduler,
//     SessionWindowPort ← windowManager, PlayConfigPort ← playConfig
//   - effectHandler: WatchProgressPort ← watchProgress, EffectDeliveryPort ← windowManager,
//     SeekThumbnailPort ← seekThumbnail
//   - windowManager: PlayerSurface ← mediaPlayer, PlaybackControlPort ← scheduler
//   - scheduler: SchedulerPhaseSource ← projector, PlaybackCommandTarget ← mediaPlayer
//   - projector: PlayerEventSource ← mediaPlayer (via bind)
//
// All factory parameters are narrowed to port interfaces — no full
// concrete type crosses the subsystem boundary.

/**
 * Assemble the playback subsystem — the complete internal object graph
 * for playback lifecycle management.
 *
 * Creates and wires all internal components:
 *   PlaybackEffectHandler (event sink for side-effects)
 *   → PlaybackStateProjector (state authority + projection pipeline)
 *   → PlaybackScheduler (phase-driven command serialisation)
 *   → PlaybackCoordinator (orchestration boundary)
 * with PlaybackWindowManager as the window-lifecycle boundary.
 *
 * Internal components (effectHandler, projector, scheduler, taskQueue)
 * are encapsulated — callers receive four external surfaces:
 *   - **coordinator**: playback intent routing + session orchestration
 *     (pure orchestrator — no command relay, no infrastructure teardown)
 *   - **windowManager**: window operations + message delivery (needed
 *     by IPC handlers and AppSettingsBridge)
 *   - **commands**: scheduled playback commands (pause, stop, seek) —
 *     IPC handlers route directly here, bypassing the coordinator
 *   - **shutdown**: infrastructure teardown function — the symmetric
 *     counterpart to this factory's assembly
 *
 * All internal cross-component wiring is encapsulated here:
 *   - windowManager → coordinator (window-close playback reaction)
 *   - windowManager → scheduler (pause/resume for PIP + auto-fit)
 *   - projector → effectHandler (event sink)
 *   - scheduler → projector (phase source via SchedulerPhaseSource)
 *   - coordinator → projector (session state via SessionStatePort)
 *   - coordinator → scheduler (session commands via SessionCommandPort)
 *   - coordinator → windowManager (session window via SessionWindowPort)
 *   - coordinator → playConfig (pre-play settings + volume via PlayConfigPort)
 *   - effectHandler → watchProgress (progress persistence via WatchProgressPort)
 *   - effectHandler → windowManager (delivery + auto-fit via EffectDeliveryPort)
 *   - effectHandler → seekThumbnail (thumbnail lifecycle via SeekThumbnailPort)
 *
 * The caller provides:
 *   - **mediaPlayer**: SubsystemPlayerPort — composite of the three narrow
 *     player ports consumed internally (PlayerEventSource, PlayerSurface,
 *     PlaybackCommandTarget).  MediaPlayer satisfies this structurally.
 *   - **watchProgress**: WatchProgressPort for progress persistence (effectHandler)
 *   - **playConfig**: PlayConfigPort for pre-play settings (coordinator)
 *   - **seekThumbnail**: SeekThumbnailPort for thumbnail lifecycle (effectHandler)
 *   - **coordinatorDeps**: app-level callbacks (macOS integration + main window)
 *
 * **Symmetric lifecycle**: this factory assembles the subsystem AND
 * provides the shutdown function that tears it down completely.
 * The returned shutdown function encapsulates the full two-phase
 * protocol — session teardown (coordinator) then infrastructure
 * release (projector, scheduler, pool) — so VideoPlayerApp only
 * calls a single function without needing to know the internal
 * phase ordering.
 *
 * The commands surface is structurally satisfied by the scheduler but
 * exposes only the IPC-facing subset (pause, stop, seek) — internal
 * scheduler operations (play, clear, shutdown) remain encapsulated.
 */
export function createPlaybackSubsystem(
  mediaPlayer: SubsystemPlayerPort,
  watchProgress: WatchProgressPort,
  playConfig: PlayConfigPort,
  seekThumbnail: SeekThumbnailPort,
  coordinatorDeps: PlaybackCoordinatorDeps,
  videoEnhancement?: VideoEnhancementPort,
): {
  coordinator: PlaybackCoordinator
  windowManager: PlaybackWindowManager
  commands: PlaybackCommands
  shutdown: () => Promise<void>
} {
  // Mutable refs for lazy circular wiring — these closures are called
  // at runtime (not during construction), so the refs are always
  // assigned before first use.
  let coordinator: PlaybackCoordinator
  let scheduler: PlaybackScheduler

  // Window lifecycle boundary — owns the complete window infrastructure
  // lifecycle: pool creation/pre-warming (in constructor), controller
  // acquisition/disposal (prepareForPlayback/teardown), and pool
  // destruction (clearPool, called during shutdown below).
  //
  // Internal wiring (all via lazy refs):
  //   - onWindowClosed → coordinator.handlePlaybackWindowClosed()
  //     (playback-level cleanup after window-level cleanup completes)
  //   - PlaybackControlPort (pause/resume) ← scheduler
  //     (window-event-triggered playback reactions: PIP close, auto-fit)
  const windowManager = new PlaybackWindowManager(
    { onWindowClosed: () => coordinator.handlePlaybackWindowClosed() },
    mediaPlayer,
    { pause: () => scheduler.pause(), resume: () => scheduler.resume() },
  )

  // Reactive projection subsystem — effectHandler is the projector's
  // event sink (implements PlaybackEventSink), receiving all validated
  // lifecycle events for side-effects and broadcast delivery.
  // External deps arrive as narrow ports: WatchProgressPort for progress
  // persistence, SeekThumbnailPort for thumbnail lifecycle.
  const effectHandler = new PlaybackEffectHandler(watchProgress, windowManager, seekThumbnail, videoEnhancement)
  const projector = new PlaybackStateProjector(effectHandler)

  // Command scheduler — uses the projector as its phase source and
  // the media player as its command target.
  const taskQueue = new TaskQueue()
  scheduler = new PlaybackScheduler(taskQueue, {
    getPhase: () => projector.getPlayerPhase(),
    onPhaseChange: (cb) => projector.onPhaseChange(cb),
  }, mediaPlayer)

  // Orchestration boundary — owns intent routing, session orchestration,
  // and session teardown.  ALL dependencies are narrow port interfaces:
  // projector (SessionStatePort), windowManager (SessionWindowPort),
  // scheduler (SessionCommandPort), playConfig (PlayConfigPort).
  // The coordinator doesn't import any concrete subsystem type — each
  // peer is referenced through the minimal contract it actually uses.
  // Infrastructure teardown (projector unbind, scheduler cleanup,
  // pool destruction) is owned by the shutdown function below.
  coordinator = new PlaybackCoordinator(
    projector, windowManager, scheduler,
    playConfig, coordinatorDeps,
  )

  // Bind projector to player events (via PlayerEventSource contract) —
  // the projector is the sole subscriber.  Unbinding is owned by the
  // shutdown function below (symmetric with the bind call here).
  projector.bind(mediaPlayer)

  // Complete subsystem shutdown — symmetric teardown for what this
  // factory assembled.  Encapsulates the full two-phase protocol:
  //
  //  Phase 1: Session teardown (coordinator) — stops playback, releases
  //  the window controller, clears the playlist, and resets session
  //  state.  The idle emission flows through the projection pipeline
  //  with listeners still attached.
  //
  //  Phase 2: Infrastructure release — unbinds the projector (after
  //  idle emission), shuts down the scheduler (clear queue + MediaPlayer
  //  cleanup), and destroys the window pool (after the player releases
  //  native handles).
  //
  // VideoPlayerApp calls this single function for complete subsystem
  // shutdown — it does not need to know the internal phase ordering.
  // This makes the factory the symmetric lifecycle owner: it assembles
  // the subsystem AND tears it down in the correct order.
  const shutdown = async () => {
    // Phase 1: session teardown
    await coordinator.teardownSession()
    // Phase 2: infrastructure release
    projector.unbind()
    await scheduler.shutdown()
    // Destroy the window pool last — after the player has released
    // native handles (scheduler.shutdown) and the controller has been
    // returned to the pool (coordinator.teardownSession → teardown).
    windowManager.clearPool()
  }

  // The scheduler satisfies PlaybackCommands structurally — expose it
  // as the IPC-facing command surface.  IPC handlers route pause/stop/
  // seek here directly; the coordinator is no longer a relay for these.
  return { coordinator, windowManager, commands: scheduler, shutdown }
}
