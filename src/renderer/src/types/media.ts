/**
 * Resource source type
 */
export type ResourceSource = 'local' | 'network' | 'mounted'

/**
 * Resource filter
 */
export type ResourceFilter = 'all' | 'local' | 'network' | string

/**
 * View mode
 */
export type ViewMode = 'grid' | 'list'

/**
 * Media resource
 */
export interface MediaResource {
  id: string
  name: string
  path: string
  source: ResourceSource
  duration?: number
  size?: number
  thumbnail?: string
  mountPath?: string
  addedAt?: Date
}

/**
 * Media object (used by player)
 */
export interface Media {
  id?: string
  name: string
  path: string
  startTime?: number
  duration?: number
  thumbnail?: string
}

/**
 * Playlist type
 */
export type Playlist = Media[]
