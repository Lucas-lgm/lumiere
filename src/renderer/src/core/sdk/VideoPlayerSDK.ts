import { ElectronPlatform } from './platforms/ElectronPlatform';
import { WebPlatform } from './platforms/WebPlatform';
import { Playlist } from './managers/Playlist';
import { PlatformAdapter } from './platforms/PlatformAdapter';
import { Media, Playlist as PlaylistType } from '../../types/media';

/**
 * 统一前端 SDK，支持 Electron 和 Web 双平台
 */
export class VideoPlayerSDK {
  private isElectron: boolean;
  private platform: PlatformAdapter;
  private playlist: Playlist;
  private stateListeners: Array<(state: any) => void> = [];

  constructor() {
    this.isElectron = !!window.electronAPI;
    this.platform = this.isElectron 
      ? new ElectronPlatform() 
      : new WebPlatform();
    this.playlist = new Playlist();
    this._setupStateListeners();
  }

  /**
   * 播放视频
   * @param video 视频对象
   * @param options 播放选项
   */
  async play(video: Media, options?: {
    transcode?: boolean;
    transcodeConfig?: any;
  }): Promise<void> {
    return this.platform.play(video, options);
  }

  /**
   * 暂停播放
   */
  async pause(): Promise<void> {
    return this.platform.pause();
  }

  /**
   * 恢复播放
   */
  async resume(): Promise<void> {
    return this.platform.resume();
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    return this.platform.stop();
  }

  /**
   * 跳转到指定时间
   * @param time 时间（秒）
   */
  async seek(time: number): Promise<void> {
    return this.platform.seek(time);
  }

  /**
   * 设置音量
   * @param volume 音量（0-100）
   */
  async setVolume(volume: number): Promise<void> {
    return this.platform.setVolume(volume);
  }

  /**
   * 切换全屏
   */
  async toggleFullscreen(): Promise<void> {
    return this.platform.toggleFullscreen();
  }

  /**
   * 彻底退出播放器
   */
  async quit(): Promise<void> {
    return this.platform.quit();
  }

  /**
   * 获取当前播放列表
   */
  getPlaylist(): PlaylistType {
    return this.playlist.get();
  }

  /**
   * 添加视频到播放列表
   * @param video 视频对象
   */
  addToPlaylist(video: Media): void {
    this.playlist.add(video);
  }

  /**
   * 从播放列表移除视频
   * @param index 索引
   */
  removeFromPlaylist(index: number): void {
    this.playlist.remove(index);
  }

  /**
   * 设置整个播放列表
   * @param videos 视频对象数组
   */
  setPlaylist(videos: Media[]): void {
    this.playlist.set(videos);
  }

  /**
   * 监听状态变化
   * @param callback 状态变化回调
   * @returns 清理函数
   */
  onStateChange(callback: (state: any) => void): () => void {
    this.stateListeners.push(callback);
    return () => {
      const index = this.stateListeners.indexOf(callback);
      if (index > -1) {
        this.stateListeners.splice(index, 1);
      }
    };
  }

  /**
   * 设置状态监听器
   */
  private _setupStateListeners(): void {
    if (this.isElectron) {
      // 监听 Electron 平台的状态变化
      const cleanupStatus = window.electronAPI.player.onStatus((status: any) => {
        this._notifyStateChange(status);
      });

      const cleanupCurrentVideo = window.electronAPI.player.onCurrentVideoChanged((video: any) => {
        this._notifyStateChange({ currentVideo: video });
      });

      const cleanupPlaylist = window.electronAPI.player.onPlaylistUpdated((playlist: any) => {
        this._notifyStateChange({ playlist });
      });

      // 存储清理函数，以便在需要时调用
      this.cleanupListeners = () => {
        cleanupStatus();
        cleanupCurrentVideo();
        cleanupPlaylist();
      };
    }
  }

  /**
   * 通知状态变化
   * @param state 状态对象
   */
  private _notifyStateChange(state: any): void {
    this.stateListeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Error in state change callback:', error);
      }
    });
  }

  /**
   * 清理监听器
   */
  private cleanupListeners?: () => void;

  /**
   * 销毁 SDK 实例
   */
  destroy(): void {
    if (this.cleanupListeners) {
      this.cleanupListeners();
    }
    this.stateListeners = [];
  }
}
