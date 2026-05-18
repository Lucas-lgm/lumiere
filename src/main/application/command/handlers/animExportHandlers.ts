import { ipcMain, dialog } from 'electron'
import { IPC_CHANNELS } from '../ipcConstants'
import type { AnimExportService } from '../../services/animExportService'
import type { AnimExportConfig } from '../../../../shared/types/animExport'
import { createLogger } from '../../../infrastructure/logging'

const logger = createLogger('AnimExportHandlers')

export function setupAnimExportHandlers(animExportService: AnimExportService): void {
  ipcMain.handle(IPC_CHANNELS.ANIM_EXPORT_START, async (event, config: AnimExportConfig) => {
    logger.info('Animated image export requested', { video: config.videoPath })
    return animExportService.startExport(config, event.sender)
  })

  ipcMain.handle(IPC_CHANNELS.ANIM_EXPORT_CANCEL, async () => {
    animExportService.cancel()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.ANIM_EXPORT_SELECT_OUTPUT, async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'export.webp',
      filters: [
        { name: 'WebP', extensions: ['webp'] },
        { name: 'AVIF', extensions: ['avif'] },
      ]
    })
    return canceled ? null : filePath
  })
}
