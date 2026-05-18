/**
 * Shared application-level types.
 */

export interface PlaylistItem {
  path: string
  name: string
  /**
   * Start playback time (seconds, optional)
   * - Used for resume playback / starting from a specific time point
   */
  startTime?: number
}
