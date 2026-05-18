import { PlatformAdapter } from './PlatformAdapter';
import { Media } from '../../../types/media';

/**
 * Web platform implementation
 * Keeps interface structure, to be implemented
 */
export class WebPlatform implements PlatformAdapter {
  /**
   * Play video
   * @param video Video object
   * @param options Playback options
   */
  async play(video: Media, options?: {
    transcode?: boolean;
    transcodeConfig?: any;
  }): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Pause
   */
  async pause(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Resume
   */
  async resume(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Stop
   */
  async stop(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Seek to specified time
   * @param time Time (seconds)
   */
  async seek(time: number): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Set volume
   * @param volume Volume (0-100)
   */
  async setVolume(volume: number): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Toggle fullscreen
   */
  async toggleFullscreen(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Quit player completely
   */
  async quit(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Get the track list of current media (Web platform not yet implemented, returns empty array)
   */
  async getTracks(): Promise<any[]> {
    return Promise.resolve([]);
  }

  /**
   * Switch audio track (Web platform not yet implemented)
   */
  async setAudioTrack(_trackId: number | null): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Switch subtitle track (Web platform not yet implemented)
   */
  async setSubtitleTrack(_trackId: number | null): Promise<void> {
    return Promise.resolve();
  }
}
