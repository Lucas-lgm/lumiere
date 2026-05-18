import { app, session } from 'electron'
import { join } from 'path'
import type { PlayerInitSettings } from '../playback/MediaPlayer'
import type { ConfigManager, AppSettings } from './configManager'
import { createLogger, setGlobalLogLevel, parseLogLevel } from '../../infrastructure/logging'
import { deriveLanguagePreference as deriveLanguagePreferenceUtil } from '../../../shared/utils/language'
import { setMainLocale, resolveMainLocale } from '../../i18n'

const logger = createLogger('AppSettingsBridge')

// ── Player config port interface ──

/**
 * Narrow interface for the media-player configuration operations used
 * by the settings bridge.
 *
 * Covers the three interaction patterns AppSettingsBridge needs:
 *   - **setProperty**: runtime property hot-updates (hwdec, proxy,
 *     cache, subtitle/audio auto-load, language, speed, log level)
 *   - **setVolume**: post-play volume restoration
 *   - **setInitSettings**: one-time pre-initialization options (before
 *     the player engine starts)
 *
 * MediaPlayer satisfies this interface structurally — VideoPlayerApp
 * passes it directly, so the settings bridge never needs the full
 * ~25-method MediaPlayer type.  This completes the narrow-port
 * decoupling: every application-layer consumer now references only
 * the contract it actually uses.
 */
export interface PlayerConfigPort {
  /** Set a runtime player property (name → value). */
  setProperty(name: string, value: any): Promise<void>
  /** Set the playback volume (0–130). */
  setVolume(volume: number): Promise<void>
  /** Set pre-initialization options (before the player engine starts). */
  setInitSettings(settings: PlayerInitSettings): void
}

/**
 * Pre-play session configuration resolved by AppSettingsBridge.
 *
 * Consolidates all config/settings reads needed before a play command
 * into a single return value — the coordinator uses this instead of
 * reaching into ConfigManager for scattered reads.
 *
 * Volume restoration is handled separately by restorePlaybackVolume()
 * (called AFTER the play command) because the play command may reset
 * the player's volume state.
 */
export interface PlaySessionConfig {
  /** Resolved start time (explicit override > saved progress > undefined). */
  startTime: number | undefined
  /** Whether to start paused (for auto-fit window sizing). */
  startPaused: boolean
}

/** App setting key → mpv property name (for single-value hot updates) */
const SINGLE_PROP_MAP: Record<string, string> = {
  hwdec: 'hwdec',
  httpProxy: 'http-proxy',
  cacheSize: 'demuxer-max-bytes',
  bufferSize: 'cache-secs',
}

/**
 * Video enhancement shader presets.
 *
 * Each preset has a default shader list and an optional light (lower quality) list.
 * High-resolution + high-fps videos (>1080p or >30fps) automatically downgrade to
 * light to reduce GPU load. Falls back to default if no light variant exists.
 */
const SHADER_PRESETS: Record<string, { default: string[]; light?: string[] }> = {
  off: { default: [] },
  crisp: {
    default: ['cfl/CfL_Prediction.glsl', 'fsrcnnx/FSRCNNX_x2_16-0-4-1.glsl', 'cas/CAS-scaled.glsl'],
  },
  live: {
    default: ['ravu/ravu-lite-ar-r3.hook'],
    light: ['ravu/ravu-lite-r3.hook'],
  },
  fsr: {
    default: ['fsr/FSR_EASU.glsl', 'fsr/FSR_RCAS.glsl'],
  },
  anime: {
    default: [
      'anime4k/Anime4K_Clamp_Highlights.glsl',
      'anime4k/Anime4K_Restore_CNN_VL.glsl',
      'anime4k/Anime4K_Upscale_CNN_x2_VL.glsl',
    ],
    light: [
      'anime4k/Anime4K_Clamp_Highlights.glsl',
      'anime4k/Anime4K_Restore_CNN_M.glsl',
      'anime4k/Anime4K_Upscale_CNN_x2_M.glsl',
    ],
  },
}

/** Whether to downgrade to light shaders (high resolution or high fps) */
function isLightLoad(videoWidth: number, fps: number): boolean {
  return videoWidth > 1080 && fps > 30
}

/** Get the shader base directory */
function getShaderBase(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'shaders')
    : join(app.getAppPath(), 'resources', 'shaders')
}

/** Resolve the shader file list into the mpv glsl-shaders property value */
function resolveShaderFiles(files: string[]): string {
  if (files.length === 0) return ''
  const base = getShaderBase()
  return files.map(f => join(base, f)).join(':')
}

/** Used at startup (no video info, uses default variant) */
function resolveShaderPaths(preset: string): string {
  const entry = SHADER_PRESETS[preset]
  if (!entry) return ''
  return resolveShaderFiles(entry.default)
}

/** Used when video info is available (chooses variant based on resolution and fps) */
function resolveShaderPathsForVideo(preset: string, videoWidth: number, fps: number): string {
  const entry = SHADER_PRESETS[preset]
  if (!entry) return ''
  const files = (isLightLoad(videoWidth, fps) && entry.light) ? entry.light : entry.default
  return resolveShaderFiles(files)
}

// ── Dependencies ──

export interface AppSettingsBridgeDeps {
  /** Rebuild the macOS application menu (e.g. after language change). */
  rebuildAppMenu: () => void
  /** Broadcast a message to all renderer processes (main windows + control layer). */
  broadcastToAllRenderers: (channel: string, payload?: unknown) => void
  /** Set the playback window's aspect-ratio lock (0 to unlock). */
  setAspectRatioLock: (ratio: number) => void
}

/**
 * Single owner of the complete app-settings lifecycle: persist + react.
 *
 * Owns:
 *  - Settings persistence: setAppSetting, resetAppSettings (via ConfigManager)
 *  - mpv property translation (init settings, global/per-play application,
 *    runtime hot-update via generic single-prop map)
 *  - App-level reactions: language (locale → process locale → menu →
 *    broadcast), httpProxy (Electron session + mpv property)
 *  - Window side-effects: windowFollowVideo disable → aspect-ratio unlock
 *  - Infrastructure side-effects: logLevel → global Logger + mpv msg-level
 *
 * Previously the settings-change lifecycle was split: VideoPlayerApp
 * handled persistence (via ConfigManager.setAppSetting) then delegated
 * reactions (via applySettingReaction) — two separate calls to two
 * different services for a single logical operation.  Consolidating both
 * steps here makes AppSettingsBridge the single entry point for all
 * "setting changed" flows: persist first, react second.
 *
 * Non-mpv side-effects (menu rebuild, broadcast, aspect lock) are handled
 * through a narrow callback deps interface.
 */
export class AppSettingsBridge {
  /** Whether global mpv properties have been applied (hwdec/proxy/cache etc. only need to be set once) */
  private globalSettingsApplied = false

  constructor(
    private readonly playerConfig: PlayerConfigPort,
    private readonly config: ConfigManager,
    private readonly deps: AppSettingsBridgeDeps,
  ) {}

  /** Whether applyGlobal has been executed */
  get isGlobalApplied(): boolean {
    return this.globalSettingsApplied
  }

  /**
   * Read the current app settings snapshot.
   *
   * Delegates to ConfigManager — AppSettingsBridge is the single facade
   * for all settings access at the IPC boundary (reads AND writes).
   * Previously, IPC handlers received ConfigManager directly for reads
   * and AppSettingsBridge for writes — a split that allowed unsupervised
   * write access to ConfigManager that could bypass the reaction pipeline.
   */
  getAppSettings(): AppSettings {
    return this.config.getAppSettings()
  }

  // ── Initialization ──────────────────────────────────────

  /**
   * Apply pre-initialization options to the player engine.
   *
   * Owns the complete init-settings lifecycle: reads current settings,
   * derives language preferences, parses extra options, and applies
   * the result via playerConfig.setInitSettings() — all in one step.
   *
   * Previously, computation lived here (computeInitSettings) but
   * application lived in VideoPlayerApp (with an instanceof MpvMediaPlayer
   * downcast).  Consolidating here makes AppSettingsBridge the single
   * owner of ALL settings lifecycle stages: init, global, per-play,
   * and runtime reactions.
   *
   * Also sets the global Logger log level (side-effect co-located
   * with init options because both are one-time startup concerns).
   */
  applyInitOptions(): void {
    const settings = this.config.getAppSettings()

    // Set global Logger log level
    setGlobalLogLevel(parseLogLevel(settings.logLevel))

    // Derive alang/slang preferences from user preference or system language
    const { alang, slang } = AppSettingsBridge.deriveLanguagePreference(settings.preferredLang)

    // Parse user custom mpv options
    const extraOptions = settings.mpvOptions
      ? settings.mpvOptions.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'))
      : []

    // Video enhancement shader (set before init, ensures it loads when the renderer initializes)
    if (settings.videoEnhancement && settings.videoEnhancement !== 'off') {
      const shaderPath = resolveShaderPaths(settings.videoEnhancement)
      if (shaderPath) {
        extraOptions.push(`glsl-shaders=${shaderPath}`)
        logger.debug('Video enhancement added to init options', { preset: settings.videoEnhancement })
      }
    }

    // Map logLevel → mpv msg-level (trace goes directly to mpv)
    const msgLevel = `all=${settings.logLevel}`

    this.playerConfig.setInitSettings({
      hwdec: settings.hwdec,
      alang,
      slang,
      extraOptions,
      msgLevel,
    })
  }

  // ── Per play ───────────────────────────────────

  /** Ensure both global and per-play properties are set (used by playMedia) */
  async ensureSettingsForPlay(): Promise<void> {
    if (!this.globalSettingsApplied) {
      await this.applyGlobal()
    }
    await this.applyPerPlay()
  }

  /**
   * Complete pre-play session preparation — single boundary for all
   * config/settings reads and mpv property application needed before
   * a play command.
   *
   * Consolidates the preparation steps that were previously scattered
   * across PlaybackCoordinator's playSession method:
   *  1. Apply global + per-play mpv settings (ensureSettingsForPlay)
   *  2. Resolve start time: explicitStartTime > saved progress
   *     (config.getLastPosition — returns undefined when
   *     rememberProgress is disabled)
   *  3. Read windowFollowVideo for startPaused decision
   *
   * Volume restoration is handled separately by restorePlaybackVolume()
   * (called AFTER the play command — see that method's doc).
   *
   * @param targetPath   — media path (for saved-progress lookup)
   * @param explicitStartTime — caller-provided start time (override
   *   or playlist startTime); takes priority over saved progress
   */
  async prepareForPlay(targetPath: string, explicitStartTime?: number): Promise<PlaySessionConfig> {
    await this.ensureSettingsForPlay()

    // Resolve start time: explicit > saved progress
    let startTime: number | undefined
    if (typeof explicitStartTime === 'number' && isFinite(explicitStartTime) && explicitStartTime > 0) {
      startTime = explicitStartTime
    } else {
      const lastPosition = this.config.getLastPosition(targetPath)
      if (typeof lastPosition === 'number' && isFinite(lastPosition) && lastPosition > 0) {
        startTime = lastPosition
      }
    }

    const settings = this.config.getAppSettings()
    return {
      startTime,
      startPaused: settings.windowFollowVideo,
    }
  }

  /**
   * Set the playback volume AND persist it — single operation for the
   * user-initiated volume change (slider, keyboard shortcut).
   *
   * Consolidates the dual-call pattern previously scattered across the
   * IPC handler (playerOps.setVolume + config.setVolume) — making
   * AppSettingsBridge the complete volume lifecycle owner:
   *   - **set + persist** (this method): user-initiated changes
   *   - **restore** (restorePlaybackVolume below): session-start restoration
   *
   * Player-set is awaited first — if the player command fails, the
   * stale volume is not persisted.
   */
  async setPlaybackVolume(volume: number): Promise<void> {
    await this.playerConfig.setVolume(volume)
    this.config.setVolume(volume)
  }

  /**
   * Restore the saved playback volume — called AFTER the play command.
   *
   * Separated from prepareForPlay() because the play command may reset
   * the player's volume state, so restoration must happen post-play.
   * Together with setPlaybackVolume(), this makes AppSettingsBridge the
   * complete volume lifecycle owner (set + persist + restore).
   */
  async restorePlaybackVolume(): Promise<void> {
    await this.playerConfig.setVolume(this.config.getVolume())
  }

  // ── Global properties (once only) ────────────────────────

  /**
   * Apply global mpv properties (hwdec/proxy/cache/speed) — set once after mpv initialization
   * Subsequent individual updates via settings:set hot-update
   */
  async applyGlobal(): Promise<void> {
    const settings = this.config.getAppSettings()
    try {
      await this.applyMpvProperties({
        hwdec: settings.hwdec,
        httpProxy: settings.httpProxy || undefined,
        cacheSize: settings.cacheSize,
        bufferSize: settings.bufferSize,
        defaultSpeed: settings.defaultSpeed,
      })
      // Apply quality enhancement shader
      if (settings.videoEnhancement && settings.videoEnhancement !== 'off') {
        const shaderPath = resolveShaderPaths(settings.videoEnhancement)
        if (shaderPath) {
          await this.playerConfig.setProperty('glsl-shaders', shaderPath)
          logger.debug('Video enhancement applied on startup', { preset: settings.videoEnhancement })
        }
      } else {
        logger.debug('Video enhancement disabled')
      }
      this.globalSettingsApplied = true
    } catch (error) {
      logger.warn('Failed to apply global mpv settings', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // ── Per-play properties ──────────────────────────────

  /**
   * Apply per-play mpv properties (sub-auto/audio-file-auto)
   */
  private async applyPerPlay(): Promise<void> {
    const settings = this.config.getAppSettings()
    try {
      await this.applyMpvProperties({
        autoLoadSubtitle: settings.autoLoadSubtitle,
        autoLoadAudio: settings.autoLoadAudio,
      })
    } catch (error) {
      logger.warn('Failed to apply per-play mpv settings', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // ── Settings-change lifecycle (persist + react) ──────────
  //
  // Complete lifecycle for settings changes — persist first, react second.
  // Previously the persist step lived in VideoPlayerApp and the react
  // step lived here — consolidating both into this boundary eliminates
  // the split dispatch pattern from the application layer.

  /**
   * Persist a single setting AND apply all reactive side-effects.
   *
   * Single entry point for the "setting changed" lifecycle — replaces
   * the previous two-service call pattern in VideoPlayerApp
   * (config.setAppSetting + settingsBridge.applySettingReaction).
   */
  async setAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    this.config.setAppSetting(key, value)
    await this.applySettingReaction(key as string, value)
  }

  /**
   * Reset all settings to defaults AND re-apply all reactions.
   *
   * Triggers reactions for every default value so that language, proxy,
   * and mpv properties are fully synchronized — previously the loop-
   * and-react sequence lived in VideoPlayerApp.
   */
  async resetAppSettings(): Promise<void> {
    this.config.resetAppSettings()
    const defaults = this.config.getAppSettings()
    for (const key of Object.keys(defaults) as (keyof AppSettings)[]) {
      await this.applySettingReaction(key, defaults[key])
    }
  }

  /**
   * Apply reactions for all current (persisted) settings.
   *
   * Used at startup to run the same per-key reaction pipeline for all
   * settings in one pass.  Safe to call before renderer windows exist:
   * broadcastGlobal is a no-op with zero listeners, and mpv hot-updates
   * short-circuit when global settings have not been applied yet.
   */
  /**
   * Dynamically enable/disable video enhancement shaders based on video resolution.
   * Disabled when video resolution >= display resolution (no upscaling needed for pure downscaling).
   */
  async updateEnhancementForVideo(videoWidth: number, videoHeight: number, fps = 30): Promise<void> {
    if (!this.globalSettingsApplied) return
    const settings = this.config.getAppSettings()
    if (!settings.videoEnhancement || settings.videoEnhancement === 'off') return

    const display = require('electron').screen.getPrimaryDisplay()
    const displayWidth = display.size.width * (display.scaleFactor || 1)

    if (videoWidth >= displayWidth * 0.8) {
      // High resolution video: disable shader
      await this.playerConfig.setProperty('glsl-shaders', '')
      logger.debug('Video enhancement skipped — video resolution sufficient', { videoWidth, displayWidth })
    } else {
      // Dynamically select shader variant based on video resolution and fps
      const light = isLightLoad(videoWidth, fps)
      const shaderPath = resolveShaderPathsForVideo(settings.videoEnhancement, videoWidth, fps)
      if (shaderPath) {
        await this.playerConfig.setProperty('glsl-shaders', shaderPath)
        logger.debug('Video enhancement applied', { videoWidth, fps, light, preset: settings.videoEnhancement })
      }
    }
  }

  async applyInitialReactions(): Promise<void> {
    const settings = this.config.getAppSettings()
    for (const key of Object.keys(settings) as (keyof AppSettings)[]) {
      await this.applySettingReaction(key, settings[key])
    }
  }

  // ── Setting-reaction dispatch (internal) ───────────────

  /**
   * Apply all reactive side-effects for a single setting change.
   *
   * Internal dispatch point — all lifecycle entry points (setAppSetting,
   * resetAppSettings, applyInitialReactions) converge here so the same
   * reactions fire consistently.
   *
   * Owns:
   *  - language: resolve locale → set process locale → rebuild menu →
   *    broadcast to all renderers
   *  - httpProxy: update Electron session proxy + mpv http-proxy property
   *  - windowFollowVideo: unlock aspect ratio when disabled
   *  - logLevel: update global Logger level + mpv msg-level
   *  - preferredLang: hot-update mpv alang/slang
   *  - Generic single-prop mapping (hwdec, cacheSize, bufferSize)
   */
  private async applySettingReaction(key: string, value: any): Promise<void> {
    // ── App-level reactions ──

    if (key === 'language') {
      const resolved = resolveMainLocale(value as string)
      setMainLocale(resolved)
      this.deps.rebuildAppMenu()
      this.deps.broadcastToAllRenderers('language:changed', value)
    }

    if (key === 'httpProxy') {
      const proxy = value as string
      if (proxy) {
        session.defaultSession.setProxy({ proxyRules: proxy }).catch(() => {})
      } else {
        session.defaultSession.setProxy({ mode: 'system' }).catch(() => {})
      }
      // Fall through — httpProxy also maps to mpv property below
    }

    // ── Window side-effects ──

    if (key === 'windowFollowVideo') {
      if (!value) {
        this.deps.setAspectRatioLock(0)
      }
      return
    }

    // ── mpv-specific reactions ──

    if (key === 'logLevel') {
      setGlobalLogLevel(parseLogLevel(value))
      if (this.globalSettingsApplied) {
        try {
          await this.playerConfig.setProperty('msg-level', `all=${value}`)
        } catch (error) {
          logger.warn('Failed to hot-update mpv msg-level', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
      logger.info('Setting hot-updated', { key, value })
      return
    }

    if (key === 'preferredLang') {
      if (this.globalSettingsApplied) {
        try {
          const { alang, slang } = AppSettingsBridge.deriveLanguagePreference(value)
          await this.playerConfig.setProperty('alang', alang)
          await this.playerConfig.setProperty('slang', slang)
          logger.info('Setting hot-updated', { key, value })
        } catch (error) {
          logger.warn('Failed to hot-update mpv alang/slang', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
      return
    }

    if (key === 'videoEnhancement') {
      if (this.globalSettingsApplied) {
        try {
          const shaderPath = resolveShaderPaths(value as string)
          await this.playerConfig.setProperty('glsl-shaders', shaderPath)
          logger.info('Setting hot-updated', { key, value })
        } catch (error) {
          logger.warn('Failed to hot-update glsl-shaders', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
      return
    }

    // ── Generic single-property mapping ──

    if (!this.globalSettingsApplied) return

    const mpvProp = SINGLE_PROP_MAP[key]
    if (!mpvProp) return
    try {
      let mpvValue = value
      if (key === 'cacheSize') mpvValue = `${value}MiB`
      await this.playerConfig.setProperty(mpvProp, mpvValue)
      logger.info('Setting hot-updated', { key, value })
    } catch (error) {
      logger.warn(`Failed to hot-update mpv property ${key}`, {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // ── Internal methods ───────────────────────────────────

  /**
   * Batch apply app settings to mpv properties.
   * All app-setting key → mpv property name + value conversions are centralized here.
   */
  private async applyMpvProperties(settings: {
    hwdec?: string; httpProxy?: string; cacheSize?: number; bufferSize?: number;
    defaultSpeed?: number; autoLoadSubtitle?: boolean; autoLoadAudio?: boolean;
    logLevel?: string; alang?: string; slang?: string
  }): Promise<void> {
    if (settings.hwdec) await this.playerConfig.setProperty('hwdec', settings.hwdec)
    if (settings.httpProxy) await this.playerConfig.setProperty('http-proxy', settings.httpProxy)
    if (settings.cacheSize && settings.cacheSize > 0) await this.playerConfig.setProperty('demuxer-max-bytes', `${settings.cacheSize}MiB`)
    if (settings.bufferSize && settings.bufferSize > 0) await this.playerConfig.setProperty('cache-secs', settings.bufferSize)
    if (settings.defaultSpeed && settings.defaultSpeed > 0) await this.playerConfig.setProperty('speed', settings.defaultSpeed)
    if (settings.autoLoadSubtitle !== undefined) await this.playerConfig.setProperty('sub-auto', settings.autoLoadSubtitle ? 'fuzzy' : 'no')
    if (settings.autoLoadAudio !== undefined) await this.playerConfig.setProperty('audio-file-auto', settings.autoLoadAudio ? 'fuzzy' : 'no')
    if (settings.logLevel) await this.playerConfig.setProperty('msg-level', `all=${settings.logLevel}`)
    if (settings.alang) await this.playerConfig.setProperty('alang', settings.alang)
    if (settings.slang) await this.playerConfig.setProperty('slang', settings.slang)
  }

  // ── Utility methods ───────────────────────────────────

  /** Derive mpv alang/slang preferences from user preference or system language */
  static deriveLanguagePreference(preferredLang: string = 'system'): { alang: string; slang: string } {
    let systemLocale: string
    try {
      systemLocale = app.getLocale()
    } catch {
      systemLocale = 'en'
    }
    return deriveLanguagePreferenceUtil(preferredLang, systemLocale)
  }
}
