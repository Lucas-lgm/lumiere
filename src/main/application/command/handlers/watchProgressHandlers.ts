import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../ipcConstants'
import type { WatchProgressQueryPort } from '../ipcTypes'

/**
 * Resume progress IPC handlers
 *
 * Provides watch-progress query and management endpoints consumed by
 * P1 (resource library frontend).  The rememberProgress policy is
 * enforced internally by the implementor — read methods return
 * null/empty and write methods no-op when the setting is disabled.
 * Handlers here are pure routing with no business logic.
 *
 * Receives WatchProgressQueryPort (narrowed from ConfigManager) — only
 * the query + clear operations needed by IPC.  Write operations
 * (updateWatchProgress, markCompleted) are consumed by the playback
 * subsystem via WatchProgressPort and are not accessible here.
 */
export function setupWatchProgressHandlers(watchProgress: WatchProgressQueryPort): void {
  // Get watch progress for a specific media
  ipcMain.handle(IPC_CHANNELS.WATCH_PROGRESS_GET, (_event, mediaPath: string) => {
    return watchProgress.getWatchProgress(mediaPath)
  })

  // Get all watch progress
  ipcMain.handle(IPC_CHANNELS.WATCH_PROGRESS_GET_ALL, () => {
    return watchProgress.getAllWatchProgress()
  })

  // Get "continue watching" list
  ipcMain.handle(IPC_CHANNELS.WATCH_PROGRESS_CONTINUE_WATCHING, () => {
    return watchProgress.getContinueWatching()
  })

  // Clear watch progress for a specific media
  ipcMain.handle(IPC_CHANNELS.WATCH_PROGRESS_CLEAR, (_event, mediaPath: string) => {
    watchProgress.clearWatchProgress(mediaPath)
  })
}
