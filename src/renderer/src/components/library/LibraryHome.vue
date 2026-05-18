<template>
  <div class="lib-content">
    <div class="lib-home">
      <!-- Continue watching (hero cards) — only show when there's watching progress -->
      <div v-if="continueWatchingItems.length > 0" class="lib-section">
        <div class="lib-section-head">
          <div class="lib-section-title">{{ $t('library.continueWatching') }}</div>
          <div
            v-if="continueWatchingItems.length > 3"
            class="lib-section-more"
            @click="$emit('show-all', 'continue-watching')"
          >
            {{ $t('library.viewAll') }}
          </div>
        </div>
        <div class="lib-hero-scroll">
          <HeroCard
            v-for="item in continueWatchingItems"
            :key="item.mediaPath"
            :title="getFileName(item.mediaPath)"
            :subtitle="formatResumeTime(item)"
            :file-path="item.mediaPath"
            :progress-percent="getProgressPercent(item)"
            @play="$emit('play-resume', item)"
          />
        </div>
      </div>

      <!-- Recently added (grid) -->
      <div class="lib-section">
        <div class="lib-section-head">
          <div class="lib-section-title">{{ $t('library.recentlyAdded') }}</div>
          <div v-if="hasMore" class="lib-section-more" @click="$emit('show-all', 'recent')">
            {{ $t('library.viewAll') }}
          </div>
        </div>

        <!-- Scanning: skeleton screen placeholder -->
        <div v-if="scanning" class="lib-grid-skeleton">
          <div v-for="i in 6" :key="i" class="skel-card">
            <div class="skel-thumb skel-pulse"></div>
            <div class="skel-body">
              <div class="skel-line skel-line-title skel-pulse"></div>
              <div class="skel-line skel-line-meta skel-pulse"></div>
            </div>
          </div>
        </div>

        <!-- Display videos after scanning completes -->
        <VideoGrid
          v-if="!scanning"
          :videos="recentVideos"
          view-mode="grid"
          :loading="loading"
          @video-play="$emit('video-play', $event)"
          @video-context-menu="(e, v) => $emit('video-context-menu', e, v)"
          @add-file="$emit('add-file')"
          @add-folder="$emit('add-folder')"
          @add-url="$emit('add-url')"
        />

        <!-- Scanning hint -->
        <div v-if="scanning" class="lib-scanning-hint">
          <div class="lib-scanning-spinner"></div>
          <span class="lib-scanning-text">{{ $t('library.scanning', { count: scanTotal }) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import HeroCard from './HeroCard.vue'
import VideoGrid from './VideoGrid.vue'
import { useWatchProgress } from '../../composables/useWatchProgress'
import { useThumbnail } from '../../composables/useThumbnail'
import type { MediaResource, ViewMode } from '../../types/media'

const { t } = useI18n()

interface Props {
  videos: MediaResource[]
  viewMode?: ViewMode
  loading?: boolean
  scanning?: boolean
  scanTotal?: number
}

const props = withDefaults(defineProps<Props>(), {
  viewMode: 'grid',
  loading: false,
  scanning: false,
  scanTotal: 0
})

defineEmits<{
  'video-play': [video: MediaResource]
  'video-context-menu': [event: MouseEvent, video: MediaResource]
  'play-resume': [progress: any]
  'show-all': [section: string]
  'add-file': []
  'add-folder': []
  'add-url': []
}>()

const {
  continueWatchingList,
  formatResumeTime,
  getProgressPercent,
  fetchContinueWatching
} = useWatchProgress()

const { generateBatch } = useThumbnail()

const continueWatchingItems = computed(() => continueWatchingList.value)

// Sort by addedAt descending, limit to 12 items
const recentVideos = computed(() => {
  return [...props.videos]
    .sort((a, b) => {
      const aTime = a.addedAt ? new Date(a.addedAt).getTime() : 0
      const bTime = b.addedAt ? new Date(b.addedAt).getTime() : 0
      return bTime - aTime
    })
    .slice(0, 12)
})

const hasMore = computed(() => props.videos.length > 12)

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

onMounted(() => {
  fetchContinueWatching()

  // Trigger batch thumbnail generation for visible videos
  const localPaths = props.videos
    .filter(v => v.source === 'local' || v.source === 'mounted')
    .map(v => v.path)
    .slice(0, 20)

  if (localPaths.length > 0) {
    generateBatch(localPaths)
  }
})
</script>

<style scoped>
.lib-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.lib-home {
  padding: 0 14px 14px;
}

.lib-section {
  margin-top: 24px;
}

.lib-section:first-child {
  margin-top: 14px;
}

.lib-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 2px;
  gap: 8px;
}

.lib-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--t1);
}

.lib-section-sub {
  font-size: 11px;
  color: var(--t3);
  flex: 1;
}

.lib-section-more {
  font-size: 11px;
  color: var(--t3);
  cursor: pointer;
  transition: color var(--dur-fast);
  white-space: nowrap;
}

.lib-section-more:hover {
  color: var(--acc);
}

/* Hero scroll container */
.lib-hero-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.lib-hero-scroll::-webkit-scrollbar {
  display: none;
}

/* Skeleton grid — mirrors .lib-grid-content layout */
.lib-grid-skeleton {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  gap: 11px;
}

.skel-card {
  background: var(--bg-e);
  border-radius: var(--r2);
  border: 1px solid var(--bd);
  overflow: hidden;
}

.skel-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
}

.skel-body {
  padding: 10px 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skel-line {
  border-radius: 3px;
  height: 10px;
}

.skel-line-title {
  width: 70%;
}

.skel-line-meta {
  width: 40%;
  height: 8px;
}

.skel-pulse {
  background: var(--bd);
  animation: skel-pulse 1.4s ease-in-out infinite;
}

@keyframes skel-pulse {
  0%, 100% { opacity: .4; }
  50% { opacity: .15; }
}

/* Scanning hint below skeleton */
.lib-scanning-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}

.lib-scanning-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--bd);
  border-top-color: var(--acc);
  border-radius: 50%;
  animation: lib-spin .8s linear infinite;
  flex-shrink: 0;
}

@keyframes lib-spin {
  to { transform: rotate(360deg); }
}

.lib-scanning-text {
  font-size: 12px;
  color: var(--t3);
}

/* ===== RESPONSIVE ===== */
/* ≤500px: reduce padding, narrow hero card */
@media (max-width: 500px) {
  .lib-home {
    padding: 0 8px 8px;
  }

  .lib-section {
    margin-top: 16px;
  }

  .lib-grid-skeleton {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
  }
}

/* ≤400px: even smaller hero card at very narrow widths, two-column skeleton */
@media (max-width: 400px) {
  .lib-home {
    padding: 0 6px 6px;
  }

  .lib-section {
    margin-top: 12px;
  }

  .lib-hero-scroll {
    gap: 6px;
  }

  .lib-grid-skeleton {
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }
}
</style>
