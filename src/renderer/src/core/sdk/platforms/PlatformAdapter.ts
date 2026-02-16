import { Media } from '../../../types/media';

/**
 * 平台适配器接口
 * 定义不同平台实现的统一接口
 */
export interface PlatformAdapter {
  /**
   * 播放视频
   * @param video 视频对象
   * @param options 播放选项
   */
  play(video: Media, options?: {
    transcode?: boolean;
    transcodeConfig?: any;
  }): Promise<void>;

  /**
   * 暂停播放
   */
  pause(): Promise<void>;

  /**
   * 恢复播放
   */
  resume(): Promise<void>;

  /**
   * 停止播放
   */
  stop(): Promise<void>;

  /**
   * 跳转到指定时间
   * @param time 时间（秒）
   */
  seek(time: number): Promise<void>;

  /**
   * 设置音量
   * @param volume 音量（0-100）
   */
  setVolume(volume: number): Promise<void>;

  /**
   * 切换全屏
   */
  toggleFullscreen(): Promise<void>;

  /**
   * 彻底退出播放器
   */
  quit(): Promise<void>;

  /**
   * 获取当前媒体的轨道列表（音轨 / 字幕 / 视频）
   */
  getTracks(): Promise<any[]>;

  /**
   * 切换音轨
   * @param trackId 轨道 id，传入 null/0 表示关闭或回到默认
   */
  setAudioTrack(trackId: number | null): Promise<void>;

  /**
   * 切换字幕轨
   * @param trackId 轨道 id，传入 null/0 表示关闭字幕
   */
  setSubtitleTrack(trackId: number | null): Promise<void>;
}
