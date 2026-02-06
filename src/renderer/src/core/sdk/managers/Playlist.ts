import { Media, Playlist as PlaylistType } from '../../../types/media';

/**
 * 播放列表管理器
 * 管理视频播放列表
 */
export class Playlist {
  private playlist: PlaylistType = [];
  private currentIndex = -1;
  private isLoop = false;
  private isShuffle = false;
  private originalPlaylist: PlaylistType = [];
  private shuffleMap: number[] = [];

  /**
   * 获取当前播放列表
   */
  get(): PlaylistType {
    return this.playlist;
  }

  /**
   * 获取当前播放项
   */
  getCurrent(): Media | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.playlist.length) {
      return null;
    }
    return this.playlist[this.currentIndex];
  }

  /**
   * 按路径设置当前播放项
   */
  setCurrentByPath(path: string): void {
    const index = this.playlist.findIndex((item) => item.path === path);
    console.log('pre index', path, this.currentIndex);
    this.currentIndex = index >= 0 ? index : -1;
    console.log('current index', path, index, this.currentIndex);
  }

  /**
   * 按索引设置当前播放项
   */
  setCurrentByIndex(index: number): void {
    if (index >= 0 && index < this.playlist.length) {
      this.currentIndex = index;
    } else {
      this.currentIndex = -1;
    }
  }

  /**
   * 获取下一首（用于切换视频）
   */
  getNext(): Media | null {
    if (this.playlist.length === 0) return null;
    
    let nextIndex = this.currentIndex < 0 ? 0 : this.currentIndex + 1;
    
    if (nextIndex >= this.playlist.length) {
      if (this.isLoop) {
        nextIndex = 0;
      } else {
        return null;
      }
    }
    
    return this.playlist[nextIndex];
  }

  /**
   * 获取上一首（用于切换视频）
   */
  getPrev(): Media | null {
    if (this.playlist.length === 0) return null;
    
    let prevIndex = this.currentIndex <= 0 ? this.playlist.length - 1 : this.currentIndex - 1;
    
    return this.playlist[prevIndex];
  }

  /**
   * 添加视频到播放列表
   */
  add(video: Media): void {
    // 检查是否已存在相同路径的视频，避免重复
    const exists = this.playlist.some(item => item.path === video.path);
    if (!exists) {
      this.playlist.push(video);
      if (this.isShuffle) {
        this.originalPlaylist.push(video);
        this.updateShuffleMap();
      }
    }
  }

  /**
   * 从播放列表移除视频
   */
  remove(index: number): void {
    if (index >= 0 && index < this.playlist.length) {
      this.playlist.splice(index, 1);
      if (this.isShuffle) {
        this.originalPlaylist.splice(this.shuffleMap[index], 1);
        this.updateShuffleMap();
      }
      
      if (this.currentIndex >= this.playlist.length) {
        this.currentIndex = this.playlist.length - 1;
      } else if (index < this.currentIndex) {
        this.currentIndex -= 1;
      }
    }
  }

  /**
   * 设置整个播放列表
   */
  set(videos: Media[]): void {
    // 去重，避免重复视频
    const uniqueVideos = videos.filter((video, index, self) => 
      index === self.findIndex(v => v.path === video.path)
    );
    
    // 保存当前播放项的路径，以便后续恢复
    let currentPath: string | null = null;
    if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length) {
      currentPath = this.playlist[this.currentIndex].path;
    }
    
    this.playlist = uniqueVideos;
    this.originalPlaylist = [...uniqueVideos];
    
    // 尝试找到与之前当前播放项路径相同的视频，保持当前播放项
    let newIndex = -1;
    if (currentPath) {
      newIndex = uniqueVideos.findIndex(video => video.path === currentPath);
    }
    
    // 如果找到匹配的视频，使用其索引；否则使用默认值
    this.currentIndex = newIndex >= 0 ? newIndex : (uniqueVideos.length > 0 ? 0 : -1);
    
    if (this.isShuffle) {
      this.updateShuffleMap();
    }
  }

  /**
   * 清空播放列表
   */
  clear(): void {
    this.playlist = [];
    this.originalPlaylist = [];
    this.currentIndex = -1;
    this.shuffleMap = [];
  }

  /**
   * 切换循环模式
   */
  toggleLoop(): boolean {
    this.isLoop = !this.isLoop;
    return this.isLoop;
  }

  /**
   * 切换随机播放模式
   */
  toggleShuffle(): boolean {
    this.isShuffle = !this.isShuffle;
    
    if (this.isShuffle) {
      this.originalPlaylist = [...this.playlist];
      this.updateShuffleMap();
    } else {
      this.playlist = [...this.originalPlaylist];
      this.shuffleMap = [];
      // 尝试保持当前播放项
      const current = this.getCurrent();
      if (current) {
        this.setCurrentByPath(current.path);
      }
    }
    
    return this.isShuffle;
  }

  /**
   * 获取循环模式状态
   */
  getLoop(): boolean {
    return this.isLoop;
  }

  /**
   * 获取随机播放模式状态
   */
  getShuffle(): boolean {
    return this.isShuffle;
  }

  /**
   * 移动播放列表项
   */
  moveItem(fromIndex: number, toIndex: number): boolean {
    if (fromIndex < 0 || fromIndex >= this.playlist.length || 
        toIndex < 0 || toIndex >= this.playlist.length) {
      return false;
    }

    const [movedItem] = this.playlist.splice(fromIndex, 1);
    this.playlist.splice(toIndex, 0, movedItem);

    // 更新当前索引
    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex;
    } else if (this.currentIndex > fromIndex && this.currentIndex <= toIndex) {
      this.currentIndex--;
    } else if (this.currentIndex < fromIndex && this.currentIndex >= toIndex) {
      this.currentIndex++;
    }

    return true;
  }

  /**
   * 获取播放列表长度
   */
  get length(): number {
    return this.playlist.length;
  }

  /**
   * 更新随机播放映射
   */
  private updateShuffleMap(): void {
    this.shuffleMap = Array.from({ length: this.originalPlaylist.length }, (_, i) => i);
    
    // Fisher-Yates 洗牌算法
    for (let i = this.shuffleMap.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffleMap[i], this.shuffleMap[j]] = [this.shuffleMap[j], this.shuffleMap[i]];
    }
    
    // 应用随机排序
    this.playlist = this.shuffleMap.map(index => this.originalPlaylist[index]);
  }
}
