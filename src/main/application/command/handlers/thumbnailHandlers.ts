import { ipcMain } from 'electron'
import { ThumbnailService } from '../../services/thumbnailService'
import { IPC_CHANNELS } from '../ipcConstants'

/**
 * Thumbnail IPC handlers — pure routing layer.
 *
 * Provides thumbnail retrieval interfaces consumed by P1 (resource library frontend).
 *
 * The autoThumbnail policy is enforced internally by ThumbnailService —
 * when disabled, generation methods return cached-only results and
 * seek methods no-op.  Handlers here are pure routing with no policy
 * logic, consistent with how watchProgressHandlers routes to
 * ConfigManager (which enforces rememberProgress internally).
 */
export function setupThumbnailHandlers(thumbnailService: ThumbnailService): void {
  // Get a single video's thumbnail path
  ipcMain.handle(IPC_CHANNELS.THUMBNAIL_GET, async (_event, filePath: string) => {
    return thumbnailService.getThumbnail(filePath)
  })

  // Batch generate thumbnails (background async, does not wait for completion)
  ipcMain.handle(IPC_CHANNELS.THUMBNAIL_GENERATE_BATCH, async (_event, filePaths: string[]) => {
    // fire-and-forget: does not block the renderer process
    thumbnailService.generateThumbnails(filePaths).catch(() => {})
  })

  // Generate progress bar sprite sheet
  // Returns { outputPath, count, thumbWidth, thumbHeight } for frontend hover preview
  ipcMain.handle(IPC_CHANNELS.THUMBNAIL_GENERATE_STRIP, async (_event, filePath: string, duration: number) => {
    return thumbnailService.getOrGenerateStrip(filePath, duration)
  })

  // ── Seek preview (progress bar hover dynamic on-demand generation) ──

  // Initialize persistent seek instance (called when a video is loaded)
  ipcMain.handle(IPC_CHANNELS.THUMBNAIL_SEEK_INIT, async (_event, filePath: string) => {
    return thumbnailService.initSeekThumbnail(filePath)
  })

  // Get thumbnail at a specific time point (check cache first, seek-generate if missing)
  // Returns thumb:// URL or null
  ipcMain.handle(IPC_CHANNELS.THUMBNAIL_SEEK_AT, async (_event, filePath: string, time: number) => {
    return thumbnailService.getSeekThumbnail(filePath, time)
  })

  // Destroy persistent seek instance (called when video switches)
  ipcMain.handle(IPC_CHANNELS.THUMBNAIL_SEEK_DESTROY, async () => {
    thumbnailService.destroySeekThumbnail()
  })
}
