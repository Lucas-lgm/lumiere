/**
 * Application constant configuration
 *
 * Centralizes all hardcoded delay, timeout, and interval configuration values
 * to improve code maintainability and determinism.
 */

/**
 * Video playback delay configuration
 */
export const VIDEO_PLAYER_DELAYS = {
  /** Wait time after stopping playback (ms) */
  STOP_WAIT_MS: 100,
  /** Wait time after showing the video window (ms) */
  VIDEO_WINDOW_SHOW_WAIT_MS: 500,
} as const

/**
 * Window-related delay configuration
 */
export const WINDOW_DELAYS = {
  /** Window sync interval (ms) */
  SYNC_INTERVAL_MS: 2000,
  /** Focus delay (ms) */
  FOCUS_DELAY_MS: 200,
  /** Resize throttle delay (ms, ~60fps) */
  RESIZE_THROTTLE_MS: 16,
} as const

/**
 * UI interaction delay configuration
 */
export const UI_DELAYS = {
  /** Mouse move detection delay (ms) */
  MOUSE_MOVE_DELAY_MS: 100,
  /** Control bar hide delay (ms) */
  CONTROL_BAR_HIDE_DELAY_MS: 100,
} as const
