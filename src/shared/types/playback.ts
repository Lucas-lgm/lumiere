/** Playback phase — shared between main and renderer */
export type PlaybackPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'

/** Media resource for playback */
export interface Media {
  readonly uri: string
  readonly title?: string
}

/** Create a Media object from uri and optional title */
export function createMedia(uri: string, title?: string): Media {
  return { uri, title }
}
