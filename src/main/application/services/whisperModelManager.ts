import { app, net } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, unlinkSync, renameSync } from 'fs'
import { createWriteStream } from 'fs'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('WhisperModelManager')

export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo'

export interface WhisperModelInfo {
  size: WhisperModelSize
  label: string
  fileSize: number // bytes
  downloaded: boolean
  path: string | null
}

const MODEL_SPECS: Record<WhisperModelSize, { label: string; fileSize: number; fileName: string }> = {
  tiny: { label: 'Tiny (75 MB)', fileSize: 75_000_000, fileName: 'ggml-tiny.bin' },
  base: { label: 'Base (142 MB)', fileSize: 142_000_000, fileName: 'ggml-base.bin' },
  small: { label: 'Small (466 MB)', fileSize: 466_000_000, fileName: 'ggml-small.bin' },
  medium: { label: 'Medium (1.5 GB)', fileSize: 1_500_000_000, fileName: 'ggml-medium.bin' },
  'large-v3-turbo': { label: 'Large V3 Turbo (809 MB)', fileSize: 809_000_000, fileName: 'ggml-large-v3-turbo.bin' },
}

const HUGGINGFACE_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export class WhisperModelManager {
  private readonly modelsDir: string
  private activeDownload: { model: WhisperModelSize; abort: () => void } | null = null

  constructor() {
    this.modelsDir = join(app.getPath('userData'), 'whisper-models')
    this.ensureModelsDir()
  }

  private ensureModelsDir(): void {
    if (!existsSync(this.modelsDir)) {
      try {
        mkdirSync(this.modelsDir, { recursive: true })
      } catch (err) {
        logger.error('Failed to create whisper models dir', err)
      }
    }
  }

  private getModelPath(size: WhisperModelSize): string {
    return join(this.modelsDir, MODEL_SPECS[size].fileName)
  }

  private getModelUrl(size: WhisperModelSize): string {
    return `${HUGGINGFACE_BASE}/${MODEL_SPECS[size].fileName}`
  }

  isModelDownloaded(size: WhisperModelSize): boolean {
    return existsSync(this.getModelPath(size))
  }

  listModels(): WhisperModelInfo[] {
    return (Object.keys(MODEL_SPECS) as WhisperModelSize[]).map(size => {
      const spec = MODEL_SPECS[size]
      const path = this.getModelPath(size)
      const downloaded = existsSync(path)
      return {
        size,
        label: spec.label,
        fileSize: spec.fileSize,
        downloaded,
        path: downloaded ? path : null,
      }
    })
  }

  getModelPathIfExists(size: WhisperModelSize): string | null {
    const path = this.getModelPath(size)
    return existsSync(path) ? path : null
  }

  /**
   * Download a model from HuggingFace with progress callback.
   * Uses Electron net module — automatically respects system/app proxy settings.
   */
  async downloadModel(
    size: WhisperModelSize,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const modelPath = this.getModelPath(size)

    if (existsSync(modelPath)) {
      return modelPath
    }

    // Cancel any existing download
    if (this.activeDownload) {
      this.activeDownload.abort()
      this.activeDownload = null
    }

    const url = this.getModelUrl(size)
    const tempPath = modelPath + '.downloading'
    const expectedSize = MODEL_SPECS[size].fileSize

    logger.info('Starting model download', { size, url })

    // Clean up leftover temp file from a previous interrupted download
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }

    return new Promise<string>((resolve, reject) => {
      let aborted = false

      const abort = () => {
        aborted = true
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath)
        } catch { /* ignore */ }
      }

      this.activeDownload = { model: size, abort }

      // Electron net.request follows redirects automatically and respects proxy
      const request = net.request({ url, redirect: 'follow' })

      request.on('response', (response) => {
        if (aborted) return

        if (response.statusCode !== 200) {
          abort()
          reject(new Error(`Download failed: HTTP ${response.statusCode}`))
          return
        }

        const totalSize = parseInt(response.headers['content-length'] as string || '0', 10) || expectedSize
        let downloadedSize = 0
        const fileStream = createWriteStream(tempPath)

        response.on('data', (chunk: Buffer) => {
          if (aborted) {
            response.removeAllListeners()
            fileStream.destroy()
            return
          }
          fileStream.write(chunk)
          downloadedSize += chunk.length
          if (onProgress && totalSize > 0) {
            onProgress(Math.min(downloadedSize / totalSize, 1))
          }
        })

        response.on('end', () => {
          if (aborted) return
          fileStream.end(() => {
            try {
              renameSync(tempPath, modelPath)
              this.activeDownload = null
              logger.info('Model download complete', { size, path: modelPath })
              resolve(modelPath)
            } catch (err) {
              reject(err)
            }
          })
        })

        response.on('error', (err: Error) => {
          fileStream.destroy()
          abort()
          reject(err)
        })

        fileStream.on('error', (err: Error) => {
          abort()
          reject(err)
        })
      })

      request.on('error', (err: Error) => {
        abort()
        reject(err)
      })

      request.end()
    })
  }

  cancelDownload(): void {
    if (this.activeDownload) {
      logger.info('Cancelling model download', { model: this.activeDownload.model })
      this.activeDownload.abort()
      this.activeDownload = null
    }
  }

  deleteModel(size: WhisperModelSize): boolean {
    const path = this.getModelPath(size)
    if (existsSync(path)) {
      try {
        unlinkSync(path)
        logger.info('Model deleted', { size })
        return true
      } catch (err) {
        logger.error('Failed to delete model', { size, error: err })
        return false
      }
    }
    return false
  }
}
