import { VideoPlayerSDK } from './VideoPlayerSDK';

let playerSDK: VideoPlayerSDK | null = null;

/**
 * Get the globally unique player SDK instance (shared by frontend playlist and switching logic)
 */
export function getPlayerSDK(): VideoPlayerSDK {
  if (!playerSDK) {
    playerSDK = new VideoPlayerSDK();
    // Initialize SDK, load playlist state from main process
    playerSDK.init();
  }
  return playerSDK;
}

export {
  VideoPlayerSDK
};

export default VideoPlayerSDK;
