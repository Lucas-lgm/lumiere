/**
 * 媒体对象类型
 */
export interface Media {
  id?: string;
  name: string;
  path: string;
  startTime?: number;
  duration?: number;
  thumbnail?: string;
}

/**
 * 播放列表类型
 */
export type Playlist = Media[];
