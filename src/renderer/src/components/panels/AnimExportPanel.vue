<template>
  <SlidePanel
    :visible="visible"
    :title="$t('panel.animExport.title')"
    icon="film"
    :context="context"
    @close="$emit('close')"
  >
    <template #default>
      <div class="gif-content">
        <!-- Time range -->
        <div class="gif-section">
          <div class="gif-label">{{ $t('panel.animExport.timeRange') }}</div>
          <!-- Mark buttons: click to capture current playback position -->
          <div class="gif-mark-row">
            <button
              class="gif-mark-btn"
              :disabled="isExporting"
              @click="startTime = currentTime"
            >
              <span class="gif-mark-label">A</span>
              <span class="gif-mark-time">{{ formatTime(startTime) }}</span>
            </button>
            <span class="gif-time-sep">→</span>
            <button
              class="gif-mark-btn"
              :disabled="isExporting"
              @click="endTime = currentTime"
            >
              <span class="gif-mark-label">B</span>
              <span class="gif-mark-time">{{ formatTime(endTime) }}</span>
            </button>
          </div>
          <div class="gif-mark-hint">{{ $t('panel.animExport.markHint') }}</div>
          <div class="gif-duration">
            {{ $t('panel.animExport.duration') }}: {{ formatTime(Math.max(0, endTime - startTime)) }}
          </div>
          <div v-if="endTime - startTime > 30" class="gif-warn">
            {{ $t('panel.animExport.longDurationWarn') }}
          </div>
        </div>

        <!-- FPS -->
        <div class="gif-section">
          <div class="gif-label">{{ $t('panel.animExport.fps') }}</div>
          <div class="gif-seg">
            <button
              v-for="f in fpsOptions"
              :key="f"
              :class="['gif-seg-btn', { active: fps === f }]"
              :disabled="isExporting"
              @click="fps = f"
            >{{ f }}fps</button>
          </div>
        </div>

        <!-- Scale -->
        <div class="gif-section">
          <div class="gif-label">{{ $t('panel.animExport.scale') }}</div>
          <div class="gif-seg">
            <button
              v-for="s in scaleOptions"
              :key="s"
              :class="['gif-seg-btn', { active: scale === s }]"
              :disabled="isExporting"
              @click="scale = s"
            >{{ Math.round(s * 100) }}%</button>
          </div>
        </div>

        <!-- Quality -->
        <div class="gif-section">
          <div class="gif-label">{{ $t('panel.animExport.quality') }}</div>
          <div class="gif-seg">
            <button
              v-for="q in qualityOptions"
              :key="q.value"
              :class="['gif-seg-btn', { active: quality === q.value }]"
              :disabled="isExporting"
              @click="quality = q.value"
            >{{ $t(q.label) }}</button>
          </div>
        </div>

        <!-- Estimate -->
        <div class="gif-estimate">
          {{ $t('panel.animExport.estimate', { frames: estimatedFrames }) }}
        </div>

        <!-- Progress -->
        <div v-if="isExporting" class="gif-progress-section">
          <div class="gif-progress-bar">
            <div class="gif-progress-fill" :style="{ width: (progress * 100) + '%' }"></div>
          </div>
          <div class="gif-progress-text">
            {{ $t('panel.animExport.extracting', { current: currentFrame, total: totalFrames }) }}
          </div>
        </div>

        <!-- Actions -->
        <div class="gif-actions">
          <button
            v-if="!isExporting"
            class="gif-btn gif-btn-primary"
            :disabled="!canExport"
            @click="doExport"
          >{{ $t('panel.animExport.export') }}</button>
          <button
            v-if="isExporting"
            class="gif-btn gif-btn-cancel"
            @click="doCancel"
          >{{ $t('panel.animExport.cancel') }}</button>
        </div>
      </div>
    </template>
  </SlidePanel>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SlidePanel from '../base/SlidePanel.vue'
import { formatTime } from '../../composables/useProgressBar'
import { injectStrict, playerTimelineKey, playerCoreKey } from '../../composables/playerInjectKeys'

const props = defineProps<{
  visible: boolean
  context: string
}>()

defineEmits<{ close: [] }>()

const { t } = useI18n()
const { abLoop } = injectStrict(playerTimelineKey)
const { currentTime, duration, currentPath } = injectStrict(playerCoreKey)

const fpsOptions = [10, 15, 24] as const
const scaleOptions = [0.5, 0.75, 1.0] as const
const qualityOptions = [
  { value: 'fast' as const, label: 'panel.animExport.qualityFast' },
  { value: 'high' as const, label: 'panel.animExport.qualityHigh' },
]

const startTime = ref(0)
const endTime = ref(0)
const fps = ref<10 | 15 | 24>(15)
const scale = ref<0.5 | 0.75 | 1.0>(0.5)
const quality = ref<'fast' | 'high'>('high')

const isExporting = ref(false)
const progress = ref(0)
const currentFrame = ref(0)
const totalFrames = ref(0)

const estimatedFrames = computed(() =>
  Math.max(1, Math.floor((endTime.value - startTime.value) * fps.value))
)

const canExport = computed(() =>
  endTime.value > startTime.value &&
  endTime.value - startTime.value <= 30 &&
  !isExporting.value
)

// Auto-fill from AB loop
watch(() => props.visible, (v) => {
  if (v) {
    if (abLoop.value.a !== null && abLoop.value.b !== null) {
      startTime.value = abLoop.value.a
      endTime.value = abLoop.value.b
    } else if (duration.value > 0) {
      startTime.value = Math.max(0, currentTime.value - 2)
      endTime.value = Math.min(duration.value, currentTime.value + 3)
    }
  }
})

const unsubs: (() => void)[] = []

async function doExport() {
  const api = window.electronAPI?.animExport
  if (!api) return

  // Show save dialog
  const outputPath = await api.selectOutput()
  if (!outputPath) return

  isExporting.value = true
  progress.value = 0
  currentFrame.value = 0
  totalFrames.value = estimatedFrames.value

  api.start({
    videoPath: currentPath.value || '',
    startTime: startTime.value,
    endTime: endTime.value,
    fps: fps.value,
    scale: scale.value,
    quality: quality.value,
    outputPath,
  })
}

function doCancel() {
  window.electronAPI?.animExport?.cancel()
  isExporting.value = false
}

onMounted(() => {
  const api = window.electronAPI?.animExport
  if (!api) return

  unsubs.push(api.onProgress((data: any) => {
    progress.value = data.progress || 0
    currentFrame.value = data.currentFrame || 0
    totalFrames.value = data.totalFrames || 0
  }))

  unsubs.push(api.onComplete(() => {
    isExporting.value = false
    progress.value = 1
  }))

  unsubs.push(api.onError(() => {
    isExporting.value = false
  }))
})

onUnmounted(() => {
  unsubs.forEach(fn => fn())
})
</script>

<style scoped>
.gif-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0;
  overflow: hidden;
  min-width: 0;
}

.gif-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gif-label {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.gif-mark-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.gif-mark-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  box-sizing: border-box;
}

.gif-mark-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.gif-mark-btn:active:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
}

.gif-mark-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.gif-mark-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--acc);
  flex-shrink: 0;
}

.gif-mark-time {
  font-size: 12px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.85);
}

.gif-mark-hint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
}

.gif-time-sep {
  color: rgba(255, 255, 255, 0.3);
  font-size: 12px;
  flex-shrink: 0;
}

.gif-duration {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.gif-warn {
  font-size: 11px;
  color: #ff9f0a;
}

.gif-seg {
  display: flex;
  gap: 4px;
  min-width: 0;
}

.gif-seg-btn {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
  box-sizing: border-box;
}

.gif-seg-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.gif-seg-btn.active {
  background: var(--acc);
  border-color: var(--acc);
  color: #fff;
  font-weight: 600;
}

.gif-seg-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.gif-estimate {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.gif-progress-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gif-progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.gif-progress-fill {
  height: 100%;
  background: var(--acc);
  border-radius: 2px;
  transition: width 0.2s ease;
}

.gif-progress-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
}

.gif-actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
  min-width: 0;
}

.gif-btn {
  flex: 1;
  height: 32px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.gif-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.gif-btn-primary {
  background: var(--acc);
  color: #fff;
}

.gif-btn-primary:hover:not(:disabled) {
  background: var(--acc-h);
}

.gif-btn-cancel {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

.gif-btn-cancel:hover {
  background: rgba(255, 255, 255, 0.15);
}
</style>
