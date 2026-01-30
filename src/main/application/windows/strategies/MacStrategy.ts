import { BrowserWindow, BrowserView, screen } from 'electron'
import { EventEmitter } from 'events'
import { createLogger } from '../../../infrastructure/logging'
import { WindowController, WindowCreationOptions, WindowAction } from '../WindowController'
import { WindowPool } from '../WindowPool'
import { WindowLifecycle, WindowEvent } from '../WindowLifecycle'
import { mapElectronInputToMpvKey } from '../../utils/InputMapper'
import { join } from 'path'

const logger = createLogger('MacStrategy')

/**
 * macOS Strategy: Single-Window + BrowserView
 * 
 * 专为 macOS 平台设计的窗口组合策略。
 * 
 * 架构：
 * - VideoWindow: 主窗口，负责 MPV 渲染。
 * - ControlView (BrowserView): 挂载在 VideoWindow 上的 Web 内容层。
 * 
 * 优势：
 * - 性能更好，无需双窗口同步。
 * - 原生支持 macOS 全屏体验（Spaces）。
 */
export class MacStrategy extends EventEmitter implements WindowController {
  private videoWindow: BrowserWindow | null = null
  private controlView: BrowserView | null = null
  private lifecycle: WindowLifecycle

  constructor() {
    super()
    this.lifecycle = new WindowLifecycle()
  }

  async init(options: WindowCreationOptions): Promise<void> {
    this.lifecycle.transition(WindowEvent.INIT)
    logger.info('Initializing Mac Strategy (Single-Window)...')

    try {
      // 1. 获取 VideoWindow (从池中)
      this.videoWindow = WindowPool.getInstance().acquire('video')
      
      // 设置 VideoWindow 初始状态
      // macOS 上透明窗口也可以，或者设为黑色
      this.videoWindow.setBackgroundColor('#00000000') 
      
      // 2. 计算初始位置和大小
      const bounds = this.calculateInitialBounds(options)
      this.videoWindow.setBounds(bounds)

      // 3. 创建并挂载 BrowserView
      // BrowserView 不支持 Pool (因为绑定在 Window 上)，需要实时创建或复用
      // 为了性能，我们可以缓存一个 View，或者每次新建（View 创建比 Window 快）
      this.setupControlView()

      // 4. 设置事件监听
      this.setupEventListeners()

      // 5. 显示窗口
      if (!options.preload) {
        this.show()
      } else {
        this.lifecycle.transition(WindowEvent.HIDE)
      }

    } catch (error) {
      logger.error('Failed to initialize MacStrategy', error)
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
        preload: join(__dirname, '../../../preload/preload.js') // 注意路径层级
      }
    })

    this.controlView.setBackgroundColor('#00000000') // 透明背景
    this.videoWindow.setBrowserView(this.controlView)
    
    // 自动调整大小
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

    // 转发键盘事件 (BrowserView)
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
      this.controlView.webContents.loadFile(join(__dirname, '../../../renderer/index.html'), {
        hash: 'control'
      }).catch(() => {})
    }
  }

  setControlBarVisibility(visible: boolean): void {
    // macOS 上 BrowserView 可以被移除或设为透明
    // 但通常我们只需要前端隐藏 DOM 即可。
    // 如果需要彻底隐藏（如纯净模式）：
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
    // macOS 上 VideoWindow 就是 InputWindow (BrowserView 接收事件)
    return this.videoWindow
  }

  getVideoWindow(): BrowserWindow | null {
    return this.videoWindow
  }

  resetLayout(): void {
    // macOS 通常不需要手动 reset，AutoResize 会处理
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
    logger.info('Disposing MacStrategy resources')
    
    // BrowserView 会随 Window 销毁，但如果是 Pool 的 Window，需要手动清理 View
    if (this.videoWindow && this.controlView) {
      try {
        this.videoWindow.setBrowserView(null)
        // BrowserView 没有 destroy 方法，解除引用等待 GC，或 webContents.destroy()
        if (!this.controlView.webContents.isDestroyed()) {
             // (Optional) this.controlView.webContents.destroy() 
             // 但这可能会导致 crash 如果 view 正在被使用
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
