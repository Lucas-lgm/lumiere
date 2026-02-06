import { VideoPlayerSDK } from './VideoPlayerSDK';

let playerSDK: VideoPlayerSDK | null = null;

/**
 * 获取全局唯一的播放器 SDK 实例（前端播放列表与切换逻辑共用）
 */
export function getPlayerSDK(): VideoPlayerSDK {
  if (!playerSDK) {
    playerSDK = new VideoPlayerSDK();
    // 初始化 SDK，从主进程加载播放列表状态
    playerSDK.init();
  }
  return playerSDK;
}

export {
  VideoPlayerSDK
};

export default VideoPlayerSDK;
