# 前端 API 参考手册

> **最后更新**: 2026-02-05  
> **基于版本**: preload.ts v1.0  
> **状态**: 生产就绪

## 🎯 核心接口概览

前端通过 `window.electronAPI.player` 对象访问播放器控制功能。

## 📡 播放器控制 API

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

// 设置HDR
window.electronAPI.player.setHdr(true) // 启用HDR
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



## 🚀 快速使用示例

### Vue 组件示例

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const playerStatus = ref(null)
const currentVideo = ref(null)

// 监听播放器状态
onMounted(() => {
  // 监听播放器状态变化
  const cleanupStatus = window.electronAPI.player.onStatus((status) => {
    playerStatus.value = status
  })

  // 监听当前视频变化
  const cleanupCurrentVideo = window.electronAPI.player.onCurrentVideoChanged((video) => {
    currentVideo.value = video
  })

  // 组件卸载时清理
  onUnmounted(() => {
    cleanupStatus()
    cleanupCurrentVideo()
  })
})

// 播放视频
function playVideo(path: string) {
  window.electronAPI.player.playMedia({
    name: path.split('/').pop(),
    path,
    startTime: 0
  })
}

// 暂停/继续
function togglePlayPause() {
  if (playerStatus?.isPaused) {
    window.electronAPI.player.resume()
  } else {
    window.electronAPI.player.pause()
  }
}

// 跳转到指定时间
function seekTo(time: number) {
  window.electronAPI.player.seek(time)
}

// 设置音量
function setVolume(volume: number) {
  window.electronAPI.player.setVolume(volume)
}
</script>

<template>
  <div class="player-controls">
    <h2>{{ currentVideo?.name || '未选择视频' }}</h2>
    
    <div class="status">
      状态: {{ playerStatus?.phase || '空闲' }}
      <br>
      时间: {{ Math.floor(playerStatus?.currentTime || 0) }} / {{ Math.floor(playerStatus?.duration || 0) }} 秒
      <br>
      暂停: {{ playerStatus?.isPaused || false }}
      <br>
      音量: {{ playerStatus?.volume || 100 }}%
    </div>
    
    <div class="controls">
      <button @click="togglePlayPause">
        {{ playerStatus?.phase === 'playing' ? '暂停' : '播放' }}
      </button>
      <button @click="() => seekTo((playerStatus?.position || 0) - 10)">
        后退 10s
      </button>
      <button @click="() => seekTo((playerStatus?.position || 0) + 10)">
        前进 10s
      </button>
      <button @click="window.electronAPI.player.stop">
        停止
      </button>
    </div>
    
    <div class="volume-control">
      <label>音量:</label>
      <input 
        type="range" 
        min="0" 
        max="100" 
        :value="playerStatus?.volume || 100"
        @input="(e) => setVolume(Number(e.target.value))"
      >
    </div>
  </div>
</template>
```
## 💡 使用建议

1. **异步处理**: 所有播放器API调用都是异步的，通过IPC发送消息
2. **错误处理**: 监听播放器状态变化获取操作结果和错误信息
3. **资源清理**: 组件卸载时务必清理所有播放器事件监听器
4. **状态管理**: 使用响应式框架（如Vue）管理播放器状态
5. **性能优化**: 避免频繁调用播放器API，使用节流和防抖优化用户输入
6. **用户体验**: 提供加载状态和错误提示，确保用户操作有反馈

## 🚀 最佳实践

### 1. 状态管理

使用Pinia等状态管理库集中管理播放器状态，避免状态分散。

### 2. 错误处理

```typescript
// 示例：添加错误处理
function playVideoWithErrorHandling(path: string) {
  try {
    window.electronAPI.player.playMedia({
      name: path.split('/').pop(),
      path,
      startTime: 0
    })
  } catch (error) {
    console.error('播放视频失败:', error)
    // 显示错误提示给用户
  }
}
```

### 3. 性能优化

```typescript
// 示例：使用节流优化音量调节
import { throttle } from 'lodash'

const throttledSetVolume = throttle((volume: number) => {
  window.electronAPI.player.setVolume(volume)
}, 100) // 100ms内最多执行一次

// 在输入事件中使用
function handleVolumeChange(e: Event) {
  const volume = Number((e.target as HTMLInputElement).value)
  throttledSetVolume(volume)
}
```

### 4. 响应式设计

```typescript
// 示例：根据播放器状态更新UI
computed(() => {
  return {
    isPlaying: playerStatus.value?.phase === 'playing',
    isPaused: playerStatus.value?.isPaused,
    isLoading: playerStatus.value?.phase === 'loading',
    isError: playerStatus.value?.phase === 'error',
    progress: playerStatus.value?.duration 
      ? (playerStatus.value.currentTime / playerStatus.value.duration) * 100 
      : 0
  }
})
```

## 📝 更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-02-05 | 创建前端API参考手册 |
| 2026-01-25 | 基于preload.ts v1.0提取核心API |