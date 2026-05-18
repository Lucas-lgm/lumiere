import { ipcMain } from 'electron'
import type { WhisperService } from '../../services/whisperService'
import type { WhisperModelSize } from '../../services/whisperModelManager'
import { IPC_CHANNELS } from '../ipcConstants'

/**
 * AI subtitle transcription IPC handlers
 *
 * Provides transcription control, status query, and model management interfaces.
 * Progress events are pushed directly by WhisperService via webContents.send().
 */
export function setupTranscriptionHandlers(
  whisperService: WhisperService,
): void {
  // Start transcription
  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_START, async (event, mediaPath: string, options: { model: WhisperModelSize; language: string; audioTrackIndex?: number }) => {
    return whisperService.startTranscription(mediaPath, options, event.sender)
  })

  // Cancel transcription
  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_CANCEL, async (_event, mediaPath: string) => {
    return whisperService.cancelTranscription(mediaPath)
  })

  // Query task status
  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_STATUS, async (_event, mediaPath: string) => {
    return whisperService.getStatus(mediaPath)
  })

  // Check if SRT already exists
  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_CHECK_SRT, async (_event, mediaPath: string) => {
    return whisperService.checkSrtExists(mediaPath)
  })

  // Check binary availability
  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_CHECK_AVAILABILITY, async () => {
    return whisperService.checkAvailability()
  })

  // List models and download status
  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_LIST_MODELS, async () => {
    return whisperService.modelManager.listModels()
  })

  // Download model
  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_DOWNLOAD_MODEL, async (event, model: WhisperModelSize) => {
    return whisperService.modelManager.downloadModel(model, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('transcription:model-download-progress', { model, progress })
      }
    })
  })

  // Delete downloaded model
  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_DELETE_MODEL, async (_event, model: WhisperModelSize) => {
    return whisperService.modelManager.deleteModel(model)
  })
}
