/// <reference types="vite/client" />

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
      toggleFullscreen: () => void
      setHdr: (enabled: boolean) => void
      windowAction: (action: 'close' | 'minimize' | 'maximize') => void

      // Playlist
      playNext: () => void
      playPrev: () => void
      getPlaylist: () => void
      setPlaylist: (items: any[]) => void

      // Events
      onCurrentVideoChanged: (callback: (data: any) => void) => () => void
      onStatus: (callback: (data: any) => void) => () => void
      onPlaylistUpdated: (callback: (data: any) => void) => () => void
      onControlBarShow: (callback: () => void) => () => void
      onControlBarScheduleHide: (callback: () => void) => () => void
      onControlBarHideImmediate: (callback: () => void) => () => void
    }

    // NAS API
    nas: {
      getConnections: () => void
      addConnection: (data: { name: string; config: any }) => void
      removeConnection: (id: string) => void
      refreshConnection: (id: string) => void
      testConnection: (data: { config: any }) => void

      openNetworkBrowser: () => void
      listShares: (data: any) => void

      readDirectory: (data: { connectionId: string; path?: string }) => void
      openShare: (data: { connectionId: string }) => void

      onConnectionsUpdated: (callback: (data: { connections: any[] }) => void) => () => void
      onConnectionAdded: (callback: (data: { connection: any; resources: any[] }) => void) => () => void
      onConnectionScanned: (callback: (data: { id: string; resources: any[]; status?: string; error?: string }) => void) => () => void
      onTestConnectionResult: (callback: (data: { success: boolean; error?: string }) => void) => () => void
      onOpenNetworkBrowserResult: (callback: (data: { success: boolean; error?: string }) => void) => () => void
      onListSharesResult: (callback: (data: { shares: any[]; error?: string }) => void) => () => void
      onDirectoryReadResult: (callback: (data: { items: any[]; error?: string }) => void) => () => void
      onOpenShareResult: (callback: (data: { success: boolean; error?: string }) => void) => () => void
    }

    // FileSystem API
    fileSystem: {
      selectVideoFile: () => void
      selectMountPath: () => void
      
      getMountPaths: () => void
      addMountPath: (path: string) => void
      removeMountPath: (id: string) => void
      refreshMountPath: (id: string) => void
      
      onVideoFileSelected: (callback: (data: { name: string; path: string }) => void) => () => void
      onMountPathAdded: (callback: (data: { mountPath: any; resources: any[] }) => void) => () => void
      onMountPathScanned: (callback: (data: { id: string; resources: any[]; resourceCount?: number }) => void) => () => void
      onMountPathsUpdated: (callback: (data: { mountPaths: any[] }) => void) => () => void
    }
  }
}

