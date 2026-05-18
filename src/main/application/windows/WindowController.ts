import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'

/**
 * Window Strategy / Controller Interface
 * 
 * Defines the contract for platform-specific window management strategies.
 * This decouples the VideoPlayerApp from the specific implementation details.
 */
export interface WindowController extends EventEmitter {
  /**
   * Initialize the video window and its controls
   * @returns Promise that resolves when the window system is fully ready (visible and interactive)
   */
  init(options: WindowCreationOptions): Promise<void>;

  /**
   * Reload the content of the control layer (e.g., on language change or dev reload)
   */
  reloadControlLayer(): void;

  /**
   * Set the visibility of the control layer (e.g., auto-hide logic)
   */
  setControlBarVisibility(visible: boolean): void;

  /**
   * Handle window actions (close/min/max) taking into account the composition
   */
  handleWindowAction(action: WindowAction): void;

  /**
   * Toggle fullscreen mode, handling UI visibility and platform quirks
   */
  toggleFullscreen(): void;

  /**
   * Get the window that receives user input (Control Window or Main Window)
   */
  getInputWindow(): BrowserWindow | null;

  /**
   * Get the underlying video window (for binding MPV)
   */
  getVideoWindow(): BrowserWindow | null;

  /**
   * Show the window (if hidden)
   */
  show(): void;

  /**
   * Hide the window (if visible)
   */
  hide(): void;

  /**
   * Reset the layout (e.g. after screen resolution change)
   */
  resetLayout(): void;

  /**
   * Toggle control layer background: transparent during playback (video visible), black otherwise (covers transparent window)
   */
  setVideoLayerVisible(visible: boolean): void;

  /**
   * Send IPC message to the control layer (WebContentsView)
   */
  sendToControlLayer(channel: string, ...args: any[]): void;

  /**
   * Toggle PIP (picture-in-picture) mode.
   * In PIP: window resizes to ~300×170, alwaysOnTop, simplified controls.
   * @returns true if now in PIP mode, false if exited PIP
   */
  togglePip(): boolean;

  /**
   * Check if currently in PIP mode
   */
  isPip(): boolean;

  /**
   * Close PIP: pause playback + exit PIP mode
   */
  pipClose(): void;

  /**
   * Return to main window: exit PIP mode, notify renderer to restore fullscreen player UI
   */
  pipReturn(): void;

  /**
   * Double-click to toggle PIP window size: min(240x135) ↔ max(480x270)
   */
  togglePipSize(): void;

  /**
   * Resize window to match video aspect ratio (keep window area roughly unchanged)
   * @param videoWidth Video width
   * @param videoHeight Video height
   */
  fitToVideo(videoWidth: number, videoHeight: number): void;

  /**
   * Lock/unlock window aspect ratio (matches current video)
   * @param ratio Aspect ratio value, pass 0 to unlock
   */
  setAspectRatioLock(ratio: number): void;

  /**
   * Clean up resources (listeners, timers, child windows)
   * This should NOT destroy the windows if they are meant to be returned to the pool,
   * but for now we assume disposal destroys them.
   */
  dispose(): void;
}

export type WindowAction = 'close' | 'minimize' | 'maximize' | 'restore';

export interface WindowCreationOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  title?: string;
  /**
   * If true, the controller should initialize in a hidden state for preloading
   */
  preload?: boolean; 
}

// Events emitted by the controller
export interface WindowControllerEvents {
  'close': () => void;
  'resize': (bounds: Electron.Rectangle) => void;
  'fullscreen-enter': () => void;
  'fullscreen-exit': () => void;
  'focus': () => void;
  'blur': () => void;
  'key-down': (key: string) => void;
}
