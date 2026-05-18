import { BrowserWindow } from 'electron'
import { createLogger } from '../logging'

const logger = createLogger('NativeHelper')

/**
 * Get window handle (macOS)
 * Directly uses Electron's window handle, no compilation needed
 * Passes window handle to MPV for rendering in the specified window
 *
 * @param window Electron BrowserWindow instance
 * @returns Window handle (number), returned directly for MPV use
 */
export function getNSViewPointer(window: BrowserWindow): number | null {
  if (process.platform !== 'darwin') {
    logger.warn('Only supported on macOS')
    return null
  }

  try {
    // Ensure window exists
    if (!window || window.isDestroyed()) {
      logger.error('Window is destroyed or invalid')
      return null
    }

    // Get window handle (Electron's native handle)
    // On macOS, getNativeWindowHandle() returns NSView* (content view)
    const nativeHandle = window.getNativeWindowHandle()
    if (!nativeHandle || nativeHandle.length < 8) {
      logger.error('Failed to get native window handle')
      return null
    }

    // Read pointer value directly (this is the NSView* pointer value)
    const viewPtr = nativeHandle.readBigUInt64LE(0)
    const viewId = Number(viewPtr)

    logger.info('Got NSView pointer', { viewId })
    logger.debug('This is the content view of the Electron window')
    logger.debug('Will attach OpenGL context to this view for mpv rendering')

    return viewId
  } catch (error) {
    logger.error('Error getting window handle', { error })
    return null
  }
}

/**
 * Get window handle (Windows)
 * Gets HWND and passes it to MPV for wid embedding mode
 *
 * @param window Electron BrowserWindow instance
 * @returns Window handle (HWND, number), used to set mpv's wid option
 */
export function getHWNDPointer(window: BrowserWindow): number | null {
  if (process.platform !== 'win32') {
    logger.warn('Only supported on Windows')
    return null
  }

  try {
    // Ensure window exists
    if (!window || window.isDestroyed()) {
      logger.error('Window is destroyed or invalid')
      return null
    }

    // Get window handle (Electron's native handle)
    // On Windows, getNativeWindowHandle() returns HWND
    const nativeHandle = window.getNativeWindowHandle()
    if (!nativeHandle || nativeHandle.length < 4) {
      logger.error('Failed to get native window handle')
      return null
    }

    // On Windows, HWND is a 32-bit or 64-bit pointer
    // On 64-bit systems, use readBigUInt64LE; on 32-bit systems, use readUInt32LE
    let hwnd: number
    if (process.arch === 'x64' || process.arch === 'arm64') {
      hwnd = Number(nativeHandle.readBigUInt64LE(0))
    } else {
      hwnd = nativeHandle.readUInt32LE(0)
    }

    logger.info('Got HWND', { hwnd })
    logger.debug('Will use wid mode for mpv rendering')

    return hwnd
  } catch (error) {
    logger.error('Error getting window handle', { error })
    return null
  }
}
