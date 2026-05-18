import { ipcMain, dialog } from 'electron'
import type { MountPathService } from '../../services/mountPathService'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS, IPC_RESPONSE_CHANNELS } from '../ipcConstants'
import type {
  MountPathAddRequest,
  MountPathRemoveRequest,
  MountPathRefreshRequest,
  ScanDirectoryRequest
} from '../ipcTypes'

/**
 * Mount path management IPC handlers
 *
 * Receives MountPathService from the explicit IPC deps object —
 * consistent with all other handler modules.  The mount-path service
 * is created and owned by VideoPlayerApp, not a module-level singleton.
 */
export function setupMountPathHandlers(mountPathService: MountPathService): void {
  ipcMain.on(IPC_CHANNELS.SELECT_MOUNT_PATH, createIpcHandler(
    async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Folder to Mount'
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const path = result.filePaths[0]
        await mountPathService.addMountPath(path)
      }
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.SELECT_MOUNT_PATH
  ))

  ipcMain.on(IPC_CHANNELS.MOUNT_PATH_ADD, createIpcHandler<[MountPathAddRequest]>(
    async (_event, data: MountPathAddRequest) => {
      await mountPathService.addMountPath(data.path)
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.MOUNT_PATH_ADD
  ))

  ipcMain.on(IPC_CHANNELS.MOUNT_PATH_REMOVE, createIpcHandler<[MountPathRemoveRequest]>(
    (_event, data: MountPathRemoveRequest) => {
      mountPathService.removeMountPath(data.id)
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.MOUNT_PATH_REMOVE
  ))

  ipcMain.on(IPC_CHANNELS.MOUNT_PATH_REFRESH, createIpcHandler<[MountPathRefreshRequest]>(
    async (_event, data: MountPathRefreshRequest) => {
      await mountPathService.refreshMountPath(data.id)
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.MOUNT_PATH_REFRESH
  ))

  ipcMain.on(IPC_CHANNELS.GET_MOUNT_PATHS, (event) => {
    const mountPaths = mountPathService.getAllMountPaths()
    event.reply(IPC_RESPONSE_CHANNELS.MOUNT_PATHS_UPDATED, { mountPaths })
  })

  // Scan directory (independent function, no mount)
  ipcMain.on(IPC_CHANNELS.SCAN_DIRECTORY, createIpcHandler<[ScanDirectoryRequest]>(
    async (event, data: ScanDirectoryRequest) => {
      // Use mountPathService's internal method to scan
      const mountPath = await mountPathService.addMountPath(data.path)
      if (mountPath) {
        // Get scanned resources (already sent via mount-path-added event)
        event.reply(IPC_RESPONSE_CHANNELS.DIRECTORY_SCANNED, { path: data.path, mountPathId: mountPath.id })
      }
    },
    IPC_RESPONSE_CHANNELS.DIRECTORY_SCAN_ERROR,
    IPC_CHANNELS.SCAN_DIRECTORY
  ))
}
