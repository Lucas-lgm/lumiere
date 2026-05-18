import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'
import { createLogger } from '../../infrastructure/logging'
import { MpvThumbnailGenerator } from '../../infrastructure/mpv/MpvThumbnailGenerator'

const logger = createLogger('ThumbnailService')

/** Sprite sheet metadata (used for frontend hover preview) */
export interface ThumbnailStripMeta {
  /** thumb:// protocol path */
  outputPath: string
  count: number
  thumbWidth: number
  thumbHeight: number
}

/**
 * Policy source for autoThumbnail — narrow read-only interface so the
 * service doesn't depend on the full ConfigManager.
 */
export interface ThumbnailPolicySource {
  isAutoThumbnailEnabled(): boolean
}

/**
 * Thumbnail generation service
 *
 * Uses headless mpv instances to capture video frames as thumbnails, cached by file path hash.
 * Global concurrency control: at most 2 mpv instances running simultaneously, rest queued.
 *
 * **autoThumbnail policy enforcement**: when the setting is disabled,
 * all generation methods return cached-only results (or no-op) —
 * callers never need to check the policy.  This is consistent with
 * ConfigManager's rememberProgress pattern.
 */
export class ThumbnailService {
  private readonly cacheDir: string
  private readonly generator = new MpvThumbnailGenerator()
  private readonly policySource: ThumbnailPolicySource

  /** Tasks currently being generated, to avoid duplicate generation */
  private pendingGenerations = new Map<string, Promise<string | null>>()

  /** Strip tasks currently being generated, to avoid duplicate generation */
  private pendingStrips = new Map<string, Promise<ThumbnailStripMeta | null>>()

  /** The video path corresponding to the currently initialized seek instance (for concurrent request deduplication) */
  private seekInitPath: string | null = null
  /** The ongoing seekInit Promise */
  private pendingSeekInit: Promise<boolean> | null = null
  /** Incremented on each initSeekThumbnail call, used to detect stale seek responses */
  private seekGeneration = 0

  /** Concurrency control */
  private activeCount = 0
  private waitQueue: Array<() => void> = []
  private static readonly MAX_CONCURRENCY = 2

  constructor(policySource: ThumbnailPolicySource) {
    this.policySource = policySource
    this.cacheDir = join(app.getPath('userData'), 'thumbnails')
    this.ensureCacheDir()
  }

  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      try {
        mkdirSync(this.cacheDir, { recursive: true })
      } catch (err) {
        logger.error('Failed to create thumbnail cache dir', err)
      }
    }
  }

  private hashPath(filePath: string): string {
    return createHash('md5').update(filePath).digest('hex')
  }

  private getCachePath(filePath: string): string {
    return join(this.cacheDir, `${this.hashPath(filePath)}.jpg`)
  }

  private toThumbUrl(cachePath: string): string {
    const filename = cachePath.slice(this.cacheDir.length + 1)
    return `thumb://${filename}`
  }

  /** Cache-only lookup — returns cached thumbnail or null (no generation). */
  private getCachedThumbnail(filePath: string): string | null {
    const cachePath = this.getCachePath(filePath)
    return existsSync(cachePath) ? this.toThumbUrl(cachePath) : null
  }

  /** Cache-only lookup — returns cached strip metadata or null (no generation). */
  private getCachedStrip(filePath: string): ThumbnailStripMeta | null {
    const cachePath = this.getStripCachePath(filePath)
    if (existsSync(cachePath)) {
      return {
        outputPath: this.toStripThumbUrl(cachePath),
        count: MpvThumbnailGenerator.STRIP_COUNT,
        thumbWidth: MpvThumbnailGenerator.STRIP_THUMB_WIDTH,
        thumbHeight: MpvThumbnailGenerator.STRIP_THUMB_HEIGHT,
      }
    }
    return null
  }

  /**
   * Get thumbnail URL (thumb:// protocol)
   *
   * Returns immediately if cached, otherwise queues generation.
   * When autoThumbnail is disabled, returns cached-only (no generation).
   */
  async getThumbnail(filePath: string): Promise<string | null> {
    if (!this.policySource.isAutoThumbnailEnabled()) {
      return this.getCachedThumbnail(filePath)
    }

    const cachePath = this.getCachePath(filePath)

    if (existsSync(cachePath)) {
      return this.toThumbUrl(cachePath)
    }

    const pending = this.pendingGenerations.get(filePath)
    if (pending) {
      return pending
    }

    const generation = this.generateThumbnail(filePath).then(
      path => path ? this.toThumbUrl(path) : null
    )
    this.pendingGenerations.set(filePath, generation)
    generation.finally(() => {
      this.pendingGenerations.delete(filePath)
    })

    return generation
  }

  /**
   * Acquire a concurrency slot, queue if full
   */
  private async acquireSlot(): Promise<void> {
    if (this.activeCount < ThumbnailService.MAX_CONCURRENCY) {
      this.activeCount++
      return
    }
    await new Promise<void>(resolve => this.waitQueue.push(resolve))
    this.activeCount++
  }

  private releaseSlot(): void {
    this.activeCount--
    const next = this.waitQueue.shift()
    if (next) next()
  }

  /**
   * Generate thumbnail for a single video (captures frame at 10% position)
   */
  private async generateThumbnail(filePath: string): Promise<string | null> {
    if (!filePath.includes('://') && !existsSync(filePath)) {
      logger.warn('Source file not found for thumbnail', { filePath })
      return null
    }

    const cachePath = this.getCachePath(filePath)

    await this.acquireSlot()
    try {
      const success = await this.generator.generate(filePath, cachePath, 0.1)
      return success ? cachePath : null
    } catch (error) {
      logger.warn('Thumbnail generation failed', { filePath, error })
      return null
    } finally {
      this.releaseSlot()
    }
  }

  /**
   * Batch generate thumbnails (async background, does not block UI)
   *
   * No-op when autoThumbnail is disabled.
   */
  async generateThumbnails(filePaths: string[]): Promise<void> {
    if (!this.policySource.isAutoThumbnailEnabled()) return
    const needGeneration = filePaths.filter(p => !existsSync(this.getCachePath(p)))
    if (needGeneration.length === 0) return

    await Promise.allSettled(
      needGeneration.map(filePath => this.getThumbnail(filePath))
    )
  }

  // ── Sprite Sheet (progress bar hover preview) ──

  private getStripCachePath(filePath: string): string {
    return join(this.cacheDir, `${this.hashPath(filePath)}_strip.jpg`)
  }

  private toStripThumbUrl(cachePath: string): string {
    const filename = cachePath.slice(this.cacheDir.length + 1)
    return `thumb://${filename}`
  }

  /**
   * Generate progress bar sprite sheet, returns cached result if available, otherwise generates in background.
   * Returns metadata (thumb:// path + size info) for frontend to calculate offset.
   *
   * When autoThumbnail is disabled, returns cached-only (no generation).
   */
  async getOrGenerateStrip(filePath: string, duration: number): Promise<ThumbnailStripMeta | null> {
    if (!this.policySource.isAutoThumbnailEnabled()) {
      return this.getCachedStrip(filePath)
    }
    const cachePath = this.getStripCachePath(filePath)

    if (existsSync(cachePath)) {
      return {
        outputPath: this.toStripThumbUrl(cachePath),
        count: MpvThumbnailGenerator.STRIP_COUNT,
        thumbWidth: MpvThumbnailGenerator.STRIP_THUMB_WIDTH,
        thumbHeight: MpvThumbnailGenerator.STRIP_THUMB_HEIGHT,
      }
    }

    const pending = this.pendingStrips.get(filePath)
    if (pending) return pending

    const generation = this.generateStrip(filePath, duration, cachePath)
    this.pendingStrips.set(filePath, generation)
    generation.finally(() => this.pendingStrips.delete(filePath))
    return generation
  }

  // ── Seek thumbnail (generated on demand, used for progress bar hover) ──

  private getSeekCachePath(filePath: string, time: number): string {
    const roundedTime = Math.round(time)
    return join(this.cacheDir, `${this.hashPath(filePath)}_t${roundedTime}.jpg`)
  }

  /**
   * Initialize persistent seek instance (called when video loads, fire-and-forget)
   *
   * No-op (returns false) when autoThumbnail is disabled.
   */
  async initSeekThumbnail(videoPath: string): Promise<boolean> {
    if (!this.policySource.isAutoThumbnailEnabled()) return false
    this.seekGeneration++
    // Skip file existence check for network URLs
    const isNetwork = videoPath.includes('://')
    if (!isNetwork && !existsSync(videoPath)) {
      logger.warn('Source file not found for seekInit', { videoPath })
      return false
    }
    // If the same video is already being initialized, reuse the same Promise
    if (this.seekInitPath === videoPath && this.pendingSeekInit) {
      return this.pendingSeekInit
    }
    // Destroy old instance
    if (this.seekInitPath && this.seekInitPath !== videoPath) {
      this.generator.seekDestroy()
    }
    this.seekInitPath = videoPath
    this.pendingSeekInit = this.generator.seekInit(videoPath).then(ok => {
      this.pendingSeekInit = null
      if (!ok) {
        logger.warn('seekInit failed', { videoPath })
        this.seekInitPath = null
      }
      return ok
    })
    return this.pendingSeekInit
  }

  /**
   * Get thumbnail at a specific time point (check cache first, generate if missing)
   *
   * Returns null immediately when autoThumbnail is disabled.
   *
   * @returns thumb:// URL or null
   */
  async getSeekThumbnail(videoPath: string, time: number): Promise<string | null> {
    if (!this.policySource.isAutoThumbnailEnabled()) return null
    const gen = this.seekGeneration
    const cachePath = this.getSeekCachePath(videoPath, time)

    // Cache hit
    if (existsSync(cachePath)) {
      return this.toThumbUrl(cachePath)
    }

    // Ensure seek instance is initialized
    if (this.seekInitPath !== videoPath) {
      const ok = await this.initSeekThumbnail(videoPath)
      if (!ok) return null
    } else if (this.pendingSeekInit) {
      const ok = await this.pendingSeekInit
      if (!ok) return null
    }

    // If the video has been switched during initialization wait, discard the result
    if (gen !== this.seekGeneration) return null

    try {
      const roundedTime = Math.round(time)
      const success = await this.generator.seekAt(roundedTime, cachePath)
      // Check if stale again before writing cache
      if (gen !== this.seekGeneration) return null
      if (!success) return null
      return existsSync(cachePath) ? this.toThumbUrl(cachePath) : null
    } catch (error) {
      logger.warn('getSeekThumbnail failed', { videoPath, time, error })
      return null
    }
  }

  /**
   * Destroy persistent seek instance (called when video switches/stops)
   */
  destroySeekThumbnail(): void {
    this.generator.seekDestroy()
    this.seekInitPath = null
    this.pendingSeekInit = null
  }

  private async generateStrip(
    filePath: string,
    duration: number,
    cachePath: string
  ): Promise<ThumbnailStripMeta | null> {
    if (!filePath.includes('://') && !existsSync(filePath)) {
      logger.warn('Source file not found for strip generation', { filePath })
      return null
    }

    await this.acquireSlot()
    try {
      const success = await this.generator.generateStrip(filePath, cachePath, duration)
      if (!success) return null
      return {
        outputPath: this.toStripThumbUrl(cachePath),
        count: MpvThumbnailGenerator.STRIP_COUNT,
        thumbWidth: MpvThumbnailGenerator.STRIP_THUMB_WIDTH,
        thumbHeight: MpvThumbnailGenerator.STRIP_THUMB_HEIGHT,
      }
    } catch (error) {
      logger.warn('Strip generation failed', { filePath, error })
      return null
    } finally {
      this.releaseSlot()
    }
  }
}
