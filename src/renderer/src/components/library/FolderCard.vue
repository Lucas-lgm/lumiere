<template>
  <!-- Grid view folder card -->
  <div class="fc" :class="{ 'fc-active': group.currentEpisode }" @click="$emit('open', group)">
    <div class="fc-thumb" :style="thumbGradient">
      <!-- 2×2 thumbnail grid -->
      <div class="fc-grid">
        <div v-for="i in 4" :key="i" class="fc-grid-cell">
          <img
            v-if="thumbUrls[i - 1]"
            :src="thumbUrls[i - 1]!"
            class="fc-grid-img"
          />
          <Icon v-else name="film" :size="14" class="fc-grid-placeholder" />
        </div>
      </div>
      <!-- Folder icon overlay -->
      <div class="fc-folder-icon">
        <Icon name="folder" :size="28" />
      </div>
      <!-- Completion badge -->
      <div v-if="isCompleted" class="fc-completed-badge"><Icon name="check" :size="10" /> {{ $t('folderCard.completed') }}</div>
      <!-- Progress bar -->
      <div v-if="overallProgress > 0 && !isCompleted" class="fc-progress">
        <div class="fc-progress-f" :style="{ width: overallProgress + '%' }"></div>
      </div>
    </div>
    <div class="fc-body">
      <div class="fc-title">{{ group.name }}</div>
      <div class="fc-meta">
        <span class="fc-meta-t">
          <template v-if="group.currentEpisode">{{ $t('folderCard.resume', { name: getEpisodeName(group.currentEpisode) }) }}</template>
          <template v-else>{{ $t('folderCard.fileCount', { count: group.totalCount }) }}</template>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'
import { useThumbnail } from '../../composables/useThumbnail'
import type { FolderGroup } from '../../composables/useFolderGrouping'
import type { MediaResource } from '../../types/media'

const { t } = useI18n()

interface Props {
  group: FolderGroup
}

const props = defineProps<Props>()

defineEmits<{
  open: [group: FolderGroup]
}>()

const { getThumbnail } = useThumbnail()
const thumbUrls = ref<(string | null)[]>([null, null, null, null])

const isCompleted = computed(() =>
  props.group.watchedCount === props.group.totalCount && props.group.totalCount > 0
)

const overallProgress = computed(() => {
  if (props.group.totalCount === 0) return 0
  return Math.round((props.group.watchedCount / props.group.totalCount) * 100)
})

const thumbGradient = computed(() => {
  const gradients = [
    'linear-gradient(135deg,#0a1a12,#060f0a)',
    'linear-gradient(135deg,#1a1230,#0d0820)',
    'linear-gradient(135deg,#0f1a2a,#0a1018)',
    'linear-gradient(135deg,#1a0a0a,#120505)',
    'linear-gradient(135deg,#181218,#0e0a0e)',
    'linear-gradient(135deg,#1a1508,#100d04)'
  ]
  let hash = 0
  for (let i = 0; i < props.group.name.length; i++) {
    hash = ((hash << 5) - hash) + props.group.name.charCodeAt(i)
    hash |= 0
  }
  return { background: gradients[Math.abs(hash) % gradients.length] }
})

function getEpisodeName(item: MediaResource): string {
  // Extract filename without extension
  const name = item.name.replace(/\.[^.]+$/, '')
  return name
}

onMounted(async () => {
  // Load thumbnails for the first 4 items
  const items = props.group.items.slice(0, 4)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.path && !item.path.startsWith('http')) {
      const url = await getThumbnail(item.path)
      if (url) {
        thumbUrls.value[i] = url
      }
    }
  }
})
</script>

<style scoped>
.fc {
  background: var(--bg-e);
  border-radius: var(--r2);
  border: 1px solid var(--bd);
  overflow: hidden;
  cursor: pointer;
  transition: all .18s;
}

.fc:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-card-hover);
}

.fc-active {
  box-shadow: var(--shadow-card-hover);
}

.fc-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  position: relative;
  overflow: hidden;
}

.fc:hover .fc-thumb {
  transform: scale(1.02);
  transition: transform .25s cubic-bezier(.4, 0, .2, 1);
}

/* 2×2 grid */
.fc-grid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  opacity: .7;
}

.fc-grid-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .2);
  overflow: hidden;
  position: relative;
}

.fc-grid-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fc-grid-placeholder {
  color: rgba(255, 255, 255, .15);
}

/* Folder icon overlay */
.fc-folder-icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, .8);
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, .8));
  z-index: 1;
}

/* Completion badge */
.fc-completed-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(40, 200, 64, .2);
  border: 1px solid rgba(40, 200, 64, .4);
  border-radius: 3px;
  font-size: 9px;
  color: var(--grn);
  padding: 1px 5px;
  font-weight: 600;
  z-index: 2;
}

/* Progress bar */
.fc-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(0, 0, 0, .4);
  z-index: 2;
}

.fc-progress-f {
  height: 100%;
  background: var(--acc);
}

.fc-body {
  padding: 8px 9px 9px;
}

.fc-title {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
  color: var(--t1);
}

.fc-meta {
  display: flex;
  align-items: center;
  gap: 5px;
}

.fc-meta-t {
  font-size: 10px;
  color: var(--t3);
}
</style>
