import { ref, computed } from 'vue'
import type { EqualizerState } from '../../../shared/types/ipc'
import { BUILTIN_PRESETS, EQ_BAND_COUNT, EQ_GAIN_MIN, EQ_GAIN_MAX } from '../../../shared/types/ipc'

const EQUALIZER_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

function buildAfFilter(bands: number[]): string {
  const filters = bands.map((gain, i) => {
    const freq = EQUALIZER_FREQUENCIES[i]
    return `equalizer=frequency=${freq}:width_type=o:width=1:gain=${gain}`
  })
  return `lavfi=[${filters.join(',')}]`
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function applyEqToMpv(filterString: string) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    window.electronAPI?.playerProperty?.set('af', filterString)
  }, 150)
}

export function useAudioEqualizer() {
  const enabled = ref(false)
  const bands = ref<number[]>([...Array(EQ_BAND_COUNT).fill(0)])
  const currentPreset = ref('flat')
  const customPresets = ref<Record<string, number[]>>({})
  const isLoaded = ref(false)
  const savedPresetName = ref('')

  const allPresets = computed(() => {
    const presets: { name: string; bands: number[] }[] = []
    for (const [name, b] of Object.entries(BUILTIN_PRESETS)) {
      presets.push({ name, bands: b })
    }
    for (const [name, b] of Object.entries(customPresets.value)) {
      presets.push({ name, bands: b })
    }
    return presets
  })

  async function loadState() {
    if (!window.electronAPI?.equalizer) return
    try {
      const state: EqualizerState = await window.electronAPI.equalizer.getState()
      enabled.value = state.enabled
      bands.value = [...state.bands]
      currentPreset.value = state.currentPreset
      customPresets.value = { ...state.customPresets }
      isLoaded.value = true
    } catch { /* ignore */ }
  }

  async function saveState() {
    if (!window.electronAPI?.equalizer) return
    try {
      await window.electronAPI.equalizer.saveState({
        enabled: enabled.value,
        bands: bands.value,
        currentPreset: currentPreset.value,
      })
    } catch { /* ignore */ }
  }

  function setBand(index: number, value: number) {
    const clamped = Math.max(EQ_GAIN_MIN, Math.min(EQ_GAIN_MAX, value))
    bands.value[index] = clamped
    currentPreset.value = 'custom'
    if (enabled.value) {
      applyEqToMpv(buildAfFilter(bands.value))
    }
    saveState()
  }

  function setPreset(name: string) {
    const preset = allPresets.value.find(p => p.name === name)
    if (!preset) return
    bands.value = [...preset.bands]
    currentPreset.value = name
    if (enabled.value) {
      applyEqToMpv(buildAfFilter(bands.value))
    }
    saveState()
  }

  async function toggleEnabled() {
    enabled.value = !enabled.value
    if (enabled.value) {
      applyEqToMpv(buildAfFilter(bands.value))
    } else {
      window.electronAPI?.playerProperty?.set('af', '')
    }
    await saveState()
  }

  function resetAll() {
    bands.value = [...BUILTIN_PRESETS.flat]
    currentPreset.value = 'flat'
    if (enabled.value) {
      applyEqToMpv(buildAfFilter(bands.value))
    }
    saveState()
  }

  async function saveCustomPreset(name: string) {
    if (!name.trim()) return
    if (!window.electronAPI?.equalizer) return
    try {
      await window.electronAPI.equalizer.savePreset(name.trim(), [...bands.value])
      customPresets.value = { ...customPresets.value, [name.trim()]: [...bands.value] }
      currentPreset.value = name.trim()
    } catch { /* ignore */ }
  }

  async function deleteCustomPreset(name: string) {
    if (!window.electronAPI?.equalizer) return
    try {
      await window.electronAPI.equalizer.deletePreset(name)
      const updated = { ...customPresets.value }
      delete updated[name]
      customPresets.value = updated
      if (currentPreset.value === name) {
        currentPreset.value = 'flat'
      }
    } catch { /* ignore */ }
  }

  return {
    enabled, bands, currentPreset, customPresets, allPresets,
    savedPresetName, isLoaded,
    loadState, setBand, setPreset, toggleEnabled, resetAll,
    saveCustomPreset, deleteCustomPreset,
  }
}
