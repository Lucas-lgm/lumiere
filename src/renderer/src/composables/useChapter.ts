import { ref, computed, type Ref } from 'vue'

export interface ChapterInfo {
  title: string
  time: number
  startPercent: number
  endPercent: number
  widthPercent: number
}

interface UseChapterOptions {
  duration: Ref<number>
  currentTime: Ref<number>
  onUserInteraction: () => void
  commitSeek: (time: number) => void
}

export function useChapter(options: UseChapterOptions) {
  const { duration, currentTime, onUserInteraction, commitSeek } = options

  const rawChapters = ref<{ title: string; time: number }[]>([])

  const chapters = computed<ChapterInfo[]>(() => {
    if (!duration.value || duration.value <= 0 || rawChapters.value.length <= 1) return []
    return rawChapters.value.map((ch, i) => {
      const startPct = (ch.time / duration.value) * 100
      const nextTime = i < rawChapters.value.length - 1 ? rawChapters.value[i + 1].time : duration.value
      const endPct = (nextTime / duration.value) * 100
      return {
        title: ch.title,
        time: ch.time,
        startPercent: startPct,
        endPercent: endPct,
        widthPercent: endPct - startPct
      }
    })
  })

  // Hover tooltip state
  const hoveredChapter = ref<ChapterInfo | null>(null)
  const hoveredChapterIndex = ref(-1)

  const hoveredChapterEndTime = computed(() => {
    if (!hoveredChapter.value) return 0
    const idx = hoveredChapterIndex.value
    if (idx < rawChapters.value.length - 1) return rawChapters.value[idx + 1].time
    return duration.value
  })

  const chapterTooltipLeft = computed(() => {
    if (!hoveredChapter.value) return 0
    return hoveredChapter.value.startPercent + hoveredChapter.value.widthPercent / 2
  })

  function onChapterHover(ch: ChapterInfo, index: number) {
    hoveredChapter.value = ch
    hoveredChapterIndex.value = index
  }

  function onChapterLeave() {
    hoveredChapter.value = null
    hoveredChapterIndex.value = -1
  }

  function onChapterClick(ch: ChapterInfo) {
    if (!duration.value || duration.value <= 0) return
    onUserInteraction()
    commitSeek(ch.time)
  }

  // Navigation
  function chapterPrev() {
    if (!duration.value || rawChapters.value.length <= 1) return
    onUserInteraction()
    const ct = currentTime.value
    let targetIdx = 0
    for (let i = rawChapters.value.length - 1; i >= 0; i--) {
      if (rawChapters.value[i].time <= ct) { targetIdx = i; break }
    }
    if (ct - rawChapters.value[targetIdx].time < 2 && targetIdx > 0) targetIdx--
    commitSeek(rawChapters.value[targetIdx].time)
  }

  function chapterNext() {
    if (!duration.value || rawChapters.value.length <= 1) return
    onUserInteraction()
    const ct = currentTime.value
    for (let i = 0; i < rawChapters.value.length; i++) {
      if (rawChapters.value[i].time > ct + 0.5) {
        commitSeek(rawChapters.value[i].time)
        return
      }
    }
  }

  // Fetch from mpv
  async function fetchChapters() {
    if (!window.electronAPI?.playerProperty?.get) return
    try {
      let list = await window.electronAPI.playerProperty.get('chapter-list')
      // Native binding may return JSON string instead of array
      if (typeof list === 'string') {
        try { list = JSON.parse(list) } catch { list = [] }
      }
      if (Array.isArray(list)) {
        rawChapters.value = list.map((c: { title?: string; time?: number }) => ({ title: c.title || '', time: c.time || 0 }))
      }
    } catch {
      rawChapters.value = []
    }
  }

  return {
    rawChapters,
    chapters,
    hoveredChapter,
    hoveredChapterIndex,
    hoveredChapterEndTime,
    chapterTooltipLeft,
    onChapterHover,
    onChapterLeave,
    onChapterClick,
    chapterPrev,
    chapterNext,
    fetchChapters
  }
}
