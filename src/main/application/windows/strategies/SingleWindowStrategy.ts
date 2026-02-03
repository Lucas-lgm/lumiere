import { BrowserWindow, BrowserView, screen } from 'electron'
import { EventEmitter } from 'events'
import { createLogger } from '../../../infrastructure/logging'
import { WindowController, WindowCreationOptions, WindowAction } from '../WindowController'
import { WindowPool } from '../WindowPool'
import { WindowLifecycle, WindowEvent } from '../WindowLifecycle'
import { mapElectronInputToMpvKey } from '../../utils/InputMapper'
import { join } from 'path'

const logger = createLogger('SingleWindowStrategy')

export class SingleWindowStrategy extends EventEmitter implements WindowController {
  private videoWindow: BrowserWindow | null = null
  private controlView: BrowserView | null = null
  private lifecycle: WindowLifecycle

  constructor() {
    super()
    this.lifecycle = new WindowLifecycle()
  }

  async init(options: WindowCreationOptions): Promise<void> {
    this.lifecycle.transition(WindowEvent.INIT)
    logger.info('Initializing Single Window Strategy...')

    try {
      // Acquire VideoWindow from the pool
      this.videoWindow = WindowPool.getInstance().acquire('video')
      
      // Initialize VideoWindow state
      // Transparent window is fine on macOS; black is also acceptable
      this.videoWindow.setBackgroundColor('#00000000') 
      
      // Compute initial position and size
      const bounds = this.calculateInitialBounds(options)
      this.videoWindow.setBounds(bounds)

      // Create and attach BrowserView
      // BrowserView cannot be pooled (bound to a Window); create on demand or reuse
      // For performance, cache a view or create new each time (view creation is faster than a Window)
      this.setupControlView()

      // Set up event listeners
      this.setupEventListeners()

      // Show window
      if (!options.preload) {
        this.show()
      } else {
        this.lifecycle.transition(WindowEvent.HIDE)
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

    this.controlView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        preload: join(__dirname, '../preload/preload.js') // Ensure correct path depth
      }
    })

    this.controlView.setBackgroundColor('#00000000') // Transparent background
    this.videoWindow.setBrowserView(this.controlView)
    
    // Auto-resize
    this.controlView.setAutoResize({ width: true, height: true })
    const bounds = this.videoWindow.getContentBounds()
    this.controlView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })

    this.reloadControlLayer()
  }

  private setupEventListeners() {
    if (!this.videoWindow) return

    this.videoWindow.on('closed', () => {
      this.emit('close')
      this.dispose()
    })

    this.videoWindow.on('focus', () => this.emit('focus'))
    this.videoWindow.on('blur', () => this.emit('blur'))

    this.videoWindow.on('enter-full-screen', () => {
      this.lifecycle.transition(WindowEvent.ENTER_FULLSCREEN)
      this.emit('fullscreen-enter')
    })
    this.videoWindow.on('leave-full-screen', () => {
      this.lifecycle.transition(WindowEvent.EXIT_FULLSCREEN)
      this.emit('fullscreen-exit')
    })

    // Forward keyboard events (BrowserView)
    if (this.controlView) {
      this.controlView.webContents.on('before-input-event', (event, input) => {
        const mpvKey = mapElectronInputToMpvKey(input)
        if (mpvKey) {
          event.preventDefault()
          this.emit('key-down', mpvKey)
        }
      })
    }
  }

  private show() {
    if (!this.videoWindow) return
    this.videoWindow.show()
    this.videoWindow.focus()
    this.lifecycle.transition(WindowEvent.SHOW)
  }

  reloadControlLayer(): void {
    if (!this.controlView) return
    
    if (process.env.NODE_ENV === 'development') {
      const url = 'http://localhost:5173/#/control'
      this.controlView.webContents.loadURL(url).catch(() => {})
      // this.controlView.webContents.openDevTools({ mode: 'detach' })
    } else {
      this.controlView.webContents.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: 'control'
      }).catch(() => {})
    }
  }

  setControlBarVisibility(visible: boolean): void {
    // On macOS, BrowserView can be removed or made transparent
    // Usually the front-end hides DOM elements
    // If you need to hide completely (e.g., pure mode):
    if (this.videoWindow && this.controlView) {
      if (visible) {
        this.videoWindow.setBrowserView(this.controlView)
      } else {
        this.videoWindow.setBrowserView(null)
      }
    }
  }

  handleWindowAction(action: WindowAction): void {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) return

    switch (action) {
      case 'close':
        this.lifecycle.transition(WindowEvent.CLOSE)
        this.videoWindow.close()
        break
      case 'minimize':
        if (this.lifecycle.transition(WindowEvent.MINIMIZE)) {
          this.videoWindow.minimize()
        }
        break
      case 'maximize':
        if (!this.videoWindow.isMaximized()) {
          this.videoWindow.maximize()
        }
        break
      case 'restore':
        if (this.videoWindow.isFullScreen()) {
            this.videoWindow.setFullScreen(false)
        } else if (this.videoWindow.isMaximized()) {
          this.videoWindow.unmaximize()
        } else if (this.videoWindow.isMinimized()) {
          this.videoWindow.restore()
          this.lifecycle.transition(WindowEvent.RESTORE)
        }
        break
    }
  }

  toggleFullscreen(): void {
    if (!this.videoWindow) return
    const isFullscreen = this.videoWindow.isFullScreen()
    this.videoWindow.setFullScreen(!isFullscreen)
  }

  getInputWindow(): BrowserWindow | null {
    // On macOS, the VideoWindow is also the InputWindow (BrowserView receives events)
    return this.videoWindow
  }

  getVideoWindow(): BrowserWindow | null {
    return this.videoWindow
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
    
    // BrowserView is destroyed with the Window, but for pooled Windows, clear the view manually
    if (this.videoWindow && this.controlView) {
      try {
        this.videoWindow.setBrowserView(null)
        // BrowserView has no destroy method; drop references and wait for GC, or use webContents.destroy()
        if (!this.controlView.webContents.isDestroyed()) {
             // (Optional) this.controlView.webContents.destroy() 
             // This may crash if the view is in use
        }
      } catch (e) {}
      this.controlView = null
    }

    if (this.videoWindow) {
      WindowPool.getInstance().release(this.videoWindow)
      this.videoWindow = null
    }

    this.lifecycle.transition(WindowEvent.CLOSE)
  }
}
