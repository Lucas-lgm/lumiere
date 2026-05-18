import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../ipcConstants'
import type { PlayerDirectPort } from '../ipcTypes'
import type { MediaInfo } from '../../../../shared/types/ipc'
import { createLogger } from '../../../infrastructure/logging'

const logger = createLogger('PlayerPropertyHandlers')

/**
 * mpv property read/write IPC handlers
 *
 * Routes directly to the media player via PlayerDirectPort — property
 * access, raw commands, and media-info assembly don't require the
 * coordinator's orchestration or scheduling.
 *
 * Generic property interface, used by P2 panel and control bar.
 * Supports reading arbitrary mpv properties such as chapter-list, ab-loop-a/b, brightness, etc.
 */
export function setupPlayerPropertyHandlers(playerOps: PlayerDirectPort): void {
  // Get mpv property
  ipcMain.handle(IPC_CHANNELS.PLAYER_GET_PROPERTY, async (_event, property: string) => {
    try {
      return await playerOps.getProperty(property)
    } catch (err) {
      logger.warn('Failed to get property', { property, error: (err as Error).message })
      return undefined
    }
  })

  // Set mpv property
  ipcMain.handle(IPC_CHANNELS.PLAYER_SET_PROPERTY, async (_event, property: string, value: any) => {
    try {
      await playerOps.setProperty(property, value)
    } catch (err) {
      logger.warn('Failed to set property', { property, error: (err as Error).message })
    }
  })

  // Execute mpv command (frame-step / screenshot etc.)
  ipcMain.handle(IPC_CHANNELS.PLAYER_COMMAND, async (_event, ...args: string[]) => {
    try {
      await playerOps.command(...args)
    } catch (err) {
      logger.warn('Failed to execute command', { args, error: (err as Error).message })
    }
  })

  // Get media info (parallel reads + DTO assembly)
  ipcMain.handle(IPC_CHANNELS.PLAYER_GET_MEDIA_INFO, async () => {
    return await assembleMediaInfo(playerOps)
  })
}

/** Assemble a structured MediaInfo read-model from raw player properties. */
async function assembleMediaInfo(playerOps: PlayerDirectPort): Promise<MediaInfo | null> {
  try {
    const [
      width, height, codec, pixFmt, fps,
      audioCodec, audioChannels, sampleRate,
      fileSize, duration, chapters
    ] = await Promise.all([
      playerOps.getProperty('width'),
      playerOps.getProperty('height'),
      playerOps.getProperty('video-codec'),
      playerOps.getProperty('pixel-format'),
      playerOps.getProperty('estimated-vf-fps'),
      playerOps.getProperty('audio-codec-name'),
      playerOps.getProperty('audio-params/channel-count'),
      playerOps.getProperty('audio-params/samplerate'),
      playerOps.getProperty('file-size'),
      playerOps.getProperty('duration'),
      playerOps.getProperty('chapter-list'),
    ])
    return {
      video: { width, height, codec, pixFmt, fps },
      audio: { codec: audioCodec, channels: audioChannels, sampleRate },
      file: { size: fileSize, duration },
      chapters: Array.isArray(chapters) ? chapters : [],
    }
  } catch (err) {
    logger.warn('Failed to get media info', { error: (err as Error).message })
    return null
  }
}
