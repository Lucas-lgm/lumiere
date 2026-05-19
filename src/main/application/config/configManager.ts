import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { EqualizerState } from '../../../shared/types/ipc'
import { DEFAULT_EQUALIZER_STATE, EQ_GAIN_MIN, EQ_GAIN_MAX } from '../../../shared/types/ipc'

/**
 * Application settings data model
 */
export interface AppSettings {
  // Playback - Decoding
  hwdec: string            // 'auto' | 'no' | 'auto-copy' | 'auto-safe'
  hwdecCodec: string       // 'videotoolbox' | 'nvdec' | 'vaapi' etc.
  // Playback - Behavior
  rememberProgress: boolean
  autoLoadSubtitle: boolean
  autoLoadAudio: boolean
  defaultSpeed: number     // 0.25 ~ 4.0
  chapterNav: boolean
  // Playback - Window
  windowFollowVideo: boolean
  // General - Media Library
  autoThumbnail: boolean
  // General - Network
  httpProxy: string        // '' or 'http://host:port'
  bufferSize: number       // MB
  // General - Advanced
  mpvOptions: string       // extra mpv options, one per line
  logLevel: string         // 'error' | 'warn' | 'info' | 'debug' | 'trace'
  cacheSize: number        // MB
  // Language
  language: string         // UI language: 'system' | 'zh-CN' | 'en'
  preferredLang: string    // Player preferred language (subtitle/audio track): 'system' | 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'pt' | 'ru'
  // Video Enhancement
  videoEnhancement: string // 'off' | 'anime' | 'general' | 'quality'
  // AI Subtitles
  whisperModel: string     // 'tiny' | 'base' | 'small' | 'medium'
  whisperLanguage: string  // 'auto' | 'zh' | 'en' | 'ja' | ...
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  hwdec: 'auto',
  hwdecCodec: 'videotoolbox',
  rememberProgress: true,
  autoLoadSubtitle: true,
  autoLoadAudio: true,
  defaultSpeed: 1,
  chapterNav: false,
  windowFollowVideo: true,
  autoThumbnail: true,
  httpProxy: '',
  bufferSize: 2,
  mpvOptions: '',
  logLevel: 'info',
  cacheSize: 150,
  language: 'system',
  preferredLang: 'system',
  videoEnhancement: 'off',
  whisperModel: 'base',
  whisperLanguage: 'auto',
}

/**
 * Watch progress data model
 */
export interface WatchProgress {
  mediaPath: string
  currentTime: number
  duration: number
  lastWatched: number  // timestamp
  status: 'unwatched' | 'watching' | 'completed'  // >95% = completed
}

export class ConfigManager {
  private volume: number = 100
  private themePreference: 'system' | 'light' | 'dark' = 'system'
  private windowBounds: { x: number; y: number; width: number; height: number } | null = null
  private readonly configPath: string
  private watchProgress: Record<string, WatchProgress> = {}
  private appSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }
  private equalizer: EqualizerState = {
    ...DEFAULT_EQUALIZER_STATE,
    bands: [...DEFAULT_EQUALIZER_STATE.bands],
  }

  /** Throttled save: avoid high-frequency writes during playback */
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly SAVE_DEBOUNCE_MS = 2000

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
      if (data.themePreference === 'light' || data.themePreference === 'dark') {
        this.themePreference = data.themePreference
      }
      if (data.windowBounds && typeof data.windowBounds === 'object') {
        const b = data.windowBounds
        if (typeof b.x === 'number' && typeof b.y === 'number' &&
            typeof b.width === 'number' && typeof b.height === 'number') {
          this.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height }
        }
      }

      // equalizer
      if (data.equalizer && typeof data.equalizer === 'object') {
        const eq = data.equalizer as any
        if (Array.isArray(eq.bands) && eq.bands.length === 10) {
          this.equalizer = {
            enabled: !!eq.enabled,
            bands: eq.bands.map((b: number) => Math.max(EQ_GAIN_MIN, Math.min(EQ_GAIN_MAX, b))),
            currentPreset: typeof eq.currentPreset === 'string' ? eq.currentPreset : 'flat',
            customPresets: (eq.customPresets && typeof eq.customPresets === 'object')
              ? { ...eq.customPresets }
              : {},
          }
        }
      }

      // appSettings
      if (data.appSettings && typeof data.appSettings === 'object') {
        this.appSettings = { ...DEFAULT_APP_SETTINGS, ...data.appSettings }
      }

      // New format: watchProgress
      if (data.watchProgress && typeof data.watchProgress === 'object') {
        const map: Record<string, WatchProgress> = {}
        for (const [path, entry] of Object.entries(data.watchProgress)) {
          const wp = entry as any
          if (wp && typeof wp.currentTime === 'number' && wp.currentTime > 0) {
            map[path] = {
              mediaPath: path,
              currentTime: wp.currentTime,
              duration: typeof wp.duration === 'number' ? wp.duration : 0,
              lastWatched: typeof wp.lastWatched === 'number' ? wp.lastWatched : Date.now(),
              status: wp.status === 'completed' ? 'completed' : 'watching'
            }
          }
        }
        this.watchProgress = map
      }
      // Legacy format migration: playbackPositions → watchProgress
      else if (data.playbackPositions && typeof data.playbackPositions === 'object') {
        const map: Record<string, WatchProgress> = {}
        for (const [path, pos] of Object.entries(data.playbackPositions)) {
          if (typeof pos === 'number' && isFinite(pos) && pos > 0) {
            map[path] = {
              mediaPath: path,
              currentTime: pos,
              duration: 0,
              lastWatched: Date.now(),
              status: 'watching'
            }
          }
        }
        this.watchProgress = map
        // Write new format
        this.saveImmediate()
      }
    } catch {
    }
  }

  private saveImmediate() {
    try {
      const data: Record<string, any> = {
        volume: this.volume,
        themePreference: this.themePreference,
        watchProgress: this.watchProgress,
        equalizer: this.equalizer,
        appSettings: this.appSettings
      }
      if (this.windowBounds) {
        data.windowBounds = this.windowBounds
      }
      writeFileSync(this.configPath, JSON.stringify(data), 'utf-8')
    } catch {
    }
  }

  private save() {
    // Throttle: write at most once per 2s during playback
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveImmediate()
    }, ConfigManager.SAVE_DEBOUNCE_MS)
  }

  /** Ensure data is written to disk before exit */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.saveImmediate()
  }

  getVolume() {
    return this.volume
  }

  setVolume(value: number) {
    this.volume = value
    this.saveImmediate()
  }

  getThemePreference(): 'system' | 'light' | 'dark' {
    return this.themePreference
  }

  setThemePreference(pref: 'system' | 'light' | 'dark') {
    this.themePreference = pref
    this.saveImmediate()
  }

  getWindowBounds(): { x: number; y: number; width: number; height: number } | null {
    return this.windowBounds
  }

  setWindowBounds(bounds: { x: number; y: number; width: number; height: number }) {
    this.windowBounds = bounds
    this.saveImmediate()
  }

  getAppSettings(): AppSettings {
    return { ...this.appSettings }
  }

  setAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    if (key in DEFAULT_APP_SETTINGS) {
      this.appSettings[key] = value
      this.saveImmediate()
    }
  }

  resetAppSettings(): void {
    this.appSettings = { ...DEFAULT_APP_SETTINGS }
    this.saveImmediate()
  }

  getEqualizerState(): EqualizerState {
    return {
      ...this.equalizer,
      bands: [...this.equalizer.bands],
      customPresets: { ...this.equalizer.customPresets },
    }
  }

  setEqualizerState(state: { enabled: boolean; bands: number[]; currentPreset: string }): void {
    this.equalizer.enabled = state.enabled
    this.equalizer.bands = state.bands.map(b => Math.max(EQ_GAIN_MIN, Math.min(EQ_GAIN_MAX, b)))
    this.equalizer.currentPreset = state.currentPreset
    this.saveImmediate()
  }

  saveEqualizerPreset(name: string, bands: number[]): void {
    this.equalizer.customPresets[name] = bands.map(b => Math.max(EQ_GAIN_MIN, Math.min(EQ_GAIN_MAX, b)))
    this.saveImmediate()
  }

  deleteEqualizerPreset(name: string): void {
    delete this.equalizer.customPresets[name]
    this.saveImmediate()
  }

  /**
   * Get the last playback position (seconds) for a media file
   *
   * Returns undefined when rememberProgress is disabled — the caller
   * does not need to check the setting.
   */
  getLastPosition(path: string): number | undefined {
    if (!this.appSettings.rememberProgress) return undefined
    const progress = this.watchProgress[path]
    if (!progress || progress.status === 'completed') return undefined
    return progress.currentTime
  }

  /**
   * Update watch progress (called during playback)
   *
   * No-op when rememberProgress is disabled — the caller does not
   * need to check the setting.
   */
  updateWatchProgress(path: string, currentTime: number, duration: number): void {
    if (!this.appSettings.rememberProgress) return
    if (!path) return
    if (typeof currentTime !== 'number' || !isFinite(currentTime)) return

    // Progress <= 0: remove record (treated as reset)
    if (currentTime <= 0) {
      if (path in this.watchProgress) {
        delete this.watchProgress[path]
        this.save()
      }
      return
    }

    // Determine watch status
    let status: WatchProgress['status'] = 'watching'
    if (duration > 0 && (currentTime / duration) > 0.95) {
      status = 'completed'
    }

    this.watchProgress[path] = {
      mediaPath: path,
      currentTime,
      duration: duration > 0 ? duration : (this.watchProgress[path]?.duration ?? 0),
      lastWatched: Date.now(),
      status
    }
    this.save()
  }

  /**
   * Mark as completed (called when playback ends)
   *
   * No-op when rememberProgress is disabled.
   */
  markCompleted(path: string): void {
    if (!this.appSettings.rememberProgress) return
    if (!path) return
    const existing = this.watchProgress[path]
    if (existing) {
      existing.status = 'completed'
      existing.currentTime = existing.duration || existing.currentTime
      existing.lastWatched = Date.now()
      this.save()
    }
  }

  /**
   * Clear watch progress for a specific media file
   *
   * Always works regardless of rememberProgress — an explicit user
   * action to clear data should not be gated by the setting.
   */
  clearWatchProgress(path: string): void {
    if (path in this.watchProgress) {
      delete this.watchProgress[path]
      this.save()
    }
  }

  /**
   * Get watch progress for a specific media file
   *
   * Returns null when rememberProgress is disabled.
   */
  getWatchProgress(mediaPath: string): WatchProgress | null {
    if (!this.appSettings.rememberProgress) return null
    return this.watchProgress[mediaPath] ?? null
  }

  /**
   * Get all watch progress
   *
   * Returns empty when rememberProgress is disabled.
   */
  getAllWatchProgress(): WatchProgress[] {
    if (!this.appSettings.rememberProgress) return []
    return Object.values(this.watchProgress)
  }

  /**
   * Get "continue watching" list: status=watching, sorted by lastWatched descending
   *
   * Returns empty when rememberProgress is disabled.
   */
  getContinueWatching(): WatchProgress[] {
    if (!this.appSettings.rememberProgress) return []
    return Object.values(this.watchProgress)
      .filter(wp => wp.status === 'watching')
      .sort((a, b) => b.lastWatched - a.lastWatched)
  }
}
