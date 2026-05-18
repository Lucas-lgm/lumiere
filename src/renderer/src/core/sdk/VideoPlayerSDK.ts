import { ElectronPlatform } from './platforms/ElectronPlatform';
import { WebPlatform } from './platforms/WebPlatform';
import { Playlist } from './managers/Playlist';
import { PlatformAdapter } from './platforms/PlatformAdapter';
import { Media, Playlist as PlaylistType } from '../../types/media';

/**
 * Unified frontend SDK, supports Electron and Web dual platforms
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
   * Play video
   * @param video Video object
   * @param options Playback options
   */
  async play(video: Media, options?: {
    transcode?: boolean;
    transcodeConfig?: any;
  }): Promise<void> {
    return this.platform.play(video, options);
  }

  /**
   * Pause
   */
  async pause(): Promise<void> {
    return this.platform.pause();
  }

  /**
   * Resume
   */
  async resume(): Promise<void> {
    return this.platform.resume();
  }

  /**
   * Stop
   */
  async stop(): Promise<void> {
    return this.platform.stop();
  }

  /**
   * Seek to specified time
   * @param time Time (seconds)
   */
  async seek(time: number): Promise<void> {
    return this.platform.seek(time);
  }

  /**
   * Set volume
   * @param volume Volume (0-100)
   */
  async setVolume(volume: number): Promise<void> {
    return this.platform.setVolume(volume);
  }

  /**
   * Toggle fullscreen
   */
  async toggleFullscreen(): Promise<void> {
    return this.platform.toggleFullscreen();
  }

  /**
   * Quit player completely
   */
  async quit(): Promise<void> {
    return this.platform.quit();
  }

  /**
   * Get the track list of current media (audio / subtitle / video)
   */
  async getTracks(): Promise<any[]> {
    return this.platform.getTracks();
  }

  /**
   * Switch audio track
   */
  async setAudioTrack(trackId: number | null): Promise<void> {
    return this.platform.setAudioTrack(trackId);
  }

  /**
   * Switch subtitle track
   */
  async setSubtitleTrack(trackId: number | null): Promise<void> {
    return this.platform.setSubtitleTrack(trackId);
  }

  /**
   * Get current playlist
   */
  getPlaylist(): PlaylistType {
    return this.playlist.get();
  }

  /**
   * Get current playing item from playlist
   */
  getCurrentFromPlaylist(): Media | null {
    return this.playlist.getCurrent();
  }

  /**
   * Set current playlist item by path (call after play/switch for correct next/prev)
   */
  setPlaylistCurrentByPath(path: string): void {
    this.playlist.setCurrentByPath(path);
  }

  /**
   * Set current playlist item by index
   */
  setPlaylistCurrentByIndex(index: number): void {
    this.playlist.setCurrentByIndex(index);
  }

  /**
   * Get next item from playlist, call play(next) after switching video
   */
  getNextFromPlaylist(): Media | null {
    return this.playlist.getNext();
  }

  /**
   * Get previous item from playlist, call play(prev) after switching video
   */
  getPrevFromPlaylist(): Media | null {
    return this.playlist.getPrev();
  }

  /**
   * Add video to playlist
   * @param video Video object
   */
  addToPlaylist(video: Media): void {
    this.playlist.add(video);
    this.syncPlaylistToMain();
  }

  /**
   * Remove video from playlist
   * @param index Index
   */
  removeFromPlaylist(index: number): void {
    this.playlist.remove(index);
    this.syncPlaylistToMain();
  }

  /**
   * Set the entire playlist
   * @param videos Array of video objects
   */
  setPlaylist(videos: Media[]): void {
    this.playlist.set(videos);
    this.syncPlaylistToMain();
  }

  /**
   * Clear playlist
   */
  clearPlaylist(): void {
    this.playlist.clear();
    this.syncPlaylistToMain();
  }

  /** Sync local playlist to main process for cross-renderer broadcast. */
  private syncPlaylistToMain(): void {
    if (this.isElectron) {
      window.electronAPI.player.setPlaylist(this.playlist.get());
    }
  }

  /**
   * Toggle loop mode
   * @returns Current loop mode state
   */
  toggleLoop(): boolean {
    return this.playlist.toggleLoop();
  }

  /**
   * Toggle shuffle mode
   * @returns Current shuffle mode state
   */
  toggleShuffle(): boolean {
    return this.playlist.toggleShuffle();
  }

  /**
   * Set single loop
   */
  setSingleLoop(enabled: boolean): void {
    this.playlist.setSingleLoop(enabled);
  }

  /**
   * Get single loop state
   */
  getSingleLoop(): boolean {
    return this.playlist.getSingleLoop();
  }

  /**
   * Get loop mode state
   * @returns Loop mode state
   */
  getLoop(): boolean {
    return this.playlist.getLoop();
  }

  /**
   * Get shuffle mode state
   * @returns Shuffle mode state
   */
  getShuffle(): boolean {
    return this.playlist.getShuffle();
  }

  /**
   * Move playlist item
   * @param fromIndex Source index
   * @param toIndex Target index
   * @returns Whether the move was successful
   */
  movePlaylistItem(fromIndex: number, toIndex: number): boolean {
    const success = this.playlist.moveItem(fromIndex, toIndex);
    if (success) this.syncPlaylistToMain();
    return success;
  }

  /**
   * Get playlist length
   * @returns Playlist length
   */
  getPlaylistLength(): number {
    return this.playlist.length;
  }

  /**
   * Listen for state changes
   * @param callback State change callback
   * @returns Cleanup function
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
   * Set up state listeners
   */
  private _setupStateListeners(): void {
    if (this.isElectron) {
      // Listen for Electron platform state changes
      const cleanupStatus = window.electronAPI.player.onStatus((status: any) => {
        this._notifyStateChange(status);
      });

      const cleanupCurrentVideo = window.electronAPI.player.onCurrentVideoChanged((video: any) => {
        // Sync currentIndex — MainView and ControlView are in different renderer processes,
        // each holds its own SDK instance. When the main process broadcasts a current video change,
        // currentIndex must be synced in this process's playlist,
        // otherwise getNext/getPrev will return incorrect results based on stale currentIndex.
        if (video && video.path) {
          this.playlist.setCurrentByPath(video.path);
        }
        this._notifyStateChange({ currentVideo: video });
      });

      // Cross-renderer playlist sync — main process relays playlist
      // data between MainView and ControlView renderer contexts.
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

      this.cleanupListeners = () => {
        cleanupStatus();
        cleanupCurrentVideo();
        cleanupPlaylist();
      };
    }
  }

  /**
   * Initialize SDK — pull current playlist from main process data service.
   */
  async init(): Promise<void> {
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
   * Notify state change
   * @param state State object
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
   * Clean up listeners
   */
  private cleanupListeners?: () => void;

  /**
   * Destroy SDK instance
   */
  destroy(): void {
    if (this.cleanupListeners) {
      this.cleanupListeners();
    }
    this.stateListeners = [];
  }
}
