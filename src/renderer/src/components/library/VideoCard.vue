<template>
  <!-- Grid view -->
  <div
    v-if="viewMode === 'grid'"
    class="vc"
    @click="$emit('play', video)"
    @contextmenu.prevent="$emit('context-menu', $event, video)"
  >
    <div class="vc-thumb" :style="thumbGradient">
      <Icon name="film" :size="26" class="vc-thumb-icon" />
      <img
        v-if="thumbnailUrl"
        :src="thumbnailUrl"
        class="vc-thumb-img"
        @error="thumbnailUrl = null"
      />
      <!-- Hover play button -->
      <div class="vc-play-overlay">
        <div class="vc-play-btn"></div>
      </div>
      <!-- Duration badge -->
      <span v-if="video.duration" class="vc-dur">{{ formatDuration(video.duration) }}</span>
      <!-- Source badge -->
      <SourceBadge v-if="video.source !== 'local'" :source="video.source" class="vc-src-badge" />
      <!-- Watch status indicators -->
      <div v-if="watchStatus === 'completed'" class="watched-badge"><Icon name="check" :size="10" /></div>
      <div v-else-if="watchStatus === 'unwatched'" class="unwatched-dot"></div>
      <!-- Progress bar for watching items -->
      <div v-if="watchStatus === 'watching' && watchPercent > 0" class="vc-progress">
        <div class="vc-progress-f" :style="{ width: watchPercent + '%' }"></div>
      </div>
    </div>
    <div class="vc-body">
      <div class="vc-title">{{ video.name }}</div>
      <div class="vc-meta">
        <span v-if="video.size" class="vc-meta-t">{{ formatSize(video.size) }}</span>
      </div>
    </div>
  </div>

  <!-- List view -->
  <div
    v-else
    class="lv-item"
    @click="$emit('play', video)"
    @contextmenu.prevent="$emit('context-menu', $event, video)"
  >
    <div class="lv-thumb" :style="thumbGradient">
      <Icon name="film" :size="18" />
      <img
        v-if="thumbnailUrl"
        :src="thumbnailUrl"
        class="lv-thumb-img"
        @error="thumbnailUrl = null"
      />
    </div>
    <div class="lv-info">
      <div class="lv-name">{{ video.name }}</div>
      <div class="lv-sub">
        <span v-if="video.duration" class="lv-dur">{{ formatDuration(video.duration) }}</span>
        <SourceBadge v-if="video.source !== 'local'" :source="video.source" />
      </div>
    </div>
    <!-- Progress bar for list view -->
    <div v-if="watchStatus === 'watching' && watchPercent > 0" class="lv-progress-wrap">
      <div class="lv-progress"><div class="lv-progress-f" :style="{ width: watchPercent + '%' }"></div></div>
      <span class="lv-progress-t">{{ $t('videoGrid.resumeAt', { percent: watchPercent }) }}</span>
    </div>
    <span v-if="video.size" class="lv-size">{{ formatSize(video.size) }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'
import SourceBadge from './SourceBadge.vue'
import { useThumbnail } from '../../composables/useThumbnail'
import { useWatchProgress } from '../../composables/useWatchProgress'
import type { MediaResource, ViewMode } from '../../types/media'

const { t } = useI18n()

interface Props {
  video: MediaResource
  viewMode?: ViewMode
}

const props = withDefaults(defineProps<Props>(), {
  viewMode: 'grid'
})

defineEmits<{
  play: [video: MediaResource]
  'context-menu': [event: MouseEvent, video: MediaResource]
}>()

const { getThumbnail } = useThumbnail()
const { allProgress } = useWatchProgress()

const thumbnailUrl = ref<string | null>(null)

const watchProgress = computed(() => allProgress.value.get(props.video.path) || null)
const watchStatus = computed(() => watchProgress.value?.status || null)
const watchPercent = computed(() => {
  const p = watchProgress.value
  if (!p || !p.duration) return 0
  return Math.min(100, Math.round((p.currentTime / p.duration) * 100))
})

const thumbGradient = computed(() => {
  if (thumbnailUrl.value) return {}
  const gradients = [
    'background:linear-gradient(135deg,#1a1230,#0d0820)',
    'background:linear-gradient(135deg,#0f1a2a,#0a1018)',
    'background:linear-gradient(135deg,#1a0a0a,#120505)',
    'background:linear-gradient(135deg,#0a1a12,#060f0a)',
    'background:linear-gradient(135deg,#181218,#0e0a0e)',
    'background:linear-gradient(135deg,#1a1508,#100d04)'
  ]
  let hash = 0
  for (let i = 0; i < props.video.name.length; i++) {
    hash = ((hash << 5) - hash) + props.video.name.charCodeAt(i)
    hash |= 0
  }
  return gradients[Math.abs(hash) % gradients.length]
})

onMounted(async () => {
  if (props.video.path && !props.video.path.startsWith('http')) {
    const url = await getThumbnail(props.video.path)
    if (url) {
      thumbnailUrl.value = url
    }
  }
})

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
</script>

<style scoped>
/* ========== GRID CARD ========== */
.vc {
  background: var(--bg);
  border-radius: var(--r2);
  border: none;
  box-shadow: var(--shadow-card);
  overflow: hidden;
  cursor: pointer;
  transition: all .18s;
}

.vc:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-card-hover);
}

.vc-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  position: relative;
  overflow: hidden;
}

.vc:hover .vc-thumb {
  transform: scale(1.02);
  transition: transform .25s cubic-bezier(.4, 0, .2, 1);
}

.vc-thumb-icon {
  z-index: 0;
  color: rgba(255, 255, 255, .2);
}

.vc-thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
}

.vc-play-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(.85);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .9);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all .25s ease;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .3);
  z-index: 4;
}

.vc-play-btn::after {
  content: '';
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 7px 0 7px 12px;
  border-color: transparent transparent transparent #1d1d1f;
  margin-left: 2px;
  display: block;
}

.vc:hover .vc-play-overlay {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.vc-dur {
  position: absolute;
  bottom: 6px;
  right: 6px;
  background: rgba(0, 0, 0, .75);
  backdrop-filter: blur(4px);
  color: #fff;
  font-size: 10px;
  font-weight: 500;
  padding: 2px 5px;
  border-radius: 4px;
  z-index: 2;
}

.vc-src-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
}

/* Watch status indicators */
.watched-badge {
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(52, 199, 89, .85);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #fff;
  font-weight: 700;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .3);
  z-index: 2;
}

.unwatched-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--acc);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
  z-index: 2;
}

.vc-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(0, 0, 0, .4);
  z-index: 2;
}

.vc-progress-f {
  height: 100%;
  background: var(--acc);
}

.vc-body {
  padding: 8px 9px 9px;
}

.vc-title {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
  color: var(--t1);
}

.vc-meta {
  display: flex;
  align-items: center;
  gap: 5px;
}

.vc-meta-t {
  font-size: 10px;
  color: var(--t3);
}

/* ========== LIST VIEW ========== */
.lv-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: var(--r1);
  cursor: pointer;
  transition: all var(--dur-fast);
  border-bottom: 1px solid var(--bd);
}

.lv-item:last-child {
  border-bottom: none;
}

.lv-item:hover {
  background: var(--bg-h);
}

.lv-thumb {
  width: 64px;
  height: 36px;
  border-radius: 5px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  position: relative;
  color: rgba(255, 255, 255, .2);
}

.lv-thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lv-info {
  flex: 1;
  overflow: hidden;
}

.lv-name {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--t1);
}

.lv-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
}

.lv-dur {
  font-size: 11px;
  color: var(--t3);
}

.lv-progress-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.lv-progress {
  width: 80px;
  height: 3px;
  border-radius: 2px;
  background: rgba(0, 0, 0, .08);
}

[data-theme="dark"] .lv-progress {
  background: rgba(255, 255, 255, .1);
}

.lv-progress-f {
  height: 100%;
  border-radius: 2px;
  background: var(--acc);
}

.lv-progress-t {
  font-size: 10px;
  color: var(--t3);
  white-space: nowrap;
}

.lv-size {
  font-size: 11px;
  color: var(--t3);
  min-width: 50px;
  text-align: right;
  flex-shrink: 0;
}
</style>
