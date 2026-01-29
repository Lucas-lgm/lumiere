import { BrowserWindow } from 'electron'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('WindowSynchronizer')

export class WindowSynchronizer {
  private syncTimer: NodeJS.Timeout | null = null
  private videoWindow: BrowserWindow | null = null
  private controlWindow: BrowserWindow | null = null
  private readonly SYNC_INTERVAL_MS = 100 // defined in constants normally, hardcoded here or imported

  constructor(videoWindow: BrowserWindow, controlWindow: BrowserWindow) {
    this.videoWindow = videoWindow
    this.controlWindow = controlWindow
  }

  startSync() {
    if (!this.videoWindow || !this.controlWindow) return

    logger.debug('Starting window synchronization')
    
    // Initial sync
    this.syncVideoToControl()

    // Event listeners
    this.controlWindow.on('move', this.syncVideoToControl)
    this.controlWindow.on('resize', this.syncVideoToControl)
    this.controlWindow.on('moved', this.syncVideoToControl)
    this.controlWindow.on('resized', this.syncVideoToControl)

    // Timer fallback
    this.syncTimer = setInterval(() => {
      if (this.videoWindow && !this.videoWindow.isDestroyed() &&
          this.controlWindow && !this.controlWindow.isDestroyed()) {
        this.syncVideoToControl()
      } else {
        this.stopSync()
      }
    }, this.SYNC_INTERVAL_MS)
  }

  stopSync() {
    logger.debug('Stopping window synchronization')
    
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }

    if (this.controlWindow && !this.controlWindow.isDestroyed()) {
      this.controlWindow.off('move', this.syncVideoToControl)
      this.controlWindow.off('resize', this.syncVideoToControl)
      this.controlWindow.off('moved', this.syncVideoToControl)
      this.controlWindow.off('resized', this.syncVideoToControl)
    }

    this.videoWindow = null
    this.controlWindow = null
  }

  private syncVideoToControl = () => {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || 
        !this.controlWindow || this.controlWindow.isDestroyed()) {
      return
    }
    try {
      const bounds = this.controlWindow.getBounds()
      this.videoWindow.setBounds(bounds)
    } catch (error) {
      // Ignore errors if windows are closing
    }
  }
}
