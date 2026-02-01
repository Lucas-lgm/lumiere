import { BrowserWindow } from 'electron'
import { createLogger } from '../../infrastructure/logging'
import { WINDOW_DELAYS } from '../constants'

const logger = createLogger('WindowSynchronizer')

/**
 * WindowSynchronizer
 * 
 * Keeps geometry of VideoWindow (bottom) in sync with ControlWindow (top).
 * Uses event-driven sync with throttling instead of high-frequency polling.
 */
export class WindowSynchronizer {
  private videoWindow: BrowserWindow | null = null
  private controlWindow: BrowserWindow | null = null
  private isSyncing = false
  private syncTimer: NodeJS.Timeout | null = null
  
  // 记录上一次同步的 Bounds，避免重复设置
  private lastBounds: Electron.Rectangle | null = null

  constructor(videoWindow: BrowserWindow, controlWindow: BrowserWindow) {
    this.videoWindow = videoWindow
    this.controlWindow = controlWindow
  }

  startSync() {
    if (!this.videoWindow || !this.controlWindow || this.isSyncing) return
    this.isSyncing = true
    logger.debug('Starting window synchronization (event-driven)')

    // Initial sync
    this.syncVideoToControl()

    // Bind event listeners: user interacts with ControlWindow; VideoWindow follows
    this.controlWindow.on('move', this.throttledSync)
    this.controlWindow.on('resize', this.throttledSync)
    
    // Fallback events to catch less frequent move/resize notifications
    this.controlWindow.on('moved', this.syncVideoToControl)
    this.controlWindow.on('resized', this.syncVideoToControl)

    // Low-frequency heartbeat to correct potential event loss
    this.syncTimer = setInterval(() => {
      this.syncVideoToControl()
    }, WINDOW_DELAYS.SYNC_INTERVAL_MS)
  }

  stopSync() {
    if (!this.isSyncing) return
    logger.debug('Stopping window synchronization')
    this.isSyncing = false

    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }

    if (this.controlWindow && !this.controlWindow.isDestroyed()) {
      this.controlWindow.removeListener('move', this.throttledSync)
      this.controlWindow.removeListener('resize', this.throttledSync)
      this.controlWindow.removeListener('moved', this.syncVideoToControl)
      this.controlWindow.removeListener('resized', this.syncVideoToControl)
    }

    this.videoWindow = null
    this.controlWindow = null
  }

  // Simple throttling wrapper
  private pendingSync = false
  private throttledSync = () => {
    if (this.pendingSync) return
    this.pendingSync = true
    
    // Delay to end of current event loop or limit to ~60fps (16ms)
    setTimeout(() => {
      this.syncVideoToControl()
      this.pendingSync = false
    }, WINDOW_DELAYS.RESIZE_THROTTLE_MS || 16)
  }

  private syncVideoToControl = () => {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || 
        !this.controlWindow || this.controlWindow.isDestroyed()) {
      // Stop syncing if either window is destroyed
      this.stopSync()
      return
    }

    try {
      const bounds = this.controlWindow.getBounds()
      
      // Skip if bounds unchanged
      if (this.lastBounds &&
          this.lastBounds.x === bounds.x &&
          this.lastBounds.y === bounds.y &&
          this.lastBounds.width === bounds.width &&
          this.lastBounds.height === bounds.height) {
        return
      }

      this.videoWindow.setBounds(bounds)
      this.lastBounds = bounds
    } catch (error) {
      // Ignore errors during window teardown
    }
  }
}
