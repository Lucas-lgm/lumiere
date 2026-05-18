import { app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join, dirname, basename, extname } from 'path'
import { existsSync, mkdirSync, unlinkSync, accessSync, constants as fsConstants } from 'fs'
import type { WebContents } from 'electron'
import { createLogger } from '../../infrastructure/logging'
import { WhisperModelManager, WhisperModelSize } from './whisperModelManager'

const logger = createLogger('WhisperService')

export interface TranscriptionJob {
  mediaPath: string
  phase: 'extracting' | 'transcribing' | 'complete' | 'error' | 'cancelled'
  progress: number // 0-1
  message: string
  srtPath?: string
  error?: string
}

interface ActiveTranscription {
  job: TranscriptionJob
  process: ChildProcess | null
  tempWavPath: string | null
  webContents: WebContents
}

/**
 * Whisper local AI subtitle generation service
 *
 * Two-phase pipeline:
 *   Phase 1: ffmpeg extracts audio to 16kHz mono WAV
 *   Phase 2: whisper-cli transcribes WAV to SRT
 *
 * Maximum 1 concurrent transcription (CPU/GPU intensive task)
 */
export class WhisperService {
  readonly modelManager: WhisperModelManager
  private activeTranscription: ActiveTranscription | null = null
  private readonly fallbackSrtDir: string

  constructor() {
    this.modelManager = new WhisperModelManager()
    this.fallbackSrtDir = join(app.getPath('userData'), 'generated-srt')
  }

  /**
   * Resolve paths to bundled binaries.
   * In dev mode, look under vendor/; in prod, look under app Resources/.
   */
  private getBinaryPath(name: 'whisper-cli' | 'ffmpeg'): string {
    const isPackaged = app.isPackaged
    if (name === 'whisper-cli') {
      if (isPackaged) {
        return join(process.resourcesPath, 'whisper', 'bin', 'whisper-cli')
      }
      return join(app.getAppPath(), 'vendor', 'whisper', 'darwin-arm64', 'bin', 'whisper-cli')
    }
    // ffmpeg
    if (isPackaged) {
      return join(process.resourcesPath, 'ffmpeg', 'bin', 'ffmpeg')
    }
    return join(app.getAppPath(), 'vendor', 'ffmpeg', 'darwin-arm64', 'bin', 'ffmpeg')
  }

  private isBinaryAvailable(name: 'whisper-cli' | 'ffmpeg'): boolean {
    try {
      const path = this.getBinaryPath(name)
      return existsSync(path)
    } catch {
      return false
    }
  }

  /**
   * Check if whisper & ffmpeg binaries are available
   */
  checkAvailability(): { available: boolean; missing: string[] } {
    const missing: string[] = []
    if (!this.isBinaryAvailable('ffmpeg')) missing.push('ffmpeg')
    if (!this.isBinaryAvailable('whisper-cli')) missing.push('whisper-cli')
    return { available: missing.length === 0, missing }
  }

  /**
   * Check if an SRT file already exists for the given media
   */
  checkSrtExists(mediaPath: string): string | null {
    const srtPath = this.getSrtPath(mediaPath)
    if (srtPath && existsSync(srtPath)) return srtPath

    // Also check .ai.srt variant
    const aiSrtPath = this.getAiSrtPath(mediaPath)
    if (existsSync(aiSrtPath)) return aiSrtPath

    return null
  }

  /**
   * Get current transcription status
   */
  getStatus(mediaPath: string): TranscriptionJob | null {
    if (this.activeTranscription && this.activeTranscription.job.mediaPath === mediaPath) {
      return { ...this.activeTranscription.job }
    }
    return null
  }

  /**
   * Start transcription for a media file
   */
  async startTranscription(
    mediaPath: string,
    options: { model: WhisperModelSize; language: string; audioTrackIndex?: number; force?: boolean },
    webContents: WebContents
  ): Promise<TranscriptionJob> {
    // Check if already transcribing this file
    if (this.activeTranscription && this.activeTranscription.job.mediaPath === mediaPath) {
      return { ...this.activeTranscription.job }
    }

    // Check if another transcription is active
    if (this.activeTranscription) {
      throw new Error('Another transcription is already in progress')
    }

    // Check binary availability
    const availability = this.checkAvailability()
    if (!availability.available) {
      throw new Error(`Missing binaries: ${availability.missing.join(', ')}`)
    }

    // Check model availability
    const modelPath = this.modelManager.getModelPathIfExists(options.model)
    if (!modelPath) {
      throw new Error(`Model "${options.model}" is not downloaded`)
    }

    // Check if SRT already exists (skip when force=true for regeneration)
    if (!options.force) {
      const existingSrt = this.checkSrtExists(mediaPath)
      if (existingSrt) {
        return {
          mediaPath,
          phase: 'complete',
          progress: 1,
          message: 'SRT already exists',
          srtPath: existingSrt,
        }
      }
    }

    // Determine output SRT path
    // Force mode: overwrite existing SRT (prefer previously generated path)
    const srtPath = options.force
      ? (this.checkSrtExists(mediaPath) || this.determineSrtOutputPath(mediaPath))
      : this.determineSrtOutputPath(mediaPath)

    const job: TranscriptionJob = {
      mediaPath,
      phase: 'extracting',
      progress: 0,
      message: '',
    }

    const tempWavPath = join(
      app.getPath('temp'),
      `lumiere-whisper-${Date.now()}.wav`
    )

    this.activeTranscription = {
      job,
      process: null,
      tempWavPath,
      webContents,
    }

    // Run the pipeline asynchronously
    this.runPipeline(mediaPath, tempWavPath, srtPath, modelPath, options.language, options.audioTrackIndex, webContents)
      .catch(err => {
        if (this.activeTranscription?.job.phase !== 'cancelled') {
          logger.error('Transcription failed', { mediaPath, error: err.message })
          this.updateJob({ phase: 'error', error: err.message, message: err.message })
          this.emitEvent('transcription:error', { mediaPath, error: err.message })
        }
        this.cleanup()
      })

    return { ...job }
  }

  /**
   * Cancel the active transcription
   */
  cancelTranscription(mediaPath: string): boolean {
    if (!this.activeTranscription || this.activeTranscription.job.mediaPath !== mediaPath) {
      return false
    }

    logger.info('Transcription cancelled', { mediaPath })
    this.updateJob({ phase: 'cancelled', message: 'Cancelled by user' })

    // Kill the active process
    if (this.activeTranscription.process) {
      try {
        this.activeTranscription.process.kill('SIGTERM')
      } catch { /* ignore */ }
    }

    this.cleanup()
    return true
  }

  // ========== Private Methods ==========

  private getSrtPath(mediaPath: string): string | null {
    const ext = extname(mediaPath)
    const srtPath = mediaPath.replace(new RegExp(`${ext.replace('.', '\\.')}$`), '.srt')
    return srtPath
  }

  private getAiSrtPath(mediaPath: string): string {
    const ext = extname(mediaPath)
    return mediaPath.replace(new RegExp(`${ext.replace('.', '\\.')}$`), '.ai.srt')
  }

  /**
   * Determine where to write the SRT file.
   * Try video's directory first; fallback to app data if not writable.
   */
  private determineSrtOutputPath(mediaPath: string): string {
    const videoDir = dirname(mediaPath)
    const srtName = basename(mediaPath, extname(mediaPath)) + '.srt'
    const preferredPath = join(videoDir, srtName)

    // Check if a manually created SRT already exists
    if (existsSync(preferredPath)) {
      // Use .ai.srt suffix to avoid overwriting
      const aiSrtPath = this.getAiSrtPath(mediaPath)
      return aiSrtPath
    }

    // Check if directory is writable
    try {
      accessSync(videoDir, fsConstants.W_OK)
      return preferredPath
    } catch {
      // Fallback to app data directory
      if (!existsSync(this.fallbackSrtDir)) {
        mkdirSync(this.fallbackSrtDir, { recursive: true })
      }
      return join(this.fallbackSrtDir, srtName)
    }
  }

  /**
   * The two-phase transcription pipeline (single-pass)
   */
  private async runPipeline(
    mediaPath: string,
    tempWavPath: string,
    srtPath: string,
    modelPath: string,
    language: string,
    audioTrackIndex: number | undefined,
    webContents: WebContents
  ): Promise<void> {
    // Phase 1: Extract audio with ffmpeg
    this.updateJob({ phase: 'extracting', progress: 0, message: '' })
    this.emitEvent('transcription:progress', {
      mediaPath,
      phase: 'extracting',
      progress: 0,
      message: '',
    })

    await this.extractAudio(mediaPath, tempWavPath, audioTrackIndex)

    if (this.activeTranscription?.job.phase === 'cancelled') return

    // Phase 2: Transcribe with whisper-cli
    this.updateJob({ phase: 'transcribing', progress: 0, message: '' })
    this.emitEvent('transcription:progress', {
      mediaPath,
      phase: 'transcribing',
      progress: 0,
      message: '',
    })

    await this.transcribe(tempWavPath, srtPath, modelPath, language, mediaPath)

    if (this.activeTranscription?.job.phase === 'cancelled') return

    // Done
    logger.info('Transcription complete', { mediaPath, srtPath })
    this.updateJob({ phase: 'complete', progress: 1, message: '', srtPath })
    this.emitEvent('transcription:complete', { mediaPath, srtPath })

    this.cleanup()
  }

  /**
   * Phase 2: Transcribe using whisper-cli → SRT
   */
  private transcribe(
    wavPath: string,
    srtPath: string,
    modelPath: string,
    language: string,
    mediaPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const whisperPath = this.getBinaryPath('whisper-cli')
      const outputBase = srtPath.replace(/\.srt$/, '')

      const args = [
        '-m', modelPath,
        '-f', wavPath,
        '-osrt',
        '-of', outputBase,
        '-pp',
        '-l', language || 'auto',
      ]

      logger.info('Starting transcription', { whisperPath, wavPath, srtPath, language })

      const proc = spawn(whisperPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GGML_METAL_PATH_RESOURCES: dirname(whisperPath).replace('/bin', '/lib'),
        },
      })
      this.setActiveProcess(proc)

      let lastText = ''

      proc.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          const m = line.match(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*(.+)/)
          if (m && m[1].trim()) lastText = m[1].trim()
        }
        if (lastText) {
          this.updateJob({ message: lastText })
          this.emitEvent('transcription:progress', {
            mediaPath,
            phase: 'transcribing',
            progress: this.activeTranscription?.job.progress ?? 0,
            message: lastText,
          })
        }
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const m = data.toString().match(/progress\s*=\s*(\d+)%/)
        if (m) {
          const progress = parseInt(m[1]) / 100
          this.updateJob({ progress })
          this.emitEvent('transcription:progress', {
            mediaPath,
            phase: 'transcribing',
            progress,
            message: lastText,
          })
        }
      })

      proc.on('close', (code) => {
        this.setActiveProcess(null)
        if (code === 0) {
          if (existsSync(srtPath)) resolve()
          else reject(new Error('Transcription completed but SRT file not found'))
        } else if (this.activeTranscription?.job.phase === 'cancelled') {
          resolve()
        } else {
          reject(new Error(`whisper-cli exited with code ${code}`))
        }
      })

      proc.on('error', (err) => { this.setActiveProcess(null); reject(err) })
    })
  }

  /**
   * Phase 1: Extract audio using ffmpeg → 16kHz mono WAV
   */
  private extractAudio(mediaPath: string, outputPath: string, audioTrackIndex?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpegPath = this.getBinaryPath('ffmpeg')
      const args = [
        '-i', mediaPath,
      ]

      // Select specific audio track if specified (0-based ffmpeg stream index)
      if (typeof audioTrackIndex === 'number' && audioTrackIndex >= 0) {
        args.push('-map', `0:a:${audioTrackIndex}`)
      } else {
        // Default: take the first audio stream
        args.push('-map', '0:a:0')
      }

      args.push(
        '-ar', '16000',      // 16kHz sample rate (whisper requirement)
        '-ac', '1',           // mono
        '-c:a', 'pcm_s16le',  // 16-bit PCM WAV
        '-y',                  // overwrite
        outputPath,
      )

      logger.info('Extracting audio', { ffmpegPath, output: outputPath })

      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      this.setActiveProcess(proc)

      let stderrData = ''
      let durationSeconds = 0

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderrData += text

        // Parse duration from ffmpeg output: "Duration: HH:MM:SS.ss"
        if (!durationSeconds) {
          const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
          if (durMatch) {
            durationSeconds =
              parseInt(durMatch[1]) * 3600 +
              parseInt(durMatch[2]) * 60 +
              parseInt(durMatch[3]) +
              parseInt(durMatch[4]) / 100
          }
        }

        // Parse progress: "time=HH:MM:SS.ss"
        const timeMatch = text.match(/time=(\d+):(\d+):(\d+)\.(\d+)/)
        if (timeMatch && durationSeconds > 0) {
          const currentSeconds =
            parseInt(timeMatch[1]) * 3600 +
            parseInt(timeMatch[2]) * 60 +
            parseInt(timeMatch[3]) +
            parseInt(timeMatch[4]) / 100
          const progress = Math.min(currentSeconds / durationSeconds, 1)

          this.updateJob({ progress })
          this.emitEvent('transcription:progress', {
            mediaPath: this.activeTranscription?.job.mediaPath,
            phase: 'extracting',
            progress,
            message: '',
          })
        }
      })

      proc.on('close', (code) => {
        this.setActiveProcess(null)
        if (code === 0) {
          resolve()
        } else if (this.activeTranscription?.job.phase === 'cancelled') {
          resolve() // Will be caught by pipeline
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`))
        }
      })

      proc.on('error', (err) => {
        this.setActiveProcess(null)
        reject(err)
      })
    })
  }

  private setActiveProcess(proc: ChildProcess | null): void {
    if (this.activeTranscription) {
      this.activeTranscription.process = proc
    }
  }

  private updateJob(update: Partial<TranscriptionJob>): void {
    if (this.activeTranscription) {
      Object.assign(this.activeTranscription.job, update)
    }
  }

  private emitEvent(channel: string, payload: any): void {
    if (this.activeTranscription?.webContents && !this.activeTranscription.webContents.isDestroyed()) {
      try {
        this.activeTranscription.webContents.send(channel, payload)
      } catch { /* ignore - window may be closing */ }
    }
  }

  private cleanup(): void {
    if (!this.activeTranscription) return

    // Clean up temp WAV file
    const tempPath = this.activeTranscription.tempWavPath
    if (tempPath && existsSync(tempPath)) {
      try {
        unlinkSync(tempPath)
        logger.debug('Cleaned up temp WAV', { path: tempPath })
      } catch (err) {
        logger.warn('Failed to clean up temp WAV', { path: tempPath, error: err })
      }
    }

    this.activeTranscription = null
  }
}
