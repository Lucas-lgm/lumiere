import { app, Menu, dialog, BrowserWindow } from 'electron'
import { VIDEO_FILE_EXTENSIONS } from './command/ipcConstants'
import { t } from '../i18n'

/**
 * Narrow deps for the app menu — decoupled from the VideoPlayerApp
 * container.  The menu only needs two operations: open a file path
 * (routes to main window + focus) and toggle fullscreen (routes to
 * the playback window manager).
 */
export interface AppMenuDeps {
  openFile: (path: string) => void
  toggleFullscreen: () => void
}

/**
 * macOS application menu bar
 *
 * Standard macOS menu structure: Lumiere / File / Edit / View / Window
 *
 * Receives narrow function deps instead of the full VideoPlayerApp —
 * the menu module doesn't know about the app container, only the two
 * operations it needs.
 */
export function setupApplicationMenu(deps: AppMenuDeps): void {
  if (process.platform !== 'darwin') return

  const name = app.name

  const template: Electron.MenuItemConstructorOptions[] = [
    // Lumiere menu
    {
      label: name,
      submenu: [
        { role: 'about', label: t('menu.about', { name }) },
        { type: 'separator' },
        {
          label: t('menu.preferences'),
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToFocusedWindow('menu:navigate', 'settings')
        },
        { type: 'separator' },
        { role: 'hide', label: t('menu.hide', { name }) },
        { role: 'hideOthers', label: t('menu.hideOthers') },
        { role: 'unhide', label: t('menu.unhide') },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit', { name }) }
      ]
    },

    // File menu
    {
      label: t('menu.file'),
      submenu: [
        {
          label: t('menu.openFile'),
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [
                { name: t('menu.videoFiles'), extensions: [...VIDEO_FILE_EXTENSIONS] },
                { name: t('menu.allFiles'), extensions: ['*'] }
              ]
            })
            if (!result.canceled && result.filePaths.length > 0) {
              deps.openFile(result.filePaths[0])
            }
          }
        },
        { type: 'separator' },
        {
          label: t('menu.recentDocuments'),
          role: 'recentDocuments',
          submenu: [
            { label: t('menu.clearRecentDocuments'), role: 'clearRecentDocuments' }
          ]
        },
        { type: 'separator' },
        { role: 'close', label: t('menu.closeWindow') }
      ]
    },

    // Edit menu
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') }
      ]
    },

    // View menu
    {
      label: t('menu.view'),
      submenu: [
        {
          label: t('menu.fullscreen'),
          accelerator: 'Ctrl+Cmd+F',
          click: () => deps.toggleFullscreen()
        },
        {
          label: t('menu.toggleSidebar'),
          accelerator: 'CmdOrCtrl+\\',
          click: () => sendToFocusedWindow('menu:toggle-sidebar')
        }
      ]
    },

    // Window menu
    {
      label: t('menu.window'),
      role: 'window',
      submenu: [
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'zoom', label: t('menu.zoom') },
        { type: 'separator' },
        { role: 'front', label: t('menu.front') }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/** Send an IPC message to the currently focused window */
function sendToFocusedWindow(channel: string, ...args: any[]): void {
  const win = BrowserWindow.getFocusedWindow()
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
}
