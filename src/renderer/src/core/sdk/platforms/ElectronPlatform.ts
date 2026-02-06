import { PlatformAdapter } from './PlatformAdapter';
import { Media } from '../../../types/media';

/**
 * Electron 平台实现
 * 使用 window.electronAPI.player 作为底层实现
 */
export class ElectronPlatform implements PlatformAdapter {
  /**
   * 播放视频
   * @param video 视频对象
   * @param options 播放选项
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
   * 暂停播放
   */
  async pause(): Promise<void> {
    window.electronAPI.player.pause();
  }

  /**
   * 恢复播放
   */
  async resume(): Promise<void> {
    window.electronAPI.player.resume();
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    window.electronAPI.player.stop();
  }

  /**
   * 跳转到指定时间
   * @param time 时间（秒）
   */
  async seek(time: number): Promise<void> {
    window.electronAPI.player.seek(time);
  }

  /**
   * 设置音量
   * @param volume 音量（0-100）
   */
  async setVolume(volume: number): Promise<void> {
    window.electronAPI.player.setVolume(volume);
  }

  /**
   * 切换全屏
   */
  async toggleFullscreen(): Promise<void> {
    window.electronAPI.player.toggleFullscreen();
  }

  /**
   * 彻底退出播放器
   */
  async quit(): Promise<void> {
    window.electronAPI.player.quit();
  }
}
