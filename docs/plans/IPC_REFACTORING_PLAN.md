# IPC 重构方案 (IPC Refactoring Plan)

## 1. 目标 (Goal)
完全移除 `window.electronAPI.send` 和 `window.electronAPI.on` 的通用暴露，将所有 IPC 通信封装为类型安全、功能明确的 API 方法，并按功能模块进行命名空间隔离。

## 2. 现状 (Current Status)

### 已完成 (Completed) ✅
- **Player API**: 已封装到 `window.electronAPI.player` 对象下
  - 控制: `playMedia`, `pause`, `resume`, `stop`, `seek`, `setVolume`, `toggleFullscreen`, `setHdr`
  - 播放列表: `playNext`, `playPrev`, `getPlaylist`, `setPlaylist`
  - 窗口: `windowAction`
  - 事件: `onStatus`, `onCurrentVideoChanged`, `onPlaylistUpdated`, `onControlBarShow`...

### 待重构 (Pending) 🚧

#### A. NAS 管理 (NAS Management)
涉及文件: `NasConfigDialog.vue`, `NasFileBrowser.vue`
- `nas-test-connection`
- `nas-add`
- `nas-remove`
- `nas-refresh`
- `get-nas-connections`
- `nas-read-directory`
- `nas-open-share`
- `nas-discover-servers`
- `nas-list-shares`

#### B. 文件系统与挂载 (File System & Mounts)
涉及文件: `MainView.vue`
- `select-video-file`
- `select-mount-path`
- `mount-path-add`
- `mount-path-remove`
- `mount-path-refresh`
- `get-mount-paths`
- `scan-directory`

#### C. 调试与系统 (Debug & System)
- `debug-hdr-status`
- `test-semantic-refactoring`

## 3. API 设计草案 (API Design Draft)

我们将继续采用命名空间模式，在 `window.electronAPI` 下新增分类的 API 对象。

### 3.1 NAS API (`window.electronAPI.nas`)
```typescript
interface NasApi {
  // 连接管理
  getConnections: () => void;
  addConnection: (data: { name: string; config: NasConfig }) => void;
  removeConnection: (id: string) => void;
  refreshConnection: (id: string) => void;
  testConnection: (data: { config: NasConfig }) => void;
  
  // 辅助功能
  openNetworkBrowser: () => void; // 原 nas-open-network-browser
  listShares: (data: NasConfig) => void; // 原 nas-list-shares
  
  // 文件浏览
  readDirectory: (data: { connectionId: string; path?: string }) => void;
  openShare: (data: { connectionId: string }) => void;
  
  // 事件订阅
  onConnectionsUpdated: (callback: (data: { connections: NasConnection[] }) => void) => () => void;
  onConnectionAdded: (callback: (data: { connection: NasConnection }) => void) => () => void;
  onConnectionScanned: (callback: (data: { id: string; resources: any[]; status?: string; error?: string }) => void) => () => void;
  
  onTestConnectionResult: (callback: (data: { success: boolean; error?: string }) => void) => () => void;
  onOpenNetworkBrowserResult: (callback: (data: { success: boolean; error?: string }) => void) => () => void;
  onListSharesResult: (callback: (data: { shares: any[]; error?: string }) => void) => () => void;
  
  onDirectoryReadResult: (callback: (data: { items: any[]; error?: string }) => void) => () => void;
  onOpenShareResult: (callback: (data: { success: boolean; error?: string }) => void) => () => void;
}
```

### 3.2 FileSystem API (`window.electronAPI.fileSystem`)
```typescript
interface FileSystemApi {
  selectVideoFile: () => void;
  selectMountPath: () => void;
  
  // 挂载点管理
  getMountPaths: () => void;
  addMountPath: (path: string) => void;
  removeMountPath: (id: string) => void;
  refreshMountPath: (id: string) => void;
  
  // 扫描
  scanDirectory: (path: string) => void;
  
  // 事件订阅
  onMountPathsUpdated: (callback: (data: { mountPaths: MountPath[] }) => void) => () => void;
  onDirectoryScanned: (callback: (result: ScanResult) => void) => () => void;
}
```

## 4. 实施计划 (Implementation Phases)

### Phase 1: NAS 模块重构 (已完成 ✅)
1. 修改 `preload.ts`: 在 `electronAPI` 下添加 `nas` 对象，封装 NAS 相关 IPC。
2. 修改 `env.d.ts`: 完善 `nas` 对象的类型定义。
3. 修改 `NasConfigDialog.vue`: 替换 `send/on` 调用为 `window.electronAPI.nas.*`。
4. 修改 `NasFileBrowser.vue`: 替换 `send/on` 调用为 `window.electronAPI.nas.*`。
5. 修改 `useNas.ts` 和 `MainView.vue`: 替换所有 NAS 相关 IPC 调用并实现事件监听器清理。

### Phase 2: 文件与挂载模块重构 (已完成 ✅)
1. 修改 `preload.ts`: 在 `electronAPI` 下添加 `fileSystem` 对象。
2. 修改 `env.d.ts`: 完善 `fileSystem` 对象的类型定义。
3. 修改 `useMountPaths.ts`: 替换所有相关 IPC 调用。
4. 修改 `MainView.vue`: 替换 `select-video-file`, `select-mount-path` 等调用，并统一事件清理。

### Phase 3: 调试与系统模块重构 (已完成 ✅)
1. 确认 `open-devtools`, `app-quit` 等功能未在渲染进程中使用。
2. 移除 `preload.ts` 中被标记为 `@deprecated` 的 `send` 和 `on` 方法。
3. 移除 `env.d.ts` 中的旧定义。

## 5. 总结 (Summary)
IPC 重构已全部完成。所有通用 IPC 调用已替换为类型安全的命名空间 API (`player`, `nas`, `fileSystem`)，并统一实现了事件监听器的清理机制。
3. 全局搜索确保无残留调用。

## 5. 验证 (Verification)
- 确保 NAS 连接添加、删除、测试功能正常。
- 确保 NAS 文件浏览功能正常。
- 确保本地文件选择和文件夹挂载功能正常。
