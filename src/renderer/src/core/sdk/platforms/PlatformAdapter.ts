import { Media } from '../../../types/media';

/**
 * Platform adapter interface
 * Defines a unified interface for different platform implementations
 */
export interface PlatformAdapter {
  /**
   * Play video
   * @param video Video object
   * @param options Playback options
   */
  play(video: Media, options?: {
    transcode?: boolean;
    transcodeConfig?: any;
  }): Promise<void>;

  /**
   * Pause
   */
  pause(): Promise<void>;

  /**
   * Resume
   */
  resume(): Promise<void>;

  /**
   * Stop
   */
  stop(): Promise<void>;

  /**
   * Seek to specified time
   * @param time Time (seconds)
   */
  seek(time: number): Promise<void>;

  /**
   * Set volume
   * @param volume Volume (0-100)
   */
  setVolume(volume: number): Promise<void>;

  /**
   * Toggle fullscreen
   */
  toggleFullscreen(): Promise<void>;

  /**
   * Quit player completely
   */
  quit(): Promise<void>;

  /**
   * Get the track list of current media (audio / subtitle / video)
   */
  getTracks(): Promise<any[]>;

  /**
   * Switch audio track
   * @param trackId Track id, pass null/0 to disable or return to default
   */
  setAudioTrack(trackId: number | null): Promise<void>;

  /**
   * Switch subtitle track
   * @param trackId Track id, pass null/0 to disable subtitles
   */
  setSubtitleTrack(trackId: number | null): Promise<void>;
}
