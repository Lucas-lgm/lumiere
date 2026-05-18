<template>
  <div class="expanded-view">
    <!-- Custom toolbar: ← Home / title / search + view toggle -->
    <div class="expanded-toolbar">
      <div class="expanded-back" @click="$emit('back')">
        <Icon name="chevron-left" :size="14" /> {{ $t('expandedView.back') }}
      </div>
      <div class="expanded-title">{{ title }}</div>
      <div class="expanded-actions">
        <button class="expanded-search-btn" @click="searchVisible = !searchVisible">
          <Icon name="search" :size="14" />
        </button>
        <button
          class="expanded-toggle"
          @click="localViewMode = localViewMode === 'grid' ? 'list' : 'grid'"
        >
          <Icon :name="localViewMode === 'grid' ? 'list' : 'grip-vertical'" :size="12" />
          {{ localViewMode === 'grid' ? $t('expandedView.list') : $t('expandedView.grid') }}
        </button>
      </div>
    </div>

    <!-- Collapsible search bar -->
    <div v-if="searchVisible" class="expanded-search-wrap">
      <SearchBox
        ref="searchBoxRef"
        :model-value="localSearch"
        :placeholder="$t('expandedView.searchPlaceholder')"
        @update:model-value="localSearch = $event"
      />
    </div>

    <!-- Content -->
    <div class="expanded-content">
      <VideoGrid
        :videos="displayVideos"
        :view-mode="localViewMode"
        :loading="false"
        @video-play="$emit('video-play', $event)"
        @video-context-menu="(e, v) => $emit('video-context-menu', e, v)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'
import SearchBox from '../base/SearchBox.vue'
import VideoGrid from './VideoGrid.vue'
import type { MediaResource, ViewMode } from '../../types/media'

const { t } = useI18n()

interface Props {
  title: string
  videos: MediaResource[]
}

const props = defineProps<Props>()

defineEmits<{
  back: []
  'video-play': [video: MediaResource]
  'video-context-menu': [event: MouseEvent, video: MediaResource]
}>()

const localViewMode = ref<ViewMode>('grid')
const searchVisible = ref(false)
const localSearch = ref('')
const searchBoxRef = ref<InstanceType<typeof SearchBox> | null>(null)

// Auto-focus search when shown
watch(searchVisible, (visible) => {
  if (visible) {
    nextTick(() => searchBoxRef.value?.focus())
  } else {
    localSearch.value = ''
  }
})

const displayVideos = computed(() => {
  if (!localSearch.value.trim()) return props.videos
  const query = localSearch.value.toLowerCase()
  return props.videos.filter(v =>
    v.name.toLowerCase().includes(query) ||
    v.path.toLowerCase().includes(query)
  )
})
</script>

<style scoped>
.expanded-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.expanded-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  background: var(--bg-s);
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}

.expanded-back {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--t3);
  cursor: pointer;
  transition: color var(--dur-fast);
}

.expanded-back:hover {
  color: var(--acc);
}

.expanded-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--t1);
}

.expanded-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
  align-items: center;
}

.expanded-search-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--r1);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--t3);
  background: transparent;
  border: none;
  font-family: inherit;
  transition: all var(--dur-fast);
}

.expanded-search-btn:hover {
  color: var(--t1);
  background: var(--bg-h);
}

.expanded-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--t3);
  padding: 4px 8px;
  border-radius: var(--r1);
  background: var(--bg-e);
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition: all var(--dur-fast);
}

.expanded-toggle:hover {
  color: var(--t1);
  background: var(--bg-h);
}

.expanded-search-wrap {
  padding: 6px 14px;
  background: var(--bg-s);
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}

.expanded-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 14px;
}
</style>
