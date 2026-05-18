import { BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from '../../infrastructure/logging'

const __dirname = dirname(fileURLToPath(import.meta.url))
const logger = createLogger('WindowCreator')

export interface AppWindowConfig {
  width: number
  height: number
  title: string
  route?: string
  frame?: boolean
  alwaysOnTop?: boolean
  transparent?: boolean
  x?: number
  y?: number
  show?: boolean
  titleBarStyle?: 'default' | 'hidden' | 'hiddenInset' | 'customButtonsOnHover'
}

export function createAppWindow(config: AppWindowConfig): BrowserWindow {
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: config.width,
    height: config.height,
    x: config.x,
    y: config.y,
    title: config.title,
    frame: config.frame !== false,
    alwaysOnTop: config.alwaysOnTop || false,
    transparent: config.transparent || false,
    show: config.show !== undefined ? config.show : false,
    resizable: true,
    maximizable: true,
    minimizable: true,
    closable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  }

  // titleBarStyle is supported on both macOS and Windows (Electron 28+); ignored on Linux
  if (config.titleBarStyle && (process.platform === 'darwin' || process.platform === 'win32')) {
    windowOptions.titleBarStyle = config.titleBarStyle
  }

  if (process.platform === 'win32') {
    // Windows does not need the default menu bar (Alt key does not show it either)
    windowOptions.autoHideMenuBar = true
    if (config.transparent) {
      logger.warn('Windows: Transparent windows cannot be resized on Windows (Electron limitation)')
    } else {
      windowOptions.resizable = true
      windowOptions.maximizable = true
      windowOptions.minimizable = true
    }
  }

  const window = new BrowserWindow(windowOptions)

  if (process.platform === 'win32') {
    // Runtime fallback to hide menu bar (Alt key no longer reveals it)
    window.setMenuBarVisibility(false)
    window.setAutoHideMenuBar(true)
  }

  if (!(config.transparent && process.platform === 'win32')) {
    window.setResizable(true)
    window.setMaximizable(true)
    window.setMinimizable(true)
  }
  window.setClosable(true)

  logger.debug('App window created', {
    title: config.title,
    resizable: windowOptions.resizable,
    maximizable: windowOptions.maximizable,
    transparent: config.transparent,
    frame: config.frame,
    platform: process.platform,
    actualResizable: window.isResizable(),
    actualMaximizable: window.isMaximizable()
  })

  if (process.platform === 'win32' && !config.transparent) {
    window.once('show', () => {
      if (!window.isDestroyed()) {
        window.setResizable(true)
        window.setMaximizable(true)
        window.setMinimizable(true)
        window.setClosable(true)
      }
    })
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) {
        window.setResizable(true)
        window.setMaximizable(true)
        window.setMinimizable(true)
        window.setClosable(true)
      }
    })
  }

  if (!config.show) {
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) {
        window.show()
      }
    })
  }

  window.webContents.on('did-finish-load', () => {
    window.webContents.executeJavaScript(`
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: file: thumb:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';";
      document.getElementsByTagName('head')[0].appendChild(meta);
    `).catch(() => {})
  })

  if (process.env.NODE_ENV === 'development') {
    const route = config.route || '#/'
    const url = `http://localhost:5173/${route.startsWith('#') ? route : '#' + route}`
    window.loadURL(url)
    // window.webContents.openDevTools()
  } else {
    const route = config.route || '#/'
    window.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: route.startsWith('#') ? route : '#' + route
    })
  }

  return window
}
