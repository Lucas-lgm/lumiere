import { PlatformAdapter } from './PlatformAdapter';
import { Media } from '../../../types/media';

/**
 * Electron platform implementation
 * Uses window.electronAPI.player as the underlying implementation
 */
export class ElectronPlatform implements PlatformAdapter {
  /**
   * Play video
   * @param video Video object
   * @param options Playback options
   */
  async play(video: Media, options?: {
    transcode?: boolean;
    transcodeConfig?: any;
  }): Promise<void> {
    window.electronAPI.player.playMedia({
      name: video.name,
      path: video.path,
      startTime: video.startTime || 0
    });
  }

  /**
   * Pause
   */
  async pause(): Promise<void> {
    window.electronAPI.player.pause();
  }

  /**
   * Resume
   */
  async resume(): Promise<void> {
    window.electronAPI.player.resume();
  }

  /**
   * Stop
   */
  async stop(): Promise<void> {
    window.electronAPI.player.stop();
  }

  /**
   * Seek to specified time
   * @param time Time (seconds)
   */
  async seek(time: number): Promise<void> {
    window.electronAPI.player.seek(time);
  }

  /**
   * Set volume
   * @param volume Volume (0-100)
   */
  async setVolume(volume: number): Promise<void> {
    window.electronAPI.player.setVolume(volume);
  }

  /**
   * Toggle fullscreen
   */
  async toggleFullscreen(): Promise<void> {
    window.electronAPI.window.toggleFullscreen();
  }

  /**
   * Quit player completely
   */
  async quit(): Promise<void> {
    window.electronAPI.player.quit();
  }

  /**
   * Get the track list of current media
   */
  async getTracks(): Promise<any[]> {
    if (!window.electronAPI.player.getTracks) return [];
    return await window.electronAPI.player.getTracks();
  }

  /**
   * Switch audio track
   */
  async setAudioTrack(trackId: number | null): Promise<void> {
    if (!window.electronAPI.player.setAudioTrack) return;
    window.electronAPI.player.setAudioTrack(trackId);
  }

  /**
   * Switch subtitle track
   */
  async setSubtitleTrack(trackId: number | null): Promise<void> {
    if (!window.electronAPI.player.setSubtitleTrack) return;
    window.electronAPI.player.setSubtitleTrack(trackId);
  }
}
