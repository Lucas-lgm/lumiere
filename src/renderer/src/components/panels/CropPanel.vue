<template>
  <SlidePanel
    :visible="visible"
    :title="$t('panel.crop.title')"
    icon="scissors"
    :context="context"
    @close="$emit('close')"
  >
    <template #default>
      <div class="crop-content">
        <!-- Preview -->
        <div class="crop-preview" ref="previewRef" :style="{ aspectRatio: `${vW} / ${vH}` }">
          <div class="crop-grid">
            <div class="crop-grid-line crop-grid-h1" />
            <div class="crop-grid-line crop-grid-h2" />
            <div class="crop-grid-line crop-grid-v1" />
            <div class="crop-grid-line crop-grid-v2" />
          </div>
          <!-- Dark overlay outside crop area -->
          <div class="crop-mask crop-mask-top" :style="maskTopStyle" />
          <div class="crop-mask crop-mask-bottom" :style="maskBottomStyle" />
          <div class="crop-mask crop-mask-left" :style="maskLeftStyle" />
          <div class="crop-mask crop-mask-right" :style="maskRightStyle" />
          <!-- Crop region border -->
          <div class="crop-region" :style="cropRegionStyle" @mousedown="startMove($event)">
            <div class="crop-handle crop-handle-tl" @mousedown.stop="startResize('tl', $event)" />
            <div class="crop-handle crop-handle-tr" @mousedown.stop="startResize('tr', $event)" />
            <div class="crop-handle crop-handle-bl" @mousedown.stop="startResize('bl', $event)" />
            <div class="crop-handle crop-handle-br" @mousedown.stop="startResize('br', $event)" />
          </div>
        </div>

        <!-- Ratio buttons -->
        <div class="ratio-bar">
          <button
            v-for="r in ratios"
            :key="r.key"
            :class="['ratio-btn', { active: activeRatio === r.key }]"
            @click="setRatio(r)"
          >{{ r.label() }}</button>
        </div>

        <!-- Input fields -->
        <div class="crop-inputs">
          <div class="crop-input-group">
            <label class="crop-input-label">X</label>
            <input class="crop-input" type="number" v-model.number="cropX" @change="onInputChange" />
          </div>
          <div class="crop-input-group">
            <label class="crop-input-label">Y</label>
            <input class="crop-input" type="number" v-model.number="cropY" @change="onInputChange" />
          </div>
          <div class="crop-input-group">
            <label class="crop-input-label" :class="{ linked: activeRatio !== RATIO_FREE }">W</label>
            <input class="crop-input" type="number" v-model.number="cropW" @change="onInputChange" />
          </div>
          <div class="crop-input-group">
            <label class="crop-input-label" :class="{ linked: activeRatio !== RATIO_FREE }">H</label>
            <input class="crop-input" type="number" v-model.number="cropH" @change="onInputChange" />
          </div>
        </div>

        <!-- Actions -->
        <div class="crop-actions">
          <button class="btn-sm" @click="resetCrop">
            <Icon name="refresh" :size="12" /> {{ $t('panel.crop.reset') }}
          </button>
        </div>

        <button class="crop-apply" @click="applyCrop">
          {{ $t('panel.crop.apply') }}
        </button>
      </div>
    </template>
  </SlidePanel>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SlidePanel from '../base/SlidePanel.vue'
import Icon from '../base/Icon.vue'
import { useToast } from '../../composables/useToast'

const { t } = useI18n()

interface Props {
  visible: boolean
  context?: 'player' | 'library'
  videoWidth?: number
  videoHeight?: number
}

const props = withDefaults(defineProps<Props>(), {
  context: 'player',
  videoWidth: 1920,
  videoHeight: 1080
})

const emit = defineEmits<{
  close: []
}>()

const { success } = useToast()

const prop = window.electronAPI?.playerProperty

// Actual video resolution (fetched from mpv when panel opens)
const vW = ref(props.videoWidth)
const vH = ref(props.videoHeight)

// Crop values (in video pixels)
const cropX = ref(0)
const cropY = ref(0)
const cropW = ref(props.videoWidth)
const cropH = ref(props.videoHeight)

const RATIO_FREE = 'free'
const activeRatio = ref(RATIO_FREE)
const previewRef = ref<HTMLElement | null>(null)

interface Ratio {
  key: string
  label: () => string
  value: number | null // w/h ratio, null = free
}

const ratios: Ratio[] = [
  { key: RATIO_FREE, label: () => t('panel.crop.ratioFree'), value: null },
  { key: '16:9', label: () => '16:9', value: 16 / 9 },
  { key: '4:3', label: () => '4:3', value: 4 / 3 },
  { key: '21:9', label: () => '21:9', value: 21 / 9 },
  { key: '1:1', label: () => '1:1', value: 1 }
]

// Preview percentages
const pctX = computed(() => (cropX.value / vW.value) * 100)
const pctY = computed(() => (cropY.value / vH.value) * 100)
const pctW = computed(() => (cropW.value / vW.value) * 100)
const pctH = computed(() => (cropH.value / vH.value) * 100)

const cropRegionStyle = computed(() => ({
  left: `${pctX.value}%`,
  top: `${pctY.value}%`,
  width: `${pctW.value}%`,
  height: `${pctH.value}%`
}))

// Mask styles (dark overlay outside crop)
const maskTopStyle = computed(() => ({ height: `${pctY.value}%` }))
const maskBottomStyle = computed(() => ({ height: `${100 - pctY.value - pctH.value}%` }))
const maskLeftStyle = computed(() => ({
  top: `${pctY.value}%`,
  height: `${pctH.value}%`,
  width: `${pctX.value}%`
}))
const maskRightStyle = computed(() => ({
  top: `${pctY.value}%`,
  height: `${pctH.value}%`,
  width: `${100 - pctX.value - pctW.value}%`
}))

const setRatio = (ratio: Ratio) => {
  activeRatio.value = ratio.key
  if (ratio.value) {
    // Fit within current video dimensions
    const vw = vW.value
    const vh = vH.value
    let w = vw
    let h = Math.round(w / ratio.value)
    if (h > vh) {
      h = vh
      w = Math.round(h * ratio.value)
    }
    cropW.value = w
    cropH.value = h
    cropX.value = Math.round((vw - w) / 2)
    cropY.value = Math.round((vh - h) / 2)
  }
}

const onInputChange = () => {
  // Ratio-locked linkage
  const currentRatio = ratios.find(r => r.key === activeRatio.value)
  if (currentRatio?.value) {
    // If W changed, compute H; if H changed, compute W
    const expectedH = Math.round(cropW.value / currentRatio.value)
    const expectedW = Math.round(cropH.value * currentRatio.value)
    if (expectedH !== cropH.value && expectedW !== cropW.value) {
      // W was changed — adjust H
      cropH.value = expectedH
    }
  }
  // Clamp values
  const minSize = 16
  cropX.value = Math.max(0, Math.min(cropX.value, vW.value - minSize))
  cropY.value = Math.max(0, Math.min(cropY.value, vH.value - minSize))
  cropW.value = Math.max(minSize, Math.min(cropW.value, vW.value - cropX.value))
  cropH.value = Math.max(minSize, Math.min(cropH.value, vH.value - cropY.value))
}

const startMove = (e: MouseEvent) => {
  if (!previewRef.value) return
  const previewRect = previewRef.value.getBoundingClientRect()
  const startX = e.clientX
  const startY = e.clientY
  const startCropX = cropX.value
  const startCropY = cropY.value
  const w = cropW.value
  const h = cropH.value

  const onMouseMove = (ev: MouseEvent) => {
    const dx = Math.round(((ev.clientX - startX) / previewRect.width) * vW.value)
    const dy = Math.round(((ev.clientY - startY) / previewRect.height) * vH.value)
    cropX.value = Math.max(0, Math.min(startCropX + dx, vW.value - w))
    cropY.value = Math.max(0, Math.min(startCropY + dy, vH.value - h))
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

const startResize = (corner: string, e: MouseEvent) => {
  if (!previewRef.value) return
  const previewRect = previewRef.value.getBoundingClientRect()
  const startX = e.clientX
  const startY = e.clientY
  const startCropX = cropX.value
  const startCropY = cropY.value
  const startCropW = cropW.value
  const startCropH = cropH.value

  const minSize = 16
  const clamp = () => {
    cropX.value = Math.max(0, Math.min(cropX.value, vW.value - minSize))
    cropY.value = Math.max(0, Math.min(cropY.value, vH.value - minSize))
    cropW.value = Math.max(minSize, Math.min(cropW.value, vW.value - cropX.value))
    cropH.value = Math.max(minSize, Math.min(cropH.value, vH.value - cropY.value))
  }

  const onMouseMove = (ev: MouseEvent) => {
    const dx = ((ev.clientX - startX) / previewRect.width) * vW.value
    const dy = ((ev.clientY - startY) / previewRect.height) * vH.value

    if (corner === 'tl') {
      cropX.value = Math.round(startCropX + dx)
      cropY.value = Math.round(startCropY + dy)
      cropW.value = Math.round(startCropW - dx)
      cropH.value = Math.round(startCropH - dy)
    } else if (corner === 'tr') {
      cropY.value = Math.round(startCropY + dy)
      cropW.value = Math.round(startCropW + dx)
      cropH.value = Math.round(startCropH - dy)
    } else if (corner === 'bl') {
      cropX.value = Math.round(startCropX + dx)
      cropW.value = Math.round(startCropW - dx)
      cropH.value = Math.round(startCropH + dy)
    } else if (corner === 'br') {
      cropW.value = Math.round(startCropW + dx)
      cropH.value = Math.round(startCropH + dy)
    }
    clamp()
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

const resetCrop = async () => {
  cropX.value = 0
  cropY.value = 0
  activeRatio.value = RATIO_FREE
  if (prop) {
    await prop.set('vf', '')
    try {
      const [w, h] = await Promise.all([prop.get('width'), prop.get('height')])
      const nw = Number(w)
      const nh = Number(h)
      cropW.value = nw > 0 ? nw : vW.value
      cropH.value = nh > 0 ? nh : vH.value
    } catch {
      cropW.value = vW.value
      cropH.value = vH.value
    }
  } else {
    cropW.value = vW.value
    cropH.value = vH.value
  }
}

const applyCrop = async () => {
  if (!prop) return
  const vf = `crop=${cropW.value}:${cropH.value}:${cropX.value}:${cropY.value}`
  await prop.set('vf', vf)
  success(t('panel.crop.applied'))
  emit('close')
}

// Fetch actual video resolution + current crop state from mpv when panel opens
async function fetchVideoDimensions() {
  if (!prop) return
  try {
    const [w, h, vf] = await Promise.all([
      prop.get('width'),
      prop.get('height'),
      prop.get('vf')
    ])
    const nw = Number(w)
    const nh = Number(h)
    if (nw > 0) vW.value = nw
    if (nh > 0) vH.value = nh

    // Parse mpv vf return format: crop=%2%@0=W:%2%@1=H:%2%@2=X:%2%@3=Y
    const vfStr = String(vf || '')
    const m0 = vfStr.match(/%2%@0=(\d+)/)
    const m1 = vfStr.match(/%2%@1=(\d+)/)
    const m2 = vfStr.match(/%2%@2=(\d+)/)
    const m3 = vfStr.match(/%2%@3=(\d+)/)

    if (m0 && m1 && m2 && m3) {
      const cw = Number(m0[1]), ch = Number(m1[1])
      const cx = Number(m2[1]), cy = Number(m3[1])
      // Validate crop values are within current video bounds; out-of-range means residual from previous video
      if (cx + cw <= vW.value && cy + ch <= vH.value && cw > 0 && ch > 0) {
        cropW.value = cw
        cropH.value = ch
        cropX.value = cx
        cropY.value = cy
      } else {
        // Residual filter doesn't match current video, clear it
        await prop.set('vf', '')
        cropW.value = vW.value
        cropH.value = vH.value
        cropX.value = 0
        cropY.value = 0
      }
    } else {
      cropW.value = vW.value
      cropH.value = vH.value
      cropX.value = 0
      cropY.value = 0
    }
    activeRatio.value = RATIO_FREE
  } catch { /* fallback to defaults */ }
}

watch(() => props.visible, (visible) => {
  if (visible) fetchVideoDimensions()
})
</script>

<style scoped>
.crop-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.crop-preview {
  width: 100%;
  background: #0a0a0d;
  border-radius: var(--r1);
  position: relative;
  overflow: hidden;
}

.crop-grid-line {
  position: absolute;
  background: rgba(255, 255, 255, 0.15);
}

.crop-grid-h1 { top: 33.33%; left: 0; right: 0; height: 1px; }
.crop-grid-h2 { top: 66.66%; left: 0; right: 0; height: 1px; }
.crop-grid-v1 { left: 33.33%; top: 0; bottom: 0; width: 1px; }
.crop-grid-v2 { left: 66.66%; top: 0; bottom: 0; width: 1px; }

.crop-mask {
  position: absolute;
  background: rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.crop-mask-top { top: 0; left: 0; right: 0; }
.crop-mask-bottom { bottom: 0; left: 0; right: 0; }
.crop-mask-left { left: 0; }
.crop-mask-right { right: 0; }

.crop-region {
  position: absolute;
  border: 2px solid var(--acc);
  pointer-events: all;
  cursor: move;
}

.crop-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--acc);
  border-radius: 2px;
  pointer-events: all;
  cursor: nwse-resize;
}

.crop-handle-tl { top: -6px; left: -6px; cursor: nwse-resize; }
.crop-handle-tr { top: -6px; right: -6px; cursor: nesw-resize; }
.crop-handle-bl { bottom: -6px; left: -6px; cursor: nesw-resize; }
.crop-handle-br { bottom: -6px; right: -6px; cursor: nwse-resize; }

.ratio-bar {
  display: flex;
  gap: 4px;
}

.ratio-btn {
  flex: 1;
  padding: 4px;
  text-align: center;
  border-radius: var(--r1);
  font-size: 10px;
  font-weight: 500;
  color: var(--p-t2);
  background: rgba(255, 255, 255, 0.06);
  border: none;
  cursor: pointer;
  transition: all var(--dur-fast);
}

.ratio-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.ratio-btn.active {
  background: rgba(0, 122, 255, 0.15);
  color: var(--acc);
}

.crop-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.crop-input-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.crop-input-label {
  font-size: 11px;
  color: var(--p-t2);
  min-width: 14px;
  font-weight: 500;
}

.crop-input-label.linked {
  color: var(--acc);
}

.crop-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--p-bd);
  border-radius: var(--r1);
  padding: 4px 6px;
  font-size: 11px;
  color: var(--p-t1);
  outline: none;
  font-variant-numeric: tabular-nums;
  width: 0;
}

.crop-input:focus {
  border-color: var(--acc);
}

.crop-actions {
  display: flex;
  gap: 6px;
}

.btn-sm {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  padding: 5px 10px;
  border-radius: var(--r1);
  border: 1px solid var(--p-bd);
  background: rgba(255, 255, 255, 0.06);
  color: var(--p-t2);
  cursor: pointer;
  transition: all var(--dur-fast);
}

.btn-sm:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--p-t1);
}

.crop-apply {
  padding: 8px;
  border-radius: var(--r1);
  border: none;
  background: var(--acc);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--dur-fast);
}

.crop-apply:hover {
  background: var(--acc-h);
}
</style>
