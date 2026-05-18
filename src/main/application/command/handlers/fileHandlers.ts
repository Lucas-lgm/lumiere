import { ipcMain, dialog, shell } from 'electron'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS, VIDEO_FILE_EXTENSIONS } from '../ipcConstants'

/**
 * File selection IPC handlers
 *
 * Receives a narrow openFile callback instead of the full
 * VideoPlayerApp — the handler only needs to route selected file
 * paths to the app's file-open pipeline.
 */
export function setupFileHandlers(openFile: (path: string) => void): void {
  // File selection (thin orchestration: dialog → route to app's file-open pipeline)
  ipcMain.on(IPC_CHANNELS.SELECT_VIDEO_FILE, createIpcHandler(
    async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Video Files', extensions: [...VIDEO_FILE_EXTENSIONS] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (!result.canceled && result.filePaths.length > 0) {
        openFile(result.filePaths[0])
      }
    },
    undefined,
    IPC_CHANNELS.SELECT_VIDEO_FILE
  ))

  // Select directory (for settings page scan directory, returns path)
  ipcMain.handle(IPC_CHANNELS.SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Scan Directory'
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  // Show file in Finder
  ipcMain.handle(IPC_CHANNELS.SHOW_IN_FINDER, async (_event, filePath: string) => {
    if (typeof filePath === 'string' && filePath) {
      shell.showItemInFolder(filePath)
    }
  })
}
