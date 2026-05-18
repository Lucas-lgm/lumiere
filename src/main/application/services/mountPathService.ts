/**
 * Mount path management service
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { readdir, stat, open } from 'fs/promises'
import { join } from 'path'
import { app, BrowserWindow } from 'electron'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('MountPathService')

export interface MountPath {
  id: string
  path: string
  resourceCount: number
  lastScanned?: Date
  autoScan?: boolean
}

export interface ScannedResource {
  id: string
  name: string
  path: string
  duration?: number
  size?: number
}

/**
 * Video file extensions (for quick pre-filtering)
 */
const VIDEO_EXTENSIONS = [
  'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v',
  'ts', 'm2ts', 'mts', 'm3u8', 'mpg', 'mpeg', 'vob', 'ogv',
  'rmvb', '3gp', 'asf', 'divx', 'xvid', 'f4v', 'rm', 'rmvb',
  'iso'
]

/**
 * Non-video file extension blacklist (avoids unnecessary file reads)
 */
const NON_VIDEO_EXTENSIONS = [
  'asar', 'app', 'dmg', 'pkg', 'zip', 'rar', '7z', 'tar', 'gz',
  'exe', 'dll', 'so', 'dylib', 'framework', 'bundle',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'ico', 'webp',
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma',
  'txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts',
  'db', 'sqlite', 'sqlite3', 'log', 'lock'
]

/**
 * Video file MIME types
 */
const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/x-msvideo', // AVI
  'video/x-matroska', // MKV
  'video/quicktime', // MOV
  'video/x-ms-wmv', // WMV
  'video/x-flv', // FLV
  'video/webm', // WebM
  'video/mp2t', // TS
  'video/mpeg', // MPEG
  'video/x-msvideo', // AVI
  'application/vnd.apple.mpegurl', // M3U8
  'application/x-mpegURL', // M3U8
  'video/3gpp', // 3GP
  'video/x-ms-asf', // ASF
  'video/ogg', // OGV
  'video/x-msvideo' // AVI
]

/**
 * Video file headers (Magic Bytes)
 * Format: [header byte array, MIME type]
 */
const VIDEO_FILE_SIGNATURES: Array<[number[], string]> = [
  // MP4 (ftyp box)
  [[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], 'video/mp4'],
  [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], 'video/mp4'],
  [[0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70], 'video/mp4'],
  // AVI (RIFF...AVI)
  [[0x52, 0x49, 0x46, 0x46], 'video/x-msvideo'], // Offset check needed
  // MKV (1A 45 DF A3)
  [[0x1A, 0x45, 0xDF, 0xA3], 'video/x-matroska'],
  // MOV/QuickTime (ftyp)
  [[0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74], 'video/quicktime'],
  [[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74], 'video/quicktime'],
  // WMV (30 26 B2 75 8E 66 CF 11)
  [[0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11], 'video/x-ms-wmv'],
  // FLV (46 4C 56)
  [[0x46, 0x4C, 0x56, 0x01], 'video/x-flv'],
  // WebM (1A 45 DF A3)
  [[0x1A, 0x45, 0xDF, 0xA3], 'video/webm'],
  // MPEG (00 00 01 BA or 00 00 01 B3)
  [[0x00, 0x00, 0x01, 0xBA], 'video/mpeg'],
  [[0x00, 0x00, 0x01, 0xB3], 'video/mpeg'],
  // TS (starts with 0x47, one packet every 188 bytes)
  [[0x47], 'video/mp2t'],
  // 3GP (00 00 00 20 66 74 79 70 33 67)
  [[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x33, 0x67], 'video/3gpp'],
  // OGV (OggS)
  [[0x4F, 0x67, 0x67, 0x53], 'video/ogg'],
  // RM/RMVB (2E 52 4D 46)
  [[0x2E, 0x52, 0x4D, 0x46], 'video/vnd.rn-realvideo'],
  // ASF (30 26 B2 75 8E 66 CF 11)
  [[0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11], 'video/x-ms-asf']
]

/**
 * Read the first few bytes of a file (for file type detection)
 */
async function readFileHeader(filePath: string, bytes: number = 64): Promise<Buffer | null> {
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null
  try {
    fileHandle = await open(filePath, 'r')
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await fileHandle.read(buffer, 0, bytes, 0)
    return bytesRead > 0 ? buffer.slice(0, bytesRead) : null
  } catch (error) {
    // Silently handle errors, don't log warnings (may be special files like .asar)
    return null
  } finally {
    if (fileHandle !== null) {
      await fileHandle.close()
    }
  }
}

/**
 * Detect MIME type via file header
 */
async function detectMimeType(filePath: string): Promise<string | null> {
  const header = await readFileHeader(filePath, 64)
  if (!header) {
    return null
  }

  const headerBytes = Array.from(header)

  // Check all known video file signatures
  for (const [signature, mimeType] of VIDEO_FILE_SIGNATURES) {
    if (headerBytes.length < signature.length) {
      continue
    }

    // For AVI, check if offset 8 contains "AVI "
    if (mimeType === 'video/x-msvideo' && signature[0] === 0x52) {
      if (headerBytes[0] === 0x52 && headerBytes[1] === 0x49 && 
          headerBytes[2] === 0x46 && headerBytes[3] === 0x46 &&
          headerBytes.length >= 12 &&
          headerBytes[8] === 0x41 && headerBytes[9] === 0x56 && 
          headerBytes[10] === 0x49 && headerBytes[11] === 0x20) {
        return mimeType
      }
      continue
    }

    // For TS, check if the first few bytes are 0x47 (TS packet sync byte)
    if (mimeType === 'video/mp2t' && signature[0] === 0x47) {
      // TS files typically start with 0x47 and repeat every 188 bytes
      if (headerBytes[0] === 0x47 && 
          (headerBytes.length < 188 || headerBytes[188] === 0x47)) {
        return mimeType
      }
      continue
    }

    // For MP4/MOV, check ftyp box
    if ((mimeType === 'video/mp4' || mimeType === 'video/quicktime') && 
        signature[4] === 0x66 && signature[5] === 0x74 && 
        signature[6] === 0x79 && signature[7] === 0x70) {
      // Check if first 4 bytes are box size, bytes 5-8 are "ftyp"
      const boxSize = (headerBytes[0] << 24) | (headerBytes[1] << 16) | 
                     (headerBytes[2] << 8) | headerBytes[3]
      if (boxSize > 0 && boxSize <= 64 &&
          headerBytes[4] === 0x66 && headerBytes[5] === 0x74 && 
          headerBytes[6] === 0x79 && headerBytes[7] === 0x70) {
        // Check brand (bytes 9-12)
        const brand = String.fromCharCode(
          headerBytes[8], headerBytes[9], headerBytes[10], headerBytes[11]
        )
        if (brand === 'qt  ' || brand === 'isom' || brand === 'mp41' || 
            brand === 'mp42' || brand === 'avc1' || brand === 'M4V ') {
          return mimeType
        }
      }
      continue
    }

    // Standard match: check if signature matches
    let matches = true
    for (let i = 0; i < signature.length; i++) {
      if (headerBytes[i] !== signature[i]) {
        matches = false
        break
      }
    }
    if (matches) {
      return mimeType
    }
  }

  return null
}

/**
 * Check if a file is a video file (via extension and MIME type)
 */
async function isVideoFile(filePath: string, fileName: string): Promise<boolean> {
  // First, quickly check the extension (performance optimization)
  const ext = fileName.split('.').pop()?.toLowerCase()
  
  // If extension is in the blacklist, return false immediately (avoid unnecessary file reads)
  if (ext && NON_VIDEO_EXTENSIONS.includes(ext)) {
    return false
  }
  
  if (ext && VIDEO_EXTENSIONS.includes(ext)) {
    // If extension matches, confirm via MIME type (more accurate)
    try {
      const mimeType = await detectMimeType(filePath)
      if (mimeType && VIDEO_MIME_TYPES.includes(mimeType)) {
        return true
      }
    } catch (error) {
      // If MIME detection fails (e.g., .asar files), but extension matches, still treat as video
      // (file header may be corrupted or format is special, or an unreadable special file)
    }
    // If extension matches but MIME detection fails, still treat as video
    // (file header may be corrupted or format is special)
    return true
  }

  // If extension doesn't match, try MIME type detection
  try {
    const mimeType = await detectMimeType(filePath)
    if (mimeType && VIDEO_MIME_TYPES.includes(mimeType)) {
      return true
    }
  } catch (error) {
    // If file can't be read (e.g., .asar), return false
    return false
  }

  return false
}

/**
 * Recursively scan a directory for video files
 */
export async function scanDirectory(dirPath: string, maxDepth: number = 5, currentDepth: number = 0): Promise<ScannedResource[]> {
  if (currentDepth >= maxDepth) {
    return []
  }

  const resources: ScannedResource[] = []

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      try {
        if (entry.isDirectory()) {
          // Recursively scan subdirectory
          const subResources = await scanDirectory(fullPath, maxDepth, currentDepth + 1)
          resources.push(...subResources)
        } else if (entry.isFile()) {
          // Check if it's a video file via MIME type
          const isVideo = await isVideoFile(fullPath, entry.name)
          if (isVideo) {
            // It's a video file, add to resource list
            const stats = await stat(fullPath)
            resources.push({
              id: `mounted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: entry.name,
              path: fullPath,
              size: stats.size
              // duration needs to be obtained from the player, not set here
            })
          }
        }
      } catch (error) {
        // Ignore inaccessible files/directories
        logger.debug('cannot access file/directory', {
          path: fullPath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  } catch (error) {
    logger.error('failed to scan directory', {
      path: dirPath,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return resources
}

/**
 * Mount path service
 */
export class MountPathService {
  private mountPaths: Map<string, MountPath> = new Map()
  private mainWindow: BrowserWindow | null = null
  private readonly configPath: string

  constructor() {
    // Get config file path
    const userData = app.getPath('userData')
    this.configPath = join(userData, 'mount-paths.json')
    
    // Load saved mount paths
    this.loadMountPaths()
  }

  /**
   * Load saved mount paths
   */
  private loadMountPaths(): void {
    try {
      if (!existsSync(this.configPath)) {
        return
      }
      const raw = readFileSync(this.configPath, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.mountPaths)) {
        data.mountPaths.forEach((mp: any) => {
          // Convert date string to Date object
          const mountPath: MountPath = {
            id: mp.id,
            path: mp.path,
            resourceCount: mp.resourceCount || 0,
            lastScanned: mp.lastScanned ? new Date(mp.lastScanned) : undefined,
            autoScan: mp.autoScan !== undefined ? mp.autoScan : true
          }
          this.mountPaths.set(mountPath.id, mountPath)
        })
      }
    } catch (error) {
      logger.error('failed to load mount paths', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Save mount paths to file
   */
  private saveMountPaths(): void {
    try {
      const mountPathsArray = Array.from(this.mountPaths.values())
      const data = {
        mountPaths: mountPathsArray.map(mp => ({
          id: mp.id,
          path: mp.path,
          resourceCount: mp.resourceCount,
          lastScanned: mp.lastScanned?.toISOString(),
          autoScan: mp.autoScan
        }))
      }
      writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      logger.error('failed to save mount paths', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Set the main window (for sending IPC messages)
   */
  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window
    // After window is set, send the current mount path list
    if (window && !window.isDestroyed()) {
      const mountPaths = this.getAllMountPaths()
      window.webContents.send('file:mounts-updated', { mountPaths })
    }
  }

  /**
   * Add mount path
   */
  async addMountPath(path: string): Promise<MountPath> {
    const id = `mount-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Scan directory
    const resources = await scanDirectory(path)
    
    const mountPath: MountPath = {
      id,
      path,
      resourceCount: resources.length,
      lastScanned: new Date(),
      autoScan: true
    }

    this.mountPaths.set(id, mountPath)
    
    // Save to file
    this.saveMountPaths()

    // Send IPC message to renderer process
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('file:mount-added', {
        mountPath,
        resources
      })
      // Also send the updated list
      this.mainWindow.webContents.send('file:mounts-updated', {
        mountPaths: this.getAllMountPaths()
      })
    }

    return mountPath
  }

  /**
   * Remove mount path
   */
  removeMountPath(id: string): boolean {
    const removed = this.mountPaths.delete(id)
    
    if (removed) {
      // Save to file
      this.saveMountPaths()
      
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('file:mount-removed', { id })
        // Also send the updated list
        this.mainWindow.webContents.send('file:mounts-updated', {
          mountPaths: this.getAllMountPaths()
        })
      }
    }

    return removed
  }

  /**
   * Refresh and rescan mount path
   */
  async refreshMountPath(id: string): Promise<void> {
    const mountPath = this.mountPaths.get(id)
    if (!mountPath) {
      throw new Error(`mount path does not exist: ${id}`)
    }

    // Rescan directory
    const resources = await scanDirectory(mountPath.path)
    
    // Update mount path info
    mountPath.resourceCount = resources.length
    mountPath.lastScanned = new Date()
    
    // Save to file
    this.saveMountPaths()

    // Send IPC message to renderer process
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('file:mount-scanned', {
        id,
        resources
      })
      // Also send the updated list
      this.mainWindow.webContents.send('file:mounts-updated', {
        mountPaths: this.getAllMountPaths()
      })
    }
  }

  /**
   * Get all mount paths
   */
  getAllMountPaths(): MountPath[] {
    return Array.from(this.mountPaths.values())
  }

  /**
   * Get mount path
   */
  getMountPath(id: string): MountPath | undefined {
    return this.mountPaths.get(id)
  }
}

