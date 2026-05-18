<template>
  <SlidePanel
    :visible="visible"
    :title="$t('panel.mediaInfo.title')"
    icon="info"
    :context="context"
    @close="$emit('close')"
  >
    <div class="media-info-content">
      <!-- File overview -->
      <div class="mi-header">
        <div class="mi-thumb">
          <Icon name="clapperboard" :size="22" />
        </div>
        <div class="mi-file-info">
          <div class="mi-filename">{{ fileName }}</div>
          <div class="mi-file-meta">{{ fileSize }} · {{ fileFormat }}</div>
        </div>
      </div>

      <!-- Video section -->
      <div class="mi-group">
        <div class="mi-section-title"><Icon name="film" :size="12" /><span>{{ $t('panel.mediaInfo.sectionVideo') }}</span></div>
        <div class="mi-row"><span class="mi-label">{{ $t('panel.mediaInfo.codec') }}</span><span class="mi-value">{{ info.videoCodec || '—' }}</span></div>
        <div class="mi-row"><span class="mi-label">{{ $t('panel.mediaInfo.resolution') }}</span><span class="mi-value">{{ resolution }}</span></div>
        <div class="mi-row"><span class="mi-label">{{ $t('panel.mediaInfo.fps') }}</span><span class="mi-value">{{ fps }}</span></div>
        <div class="mi-row"><span class="mi-label">{{ $t('panel.mediaInfo.bitrate') }}</span><span class="mi-value">{{ bitrate }}</span></div>
        <div class="mi-row" v-if="info.hdr">
          <span class="mi-label">{{ $t('panel.mediaInfo.hdr') }}</span>
          <span class="mi-value mi-hdr">{{ info.hdr }}</span>
        </div>
        <div class="mi-row"><span class="mi-label">{{ $t('panel.mediaInfo.bitDepth') }}</span><span class="mi-value">{{ info.bitDepth ? info.bitDepth + 'bit' : '—' }}</span></div>
        <div class="mi-row"><span class="mi-label">{{ $t('panel.mediaInfo.pixelFormat') }}</span><span class="mi-value">{{ info.pixelFormat || '—' }}</span></div>
      </div>

      <!-- Audio section -->
      <div class="mi-group" v-if="audioTracks.length">
        <div class="mi-section-title"><Icon name="audio-lines" :size="12" /><span>{{ $t('panel.mediaInfo.sectionAudio') }}</span></div>
        <div class="mi-row" v-for="(track, i) in audioTracks" :key="i">
          <span class="mi-label">{{ $t('panel.mediaInfo.track', { n: i + 1 }) }}</span>
          <span class="mi-value">{{ formatAudioTrack(track) }}</span>
        </div>
      </div>

      <!-- Subtitle section -->
      <div class="mi-group" v-if="subTracks.length">
        <div class="mi-section-title"><Icon name="subtitles" :size="12" /><span>{{ $t('panel.mediaInfo.sectionSubtitle') }}</span></div>
        <div class="mi-row" v-for="(track, i) in subTracks" :key="i">
          <span class="mi-label">{{ $t('panel.mediaInfo.track', { n: i + 1 }) }}</span>
          <span class="mi-value">{{ formatSubTrack(track) }}</span>
        </div>
      </div>

      <!-- File section -->
      <div class="mi-group">
        <div class="mi-section-title"><Icon name="file" :size="12" /><span>{{ $t('panel.mediaInfo.sectionFile') }}</span></div>
        <div class="mi-row"><span class="mi-label">{{ $t('panel.mediaInfo.path') }}</span><span class="mi-value mi-path">{{ info.path || '—' }}</span></div>
        <div class="mi-row"><span class="mi-label">{{ $t('panel.mediaInfo.duration') }}</span><span class="mi-value">{{ duration }}</span></div>
        <div class="mi-row" v-if="info.chapters > 0">
          <span class="mi-label">{{ $t('panel.mediaInfo.chapters') }}</span>
          <span class="mi-value">{{ $t('panel.mediaInfo.chaptersCount', { n: info.chapters }) }}</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="mi-actions">
        <button class="mi-btn" @click="copyInfo"><Icon name="copy" :size="12" /> {{ $t('panel.mediaInfo.copyInfo') }}</button>
        <button class="mi-btn" @click="showInFinder"><Icon name="external-link" :size="12" /> {{ $t('panel.mediaInfo.showInFinder') }}</button>
      </div>
    </div>
  </SlidePanel>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import SlidePanel from '../base/SlidePanel.vue'
import Icon from '../base/Icon.vue'
import { useToast } from '../../composables/useToast'

const { t } = useI18n()

interface Props {
  visible: boolean
  context?: 'player' | 'library'
  mediaPath?: string
  videoReady?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  context: 'player',
  mediaPath: '',
  videoReady: false
})

defineEmits<{
  close: []
}>()

const { success } = useToast()

interface MediaInfoData {
  path?: string
  videoCodec?: string
  width?: number
  height?: number
  fps?: number
  videoBitrate?: number
  hdr?: string
  pixelFormat?: string
  bitDepth?: number
  fileSize?: number
  duration?: number
  chapters?: number
  format?: string
}

const info = ref<MediaInfoData>({})
const audioTracks = ref<any[]>([])
const subTracks = ref<any[]>([])

const fileName = computed(() => {
  if (!info.value.path) return '—'
  return info.value.path.split(/[/\\]/).pop() || '—'
})

const fileSize = computed(() => {
  if (!info.value.fileSize) return '—'
  const gb = info.value.fileSize / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = info.value.fileSize / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
})

const fileFormat = computed(() => info.value.format || '—')

const resolution = computed(() => {
  if (!info.value.width || !info.value.height) return '—'
  const w = info.value.width
  const h = info.value.height
  let tag = ''
  if (w >= 7680) tag = ' (8K)'
  else if (w >= 3840) tag = ' (4K)'
  else if (w >= 2560) tag = ' (2K)'
  else if (w >= 1920) tag = ' (FHD)'
  else if (w >= 1280) tag = ' (HD)'
  return `${w} × ${h}${tag}`
})

const fps = computed(() => {
  if (!info.value.fps) return '—'
  return `${info.value.fps.toFixed(3)} fps`
})

const bitrate = computed(() => {
  if (!info.value.videoBitrate) return '—'
  const mbps = info.value.videoBitrate / 1000000
  return `${mbps.toFixed(1)} Mbps`
})

const duration = computed(() => {
  if (!info.value.duration) return '—'
  const s = Math.floor(info.value.duration)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const ms = Math.round((info.value.duration - s) * 1000)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
})

const formatAudioTrack = (track: any): string => {
  const parts: string[] = []
  if (track.codec) parts.push(track.codec)
  if (track.channels) parts.push(`${track.channels}ch`)
  if (track.lang) parts.push(track.lang)
  return parts.join(' · ') || '—'
}

const formatSubTrack = (track: any): string => {
  const parts: string[] = []
  if (track.codec) parts.push(track.codec)
  if (track.lang) parts.push(track.lang)
  return parts.join(' · ') || '—'
}

// Parse bit depth from pixel format: yuv420p10 → 10, yuv420p → 8
const parseBitDepth = (pixFmt: any): number | undefined => {
  if (!pixFmt) return undefined
  const s = String(pixFmt)
  const m = s.match(/(\d+)(?:le|be)?$/)
  return m ? Number(m[1]) : 8
}

const loadMediaInfo = async () => {
  const prop = window.electronAPI?.playerProperty
  if (!prop) return
  try {
    // getMediaInfo returns { video, audio, file, chapters }, some fields may be missing
    const [mi, path, videoBitrate, gamma, primaries, fileFormat, pixelFormat] = await Promise.all([
      prop.getMediaInfo(),
      prop.get('path'),
      prop.get('video-bitrate'),
      prop.get('video-params/gamma'),
      prop.get('video-params/primaries'),
      prop.get('file-format'),
      prop.get('video-params/pixelformat')
    ])
    if (mi) {
      // HDR detection
      const gammaStr = String(gamma || '')
      const primStr = String(primaries || '')
      let hdr = ''
      if (/pq/i.test(gammaStr)) hdr = 'HDR10'
      else if (/hlg/i.test(gammaStr)) hdr = 'HLG'
      else if (/bt\.2020/i.test(primStr)) hdr = 'HDR'

      info.value = {
        path: String(path || '') || undefined,
        videoCodec: mi.video?.codec ? String(mi.video.codec) : undefined,
        width: Number(mi.video?.width) || undefined,
        height: Number(mi.video?.height) || undefined,
        fps: Number(mi.video?.fps) || undefined,
        videoBitrate: Number(videoBitrate) || undefined,
        hdr: hdr || undefined,
        pixelFormat: pixelFormat ? String(pixelFormat) : undefined,
        bitDepth: parseBitDepth(pixelFormat),
        fileSize: Number(mi.file?.size) || undefined,
        duration: Number(mi.file?.duration) || undefined,
        chapters: Array.isArray(mi.chapters) ? mi.chapters.length : 0,
        format: fileFormat ? String(fileFormat) : undefined
      }
    }
    // Load tracks
    if (window.electronAPI?.player) {
      const tracks = await window.electronAPI.player.getTracks()
      audioTracks.value = (tracks || []).filter((t: any) => t.type === 'audio')
      subTracks.value = (tracks || []).filter((t: any) => t.type === 'sub')
    }
  } catch (e) {
    console.error('Failed to load media info:', e)
  }
}

const copyInfo = async () => {
  const lines = [
    `${t('panel.mediaInfo.copyFile')}: ${fileName.value}`,
    `${t('panel.mediaInfo.copySize')}: ${fileSize.value}`,
    `${t('panel.mediaInfo.copyCodec')}: ${info.value.videoCodec || '—'}`,
    `${t('panel.mediaInfo.copyResolution')}: ${resolution.value}`,
    `${t('panel.mediaInfo.copyFps')}: ${fps.value}`,
    `${t('panel.mediaInfo.copyBitrate')}: ${bitrate.value}`,
    info.value.hdr ? `${t('panel.mediaInfo.hdr')}: ${info.value.hdr}` : '',
    `${t('panel.mediaInfo.copyBitDepth')}: ${info.value.bitDepth ? info.value.bitDepth + 'bit' : '—'}`,
    `${t('panel.mediaInfo.copyPixelFormat')}: ${info.value.pixelFormat || '—'}`,
    `${t('panel.mediaInfo.copyDuration')}: ${duration.value}`,
    `${t('panel.mediaInfo.copyPath')}: ${info.value.path || '—'}`
  ].filter(Boolean)
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    success(t('panel.mediaInfo.copied'))
  } catch { /* ignore */ }
}

const showInFinder = () => {
  if (info.value.path && window.electronAPI?.fileSystem) {
    window.electronAPI.fileSystem.showInFinder(info.value.path)
  }
}

let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryCount = 0
const MAX_RETRIES = 5

function clearRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  retryCount = 0
}

async function scheduleLoad() {
  clearRetry()
  await loadMediaInfo()
  retryForMissing()
}

function retryForMissing() {
  if (retryCount >= MAX_RETRIES) return
  if (info.value.fps && info.value.videoBitrate) return
  retryCount++
  retryTimer = setTimeout(async () => {
    await loadMediaInfo()
    retryForMissing()
  }, 1000)
}

watch(() => props.visible, (v) => {
  if (v && props.videoReady) scheduleLoad()
})

// Clear old data immediately when switching videos
watch(() => props.mediaPath, () => {
  clearRetry()
  info.value = {}
  audioTracks.value = []
  subTracks.value = []
})

// When video finishes loading (playing/paused), load info if panel is open
watch(() => props.videoReady, (ready) => {
  if (ready && props.visible) scheduleLoad()
})

onMounted(() => {
  if (props.visible && props.videoReady) scheduleLoad()
})
</script>

<style scoped>
.media-info-content {
  display: flex;
  flex-direction: column;
}

.mi-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--p-bd);
}

.mi-thumb {
  width: 80px;
  height: 45px;
  border-radius: var(--r1);
  background: linear-gradient(135deg, #1a1230, #0d0820);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.5);
}

.mi-file-info {
  flex: 1;
  min-width: 0;
}

.mi-filename {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mi-file-meta {
  font-size: 10px;
  color: var(--p-t2);
  margin-top: 2px;
}

.mi-group {
  background: rgba(255, 255, 255, 0.04);
  border-radius: var(--r1);
  padding: 10px 12px;
  margin-bottom: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .2);
}

.mi-group:last-of-type {
  margin-bottom: 0;
}

.mi-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--p-t2);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding-bottom: 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--p-bd);
}

.mi-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.mi-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.mi-label {
  font-size: 11px;
  color: var(--p-t2);
  min-width: 50px;
  flex-shrink: 0;
}

.mi-value {
  font-size: 11px;
  color: var(--p-t1);
  text-align: right;
  word-break: break-all;
}

.mi-hdr {
  color: var(--ora);
}

.mi-path {
  font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', monospace;
  font-size: 10px;
}

.mi-actions {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}

.mi-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: var(--r1);
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: var(--p-t2);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--dur-fast);
}

.mi-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--p-t1);
}
</style>
