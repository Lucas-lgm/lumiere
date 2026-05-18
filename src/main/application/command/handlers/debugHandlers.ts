import { ipcMain } from 'electron'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS } from '../ipcConstants'
import type { PlayerDirectPort } from '../ipcTypes'

/**
 * Debug function IPC handlers
 *
 * Routes directly to the media player via PlayerDirectPort — debug
 * introspection doesn't require the coordinator's orchestration.
 */
export function setupDebugHandlers(playerOps: PlayerDirectPort): void {
  ipcMain.on(IPC_CHANNELS.DEBUG_HDR_STATUS, createIpcHandler(
    async () => {
      await playerOps.debugVideoState()
      await playerOps.debugHdrStatus()
    },
    undefined,
    IPC_CHANNELS.DEBUG_HDR_STATUS
  ))
}
