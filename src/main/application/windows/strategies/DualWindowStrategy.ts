import { BrowserWindow, screen } from 'electron'
import { EventEmitter } from 'events'
import { createLogger } from '../../../infrastructure/logging'
import { WindowController, WindowCreationOptions, WindowAction } from '../WindowController'
import { WindowSynchronizer } from '../WindowSynchronizer'
import { WindowPool } from '../WindowPool'
import { WindowLifecycle, WindowEvent, WindowState } from '../WindowLifecycle'
import { mapElectronInputToMpvKey } from '../../utils/InputMapper'
import { UI_DELAYS, WINDOW_DELAYS } from '../../constants'
import { join } from 'path'

const logger = createLogger('DualWindowStrategy')

/**
 * Windows Strategy: Dual-Window Composition
 * 
 * 专为 Windows 平台设计的窗口组合策略。
 * 
 * 架构：
 * - VideoWindow (Bottom): 负责 MPV 渲染，无边框，不可点击，忽略鼠标事件。
 * - ControlWindow (Top): 负责 UI 交互，无边框，透明，处理用户输入。
 * - Synchronizer: 负责将 Top 的位置/大小同步给 Bottom。
 */
export class DualWindowStrategy extends EventEmitter implements WindowController {
  private videoWindow: BrowserWindow | null = null
  private controlWindow: BrowserWindow | null = null
  private synchronizer: WindowSynchronizer | null = null
  private lifecycle: WindowLifecycle

  constructor() {
    super()
    this.lifecycle = new WindowLifecycle()
    
    // 监听生命周期变化，转发事件
    this.lifecycle.on('state-changed', (newState, oldState) => {
      // 可以在这里处理统一的副作用，比如通知渲染进程状态变更
    })
  }
  hide(): void {
    this.videoWindow?.hide()
    this.controlWindow?.hide()
    this.lifecycle.transition(WindowEvent.HIDE)
  }

  async init(options: WindowCreationOptions): Promise<void> {
    this.lifecycle.transition(WindowEvent.INIT)
    logger.info('Initializing Dual Window Strategy...')

    try {
      // 1. 获取 VideoWindow (从池中)
      this.videoWindow = WindowPool.getInstance().acquire('video')
      
      // 2. 获取 ControlWindow (从池中)
      this.controlWindow = WindowPool.getInstance().acquire('control')
      
      // 3. 计算初始位置和大小
      const bounds = this.calculateInitialBounds(options)
      
      // 4. 应用位置
      this.videoWindow.setBounds(bounds)
      this.controlWindow.setBounds(bounds)

      // 5. 建立父子关系
      this.controlWindow.setParentWindow(this.videoWindow)

      // 6. 初始化同步器
      this.synchronizer = new WindowSynchronizer(this.videoWindow, this.controlWindow)
      this.synchronizer.startSync()

      // 7. 设置输入转发和事件处理
      this.setupEventListeners()

      // 8. 加载 UI 内容 (如果需要)
      this.reloadControlLayer()

      // 9. 显示窗口 (如果不是预加载)
      if (!options.preload) {
        this.show()
      } else {
        this.lifecycle.transition(WindowEvent.HIDE)
      }
      
      // 10. 强制刷新一次 VideoWindow 的大小，确保 MPV 能获取到正确的尺寸
      if (this.videoWindow.isVisible()) {
          const bounds = this.videoWindow.getBounds()
          this.videoWindow.setBounds({ ...bounds, width: bounds.width + 1 })
          this.videoWindow.setBounds(bounds)
      }

    } catch (error) {
      logger.error('Failed to initialize DualWindowStrategy', error)
      this.dispose()
      throw error
    }
  }

  private calculateInitialBounds(options: WindowCreationOptions): Electron.Rectangle {
    if (options.x !== undefined && options.y !== undefined && options.width && options.height) {
      return { x: options.x, y: options.y, width: options.width, height: options.height }
    }
    
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea
    const width = options.width || 1280
    const height = options.height || 720
    const x = Math.floor(workArea.x + (workArea.width - width) / 2)
    const y = Math.floor(workArea.y + (workArea.height - height) / 2)
    
    return { x, y, width, height }
  }

  private setupEventListeners() {
    if (!this.controlWindow || !this.videoWindow) return

    // 转发 ControlWindow 的关闭事件到 Strategy
    this.controlWindow.on('closed', () => {
      this.emit('close')
      this.dispose() // 策略层面的清理
    })

    // 转发 Focus/Blur
    this.controlWindow.on('focus', () => this.emit('focus'))
    this.controlWindow.on('blur', () => this.emit('blur'))
    
    // 全屏事件监听
    this.controlWindow.on('enter-full-screen', () => {
      this.lifecycle.transition(WindowEvent.ENTER_FULLSCREEN)
      this.emit('fullscreen-enter')
    })
    this.controlWindow.on('leave-full-screen', () => {
      this.lifecycle.transition(WindowEvent.EXIT_FULLSCREEN)
      this.emit('fullscreen-exit')
    })
    
    // 鼠标穿透逻辑：
    // 当鼠标在 ControlWindow 上时，如果是在交互区（按钮等），接收事件。
    // 如果是在透明背景区，我们是否需要穿透？
    // MPV 不需要鼠标事件（除了双击全屏，这可以由 ControlWindow 捕获模拟）。
    // 所以 ControlWindow 应该始终拦截鼠标事件。
    
    // 确保 VideoWindow 忽略鼠标
    this.videoWindow.setIgnoreMouseEvents(true)

    // 转发键盘事件到 MPV
    this.controlWindow.webContents.on('before-input-event', (event, input) => {
      const mpvKey = mapElectronInputToMpvKey(input)
      if (mpvKey) {
        event.preventDefault()
        this.emit('key-down', mpvKey)
      }
    })
  }

  show() {
    if (!this.videoWindow || !this.controlWindow) return
    
    // 先显示 VideoWindow (底层)
    this.videoWindow.showInactive()
    
    // 再显示 ControlWindow (顶层)
    this.controlWindow.show()
    this.controlWindow.focus()
    
    this.lifecycle.transition(WindowEvent.SHOW)
  }

  reloadControlLayer(): void {
    if (!this.controlWindow) return
    
    // 加载控制界面
    if (process.env.NODE_ENV === 'development') {
      const url = 'http://localhost:5173/#/control'
      this.controlWindow.loadURL(url).catch(() => {})
      // this.controlWindow.webContents.openDevTools({ mode: 'detach' })
    } else {
      this.controlWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: 'control'
      }).catch(() => {})
    }
  }

  setControlBarVisibility(visible: boolean): void {
    if (!this.controlWindow || this.controlWindow.isDestroyed()) return
    
    // Windows 策略下，我们不隐藏整个窗口（因为它是拖动的句柄），而是通过 IPC 通知前端隐藏 UI 元素
    // 或者，如果真的要隐藏，需要确保 VideoWindow 变成可拖动（太复杂）。
    // 所以通常保持 ControlWindow 显示，只是让前端渲染透明。
    
    // 但如果是全屏模式下的自动隐藏，前端会处理 DOM 显隐。
    // 这里我们只需确保窗口本身是交互式的。
    
    // 如果确实需要隐藏整个 UI 层（例如纯净模式）：
    // this.controlWindow.setOpacity(visible ? 1 : 0) // 简单粗暴但有效
  }

  handleWindowAction(action: WindowAction): void {
    if (!this.controlWindow || this.controlWindow.isDestroyed()) return

    switch (action) {
      case 'close':
        this.lifecycle.transition(WindowEvent.CLOSE)
        this.controlWindow.close() // 这会触发 closed 事件，进而调用 dispose
        break
      case 'minimize':
        if (this.lifecycle.transition(WindowEvent.MINIMIZE)) {
          this.controlWindow.minimize()
          // VideoWindow 会由系统行为或同步器跟随，或者我们需要显式最小化
          // Windows 上子窗口通常随父窗口最小化，但如果是并行关系则需要手动
          this.videoWindow?.minimize()
        }
        break
      case 'maximize':
        if (!this.controlWindow.isMaximized()) {
          this.controlWindow.maximize()
        } else {
          // 如果已经是最大化状态，再次点击视为"还原"
          this.controlWindow.unmaximize()
        }
        break
      case 'restore':
        if (this.controlWindow.isMaximized()) {
          this.controlWindow.unmaximize()
        } else if (this.controlWindow.isMinimized()) {
          this.controlWindow.restore()
          this.lifecycle.transition(WindowEvent.RESTORE)
        }
        break
    }
  }

  toggleFullscreen(): void {
    if (!this.controlWindow) return
    
    // Windows 平台下，子窗口的 isFullScreen() 属性不可靠，可能一直返回 false。
    // 我们使用 lifecycle 状态机来判断当前是否全屏。
    const isNativeFullscreen = this.controlWindow.isFullScreen()
    const isLifecycleFullscreen = this.lifecycle.state === WindowState.FULLSCREEN
    
    logger.info(`toggleFullscreen called. Native: ${isNativeFullscreen}, Lifecycle: ${this.lifecycle.state}`)

    // 优先使用 Lifecycle 状态，如果 Lifecycle 说是全屏，那我们就退出全屏
    const targetFullscreen = !isLifecycleFullscreen

    this.controlWindow.setFullScreen(targetFullscreen)
    this.videoWindow?.setFullScreen(targetFullscreen)
  }

  getInputWindow(): BrowserWindow | null {
    return this.controlWindow
  }

  getVideoWindow(): BrowserWindow | null {
    return this.videoWindow
  }

  resetLayout(): void {
    // 当屏幕分辨率改变或从全屏异常退出时
    if (this.controlWindow && !this.controlWindow.isDestroyed()) {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize
      const w = 1280
      const h = 720
      this.controlWindow.setBounds({
        x: (width - w) / 2,
        y: (height - h) / 2,
        width: w,
        height: h
      })
      // Synchronizer will catch up
    }
  }

  sendToControlLayer(channel: string, ...args: any[]): void {
    if (this.controlWindow && !this.controlWindow.isDestroyed()) {
      try {
        this.controlWindow.webContents.send(channel, ...args)
      } catch (e) {
        // ignore
      }
    }
  }

  dispose(): void {
    logger.info('Disposing DualWindowStrategy resources')
    
    if (this.synchronizer) {
      this.synchronizer.stopSync()
      this.synchronizer = null
    }

    // 归还窗口到池中
    if (this.controlWindow) {
      WindowPool.getInstance().release(this.controlWindow)
      this.controlWindow = null
    }
    
    if (this.videoWindow) {
      WindowPool.getInstance().release(this.videoWindow)
      this.videoWindow = null
    }

    this.lifecycle.transition(WindowEvent.CLOSE) // 确保状态完结
  }
}
