<template>
  <div class="fl" :class="{ expanded }">
    <!-- Folder header -->
    <div class="fl-header" :class="{ 'fl-header-expanded': expanded }" @click="toggleExpand">
      <span class="fl-arrow"><Icon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="12" /></span>
      <Icon name="folder" :size="18" class="fl-folder-icon" />
      <div class="fl-info">
        <div class="fl-name">{{ group.name }}</div>
        <div class="fl-sub">
          {{ $t('folderListItem.episodes', { count: group.totalCount }) }}
          <template v-if="group.currentEpisode"> · {{ $t('folderListItem.recentPlay', { name: getShortName(group.currentEpisode) }) }}</template>
        </div>
      </div>
      <!-- Progress bar (header) -->
      <div v-if="overallProgress > 0" class="fl-header-progress">
        <div class="fl-header-progress-bar">
          <div class="fl-header-progress-f" :style="{ width: overallProgress + '%' }"></div>
        </div>
      </div>
      <!-- Quick-resume button (collapsed only) -->
      <button
        v-if="!expanded && group.currentEpisode"
        class="fl-resume-btn"
        @click.stop="$emit('play-episode', group.currentEpisode!)"
      >
        <Icon name="play" :size="10" /> {{ $t('folderListItem.resume', { name: getShortName(group.currentEpisode) }) }}
      </button>
    </div>

    <!-- Episode list (expanded) -->
    <Transition name="fl-expand">
    <div v-if="expanded" class="fl-episodes">
      <template v-for="item in visibleItems" :key="item.id">
        <div
          class="fl-ep"
          :class="{
            'fl-ep-watching': getStatus(item) === 'watching',
            'fl-ep-watched': getStatus(item) === 'completed'
          }"
          @click="$emit('play-episode', item)"
        >
          <span class="fl-ep-status">
            <template v-if="getStatus(item) === 'completed'"><Icon name="check-circle" :size="14" class="fl-ep-icon-done" /></template>
            <template v-else-if="getStatus(item) === 'watching'"><Icon name="play" :size="14" class="fl-ep-icon-playing" /></template>
            <template v-else><Icon name="circle" :size="14" class="fl-ep-icon-unwatched" /></template>
          </span>
          <div class="fl-ep-info">
            <div class="fl-ep-name" :class="{ 'fl-ep-name-acc': getStatus(item) === 'watching' }">
              {{ item.name }}
            </div>
            <!-- Progress bar for watching episode -->
            <div v-if="getStatus(item) === 'watching'" class="fl-ep-progress-wrap">
              <div class="fl-ep-progress">
                <div class="fl-ep-progress-f" :style="{ width: getPercent(item) + '%' }"></div>
              </div>
              <span class="fl-ep-progress-t">{{ $t('folderListItem.resumeAt', { percent: getPercent(item) }) }}</span>
            </div>
            <div v-else class="fl-ep-dur">
              {{ item.duration ? formatDuration(item.duration) : '' }}
            </div>
          </div>
          <span class="fl-ep-label">
            <template v-if="getStatus(item) === 'completed'">{{ $t('folderListItem.status.completed') }}</template>
            <template v-else-if="getStatus(item) === 'watching'">{{ $t('folderListItem.status.watching') }}</template>
            <template v-else>{{ $t('folderListItem.status.unwatched') }}</template>
          </span>
        </div>
      </template>

      <!-- Show all toggle -->
      <div
        v-if="group.items.length > maxVisibleItems && !showAll"
        class="fl-show-all"
        @click.stop="showAll = true"
      >
        <Icon name="chevron-down" :size="10" /> {{ $t('folderListItem.showAll', { count: group.items.length }) }}
      </div>
    </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'
import { useWatchProgress } from '../../composables/useWatchProgress'
import type { FolderGroup } from '../../composables/useFolderGrouping'
import type { MediaResource } from '../../types/media'

const { t } = useI18n()

interface Props {
  group: FolderGroup
  defaultExpanded?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  defaultExpanded: false
})

defineEmits<{
  'play-episode': [item: MediaResource]
}>()

const { allProgress } = useWatchProgress()

const expanded = ref(props.defaultExpanded)
const showAll = ref(false)
const maxVisibleItems = 5

const visibleItems = computed(() => {
  if (showAll.value) return props.group.items
  return props.group.items.slice(0, maxVisibleItems)
})

const overallProgress = computed(() => {
  if (props.group.totalCount === 0) return 0
  return Math.round((props.group.watchedCount / props.group.totalCount) * 100)
})

function toggleExpand() {
  expanded.value = !expanded.value
  if (!expanded.value) showAll.value = false
}

function getStatus(item: MediaResource): string {
  const progress = allProgress.value.get(item.path)
  return progress?.status || 'unwatched'
}

function getPercent(item: MediaResource): number {
  const progress = allProgress.value.get(item.path)
  if (!progress || !progress.duration) return 0
  return Math.min(100, Math.round((progress.currentTime / progress.duration) * 100))
}

function getShortName(item: MediaResource): string {
  return item.name.replace(/\.[^.]+$/, '')
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.fl {
  border-radius: var(--r2);
  border: 1px solid var(--bd);
  overflow: hidden;
  margin-bottom: 8px;
}

/* Folder header */
.fl-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: var(--bg-e);
  cursor: pointer;
  transition: background var(--dur-fast);
}

.fl-header:hover {
  background: var(--bg-h);
}

.fl-header-expanded {
  background: var(--bg-h);
}

.fl-arrow {
  color: var(--t3);
  font-size: 12px;
  width: 14px;
  flex-shrink: 0;
  transition: color var(--dur-fast);
}

.fl-header-expanded .fl-arrow {
  color: var(--acc);
}

.fl-folder-icon {
  color: var(--t3);
  flex-shrink: 0;
}

.fl-info {
  flex: 1;
  overflow: hidden;
}

.fl-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--t1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fl-sub {
  font-size: 10px;
  color: var(--t3);
  margin-top: 1px;
}

/* Header progress bar */
.fl-header-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.fl-header-progress-bar {
  width: 80px;
  height: 3px;
  border-radius: 2px;
  background: var(--bg-h);
}

.fl-header-progress-f {
  height: 100%;
  border-radius: 2px;
  background: var(--acc);
}

/* Quick-resume button */
.fl-resume-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: var(--r1);
  background: var(--acc-d);
  border: 1px solid rgba(0, 122, 255, .35);
  font-size: 10px;
  font-weight: 500;
  color: var(--acc);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--dur-fast);
  font-family: inherit;
}

.fl-resume-btn:hover {
  background: rgba(0, 122, 255, .15);
}

/* Episode list */
.fl-episodes {
  background: var(--bg-e);
}

.fl-ep {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px 7px 36px;
  border-top: 1px solid var(--bd);
  cursor: pointer;
  transition: background .12s;
}

.fl-ep:hover {
  background: var(--bg-h);
}

.fl-ep-watching {
  background: var(--acc-d);
}

.fl-ep-status {
  font-size: 14px;
  flex-shrink: 0;
}

.fl-ep-icon-done {
  color: var(--grn);
}

.fl-ep-icon-playing {
  color: var(--acc);
}

.fl-ep-icon-unwatched {
  color: var(--t3);
  opacity: .4;
}

.fl-ep-info {
  flex: 1;
  overflow: hidden;
}

.fl-ep-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--t1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fl-ep-name-acc {
  color: var(--acc);
}

.fl-ep-dur {
  font-size: 10px;
  color: var(--t3);
}

/* Episode progress bar */
.fl-ep-progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
}

.fl-ep-progress {
  width: 80px;
  height: 2px;
  border-radius: 1px;
  background: var(--bg-h);
}

.fl-ep-progress-f {
  height: 100%;
  border-radius: 1px;
  background: var(--acc);
}

.fl-ep-progress-t {
  font-size: 10px;
  color: var(--acc);
}

.fl-ep-label {
  font-size: 10px;
  flex-shrink: 0;
}

.fl-ep-watched .fl-ep-label {
  color: var(--grn);
}

.fl-ep-watching .fl-ep-label {
  color: var(--acc);
}

.fl-ep:not(.fl-ep-watched):not(.fl-ep-watching) .fl-ep-label {
  color: var(--t3);
}

.fl-ep:not(.fl-ep-watched):not(.fl-ep-watching) .fl-ep-name {
  color: var(--t2);
}

/* Show all link */
.fl-show-all {
  padding: 7px 12px 7px 36px;
  font-size: 10px;
  color: var(--t3);
  cursor: pointer;
  border-top: 1px solid var(--bd);
  transition: color var(--dur-fast);
}

.fl-show-all:hover {
  color: var(--acc);
}

/* Expand/collapse transition */
.fl-expand-enter-active,
.fl-expand-leave-active {
  transition: opacity var(--dur-fast) ease, max-height var(--dur-normal) ease;
  overflow: hidden;
}

.fl-expand-enter-from,
.fl-expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.fl-expand-enter-to,
.fl-expand-leave-from {
  max-height: 1000px;
}
</style>
