import { EventEmitter } from 'events'
import * as path from 'path'
import { existsSync } from 'fs'
import type { MPVBinding, MPVStatus } from './types'
import { createLogger } from '../logging'

// Native binding instance (lazy loaded)
let mpvBinding: MPVBinding | null = null
let bindingLoadAttempted = false

const logger = createLogger('LibMPVController')

/**
 * Load native binding
 * @returns Whether loading was successful
 */
export function loadMPVBinding(): boolean {
  if (bindingLoadAttempted) {
    return mpvBinding !== null
  }
  
  bindingLoadAttempted = true

  // Set DLL search path for Windows (must be before native module loading)
  if (process.platform === 'win32') {
    const dllPath = path.join(__dirname, '../../vendor/mpv/win32-x64/lib')
    if (existsSync(dllPath)) {
      process.env.PATH = `${dllPath};${process.env.PATH}`
      logger.debug('DLL path added', { dllPath })
    } else {
      logger.warn('DLL path not found', { dllPath })
    }
  }

  // Attempt to load native binding
  try {
    const possiblePaths = [
      // Dev environment: __dirname = out/main/ → ../../native/build/Release/
      path.join(__dirname, '../../native/build/Release/mpv_binding.node'),
      // Prod environment: process.resourcesPath = Contents/Resources/ → native/
      path.join(process.resourcesPath || __dirname, 'native/mpv_binding.node'),
    ]

    for (const bindingPath of possiblePaths) {
      try {
        // @ts-ignore - native module
        mpvBinding = require(bindingPath)
        logger.info('Native binding loaded', { bindingPath })
        return true
      } catch (e: any) {
        if (e.code !== 'MODULE_NOT_FOUND') {
          logger.warn('Error loading from path', { bindingPath, error: e.message })
        }
      }
    }

    if (!mpvBinding) {
      logger.warn('Native binding not found. Will use IPC mode.', { possiblePaths })
    }
  } catch (error: any) {
    logger.warn('Native binding not available, falling back to IPC mode', { error: error.message })
  }
  
  return mpvBinding !== null
}

/**
 * Get native binding
 */
export function getMPVBinding(): MPVBinding | null {
  return mpvBinding
}

/**
 * Determine whether a URI points to an ISO Blu-ray image.
 *
 * Besides local paths or URLs that directly end with `.iso`, also identify proxy/streaming URL patterns —
 * the actual file path is passed as a query parameter (e.g., `?path=...iso`), the URL itself does not end with `.iso`.
 */
function isIsoUri(uri: string): boolean {
  if (uri.toLowerCase().endsWith('.iso')) return true
  if (!uri.includes('://')) return false
  try {
    const parsed = new URL(uri)
    const pathParam = parsed.searchParams.get('path')
    if (pathParam && pathParam.toLowerCase().endsWith('.iso')) return true
  } catch {
    // Not a valid URL, treat as non-ISO
  }
  return false
}

/**
 * Check if native binding is available
 * If not yet attempted, will try loading first
 */
export function isLibMPVAvailable(): boolean {
  if (!bindingLoadAttempted) {
    loadMPVBinding()
  }
  return mpvBinding !== null
}

/**
 * LibMPV controller: wraps MPV instance operations
 */
export class LibMPVController extends EventEmitter {
  private instanceId: number | null = null
  private currentViewPtr: number | null = null
  private hdrEnabled = true
  private fileLoadGeneration = 0
  private pendingUnmute = false
  private lastMpvErrorLogLine: string | null = null
  private recentMpvLogLines: string[] = []
  private lastEmittedFps: number | null = null // Last emitted FPS value, for deduplication
  private currentStatus: MPVStatus = {
    position: 0,
    duration: 0,
    volume: 100,
    path: null,
    phase: 'idle',
    isSeeking: false,
    isNetworkBuffering: false,
    networkBufferingPercent: 0,
    bufferRanges: []
  }

  private get binding(): MPVBinding {
    const binding = getMPVBinding()
    if (!binding) {
      throw new Error('libmpv native binding is not available. Please build the native module first.')
    }
    return binding
  }

  constructor() {
    super()
    
    // If not yet attempted to load, load first
    if (!bindingLoadAttempted) {
      loadMPVBinding()
    }
    
    if (!mpvBinding) {
      throw new Error('libmpv native binding is not available. Please build the native module first.')
    }
  }

  /**
   * Initialize MPV instance
   * @param windowId Optional window ID (on Windows, wid must be set before initialization)
   * @param initSettings Initialization settings (hwdec/language preferences/custom options, all set before binding.initialize)
   */
  async initialize(windowId?: number, initSettings?: {
    hwdec?: string
    alang?: string
    slang?: string
    extraOptions?: string[]
    msgLevel?: string
  }): Promise<void> {
    if (this.instanceId !== null) {
      throw new Error('MPV instance already initialized')
    }

    try {
      // Create instance (not yet initialized)
      this.instanceId = this.binding.create()

      // Set options before initialization
      // Note: libmpv already sets no-terminal by default, no need to set it again
      try {
        // macOS: use render API (vo=libmpv)
        // Use MPV_COREAUDIO_FORCE_DEFAULT env var to force default device, preventing hotplug crash

        // Windows: use wid embedding (vo=gpu-next)
        if (process.platform === 'darwin') {

          // Used in conjunction with MPV_COREAUDIO_FORCE_DEFAULT env var
          await this.setOption('vo', 'libmpv')

          logger.debug('Set vo=libmpv for macOS (with MPV_COREAUDIO_FORCE_DEFAULT)')
        } else if (process.platform === 'win32') {
          await this.setOption('vo', 'gpu-next')
          logger.debug('Set vo=gpu-next for wid mode (Windows)')
          if (windowId) {
            try {
              const result = this.binding.setWindowId(this.instanceId, windowId)
              if (result) {
                logger.debug('Set wid before initialization (Windows)')
              } else {
                logger.error('Failed to set wid option (returned false)')
              }
            } catch (error) {
              logger.error('Exception while setting wid', { error })
            }
          } else {
            logger.warn('No windowId provided for Windows wid mode')
          }
        }
      } catch (error) {
        logger.warn('Failed to set vo option', { error })
      }
      
      try {
        await this.setOption('no-osc', true)
      } catch (error) {
        // Ignore, may not exist
      }
      
      try {
        await this.setOption('no-osd-bar', true)
      } catch (error) {
        // Ignore, may not exist
      }

      // Language preference: passed from above (follows system language), not set if not provided (use mpv default)
      try {
        if (initSettings?.alang) {
          await this.setOption('alang', initSettings.alang)
        }
        if (initSettings?.slang) {
          await this.setOption('slang', initSettings.slang)
        }
        if (initSettings?.alang || initSettings?.slang) {
          logger.debug('Applied language preferences', { alang: initSettings?.alang, slang: initSettings?.slang })
        }
      } catch (error) {
        logger.warn('Failed to set language preferences (alang/slang)', { error })
      }

      // mpv log level: mapped from AppSettings.logLevel
      try {
        if (initSettings?.msgLevel) {
          await this.setOption('msg-level', initSettings.msgLevel)
          logger.debug('Set msg-level', { msgLevel: initSettings.msgLevel })
        }
      } catch (error) {
        logger.warn('Failed to set msg-level', { error })
      }

      // await this.setOption('ao', 'null')
      // Or 'ao', 'lavfi-null' etc., to ensure no CoreAudio path is used

      
      // try {
      //   await this.setOption('profile', 'fast')
      //   console.log('[libmpv] Applied fast profile for better responsiveness')
      // } catch (error) {
      //   // Ignore, may not be supported in some versions
      // }

      // Hardware decoding: passed from AppSettings, no longer hardcoded
      try {
        const hwdec = initSettings?.hwdec || 'auto'
        await this.setOption('hwdec', hwdec)
        logger.info('Hardware decoding configured', { hwdec })
      } catch (error) {
        logger.warn('Failed to enable hardware decoding', { error })
      }

      // User custom mpv options (must be set before binding.initialize)
      if (initSettings?.extraOptions?.length) {
        const BLACKLIST = new Set([
          'vo', 'wid', 'gpu-context', 'gpu-api', 'opengl-es',
          'input-terminal', 'terminal', 'no-terminal',
          'no-osc', 'no-osd-bar', 'osd-level', 'video-sync',
          'input-queue-size'
        ])
        for (const opt of initSettings.extraOptions) {
          const trimmed = opt.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          // Parse key=value or --key=value format
          const cleaned = trimmed.replace(/^--/, '')
          const eqIdx = cleaned.indexOf('=')
          const key = eqIdx >= 0 ? cleaned.slice(0, eqIdx) : cleaned
          const value = eqIdx >= 0 ? cleaned.slice(eqIdx + 1) : 'yes'
          if (BLACKLIST.has(key)) {
            logger.warn('Skipped blacklisted custom option', { key })
            continue
          }
          try {
            await this.setOption(key, value)
            logger.debug('Custom option applied', { key, value })
          } catch (error) {
            logger.warn('Failed to set custom option', { key, value, error })
          }
        }
      }

      // Responsiveness optimization settings
      try {
        // Reduce OSD complexity
        await this.setOption('osd-level', 1)
        // Use display-resample for better responsiveness and stability
        // Avoid video-sync=audio causing audio repetition in HDR video
        // await this.setOption('video-sync', 'display-resample')

        await this.setOption('video-sync', 'audio')
        // Reduce input queue size for faster response
        await this.setOption('input-queue-size', 2)
        logger.debug('Applied responsiveness optimizations')
      } catch (error) {
        // Ignore, some options may not be supported
      }

      // Scaling algorithm — match official mpv defaults, avoid over-sharpening
      // ewa_lanczossharp is too sharp, causing jagged edges when upscaling low-res video
      // Official mpv defaults to lanczos, balancing sharpness and smoothness
      try {
        await this.setOption('dither-depth', 'auto')
        await this.setOption('correct-downscaling', 'yes')
        await this.setOption('sigmoid-upscaling', 'yes')
        await this.setOption('linear-downscaling', 'yes')
        logger.debug('Applied quality settings (mpv defaults + correct-downscaling)')
      } catch (error) {
        logger.warn('Failed to set scaling options', { error })
      }

      // Now initialize (vo and wid cannot be set after initialization)
      this.binding.initialize(this.instanceId)
      
      try {
        await this.setProperty('keepaspect', true)
        await this.setProperty('keepaspect-window', true)
        await this.setProperty('video-unscaled', 'no')
        await this.setProperty('video-aspect-override', '-1')
        await this.setProperty('panscan', 0)
        await this.setProperty('video-zoom', 0)
        await this.setProperty('video-scale-x', 1)
        await this.setProperty('video-scale-y', 1)
        logger.debug('Video scaling properties set')
      } catch (error) {
        logger.warn('Failed to set video scaling properties', { error })
      }

      // Set event callback
      this.binding.setEventCallback(this.instanceId, (event: any) => {
        this.handleEvent(event)
      })
      
      this.emit('initialized')
    } catch (error) {
      throw new Error(`Failed to initialize MPV: ${error}`)
    }
  }

  /**
   * Set window ID (for embedding into Electron window)
   */
  setWindowId(windowId: number) {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      if (process.platform === 'darwin') {
        // Same view doesn't need repeated attachView, avoid destroying+rebuilding GL context causing white screen
        if (this.currentViewPtr === windowId) {
          logger.debug('setWindowId: same view, skip attachView', { windowId })
          return
        }
        // macOS: use render API, bind libmpv to Electron's NSView
        logger.debug('setWindowId', { windowId })
        this.binding.attachView(this.instanceId, windowId)
        this.currentViewPtr = windowId
        this.binding.setHdrMode(this.instanceId, this.hdrEnabled)
        // Default to Native driver (CVDisplayLink), no need to enable JS driven mode
        // this.binding.setJsDrivenRenderMode(this.instanceId, true);
      } else if (process.platform === 'win32') {
        // Windows: use wid embedding mode
        // Note: wid should be set before initialization, but can be skipped if already set in initialize
        // Or if not set during initialization, try here (may fail depending on mpv version)
        try {
          this.binding.setWindowId(this.instanceId, windowId)
        } catch (error) {
          logger.warn('Failed to set wid after initialization, may need to set before init', { error })
        }
      }
      this.emit('window-set', windowId)
    } catch (error) {
      throw new Error(`Failed to set window ID: ${error}`)
    }
  }

  /**
   * Set window size (called when Electron window size changes)
   * @param width Window width (pixels)
   * @param height Window height (pixels)
   *
   * Note: The new native implementation handles letterbox automatically (maintains aspect ratio),
   * so there's no need to manually set keepaspect and similar properties.
   */
  async setWindowSize(width: number, height: number): Promise<void> {
    if (this.instanceId === null) {
      logger.warn('Cannot set window size: MPV instance not initialized')
      return
    }

    try {
      // Get current video dimensions for debugging
      try {
        const vidWidth = await this.getProperty('width')
        const vidHeight = await this.getProperty('height')
        if (vidWidth && vidHeight) {
          const vidAspect = Number(vidWidth) / Number(vidHeight)
          const winAspect = width / height
          
          // If aspect ratio doesn't match, ensure keepaspect is set
          if (Math.abs(vidAspect - winAspect) > 0.01) {
            await this.setProperty('keepaspect', true)
          }
        }
      } catch (e) {
        // Ignore, video may not be loaded yet
      }

      // macOS: Native implementation triggers rendering and handles letterbox automatically
      // Windows: in wid mode, need to ensure MPV knows about window size changes
      if (process.platform === 'darwin') {
        this.binding.setWindowSize(this.instanceId, width, height)
      } else if (process.platform === 'win32') {
        logger.debug('Setting window size', { width, height })
        // In Windows wid mode, MPV adapts to window size automatically
        // But can trigger updates by setting window-scale property
        // Or use other properties to ensure correct video scaling
        try {
          // Set window-scale to 1.0 to trigger window size update
          await this.setProperty('window-scale', 1.0)
          logger.debug('Set window-scale property')
          // Can also try setting video-scale related properties
          // But in practice, MPV should adapt automatically in wid mode
        } catch (error) {
          logger.warn('Failed to set window-scale', { error })
        }
        // Call native setWindowSize (even if Windows implementation may be empty, keep interface consistent)
        this.binding.setWindowSize(this.instanceId, width, height)
        logger.debug('Called native setWindowSize')
      }
    } catch (error) {
      logger.error('Failed to set window size', { error })
    }
  }

  isHdrEnabled(): boolean {
    return this.hdrEnabled
  }

  setHdrEnabled(enabled: boolean): void {
    this.hdrEnabled = enabled
    if (this.instanceId === null) return
    // HDR mode is only supported on macOS (via render API)
    if (process.platform === 'darwin') {
      this.binding.setHdrMode(this.instanceId, enabled)
    }
    // Trigger status event, go through unified status broadcast path
    this.emit('status', { ...this.currentStatus })
  }

  /**
   * Set JavaScript driven render mode
   * @param enabled true = JavaScript driven mode, false = CVDisplayLink driven mode (default)
   */
  setJsDrivenRenderMode(enabled: boolean): void {
    if (this.instanceId === null) return
    if (process.platform === 'darwin') {
      this.binding.setJsDrivenRenderMode(this.instanceId, enabled)
    }
  }

  /**
   * Get whether JavaScript driven render mode is currently enabled
   */
  getJsDrivenRenderMode(): boolean {
    if (this.instanceId === null) return false
    if (process.platform === 'darwin') {
      return this.binding.getJsDrivenRenderMode(this.instanceId)
    }
    return false
  }

  /**
   * Request render (used in JavaScript driven mode)
   */
  requestRender(): void {
    if (this.instanceId === null) return
    if (process.platform === 'darwin') {
      this.binding.requestRender(this.instanceId)
    }
  }

  /**
   * Get current video aspect ratio (if known)
   */
  async getVideoAspectRatio(): Promise<number | null> {
    if (this.instanceId === null) {
      return null
    }

    try {
      const width = await this.getProperty('width')
      const height = await this.getProperty('height')
      if (!width || !height) return null
      const w = Number(width)
      const h = Number(height)
      if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null
      return w / h
    } catch {
      return null
    }
  }

  /**
   * Set option
   */
  async setOption(name: string, value: string | number | boolean): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      this.binding.setOption(this.instanceId, name, value)
    } catch (error) {
      throw new Error(`Failed to set option ${name}: ${error}`)
    }
  }

  /**
   * Load file
   *
   * @param path      Media path
   * @param startTime Start time in seconds (optional).
   *
   * Notes:
   * - mpv supports starting playback from a specific time via the `start=XXX` parameter of the `loadfile` command:
   *   `["loadfile", "video.mp4", "replace", "start=90"]`
   * - This directly uses binding.command to call that command.
   */
  async loadFile(path: string, startTime?: number, startPaused?: boolean): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    // Blu-ray ISO: specify ISO path via bluray-device property, then load with bd:// protocol
    // Can't use bd:///path directly because mpv's URL parsing drops path leading slashes
    const isBluray = isIsoUri(path)
    const isNetworkBluray = isBluray && path.includes('://')
    let uri = path
    if (isBluray) {
      await this.binding.command(this.instanceId, ['set', 'bluray-device', path])
      uri = 'bd://'
    }
    logger.info('Loading URI', { original: path, resolved: uri, bluray: isBluray, network: isNetworkBluray })

    // mpv's start parameter requires integer seconds, using non-negative integer seconds uniformly
    const start = startTime ?? 0

    try {
      // startPaused: pause after loading, wait for first frame decoding to complete before upper layer resumes playback
      await this.binding.command(this.instanceId, ['set', 'pause', startPaused ? 'yes' : 'no'])

      // Mute before loadfile to prevent audio glitches from HDR configuration switching
      // Will be explicitly unmuted when playback-restart event fires
      await this.binding.command(this.instanceId, ['set', 'mute', 'yes'])
      this.pendingUnmute = true

      // Enable force black mode to clear residual frames from the previous video
      // mpv_set_force_black_mode triggers an immediate render (clears buffer to black)
      this.setForceBlackMode(true)
      // Give the render thread some time to complete the clear operation (avoid async/await race condition causing flicker)
      await new Promise(resolve => setTimeout(resolve, 30))

      // Build loadfile options
      const opts: string[] = []
      if (start > 0) {
        opts.push(`start=${start}`, 'hr-seek=yes')
      }
      // Network stream: enable disk cache + large demuxer buffer
      // bd:// is not recognized by mpv as a network stream, must explicitly enable cache
      const isNetworkStream = path.includes('://')
      if (isNetworkStream) {
        opts.push(
          'cache=yes',
          'cache-secs=60',
          'demuxer-max-bytes=512MiB',
          'cache-on-disk=yes',
          'demuxer-cache-unlink-files=whendone'
        )
      }

      if (opts.length > 0) {
              await this.binding.command(this.instanceId, [
                'loadfile',
                uri,
                'replace',
                '-1',
                opts.join(',')
              ])
      } else {
        this.binding.loadFile(this.instanceId, uri)
      }
      this.currentStatus.position = start > 0 ? start : 0

      this.currentStatus.path = path
      this.currentStatus.duration = 0
      this.currentStatus.isSeeking = false
      this.currentStatus.isNetworkBuffering = false
      this.currentStatus.networkBufferingPercent = 0
    } catch (error) {
      this.setForceBlackMode(false)
      throw new Error(`Failed to load file: ${error}`)
    }
  }

  /**
   * Get property
   */
  async getProperty(name: string): Promise<any> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      return this.binding.getProperty(this.instanceId, name)
    } catch (error) {
      logger.warn('Failed to get property', { name, error })
      return null
    }
  }

  /**
   * Get the track list of the current media (based on mpv's track-list)
   *
   * Return value is a thin wrapper around mpv's raw track-list, field names aim to be consistent with mpv,
   * upper layers will adapt to PlayerTrack structure at the MediaPlayer level.
   */
  async getTrackList(): Promise<any[]> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    const tracks = await this.getProperty('track-list')

    // MPV_FORMAT_NODE returns JS array directly
    if (Array.isArray(tracks)) {
      return tracks
    }

    return []
  }

  /**
   * Internal utility: notify upper layer that track list has been updated
   */
  private async notifyTrackListChanged(): Promise<void> {
    try {
      const tracks = await this.getTrackList()
      this.emit('tracks-change', tracks)
    } catch (error) {
      logger.warn('Failed to notify track list change', { error })
    }
  }

  /**
   * Debug tool: verify that scaling algorithms and quality options are actually in effect
   */
  private async debugScalingOptions(): Promise<void> {
    if (this.instanceId === null) return

    try {
      const scale = await this.getProperty('scale')
      const dscale = await this.getProperty('dscale')
      const cscale = await this.getProperty('cscale')
      const fboFormat = await this.getProperty('fbo-format')
      const deband = await this.getProperty('deband')
      const ditherDepth = await this.getProperty('dither-depth')
      const correctDown = await this.getProperty('correct-downscaling')
      const sigmoidUp = await this.getProperty('sigmoid-upscaling')
      const linearDown = await this.getProperty('linear-downscaling')
      const hwdec = await this.getProperty('hwdec')
      const hwdecCurrent = await this.getProperty('hwdec-current')
      const videoW = await this.getProperty('video-params/w')
      const videoH = await this.getProperty('video-params/h')
      const osdW = await this.getProperty('osd-width')
      const osdH = await this.getProperty('osd-height')

      logger.debug('MPV Scaling Debug', {
        video: `${videoW}x${videoH}`,
        osd: `${osdW}x${osdH}`,
        scale, dscale, cscale,
        fboFormat, deband, ditherDepth,
        correctDown, sigmoidUp, linearDown,
        hwdec, hwdecCurrent
      })
    } catch (error) {
      logger.warn('debugScalingOptions failed', { error })
    }
  }

  /**
   * Debug tool: print current video and window state
   */
  async debugVideoState(): Promise<void> {
    if (this.instanceId === null) {
      logger.warn('Cannot debug: MPV instance not initialized')
      return
    }

    try {
      const width = await this.getProperty('width')
      const height = await this.getProperty('height')
      const pixFmt = await this.getProperty('pixel-format')
      const keepaspect = await this.getProperty('keepaspect')
      const videoUnscaled = await this.getProperty('video-unscaled')
      const videoAspectOverride = await this.getProperty('video-aspect-override')
      const panscan = await this.getProperty('panscan')
      const videoZoom = await this.getProperty('video-zoom')
      const videoScaleX = await this.getProperty('video-scale-x')
      const videoScaleY = await this.getProperty('video-scale-y')
      // HDR / color related
      const primaries = await this.getProperty('video-params/primaries')
      const gamma = await this.getProperty('video-params/gamma')
      const colormatrix = await this.getProperty('video-params/colormatrix')
      const bitdepth = await this.getProperty('video-params/bit-depth')
      const colorlevels = await this.getProperty('video-params/color-levels')
      const toneMapping = await this.getProperty('tone-mapping')
      const hdrComputePeak = await this.getProperty('hdr-compute-peak')
      const targetPeak = await this.getProperty('target-peak')
      const targetTrc = await this.getProperty('target-trc')
      const targetPrim = await this.getProperty('target-prim')
      const targetColorspaceHint = await this.getProperty('target-colorspace-hint')
      
      logger.debug('MPV Video State Debug', {
        videoSize: `${width}x${height}`,
        videoAspectRatio: width && height ? (Number(width) / Number(height)).toFixed(4) : null,
        pixFmt,
        keepaspect,
        videoUnscaled,
        videoAspectOverride,
        panscan,
        videoZoom,
        videoScaleX,
        videoScaleY,
        primaries,
        gamma,
        colormatrix,
        bitdepth,
        colorlevels,
        toneMapping,
        hdrComputePeak,
        targetPeak,
        targetTrc,
        targetPrim,
        targetColorspaceHint
      })
    } catch (error) {
      logger.error('Failed to debug video state', { error })
    }
  }

  /**
   * Dynamically adjust scaling algorithm based on video resolution
   * - SD (≤720p): significant upscaling scenario, use ewa_lanczossharp for highest quality
   * - HD (1080p): moderate scaling, lanczos balances quality and performance
   * - 4K+ (≥2160p): significant downscaling scenario, use spline36 to reduce GPU overhead
   */
  private async applyAdaptiveScaling(): Promise<void> {
    if (this.instanceId === null) return

    try {
      const w = await this.getProperty('video-params/w')
      const h = await this.getProperty('video-params/h')
      if (typeof w !== 'number' || typeof h !== 'number' || h <= 0) return

      const pixels = w * h
      let scale: string
      let cscale: string
      let dscale: string

      if (pixels <= 921600) {
        // SD: ≤1280×720 — primarily upscaling, use highest quality
        scale = 'ewa_lanczossharp'
        cscale = 'ewa_lanczossharp'
        dscale = 'mitchell'
      } else if (pixels <= 2073600) {
        // HD: ≤1920×1080 — balanced
        scale = 'lanczos'
        cscale = 'lanczos'
        dscale = 'mitchell'
      } else {
        // 4K+: >1080p — primarily downscaling, efficient algorithm
        scale = 'spline36'
        cscale = 'spline36'
        dscale = 'mitchell'
      }

      await this.setProperty('scale', scale)
      await this.setProperty('cscale', cscale)
      await this.setProperty('dscale', dscale)
      logger.debug('Adaptive scaling applied', { resolution: `${w}x${h}`, scale, cscale, dscale })
    } catch (error) {
      logger.warn('Failed to apply adaptive scaling', { error })
    }
  }

  async debugHdrStatus(): Promise<void> {
    if (this.instanceId === null) {
      logger.warn('Cannot debug HDR: MPV instance not initialized')
      return
    }

    try {
      const dvProfile = await this.getProperty('current-tracks/video/dolby-vision-profile')
      const primaries = await this.getProperty('video-params/primaries')
      const gamma = await this.getProperty('video-params/gamma')
      logger.debug('HDR status', {
        dvProfile: dvProfile ?? null,
        primaries: primaries ?? null,
        gamma: gamma ?? null
      })
      this.binding.debugHdrStatus(this.instanceId)
    } catch (error) {
      logger.warn('Failed to debug HDR status', { error })
    }
  }

  /**
   * Set property
   *
   * @param name Property name
   * @param value Property value (string, number, or boolean)
   * @throws If the instance is not initialized or setting fails
   */
  async setProperty(name: string, value: string | number | boolean): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    // Validate value type and validity
    if (typeof value === 'number') {
      // Ensure the number is valid (not NaN or Infinity)
      if (isNaN(value) || !isFinite(value)) {
        throw new Error(`Invalid number value for property ${name}: ${value}`)
      }
    } else if (typeof value !== 'string' && typeof value !== 'boolean') {
      throw new Error(`Unsupported value type for property ${name}: ${typeof value}`)
    }

    try {
      const result = this.binding.setProperty(this.instanceId, name, value)
      if (!result) {
        throw new Error(`Failed to set property ${name}: binding returned false`)
      }
    } catch (error) {
      throw new Error(`Failed to set property ${name}: ${error}`)
    }
  }

  /**
   * Send key press event (currently disabled: no longer forwards keyboard events to mpv)
   */
  async keypress(_key: string): Promise<void> {
    // Disable forwarding to avoid keyboard events causing crashes
    return
  }

  /**
   * Execute command
   */
  async command(...args: string[]): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      this.binding.command(this.instanceId, args)
    } catch (error) {
      throw new Error(`Command failed: ${error}`)
    }
  }

  /**
   * Pause (uses command for better response speed)
   */
  async pause(): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }
    try {
      // Use command instead of property set for faster response, especially for high-res video
      this.binding.command(this.instanceId, ['set', 'pause', 'yes'])
    } catch (error) {
      // If command fails, fall back to property set
      await this.setProperty('pause', true)
    }
  }

  /**
   * Play (uses command for better response speed)
   */
  async play(): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }
    try {
      // Use command instead of property set for faster response
      this.binding.command(this.instanceId, ['set', 'pause', 'no'])
    } catch (error) {
      // If command fails, fall back to property set
      await this.setProperty('pause', false)
    }
  }

  /**
   * Toggle pause/play
   */
  async togglePause(): Promise<void> {
    await this.command('cycle', 'pause')
  }

  /**
   * Seek to specified time
   */
  async seek(time: number): Promise<void> {
    await this.setProperty('time-pos', time)
  }

  /**
   * Set volume
   */
  async setVolume(volume: number): Promise<void> {
    await this.setProperty('volume', Math.max(0, Math.min(130, volume)))
  }

  /**
   * Switch audio track
   * @param trackId mpv track id, pass null to disable audio track (uses no)
   */
  async setAudioTrack(trackId: number | null): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    const target = trackId == null ? 'no' : String(trackId)
    try {
      logger.debug('setAudioTrack', { aid: target })
      await this.command('set', 'aid', target)
      // After switching track, notify upper layer to refresh track-list (selected state may have changed)
      void this.notifyTrackListChanged()
    } catch (error) {
      logger.warn('Failed to set audio track', { aid: target, error })
      throw error
    }
  }

  /**
   * Switch subtitle track
   * @param trackId mpv track id, pass null to disable subtitles (uses no)
   */
  async setSubtitleTrack(trackId: number | null): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    const target = trackId == null ? 'no' : String(trackId)
    try {
      logger.debug('setSubtitleTrack', { sid: target })
      await this.command('set', 'sid', target)
      // After switching track, synchronously refresh track-list
      void this.notifyTrackListChanged()
    } catch (error) {
      logger.warn('Failed to set subtitle track', { sid: target, error })
      throw error
    }
  }

  setForceBlackMode(enabled: boolean): void {
    if (this.instanceId === null) return
    try {
      // Force black mode is only supported on macOS (via render API)
      if (process.platform === 'darwin') {
        this.binding.setForceBlackMode(this.instanceId, enabled)
      }
    } catch (error) {
    }
  }

  /**
   * Stop playback
   */
  async stop(): Promise<void> {
    await this.command('stop')
  }

  /**
   * Get current status
   */
  getStatus(): MPVStatus {
    return { ...this.currentStatus }
  }

  /**
   * Handle events (from C++ ThreadSafeFunction)
   */
  private handleEvent(event: any): void {
    const MPV_EVENT_LOG_MESSAGE = 2
    const MPV_EVENT_PROPERTY_CHANGE = 22
    const MPV_EVENT_END_FILE = 7
    const MPV_EVENT_START_FILE = 6
    const MPV_EVENT_FILE_LOADED = 8
    const MPV_EVENT_SHUTDOWN = 1
    const MPV_EVENT_SEEK = 20
    const MPV_EVENT_PLAYBACK_RESTART = 21
    const MPV_END_FILE_REASON_EOF = 0
    const MPV_END_FILE_REASON_STOP = 2
    const MPV_END_FILE_REASON_QUIT = 3
    const MPV_END_FILE_REASON_ERROR = 4
    const MPV_END_FILE_REASON_REDIRECT = 5

    const eventId: number = event?.eventId

    switch (eventId) {
      case MPV_EVENT_LOG_MESSAGE: {
        const logPrefix = event?.logPrefix
        const logLevel = event?.logLevel
        const logText = event?.logText

        const prefix = typeof logPrefix === 'string' ? logPrefix : ''
        const level = typeof logLevel === 'string' ? logLevel : ''
        const text = typeof logText === 'string' ? logText.trim() : ''

        if (!text) break

        const line = `[mpv:${level || 'unknown'}:${prefix || 'core'}] ${text}`
        // Keep recent log lines for debugging
        this.recentMpvLogLines.push(line)
        if (this.recentMpvLogLines.length > 50) {
          this.recentMpvLogLines.splice(0, this.recentMpvLogLines.length - 50)
        }

        // Record the last error/fatal level “plain text” error message
        if (level === 'error' || level === 'fatal') {
          this.lastMpvErrorLogLine = text

          if (this.currentStatus.phase === 'error') {
            this.currentStatus.errorMessage = text
            this.currentStatus.errorLogSnippet = [...this.recentMpvLogLines]
            this.emit('status', { ...this.currentStatus })
          }
        }

        if (level !== 'v') {
          logger.debug(line)
        }
        break
      }
      case MPV_EVENT_PROPERTY_CHANGE: {
        const name: string | undefined = event?.name
        const value = event?.value

        if (!name) {
          return
        }

        switch (name) {
          case 'pause':
            if (this.currentStatus.path) {
              this.currentStatus.phase = value ? 'paused' : 'playing'
              if (!value) {
                this.currentStatus.isNetworkBuffering = false
                this.currentStatus.networkBufferingPercent = 0
              }
            }
            break
          case 'time-pos':
            this.currentStatus.position = typeof value === 'number' ? value : 0
            break
          case 'duration':
            this.currentStatus.duration = typeof value === 'number' ? value : 0
            break
          case 'volume':
            this.currentStatus.volume = typeof value === 'number' ? value : 100
            break
          case 'paused-for-cache':
            this.currentStatus.isNetworkBuffering = !!value
            break
          case 'cache-buffering-state':
            this.currentStatus.networkBufferingPercent =
              typeof value === 'number' ? value : this.currentStatus.networkBufferingPercent
            break
          case 'speed':
            if (typeof value === 'number' && value > 0) {
              this.emit('property-change', 'speed', value)
            }
            break
          case 'demuxer-cache-state': {
            // FORMAT_NONE observe, no value delivered; need to actively pull via getProperty
            try {
              const cacheState = this.binding.getProperty(this.instanceId!, 'demuxer-cache-state')
              if (cacheState && typeof cacheState === 'object') {
                const ranges = cacheState['seekable-ranges']
                if (Array.isArray(ranges)) {
                  this.currentStatus.bufferRanges = ranges.map((r: any) => ({
                    start: typeof r.start === 'number' ? r.start : 0,
                    end: typeof r.end === 'number' ? r.end : 0,
                  }))
                }
              }
            } catch {
              // Don't update when getProperty fails
            }
            break
          }
          case 'chapter-list':
            // chapter-list uses FORMAT_NONE observe, no value delivered, only notifies of changes
            this.emit('property-change', 'chapter-list', null)
            break
          case 'estimated-vf-fps':
            // Emit fps change event for application layer use
            const fps = typeof value === 'number' && value > 0 ? value : null

            // Deduplication: only emit event when FPS value actually changes (allow 0.01 fps tolerance)
            if (this.lastEmittedFps !== null && fps !== null) {
              if (Math.abs(this.lastEmittedFps - fps) < 0.01) {
                  // FPS value has not changed meaningfully, skip
                break
              }
            } else if (this.lastEmittedFps === fps) {
              // Both are null, skip
              break
            }
            
            this.lastEmittedFps = fps
            this.emit('fps-change', fps)
            break
        }

        this.emit('status', { ...this.currentStatus })
        break
      }
      case MPV_EVENT_START_FILE: {
        this.fileLoadGeneration++
        // When a new file starts, reset error information
        this.lastMpvErrorLogLine = null
        this.currentStatus.errorMessage = undefined
        this.currentStatus.errorLogSnippet = undefined
        this.currentStatus.isSeeking = false
        this.currentStatus.isNetworkBuffering = false
        this.currentStatus.networkBufferingPercent = 0
        this.currentStatus.bufferRanges = []
        this.currentStatus.phase = 'loading'
        this.emit('status', { ...this.currentStatus })
        logger.info('File loading started', { path: this.currentStatus.path })
        break
      }
      case MPV_EVENT_FILE_LOADED: {
        this.currentStatus.isSeeking = false
        this.currentStatus.isNetworkBuffering = false
        this.currentStatus.networkBufferingPercent = 0
        this.currentStatus.phase = 'playing'
        logger.info('File loaded, playback started', { path: this.currentStatus.path, duration: this.currentStatus.duration })

        this.emit('status', { ...this.currentStatus })
        // After file loading completes, track info is usually ready; notify upper layer that track list has been updated
        void this.notifyTrackListChanged()

        // Debug: verify scaling options are effective
        void this.debugScalingOptions()
        break
      }
      case MPV_EVENT_SEEK: {
        this.currentStatus.isSeeking = true
        this.emit('status', { ...this.currentStatus })
        break
      }
      case MPV_EVENT_PLAYBACK_RESTART: {
        this.currentStatus.isSeeking = false
        this.emit('status', { ...this.currentStatus })
        // When playback restarts (or a new file starts playing), disable black screen mode to show video
        this.setForceBlackMode(false)
        // If mute was triggered by loadFile, explicitly unmute when the first frame is ready
        if (this.pendingUnmute) {
          this.pendingUnmute = false
          this.binding.command(this.instanceId!, ['set', 'mute', 'no'])
        }
        // First frame decoded, video-params are ready
        this.emit('playback-restart')
        break
      }
      case MPV_EVENT_END_FILE: {
        const reason: number | null =
          typeof event?.endFileReason === 'number' ? event.endFileReason : null
        if (reason === MPV_END_FILE_REASON_STOP) {
          this.currentStatus.phase = 'stopped'
          this.currentStatus.isSeeking = false
          this.currentStatus.isNetworkBuffering = false
          this.currentStatus.networkBufferingPercent = 0
          this.emit('status', { ...this.currentStatus })
          this.setForceBlackMode(true)
          logger.debug('Playback stopped', { path: this.currentStatus.path })
        } else if (reason === MPV_END_FILE_REASON_EOF) {
          this.currentStatus.phase = 'ended'
          this.currentStatus.isSeeking = false
          this.currentStatus.isNetworkBuffering = false
          this.currentStatus.networkBufferingPercent = 0
          this.emit('status', { ...this.currentStatus })
          logger.info('Playback ended (EOF)', { path: this.currentStatus.path })
        } else if (reason === MPV_END_FILE_REASON_ERROR) {
          this.currentStatus.phase = 'error'
          this.currentStatus.isSeeking = false
          this.currentStatus.isNetworkBuffering = false
          this.currentStatus.networkBufferingPercent = 0
          this.emit('status', { ...this.currentStatus })
          logger.error('Playback failed', { path: this.currentStatus.path, errorMessage: this.lastMpvErrorLogLine })
        } else {
          this.currentStatus.phase = 'stopped'
          this.currentStatus.isSeeking = false
          this.currentStatus.isNetworkBuffering = false
          this.currentStatus.networkBufferingPercent = 0
          this.emit('status', { ...this.currentStatus })
        }
        break
      }
      case MPV_EVENT_SHUTDOWN:
        this.currentStatus.phase = 'idle'
        this.currentStatus.path = null
        this.currentStatus.position = 0
        this.currentStatus.duration = 0
        this.currentStatus.isSeeking = false
        this.currentStatus.isNetworkBuffering = false
        this.currentStatus.networkBufferingPercent = 0
        this.emit('status', { ...this.currentStatus })
        break
    }
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    if (this.instanceId !== null) {
      try {
        // Notify mpv to exit normally, release all resources and windows
        this.binding.destroy(this.instanceId)
      } catch (error) {
        logger.error('Error destroying MPV instance', { error })
      }
      this.instanceId = null
      this.currentViewPtr = null
    }

    this.emit('destroyed')
  }
}
