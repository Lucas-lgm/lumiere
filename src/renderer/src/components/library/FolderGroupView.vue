<template>
  <div class="lib-content">
    <div class="lib-home">
      <div class="lib-section">
        <div class="lib-section-head">
          <div class="lib-section-title">{{ $t('library.series') }}</div>
          <div class="lib-section-sub">
            {{ $t('library.folders.count', { count: folderGroups.groups.length }) }}
            <template v-if="folderGroups.ungrouped.length > 0">
              · {{ $t('library.folders.ungroupedCount', { count: folderGroups.ungrouped.length }) }}
            </template>
          </div>
        </div>

        <!-- Empty state -->
        <div v-if="folderGroups.groups.length === 0 && folderGroups.ungrouped.length === 0" class="fg-empty">
          <Icon name="folder-open" :size="36" class="fg-empty-icon" />
          <div class="fg-empty-title">{{ $t('library.folders.empty.title') }}</div>
          <div class="fg-empty-sub">{{ $t('library.folders.empty.sub') }}</div>
        </div>

        <!-- Grid view -->
        <template v-else-if="viewMode === 'grid'">
          <div class="fg-grid">
            <FolderCard
              v-for="group in folderGroups.groups"
              :key="group.path"
              :group="group"
              @open="handleFolderOpen"
            />
          </div>
          <!-- Ungrouped files in grid -->
          <div v-if="folderGroups.ungrouped.length > 0" class="fg-ungrouped-section">
            <div class="fg-ungrouped-title">{{ $t('library.ungrouped') }}</div>
            <div class="fg-grid">
              <VideoCard
                v-for="video in folderGroups.ungrouped"
                :key="video.id"
                :video="video"
                view-mode="grid"
                @play="$emit('video-play', $event)"
                @context-menu="(e, v) => $emit('video-context-menu', e, v)"
              />
            </div>
          </div>
        </template>

        <!-- List view -->
        <template v-else>
          <div class="fg-list">
            <FolderListItem
              v-for="group in folderGroups.groups"
              :key="group.path"
              :group="group"
              :default-expanded="folderGroups.groups.length === 1"
              @play-episode="$emit('video-play', $event)"
            />
          </div>
          <!-- Ungrouped files in list -->
          <div v-if="folderGroups.ungrouped.length > 0" class="fg-ungrouped-section">
            <div class="fg-ungrouped-title">{{ $t('library.ungrouped') }}</div>
            <div class="fg-list-ungrouped">
              <VideoCard
                v-for="video in folderGroups.ungrouped"
                :key="video.id"
                :video="video"
                view-mode="list"
                @play="$emit('video-play', $event)"
                @context-menu="(e, v) => $emit('video-context-menu', e, v)"
              />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'
import FolderCard from './FolderCard.vue'
import FolderListItem from './FolderListItem.vue'
import VideoCard from './VideoCard.vue'
import { useFolderGrouping, type FolderGroup } from '../../composables/useFolderGrouping'
import type { MediaResource, ViewMode } from '../../types/media'

const { t } = useI18n()

interface Props {
  videos: MediaResource[]
  viewMode?: ViewMode
}

const props = withDefaults(defineProps<Props>(), {
  viewMode: 'grid'
})

const emit = defineEmits<{
  'video-play': [video: MediaResource]
  'video-context-menu': [event: MouseEvent, video: MediaResource]
  'folder-open': [group: FolderGroup]
}>()

const { folderGroups } = useFolderGrouping(toRef(props, 'videos'))

function handleFolderOpen(group: FolderGroup) {
  emit('folder-open', group)
}
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

/* Grid layout */
.fg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  gap: 11px;
}

/* List layout */
.fg-list {
  padding: 4px 0;
}

/* Ungrouped section */
.fg-ungrouped-section {
  margin-top: 20px;
}

.fg-ungrouped-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--t3);
  margin-bottom: 8px;
  padding: 0 2px;
}

.fg-list-ungrouped {
  padding: 4px 0;
}

/* Empty state */
.fg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 12px;
}

.fg-empty-icon {
  color: var(--t3);
  opacity: .3;
}

.fg-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--t2);
}

.fg-empty-sub {
  font-size: 12px;
  color: var(--t3);
  text-align: center;
  max-width: 300px;
  line-height: 1.5;
}

/* ===== RESPONSIVE ===== */
/* ≤500px: reduce grid minimum column width and gap, consistent with VideoGrid */
@media (max-width: 500px) {
  .lib-home {
    padding: 0 8px 8px;
  }

  .fg-grid {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
  }
}

/* ≤400px: fixed two-column layout at very narrow widths */
@media (max-width: 400px) {
  .lib-home {
    padding: 0 6px 6px;
  }

  .fg-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }
}
</style>
