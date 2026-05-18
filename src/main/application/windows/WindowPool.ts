import { BrowserWindow, app, screen } from 'electron'
import { createLogger } from '../../infrastructure/logging'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { platform } from 'os'

const logger = createLogger('WindowPool')
const __dirname = dirname(fileURLToPath(import.meta.url))

export interface PooledWindow {
  window: BrowserWindow
  id: string
  inUse: boolean
  type: 'video' | 'control' // Distinguish window type for easier reuse
}

/**
 * Window Pool (High-Performance Optimization)
 *
 * Maintains a pool of pre-created windows, completely eliminating the
 * hundreds of milliseconds of window creation latency.
 *
 * Core mechanisms:
 * 1. Pre-warming: Pre-create invisible windows at app startup or during idle time.
 * 2. Recycling: When a window closes, instead of destroying it, hide and reset its state, then return it to the pool.
 * 3. Lazy Expansion: If the pool is empty, create windows on demand.
 */
export class WindowPool {
  private pool: PooledWindow[] = []
  private readonly MAX_POOL_SIZE = 3

  // Default window configuration (as template)
  private readonly DEFAULT_VIDEO_OPTIONS: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 720,
    show: false,
    frame: false,
    transparent: platform() !== 'darwin', // backgroundColor and transparent have compatibility issues on Windows (jitter); macOS supports transparent windows
    skipTaskbar: true, // Video window does not create extra entries in Dock and Mission Control
    backgroundColor: '#00000000', // Set to transparent even for video windows for general compatibility
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false // Key: do not throttle in background, ensure pre-warming is effective
    }
  }

  /**
   * Initialize the pool, pre-warm windows
   */
  async init(): Promise<void> {
    logger.info('Initializing WindowPool...')
    // Pre-create a video window
    this.createWindow('video')
  }

  /**
   * Acquire an available window
   * @param type Window type
   */
  acquire(type: 'video' | 'control'): BrowserWindow {
    // 1. Look for an idle window
    const existing = this.pool.find(p => !p.inUse && p.type === type && !p.window.isDestroyed())
    
    if (existing) {
      logger.debug(`Acquired pooled window [${existing.id}]`)
      existing.inUse = true
      return existing.window
    }

    // 2. If none available, create a new one
    logger.debug(`No pooled window available, creating new [${type}]`)
    const pooled = this.createWindow(type)
    pooled.inUse = true
    return pooled.window
  }

  /**
   * Return the window to the pool (instead of destroying)
   * @param window Window instance
   */
  release(window: BrowserWindow): void {
    if (window.isDestroyed()) {
      this.removeFromPool(window)
      return
    }

    const entry = this.pool.find(p => p.window === window)
    if (!entry) {
      // Window not in pool, destroy directly
      window.destroy()
      return
    }

    logger.debug(`Releasing window [${entry.id}] to pool`)
    
    // Reset state (no longer force loads about:blank — upper layer strategy handles actual page loading)
    try {
      window.hide()
      window.setParentWindow(null) // Remove parent-child relationship
      
      // Remove all listeners to prevent memory leaks and logic interference
      window.removeAllListeners()
      window.webContents.removeAllListeners()
      
      // Restore some basic properties
      window.setOpacity(1)
      window.setIgnoreMouseEvents(false)
      
      entry.inUse = false
    } catch (error) {
      logger.error('Failed to reset window for pooling', error)
      // If reset fails, destroy it for safety
      this.removeFromPool(window)
      window.destroy()
    }
  }

  /**
   * Destroy all windows (on app exit)
   */
  clear(): void {
    this.pool.forEach(p => {
      if (!p.window.isDestroyed()) {
        p.window.destroy()
      }
    })
    this.pool = []
  }

  private createWindow(type: 'video' | 'control'): PooledWindow {
    // Merge configuration
    const options = { ...this.DEFAULT_VIDEO_OPTIONS }
    
    // Ensure the preload script path is correct
    options.webPreferences = {
        ...options.webPreferences,
        preload: join(__dirname, '../preload/preload.js')
    }

    const win = new BrowserWindow(options)
    const id = `pool-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    
    const entry: PooledWindow = {
      window: win,
      id,
      inUse: false,
      type
    }

    // Listen for unexpected close, remove from pool
    win.on('closed', () => {
      this.removeFromPool(win)
    })

    this.pool.push(entry)
    
    // Preload empty page or general template to ensure the renderer process has started
    // This makes subsequent loadURL calls significantly faster
    win.loadURL('about:blank')

    return entry
  }

  private removeFromPool(window: BrowserWindow) {
    this.pool = this.pool.filter(p => p.window !== window)
  }
}
