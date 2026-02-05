# 前端 API 参考手册

> **最后更新**: 2026-02-05  
> **状态**: 待执行

## 🎯 统一前端 SDK 设计

为了支持 Electron 和 Web 双平台，设计了一套统一的前端 SDK，提供一致的 API 接口和功能体验。

### 1. SDK API概览

```typescript
// 统一前端 SDK 架构
class VideoPlayerSDK {
  constructor() {
    this.isElectron = !!window.electron;
    this.playlist = new Playlist();
    this.apiBaseUrl = 'https://api.example.com';
  }

  // 核心方法
  async play(video, options) { /* 播放视频，options 可包含转码配置 */ }
  async pause() { /* 暂停播放 */ }
  async resume() { /* 恢复播放 */ }
  async stop() { /* 停止播放 */ }
  async seek(time) { /* 跳转到指定时间 */ }
  async setVolume(volume) { /* 设置音量 */ }
  async toggleFullscreen() { /* 切换全屏 */ }
  async quit() { /* 彻底退出播放器 */ }

  // 播放列表方法
  async getPlaylist() { return this.playlist.get(); }
  async addToPlaylist(video) { return this.playlist.add(video); }
  async removeFromPlaylist(index) { return this.playlist.remove(index); }
  async setPlaylist(videos) { return this.playlist.set(videos); }

  
  // 内部视频服务方法（私有）
  #videoService = new VideoService(); // 合并转码和元数据管理
  
  // 内部方法（不对外暴露）
  async #requestTranscode(videoUrl, config) { return this.#videoService.requestTranscode(videoUrl, config); }
  async #getTranscodeStatus(taskId) { return this.#videoService.getTranscodeStatus(taskId); }
  async #cancelTranscode(taskId) { return this.#videoService.cancelTranscode(taskId); }
  #onTranscodeStatus(callback) { return this.#videoService.onTranscodeStatus(callback); }
  async #getVideoMetadata(videoUrl) { return this.#videoService.getVideoMetadata(videoUrl); }
  
  // 状态管理
  onStateChange(callback) { /* 监听状态变化 */ }
}
```

### 2. 环境检测与适配

SDK 会自动检测当前运行环境，并适配相应的功能。

### 3. 核心模块

#### 3.1 播放列表管理

```typescript
// 播放列表管理示例
const sdk = new VideoPlayerSDK();

// 添加视频到播放列表
await sdk.addToPlaylist({
  id: 'video-1',
  name: 'example.mp4',
  path: '/path/to/example.mp4',
  duration: 60
});

// 获取当前播放列表
const playlist = await sdk.getPlaylist();

// 从播放列表移除
await sdk.removeFromPlaylist(0);

// 设置整个播放列表
await sdk.setPlaylist([
  {
    id: 'video-1',
    name: 'example1.mp4',
    path: 'https://your-server.com/videos/example1.mp4',
    duration: 60
  },
  {
    id: 'video-2',
    name: 'example2.mp4',
    path: 'https://your-server.com/videos/example2.mp4',
    duration: 90
  }
]);

```

#### 3.4 播放控制

```typescript
// 播放控制示例
const sdk = new VideoPlayerSDK();

// 先添加到播放列表（视频资源在服务端）
const video = {
  id: 'video-1',
  name: 'example.mp4',
  path: 'https://your-server.com/videos/example.mp4',
  duration: 60
};
await sdk.addToPlaylist(video);

// 然后播放（从播放列表中播放）
await sdk.play(video);

// 带转码选项的播放
await sdk.play(video, {
  transcode: true, // 启用转码
  transcodeConfig: {
    resolution: '1920x1080',
    bitrate: '5M',
    format: 'mp4',
    quality: 8
  }
});

// 暂停播放
await sdk.pause();

// 继续播放
await sdk.resume();

// 跳转到指定时间
await sdk.seek(120); // 120秒

// 设置音量
await sdk.setVolume(75); // 75%

// 切换全屏
await sdk.toggleFullscreen();

// 彻底退出播放器
await sdk.quit();
```

### 4. API 接口参考

#### 4.1 核心方法

| 方法名 | 参数 | 返回值 | 描述 |
|--------|------|--------|------|
| `constructor()` | 无 | `VideoPlayerSDK` | 创建 SDK 实例 |
| `isElectron` | 无 | `boolean` | 检测是否为 Electron 环境 |
| `play(video, options)` | `video: Object, options?: { transcode?: boolean, transcodeConfig?: Object }` | `Promise<void>` | 播放视频，支持转码选项 |
| `pause()` | 无 | `Promise<void>` | 暂停播放 |
| `resume()` | 无 | `Promise<void>` | 继续播放 |
| `stop()` | 无 | `Promise<void>` | 停止播放 |
| `seek(time)` | `time: number` | `Promise<void>` | 跳转到指定时间（秒） |
| `setVolume(volume)` | `volume: number` | `Promise<void>` | 设置音量（0-100） |
| `toggleFullscreen()` | 无 | `Promise<void>` | 切换全屏模式 |
| `quit()` | 无 | `Promise<void>` | 彻底退出播放器 |

#### 4.2 播放列表方法

| 方法名 | 参数 | 返回值 | 描述 |
|--------|------|--------|------|
| `getPlaylist()` | 无 | `Promise<Array>` | 获取当前播放列表 |
| `addToPlaylist(video)` | `video: Object` | `Promise<void>` | 添加视频到播放列表 |
| `removeFromPlaylist(index)` | `index: number` | `Promise<void>` | 从播放列表移除视频 |
| `setPlaylist(videos)` | `videos: Array` | `Promise<void>` | 设置整个播放列表 |

#### 4.3 转码管理方法

| 方法名 | 参数 | 返回值 | 描述 |
|--------|------|--------|------|
| `requestTranscode(videoUrl, config)` | `videoUrl: string, config: Object` | `Promise<Object>` | 发起转码请求 |
| `getTranscodeStatus(taskId)` | `taskId: string` | `Promise<Object>` | 获取转码状态 |
| `cancelTranscode(taskId)` | `taskId: string` | `Promise<void>` | 取消转码任务 |
| `onTranscodeStatus(callback)` | `callback: Function` | `Function` | 监听转码状态更新，返回清理函数 |



### 5. 状态管理

SDK 内置状态管理，维护播放器的核心状态：

```typescript
// 状态管理示例
const sdk = new VideoPlayerSDK();

// 监听状态变化
sdk.onStateChange((state) => {
  console.log('状态更新:', state);
  // 状态包括：播放状态、当前时间、音量、全屏状态等
});
```







### 8. Vue 3 集成示例

```vue
<template>
  <div class="video-player-app">
    <h1>视频播放器</h1>
    
    <!-- 播放列表 -->
    <div class="playlist">
      <h2>播放列表</h2>
      <ul>
        <li v-for="(video, index) in playlist" :key="video.id">
          {{ video.name }}
          <button @click="playVideo(index)">播放</button>
          <button @click="playVideoWithTranscode(index)">转码播放</button>
          <button @click="removeVideo(index)">移除</button>
        </li>
      </ul>
      
      <!-- 添加视频到播放列表 -->
      <div class="add-video-form">
        <h3>添加视频</h3>
        <input v-model="newVideoUrl" placeholder="输入视频 URL" />
        <input v-model="newVideoName" placeholder="输入视频名称" />
        <button @click="addVideo">添加</button>
      </div>
    </div>
    


  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { VideoPlayerSDK } from '@/core/sdk';

const sdk = new VideoPlayerSDK();
const playlist = ref([]);
const newVideoUrl = ref('');
const newVideoName = ref('');

onMounted(async () => {
  // 获取当前播放列表
  playlist.value = await sdk.getPlaylist();
});

async function playVideo(index) {
  const video = playlist.value[index];
  // 确保视频已在播放列表中，然后播放
  await sdk.play(video);
}

async function removeVideo(index) {
  await sdk.removeFromPlaylist(index);
  playlist.value = await sdk.getPlaylist();
}

async function addVideo() {
  if (!newVideoUrl.value || !newVideoName.value) return;
  
  const video = {
    id: `video-${Date.now()}`,
    name: newVideoName.value,
    path: newVideoUrl.value,
    duration: 0 // 可通过元数据 API 获取
  };
  
  await sdk.addToPlaylist(video);
  playlist.value = await sdk.getPlaylist();
  
  // 清空表单
  newVideoUrl.value = '';
  newVideoName.value = '';
}

// 带转码的播放
async function playVideoWithTranscode(index) {
  const video = playlist.value[index]; // 获取到当前点击的视频
  // 带转码选项的播放
  await sdk.play(video, {
    transcode: true,
    transcodeConfig: {
      resolution: '1920x1080',
      bitrate: '5M',
      format: 'mp4',
      quality: 8
    }
  });
}

</script>
```


### 9. 扩展性

SDK 设计考虑了扩展性，支持以下场景：

1. **自定义存储方案**：可以替换默认的存储实现
2. **插件系统**：支持添加自定义插件扩展功能
3. **多语言支持**：内置国际化支持
4. **主题定制**：支持自定义 UI 主题

### 10. 版本兼容性

| SDK 版本 | Electron 版本 | Web 浏览器 |
|----------|--------------|------------|
| **v1.0** | Electron 18+ | Chrome 90+, Firefox 88+, Safari 14+ |

## 📱 前端 API 参考

### 1. 播放控制

| 方法名 | 参数 | 返回值 | 描述 |
|--------|------|--------|------|
| `playMedia` | `{ name: string, path: string, startTime?: number }` | `void` | 播放视频文件 |
| `pause` | 无 | `void` | 暂停播放 |
| `resume` | 无 | `void` | 恢复播放 |
| `stop` | 无 | `void` | 停止播放 |
| `seek` | `time: number` | `void` | 跳转到指定时间（秒） |
| `setVolume` | `volume: number` | `void` | 设置音量（0-100） |
| `toggleFullscreen` | 无 | `void` | 切换全屏模式 |
| `setHdr` | `enabled: boolean` | `void` | 开启/关闭 HDR |
| `windowAction` | `action: 'close'  'minimize'  'maximize'` | `void` | 窗口操作 |
| `quit` | 无 | `void` | 彻底关闭 VideoPlayer（停止播放、关闭窗口、清理资源） |

### 2. 播放列表

| 方法名 | 参数 | 返回值 | 描述 |
|--------|------|--------|------|
| `playNext` | 无 | `void` | 播放下一个视频 |
| `playPrev` | 无 | `void` | 播放上一个视频 |
| `getPlaylist` | 无 | `void` | 获取播放列表 |
| `setPlaylist` | `items: any[]` | `void` | 设置播放列表 |

### 3. 事件监听

| 方法名 | 参数 | 返回值 | 描述 |
|--------|------|--------|------|
| `onCurrentVideoChanged` | `callback: (data: any) => void` | `() => void` | 监听当前视频变化 |
| `onStatus` | `callback: (data: any) => void` | `() => void` | 监听播放器状态变化 |
| `onPlaylistUpdated` | `callback: (data: any) => void` | `() => void` | 监听播放列表更新 |

### 4. 退去视频

| 方法名 | 参数 | 返回值 | 描述 |
|--------|------|--------|------|
| `quit` | 无 | `void` | 彻底关闭 VideoPlayer（停止播放、关闭窗口、清理资源） |

## 🎯 客户端视频播放器 API

前端通过 `window.electronAPI.player` 对象访问播放器控制功能。

### 基本播放控制

```typescript
// 播放视频
window.electronAPI.player.playMedia({
  name: 'video.mp4',
  path: '/path/to/video.mp4',
  startTime: 0 // 可选，起始时间（秒）
})

// 暂停播放
window.electronAPI.player.pause()

// 继续播放
window.electronAPI.player.resume()

// 停止播放
window.electronAPI.player.stop()

// 跳转到指定时间
window.electronAPI.player.seek(120) // 跳转到120秒

// 设置音量
window.electronAPI.player.setVolume(75) // 设置音量75%

// 切换全屏
window.electronAPI.player.toggleFullscreen()

// 设置HDR 先搁置
window.electronAPI.player.setHdr(true) // Mac 启用HDR

// 彻底关闭 VideoPlayer（停止播放、关闭窗口、清理资源）
window.electronAPI.player.quit()
```

### 窗口控制

```typescript
// 窗口操作
window.electronAPI.player.windowAction('close')    // 关闭窗口
window.electronAPI.player.windowAction('minimize') // 最小化窗口
window.electronAPI.player.windowAction('maximize') // 最大化窗口
```

### 播放列表控制

```typescript
// 播放下一个
window.electronAPI.player.playNext()

// 播放上一个
window.electronAPI.player.playPrev()

// 获取播放列表
window.electronAPI.player.getPlaylist()

// 设置播放列表
window.electronAPI.player.setPlaylist([
  { name: 'video1.mp4', path: '/path/to/video1.mp4' },
  { name: 'video2.mp4', path: '/path/to/video2.mp4' }
])
```

### 事件监听

```typescript
// 监听当前视频变化
const cleanupCurrentVideo = window.electronAPI.player.onCurrentVideoChanged((video) => {
  console.log('当前视频已更改:', video)
})

// 监听播放器状态变化
const cleanupStatus = window.electronAPI.player.onStatus((status) => {
  console.log('播放器状态:', status)
  /*
  status 对象结构:
  {
    phase: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error',
    currentTime: number, // 当前时间（秒）
    duration: number,    // 总时长（秒）
    volume: number,      // 音量（0-100）
    path: string | null, // 文件路径
    isPaused: boolean,   // 是否暂停
    isSeeking: boolean,  // 是否跳转中
    isNetworkBuffering: boolean, // 网络缓冲中
    networkBufferingPercent: number, // 缓冲百分比
    errorMessage?: string, // 错误消息
    isSwitching?: boolean  // 是否正在切换视频
  }
  */
})

// 监听播放列表更新
const cleanupPlaylist = window.electronAPI.player.onPlaylistUpdated((items) => {
  console.log('播放列表已更新:', items)
})

// 组件卸载时清理监听器
onUnmounted(() => {
  cleanupCurrentVideo()
  cleanupStatus()
  cleanupPlaylist()
})
```

## 📝 更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-02-05 | 创建前端API参考手册 |
| 2026-01-25 | 基于preload.ts v1.0提取核心API |