import { TaskQueue, Task, AddStrategy } from '../../infrastructure/scheduling/TaskQueue'
import type { Media } from '../../../../shared/types/playback'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('PlaybackScheduler')

type StatePredicate = (phase: string) => boolean

interface ScheduledTask extends Task<any> {
  condition?: StatePredicate
}

/**
 * Minimal phase-source contract for the scheduler.
 *
 * Decouples the scheduler from the PlaybackStateProjector.  The
 * projector provides this interface — it owns the player state
 * directly and emits phase-change notifications from the same
 * update path that drives the projection pipeline.
 */
export interface SchedulerPhaseSource {
  getPhase(): string
  onPhaseChange(listener: () => void): void
}

/**
 * Complete player command + lifecycle interface for the scheduler.
 *
 * Covers all six standard playback commands (play, stop, pause,
 * resume, seek) plus the terminal cleanup operation.  MediaPlayer
 * satisfies this interface structurally — the subsystem factory
 * passes it directly.
 *
 * The scheduler is the single execution boundary between the
 * application-layer coordinator and the media player — the
 * coordinator delegates ALL player interactions through the
 * scheduler's named methods.
 */
export interface PlaybackCommandTarget {
  play(media: Media, startTime?: number, startPaused?: boolean): Promise<void>
  stop(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  seek(time: number): Promise<void>
  cleanup(): Promise<void>
}

/**
 * IPC-facing subset of the scheduler's playback command interface.
 *
 * Exposes the three scheduled playback commands that don't require
 * orchestration context (playlist, session identity, settings) — they
 * are pure player commands with scheduling semantics (phase-gating,
 * conflict replacement).
 *
 * PlaybackScheduler satisfies this interface structurally.  Exposed
 * from the playback subsystem factory so IPC handlers can route these
 * commands directly, without relaying through the PlaybackCoordinator.
 *
 * Commands NOT included:
 *   - **play**: requires full session orchestration (stop existing →
 *     prepare window → establish identity → settings → execute)
 *   - **resume**: never called directly from IPC — the control:play
 *     intent goes to PlaybackCoordinator.handleControlPlay() which
 *     decides play-from-playlist vs resume based on the current phase
 */
export interface PlaybackCommands {
  pause(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
}

/**
 * Single execution boundary between the application-layer coordinator
 * and the media player — owns both command scheduling and the player
 * lifecycle (cleanup).
 *
 * Playback command policies:
 *  - **play**: clears all pending tasks, no phase condition
 *  - **stop**: clears all pending tasks, no phase condition
 *  - **pause/resume**: requires playing/paused phase, replaces
 *    existing toggle operations
 *  - **seek**: requires playing/paused phase, replaces existing seek
 *
 * Plus infrastructure lifecycle:
 *  - **shutdown**: clears the queue + terminal player cleanup
 *
 * The PlaybackCoordinator routes ALL player interactions through
 * the scheduler's named methods — it never holds a direct MediaPlayer
 * reference.  This makes the coordinator a pure orchestrator and the
 * scheduler the single boundary for command serialisation, phase-gated
 * execution, and player lifecycle.
 *
 * The scheduler's phase source is the PlaybackStateProjector (via the
 * SchedulerPhaseSource interface) — it receives phase-change
 * notifications and uses them to drive task processing.
 */
export class PlaybackScheduler {
  private isProcessing: boolean = false

  /** Phase condition shared by pause/resume/seek. */
  private static readonly PLAYING_OR_PAUSED: StatePredicate =
    (phase) => phase === 'playing' || phase === 'paused'

  constructor(
    private readonly queue: TaskQueue,
    private readonly phaseSource: SchedulerPhaseSource,
    private readonly commandTarget: PlaybackCommandTarget,
  ) {
    // Listen for phase changes to drive task execution
    this.phaseSource.onPhaseChange(() => {
      this.tryProcessNext()
    })
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Playback command methods
  //
  //  Named methods for the five standard playback commands.  Each
  //  method encapsulates the scheduling policy (condition, strategy)
  //  that is intrinsic to that command's semantics — VideoPlayerApp
  //  only needs to call the named method, not assemble scheduling
  //  metadata.
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Schedule a media-load command.
   *
   * Clears all pending tasks before execution — a new play supersedes
   * everything.  The scheduler constructs the execute function from
   * the typed parameters, delegating to the command target's play.
   */
  async play(media: Media, startTime?: number, startPaused?: boolean): Promise<void> {
    return this.schedule({
      type: 'play',
      execute: () => this.commandTarget.play(media, startTime, startPaused),
    }, undefined, 'clear_all')
  }

  /**
   * Schedule a stop command.  Clears all pending tasks.
   */
  async stop(): Promise<void> {
    return this.schedule({
      type: 'stop',
      execute: () => this.commandTarget.stop(),
    }, undefined, 'clear_all')
  }

  /**
   * Schedule a pause command.
   *
   * Requires playing/paused phase; replaces any existing toggle
   * (pause or resume) to prevent stale toggles from accumulating.
   */
  async pause(): Promise<void> {
    return this.schedule({
      type: 'pause',
      id: 'playback_toggle',
      execute: () => this.commandTarget.pause(),
    }, PlaybackScheduler.PLAYING_OR_PAUSED, 'replace')
  }

  /**
   * Schedule a resume command.
   *
   * Requires playing/paused phase; replaces any existing toggle
   * (pause or resume) to prevent stale toggles from accumulating.
   */
  async resume(): Promise<void> {
    return this.schedule({
      type: 'resume',
      id: 'playback_toggle',
      execute: () => this.commandTarget.resume(),
    }, PlaybackScheduler.PLAYING_OR_PAUSED, 'replace')
  }

  /**
   * Schedule a seek command.
   *
   * Requires playing/paused phase; replaces any pending seek to
   * ensure only the latest seek position is applied.
   */
  async seek(time: number): Promise<void> {
    const safeTime = Math.max(0, time)
    return this.schedule({
      type: 'seek',
      id: 'seek',
      meta: { time: safeTime },
      execute: () => this.commandTarget.seek(safeTime),
    }, PlaybackScheduler.PLAYING_OR_PAUSED, 'replace')
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════════════

  clear(): void {
    this.queue.clear()
  }

  /**
   * Terminal shutdown — clear the queue and release player infrastructure.
   *
   * Called by the subsystem factory's shutdown function as the final
   * player-facing operation.  After this call, the command target
   * (MediaPlayer) is no longer usable.  The window pool is destroyed
   * separately by the window manager (after the player has released
   * native handles).
   */
  async shutdown(): Promise<void> {
    this.clear()
    await this.commandTarget.cleanup().catch(() => {})
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Internal scheduling
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Submit a task with an optional phase condition and conflict
   * strategy.
   *
   * Internal method — the five playback command methods above are
   * the public API.  Each encapsulates the scheduling policy
   * (condition, strategy) appropriate for that command type.
   */
  private async schedule<T>(task: Task<T>, condition?: StatePredicate, strategy: AddStrategy = 'append'): Promise<T> {
    // Wrap the task with a condition
    const scheduledTask: ScheduledTask = { ...task, condition }

    // Enqueue
    const promise = this.queue.add(scheduledTask, strategy)

    // Attempt to drive
    this.tryProcessNext()

    return promise
  }

  /**
   * Attempt to process the next task
   * Only executes when not currently processing and the head task meets the condition
   */
  private async tryProcessNext(): Promise<void> {
    if (this.isProcessing || this.queue.isEmpty) {
      return
    }

    const task = this.queue.peek() as ScheduledTask | undefined
    if (!task) return

    const currentPhase = this.phaseSource.getPhase()

    // Check condition
    if (task.condition && !task.condition(currentPhase)) {
      logger.debug(`Task blocked: ${task.type} (waiting for state match, current: ${currentPhase})`, {
        meta: task.meta
      })
      // Condition not met, skip execution, return directly
      // Wait for the next state change to trigger tryProcessNext
      return
    }

    // Condition met, start execution
    this.isProcessing = true
    try {
      await this.queue.processNext()
    } finally {
      this.isProcessing = false
      // After task execution, the state may have changed, or there may be other tasks in the queue
      // Continue trying to process the next one (recursive drive)
      this.tryProcessNext()
    }
  }
}
