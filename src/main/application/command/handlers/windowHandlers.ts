import { ipcMain } from 'electron'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS } from '../ipcConstants'
import type { WindowOpsPort } from '../ipcTypes'

/**
 * Window operation IPC handlers
 *
 * Routes window commands (fullscreen, PIP, fit, aspect-lock, window
 * actions) directly to PlaybackWindowManager via the WindowOpsPort
 * interface.  Only user-initiated window operations are accessible;
 * subsystem-internal methods (teardown, broadcast*) are not visible
 * through the port.
 *
 * Direct routing — no indirection needed for stateless window ops.
 */
export function setupWindowHandlers(windowManager: WindowOpsPort): void {
  ipcMain.on(IPC_CHANNELS.CONTROL_TOGGLE_FULLSCREEN, createIpcHandler(
    () => {
      windowManager.toggleFullscreen()
    },
    undefined,
    IPC_CHANNELS.CONTROL_TOGGLE_FULLSCREEN
  ))

  // PIP toggle
  ipcMain.handle(IPC_CHANNELS.CONTROL_TOGGLE_PIP, () => {
    return windowManager.togglePip()
  })

  // PIP close (pause + exit PIP)
  ipcMain.handle(IPC_CHANNELS.PIP_CLOSE, () => {
    windowManager.pipClose()
  })

  // PIP return to main window
  ipcMain.handle(IPC_CHANNELS.PIP_RETURN, () => {
    windowManager.pipReturn()
  })

  // PIP toggle size
  ipcMain.handle(IPC_CHANNELS.PIP_TOGGLE_SIZE, () => {
    windowManager.togglePipSize()
  })

  // Fit window to video aspect ratio
  ipcMain.handle(IPC_CHANNELS.FIT_TO_VIDEO, (_event, videoWidth: number, videoHeight: number) => {
    windowManager.fitToVideo(videoWidth, videoHeight)
  })

  // Lock/unlock window aspect ratio
  ipcMain.handle(IPC_CHANNELS.SET_ASPECT_LOCK, (_event, ratio: number) => {
    windowManager.setAspectRatioLock(ratio)
  })

  // Note: the renderer sends a string action, not { action: string }
  ipcMain.on(IPC_CHANNELS.CONTROL_WINDOW_ACTION, createIpcHandler<[string]>(
    (_event, action: string) => {
      // Validate that action is a valid value
      if (action !== 'close' && action !== 'minimize' && action !== 'maximize') {
        throw new Error(`Invalid window action: ${action} (must be 'close', 'minimize', or 'maximize')`)
      }
      windowManager.handleWindowAction(action as 'close' | 'minimize' | 'maximize')
    },
    undefined,
    IPC_CHANNELS.CONTROL_WINDOW_ACTION
  ))
}
