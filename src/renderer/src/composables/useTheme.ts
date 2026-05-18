import { ref, watch, onMounted, onUnmounted } from 'vue'

export type Theme = 'light' | 'dark'
export type ThemePreference = 'system' | 'light' | 'dark'

// Shared reactive state (singleton across all consumers)
const theme = ref<Theme>('dark')
const preference = ref<ThemePreference>('system')
let initialized = false
let ipcCleanup: (() => void) | null = null
let mediaQueryCleanup: (() => void) | null = null

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
}

function detectSystemTheme(): Theme {
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

async function initTheme() {
  if (initialized) return
  initialized = true

  // Prefer P3 IPC API (Electron environment)
  if (window.electronAPI?.theme) {
    try {
      const data = await window.electronAPI.theme.get()
      preference.value = data.preference as ThemePreference
      theme.value = data.resolved as Theme
      applyTheme(theme.value)
    } catch {
      // fallback
      theme.value = detectSystemTheme()
      applyTheme(theme.value)
    }

    // Listen for theme changes pushed by the main process (system switch, other window settings, etc.)
    ipcCleanup = window.electronAPI.theme.onChange((data) => {
      preference.value = data.preference as ThemePreference
      theme.value = data.resolved as Theme
      applyTheme(theme.value)
    })
  } else {
    // Non-Electron environment fallback
    theme.value = detectSystemTheme()
    applyTheme(theme.value)

    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (mq) {
      const handler = (e: MediaQueryListEvent) => {
        if (preference.value === 'system') {
          theme.value = e.matches ? 'dark' : 'light'
          applyTheme(theme.value)
        }
      }
      mq.addEventListener('change', handler)
      mediaQueryCleanup = () => mq.removeEventListener('change', handler)
    }
  }
}

export function useTheme() {
  onMounted(() => {
    initTheme()
  })

  onUnmounted(() => {
    if (mediaQueryCleanup) {
      mediaQueryCleanup()
      mediaQueryCleanup = null
    }
    if (ipcCleanup) {
      ipcCleanup()
      ipcCleanup = null
    }
    // Reset initialized flag so next mount re-initializes
    initialized = false
  })

  function setPreference(pref: ThemePreference) {
    preference.value = pref
    if (window.electronAPI?.theme) {
      window.electronAPI.theme.set(pref)
    } else {
      // fallback: switch directly
      if (pref === 'system') {
        theme.value = detectSystemTheme()
      } else {
        theme.value = pref
      }
      applyTheme(theme.value)
    }
  }

  const isDark = ref(false)
  watch(theme, (t) => { isDark.value = t === 'dark' }, { immediate: true })

  return {
    theme,
    preference,
    isDark,
    setPreference
  }
}
