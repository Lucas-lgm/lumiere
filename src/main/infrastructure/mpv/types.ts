/**
 * MPV related type definitions
 */

/**
 * Native binding interface (internal use, not exported)
 */
export interface MPVBinding {
  create(): number
  initialize(instanceId: number): boolean
  setOption(instanceId: number, name: string, value: string | number | boolean): boolean
  setWindowId(instanceId: number, windowId: number): boolean
  loadFile(instanceId: number, path: string): boolean
  getProperty(instanceId: number, name: string): any
  setProperty(instanceId: number, name: string, value: string | number | boolean): boolean
  command(instanceId: number, args: string[]): boolean
  setEventCallback(instanceId: number, callback: (event: any) => void): boolean
  attachView(instanceId: number, viewPtr: number): void
  setWindowSize(instanceId: number, width: number, height: number): void
  setForceBlackMode(instanceId: number, enabled: boolean): void
  setHdrMode(instanceId: number, enabled: boolean): void
  debugHdrStatus(instanceId: number): void
  setJsDrivenRenderMode(instanceId: number, enabled: boolean): void
  getJsDrivenRenderMode(instanceId: number): boolean
  requestRender(instanceId: number): void
  destroy(instanceId: number): boolean
  generateThumbnail?(videoPath: string, outputPath: string, seekPercent: number, thumbWidth: number): Promise<boolean>
  exportAnimatedImage?(
    videoPath: string, outputPath: string,
    startTime: number, endTime: number,
    fps: number, outputWidth: number, outputHeight: number,
    quality: number,
    progressCallback: (currentFrame: number, totalFrames: number) => void
  ): Promise<boolean>
  cancelAnimatedImageExport?(): void
}

/**
 * MPV internal status interface
 */
export interface MPVStatus {
  position: number
  duration: number
  volume: number
  path: string | null
  phase?: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
  isSeeking?: boolean
  isNetworkBuffering?: boolean
  networkBufferingPercent?: number
  bufferRanges?: Array<{ start: number; end: number }>
  /** Brief info of the most recent mpv error (single line, human-readable) */
  errorMessage?: string
  /** Several log lines related to the most recent error (technical details, optional) */
  errorLogSnippet?: string[]
}
