import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Player API (Namespace)
  player: {
    playMedia: (file: { name: string; path: string; startTime?: number }) => ipcRenderer.send('player:play-media', file),
    pause: () => ipcRenderer.send('player:pause'),
    resume: () => ipcRenderer.send('player:resume'),
    stop: () => ipcRenderer.send('player:stop'),
    seek: (time: number) => ipcRenderer.send('player:seek', time),
    setVolume: (volume: number) => ipcRenderer.send('player:set-volume', volume),
    setHdr: (enabled: boolean) => ipcRenderer.send('player:set-hdr', enabled),
    getTracks: () => ipcRenderer.invoke('player:get-tracks'),
    setAudioTrack: (trackId: number | null) => ipcRenderer.send('player:set-audio-track', trackId),
    setSubtitleTrack: (trackId: number | null) => ipcRenderer.send('player:set-subtitle-track', trackId),

    // Playlist data service
    getPlaylist: () => {
      return new Promise<any[]>((resolve) => {
        const listener = (_: any, data: any[]) => {
          ipcRenderer.removeListener('playlist:updated', listener)
          resolve(data)
        }
        ipcRenderer.on('playlist:updated', listener)
        ipcRenderer.send('playlist:get')
      })
    },
    setPlaylist: (items: any[]) => ipcRenderer.send('playlist:set', items),

    // Quit video player
    quit: () => ipcRenderer.send('player:quit'),

    // Events
    onCurrentVideoChanged: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('player:current-changed', subscription)
      return () => ipcRenderer.removeListener('player:current-changed', subscription)
    },
    onStatus: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('player:status', subscription)
      return () => ipcRenderer.removeListener('player:status', subscription)
    },
    onPlaylistUpdated: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('playlist:updated', subscription)
      return () => ipcRenderer.removeListener('playlist:updated', subscription)
    },
    onTracksChanged: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('player:tracks-changed', subscription)
      return () => ipcRenderer.removeListener('player:tracks-changed', subscription)
    },
    onError: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('player:error', subscription)
      return () => ipcRenderer.removeListener('player:error', subscription)
    },
    onControlBarShow: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on('player:control-bar-show', subscription)
      return () => ipcRenderer.removeListener('player:control-bar-show', subscription)
    },
    onControlBarScheduleHide: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on('player:control-bar-schedule-hide', subscription)
      return () => ipcRenderer.removeListener('player:control-bar-schedule-hide', subscription)
    },
    onControlBarHideImmediate: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on('player:control-bar-hide-immediate', subscription)
      return () => ipcRenderer.removeListener('player:control-bar-hide-immediate', subscription)
    },
    onPropertyChange: (callback: (data: { name: string; value: any }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('player:property-change', subscription)
      return () => ipcRenderer.removeListener('player:property-change', subscription)
    },
    onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
      const subscription = (_: any, value: boolean) => callback(value)
      ipcRenderer.on('window:fullscreen-changed', subscription)
      return () => ipcRenderer.removeListener('window:fullscreen-changed', subscription)
    },
    onMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
      const subscription = (_: any, value: boolean) => callback(value)
      ipcRenderer.on('window:maximized-changed', subscription)
      return () => ipcRenderer.removeListener('window:maximized-changed', subscription)
    }
  },

  // Main window (library) operations — namespaced separately from playback window window.*
  mainWindow: {
    action: (action: 'close' | 'minimize' | 'maximize') => ipcRenderer.send('main-window:action', action),
  },

  // Window API
  window: {
    toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
    togglePip: () => ipcRenderer.invoke('window:toggle-pip') as Promise<boolean>,
    pipClose: () => ipcRenderer.invoke('window:pip-close'),
    pipReturn: () => ipcRenderer.invoke('window:pip-return'),
    togglePipSize: () => ipcRenderer.invoke('window:pip-toggle-size'),
    action: (action: 'close' | 'minimize' | 'maximize') => ipcRenderer.send('window:action', action),
    fitToVideo: (videoWidth: number, videoHeight: number) => ipcRenderer.invoke('window:fit-to-video', videoWidth, videoHeight),
    setAspectLock: (ratio: number) => ipcRenderer.invoke('window:set-aspect-lock', ratio),
  },

  // Player Property API (Phase 3 Stage 2 — generic mpv property read/write)
  playerProperty: {
    get: (property: string) => ipcRenderer.invoke('player:get-property', property),
    set: (property: string, value: any) => ipcRenderer.invoke('player:set-property', property, value),
    getMediaInfo: () => ipcRenderer.invoke('player:get-media-info'),
    command: (...args: string[]) => ipcRenderer.invoke('player:command', ...args),
  },

  // Animation export API
  animExport: {
    start: (config: any) => ipcRenderer.invoke('anim:start', config),
    cancel: () => ipcRenderer.invoke('anim:cancel'),
    selectOutput: () => ipcRenderer.invoke('anim:select-output') as Promise<string | null>,
    onProgress: (callback: (data: any) => void) => {
      const sub = (_: any, data: any) => callback(data)
      ipcRenderer.on('anim:progress', sub)
      return () => ipcRenderer.removeListener('anim:progress', sub)
    },
    onComplete: (callback: (data: any) => void) => {
      const sub = (_: any, data: any) => callback(data)
      ipcRenderer.on('anim:complete', sub)
      return () => ipcRenderer.removeListener('anim:complete', sub)
    },
    onError: (callback: (data: any) => void) => {
      const sub = (_: any, data: any) => callback(data)
      ipcRenderer.on('anim:error', sub)
      return () => ipcRenderer.removeListener('anim:error', sub)
    },
  },

  // WatchProgress API
  watchProgress: {
    get: (mediaPath: string) => ipcRenderer.invoke('progress:get', mediaPath),
    getAll: () => ipcRenderer.invoke('progress:get-all'),
    getContinueWatching: () => ipcRenderer.invoke('progress:get-continue-watching'),
    clear: (mediaPath: string) => ipcRenderer.invoke('progress:clear', mediaPath),
    onUpdated: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('progress:updated', subscription)
      return () => ipcRenderer.removeListener('progress:updated', subscription)
    },
  },

  // Thumbnail API
  thumbnail: {
    get: (filePath: string) => ipcRenderer.invoke('thumbnail:get', filePath),
    generateBatch: (filePaths: string[]) => ipcRenderer.invoke('thumbnail:generate-batch', filePaths),
    generateStrip: (filePath: string, duration: number) =>
      ipcRenderer.invoke('thumbnail:generate-strip', filePath, duration),
    onReady: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('thumbnail:ready', subscription)
      return () => ipcRenderer.removeListener('thumbnail:ready', subscription)
    },
    // Seekbar thumbnail preview (dynamically generated on demand)
    seekInit: (filePath: string) => ipcRenderer.invoke('thumbnail:seek-init', filePath),
    seekAt: (filePath: string, time: number) => ipcRenderer.invoke('thumbnail:seek-at', filePath, time),
    seekDestroy: () => ipcRenderer.invoke('thumbnail:seek-destroy'),
  },

  // Theme API
  theme: {
    get: () => ipcRenderer.invoke('theme:get') as Promise<{ preference: string; resolved: string }>,
    set: (pref: string) => ipcRenderer.invoke('theme:set', pref),
    onChange: (callback: (data: { preference: string; resolved: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('theme:changed', subscription)
      return () => ipcRenderer.removeListener('theme:changed', subscription)
    },
  },

  // Settings API
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    reset: () => ipcRenderer.invoke('settings:reset'),
    openLogDir: () => ipcRenderer.invoke('log:open-dir'),
    onLanguageChanged: (callback: (language: string) => void) => {
      ipcRenderer.on('language:changed', (_event, language) => callback(language))
    },
  },

  // FileSystem API
  fileSystem: {
    // Actions
    selectVideoFile: () => ipcRenderer.send('file:select-video'),
    selectMountPath: () => ipcRenderer.send('file:select-folder'),

    // Reveal in Finder
    showInFinder: (filePath: string) => ipcRenderer.invoke('file:show-in-finder', filePath),

    // Directory Scan
    scanFolder: (path: string) => ipcRenderer.send('file:scan-directory', { path }),

    // Directory Selection (returns path)
    selectFolder: () => ipcRenderer.invoke('file:select-directory') as Promise<string | null>,

    // Mount Path Management
    getMountPaths: () => ipcRenderer.send('file:get-mounts'),
    addMountPath: (path: string) => ipcRenderer.send('file:mount-add', { path }),
    removeMountPath: (id: string) => ipcRenderer.send('file:mount-remove', { id }),
    refreshMountPath: (id: string) => ipcRenderer.send('file:mount-refresh', { id }),

    // Events
    onVideoFileSelected: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('file:video-selected', subscription)
      return () => ipcRenderer.removeListener('file:video-selected', subscription)
    },
    onMountPathAdded: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('file:mount-added', subscription)
      return () => ipcRenderer.removeListener('file:mount-added', subscription)
    },
    onMountPathScanned: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('file:mount-scanned', subscription)
      return () => ipcRenderer.removeListener('file:mount-scanned', subscription)
    },
    onMountPathsUpdated: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('file:mounts-updated', subscription)
      return () => ipcRenderer.removeListener('file:mounts-updated', subscription)
    }
  },

  // Transcription API (AI subtitles)
  transcription: {
    start: (mediaPath: string, options: { model: string; language: string }) =>
      ipcRenderer.invoke('transcription:start', mediaPath, options),
    cancel: (mediaPath: string) =>
      ipcRenderer.invoke('transcription:cancel', mediaPath),
    getStatus: (mediaPath: string) =>
      ipcRenderer.invoke('transcription:status', mediaPath),
    checkSrt: (mediaPath: string) =>
      ipcRenderer.invoke('transcription:check-srt', mediaPath),
    checkAvailability: () =>
      ipcRenderer.invoke('transcription:check-availability'),
    listModels: () =>
      ipcRenderer.invoke('transcription:list-models'),
    downloadModel: (model: string) =>
      ipcRenderer.invoke('transcription:download-model', model),
    deleteModel: (model: string) =>
      ipcRenderer.invoke('transcription:delete-model', model),

    // Events
    onProgress: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('transcription:progress', subscription)
      return () => ipcRenderer.removeListener('transcription:progress', subscription)
    },
    onComplete: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('transcription:complete', subscription)
      return () => ipcRenderer.removeListener('transcription:complete', subscription)
    },
    onError: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('transcription:error', subscription)
      return () => ipcRenderer.removeListener('transcription:error', subscription)
    },
    onModelDownloadProgress: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('transcription:model-download-progress', subscription)
      return () => ipcRenderer.removeListener('transcription:model-download-progress', subscription)
    },
  },

  // Menu API (macOS menu bar events)
  menu: {
    onNavigate: (callback: (target: string) => void) => {
      const subscription = (_: any, target: string) => callback(target)
      ipcRenderer.on('menu:navigate', subscription)
      return () => ipcRenderer.removeListener('menu:navigate', subscription)
    },
    onToggleSidebar: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on('menu:toggle-sidebar', subscription)
      return () => ipcRenderer.removeListener('menu:toggle-sidebar', subscription)
    }
  }
})
