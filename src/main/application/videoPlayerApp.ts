import { app, BrowserWindow, ipcMain, screen, Menu } from 'electron'
import { basename } from 'path'
import { createAppWindow } from './windows/WindowCreator'
import type { MediaPlayer } from './playback/MediaPlayer'
import type { PlaybackCoordinator } from './playback/PlaybackCoordinator'
import { createLogger } from '../infrastructure/logging'
import { t } from '../i18n'
import { setupApplicationMenu } from './setupApplicationMenu'
import type { PlaybackWindowManager } from './playback/PlaybackWindowManager'
import { ConfigManager } from './config/configManager'
import { AppSettingsBridge } from './config/appSettingsBridge'
import { ThumbnailService } from './services/thumbnailService'
import { WhisperService } from './services/whisperService'
import { AnimExportService } from './services/animExportService'
import { MountPathService } from './services/mountPathService'
import { setupIpcHandlers, type IpcHandlerOps } from './command/ipcHandlers'
import { IPC_CHANNELS } from './command/ipcConstants'
import { createPlaybackSubsystem } from './playback/createPlaybackSubsystem'
import type { PlaybackCommands } from './playback/PlaybackScheduler'

const logger = createLogger('VideoPlayerApp')

export type { PlaylistItem } from './types'

export class VideoPlayerApp {
  private readonly config: ConfigManager
  private readonly settingsBridge: AppSettingsBridge
  /**
   * Playback subsystem external surfaces — created by
   * createPlaybackSubsystem(), which encapsulates the complete
   * internal object graph (effectHandler, projector, scheduler,
   * taskQueue).  VideoPlayerApp holds the four externally-visible
   * surfaces:
   *   - coordinator: playback orchestration + session lifecycle
   *     (used only for IPC routing — shutdown is encapsulated in
   *     the factory's shutdown function)
   *   - windowManager: window operations + message delivery
   *   - commands: scheduled playback commands (pause, stop, seek)
   *     for direct IPC routing — bypasses the coordinator
   *   - playbackShutdown: complete subsystem teardown (session +
   *     infrastructure) — symmetric counterpart to the factory's
   *     assembly, encapsulates the full two-phase protocol
   */
  private readonly windowManager: PlaybackWindowManager
  private readonly coordinator: PlaybackCoordinator
  private readonly commands: PlaybackCommands
  private readonly playbackShutdown: () => Promise<void>
  /**
   * Application-level services — created and owned by VideoPlayerApp.
   * Service lifecycle (creation, wiring, teardown) is managed in this
   * single boundary.  IPC handlers receive these via the explicit deps
   * object passed by registerIpcHandlers().
   */
  private readonly thumbnailService: ThumbnailService
  private readonly whisperService: WhisperService
  private readonly animExportService: AnimExportService
  private readonly mountPathService: MountPathService
  /**
   * Direct reference to the media player — passed to:
   *   - IPC handlers as PlayerDirectPort (non-orchestrated operations:
   *     tracks, HDR, keypress, property access, commands, debug)
   *   - Playback subsystem factory as SubsystemPlayerPort (structurally
   *     narrowed to the three port interfaces consumed internally:
   *     PlayerEventSource, PlayerSurface, PlaybackCommandTarget)
   *   - AppSettingsBridge as PlayerConfigPort (settings hot-updates,
   *     volume set/restore, pre-init options)
   *
   * VideoPlayerApp holds the full MediaPlayer type; each consumer
   * narrows it to its own port interface at the boundary crossing.
   */
  private readonly mediaPlayer: MediaPlayer

  private mainWindow: BrowserWindow | null = null
  private isQuitting: boolean = false

  constructor(mediaPlayer: MediaPlayer) {
    this.mediaPlayer = mediaPlayer
    this.config = new ConfigManager()
    // Settings bridge — single dispatch point for ALL setting-change
    // reactions (language, proxy, mpv properties, window side-effects).
    // Receives MediaPlayer as PlayerConfigPort (structurally narrowed to
    // setProperty + setVolume + setInitSettings).
    // Deps closures capture `this`; safe because they're called at
    // runtime, not during construction.
    this.settingsBridge = new AppSettingsBridge(mediaPlayer, this.config, {
      rebuildAppMenu: () => setupApplicationMenu({
        openFile: (path) => this.handleOpenFile(path),
        toggleFullscreen: () => this.windowManager.toggleFullscreen(),
      }),
      broadcastToAllRenderers: (ch, p) => this.broadcastToAllRenderers(ch, p),
      setAspectRatioLock: (ratio) => this.windowManager.setAspectRatioLock(ratio),
    })

    // Application-level services — owned here so the app container
    // manages the complete service lifecycle (creation + teardown).
    // All services receive injected deps instead of self-constructing
    // as singletons, making their lifecycle explicitly managed.
    this.thumbnailService = new ThumbnailService({
      isAutoThumbnailEnabled: () => this.config.getAppSettings().autoThumbnail,
    })
    this.whisperService = new WhisperService()
    this.animExportService = new AnimExportService()
    this.mountPathService = new MountPathService()

    // Assemble the playback subsystem — creates and wires the complete
    // internal object graph (effectHandler → projector → scheduler →
    // coordinator + windowManager).  Internal components and their
    // cross-component wiring (windowManager → coordinator, scheduler →
    // projector) are encapsulated; only coordinator and windowManager
    // are exposed.  The only callbacks that cross the subsystem boundary
    // are app-level lifecycle notifications (macOS integration, main
    // window restoration).
    // Symmetric lifecycle: factory assembles the subsystem AND provides
    // the shutdown function that completely tears it down (session +
    // infrastructure).  VideoPlayerApp calls this single function for
    // shutdown without needing to know the internal phase ordering.
    //
    // External deps cross the boundary through narrow port interfaces:
    //   - WatchProgressPort ← this.config (progress persistence)
    //   - PlayConfigPort ← this.settingsBridge (pre-play settings + volume)
    //   - SeekThumbnailPort ← this.thumbnailService (thumbnail lifecycle)
    // The concrete objects satisfy these interfaces structurally.
    const { coordinator, windowManager, commands, shutdown } = createPlaybackSubsystem(
      mediaPlayer, this.config, this.settingsBridge, this.thumbnailService,
      // App-level callbacks — macOS platform integration + main window
      // restoration (app-level concerns that the coordinator cannot own).
      {
        onPlayStarted: (target) => this.handlePlayStarted(target),
        onPlaybackWindowClosed: () => this.restoreMainWindow(),
      },
      this.settingsBridge,  // VideoEnhancementPort — resolution-adaptive shader control
    )
    this.coordinator = coordinator
    this.windowManager = windowManager
    this.commands = commands
    this.playbackShutdown = shutdown

    // Apply pre-initialization options (hwdec/language/extra options).
    // AppSettingsBridge owns the complete init-settings lifecycle —
    // computation and application are a single step.
    this.settingsBridge.applyInitOptions()
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Application startup lifecycle
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Complete application startup — single owner of the startup sequence.
   *
   * Runs the full startup lifecycle:
   *  1. Register IPC handlers (before window — renderers may send IPC
   *     messages as soon as they load)
   *  2. Apply initial settings reactions (language → locale + menu,
   *     httpProxy → Electron session, etc.)
   *  3. Create main window (with saved bounds)
   *  4. Register app lifecycle listeners (window-all-closed, before-quit,
   *     signals, activate, dock menu)
   *  5. Post-window initialization (renderer-ready gate):
   *     - Wire mount-path service to main window renderer
   *     - Push initial theme to all renderers
   *     - Forward cached open-file path (Finder double-click before ready)
   *
   * Post-window initialization (step 5) is consolidated into a single
   * `did-finish-load` handler — the correct lifecycle event for "renderer
   * has loaded and scripts have executed."  This replaces the previous
   * pattern of scattered `ready-to-show` + two hardcoded `setTimeout`
   * hacks (500ms for theme, 1000ms for file forwarding) that assumed
   * the renderer would be ready within arbitrary time windows.
   *
   * Bootstrap calls this once after object graph construction.
   * Consolidating the complete startup sequence here makes VideoPlayerApp
   * the symmetric owner of both application startup and shutdown
   * (performShutdown), turning bootstrap into a pure composition root.
   */
  async start(pendingFilePath?: string): Promise<void> {
    // Register IPC handlers before creating the window — renderers
    // may send IPC messages as soon as they load, so the handlers
    // must be ready first.  VideoPlayerApp owns this registration
    // (not bootstrap) so that sub-component fields stay private.
    const ipcOps = this.registerIpcHandlers()

    // Apply all current settings reactions (language, proxy, mpv props).
    // AppSettingsBridge owns the complete settings-change lifecycle —
    // persist + react in one boundary.
    await this.settingsBridge.applyInitialReactions()

    // Pre-initialize mpv engine — creates the native instance and applies
    // init settings (hwdec, language prefs, etc.) so the first play doesn't
    // pay the initialization cost.  Fire-and-forget: failure is non-fatal,
    // ensureReady() in the play path will retry.
    this.mediaPlayer.ensureReady().catch(err => {
      logger.warn('mpv pre-initialization failed (will retry on first play)', err)
    })

    const mainWindow = this.createMainWindow()
    this.registerAppListeners()

    // ── Post-window initialization (renderer-ready gate) ──
    //
    // Consolidated into a single `did-finish-load` handler — fires
    // after the HTML page has loaded and the module scripts have
    // executed (Vue app mounted, IPC listeners registered).  This is
    // the correct lifecycle boundary: mount-path wiring, theme push,
    // and file forwarding all require the renderer to be ready to
    // receive IPC messages.
    //
    // Previously these were three separate mechanisms:
    //   - ready-to-show (too early — fires before scripts execute)
    //   - setTimeout(500) for theme push (fragile temporal assumption)
    //   - setTimeout(1000) for file forwarding (fragile temporal assumption)
    mainWindow.webContents.once('did-finish-load', () => {
      // Wire mount-path service to main window renderer
      this.mountPathService.setMainWindow(mainWindow)

      // Push initial theme — themeHandlers owns the complete theme
      // lifecycle (resolve + broadcast to ALL renderer surfaces
      // including the control layer).
      ipcOps.theme.pushCurrentTheme()

      // Forward cached open-file path (Finder launches app via
      // double-click before ready, path cached by bootstrap's
      // open-file handler)
      if (pendingFilePath) {
        this.handleOpenFile(pendingFilePath)
      }
    })
  }

  /**
   * Register all IPC handlers — single registration point.
   *
   * Called during start() before the window is created so handlers are
   * ready when the renderer loads.  Passes narrow function interfaces
   * for app-level operations (openFile, quit), port interfaces for
   * playback-subsystem surfaces and config/settings, and direct service
   * refs for domain operations — the IPC handler layer is decoupled
   * from the VideoPlayerApp container and never sees the full
   * ConfigManager.
   *
   * Returns IpcHandlerOps for subsystems that expose post-registration
   * lifecycle operations (currently: theme initial push).
   *
   * Player operations are split between three boundaries:
   *   - coordinator: orchestrated play intents + session lifecycle
   *   - commands: scheduled playback commands (pause, stop, seek) —
   *     routed directly to the scheduler, bypassing the coordinator
   *   - playerOps: non-orchestrated operations (tracks, HDR, keypress,
   *     properties, commands, debug) — MediaPlayer satisfies
   *     PlayerDirectPort structurally
   *
   * Config/settings routing eliminates direct ConfigManager access:
   *   - settings: SettingsPort (AppSettingsBridge) — reads + writes
   *   - setVolume: volume set+persist (AppSettingsBridge)
   *   - watchProgress: WatchProgressQueryPort (ConfigManager, narrowed)
   *   - themeConfig: ThemeConfigPort (ConfigManager, narrowed)
   */
  private registerIpcHandlers(): IpcHandlerOps {
    return setupIpcHandlers({
      openFile: (path) => this.handleOpenFile(path),
      quit: () => this.quit(),
      coordinator: this.coordinator,
      broadcastPlaylist: (items) => this.windowManager.broadcastPlaylistUpdated(items),
      commands: this.commands,
      windowManager: this.windowManager,
      playerOps: this.mediaPlayer,
      settings: this.settingsBridge,
      setVolume: (v) => this.settingsBridge.setPlaybackVolume(v),
      watchProgress: this.config,
      themeConfig: this.config,
      equalizerConfig: this.config,
      thumbnailService: this.thumbnailService,
      whisperService: this.whisperService,
      animExportService: this.animExportService,
      mountPathService: this.mountPathService,
    })
  }

  // ═══════════════════════════════════════════════════════════════════
  //  File-open handling
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle a file opened from an external source (Finder double-click,
   * Dock menu, macOS open-file event, app menu "Open File").
   *
   * Consolidates the repeated pattern: extract display name → dispatch
   * file:video-selected to the main window → focus/restore the main
   * window.  Previously this logic was duplicated across bootstrap.ts
   * (open-file handler), updateDockMenu (dock click handler), and
   * setupApplicationMenu (Open File menu item).
   */
  handleOpenFile(filePath: string): void {
    this.handleFileSelected({ name: basename(filePath), path: filePath })
    const win = this.mainWindow
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  }

  /** Handle file selection result: broadcast to main window */
  private handleFileSelected(file: { name: string; path: string }): void {
    const mw = this.mainWindow
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send('file:video-selected', file)
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  App lifecycle
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Single canonical exit path — performs shutdown AND quits the app.
   *
   * All shutdown triggers (IPC control:quit, main window close,
   * before-quit, window-all-closed) route through this method.  This
   * eliminates the previously duplicated `performShutdown().finally(()
   * => app.quit())` pattern scattered across multiple event handlers.
   *
   * Signal handlers (SIGINT/SIGTERM) are the sole exception — they use
   * app.exit() for immediate process termination, which bypasses the
   * normal Electron quit sequence.
   *
   * Error handling: shutdown errors are logged but swallowed — the app
   * must always reach app.quit() to avoid a zombie process.
   *
   * Re-entrancy: performShutdown is idempotent (isQuitting guard).
   * Duplicate quit() calls (e.g. before-quit re-fired by app.quit())
   * result in a no-op performShutdown followed by an Electron-idempotent
   * app.quit().
   */
  async quit(): Promise<void> {
    try {
      await this.performShutdown()
    } catch (error) {
      logger.error('Error during shutdown', error)
    }
    app.quit()
  }

  /**
   * Full app-level shutdown — single point of truth for teardown order.
   *
   * Owns application-level teardown:
   *  1. Synchronous: save window bounds + flush config
   *  2. Service teardown (animExport cancel)
   *  3. Playback subsystem shutdown — the factory-provided shutdown
   *     encapsulates the complete two-phase protocol (session teardown
   *     → infrastructure release).  VideoPlayerApp treats the subsystem
   *     as a single lifecycle boundary.
   *
   * Idempotent: re-entrance guarded by isQuitting flag.
   * The synchronous phase (window bounds save, config flush) completes
   * before any `await` to ensure state is persisted even if the process
   * is killed before async teardown finishes.
   *
   * Callers handle post-shutdown process actions (app.quit, app.exit,
   * window destruction) — this method only tears down application state.
   */
  private async performShutdown(): Promise<void> {
    if (this.isQuitting) return
    this.isQuitting = true

    // ── Synchronous phase (before first await) ──
    const mainWindow = this.mainWindow
    if (mainWindow && !mainWindow.isDestroyed() && !this.windowManager.isPip()) {
      this.config.setWindowBounds(mainWindow.getBounds())
    }
    this.config.flush()

    // ── Service teardown ──
    this.animExportService.cancel()

    // ── Playback subsystem shutdown ──
    //
    // Single call to the factory-provided shutdown — it owns the
    // complete subsystem teardown lifecycle (session + infrastructure)
    // symmetrically with its assembly role.
    await this.playbackShutdown()

    logger.info('App shutdown completed')
  }

  private createMainWindow(): BrowserWindow {
    // Restore saved window position/size, validate whether within screen bounds
    const saved = this.config.getWindowBounds()
    const windowOptions: Record<string, any> = {
      width: 1200,
      height: 800,
      title: 'Lumiere',
      // macOS uses hiddenInset (preserves inset traffic lights), Windows uses hidden (removes entire title bar)
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      route: '#/'
    }
    if (saved) {
      const displays = screen.getAllDisplays()
      const visible = displays.some(d => {
        const wa = d.workArea
        const cx = saved.x + saved.width / 2
        const cy = saved.y + saved.height / 2
        return cx >= wa.x && cx <= wa.x + wa.width &&
               cy >= wa.y && cy <= wa.y + wa.height
      })
      if (visible) {
        windowOptions.x = saved.x
        windowOptions.y = saved.y
        windowOptions.width = saved.width
        windowOptions.height = saved.height
      }
    }
    const mainWindow = createAppWindow(windowOptions)
    this.mainWindow = mainWindow

    logger.info('Main window created', { width: windowOptions.width, height: windowOptions.height })

    // Render layer window buttons (Windows main window custom-drawn close/minimize/maximize)
    ipcMain.on(IPC_CHANNELS.MAIN_WINDOW_ACTION, (_event, action) => {
      if (mainWindow.isDestroyed()) return
      switch (action) {
        case 'close':
          mainWindow.close()
          break
        case 'minimize':
          mainWindow.minimize()
          break
        case 'maximize':
          if (mainWindow.isMaximized()) mainWindow.unmaximize()
          else mainWindow.maximize()
          break
      }
    })

    // Listen for main window close event (use once to ensure it fires only once)
    // Routes through quit() — the single canonical exit path.
    mainWindow.once('close', () => {
      logger.debug('Main window closing')
      this.quit()
    })

    return mainWindow
  }

  /** Register app lifecycle and process signal listeners */
  private registerAppListeners(): void {
    // All non-signal shutdown triggers route through quit() — the single
    // canonical exit path (performShutdown + app.quit).  Re-entrancy is
    // safe: performShutdown is guarded by isQuitting, and duplicate
    // app.quit() calls are idempotent in Electron.
    app.on('window-all-closed', () => {
      this.quit()
    })
    // When quit is triggered externally (e.g. macOS Quit menu item),
    // before-quit fires BEFORE window close events.  preventDefault
    // defers the quit so async shutdown can complete first.  quit()
    // calls app.quit() after shutdown, re-triggering before-quit —
    // the isQuitting guard lets it through on the second pass.
    app.on('before-quit', (event) => {
      if (!this.isQuitting) {
        event.preventDefault()
        this.quit()
      }
    })
    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.info(`Received ${signal}, quitting app`)
      await this.performShutdown()
      const windows = BrowserWindow.getAllWindows()
      windows.forEach((w) => {
        if (!w.isDestroyed()) w.destroy()
      })
      app.exit(0)
    }
    process.on('SIGINT', handleSignal)
    process.on('SIGTERM', handleSignal)

    // macOS activate: re-create main window if all windows are closed
    // (previously in bootstrap.ts — consolidated here so all app-level
    // event coordination lives in a single boundary)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow()
      }
    })

    // Initialize the Dock right-click menu on startup
    this.updateDockMenu()
  }

  /**
   * Broadcast to ALL renderer processes: every BrowserWindow plus the
   * control layer (WebContentsView, which isn't a BrowserWindow).
   *
   * Used for global events like language changes that must reach all
   * windows, not just playback UIs.  This is an app-wide concern —
   * playback-scoped broadcasts go through PlaybackWindowManager.
   */
  private broadcastToAllRenderers(channel: string, payload?: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.webContents.isDestroyed()) {
          win.webContents.send(channel, payload)
        }
      } catch {
        // Window may be closing
      }
    }
    this.windowManager.sendToControl(channel, payload)
  }

  /**
   * Restore the main window after the playback window closes.
   *
   * Called by PlaybackCoordinator (via deps.onPlaybackWindowClosed)
   * AFTER the coordinator has completed playback-level cleanup (stop
   * + session reset).  VideoPlayerApp only handles the application-
   * level concern: restoring the main window.
   *
   * The isQuitting guard prevents main-window creation/focus during
   * shutdown.  During normal shutdown, teardown() removes all window
   * event listeners before disposing the controller, so this callback
   * won't fire.  The guard is a safety net for edge cases where the
   * window closes concurrently with shutdown (e.g. user clicks close
   * during the async stopPlayback phase of performShutdown).
   */
  private restoreMainWindow(): void {
    if (this.isQuitting) return

    const mainWindow = this.mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) {
      this.createMainWindow()
    } else {
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      mainWindow.focus()
    }
  }

  /**
   * Post-play lifecycle handler — macOS integration after a successful
   * play session start.
   *
   * Owns:
   *  - macOS Recent Documents registration (local files only)
   *  - Dock menu refresh (recent files list)
   */
  private handlePlayStarted(target: { path: string; name: string }): void {
    // Register with macOS "Recent Documents" (local files only)
    if (!target.path.startsWith('http://') && !target.path.startsWith('https://')) {
      app.addRecentDocument(target.path)
    }
    this.updateDockMenu()
  }

  /** Update Dock right-click menu: show the last 5 played files */
  updateDockMenu(): void {
    if (process.platform !== 'darwin') return

    const recentFiles = this.config.getAllWatchProgress()
      .sort((a, b) => b.lastWatched - a.lastWatched)
      .slice(0, 5)

    if (recentFiles.length === 0) {
      app.dock.setMenu(Menu.buildFromTemplate([]))
      return
    }

    const menu = Menu.buildFromTemplate([
      { label: t('menu.recentlyPlayed'), enabled: false },
      ...recentFiles.map(wp => ({
        label: basename(wp.mediaPath),
        click: () => this.handleOpenFile(wp.mediaPath)
      }))
    ])
    app.dock.setMenu(menu)
  }

}
