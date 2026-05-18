import type { WebContents } from 'electron'
import { loadMPVBinding, getMPVBinding } from '../../infrastructure/mpv/LibMPVController'
import { createLogger } from '../../infrastructure/logging'
import { IPC_RESPONSE_CHANNELS } from '../command/ipcConstants'
import type { AnimExportConfig, AnimExportProgress, AnimExportResult } from '../../../shared/types/animExport'

const logger = createLogger('AnimExportService')

export class AnimExportService {
  private exporting = false

  async startExport(config: AnimExportConfig, webContents: WebContents): Promise<AnimExportResult> {
    if (this.exporting) {
      return { success: false, error: 'Another export is in progress' }
    }

    if (!loadMPVBinding()) {
      return { success: false, error: 'Native binding not available' }
    }
    const binding = getMPVBinding()!
    if (!binding.exportAnimatedImage) {
      return { success: false, error: 'Export not available on this platform' }
    }

    let outputWidth: number
    let outputHeight: number
    try {
      const dims = await this.getVideoDimensions(config.videoPath)
      outputWidth = Math.round(dims.width * config.scale)
      outputHeight = Math.round(dims.height * config.scale)
      outputWidth = (outputWidth + 1) & ~1
      outputHeight = (outputHeight + 1) & ~1
      if (outputWidth < 2) outputWidth = 2
      if (outputHeight < 2) outputHeight = 2
    } catch {
      outputWidth = 480
      outputHeight = 270
    }

    this.exporting = true
    const totalFrames = Math.floor((config.endTime - config.startTime) * config.fps)

    const onDestroyed = () => this.cancel()
    webContents.once('destroyed', onDestroyed)

    this.emitProgress(webContents, {
      phase: 'extracting', progress: 0, currentFrame: 0, totalFrames,
    })

    try {
      logger.info('Starting animated image export', {
        video: config.videoPath,
        range: `${config.startTime}→${config.endTime}`,
        fps: config.fps,
        size: `${outputWidth}x${outputHeight}`,
        totalFrames,
      })

      const qualityNum = config.quality === 'high' ? 1 : 0
      const success = await binding.exportAnimatedImage(
        config.videoPath, config.outputPath,
        config.startTime, config.endTime,
        config.fps, outputWidth, outputHeight, qualityNum,
        (currentFrame: number, totalFrames: number) => {
          if (!webContents.isDestroyed()) {
            this.emitProgress(webContents, {
              phase: 'extracting',
              progress: currentFrame / totalFrames,
              currentFrame, totalFrames,
            })
          }
        }
      )

      if (success) {
        logger.info('Export completed', { output: config.outputPath })
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_RESPONSE_CHANNELS.ANIM_EXPORT_COMPLETE, {
            outputPath: config.outputPath,
          })
        }
        return { success: true, outputPath: config.outputPath }
      } else {
        const error = 'Export cancelled or failed'
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_RESPONSE_CHANNELS.ANIM_EXPORT_ERROR, { error })
        }
        return { success: false, error }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.error('Export failed', { error })
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_RESPONSE_CHANNELS.ANIM_EXPORT_ERROR, { error })
      }
      return { success: false, error }
    } finally {
      this.exporting = false
      if (!webContents.isDestroyed()) {
        webContents.removeListener('destroyed', onDestroyed)
      }
    }
  }

  cancel(): void {
    const binding = getMPVBinding()
    if (binding?.cancelAnimatedImageExport) {
      binding.cancelAnimatedImageExport()
    }
  }

  isExporting(): boolean {
    return this.exporting
  }

  private emitProgress(webContents: WebContents, progress: AnimExportProgress): void {
    if (!webContents.isDestroyed()) {
      webContents.send(IPC_RESPONSE_CHANNELS.ANIM_EXPORT_PROGRESS, progress)
    }
  }

  private async getVideoDimensions(videoPath: string): Promise<{ width: number; height: number }> {
    const binding = getMPVBinding()!
    const instanceId = binding.create()
    try {
      binding.setOption(instanceId, 'vo', 'null')
      binding.setOption(instanceId, 'ao', 'null')
      binding.setOption(instanceId, 'pause', 'yes')
      binding.initialize(instanceId)
      binding.command(instanceId, ['loadfile', videoPath])
      await new Promise(resolve => setTimeout(resolve, 1000))
      const width = binding.getProperty(instanceId, 'width')
      const height = binding.getProperty(instanceId, 'height')
      return {
        width: typeof width === 'number' && width > 0 ? width : 1920,
        height: typeof height === 'number' && height > 0 ? height : 1080,
      }
    } finally {
      binding.destroy(instanceId)
    }
  }
}
