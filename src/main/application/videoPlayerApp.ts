import { app, BrowserWindow, BrowserView, screen } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { WindowManager } from './windows/windowManager'
import { WindowPool } from './windows/WindowPool'
import { WindowController } from './windows/WindowController'
import { WindowStrategyFactory } from './windows/WindowStrategyFactory'
import type { CorePlayer } from './core/corePlayer'
import type { PlayerStatus } from './core/MediaPlayer'
import type { PlayVideoRequest } from './command/ipcTypes'
import { Playlist } from '../domain/models/Playlist'
import { Media } from '../domain/models/Media'
import { createLogger } from '../infrastructure/logging'
import { VIDEO_PLAYER_DELAYS, WINDOW_DELAYS, UI_DELAYS } from './constants'

const logger = createLogger('VideoPlayerApp')

export interface PlaylistItem {
  path: string
  name: string
  /**
   * 起播时间（秒，可选）
   * - 用于记忆播放 / 指定从某个时间点开始播放
   */
  startTime?: number
}

class ConfigManager {
  private volume: number = 100
  private readonly configPath: string
  // 记忆播放进度：path -> lastPositionInSeconds
  private playbackPositions: Record<string, number> = {}

  constructor() {
    const userData = app.getPath('userData')
    const legacyPath = join(userData, 'mpv-player-config.json')
    const newPath = join(userData, 'video-player-config.json')

    if (existsSync(newPath)) {
      this.configPath = newPath
    } else {
      this.configPath = newPath
      if (existsSync(legacyPath)) {
        try {
          const raw = readFileSync(legacyPath, 'utf-8')
          const data = JSON.parse(raw)
          if (typeof data.volume === 'number') {
            this.volume = data.volume
          }
          writeFileSync(this.configPath, JSON.stringify({ volume: this.volume }), 'utf-8')
        } catch {
        }
      }
    }
    this.load()
  }

  private load() {
    try {
      if (!existsSync(this.configPath)) {
        return
      }
      const raw = readFileSync(this.configPath, 'utf-8')
      const data = JSON.parse(raw)
      if (typeof data.volume === 'number') {
        this.volume = data.volume
      }
      if (data.playbackPositions && typeof data.playbackPositions === 'object') {
        const map: Record<string, number> = {}
        for (const [path, pos] of Object.entries(data.playbackPositions)) {
          if (typeof pos === 'number' && isFinite(pos) && pos > 0) {
            map[path] = pos
          }
        }
        this.playbackPositions = map
      }
    } catch {
    }
  }

  private save() {
    try {
      const data = {
        volume: this.volume,
        playbackPositions: this.playbackPositions
      }
      writeFileSync(this.configPath, JSON.stringify(data), 'utf-8')
    } catch {
    }
  }

  getVolume() {
    return this.volume
  }

  setVolume(value: number) {
    this.volume = value
    this.save()
  }

  /**
   * 获取某个媒体的上次播放进度（秒）
   */
  getLastPosition(path: string): number | undefined {
    return this.playbackPositions[path]
  }

  /**
   * 记录某个媒体的播放进度（秒）
   */
  setLastPosition(path: string, position: number): void {
    if (!path) return
    if (typeof position !== 'number' || !isFinite(position)) return
    
    // 如果进度 <= 0，则移除记录（视为重置）
    if (position <= 0) {
      if (path in this.playbackPositions) {
        delete this.playbackPositions[path]
        this.save()
      }
      return
    }

    this.playbackPositions[path] = position
    this.save()
  }
}

export class VideoPlayerApp {
  readonly windowManager: WindowManager
  readonly playlist: Playlist
  readonly config: ConfigManager
  
  // 新的窗口控制器（替代原有的 loose controlWindow/controlView）
  private windowController: WindowController | null = null
  
  private isQuitting: boolean = false
  private lastPlayerPhase: string = 'idle'
  /** 当前期望播放的视频路径（用于过滤过期的播放状态） */
  private currentVideoPath: string | null = null

  private readonly onEndedPlayNext = (status: PlayerStatus) => {
    const prev = this.lastPlayerPhase
    const next = status.phase
    this.lastPlayerPhase = next

    if (prev === 'playing' && next === 'ended') {
      this.playNextFromPlaylist().catch(() => {})
    }
  }

  /**
   * 业务侧监听：记忆播放进度 + 转发给前端
   */
  private readonly onPlayerStatusBroadcast = (status: PlayerStatus) => {
    // 过滤掉不属于当前期望视频的状态更新（避免快速切换视频时的状态乱序/闪烁）
    // 如果 status.path 为空（如 idle/stopped），通常允许通过，除非明确需要过滤
    // 但为了保险，如果当前有期望视频，且状态中的 path 存在且不匹配，则丢弃
    if (this.currentVideoPath && status.path && status.path !== this.currentVideoPath) {
      logger.debug('Ignored stale player status', { 
        expected: this.currentVideoPath, 
        received: status.path,
        phase: status.phase 
      })
      return
    }

    // 1) 先做业务：记忆播放进度
    const path = status.path
    
    if (path) {
      if (status.phase === 'ended') {
        // 播放结束，重置进度为 0 (删除记录)
        this.config.setLastPosition(path, 0)
      } else {
        const currentTime = status.currentTime
        if (
          typeof currentTime === 'number' &&
          isFinite(currentTime) &&
          currentTime > 0
        ) {
          // 只在「稳定阶段」记录进度，避免 loading 抖动：
          // playing / paused / stopped / error
          // 注意：ended 已经在上面单独处理了
          if (
            status.phase === 'playing' ||
            status.phase === 'paused' ||
            status.phase === 'stopped' ||
            status.phase === 'error'
          ) {
            this.config.setLastPosition(path, currentTime)
          }
        }
      }
    }

    // 2) 再广播给前端
    this.sendToPlaybackUIs('player-status', status)
  }

  constructor(private readonly corePlayer: CorePlayer) {
    this.windowManager = new WindowManager()
    this.config = new ConfigManager()
    this.playlist = new Playlist()
    this.corePlayer.onPlayerStatus(this.onEndedPlayNext)
    this.corePlayer.on('player-status', this.onPlayerStatusBroadcast)
    
    // 初始化窗口池
    WindowPool.getInstance().init().catch(err => {
      logger.error('Failed to init WindowPool', err)
    })
  }

  /** 播放媒体（原 ApplicationService.playMedia 逻辑内联） */
  async playMedia(opts: {
    mediaUri: string
    mediaName?: string
    options?: {
      volume?: number
      addToPlaylist?: boolean
      /**
       * 显式起播时间（秒，可选）
       * - 优先级高于后端记忆的播放进度
       */
      startTime?: number
    }
  }): Promise<void> {
    const media = Media.create(opts.mediaUri, { title: opts.mediaName })
    const addToPlaylist = opts.options?.addToPlaylist !== false
    if (addToPlaylist) {
      this.playlist.add(media, opts.options?.startTime)
      this.playlist.setCurrentByUri(media.uri)
    }

    let startTime: number | undefined
    const explicitStart = opts.options?.startTime
    if (typeof explicitStart === 'number' && isFinite(explicitStart) && explicitStart > 0) {
      startTime = explicitStart
    } else {
      const lastPosition = this.config.getLastPosition(media.uri)
      if (typeof lastPosition === 'number' && isFinite(lastPosition) && lastPosition > 0) {
        startTime = lastPosition
      }
    }

    await this.corePlayer.play(media, startTime)
    if (opts.options) {
      if (opts.options.volume !== undefined) {
        await this.corePlayer.setVolume(opts.options.volume)
      }
    }
  }

  async pausePlayback(): Promise<void> {
    await this.corePlayer.pause()
  }

  async resumePlayback(): Promise<void> {
    await this.corePlayer.resume()
  }

  async seek(time: number): Promise<void> {
    await this.corePlayer.seek(time)
  }

  async setVolume(volume: number): Promise<void> {
    await this.corePlayer.setVolume(volume)
    this.config.setVolume(volume)
  }

  async stopPlayback(): Promise<void> {
    await this.corePlayer.stop()
  }

  /**
   * 检查当前是否有视频在播放
   * @returns true 如果有视频在播放、加载中、暂停
   */
  private hasActiveVideo(): boolean {
    const status = this.corePlayer.getPlayerStatus()
    const phase = status.phase
    return phase === 'loading' || 
           phase === 'playing' || 
           phase === 'paused'
  }

  /** 移除对 CorePlayer 的监听，在 cleanup 前调用，避免泄漏 */
  private releaseCorePlayerListeners(): void {
    this.corePlayer.offPlayerStatus(this.onEndedPlayNext)
    this.corePlayer.off('player-status', this.onPlayerStatusBroadcast)
  }

  getControlWindow(): BrowserWindow | null {
    return this.windowController?.getInputWindow() || null
  }

  // 移除 getControlView，因为它现在封装在策略中，上层不需要关心它是 Window 还是 View
  // 如果必须获取，可以通过策略接口扩展，但通常通过 IPC 发送消息不需要直接拿 View

  /** 向播放 UI（视频窗口 + 控制栏）广播；职责归 VideoPlayerApp，不经过 CorePlayer */
  private sendToPlaybackUIs(channel: string, payload?: unknown): void {
    // 1. 发送给 VideoWindow (底座)
    const vw = this.windowController?.getVideoWindow()
    if (vw && !vw.isDestroyed() && !vw.webContents.isDestroyed()) {
      try {
        vw.webContents.send(channel, payload)
      } catch (error) {
        // 忽略发送失败（窗口可能正在关闭）
      }
    }
    
    // 2. 发送给 Control Layer (Window 或 BrowserView)
    if (this.windowController) {
        this.windowController.sendToControlLayer(channel, payload)
    }
  }


  getList(): PlaylistItem[] {
    return this.playlist.getAll().map((e) => ({
      path: e.media.uri,
      name: e.media.displayName,
      startTime: e.startTime
    }))
  }

  setList(items: PlaylistItem[]): void {
    this.playlist.clear()
    for (const it of items) {
      this.playlist.add(Media.create(it.path, { title: it.name }), it.startTime)
    }
    if (items.length > 0) this.playlist.setCurrentByIndex(0)
  }

  setCurrentByPath(path: string): void {
    this.playlist.setCurrentByUri(path)
  }

  getCurrent(): PlaylistItem | null {
    const cur = this.playlist.getCurrent()
    return cur
      ? {
          path: cur.media.uri,
          name: cur.media.displayName
          // startTime 由前端或 config 决定，这里不反推
        }
      : null
  }

  next(): PlaylistItem | null {
    const n = this.playlist.next()
    return n
      ? {
          path: n.media.uri,
          name: n.media.displayName
        }
      : null
  }

  prev(): PlaylistItem | null {
    const p = this.playlist.previous()
    return p
      ? {
          path: p.media.uri,
          name: p.media.displayName
        }
      : null
  }

  async play(target: PlaylistItem, startTimeOverride?: number) {
    if (this.hasActiveVideo()) {
      this.corePlayer.setSwitching(true)
      try {
        await this.stopPlayback()
        // 等待一小段时间，确保停止操作完成
        await new Promise(resolve => setTimeout(resolve, VIDEO_PLAYER_DELAYS.STOP_WAIT_MS))
      } catch (error) {
        // 停止失败不影响新视频播放，记录错误即可
        logger.error('Failed to stop current video', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    this.corePlayer.resetStatus()

    // UI 层职责：窗口管理
    const mainWindow = this.windowManager.getWindow('main')
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide()
    }

    // 初始化/获取 WindowController (Strategy)
    if (!this.windowController) {
      this.windowController = WindowStrategyFactory.create()
      
      // 转发事件
      this.windowController.on('close', () => {
          // 处理窗口关闭逻辑，比如恢复主窗口
          this.handleWindowClose()
      })
      this.windowController.on('fullscreen-enter', () => {
          // 可选：通知前端
      })
      this.windowController.on('fullscreen-exit', () => {
          // 可选：通知前端
      })
      this.windowController.on('key-down', (key) => {
          this.corePlayer.sendKey(key)
      })
      
      // 初始化窗口
      await this.windowController.init({
          title: '视频播放器 - 视频播放',
          width: 1280,
          height: 720,
          // 如果需要预加载，可以在构造函数里做，这里直接 init
      })
    }

    const videoWindow = this.windowController.getVideoWindow()
    if (!videoWindow) {
      // 创建窗口失败
      this.corePlayer.setSwitching(false)
      return
    }

    // 确保窗口置顶和聚焦
    const inputWin = this.windowController.getInputWindow()
    if (inputWin) {
        if (!inputWin.isVisible()) inputWin.show()
        inputWin.focus()
    }

    await new Promise(resolve => setTimeout(resolve, VIDEO_PLAYER_DELAYS.VIDEO_WINDOW_SHOW_WAIT_MS))

    // 设置视频窗口（同时设置 MpvMediaPlayer 的 windowId）
    await this.corePlayer.setVideoWindow(videoWindow)

    // 初始化播放器、挂载窗口，供 RenderManager 使用
    await this.corePlayer.ensureMediaPlayerReadyForPlayback()

    // 通知播放 UI：当前播放条目已切换
    this.sendToPlaybackUIs('current-video-changed', {
      name: target.name,
      path: target.path
    })

    // 更新当前期望视频路径
    this.currentVideoPath = target.path

    // 起播时间：优先使用显式 override，其次使用 PlaylistItem 自带的 startTime
    const effectiveStartTime =
      typeof startTimeOverride === 'number' && isFinite(startTimeOverride) && startTimeOverride > 0
        ? startTimeOverride
        : target.startTime

    try {
      await this.playMedia({
        mediaUri: target.path,
        mediaName: target.name,
        options: {
          volume: this.config.getVolume(),
          addToPlaylist: false,
          startTime: effectiveStartTime
        }
      })
      // 播放开始后，切换状态会在第一个有效的 player-status（phase 进入 loading/playing/paused/error）时自动清除
      // 由 PlayerStateMachine.updateFromStatus() 自动处理
    } catch (error) {
      // 统一使用 player-status 通道承载错误信息（phase=error + errorMessage）
      this.corePlayer.setError(error instanceof Error ? error.message : 'Unknown error')
      // 错误时，切换状态会在 setError 后的 player-status（phase=error）时自动清除
    }
  }

  async playCurrentFromPlaylist() {
    const current = this.getCurrent()
    if (!current) return
    await this.play(current)
  }

  async playNextFromPlaylist() {
    const item = this.next()
    if (!item) return
    await this.play(item)
  }

  async playPrevFromPlaylist() {
    const item = this.prev()
    if (!item) return
    await this.play(item)
  }

  async setHdrEnabled(enabled: boolean) {
    this.corePlayer.setHdrEnabled(enabled)
  }

  /** 向播放 UI 广播当前播放列表（ipcHandlers 仅触发） */
  broadcastPlaylistUpdated(): void {
    this.sendToPlaybackUIs('playlist-updated', this.getList())
  }

  async sendKey(key: string) {
    await this.corePlayer.sendKey(key)
  }

  // ========== IPC 层调用的业务方法（封装业务逻辑，避免 ipcHandlers 包含业务） ==========

  /** 处理 play-video IPC：添加到列表（如不存在）、设为当前、播放、广播列表更新 */
  async handlePlayVideo(file: PlayVideoRequest): Promise<void> {
    const currentList = this.getList()
    if (!currentList.some(item => item.path === file.path)) {
      this.setList([
        ...currentList,
        {
          name: file.name,
          path: file.path,
          startTime: file.startTime
        }
      ])
    }
    this.setCurrentByPath(file.path)
    await this.play({ path: file.path, name: file.name, startTime: file.startTime })
    this.broadcastPlaylistUpdated()
  }

  /** 处理 play-url IPC：设置列表、播放、广播列表更新 */
  async handlePlayUrl(url: string): Promise<void> {
    const item: PlaylistItem = { path: url, name: url }
    this.setList([item])
    this.setCurrentByPath(item.path)
    await this.play(item)
    this.broadcastPlaylistUpdated()
  }

  /** 处理 control-play IPC：根据状态决定是播放当前项还是恢复播放 */
  async handleControlPlay(): Promise<void> {
    const status = this.corePlayer.getPlayerStatus()
    if (status.phase === 'ended' || status.phase === 'stopped') {
      await this.playCurrentFromPlaylist()
    } else {
      await this.resumePlayback()
    }
  }

  /** 处理文件选择结果：广播到主窗口 */
  handleFileSelected(file: { name: string; path: string }): void {
    const mainWindow = this.windowManager.getWindow('main')
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-file-selected', file)
    }
  }

  /** 切换全屏（封装窗口操作逻辑） */
  toggleFullscreen(): void {
    if (this.windowController) {
        this.windowController.toggleFullscreen()
    }
  }

  /** 窗口操作（封装窗口操作逻辑） */
  windowAction(action: 'close' | 'minimize' | 'maximize'): void {
    if (this.windowController) {
        this.windowController.handleWindowAction(action)
    }
  }

  // 处理窗口关闭后的清理和 UI 恢复
  private handleWindowClose() {
      // 停止播放
      this.corePlayer.stop().catch(() => {})
      
      // 清理 Controller 引用
      // 注意：Strategy 的 dispose 已经在 emit 'close' 前被调用或由 Strategy 内部管理
      // 这里主要是 App 层面的清理
      this.windowController = null

      if (this.isQuitting) {
          // 如果是退出应用，不需要显示主窗口
          return
      }

      // 恢复主窗口
      const mainWindow = this.windowManager.getWindow('main')
      if (!mainWindow || mainWindow.isDestroyed()) {
        this.createMainWindow()
      } else {
        if (!mainWindow.isVisible()) {
          mainWindow.show()
        }
        mainWindow.focus()
      }
  }

  createMainWindow() {
    const mainWindow = this.windowManager.createWindow({
      id: 'main',
      width: 1200,
      height: 800,
      title: '视频播放器 - 视频列表',
      route: '#/'
    })

    // 监听主窗口关闭事件（使用 once 确保只触发一次）
    mainWindow.once('close', async (event) => {
      if (this.isQuitting) {
        return
      }
      logger.debug('Main window closing')
      this.isQuitting = true
      this.releaseCorePlayerListeners()
      await this.corePlayer.cleanup().catch(() => {})
      // 退出应用
      app.quit()
      // 注意：在开发模式下，app.quit() 只会退出 Electron 应用，
      // Vite 开发服务器会继续运行。要完全退出开发环境，请在终端按 Ctrl+C
    })

    return mainWindow
  }

  /** 注册 app 生命周期与进程信号监听（由 bootstrap 在 whenReady 之后调用） */
  registerAppListeners() {
    app.on('window-all-closed', () => {
      if (!this.isQuitting) {
        this.isQuitting = true
        this.releaseCorePlayerListeners()
        this.corePlayer.cleanup().catch(() => {})
      }
      app.quit()
    })
    app.on('before-quit', () => {
      this.isQuitting = true
    })
    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.info(`Received ${signal}, quitting app`)
      this.isQuitting = true
      this.releaseCorePlayerListeners()
      await this.corePlayer.cleanup().catch(() => {})
      const windows = BrowserWindow.getAllWindows()
      windows.forEach((w) => {
        if (!w.isDestroyed()) w.destroy()
      })
      app.exit(0)
    }
    process.on('SIGINT', handleSignal)
    process.on('SIGTERM', handleSignal)
  }
}
