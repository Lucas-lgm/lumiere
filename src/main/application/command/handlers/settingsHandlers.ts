import { ipcMain, app, shell } from 'electron'
import { IPC_CHANNELS } from '../ipcConstants'
import type { AppSettings } from '../../config/configManager'
import { DEFAULT_APP_SETTINGS } from '../../config/configManager'
import type { SettingsPort } from '../ipcTypes'
import { createLogger } from '../../../infrastructure/logging'

const logger = createLogger('Settings')

/**
 * Settings IPC handlers — pure routing layer.
 *
 * All access routes through SettingsPort (AppSettingsBridge) — the
 * single settings lifecycle boundary.  AppSettingsBridge owns reads
 * (delegated to ConfigManager) AND writes (persist + react).
 *
 * Previously, this handler received both ConfigManager (reads) and
 * AppSettingsBridge (writes) — a split boundary that allowed
 * unsupervised write access to ConfigManager.  Consolidating through
 * SettingsPort eliminates that ambiguity.
 */
export function setupSettingsHandlers(settings: SettingsPort): void {
  // Get full settings — reads through SettingsPort (AppSettingsBridge)
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (): AppSettings => {
    return settings.getAppSettings()
  })

  // Set individual setting — SettingsPort owns persist + all reactions
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, key: string, value: any) => {
    if (!(key in DEFAULT_APP_SETTINGS)) return
    await settings.setAppSetting(key as keyof AppSettings, value)
    logger.info('Setting changed', { key, value })
  })

  // Reset all settings — SettingsPort owns persist + all reactions
  ipcMain.handle(IPC_CHANNELS.SETTINGS_RESET, async () => {
    await settings.resetAppSettings()
    logger.info('Settings reset to defaults')
    return settings.getAppSettings()
  })

  // Open log directory
  ipcMain.handle(IPC_CHANNELS.LOG_OPEN_DIR, async () => {
    await shell.openPath(app.getPath('logs'))
  })
}
