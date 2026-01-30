import { BrowserWindow } from 'electron'
import { createLogger } from '../../infrastructure/logging'
import { WINDOW_DELAYS } from '../constants'

const logger = createLogger('WindowSynchronizer')

/**
 * 窗口同步器
 * 
 * 负责将 VideoWindow（父/背景）与 ControlWindow（子/前景）的几何属性保持同步。
 * 采用 "Event-Driven + Throttle" 策略，替代高频轮询，降低 CPU 消耗。
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
    logger.debug('Starting window synchronization (Event-Driven)')

    // 1. 初始同步
    this.syncVideoToControl()

    // 2. 绑定事件监听 (Windows)
    // 注意：在 Windows 上，用户拖动的是 ControlWindow (子窗口/前景)
    // 我们需要将其移动应用到 VideoWindow (父窗口/背景)
    this.controlWindow.on('move', this.throttledSync)
    this.controlWindow.on('resize', this.throttledSync)
    
    // 某些情况下 move 事件可能不频繁，补充 moved/resized
    this.controlWindow.on('moved', this.syncVideoToControl)
    this.controlWindow.on('resized', this.syncVideoToControl)

    // 3. 只有在窗口显示时才启用低频心跳 (2s)，用于纠正潜在的事件丢失
    // 相比原来的 100ms，2000ms 几乎没有开销
    this.syncTimer = setInterval(() => {
      this.syncVideoToControl()
    }, 2000)
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

  // 简单的节流封装
  private pendingSync = false
  private throttledSync = () => {
    if (this.pendingSync) return
    this.pendingSync = true
    
    // 使用 setImmediate 或 setTimeout(0) 将同步推迟到当前事件循环结束
    // 或者使用 16ms (60fps) 限制
    setTimeout(() => {
      this.syncVideoToControl()
      this.pendingSync = false
    }, WINDOW_DELAYS.RESIZE_THROTTLE_MS || 16)
  }

  private syncVideoToControl = () => {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || 
        !this.controlWindow || this.controlWindow.isDestroyed()) {
      // 如果窗口已销毁，自动停止同步
      this.stopSync()
      return
    }

    try {
      const bounds = this.controlWindow.getBounds()
      
      // 检查是否有实质性变化，避免无效调用
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
      // 忽略窗口销毁过程中的错误
    }
  }
}
