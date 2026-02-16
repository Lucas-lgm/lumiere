import { contextBridge, ipcRenderer } from 'electron'

// 暴露受保护的方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  
  // Player API (Namespace)
  player: {
    playMedia: (file: { name: string; path: string; startTime?: number }) => ipcRenderer.send('play-video', file),
    pause: () => ipcRenderer.send('control-pause'),
    resume: () => ipcRenderer.send('control-play'),
    stop: () => ipcRenderer.send('control-stop'),
    seek: (time: number) => ipcRenderer.send('control-seek', time),
    setVolume: (volume: number) => ipcRenderer.send('control-volume', volume),
    toggleFullscreen: () => ipcRenderer.send('control-toggle-fullscreen'),
    setHdr: (enabled: boolean) => ipcRenderer.send('control-hdr', enabled),
    windowAction: (action: 'close' | 'minimize' | 'maximize') => ipcRenderer.send('control-window-action', action),
    getTracks: () => ipcRenderer.invoke('control-get-tracks'),
    setAudioTrack: (trackId: number | null) => ipcRenderer.send('control-set-audio-track', trackId),
    setSubtitleTrack: (trackId: number | null) => ipcRenderer.send('control-set-subtitle-track', trackId),

    // Playlist
    getPlaylist: () => {
      return new Promise<any[]>((resolve) => {
        const listener = (_: any, data: any[]) => {
          ipcRenderer.removeListener('playlist-updated', listener);
          resolve(data);
        };
        ipcRenderer.on('playlist-updated', listener);
        ipcRenderer.send('get-playlist');
      });
    },
    setPlaylist: (items: any[]) => ipcRenderer.send('set-playlist', items),

    // 退出视频播放器
    quit: () => ipcRenderer.send('control-quit'),


    // Events
    onCurrentVideoChanged: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('current-video-changed', subscription)
      return () => ipcRenderer.removeListener('current-video-changed', subscription)
    },
    onStatus: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('player-status', subscription)
      return () => ipcRenderer.removeListener('player-status', subscription)
    },
    onPlaylistUpdated: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('playlist-updated', subscription)
      return () => ipcRenderer.removeListener('playlist-updated', subscription)
    },
    onTracksChanged: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('tracks-changed', subscription)
      return () => ipcRenderer.removeListener('tracks-changed', subscription)
    },
    onControlBarShow: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on('control-bar-show', subscription)
      return () => ipcRenderer.removeListener('control-bar-show', subscription)
    },
    onControlBarScheduleHide: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on('control-bar-schedule-hide', subscription)
      return () => ipcRenderer.removeListener('control-bar-schedule-hide', subscription)
    },
    onControlBarHideImmediate: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on('control-bar-hide-immediate', subscription)
      return () => ipcRenderer.removeListener('control-bar-hide-immediate', subscription)
    }
  },

  // NAS API
  nas: {
    // Connection Management
    getConnections: () => ipcRenderer.send('get-nas-connections'),
    addConnection: (data: any) => ipcRenderer.send('nas-add', data),
    removeConnection: (id: string) => ipcRenderer.send('nas-remove', { id }),
    refreshConnection: (id: string) => ipcRenderer.send('nas-refresh', { id }),
    testConnection: (data: any) => ipcRenderer.send('nas-test-connection', data),

    // Discovery & Helpers
    openNetworkBrowser: () => ipcRenderer.send('nas-open-network-browser'),
    listShares: (data: any) => ipcRenderer.send('nas-list-shares', data),

    // File Browsing
    readDirectory: (data: any) => ipcRenderer.send('nas-read-directory', data),
    openShare: (data: any) => ipcRenderer.send('nas-open-share', data),

    // Events
    onConnectionsUpdated: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('nas-connections-updated', subscription)
      return () => ipcRenderer.removeListener('nas-connections-updated', subscription)
    },
    onConnectionAdded: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('nas-connection-added', subscription)
      return () => ipcRenderer.removeListener('nas-connection-added', subscription)
    },
    onConnectionScanned: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('nas-connection-scanned', subscription)
      return () => ipcRenderer.removeListener('nas-connection-scanned', subscription)
    },
    onTestConnectionResult: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('nas-test-connection-result', subscription)
      return () => ipcRenderer.removeListener('nas-test-connection-result', subscription)
    },
    onOpenNetworkBrowserResult: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('nas-open-network-browser-result', subscription)
      return () => ipcRenderer.removeListener('nas-open-network-browser-result', subscription)
    },
    onListSharesResult: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('nas-list-shares-result', subscription)
      return () => ipcRenderer.removeListener('nas-list-shares-result', subscription)
    },
    onDirectoryReadResult: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('nas-directory-read-result', subscription)
      return () => ipcRenderer.removeListener('nas-directory-read-result', subscription)
    },
    onOpenShareResult: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('nas-open-share-result', subscription)
      return () => ipcRenderer.removeListener('nas-open-share-result', subscription)
    }
  },

  // FileSystem API
  fileSystem: {
    // Actions
    selectVideoFile: () => ipcRenderer.send('select-video-file'),
    selectMountPath: () => ipcRenderer.send('select-mount-path'),
    
    // Mount Path Management
    getMountPaths: () => ipcRenderer.send('get-mount-paths'),
    addMountPath: (path: string) => ipcRenderer.send('mount-path-add', { path }),
    removeMountPath: (id: string) => ipcRenderer.send('mount-path-remove', { id }),
    refreshMountPath: (id: string) => ipcRenderer.send('mount-path-refresh', { id }),
    
    // Events
    onVideoFileSelected: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('video-file-selected', subscription)
      return () => ipcRenderer.removeListener('video-file-selected', subscription)
    },
    onMountPathAdded: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('mount-path-added', subscription)
      return () => ipcRenderer.removeListener('mount-path-added', subscription)
    },
    onMountPathScanned: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('mount-path-scanned', subscription)
      return () => ipcRenderer.removeListener('mount-path-scanned', subscription)
    },
    onMountPathsUpdated: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('mount-paths-updated', subscription)
      return () => ipcRenderer.removeListener('mount-paths-updated', subscription)
    }
  }
})
