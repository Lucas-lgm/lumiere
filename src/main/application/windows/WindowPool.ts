import { BrowserWindow, app, screen } from 'electron'
import { createLogger } from '../../infrastructure/logging'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const logger = createLogger('WindowPool')
const __dirname = dirname(fileURLToPath(import.meta.url))

export interface PooledWindow {
  window: BrowserWindow
  id: string
  inUse: boolean
  type: 'video' | 'control' // 区分窗口类型，方便复用
}

/**
 * Window Pool (High-Performance Optimization)
 * 
 * 维护一个预创建的窗口池，彻底消除窗口创建的数百毫秒延迟。
 * 
 * 核心机制：
 * 1. Pre-warming: 在应用启动或空闲时预先创建不可见的窗口。
 * 2. Recycling: 窗口关闭时不是销毁，而是隐藏并重置状态放回池中。
 * 3. Lazy Expansion: 如果池空了，按需创建。
 */
export class WindowPool {
  private static instance: WindowPool
  private pool: PooledWindow[] = []
  private readonly MAX_POOL_SIZE = 3
  
  // 默认窗口配置（作为模板）
  private readonly DEFAULT_VIDEO_OPTIONS: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 720,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // 即使是视频窗口，也设为透明以便通用
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false // 关键：后台不降频，保证预热有效
    }
  }

  private constructor() {
    // 单例模式
  }

  static getInstance(): WindowPool {
    if (!WindowPool.instance) {
      WindowPool.instance = new WindowPool()
    }
    return WindowPool.instance
  }

  /**
   * 初始化池，预热窗口
   */
  async init(): Promise<void> {
    logger.info('Initializing WindowPool...')
    // 预创建一个视频窗口
    this.createWindow('video')
  }

  /**
   * 获取一个可用窗口
   * @param type 窗口类型
   */
  acquire(type: 'video' | 'control'): BrowserWindow {
    // 1. 查找空闲窗口
    const existing = this.pool.find(p => !p.inUse && p.type === type && !p.window.isDestroyed())
    
    if (existing) {
      logger.debug(`Acquired pooled window [${existing.id}]`)
      existing.inUse = true
      return existing.window
    }

    // 2. 如果没有，创建新的
    logger.debug(`No pooled window available, creating new [${type}]`)
    const pooled = this.createWindow(type)
    pooled.inUse = true
    return pooled.window
  }

  /**
   * 归还窗口到池中（而不是销毁）
   * @param window 窗口实例
   */
  release(window: BrowserWindow): void {
    if (window.isDestroyed()) {
      this.removeFromPool(window)
      return
    }

    const entry = this.pool.find(p => p.window === window)
    if (!entry) {
      // 不在池里的窗口，直接销毁
      window.destroy()
      return
    }

    logger.debug(`Releasing window [${entry.id}] to pool`)
    
    // 重置状态（但不再强制加载 about:blank，由上层策略负责加载实际页面）
    try {
      window.hide()
      window.setParentWindow(null) // 解除父子关系
      
      // 移除所有监听器，防止内存泄漏和逻辑干扰
      window.removeAllListeners()
      window.webContents.removeAllListeners()
      
      // 恢复一些基础属性
      window.setOpacity(1)
      window.setIgnoreMouseEvents(false)
      
      entry.inUse = false
    } catch (error) {
      logger.error('Failed to reset window for pooling', error)
      // 如果重置失败，安全起见销毁它
      this.removeFromPool(window)
      window.destroy()
    }
  }

  /**
   * 销毁所有窗口（应用退出时）
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
    // 合并配置
    const options = { ...this.DEFAULT_VIDEO_OPTIONS }
    
    // 确保 preload 脚本路径正确
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

    // 监听意外关闭，从池中移除
    win.on('closed', () => {
      this.removeFromPool(win)
    })

    this.pool.push(entry)
    
    // 预加载空页面或通用模板，确保渲染进程已启动
    // 这样下次 loadURL 时会快很多
    win.loadURL('about:blank')

    return entry
  }

  private removeFromPool(window: BrowserWindow) {
    this.pool = this.pool.filter(p => p.window !== window)
  }
}
