<template>
  <!-- Loading state -->
  <div v-if="loading" class="empty">
    <div class="loading-spinner"></div>
    <div class="empty-title">{{ $t('videoGrid.loading') }}</div>
  </div>

  <!-- Empty state (B4) -->
  <div v-else-if="videos.length === 0" class="empty">
    <span class="empty-icon"><Icon name="clapperboard" :size="44" /></span>
    <div class="empty-title">{{ $t('videoGrid.emptyTitle') }}</div>
    <div class="empty-sub">{{ $t('videoGrid.emptySub') }}</div>
    <div class="drop-hint">
      <Icon name="folder-open" :size="16" />
      <span>{{ $t('videoGrid.dropHint') }}</span>
    </div>
    <div class="empty-actions">
      <button class="btn-p" @click="$emit('add-file')">{{ $t('videoGrid.openFile') }}</button>
      <button class="btn-s" @click="$emit('add-folder')">{{ $t('videoGrid.addFolder') }}</button>
      <button class="btn-s" @click="$emit('add-url')">{{ $t('videoGrid.pasteUrl') }}</button>
    </div>
  </div>

  <!-- Grid view -->
  <div v-else-if="viewMode === 'grid'" class="lib-grid-content">
    <VideoCard
      v-for="video in videos"
      :key="video.id"
      :video="video"
      view-mode="grid"
      @play="$emit('video-play', $event)"
      @context-menu="(e, v) => $emit('video-context-menu', e, v)"
    />
  </div>

  <!-- List view (B3) -->
  <div v-else class="lib-list">
    <VideoCard
      v-for="video in videos"
      :key="video.id"
      :video="video"
      view-mode="list"
      @play="$emit('video-play', $event)"
      @context-menu="(e, v) => $emit('video-context-menu', e, v)"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'
import VideoCard from './VideoCard.vue'
import type { MediaResource, ViewMode } from '../../types/media'

const { t } = useI18n()

interface Props {
  videos: MediaResource[]
  viewMode?: ViewMode
  loading?: boolean
}

withDefaults(defineProps<Props>(), {
  viewMode: 'grid',
  loading: false
})

defineEmits<{
  'video-play': [video: MediaResource]
  'video-context-menu': [event: MouseEvent, video: MediaResource]
  'add-file': []
  'add-folder': []
  'add-url': []
}>()
</script>

<style scoped>
/* Grid layout — design spec: minmax(158px, 1fr) */
.lib-grid-content {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  gap: 11px;
}

/* List layout */
.lib-list {
  padding: 8px 0;
}

/* Empty state (B4) */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 12px;
  min-height: 280px;
}

.empty-icon {
  font-size: 44px;
  opacity: .3;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--t2);
}

.empty-sub {
  font-size: 12px;
  color: var(--t3);
  text-align: center;
  max-width: 300px;
  line-height: 1.5;
}

.empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.drop-hint {
  width: 100%;
  max-width: 320px;
  border: 1.5px dashed var(--bd-h);
  border-radius: var(--r2);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  font-size: 12px;
  color: var(--t3);
  gap: 8px;
  transition: all .2s;
}

.drop-hint.drag-over {
  border-color: var(--acc);
  background: rgba(0, 122, 255, .06);
  color: var(--acc);
}

/* Loading spinner */
.loading-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid var(--bd);
  border-top-color: var(--acc);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== RESPONSIVE ===== */
/* ≤500px: reduce grid minimum column width and gap */
@media (max-width: 500px) {
  .lib-grid-content {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
  }
}

/* ≤400px: fixed two-column layout at very narrow widths, further reduce gap */
@media (max-width: 400px) {
  .lib-grid-content {
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }

  .empty {
    padding: 40px 12px;
  }
}
</style>
