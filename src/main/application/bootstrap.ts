import { app, BrowserWindow, protocol, net } from 'electron'
import { join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { MpvMediaPlayer } from '../infrastructure/mpv'
import { VideoPlayerApp } from './videoPlayerApp'
import { initFileLogging, createLogger } from '../infrastructure/logging'

// Custom protocol privileges must be registered before app.ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'thumb', privileges: { secure: true, standard: false, corsEnabled: true, stream: true } }
])

/**
 * Application entry point — pure composition root.
 *
 * Creates the object graph (MediaPlayer → VideoPlayerApp) and delegates
 * the complete application lifecycle to VideoPlayerApp.
 *
 * All startup sequencing (IPC registration → settings → window →
 * listeners → post-window effects) and shutdown are owned by
 * VideoPlayerApp.  The only event handled here is `open-file` before
 * app.ready — because it fires before VideoPlayerApp exists, so the
 * path must be cached and forwarded after construction.
 */
export function runApp() {
  // open-file may fire before ready (Finder double-click), cache the path first
  let pendingFilePath: string | null = null
  let videoPlayerApp: VideoPlayerApp | null = null

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (videoPlayerApp) {
      videoPlayerApp.handleOpenFile(filePath)
    } else {
      pendingFilePath = filePath
    }
  })

  app.whenReady().then(async () => {
    // Initialize file logging (path: ~/Library/Logs/lumiere/lumiere.log)
    initFileLogging(join(app.getPath('logs'), 'lumiere.log'))

    const logger = createLogger('App')
    logger.info('App started', { version: app.getVersion(), platform: process.platform, arch: process.arch, locale: app.getLocale() })

    // Register thumb:// protocol, map thumb://xxx.jpg to local thumbnail cache directory
    const thumbnailDir = join(app.getPath('userData'), 'thumbnails')
    const allowedDir = resolve(thumbnailDir)
    protocol.handle('thumb', (request) => {
      const filename = decodeURIComponent(request.url.slice('thumb://'.length))
      const resolved = resolve(join(thumbnailDir, filename))
      // Path traversal protection: resolved path must be within the allowed directory
      if (!resolved.startsWith(allowedDir + sep)) {
        return new Response('', { status: 404 })
      }
      return net.fetch(pathToFileURL(resolved).toString())
    })

    // ── Object graph construction ──

    const mediaPlayer = new MpvMediaPlayer()
    videoPlayerApp = new VideoPlayerApp(mediaPlayer)

    // ── Application lifecycle (owned by VideoPlayerApp) ──
    //
    // VideoPlayerApp.start() runs the complete startup sequence:
    // register IPC handlers → apply settings → create window →
    // register listeners → post-window effects (mount service,
    // theme push, pending file).
    await videoPlayerApp.start(pendingFilePath ?? undefined)
    pendingFilePath = null
  })
}
