import { ref } from 'vue'

export function useMediaMeta() {
  const isHdr = ref(false)
  const hdrEnabled = ref(true)
  const actualVideoWidth = ref(1920)
  const actualVideoHeight = ref(1080)
  const mediaMetaFetched = ref(false)

  async function detectHdr() {
    if (!window.electronAPI?.playerProperty?.get) return
    try {
      const [gamma, primaries, w, h] = await Promise.all([
        window.electronAPI.playerProperty.get('video-params/gamma'),
        window.electronAPI.playerProperty.get('video-params/primaries'),
        window.electronAPI.playerProperty.get('width'),
        window.electronAPI.playerProperty.get('height')
      ])
      isHdr.value = /pq|hlg/i.test(String(gamma || '')) || /bt\.2020/i.test(String(primaries || ''))
      const nw = Number(w)
      const nh = Number(h)
      if (nw > 0) actualVideoWidth.value = nw
      if (nh > 0) actualVideoHeight.value = nh
    } catch {
      isHdr.value = false
    }
  }

  function resetMetaGuard() {
    mediaMetaFetched.value = false
  }

  return {
    isHdr,
    hdrEnabled,
    actualVideoWidth,
    actualVideoHeight,
    mediaMetaFetched,
    detectHdr,
    resetMetaGuard
  }
}
