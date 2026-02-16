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
   * 获取当前媒体的轨道列表（音轨 / 字幕 / 视频）
   */
  async getTracks(): Promise<any[]> {
    return this.platform.getTracks();
  }

  /**
   * 切换音轨
   */
  async setAudioTrack(trackId: number | null): Promise<void> {
    return this.platform.setAudioTrack(trackId);
  }

  /**
   * 切换字幕轨
   */
  async setSubtitleTrack(trackId: number | null): Promise<void> {
    return this.platform.setSubtitleTrack(trackId);
  }

  /**
   * 获取当前播放列表
   */
  getPlaylist(): PlaylistType {
    return this.playlist.get();
  }

  /**
   * 获取当前播放项（前端列表中的当前项）
   */
  getCurrentFromPlaylist(): Media | null {
    return this.playlist.getCurrent();
  }

  /**
   * 按路径设置当前播放项（播放/切换后调用以便下一首/上一首正确）
   */
  setPlaylistCurrentByPath(path: string): void {
    this.playlist.setCurrentByPath(path);
  }

  /**
   * 按索引设置当前播放项
   */
  setPlaylistCurrentByIndex(index: number): void {
    this.playlist.setCurrentByIndex(index);
  }

  /**
   * 获取下一首，用于切换视频后调用 play(next)
   */
  getNextFromPlaylist(): Media | null {
    return this.playlist.getNext();
  }

  /**
   * 获取上一首，用于切换视频后调用 play(prev)
   */
  getPrevFromPlaylist(): Media | null {
    return this.playlist.getPrev();
  }

  /**
   * 添加视频到播放列表
   * @param video 视频对象
   */
  addToPlaylist(video: Media): void {
    this.playlist.add(video);
    // 同步到主进程，确保跨窗口一致
    if (this.isElectron) {
      window.electronAPI.player.setPlaylist(this.playlist.get());
    }
  }

  /**
   * 从播放列表移除视频
   * @param index 索引
   */
  removeFromPlaylist(index: number): void {
    this.playlist.remove(index);
    // 同步到主进程，确保跨窗口一致
    if (this.isElectron) {
      window.electronAPI.player.setPlaylist(this.playlist.get());
    }
  }

  /**
   * 设置整个播放列表
   * @param videos 视频对象数组
   */
  setPlaylist(videos: Media[]): void {
    this.playlist.set(videos);
    // 同步到主进程，确保跨窗口一致
    if (this.isElectron) {
      window.electronAPI.player.setPlaylist(videos);
    }
  }

  /**
   * 清空播放列表
   */
  clearPlaylist(): void {
    this.playlist.clear();
    // 同步到主进程，确保跨窗口一致
    if (this.isElectron) {
      window.electronAPI.player.setPlaylist([]);
    }
  }

  /**
   * 同步播放列表到主进程
   */
  syncPlaylistToMain(): void {
    if (this.isElectron) {
      window.electronAPI.player.setPlaylist(this.playlist.get());
    }
  }

  /**
   * 切换循环模式
   * @returns 当前循环模式状态
   */
  toggleLoop(): boolean {
    return this.playlist.toggleLoop();
  }

  /**
   * 切换随机播放模式
   * @returns 当前随机播放模式状态
   */
  toggleShuffle(): boolean {
    return this.playlist.toggleShuffle();
  }

  /**
   * 获取循环模式状态
   * @returns 循环模式状态
   */
  getLoop(): boolean {
    return this.playlist.getLoop();
  }

  /**
   * 获取随机播放模式状态
   * @returns 随机播放模式状态
   */
  getShuffle(): boolean {
    return this.playlist.getShuffle();
  }

  /**
   * 移动播放列表项
   * @param fromIndex 源索引
   * @param toIndex 目标索引
   * @returns 是否移动成功
   */
  movePlaylistItem(fromIndex: number, toIndex: number): boolean {
    const success = this.playlist.moveItem(fromIndex, toIndex);
    // 同步到主进程，确保跨窗口一致
    if (success && this.isElectron) {
      window.electronAPI.player.setPlaylist(this.playlist.get());
    }
    return success;
  }

  /**
   * 获取播放列表长度
   * @returns 播放列表长度
   */
  getPlaylistLength(): number {
    return this.playlist.length;
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

      // 监听主进程的播放列表更新，确保跨窗口同步
      const cleanupPlaylist = window.electronAPI.player.onPlaylistUpdated((items: any[]) => {
        if (items && items.length > 0) {
          const mediaItems = items.map((item: any) => ({
            name: item.name,
            path: item.path,
            startTime: item.startTime
          }));
          this.playlist.set(mediaItems);
          this._notifyStateChange({ playlist: mediaItems });
        } else {
          this.playlist.clear();
          this._notifyStateChange({ playlist: [] });
        }
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
   * 初始化 SDK
   */
  async init(): Promise<void> {
    // 初始化时从主进程获取播放列表状态
    if (this.isElectron) {
      try {
        const items = await window.electronAPI.player.getPlaylist();
        if (items && items.length > 0) {
          const mediaItems = items.map((item: any) => ({
            name: item.name,
            path: item.path,
            startTime: item.startTime
          }));
          this.playlist.set(mediaItems);
          this._notifyStateChange({ playlist: mediaItems });
        }
      } catch (error) {
        console.error('Error initializing playlist:', error);
      }
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
