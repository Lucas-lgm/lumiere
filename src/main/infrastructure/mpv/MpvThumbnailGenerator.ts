import { loadMPVBinding, getMPVBinding } from './LibMPVController'
import { createLogger } from '../logging'

const logger = createLogger('MpvThumbnailGenerator')

/**
 * Generate video thumbnails using mpv software rendering mode
 *
 * Calls the native binding's generateThumbnail method,
 * completed on a background thread: create temp mpv → SW render → JPEG encode → write file.
 */
export class MpvThumbnailGenerator {
  private static readonly THUMB_WIDTH = 320

  // Sprite sheet default configuration
  static readonly STRIP_THUMB_WIDTH  = 160
  static readonly STRIP_THUMB_HEIGHT = 90
  static readonly STRIP_COUNT        = 20

  // Seek thumbnail default dimensions
  static readonly SEEK_THUMB_WIDTH  = 160
  static readonly SEEK_THUMB_HEIGHT = 90

  /**
   * Generate a single thumbnail
   * @param videoPath Video file path
   * @param outputPath Output JPEG path
   * @param seekPercent Capture position (0~1), default 0.1 (10%)
   */
  async generate(videoPath: string, outputPath: string, seekPercent = 0.1): Promise<boolean> {
    if (!loadMPVBinding()) {
      logger.warn('Native binding not available')
      return false
    }

    const binding = getMPVBinding()!
    if (!binding.generateThumbnail) {
      logger.warn('generateThumbnail not available on this platform')
      return false
    }

    try {
      return await binding.generateThumbnail(
        videoPath, outputPath, seekPercent, MpvThumbnailGenerator.THUMB_WIDTH
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.warn('Thumbnail generation failed', { videoPath, error: msg })
      return false
    }
  }

  // ── Persistent seek preview ──

  /**
   * Initialize persistent seek thumbnail instance (called when video loads)
   */
  async seekInit(
    videoPath: string,
    thumbWidth = MpvThumbnailGenerator.SEEK_THUMB_WIDTH,
    thumbHeight = MpvThumbnailGenerator.SEEK_THUMB_HEIGHT
  ): Promise<boolean> {
    if (!loadMPVBinding()) {
      logger.warn('Native binding not available')
      return false
    }
    const binding = getMPVBinding()!
    if (!binding.thumbSeekInit) {
      logger.warn('thumbSeekInit not available on this platform')
      return false
    }
    try {
      return await binding.thumbSeekInit(videoPath, thumbWidth, thumbHeight)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.warn('thumbSeekInit failed', { videoPath, error: msg })
      return false
    }
  }

  /**
   * Seek to specified time and generate a single JPEG frame (called on hover)
   */
  async seekAt(timeSec: number, outputPath: string): Promise<boolean> {
    if (!loadMPVBinding()) return false
    const binding = getMPVBinding()!
    if (!binding.thumbSeekAt) {
      logger.warn('thumbSeekAt not available on this platform')
      return false
    }
    try {
      return await binding.thumbSeekAt(timeSec, outputPath)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.warn('thumbSeekAt failed', { timeSec, error: msg })
      return false
    }
  }

  /**
   * Destroy persistent seek thumbnail instance (called when video switches)
   */
  seekDestroy(): void {
    if (!loadMPVBinding()) return
    const binding = getMPVBinding()!
    if (binding.thumbSeekDestroy) {
      try {
        binding.thumbSeekDestroy()
      } catch (error) {
        logger.warn('thumbSeekDestroy failed', { error })
      }
    }
  }

  /**
   * Generate a sprite sheet for progress bar preview
   * @param videoPath Video file path
   * @param outputPath Output JPEG path (width = thumbWidth * count, height = thumbHeight)
   * @param duration Video total duration (seconds)
   * @param count Number of thumbnails
   * @param thumbWidth Single thumbnail width (pixels)
   * @param thumbHeight Single thumbnail height (pixels)
   */
  async generateStrip(
    videoPath: string,
    outputPath: string,
    duration: number,
    count = MpvThumbnailGenerator.STRIP_COUNT,
    thumbWidth = MpvThumbnailGenerator.STRIP_THUMB_WIDTH,
    thumbHeight = MpvThumbnailGenerator.STRIP_THUMB_HEIGHT
  ): Promise<boolean> {
    if (!loadMPVBinding()) {
      logger.warn('Native binding not available')
      return false
    }

    const binding = getMPVBinding()!
    if (!binding.generateThumbnailStrip) {
      logger.warn('generateThumbnailStrip not available on this platform')
      return false
    }

    try {
      return await binding.generateThumbnailStrip(
        videoPath, outputPath, thumbWidth, thumbHeight, count, duration
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.warn('Thumbnail strip generation failed', { videoPath, error: msg })
      return false
    }
  }
}
