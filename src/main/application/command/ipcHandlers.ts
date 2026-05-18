import type { PlaybackCommands } from '../playback/PlaybackScheduler'
import type { AppSettingsBridge } from '../config/appSettingsBridge'
import type { ThumbnailService } from '../services/thumbnailService'
import type { WhisperService } from '../services/whisperService'
import type { AnimExportService } from '../services/animExportService'
import type { MountPathService } from '../services/mountPathService'
import type { PlaybackIntentPort, WindowOpsPort, PlayerDirectPort, SettingsPort, WatchProgressQueryPort, ThemeConfigPort } from './ipcTypes'
import { setupFileHandlers } from './handlers/fileHandlers'
import { setupPlaybackHandlers } from './handlers/playbackHandlers'
import { setupPlaylistHandlers } from './handlers/playlistHandlers'
import { setupWindowHandlers } from './handlers/windowHandlers'
import { setupMountPathHandlers } from './handlers/mountPathHandlers'

import { setupDebugHandlers } from './handlers/debugHandlers'
import { setupWatchProgressHandlers } from './handlers/watchProgressHandlers'
import { setupThumbnailHandlers } from './handlers/thumbnailHandlers'
import { setupPlayerPropertyHandlers } from './handlers/playerPropertyHandlers'
import { setupThemeHandlers, type ThemeOps } from './handlers/themeHandlers'
import { setupSettingsHandlers } from './handlers/settingsHandlers'
import { setupTranscriptionHandlers } from './handlers/transcriptionHandlers'
import { setupAnimExportHandlers } from './handlers/animExportHandlers'

/**
 * Explicit deps for IPC handler registration.
 *
 * Decoupled from VideoPlayerApp — receives narrow function interfaces
 * for app-level operations (openFile, quit), port interfaces for
 * playback-subsystem surfaces and config/settings, and direct service
 * refs for domain operations.  The IPC handler layer never sees the
 * app container, playback-subsystem concrete types, or the full
 * ConfigManager.
 *
 * Playback-subsystem routing (via narrow port interfaces):
 *   - **coordinator**: PlaybackIntentPort — orchestrated play intents
 *     (file/URL play, play/resume decision).  Subsystem-internal
 *     methods (teardownSession, handlePlaybackWindowClosed) are not
 *     accessible.
 *   - **windowManager**: WindowOpsPort — user-initiated window
 *     operations + control-layer message delivery.  Subsystem-internal
 *     methods (teardown, broadcastPlayerStatus, etc.) are not
 *     accessible.
 *   - **commands**: PlaybackCommands — scheduled playback commands
 *     (pause, stop, seek), already a port interface.
 *   - **playerOps**: PlayerDirectPort — non-orchestrated player
 *     operations (tracks, HDR, keypress, properties, debug), already
 *     a port interface.
 *   - **settingsBridge.setPlaybackVolume**: volume set+persist — routed
 *     through AppSettingsBridge, which owns the complete volume lifecycle
 *
 * Config/settings routing (via narrow port interfaces):
 *   - **settings**: SettingsPort — all settings access (reads + writes)
 *     through AppSettingsBridge, the single settings lifecycle manager.
 *     Previously, IPC handlers received ConfigManager directly for
 *     reads — allowing unsupervised write access that could bypass
 *     AppSettingsBridge's reaction pipeline.
 *   - **watchProgress**: WatchProgressQueryPort — watch-progress queries
 *     + clear, narrowed from ConfigManager.  Write operations
 *     (updateWatchProgress, markCompleted) are consumed by the playback
 *     subsystem via WatchProgressPort — not accessible from IPC.
 */
export interface IpcHandlerDeps {
  /** Route a file path through the app's file-open pipeline (main window + focus). */
  openFile: (path: string) => void
  /** Trigger the app's shutdown sequence. */
  quit: () => Promise<void>
  /** Orchestrated play intents (PlaybackCoordinator via PlaybackIntentPort). */
  coordinator: PlaybackIntentPort
  /** Scheduled playback commands — direct routing to scheduler. */
  commands: PlaybackCommands
  /** Playlist broadcast — relay playlist data to all renderers. */
  broadcastPlaylist: (items: any[]) => void
  /** Window operations + control-layer delivery (PlaybackWindowManager via WindowOpsPort). */
  windowManager: WindowOpsPort
  /** Direct media player operations (non-orchestrated). */
  playerOps: PlayerDirectPort
  /** Settings reads + writes (AppSettingsBridge via SettingsPort). */
  settings: SettingsPort
  /** Volume set+persist (AppSettingsBridge — complete volume lifecycle owner). */
  setVolume: (volume: number) => Promise<void>
  /** Watch-progress queries + clear (ConfigManager via WatchProgressQueryPort). */
  watchProgress: WatchProgressQueryPort
  /** Theme preference persistence (ConfigManager via ThemeConfigPort). */
  themeConfig: ThemeConfigPort
  thumbnailService: ThumbnailService
  whisperService: WhisperService
  animExportService: AnimExportService
  mountPathService: MountPathService
}

/**
 * Return value from setupIpcHandlers — exposes handles for IPC
 * subsystems that need post-registration interaction from the
 * startup sequence.
 */
export interface IpcHandlerOps {
  /** Theme lifecycle — initial push after renderer load. */
  theme: ThemeOps
}

/**
 * IPC protocol adaptation layer: routing, parameter parsing, service method invocation, event.reply only
 * Does not contain business logic, does not hold state, does not directly send business broadcasts
 *
 * Called by VideoPlayerApp.registerIpcHandlers() — the app is the
 * single registration owner.  Sub-component refs arrive via the
 * explicit deps object, not by reaching into public fields.
 *
 * Returns IpcHandlerOps for subsystems that expose post-registration
 * lifecycle operations (currently: theme initial push).
 *
 * Split into multiple handler modules by functional domain, main file serves as the unified registration entry point
 */
export function setupIpcHandlers(deps: IpcHandlerDeps): IpcHandlerOps {
  const { openFile, quit, coordinator, broadcastPlaylist, commands, windowManager, playerOps, settings, setVolume, watchProgress, themeConfig, thumbnailService, whisperService, animExportService, mountPathService } = deps

  // Register all handlers by functional domain
  setupFileHandlers(openFile)
  setupPlaybackHandlers(quit, coordinator, commands, playerOps, setVolume)
  setupPlaylistHandlers(broadcastPlaylist)
  setupWindowHandlers(windowManager)
  setupMountPathHandlers(mountPathService)
  setupDebugHandlers(playerOps)

  // P3 Phase 1: resume progress + thumbnails
  // Watch-progress handlers route to WatchProgressQueryPort — the
  // rememberProgress policy is enforced internally by the implementor.
  // Thumbnail handlers route directly to ThumbnailService — the
  // autoThumbnail policy is enforced internally by ThumbnailService.
  setupWatchProgressHandlers(watchProgress)
  setupThumbnailHandlers(thumbnailService)

  // P3 Phase 2: player property interface (control bar + P2 panel) — route directly to playerOps
  setupPlayerPropertyHandlers(playerOps)

  // Settings persistence + IPC — all access through SettingsPort (AppSettingsBridge),
  // the single settings lifecycle boundary.  ConfigManager is not directly
  // accessible from the IPC layer for settings operations.
  setupSettingsHandlers(settings)

  // Theme lifecycle — themeHandlers owns the complete theme boundary:
  // IPC (get/set), system-theme listener, and broadcast delivery to
  // ALL renderer surfaces (BrowserWindows + control layer).  The
  // sendToControl callback bridges the control layer (WebContentsView)
  // that BrowserWindow.getAllWindows() doesn't cover.
  //
  // Theme persistence routes through ThemeConfigPort (ConfigManager) —
  // theme is a display concern stored outside AppSettings with no
  // reaction pipeline, so it has its own narrow port rather than going
  // through SettingsPort.
  const themeOps = setupThemeHandlers(
    themeConfig,
    (ch, p) => windowManager.sendToControl(ch, p),
  )

  // AI subtitle transcription
  setupTranscriptionHandlers(whisperService)

  // Animated image export
  setupAnimExportHandlers(animExportService)

  return { theme: themeOps }
}
