import { Media, Playlist as PlaylistType } from '../../../types/media';

/**
 * 播放列表管理器
 * 管理视频播放列表
 */
export class Playlist {
  private playlist: PlaylistType = [];

  /**
   * 初始化播放列表
   */
  constructor() {
  }

  /**
   * 获取当前播放列表
   */
  async get(): Promise<PlaylistType> {
    return this.playlist;
  }

  /**
   * 添加视频到播放列表
   * @param video 视频对象
   */
  async add(video: Media): Promise<void> {
    this.playlist.push(video);
  }

  /**
   * 从播放列表移除视频
   * @param index 索引
   */
  async remove(index: number): Promise<void> {
    if (index >= 0 && index < this.playlist.length) {
      this.playlist.splice(index, 1);
    }
  }

  /**
   * 设置整个播放列表
   * @param videos 视频对象数组
   */
  async set(videos: Media[]): Promise<void> {
    this.playlist = videos;
  }

  /**
   * 清空播放列表
   */
  async clear(): Promise<void> {
    this.playlist = [];
  }
}
