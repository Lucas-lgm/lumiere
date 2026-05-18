/**
 * IPC type definitions — typed contracts for IPC handler parameters
 * and narrow port interfaces for direct (non-orchestrated) service
 * access from the IPC routing layer.
 */

import type { PlayerTrack } from '../playback/MediaPlayer'
import type { AppSettings, WatchProgress } from '../config/configManager'

/**
 * Narrow interface for non-orchestrated player operations routed
 * directly from IPC handlers to the media player.
 *
 * Covers track management, HDR, key forwarding, property access,
 * raw commands, and debug introspection — operations that don't
 * require the coordinator's orchestration (no scheduling, no playlist
 * management, no session lifecycle).
 *
 * Volume is NOT included — the IPC layer routes volume set+persist
 * through AppSettingsBridge.setPlaybackVolume(), which owns the
 * complete volume lifecycle (set + persist + restore).  MediaPlayer
 * does have a setVolume method, but the IPC routing deliberately
 * bypasses it in favour of the settings bridge boundary.
 *
 * MediaPlayer satisfies this interface structurally — VideoPlayerApp
 * passes it directly via the IPC deps object.
 */
export interface PlayerDirectPort {
  getTracks(): Promise<PlayerTrack[]>
  setAudioTrack(trackId: number | null): Promise<void>
  setSubtitleTrack(trackId: number | null): Promise<void>
  setHdrEnabled(enabled: boolean): void
  sendKey(key: string): Promise<void>
  getProperty(name: string): Promise<any>
  setProperty(name: string, value: any): Promise<void>
  command(...args: string[]): Promise<void>
  debugVideoState(): Promise<void>
  debugHdrStatus(): Promise<void>
}

// ── IPC-facing port interfaces ──
//
// Narrow contracts for playback-subsystem components consumed by the
// IPC routing layer.  Each interface exposes only the methods that IPC
// handlers actually call — subsystem-internal lifecycle methods
// (teardownSession, handlePlaybackWindowClosed, clear, teardown,
// broadcastPlayerStatus, etc.) are excluded.
//
// This extends the port-boundary pattern to the IPC → subsystem
// boundary: concrete types are visible only in the composition root
// (VideoPlayerApp) and factory (createPlaybackSubsystem); all routing
// layers see narrow port interfaces.

/**
 * Narrow interface for orchestrated play-intent operations routed
 * from IPC handlers to the PlaybackCoordinator.
 *
 * Covers the three play-intent entry points consumed by the IPC layer:
 *   - **Play intake**: handlePlayVideo, handlePlayUrl (from playbackHandlers)
 *   - **Resume**: handleControlPlay (from playbackHandlers)
 *
 * PlaybackCoordinator satisfies this interface structurally.
 *
 * NOT included (subsystem-internal):
 *   - handlePlaybackWindowClosed: consumed by windowManager → factory wiring
 *   - teardownSession: consumed by the factory's shutdown closure
 */
export interface PlaybackIntentPort {
  handlePlayVideo(file: PlayVideoRequest): Promise<void>
  handlePlayUrl(url: string): Promise<void>
  handleControlPlay(): Promise<void>
}

/**
 * Narrow interface for window operations routed directly from IPC
 * handlers to the PlaybackWindowManager.
 *
 * Covers user-initiated window operations (from windowHandlers) and
 * control-layer message delivery (from themeHandlers wiring):
 *   - **Window operations**: toggleFullscreen, togglePip, pipClose,
 *     pipReturn, togglePipSize, fitToVideo, setAspectRatioLock,
 *     handleWindowAction
 *   - **Message delivery**: sendToControl (control-layer broadcast for
 *     theme changes — the WebContentsView that BrowserWindow.getAllWindows
 *     doesn't cover)
 *
 * PlaybackWindowManager satisfies this interface structurally.
 *
 * NOT included (subsystem-internal):
 *   - prepareForPlayback, teardown (lifecycle — coordinator/factory)
 *   - broadcastPlayerStatus, broadcastTracksChanged, broadcastPropertyChange,
 *     broadcastCurrentChanged (projection pipeline — effectHandler/coordinator)
 *   - setVideoLayerVisible, handlePlaybackRestart, scheduleAutoFit
 *     (projection-driven — effectHandler/coordinator)
 *   - send, broadcastWindowState, isPip (internal broadcast/query)
 */
export interface WindowOpsPort {
  toggleFullscreen(): void
  togglePip(): boolean
  pipClose(): void
  pipReturn(): void
  togglePipSize(): void
  fitToVideo(videoWidth: number, videoHeight: number): void
  setAspectRatioLock(ratio: number): void
  handleWindowAction(action: 'close' | 'minimize' | 'maximize'): void
  /** Send to control layer (WebContentsView) — used by theme broadcast. */
  sendToControl(channel: string, payload?: unknown): void
}

// ── IPC-facing port interfaces for config/settings ──
//
// Narrow contracts for ConfigManager / AppSettingsBridge as consumed by
// the IPC routing layer.  Previously, IPC handlers received the full
// ConfigManager concrete type — giving them unsupervised write access
// that could bypass AppSettingsBridge's reaction pipeline.  These port
// interfaces close that boundary violation:
//   - SettingsPort: all settings access (reads + writes) through
//     AppSettingsBridge, the single settings lifecycle manager
//   - WatchProgressQueryPort: watch-progress queries + clear through
//     ConfigManager, narrowed to the read/clear operations IPC needs

/**
 * Narrow interface for settings operations routed from IPC handlers
 * to AppSettingsBridge.
 *
 * Covers all three IPC-facing settings operations:
 *   - **getAppSettings**: read the full settings snapshot (SETTINGS_GET)
 *   - **setAppSetting**: persist + react to a single setting (SETTINGS_SET)
 *   - **resetAppSettings**: reset all + re-apply reactions (SETTINGS_RESET)
 *
 * AppSettingsBridge satisfies this interface structurally.  This makes
 * AppSettingsBridge the single settings boundary at the IPC surface —
 * ConfigManager is no longer directly accessible from the IPC layer
 * for settings operations.
 */
export interface SettingsPort {
  getAppSettings(): AppSettings
  setAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>
  resetAppSettings(): Promise<void>
}

/**
 * Narrow interface for watch-progress query and management operations
 * routed from IPC handlers to ConfigManager.
 *
 * Covers the four IPC-facing watch-progress operations:
 *   - **getWatchProgress**: single-item query (WATCH_PROGRESS_GET)
 *   - **getAllWatchProgress**: full list (WATCH_PROGRESS_GET_ALL)
 *   - **getContinueWatching**: filtered "continue watching" list
 *   - **clearWatchProgress**: single-item deletion (WATCH_PROGRESS_CLEAR)
 *
 * ConfigManager satisfies this interface structurally.
 *
 * NOT included (consumed by other boundaries):
 *   - updateWatchProgress, markCompleted: consumed by PlaybackEffectHandler
 *     via WatchProgressPort (playback subsystem boundary)
 *   - getLastPosition: consumed by AppSettingsBridge for start-time
 *     resolution (internal to the settings boundary)
 */
export interface WatchProgressQueryPort {
  getWatchProgress(mediaPath: string): WatchProgress | null
  getAllWatchProgress(): WatchProgress[]
  getContinueWatching(): WatchProgress[]
  clearWatchProgress(path: string): void
}

/**
 * Narrow interface for theme-preference persistence used by theme
 * handlers.
 *
 * Covers the two theme-persistence operations:
 *   - **getThemePreference**: read (THEME_GET, system-theme listener)
 *   - **setThemePreference**: write (THEME_SET)
 *
 * ConfigManager satisfies this interface structurally.  Theme
 * preference is stored outside AppSettings (it's a display concern
 * with no reaction pipeline), so it has its own narrow port rather
 * than going through SettingsPort.
 */
export interface ThemeConfigPort {
  getThemePreference(): 'system' | 'light' | 'dark'
  setThemePreference(pref: 'system' | 'light' | 'dark'): void
}

/**
 * Play video IPC message
 */
export interface PlayVideoRequest {
  name: string
  path: string
  /**
   * Start playback time (seconds, optional)
   * - Passed from the frontend, used for resume playback / continue playback
   */
  startTime?: number
}

/**
 * Mount path IPC message
 */
export interface MountPathAddRequest {
  path: string
}

export interface MountPathRemoveRequest {
  id: string
}

export interface MountPathRefreshRequest {
  id: string
}

/**
 * Scan directory IPC message
 */
export interface ScanDirectoryRequest {
  path: string
}

