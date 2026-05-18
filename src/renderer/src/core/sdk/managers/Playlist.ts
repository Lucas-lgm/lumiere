import { Media, Playlist as PlaylistType } from '../../../types/media';

/**
 * Playlist manager
 * Manages video playlists
 */
export class Playlist {
  private playlist: PlaylistType = [];
  private currentIndex = -1;
  private isLoop = true;
  private isSingleLoop = false;
  private isShuffle = false;
  private originalPlaylist: PlaylistType = [];
  private shuffleMap: number[] = [];

  /**
   * Get current playlist
   */
  get(): PlaylistType {
    return this.playlist;
  }

  /**
   * Get current item
   */
  getCurrent(): Media | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.playlist.length) {
      return null;
    }
    return this.playlist[this.currentIndex];
  }

  /**
   * Set current item by path
   */
  setCurrentByPath(path: string): void {
    const index = this.playlist.findIndex((item) => item.path === path);
    this.currentIndex = index >= 0 ? index : -1;
  }

  /**
   * Set current item by index
   */
  setCurrentByIndex(index: number): void {
    if (index >= 0 && index < this.playlist.length) {
      this.currentIndex = index;
    } else {
      this.currentIndex = -1;
    }
  }

  /**
   * Get next item (for video switching)
   */
  getNext(): Media | null {
    if (this.playlist.length === 0) return null;

    // Single loop: return current item
    if (this.isSingleLoop && this.currentIndex >= 0) {
      return this.playlist[this.currentIndex];
    }

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
   * Get previous item (for video switching)
   */
  getPrev(): Media | null {
    if (this.playlist.length === 0) return null;

    // Single loop: return current item
    if (this.isSingleLoop && this.currentIndex >= 0) {
      return this.playlist[this.currentIndex];
    }

    if (this.currentIndex <= 0) {
      return this.isLoop ? this.playlist[this.playlist.length - 1] : null;
    }

    return this.playlist[this.currentIndex - 1];
  }

  /**
   * Add video to playlist
   */
  add(video: Media): boolean {
    // Check if a video with the same path already exists, avoid duplicates
    const exists = this.playlist.some(item => item.path === video.path);
    if (!exists) {
      this.playlist.push(video);
      if (this.isShuffle) {
        this.originalPlaylist.push(video);
        this.updateShuffleMap();
      }
      return true;
    }
    return false;
  }

  /**
   * Remove video from playlist
   */
  remove(index: number): void {
    if (index >= 0 && index < this.playlist.length) {
      this.playlist.splice(index, 1);
      if (this.isShuffle) {
        const origIndex = this.shuffleMap[index];
        this.shuffleMap.splice(index, 1);
        this.originalPlaylist.splice(origIndex, 1);
        // Adjust remaining shuffleMap values for removed original index
        this.shuffleMap = this.shuffleMap.map(idx => idx > origIndex ? idx - 1 : idx);
      }
      
      if (this.currentIndex >= this.playlist.length) {
        this.currentIndex = this.playlist.length - 1;
      } else if (index < this.currentIndex) {
        this.currentIndex -= 1;
      }
    }
  }

  /**
   * Set the entire playlist
   */
  set(videos: Media[]): void {
    // Deduplicate to avoid duplicate videos
    const uniqueVideos = videos.filter((video, index, self) => 
      index === self.findIndex(v => v.path === video.path)
    );
    
    // Save current item's path for later restoration
    let currentPath: string | null = null;
    if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length) {
      currentPath = this.playlist[this.currentIndex].path;
    }
    
    this.playlist = uniqueVideos;
    this.originalPlaylist = [...uniqueVideos];

    // Restore currentIndex by matching the current item's path.
    // If no match (e.g. mid-switch), keep the old index clamped to valid range
    // rather than jumping to 0 — onCurrentVideoChanged will correct it.
    if (currentPath) {
      const found = uniqueVideos.findIndex(video => video.path === currentPath);
      if (found >= 0) {
        this.currentIndex = found;
      } else {
        // Current item not in new list — clamp to valid range
        this.currentIndex = uniqueVideos.length > 0
          ? Math.min(this.currentIndex, uniqueVideos.length - 1)
          : -1;
      }
    } else {
      this.currentIndex = uniqueVideos.length > 0 ? this.currentIndex : -1;
    }
    
    if (this.isShuffle) {
      this.updateShuffleMap();
    }
  }

  /**
   * Clear playlist
   */
  clear(): void {
    this.playlist = [];
    this.originalPlaylist = [];
    this.currentIndex = -1;
    this.shuffleMap = [];
  }

  /**
   * Toggle loop mode
   */
  toggleLoop(): boolean {
    this.isLoop = !this.isLoop;
    return this.isLoop;
  }

  /**
   * Toggle shuffle mode
   */
  toggleShuffle(): boolean {
    this.isShuffle = !this.isShuffle;
    
    if (this.isShuffle) {
      this.originalPlaylist = [...this.playlist];
      this.updateShuffleMap();
    } else {
      this.playlist = [...this.originalPlaylist];
      this.shuffleMap = [];
      // Try to keep current item
      const current = this.getCurrent();
      if (current) {
        this.setCurrentByPath(current.path);
      }
    }
    
    return this.isShuffle;
  }

  /**
   * Set single loop
   */
  setSingleLoop(enabled: boolean): void {
    this.isSingleLoop = enabled;
  }

  /**
   * Get single loop state
   */
  getSingleLoop(): boolean {
    return this.isSingleLoop;
  }

  /**
   * Get loop mode state
   */
  getLoop(): boolean {
    return this.isLoop;
  }

  /**
   * Get shuffle mode state
   */
  getShuffle(): boolean {
    return this.isShuffle;
  }

  /**
   * Move playlist item
   */
  moveItem(fromIndex: number, toIndex: number): boolean {
    if (fromIndex < 0 || fromIndex >= this.playlist.length ||
        toIndex < 0 || toIndex >= this.playlist.length) {
      return false;
    }

    const [movedItem] = this.playlist.splice(fromIndex, 1);
    this.playlist.splice(toIndex, 0, movedItem);

    // Update current index
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
   * Get playlist length
   */
  get length(): number {
    return this.playlist.length;
  }

  /**
   * Update shuffle mapping
   */
  private updateShuffleMap(): void {
    this.shuffleMap = Array.from({ length: this.originalPlaylist.length }, (_, i) => i);
    
    // Fisher-Yates shuffle algorithm
    for (let i = this.shuffleMap.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffleMap[i], this.shuffleMap[j]] = [this.shuffleMap[j], this.shuffleMap[i]];
    }
    
    // Apply shuffle order
    this.playlist = this.shuffleMap.map(index => this.originalPlaylist[index]);
  }
}
