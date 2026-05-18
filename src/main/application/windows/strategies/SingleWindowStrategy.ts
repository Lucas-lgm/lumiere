import { BrowserWindow, WebContentsView, screen } from 'electron'
import { EventEmitter } from 'events'
import { createLogger } from '../../../infrastructure/logging'
import { WindowController, WindowCreationOptions, WindowAction } from '../WindowController'
import type { WindowPool } from '../WindowPool'
import { join } from 'path'

const logger = createLogger('SingleWindowStrategy')

const PIP_DEFAULT_WIDTH = 320
const PIP_DEFAULT_HEIGHT = 180
const PIP_MIN_WIDTH = 240
const PIP_MIN_HEIGHT = 135
const PIP_MAX_WIDTH = 480
const PIP_MAX_HEIGHT = 270
const PIP_MARGIN = 16
const PIP_SNAP_DEBOUNCE_MS = 150

/** Minimum short-side pixel length for player window area (absolute floor) */
const MIN_SHORT_SIDE = 200

export class SingleWindowStrategy extends EventEmitter implements WindowController {
  private videoWindow: BrowserWindow | null = null
  private controlView: WebContentsView | null = null
  private pipMode = false
  private prePipBounds: Electron.Rectangle | null = null
  private pipSnapTimer: NodeJS.Timeout | null = null
  private pipMovedHandler: (() => void) | null = null
  private lockedAspectRatio: number = 0
  private closing = false
  // On Windows, BrowserWindow.isFullScreen() returns unstable values during transitions; use a field instead
  // macOS native fullscreen is reliable, read from OS directly. Write points: enter/leave-full-screen events.
  private winIsFullscreen = false

  private get isFullscreen(): boolean {
    if (process.platform === 'win32') return this.winIsFullscreen
    return this.videoWindow?.isFullScreen() ?? false
  }

  constructor(private readonly pool: WindowPool) {
    super()
  }

  hide(): void {
    this.videoWindow?.hide()
  }

  /**
   * Hide the window instead of destroying it, then notify upper layers.
   * Avoids the native-level blocking caused by OpenGL context teardown
   * during mpv stop (CAOpenGLLayer / mpv_render_context synchronization
   * can freeze the main thread for seconds on Blu-ray ISO).
   */
  private hideAndNotify(): void {
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      this.videoWindow.hide()
    }
    this.emit('close')
  }

  async init(options: WindowCreationOptions): Promise<void> {
    logger.info('Initializing Single Window Strategy...')

    try {
      // Acquire VideoWindow from the pool
      this.videoWindow = this.pool.acquire('video')
      
      // Initialize VideoWindow state — reset any constraints that may remain on the pooled window
      this.videoWindow.setBackgroundColor('#00000000')
      this.videoWindow.setAspectRatio(0)
      this.lockedAspectRatio = 0
      
      // Compute initial position and size
      const bounds = this.calculateInitialBounds(options)
      this.videoWindow.setBounds(bounds)

      // Create and attach WebContentsView as control overlay
      this.setupControlView()

      // Set up event listeners
      this.setupEventListeners()

      // Show window
      if (!options.preload) {
        this.show()
      }

    } catch (error) {
      logger.error('Failed to initialize SingleWindowStrategy', error)
      this.dispose()
      throw error
    }
  }

  private calculateInitialBounds(options: WindowCreationOptions): Electron.Rectangle {
    if (options.x !== undefined && options.y !== undefined && options.width && options.height) {
      return { x: options.x, y: options.y, width: options.width, height: options.height }
    }
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    const w = options.width || 1280
    const h = options.height || 720
    return { 
      x: Math.floor((width - w) / 2), 
      y: Math.floor((height - h) / 2),
      width: w, 
      height: h 
    }
  }

  private setupControlView() {
    if (!this.videoWindow) return

    this.controlView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        preload: join(__dirname, '../preload/preload.js')
      }
    })

    this.controlView.setBackgroundColor('#000000') // Initial black, switches to transparent during playback
    this.videoWindow.contentView.addChildView(this.controlView)

    // WebContentsView does not have setAutoResize, need to manually sync bounds
    this.syncControlViewBounds()
    this.videoWindow.on('resize', () => this.syncControlViewBounds())

    this.reloadControlLayer()
  }

  private syncControlViewBounds() {
    if (!this.videoWindow || !this.controlView) return
    const bounds = this.videoWindow.getContentBounds()
    this.controlView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
  }

  private setupEventListeners() {
    if (!this.videoWindow) return

    this.videoWindow.on('close', (event) => {
      event.preventDefault()
      if (this.closing) return
      this.closing = true

      if (this.videoWindow && this.isFullscreen) {
        this.videoWindow.once('leave-full-screen', () => {
          this.hideAndNotify()
        })
        this.videoWindow.setFullScreen(false)
      } else {
        this.hideAndNotify()
      }
    })

    this.videoWindow.on('focus', () => this.emit('focus'))
    this.videoWindow.on('blur', () => this.emit('blur'))

    this.videoWindow.on('enter-full-screen', () => {
      this.winIsFullscreen = true
      this.emit('fullscreen-enter')
    })
    this.videoWindow.on('leave-full-screen', () => {
      this.winIsFullscreen = false
      if (this.closing) return
      this.emit('fullscreen-exit')
    })
    this.videoWindow.on('maximize', () => this.emit('maximize'))
    this.videoWindow.on('unmaximize', () => this.emit('unmaximize'))

    // Keyboard shortcuts are now handled in the renderer (useKeyboardShortcuts composable).
    // The before-input-event handler that forwarded all keys to mpv has been removed
    // to allow the renderer to process keyboard events directly.
  }

  show() {
    if (!this.videoWindow) return
    this.videoWindow.show()
    this.videoWindow.focus()
  }

  reloadControlLayer(): void {
    if (!this.controlView) return
    
    if (process.env.NODE_ENV === 'development') {
      const url = 'http://localhost:5173/#/control'
      this.controlView.webContents.loadURL(url).catch(() => {})
      this.controlView.webContents.openDevTools({ mode: 'detach' })
    } else {
      this.controlView.webContents.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: 'control'
      }).catch(() => {})
    }
  }

  setControlBarVisibility(visible: boolean): void {
    if (this.videoWindow && this.controlView) {
      if (visible) {
        this.videoWindow.contentView.addChildView(this.controlView)
        this.syncControlViewBounds()
      } else {
        this.videoWindow.contentView.removeChildView(this.controlView)
      }
    }
  }

  handleWindowAction(action: WindowAction): void {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) return

    switch (action) {
      case 'close':
        this.videoWindow.close()
        break
      case 'minimize':
        this.videoWindow.minimize()
        break
      case 'maximize':
        if (!this.videoWindow.isMaximized()) {
          this.videoWindow.maximize()
        } else {
          this.videoWindow.unmaximize()
        }
        break
      case 'restore':
        if (this.isFullscreen) {
            this.videoWindow.setFullScreen(false)
        } else if (this.videoWindow.isMaximized()) {
          this.videoWindow.unmaximize()
        } else if (this.videoWindow.isMinimized()) {
          this.videoWindow.restore()
        }
        break
    }
  }

  toggleFullscreen(): void {
    if (!this.videoWindow) return
    this.videoWindow.setFullScreen(!this.isFullscreen)
  }

  getInputWindow(): BrowserWindow | null {
    // On macOS, the VideoWindow is also the InputWindow (WebContentsView receives events)
    return this.videoWindow
  }

  getVideoWindow(): BrowserWindow | null {
    return this.videoWindow
  }

  togglePip(): boolean {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) return false

    if (this.pipMode) {
      this.exitPip()
      return false
    } else {
      // Fullscreen and PIP are mutually exclusive: exit fullscreen first, then enter PIP after animation completes
      if (this.isFullscreen) {
        this.videoWindow.once('leave-full-screen', () => {
          this.enterPip()
        })
        this.videoWindow.setFullScreen(false)
      } else {
        this.enterPip()
      }
      return true
    }
  }

  private enterPip(): void {
    if (!this.videoWindow) return
    this.pipMode = true
    this.prePipBounds = this.videoWindow.getBounds()

    // Size constraints (P3-PIP-024a)
    this.videoWindow.setResizable(true)
    this.videoWindow.setAspectRatio(16 / 9)
    this.videoWindow.setMinimumSize(PIP_MIN_WIDTH, PIP_MIN_HEIGHT)
    this.videoWindow.setMaximumSize(PIP_MAX_WIDTH, PIP_MAX_HEIGHT)

    // Window properties (P3-PIP-026)
    this.videoWindow.setSkipTaskbar(true)
    this.videoWindow.setHasShadow(true)

    // Position at bottom-right (P3-PIP-023a)
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
    this.videoWindow.setBounds({
      x: screenW - PIP_DEFAULT_WIDTH - PIP_MARGIN,
      y: screenH - PIP_DEFAULT_HEIGHT - PIP_MARGIN,
      width: PIP_DEFAULT_WIDTH,
      height: PIP_DEFAULT_HEIGHT
    })
    this.videoWindow.setAlwaysOnTop(true, 'floating')

    // Corner snap: snap 150ms after release (P3-PIP-023a)
    this.pipMovedHandler = () => {
      if (this.pipSnapTimer) clearTimeout(this.pipSnapTimer)
      this.pipSnapTimer = setTimeout(() => {
        this.snapToNearestCorner()
        this.pipSnapTimer = null
      }, PIP_SNAP_DEBOUNCE_MS)
    }
    this.videoWindow.on('moved', this.pipMovedHandler)

    this.emit('pip-enter')
  }

  private exitPip(): void {
    if (!this.videoWindow) return
    this.pipMode = false

    // Clean up snap listener
    if (this.pipMovedHandler) {
      this.videoWindow.removeListener('moved', this.pipMovedHandler)
      this.pipMovedHandler = null
    }
    if (this.pipSnapTimer) {
      clearTimeout(this.pipSnapTimer)
      this.pipSnapTimer = null
    }

    // Reset constraints (setMaximumSize(0,0) is ineffective on macOS; use screen dimensions to clear the cap)
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    this.videoWindow.setAlwaysOnTop(false)
    this.videoWindow.setAspectRatio(this.lockedAspectRatio)
    this.videoWindow.setMaximumSize(sw, sh)
    if (this.lockedAspectRatio > 0) {
      this.applyMinSizeForAspect(this.lockedAspectRatio)
    } else {
      this.videoWindow.setMinimumSize(400, 300)
    }
    this.videoWindow.setResizable(true)
    this.videoWindow.setSkipTaskbar(false)

    if (this.prePipBounds) {
      this.videoWindow.setBounds(this.prePipBounds, true)
      this.prePipBounds = null
    }
    this.emit('pip-exit')
  }

  /** Calculate the nearest corner and snap (uses macOS native animation) */
  private snapToNearestCorner(): void {
    if (!this.videoWindow || !this.pipMode) return
    const bounds = this.videoWindow.getBounds()
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    const snapX = cx < screenW / 2
      ? PIP_MARGIN
      : screenW - bounds.width - PIP_MARGIN
    const snapY = cy < screenH / 2
      ? PIP_MARGIN
      : screenH - bounds.height - PIP_MARGIN
    this.videoWindow.setBounds({ x: snapX, y: snapY, width: bounds.width, height: bounds.height }, true)
  }

  isPip(): boolean {
    return this.pipMode
  }

  /** Close PIP: send pause signal + exit PIP (P3-PIP-026) */
  pipClose(): void {
    if (!this.videoWindow || !this.pipMode) return
    this.emit('pip-close')
    this.exitPip()
  }

  /** Return to main window: exit PIP + notify renderer (P3-PIP-026) */
  pipReturn(): void {
    if (!this.videoWindow || !this.pipMode) return
    this.exitPip()
    this.emit('pip-return')
  }

  /** Double-click to toggle PIP size: min ↔ max (P3-PIP-024a) */
  togglePipSize(): void {
    if (!this.videoWindow || !this.pipMode) return
    const bounds = this.videoWindow.getBounds()
    const isMax = bounds.width >= PIP_MAX_WIDTH
    const newW = isMax ? PIP_MIN_WIDTH : PIP_MAX_WIDTH
    const newH = isMax ? PIP_MIN_HEIGHT : PIP_MAX_HEIGHT
    this.videoWindow.setBounds({ x: bounds.x, y: bounds.y, width: newW, height: newH }, true)
  }

  fitToVideo(videoWidth: number, videoHeight: number): void {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || this.pipMode) return
    if (videoWidth <= 0 || videoHeight <= 0) return

    const videoAspect = videoWidth / videoHeight
    const bounds = this.videoWindow.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea

    // Maximize window to 80% of screen work area, maintaining video aspect ratio (consistent size for same ratio)
    const maxW = Math.round(workArea.width * 0.8)
    const maxH = Math.round(workArea.height * 0.8)
    let newW = maxW
    let newH = Math.round(newW / videoAspect)
    if (newH > maxH) {
      newH = maxH
      newW = Math.round(newH * videoAspect)
    }

    // Ensure not smaller than minimum size
    newW = Math.max(newW, 400)
    newH = Math.max(newH, 300)

    // Center on screen work area
    const newX = Math.round(workArea.x + (workArea.width - newW) / 2)
    const newY = Math.round(workArea.y + (workArea.height - newH) / 2)

    this.videoWindow.setBounds({ x: newX, y: newY, width: newW, height: newH }, true)
  }

  setAspectRatioLock(ratio: number): void {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || this.pipMode) return
    this.lockedAspectRatio = ratio > 0 ? ratio : 0
    this.videoWindow.setAspectRatio(this.lockedAspectRatio)
    // Dynamically update minimum size
    if (ratio > 0) {
      this.applyMinSizeForAspect(ratio)
    } else {
      this.videoWindow.setMinimumSize(400, 300)
    }
  }

  /** Calculate minimum window size based on video aspect ratio */
  private applyMinSizeForAspect(aspect: number): void {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) return
    let minW: number, minH: number
    if (aspect >= 1) {
      // Landscape: short side is height
      minH = MIN_SHORT_SIDE
      minW = Math.round(minH * aspect)
    } else {
      // Portrait: short side is width
      minW = MIN_SHORT_SIDE
      minH = Math.round(minW / aspect)
    }
    this.videoWindow.setMinimumSize(minW, minH)
  }

  resetLayout(): void {
    // On macOS, manual reset is generally unnecessary; AutoResize handles it
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
        const { width, height } = screen.getPrimaryDisplay().workAreaSize
        const w = 1280
        const h = 720
        this.videoWindow.setBounds({
            x: (width - w) / 2,
            y: (height - h) / 2,
            width: w,
            height: h
        })
    }
  }

  setVideoLayerVisible(visible: boolean): void {
    if (!this.controlView) return
    this.controlView.setBackgroundColor(visible ? '#00000000' : '#000000')
  }

  sendToControlLayer(channel: string, ...args: any[]): void {
    if (this.controlView && !this.controlView.webContents.isDestroyed()) {
      try {
        this.controlView.webContents.send(channel, ...args)
      } catch (e) {
        // ignore
      }
    }
  }

  dispose(): void {
    logger.info('Disposing SingleWindowStrategy resources')

    if (this.pipMode) {
      this.exitPip()
    }

    // Remove WebContentsView from window before releasing to pool
    if (this.videoWindow && this.controlView) {
      try {
        this.videoWindow.contentView.removeChildView(this.controlView)
      } catch (e) {}
      this.controlView = null
    }

    if (this.videoWindow) {
      this.pool.release(this.videoWindow)
      this.videoWindow = null
    }
  }
}
