import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../ipcConstants'
import type { EqualizerConfigPort } from '../ipcTypes'
import type { EqualizerState } from '../../../../shared/types/ipc'

export function setupEqualizerHandlers(config: EqualizerConfigPort): void {
  ipcMain.handle(IPC_CHANNELS.EQUALIZER_GET_STATE, async (): Promise<EqualizerState> => {
    return config.getEqualizerState()
  })

  ipcMain.handle(IPC_CHANNELS.EQUALIZER_SAVE_STATE, async (_event, state: { enabled: boolean; bands: number[]; currentPreset: string }) => {
    config.setEqualizerState(state)
  })

  ipcMain.handle(IPC_CHANNELS.EQUALIZER_SAVE_PRESET, async (_event, name: string, bands: number[]) => {
    config.saveEqualizerPreset(name, bands)
  })

  ipcMain.handle(IPC_CHANNELS.EQUALIZER_DELETE_PRESET, async (_event, name: string) => {
    config.deleteEqualizerPreset(name)
  })
}
