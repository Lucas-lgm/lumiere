import { PlatformAdapter } from './PlatformAdapter';
import { Media } from '../../../types/media';

/**
 * Web 平台实现
 * 保留接口结构，待实现
 */
export class WebPlatform implements PlatformAdapter {
  /**
   * 播放视频
   * @param video 视频对象
   * @param options 播放选项
   */
  async play(video: Media, options?: {
    transcode?: boolean;
    transcodeConfig?: any;
  }): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 暂停播放
   */
  async pause(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 恢复播放
   */
  async resume(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 跳转到指定时间
   * @param time 时间（秒）
   */
  async seek(time: number): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 设置音量
   * @param volume 音量（0-100）
   */
  async setVolume(volume: number): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 切换全屏
   */
  async toggleFullscreen(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 彻底退出播放器
   */
  async quit(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 获取当前媒体的轨道列表（Web 平台暂未实现，返回空数组）
   */
  async getTracks(): Promise<any[]> {
    return Promise.resolve([]);
  }

  /**
   * 切换音轨（Web 平台暂未实现）
   */
  async setAudioTrack(_trackId: number | null): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 切换字幕轨（Web 平台暂未实现）
   */
  async setSubtitleTrack(_trackId: number | null): Promise<void> {
    return Promise.resolve();
  }
}
