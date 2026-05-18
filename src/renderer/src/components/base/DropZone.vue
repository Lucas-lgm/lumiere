<template>
  <Transition name="dz-fade">
    <div v-if="dragging" class="drop-zone">
      <div class="drop-zone-inner">
        <div class="drop-zone-icon">
          <Icon name="folder-open" :size="36" color="var(--acc)" />
        </div>
        <div class="drop-zone-title">{{ $t('dropZone.title') }}</div>
        <div class="drop-zone-hint">{{ $t('dropZone.hint') }}</div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Icon from './Icon.vue'
// useI18n is used via $t in template

const emit = defineEmits<{
  'drop-videos': [files: File[]]
  'drop-subtitles': [files: File[]]
  'drop-folders': [paths: string[]]
  'drop-unsupported': [count: number]
}>()

const dragging = ref(false)
let dragCounter = 0

const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v', 'mpg', 'mpeg', 'vob', 'rmvb', 'rm', '3gp'])
const SUBTITLE_EXTS = new Set(['srt', 'ass', 'ssa', 'sub', 'idx', 'vtt', 'lrc'])

function getExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  dragCounter++
  if (dragCounter === 1) dragging.value = true
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    dragging.value = false
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  dragCounter = 0
  dragging.value = false

  if (!e.dataTransfer) return

  const files = Array.from(e.dataTransfer.files)
  if (files.length === 0) return

  const videos: File[] = []
  const subtitles: File[] = []
  const folders: string[] = []
  let unsupported = 0

  for (const file of files) {
    const ext = getExt(file.name)
    // Electron exposes .path on File objects
    const filePath = (file as any).path as string | undefined

    if (file.type === '' && filePath) {
      // Likely a folder (no MIME type, has path)
      folders.push(filePath)
    } else if (SUBTITLE_EXTS.has(ext)) {
      subtitles.push(file)
    } else if (VIDEO_EXTS.has(ext) || file.type.startsWith('video/')) {
      videos.push(file)
    } else {
      unsupported++
    }
  }

  if (videos.length > 0) emit('drop-videos', videos)
  if (subtitles.length > 0) emit('drop-subtitles', subtitles)
  if (folders.length > 0) emit('drop-folders', folders)
  if (unsupported > 0) emit('drop-unsupported', unsupported)
}

onMounted(() => {
  window.addEventListener('dragenter', handleDragEnter)
  window.addEventListener('dragover', handleDragOver)
  window.addEventListener('dragleave', handleDragLeave)
  window.addEventListener('drop', handleDrop)
})

onUnmounted(() => {
  window.removeEventListener('dragenter', handleDragEnter)
  window.removeEventListener('dragover', handleDragOver)
  window.removeEventListener('dragleave', handleDragLeave)
  window.removeEventListener('drop', handleDrop)
})
</script>

<style scoped>
.drop-zone {
  position: fixed;
  inset: 0;
  z-index: 8000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--acc-d);
  pointer-events: none;
}

.drop-zone-inner {
  border: 3px dashed var(--acc);
  border-radius: var(--r2);
  padding: 40px 60px;
  text-align: center;
}

.drop-zone-icon {
  margin-bottom: 8px;
  opacity: .7;
}

.drop-zone-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--acc);
  margin-bottom: 4px;
}

.drop-zone-hint {
  font-size: 11px;
  color: var(--t3);
}

.dz-fade-enter-active,
.dz-fade-leave-active {
  transition: opacity var(--dur-fast) ease;
}

.dz-fade-enter-from,
.dz-fade-leave-to {
  opacity: 0;
}
</style>
