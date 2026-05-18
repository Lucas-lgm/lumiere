import { ipcMain } from 'electron'
import type { PlaybackCommands } from '../../playback/PlaybackScheduler'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS } from '../ipcConstants'
import type { PlayVideoRequest, PlayerDirectPort, PlaybackIntentPort } from '../ipcTypes'
import { createLogger } from '../../../infrastructure/logging'

const logger = createLogger('PlaybackHandlers')

/**
 * Playback control IPC handlers
 *
 * Three routing boundaries:
 *   - **coordinator**: PlaybackIntentPort — orchestrated operations
 *     (play intents, control-play which decides play-from-playlist vs
 *     resume).  Only IPC-facing intent methods are accessible; subsystem-
 *     internal lifecycle methods are not visible through the port.
 *   - **commands**: PlaybackCommands — scheduled playback commands
 *     (pause, stop, seek), routed directly to the scheduler, bypassing
 *     the coordinator (these commands don't need orchestration context)
 *   - **playerOps**: PlayerDirectPort — non-orchestrated operations
 *     (tracks, HDR, keypress), routed directly to the media player
 *
 * Volume set+persist is routed through the setVolume callback —
 * AppSettingsBridge owns the complete volume lifecycle (set+persist+
 * restore), so the IPC layer stays a pure routing layer without
 * reaching into ConfigManager for persistence side-effects.
 *
 * The quit callback is the only app-lifecycle concern; it arrives as a
 * narrow function instead of the full VideoPlayerApp reference.
 */
export function setupPlaybackHandlers(
  quit: () => Promise<void>,
  coordinator: PlaybackIntentPort,
  commands: PlaybackCommands,
  playerOps: PlayerDirectPort,
  setVolume: (volume: number) => Promise<void>,
): void {
  // Play video
  ipcMain.on(IPC_CHANNELS.PLAY_VIDEO, createIpcHandler<[PlayVideoRequest]>(
    async (_event, file: PlayVideoRequest) => {
      await coordinator.handlePlayVideo(file)
    },
    undefined,
    IPC_CHANNELS.PLAY_VIDEO
  ))

  // URL play
  ipcMain.on(IPC_CHANNELS.PLAY_URL, createIpcHandler<[string]>(
    async (_event, url: string) => {
      await coordinator.handlePlayUrl(url)
    },
    undefined,
    IPC_CHANNELS.PLAY_URL
  ))

  // ── Scheduled playback commands — route directly to commands
  //    (scheduler), no orchestration context needed ──

  ipcMain.on(IPC_CHANNELS.CONTROL_PAUSE, createIpcHandler(
    async () => {
      await commands.pause()
    },
    undefined,
    IPC_CHANNELS.CONTROL_PAUSE
  ))

  // control:play is an orchestrated intent (not a simple command) —
  // the coordinator decides play-from-playlist vs resume based on
  // the current phase.
  ipcMain.on(IPC_CHANNELS.CONTROL_PLAY, createIpcHandler(
    async () => {
      await coordinator.handleControlPlay()
    },
    undefined,
    IPC_CHANNELS.CONTROL_PLAY
  ))

  ipcMain.on(IPC_CHANNELS.CONTROL_STOP, createIpcHandler(
    async () => {
      await commands.stop()
    },
    undefined,
    IPC_CHANNELS.CONTROL_STOP
  ))

  // Note: the renderer sends a numeric time value, not { time: number }
  // So we receive the number directly as the first argument
  ipcMain.on(IPC_CHANNELS.CONTROL_SEEK, createIpcHandler<[number]>(
    async (_event, time: number) => {
      // Ensure time is a valid number
      if (typeof time !== 'number' || isNaN(time) || time < 0) {
        throw new Error(`Invalid seek time: ${time}`)
      }
      logger.info('CONTROL_SEEK received', { time })
      await commands.seek(time)
    },
    undefined,
    IPC_CHANNELS.CONTROL_SEEK
  ))

  // ── Non-orchestrated operations — route directly to playerOps ──

  // Volume set+persist — routed through the setVolume callback
  // (AppSettingsBridge.setPlaybackVolume), which owns the complete
  // volume lifecycle.  Validation stays here (system boundary).
  ipcMain.on(IPC_CHANNELS.CONTROL_VOLUME, createIpcHandler<[number]>(
    async (_event, volume: number) => {
      // Ensure volume is a valid number
      if (typeof volume !== 'number' || isNaN(volume) || volume < 0 || volume > 130) {
        throw new Error(`Invalid volume: ${volume} (must be between 0 and 130)`)
      }
      await setVolume(volume)
    },
    undefined,
    IPC_CHANNELS.CONTROL_VOLUME
  ))

  // Note: the renderer sends a boolean enabled value, not { enabled: boolean }
  ipcMain.on(IPC_CHANNELS.CONTROL_HDR, createIpcHandler<[boolean]>(
    async (_event, enabled: boolean) => {
      // Ensure enabled is a boolean
      if (typeof enabled !== 'boolean') {
        throw new Error(`Invalid HDR enabled value: ${enabled} (must be boolean)`)
      }
      playerOps.setHdrEnabled(enabled)
    },
    undefined,
    IPC_CHANNELS.CONTROL_HDR
  ))

  // Track-related controls: get track list / switch audio track / switch subtitles
  ipcMain.handle(IPC_CHANNELS.CONTROL_GET_TRACKS, async () => {
    return await playerOps.getTracks()
  })

  ipcMain.on(IPC_CHANNELS.CONTROL_SET_AUDIO_TRACK, createIpcHandler<[number | null]>(
    async (_event, trackId: number | null) => {
      await playerOps.setAudioTrack(
        typeof trackId === 'number' && trackId > 0 ? trackId : null
      )
    },
    undefined,
    IPC_CHANNELS.CONTROL_SET_AUDIO_TRACK
  ))

  ipcMain.on(IPC_CHANNELS.CONTROL_SET_SUBTITLE_TRACK, createIpcHandler<[number | null]>(
    async (_event, trackId: number | null) => {
      await playerOps.setSubtitleTrack(
        typeof trackId === 'number' && trackId > 0 ? trackId : null
      )
    },
    undefined,
    IPC_CHANNELS.CONTROL_SET_SUBTITLE_TRACK
  ))

  // Forward key press to player
  ipcMain.on(IPC_CHANNELS.CONTROL_KEYPRESS, createIpcHandler<[string]>(
    async (_event, key: string) => {
      await playerOps.sendKey(key)
    },
    undefined,
    IPC_CHANNELS.CONTROL_KEYPRESS
  ))

  // Application quit — route to app's shutdown sequence via narrow callback
  ipcMain.on(IPC_CHANNELS.CONTROL_QUIT, createIpcHandler(
    async () => {
      await quit()
    },
    undefined,
    IPC_CHANNELS.CONTROL_QUIT
  ))
}
