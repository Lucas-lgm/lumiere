/**
 * IPC constant definitions
 *
 * Centralizes management of all IPC channel names and configuration constants
 * to improve code maintainability.
 * Naming convention: domain:action (colon namespace)
 */

/**
 * IPC channel name constants
 */
export const IPC_CHANNELS = {
  // File operations
  SELECT_VIDEO_FILE: 'file:select-video',
  PLAY_VIDEO: 'player:play-media',
  PLAY_URL: 'player:play-url',

  // Playback control
  CONTROL_PAUSE: 'player:pause',
  CONTROL_PLAY: 'player:resume',
  CONTROL_STOP: 'player:stop',
  CONTROL_SEEK: 'player:seek',
  CONTROL_VOLUME: 'player:set-volume',
  CONTROL_HDR: 'player:set-hdr',
  CONTROL_KEYPRESS: 'player:keypress',
  CONTROL_QUIT: 'player:quit',
  CONTROL_GET_TRACKS: 'player:get-tracks',
  CONTROL_SET_AUDIO_TRACK: 'player:set-audio-track',
  CONTROL_SET_SUBTITLE_TRACK: 'player:set-subtitle-track',

  // Playlist data service
  GET_PLAYLIST: 'playlist:get',
  SET_PLAYLIST: 'playlist:set',

  // Window operations
  CONTROL_TOGGLE_FULLSCREEN: 'window:toggle-fullscreen',
  CONTROL_WINDOW_ACTION: 'window:action',
  MAIN_WINDOW_ACTION: 'main-window:action',
  CONTROL_TOGGLE_PIP: 'window:toggle-pip',
  PIP_CLOSE: 'window:pip-close',
  PIP_RETURN: 'window:pip-return',
  PIP_TOGGLE_SIZE: 'window:pip-toggle-size',
  FIT_TO_VIDEO: 'window:fit-to-video',
  SET_ASPECT_LOCK: 'window:set-aspect-lock',

  // Video events
  VIDEO_TIME_UPDATE: 'player:time-update',
  VIDEO_ENDED: 'player:ended',

  // Mount paths
  SELECT_MOUNT_PATH: 'file:select-folder',
  MOUNT_PATH_ADD: 'file:mount-add',
  MOUNT_PATH_REMOVE: 'file:mount-remove',
  MOUNT_PATH_REFRESH: 'file:mount-refresh',
  GET_MOUNT_PATHS: 'file:get-mounts',

  // File operations
  SHOW_IN_FINDER: 'file:show-in-finder',

  // Directory scanning
  SCAN_DIRECTORY: 'file:scan-directory',
  SELECT_DIRECTORY: 'file:select-directory',

  // Player properties (generic mpv property read/write)
  PLAYER_GET_PROPERTY: 'player:get-property',
  PLAYER_SET_PROPERTY: 'player:set-property',
  PLAYER_GET_MEDIA_INFO: 'player:get-media-info',
  PLAYER_COMMAND: 'player:command',

  // Equalizer
  EQUALIZER_GET_STATE: 'equalizer:get-state',
  EQUALIZER_SAVE_STATE: 'equalizer:save-state',
  EQUALIZER_SAVE_PRESET: 'equalizer:save-preset',
  EQUALIZER_DELETE_PRESET: 'equalizer:delete-preset',

  // Resume progress
  WATCH_PROGRESS_GET: 'progress:get',
  WATCH_PROGRESS_GET_ALL: 'progress:get-all',
  WATCH_PROGRESS_CONTINUE_WATCHING: 'progress:get-continue-watching',
  WATCH_PROGRESS_CLEAR: 'progress:clear',

  // Thumbnails
  THUMBNAIL_GET: 'thumbnail:get',
  THUMBNAIL_GENERATE_BATCH: 'thumbnail:generate-batch',
  THUMBNAIL_GENERATE_STRIP: 'thumbnail:generate-strip',
  // Seek bar preview (dynamic on-demand generation)
  THUMBNAIL_SEEK_INIT: 'thumbnail:seek-init',
  THUMBNAIL_SEEK_AT: 'thumbnail:seek-at',
  THUMBNAIL_SEEK_DESTROY: 'thumbnail:seek-destroy',

  // Theme
  THEME_GET: 'theme:get',
  THEME_SET: 'theme:set',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',

  // Logging
  LOG_OPEN_DIR: 'log:open-dir',

  // Debug
  DEBUG_HDR_STATUS: 'debug:hdr-status',

  // AI subtitle transcription
  TRANSCRIPTION_START: 'transcription:start',
  TRANSCRIPTION_CANCEL: 'transcription:cancel',
  TRANSCRIPTION_STATUS: 'transcription:status',
  TRANSCRIPTION_CHECK_SRT: 'transcription:check-srt',
  TRANSCRIPTION_CHECK_AVAILABILITY: 'transcription:check-availability',
  TRANSCRIPTION_LIST_MODELS: 'transcription:list-models',
  TRANSCRIPTION_DOWNLOAD_MODEL: 'transcription:download-model',
  TRANSCRIPTION_DELETE_MODEL: 'transcription:delete-model',
  // Animated image export
  ANIM_EXPORT_START: 'anim:start',
  ANIM_EXPORT_CANCEL: 'anim:cancel',
  ANIM_EXPORT_SELECT_OUTPUT: 'anim:select-output',
} as const

/**
 * IPC response/event channel name constants
 */
export const IPC_RESPONSE_CHANNELS = {
  // Player events
  PLAYER_STATUS: 'player:status',
  PLAYER_ERROR: 'player:error',
  TRACKS_CHANGED: 'player:tracks-changed',
  CURRENT_VIDEO_CHANGED: 'player:current-changed',
  CONTROL_BAR_SHOW: 'player:control-bar-show',
  CONTROL_BAR_SCHEDULE_HIDE: 'player:control-bar-schedule-hide',
  CONTROL_BAR_HIDE_IMMEDIATE: 'player:control-bar-hide-immediate',
  FULLSCREEN_CHANGED: 'window:fullscreen-changed',

  // Playlist
  PLAYLIST_UPDATED: 'playlist:updated',

  // Resume progress events
  PROGRESS_UPDATED: 'progress:updated',

  // Thumbnail events
  THUMBNAIL_READY: 'thumbnail:ready',

  // Theme events
  THEME_CHANGED: 'theme:changed',

  // Language events
  LANGUAGE_CHANGED: 'language:changed',

  // Mount path events
  MOUNT_PATH_ERROR: 'file:mount-error',
  MOUNT_PATHS_UPDATED: 'file:mounts-updated',
  MOUNT_PATH_ADDED: 'file:mount-added',
  MOUNT_PATH_SCANNED: 'file:mount-scanned',
  DIRECTORY_SCANNED: 'file:directory-scanned',
  DIRECTORY_SCAN_ERROR: 'file:directory-scan-error',

  // File
  VIDEO_FILE_SELECTED: 'file:video-selected',

  // Animated image export events
  ANIM_EXPORT_PROGRESS: 'anim:progress',
  ANIM_EXPORT_COMPLETE: 'anim:complete',
  ANIM_EXPORT_ERROR: 'anim:error',

  // AI subtitle transcription events
  TRANSCRIPTION_PROGRESS: 'transcription:progress',
  TRANSCRIPTION_COMPLETE: 'transcription:complete',
  TRANSCRIPTION_ERROR: 'transcription:error',
  TRANSCRIPTION_MODEL_DOWNLOAD_PROGRESS: 'transcription:model-download-progress',
} as const

/**
 * Video file extension constants
 */
export const VIDEO_FILE_EXTENSIONS = [
  'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v',
  'ts', 'm2ts', 'mts', 'm3u8', 'iso'
] as const