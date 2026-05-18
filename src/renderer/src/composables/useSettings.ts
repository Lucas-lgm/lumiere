import { ref, watch, toRaw } from 'vue'
import i18n, { resolveLocale } from '../i18n'
import type { BackendSettings } from '../../../shared/types/ipc'

export type { BackendSettings }

/**
 * Frontend complete settings (backend fields + shortcuts)
 */
export interface AppSettings extends BackendSettings {
  shortcuts: Record<string, string>
}

const BACKEND_KEYS: (keyof BackendSettings)[] = [
  'hwdec', 'hwdecCodec', 'rememberProgress', 'autoLoadSubtitle',
  'autoLoadAudio', 'defaultSpeed', 'chapterNav',
  'windowFollowVideo',
  'autoThumbnail',
  'httpProxy', 'bufferSize', 'mpvOptions', 'logLevel', 'cacheSize',
  'language', 'preferredLang', 'videoEnhancement'
]

const SHORTCUTS_KEY = 'lumiere-shortcuts'

function getDefaultShortcuts(): Record<string, string> {
  return {
    'play-pause': 'Space',
    'seek-back-10': 'ArrowLeft',
    'seek-fwd-10': 'ArrowRight',
    'seek-back-30': 'Shift+ArrowLeft',
    'seek-fwd-30': 'Shift+ArrowRight',
    'prev-video': 'Shift+Meta+ArrowLeft',
    'next-video': 'Shift+Meta+ArrowRight',
    'speed-up': ']',
    'speed-down': '[',
    'frame-back': ',',
    'frame-fwd': '.',
    'fullscreen': 'f',
    'volume-up': 'ArrowUp',
    'volume-down': 'ArrowDown',
    'mute': 'm',
    'screenshot': 'Meta+s',
    'ab-loop': 'Meta+l',
    'open-file': 'Meta+o',
    'paste-url': 'Meta+n',
    'show-playlist': 'Meta+p',
    'kb-help': 'Meta+?',
    'back-library': 'Meta+ArrowLeft'
  }
}

function getDefaults(): AppSettings {
  return {
    hwdec: 'auto',
    hwdecCodec: 'videotoolbox',
    rememberProgress: true,
    autoLoadSubtitle: true,
    autoLoadAudio: true,
    defaultSpeed: 1,
    chapterNav: false,
    windowFollowVideo: true,
    autoThumbnail: true,
    httpProxy: '',
    bufferSize: 2,
    mpvOptions: '',
    logLevel: 'warn',
    cacheSize: 150,
    language: 'system',
    preferredLang: 'system',
    videoEnhancement: 'off',
    shortcuts: getDefaultShortcuts()
  }
}

// ── Singleton state ──

const settings = ref<AppSettings>(getDefaults())
let lastBackendSnapshot: Record<string, any> = {}
let syncing = false

// Load shortcuts from localStorage
function loadShortcuts() {
  try {
    const stored = localStorage.getItem(SHORTCUTS_KEY)
    if (stored) {
      settings.value.shortcuts = { ...getDefaultShortcuts(), ...JSON.parse(stored) }
    }
  } catch (e) { console.warn('[useSettings] loadShortcuts failed', e) }
}

function saveShortcuts() {
  try {
    localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(settings.value.shortcuts))
  } catch (e) { console.warn('[useSettings] saveShortcuts failed', e) }
}

// Load backend settings via IPC
async function loadFromBackend() {
  try {
    if (!window.electronAPI?.settings) return
    const backend = await window.electronAPI.settings.get()
    syncing = true
    for (const key of BACKEND_KEYS) {
      if (key in backend) {
        ;(settings.value as any)[key] = (backend as any)[key]
      }
    }
    syncing = false
    snapshotBackend()
    // Apply locale after loading
    applyLocale(settings.value.language)
  } catch (e) { console.warn('[useSettings] loadFromBackend failed', e) }
}

function snapshotBackend() {
  const raw = toRaw(settings.value)
  lastBackendSnapshot = {}
  for (const key of BACKEND_KEYS) {
    lastBackendSnapshot[key] = (raw as any)[key]
  }
}

// Sync changed fields to backend
function syncToBackend() {
  if (syncing || !window.electronAPI?.settings) return
  const raw = toRaw(settings.value)
  for (const key of BACKEND_KEYS) {
    const val = (raw as any)[key]
    if (val !== lastBackendSnapshot[key]) {
      window.electronAPI.settings.set(key, val)
      lastBackendSnapshot[key] = val
    }
  }
}

function applyLocale(preference: string) {
  i18n.global.locale.value = resolveLocale(preference) as any
}

// Init
loadShortcuts()
loadFromBackend()
snapshotBackend()

// Listen for language changes broadcast by main process (cross-window sync, e.g., control bar WebContentsView)
// Use optional chaining to ensure safety in non-Electron environments (e.g., unit tests)
window.electronAPI?.settings?.onLanguageChanged?.((lang: string) => {
  applyLocale(lang)
  // Synchronously update local settings state (avoid inconsistency with main window's settings.value.language)
  syncing = true
  settings.value.language = lang
  syncing = false
  snapshotBackend()
})

// Auto-sync on changes
watch(settings, () => {
  syncToBackend()
  saveShortcuts()
}, { deep: true })

// Auto-switch locale when language setting changes
watch(() => settings.value.language, (lang) => {
  applyLocale(lang)
})

// ── Public API ──

export type SettingsCategory = 'playback' | 'shortcuts' | 'general' | 'about'

export const SETTINGS_CATEGORIES: { id: SettingsCategory; labelKey: string; icon: string }[] = [
  { id: 'playback', labelKey: 'settings.nav.playback', icon: 'play' },
  { id: 'shortcuts', labelKey: 'settings.nav.shortcuts', icon: 'keyboard' },
  { id: 'general', labelKey: 'settings.nav.general', icon: 'settings' },
  { id: 'about', labelKey: 'settings.nav.about', icon: 'info' }
]

export function useSettings() {
  async function resetAll() {
    try {
      if (window.electronAPI?.settings) {
        const defaults = await window.electronAPI.settings.reset()
        syncing = true
        for (const key of BACKEND_KEYS) {
          ;(settings.value as any)[key] = (defaults as any)[key]
        }
        syncing = false
        snapshotBackend()
      }
    } catch (e) { console.warn('[useSettings] resetAll failed', e) }
    settings.value.shortcuts = getDefaultShortcuts()
    saveShortcuts()
  }

  return {
    settings,
    resetAll,
    SETTINGS_CATEGORIES
  }
}
