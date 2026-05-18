import { ipcMain, nativeTheme, BrowserWindow } from 'electron'
import { IPC_CHANNELS, IPC_RESPONSE_CHANNELS } from '../ipcConstants'
import type { ThemeConfigPort } from '../ipcTypes'

export type ThemePreference = 'system' | 'light' | 'dark'

interface ThemeInfo {
  preference: ThemePreference
  resolved: 'light' | 'dark'
}

/**
 * Return value from setupThemeHandlers — exposes the initial theme
 * push so the startup sequence can trigger it at the right moment
 * (after the renderer has loaded).
 */
export interface ThemeOps {
  /** Broadcast the current resolved theme to all renderers. */
  pushCurrentTheme: () => void
}

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
  return preference
}

/**
 * Single owner of the complete theme lifecycle: IPC handlers (get/set),
 * system-theme listener, and broadcast delivery.
 *
 * Broadcasts reach ALL renderer surfaces — both BrowserWindows (main
 * window + playback window) and the WebContentsView control layer —
 * via BrowserWindow.getAllWindows() plus the sendToControl callback.
 * Previously the control layer was missed by the standalone
 * broadcastTheme function, causing theme changes to not reach the
 * player controls during playback.
 *
 * Receives ThemeConfigPort (narrowed from ConfigManager) for theme
 * preference persistence.  Theme is a display concern stored outside
 * AppSettings (no reaction pipeline needed), so it has its own narrow
 * port rather than going through SettingsPort.
 *
 * Returns ThemeOps so the startup sequence can trigger the initial
 * theme push after the renderer has loaded — previously this was
 * inline code in VideoPlayerApp.start() that duplicated the resolve
 * + broadcast logic.
 */
export function setupThemeHandlers(
  config: ThemeConfigPort,
  sendToControl: (channel: string, payload?: unknown) => void,
): ThemeOps {
  /**
   * Broadcast theme to ALL renderer surfaces: every BrowserWindow
   * plus the control layer (WebContentsView, which isn't a
   * BrowserWindow).
   */
  function broadcastTheme(info: ThemeInfo): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC_RESPONSE_CHANNELS.THEME_CHANGED, info)
      }
    }
    sendToControl(IPC_RESPONSE_CHANNELS.THEME_CHANGED, info)
  }

  // Get current theme
  ipcMain.handle(IPC_CHANNELS.THEME_GET, (): ThemeInfo => {
    const preference = config.getThemePreference()
    return { preference, resolved: resolveTheme(preference) }
  })

  // Set theme preference
  ipcMain.handle(IPC_CHANNELS.THEME_SET, (_event, pref: ThemePreference) => {
    if (pref !== 'system' && pref !== 'light' && pref !== 'dark') return
    config.setThemePreference(pref)
    broadcastTheme({ preference: pref, resolved: resolveTheme(pref) })
  })

  // Listen for system theme changes
  nativeTheme.on('updated', () => {
    const preference = config.getThemePreference()
    if (preference === 'system') {
      broadcastTheme({ preference, resolved: resolveTheme(preference) })
    }
  })

  return {
    pushCurrentTheme: () => {
      const preference = config.getThemePreference()
      broadcastTheme({ preference, resolved: resolveTheme(preference) })
    },
  }
}
