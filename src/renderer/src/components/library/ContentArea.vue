<template>
  <div class="lib-content">
    <div class="lib-home">
      <div v-if="title" class="lib-section">
        <ContentHeader :title="title" :subtitle="subtitle" />
      </div>
      <VideoGrid
        :videos="videos"
        :view-mode="viewMode"
        :loading="loading"
        @video-play="$emit('video-play', $event)"
        @video-context-menu="(e, v) => $emit('video-context-menu', e, v)"
        @add-file="$emit('add-file')"
        @add-folder="$emit('add-folder')"
        @add-url="$emit('add-url')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import ContentHeader from './ContentHeader.vue'
import VideoGrid from './VideoGrid.vue'
import type { MediaResource, ViewMode } from '../../types/media'

interface Props {
  title: string
  subtitle?: string
  videos: MediaResource[]
  viewMode?: ViewMode
  loading?: boolean
}

withDefaults(defineProps<Props>(), {
  subtitle: '',
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
.lib-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.lib-home {
  padding: 0 14px 14px;
}

.lib-section {
  margin-top: 14px;
}
</style>
