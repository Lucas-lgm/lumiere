// ══════════════════════════════════════════════
// Animated Image Export shared types — used by main, preload, and renderer
// ══════════════════════════════════════════════

export interface AnimExportConfig {
  videoPath: string
  startTime: number       // seconds
  endTime: number         // seconds
  fps: 10 | 15 | 24
  scale: 0.5 | 0.75 | 1.0
  quality: 'fast' | 'high'
  outputPath: string
}

export type AnimExportPhase =
  | 'preparing'
  | 'extracting'
  | 'encoding'
  | 'complete'
  | 'error'
  | 'cancelled'

export interface AnimExportProgress {
  phase: AnimExportPhase
  progress: number        // 0-1
  currentFrame: number
  totalFrames: number
}

export interface AnimExportResult {
  success: boolean
  outputPath?: string
  error?: string
}
