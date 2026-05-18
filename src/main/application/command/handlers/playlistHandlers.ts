import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../ipcConstants'
import type { PlaylistItem } from '../../types'
import { createIpcHandler } from '../ipcErrorHandler'

/**
 * Playlist data service — store + broadcast relay.
 *
 * The main process holds a copy of the playlist purely for cross-renderer
 * synchronization (MainView and ControlView run in separate contexts).
 * All navigation logic (next/prev/loop/shuffle/auto-next) lives in the
 * renderer SDK.
 */
export function setupPlaylistHandlers(
  broadcast: (items: PlaylistItem[]) => void,
) {
  let playlistData: PlaylistItem[] = []

  ipcMain.on(IPC_CHANNELS.SET_PLAYLIST, createIpcHandler<[PlaylistItem[]]>(
    async (_event, items: PlaylistItem[]) => {
      playlistData = items
      broadcast(items)
    },
    undefined,
    IPC_CHANNELS.SET_PLAYLIST
  ))

  ipcMain.on(IPC_CHANNELS.GET_PLAYLIST, createIpcHandler(
    async (event) => {
      event.reply('playlist:updated', playlistData)
    },
    undefined,
    IPC_CHANNELS.GET_PLAYLIST
  ))
}
