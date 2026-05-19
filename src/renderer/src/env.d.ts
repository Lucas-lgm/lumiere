/// <reference types="vite/client" />

import type {
  PlayerStatus,
  TrackInfo,
  WatchProgress,
  MediaInfo,
  ThumbnailReady,
  BackendSettings,
  ThemeState,
  MountPathScanned,
  EqualizerState
} from '../../shared/types/ipc'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI: {
    platform: string

    // Player API
    player: {
      playMedia: (file: { name: string; path: string; startTime?: number }) => void
      pause: () => void
      resume: () => void
      stop: () => void
      seek: (time: number) => void
      setVolume: (volume: number) => void
      setHdr: (enabled: boolean) => void

      // Tracks
      getTracks: () => Promise<TrackInfo[]>
      setAudioTrack: (trackId: number | null) => void
      setSubtitleTrack: (trackId: number | null) => void

      // Playlist data service
      getPlaylist: () => Promise<any[]>
      setPlaylist: (items: any[]) => void

      // Quit video player
      quit: () => void

      // Events
      onCurrentVideoChanged: (callback: (data: { name: string; path: string }) => void) => () => void
      onPlaylistUpdated: (callback: (data: any[]) => void) => () => void
      onStatus: (callback: (data: PlayerStatus) => void) => () => void
      onControlBarShow: (callback: () => void) => () => void
      onControlBarScheduleHide: (callback: () => void) => () => void
      onControlBarHideImmediate: (callback: () => void) => () => void
      onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => () => void
      onMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void
      onTracksChanged: (callback: (data: TrackInfo[]) => void) => () => void
      onError: (callback: (data: { message: string; code?: string }) => void) => () => void
    }

    // Main window operations
    mainWindow: {
      action: (action: 'close' | 'minimize' | 'maximize') => void
    }

    // Window API
    window: {
      toggleFullscreen: () => void
      togglePip: () => Promise<boolean>
      pipClose: () => Promise<void>
      pipReturn: () => Promise<void>
      togglePipSize: () => Promise<void>
      action: (action: 'close' | 'minimize' | 'maximize') => void
      fitToVideo: (videoWidth: number, videoHeight: number) => Promise<void>
      setAspectLock: (ratio: number) => Promise<void>
    }

    // Player Property API (P3 Phase 2)
    playerProperty: {
      get: (property: string) => Promise<any>
      set: (property: string, value: any) => Promise<void>
      command: (...args: string[]) => Promise<void>
      getMediaInfo: () => Promise<MediaInfo | null>
    }

    // Equalizer API
    equalizer: {
      getState: () => Promise<EqualizerState>
      saveState: (state: { enabled: boolean; bands: number[]; currentPreset: string }) => Promise<void>
      savePreset: (name: string, bands: number[]) => Promise<void>
      deletePreset: (name: string) => Promise<void>
    }

    // WatchProgress API (P3 Phase 1)
    watchProgress: {
      get: (mediaPath: string) => Promise<WatchProgress | null>
      getAll: () => Promise<WatchProgress[]>
      getContinueWatching: () => Promise<WatchProgress[]>
      clear: (mediaPath: string) => Promise<void>
      onUpdated: (callback: (data: WatchProgress) => void) => () => void
    }

    // Thumbnail API (P3 Phase 1)
    thumbnail: {
      get: (filePath: string) => Promise<string | null>
      generateBatch: (filePaths: string[]) => Promise<void>
      onReady: (callback: (data: ThumbnailReady) => void) => () => void
      generateStrip: (filePath: string, duration: number) => Promise<{ outputPath: string; count: number; thumbWidth: number; thumbHeight: number }>
      // Progress bar seek preview (dynamically generated on demand)
      seekInit: (filePath: string) => Promise<boolean>
      seekAt: (filePath: string, time: number) => Promise<string | null>
      seekDestroy: () => Promise<void>
    }

    // Settings API
    settings: {
      get: () => Promise<BackendSettings>
      set: (key: string, value: any) => Promise<void>
      reset: () => Promise<BackendSettings>
      openLogDir: () => Promise<void>
      onLanguageChanged: (callback: (language: string) => void) => void
    }

    // Theme API
    theme: {
      get: () => Promise<ThemeState>
      set: (pref: 'system' | 'light' | 'dark') => Promise<void>
      onChange: (callback: (data: ThemeState) => void) => () => void
    }

    // FileSystem API
    fileSystem: {
      selectVideoFile: () => void
      selectMountPath: () => void
      showInFinder: (filePath: string) => Promise<void>

      // Directory Scan
      scanFolder: (path: string) => void
      selectFolder: () => Promise<string | null>

      getMountPaths: () => void
      addMountPath: (path: string) => void
      removeMountPath: (id: string) => void
      refreshMountPath: (id: string) => void

      onVideoFileSelected: (callback: (data: { name: string; path: string }) => void) => () => void
      onMountPathAdded: (callback: (data: { mountPath: any; resources: any[] }) => void) => () => void
      onMountPathScanned: (callback: (data: MountPathScanned) => void) => () => void
      onMountPathsUpdated: (callback: (data: { mountPaths: any[] }) => void) => () => void
    }

    // Menu API
    menu: {
      onNavigate: (callback: (target: string) => void) => () => void
      onToggleSidebar: (callback: () => void) => () => void
    }
  }
}
