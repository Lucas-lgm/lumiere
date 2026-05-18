<template>
  <SlidePanel
    :visible="visible"
    :title="$t('panel.playlist.title')"
    icon="list-video"
    :context="context"
    @close="$emit('close')"
  >
    <template #default>
      <div class="pl-content">
        <!-- Header controls -->
        <div class="pl-controls">
          <span class="pl-meta">{{ $t('panel.playlist.videoCount', { n: playlist.length }) }}</span>
          <div class="pl-actions">
            <button class="pl-loop-btn" @click="cycleLoopMode">
              <Icon :name="loopIcon" :size="12" />
              {{ loopLabel }}
            </button>
            <button class="btn-ic" :title="$t('panel.playlist.batchToggleTitle')" @click="toggleBatchMode">
              <Icon :name="batchMode ? 'x' : 'check'" :size="12" />
            </button>
          </div>
        </div>

        <!-- Batch mode bar -->
        <div v-if="batchMode" class="pl-batch">
          <span class="pl-batch-count">{{ $t('panel.playlist.selectedCount', { n: selectedItems.size }) }}</span>
          <button class="btn-sm" @click="removeSelected" :disabled="selectedItems.size === 0">{{ $t('panel.playlist.remove') }}</button>
          <button class="btn-sm" @click="exportM3u" :disabled="selectedItems.size === 0">{{ $t('panel.playlist.saveM3u') }}</button>
          <button class="pl-batch-done" @click="toggleBatchMode"><Icon name="x" :size="11" /> {{ $t('panel.playlist.done') }}</button>
        </div>

        <!-- Playlist items -->
        <div class="pl-items" v-if="playlist.length > 0" ref="listRef" @dragover.prevent="onDragOver" @drop="onDrop" @dragleave="onDragLeave">
          <div
            v-for="(item, index) in playlist"
            :key="item.path"
            :class="['pl-item', {
              on: item.path === currentPath,
              dragging: dragIndex === index
            }]"
            :style="getItemDragStyle(index)"
            @dblclick="handleItemClick(item, index)"
          >
            <!-- Batch checkbox -->
            <div
              v-if="batchMode"
              :class="['pl-check', { on: selectedItems.has(index) }]"
              @click.stop="toggleSelect(index)"
            >
              <Icon v-if="selectedItems.has(index)" name="check" :size="10" />
            </div>

            <!-- Drag handle -->
            <div
              class="pl-drag"
              draggable="true"
              @dragstart="onDragStart($event, index)"
              @dragend="onDragEnd"
            ><Icon name="grip-vertical" :size="12" /></div>

            <!-- Index / playing indicator -->
            <span class="pl-idx">
              <template v-if="item.path === currentPath">
                <Icon name="play" :size="10" />
              </template>
              <template v-else>{{ index + 1 }}</template>
            </span>

            <!-- Icon -->
            <span class="pl-icon"><Icon name="film" :size="16" /></span>

            <!-- Info -->
            <div class="pl-info">
              <div class="pl-name" :title="item.name">{{ item.name }}</div>
              <div class="pl-dur">{{ item.source || $t('panel.playlist.sourceLocal') }}</div>
            </div>

            <!-- Remove (non-batch) -->
            <button
              v-if="!batchMode && item.path !== currentPath"
              class="pl-remove"
              :title="$t('panel.playlist.removeTitle')"
              @click.stop="removeItem(index)"
            >
              <Icon name="x" :size="12" />
            </button>
          </div>

        </div>

        <!-- Empty state -->
        <div v-else class="pl-empty">
          <Icon name="list-video" :size="32" />
          <span>{{ $t('panel.playlist.empty') }}</span>
        </div>
      </div>
    </template>
  </SlidePanel>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SlidePanel from '../base/SlidePanel.vue'
import Icon from '../base/Icon.vue'
import { getPlayerSDK } from '../../core/sdk'
import { usePlayerStore } from '../../stores/usePlayerStore'

const { t } = useI18n()

interface Props {
  visible: boolean
  context?: 'player' | 'library'
  currentPath?: string
}

const props = withDefaults(defineProps<Props>(), {
  context: 'player',
  currentPath: ''
})

const emit = defineEmits<{
  close: []
  'play-item': [item: any]
}>()

const sdk = getPlayerSDK()
const playerStore = usePlayerStore()

// State
const batchMode = ref(false)
const selectedItems = ref(new Set<number>())
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)
const listRef = ref<HTMLElement | null>(null)

const isNoOpDrop = computed(() => {
  if (dragIndex.value === null || dropIndex.value === null) return true
  return dropIndex.value === dragIndex.value || dropIndex.value === dragIndex.value + 1
})

// Playlist is a plain JS array in SDK — not reactive.
// Use a ref copy and manually refresh after mutations.
const playlist = ref<any[]>([...sdk.getPlaylist()])

const refreshPlaylist = () => {
  playlist.value = [...sdk.getPlaylist()]
}

// Refresh when panel opens
watch(() => props.visible, (val) => {
  if (val) refreshPlaylist()
})

const loopIcon = computed(() => {
  switch (playerStore.playlist.loopMode) {
    case 'list': return 'repeat'
    case 'single': return 'repeat-1'
    case 'shuffle': return 'shuffle'
    default: return 'arrow-right'
  }
})

const loopLabel = computed(() => {
  switch (playerStore.playlist.loopMode) {
    case 'list': return t('panel.playlist.loopList')
    case 'single': return t('panel.playlist.loopSingle')
    case 'shuffle': return t('panel.playlist.loopShuffle')
    default: return t('panel.playlist.loopNone')
  }
})

const cycleLoopMode = () => {
  playerStore.cycleLoopMode(refreshPlaylist)
}

const toggleBatchMode = () => {
  batchMode.value = !batchMode.value
  if (!batchMode.value) selectedItems.value.clear()
}

const toggleSelect = (index: number) => {
  if (selectedItems.value.has(index)) {
    selectedItems.value.delete(index)
  } else {
    selectedItems.value.add(index)
  }
}

const removeSelected = () => {
  const indices = [...selectedItems.value]
    .filter(i => playlist.value[i]?.path !== props.currentPath)
    .sort((a, b) => b - a)
  indices.forEach(i => sdk.removeFromPlaylist(i))
  selectedItems.value.clear()
  refreshPlaylist()
}

const removeItem = (index: number) => {
  if (playlist.value[index]?.path === props.currentPath) return
  sdk.removeFromPlaylist(index)
  refreshPlaylist()
}

const exportM3u = () => {
  const items = playlist.value
  const selected = [...selectedItems.value].sort((a, b) => a - b)
  const paths = selected.map(i => items[i]?.path).filter(Boolean)
  const content = '#EXTM3U\n' + paths.join('\n')
  const blob = new Blob([content], { type: 'audio/x-mpegurl' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'playlist.m3u'
  a.click()
  URL.revokeObjectURL(url)
}

const handleItemClick = (item: any, _index: number) => {
  if (batchMode.value) return
  emit('play-item', item)
}

// Per-item translateY style for visual shifting during drag
const itemHeight = ref(40)

const getItemDragStyle = (index: number): Record<string, string> => {
  const di = dragIndex.value
  const dp = dropIndex.value
  if (di === null || dp === null || isNoOpDrop.value) return { transition: `transform var(--dur-normal) ease` }
  if (index === di) return {}

  if (di < dp) {
    if (index > di && index < dp) {
      return { transform: `translateY(-${itemHeight.value}px)`, transition: `transform var(--dur-normal) ease` }
    }
  } else {
    if (index >= dp && index < di) {
      return { transform: `translateY(${itemHeight.value}px)`, transition: `transform var(--dur-normal) ease` }
    }
  }
  return { transition: `transform var(--dur-normal) ease` }
}

const onDragStart = (e: DragEvent, index: number) => {
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    const itemEl = (e.target as HTMLElement).closest('.pl-item') as HTMLElement | null
    if (itemEl) {
      const rect = itemEl.getBoundingClientRect()
      e.dataTransfer.setDragImage(itemEl, e.clientX - rect.left, e.clientY - rect.top)
      const next = itemEl.nextElementSibling as HTMLElement | null
      if (next && next.classList.contains('pl-item')) {
        itemHeight.value = next.getBoundingClientRect().top - rect.top
      } else {
        itemHeight.value = itemEl.offsetHeight
      }
    }
  }
  dragIndex.value = index
  dropIndex.value = index
}

const onDragOver = (e: DragEvent) => {
  if (dragIndex.value === null || !listRef.value) return
  const items = listRef.value.querySelectorAll('.pl-item')
  let target = playlist.value.length
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect()
    if (e.clientY < rect.top + rect.height / 2) {
      target = i
      break
    }
  }
  dropIndex.value = target
}

const onDragLeave = (e: DragEvent) => {
  if (!listRef.value) return
  const related = e.relatedTarget as Node | null
  if (!related || !listRef.value.contains(related)) {
    dropIndex.value = dragIndex.value
  }
}

const onDrop = (e: DragEvent) => {
  e.preventDefault()
  if (dragIndex.value !== null && dropIndex.value !== null && !isNoOpDrop.value) {
    const insertAt = dropIndex.value > dragIndex.value ? dropIndex.value - 1 : dropIndex.value
    sdk.movePlaylistItem(dragIndex.value, insertAt)
  }
  dragIndex.value = null
  dropIndex.value = null
  refreshPlaylist()
}

const onDragEnd = () => {
  dragIndex.value = null
  dropIndex.value = null
  refreshPlaylist()
}
</script>

<style scoped>
.pl-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.pl-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.pl-meta {
  font-size: 10px;
  color: var(--p-t2);
}

.pl-actions {
  display: flex;
  gap: 5px;
  align-items: center;
}

.pl-loop-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 7px;
  border-radius: var(--r1);
  font-size: 11px;
  color: var(--p-t2);
  background: rgba(255, 255, 255, 0.06);
  border: none;
  cursor: pointer;
  transition: all var(--dur-fast);
}

.pl-loop-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--p-t1);
}

.btn-ic {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--p-t2);
  cursor: pointer;
  transition: all var(--dur-fast);
}

.btn-ic:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--p-t1);
}

.pl-batch {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--p-bd);
  background: rgba(255, 255, 255, 0.04);
  border-radius: var(--r1);
  padding: 6px 8px;
}

.pl-batch-count {
  font-size: 11px;
  color: var(--p-t1);
  flex: 1;
}

.btn-sm {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: var(--r1);
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: var(--p-t2);
  cursor: pointer;
  transition: all var(--dur-fast);
}

.btn-sm:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--p-t1);
}

.btn-sm:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.pl-batch-done {
  margin-left: auto;
  padding: 3px 10px;
  border-radius: var(--r1);
  font-size: 11px;
  color: var(--p-t2);
  cursor: pointer;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  transition: all var(--dur-fast);
}

.pl-batch-done:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--p-t1);
}

.pl-items {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

.pl-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border-radius: var(--r1);
  cursor: pointer;
  transition: all var(--dur-fast);
}

.pl-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.pl-item.on {
  background: rgba(255, 255, 255, 0.08);
}

.pl-item.dragging {
  opacity: 0.3;
  transform: scale(0.98);
  transition: none;
}

.pl-check {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--p-bd);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.pl-check.on {
  background: var(--acc);
  border-color: var(--acc);
  color: #fff;
}

.pl-drag {
  color: var(--p-t2);
  opacity: 0.4;
  cursor: grab;
  flex-shrink: 0;
}

.pl-drag:active {
  cursor: grabbing;
}

.pl-idx {
  font-size: 11px;
  color: var(--p-t2);
  min-width: 16px;
  text-align: right;
  flex-shrink: 0;
}

.pl-item.on .pl-idx {
  color: var(--p-t1);
}

.pl-icon {
  flex-shrink: 0;
  color: var(--p-t2);
}

.pl-info {
  flex: 1;
  overflow: hidden;
}

.pl-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--p-t1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pl-item.on .pl-name {
  color: var(--p-t1);
  font-weight: 600;
}

.pl-dur {
  font-size: 10px;
  color: var(--p-t2);
  margin-top: 1px;
}

.pl-remove {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--p-t2);
  opacity: 0;
  cursor: pointer;
  border-radius: 4px;
  transition: all var(--dur-fast);
}

.pl-item:hover .pl-remove {
  opacity: 1;
}

.pl-remove:hover {
  background: rgba(255, 96, 96, 0.15);
  color: #ff6060;
}


.pl-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--p-t2);
  opacity: 0.5;
  font-size: 12px;
}
</style>
