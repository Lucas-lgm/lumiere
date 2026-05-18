<template>
  <SlidePanel
    :visible="visible"
    :title="$t('panel.picture.title')"
    icon="sliders-horizontal"
    :context="context"
    @close="$emit('close')"
  >
    <template #default>
      <div class="picture-content">
        <!-- Sliders -->
        <div class="pr" v-for="slider in sliders" :key="slider.prop">
          <span class="pr-l">{{ slider.label }}</span>
          <div class="sl-wrap">
            <input
              type="range"
              class="sl-input"
              :value="slider.value.value"
              :min="slider.min"
              :max="slider.max"
              step="1"
              :style="sliderBg(slider.value.value, slider.min, slider.max)"
              @input="setSlider(slider, Number(($event.target as HTMLInputElement).value))"
            />
            <span class="sl-v">{{ formatSliderValue(slider.value.value) }}</span>
          </div>
        </div>

        <!-- HDR -->
        <div :class="['pr', { disabled: !props.isHdr }]">
          <div>
            <div class="pr-l">{{ $t('panel.picture.hdrMode') }}</div>
            <div class="pr-hint">{{ $t('panel.picture.hdrHint') }}</div>
          </div>
          <button :class="['toggle', { on: hdrEnabled }]" :disabled="!props.isHdr" @click="toggleHdr"></button>
        </div>

        <!-- Rotation -->
        <div class="pr">
          <span class="pr-l">{{ $t('panel.picture.rotation') }}</span>
          <div class="rotation-controls">
            <button class="btn-ic" @click="rotate(-90)"><Icon name="rotate-ccw" :size="12" /></button>
            <span class="rotation-value">{{ rotation }}°</span>
            <button class="btn-ic" @click="rotate(90)"><Icon name="rotate-cw" :size="12" /></button>
          </div>
        </div>

        <!-- Horizontal Flip -->
        <div class="pr">
          <span class="pr-l">{{ $t('panel.picture.hFlip') }}</span>
          <button :class="['toggle', { on: hFlip }]" @click="toggleHFlip"></button>
        </div>

        <!-- Reset -->
        <button class="reset-btn" @click="resetAll">{{ $t('panel.picture.resetAll') }}</button>
      </div>
    </template>
  </SlidePanel>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SlidePanel from '../base/SlidePanel.vue'
import Icon from '../base/Icon.vue'

const { t } = useI18n()

interface Props {
  visible: boolean
  context?: 'player' | 'library'
  isHdr?: boolean
  hdrEnabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  context: 'player',
  isHdr: false,
  hdrEnabled: true
})

defineEmits<{
  close: []
}>()

const prop = window.electronAPI?.playerProperty

// Slider values
const brightness = ref(0)
const contrast = ref(0)
const saturation = ref(0)
const hue = ref(0)
const sharpen = ref(0)

const gamma = ref(0)

const sliders = computed(() => [
  { label: t('panel.picture.brightness'), prop: 'brightness', value: brightness, min: -100, max: 100 },
  { label: t('panel.picture.contrast'), prop: 'contrast', value: contrast, min: -100, max: 100 },
  { label: t('panel.picture.saturation'), prop: 'saturation', value: saturation, min: -100, max: 100 },
  { label: t('panel.picture.hue'), prop: 'hue', value: hue, min: -100, max: 100 },
  { label: t('panel.picture.sharpen'), prop: 'sharpen', value: sharpen, min: -100, max: 100 },
  { label: t('panel.picture.gamma'), prop: 'gamma', value: gamma, min: -100, max: 100 }
])
const rotation = ref(0)
const hFlip = ref(false)

const sliderBg = (val: number, min: number, max: number) => {
  const pct = ((val - min) / (max - min)) * 100
  return { background: `linear-gradient(to right, var(--p-acc) ${pct}%, rgba(255,255,255,.1) ${pct}%)` }
}

const formatSliderValue = (val: number): string => {
  if (val > 0) return `+${val}`
  return String(val)
}

const setSlider = async (slider: { label: string; prop: string; value: ReturnType<typeof ref<number>>; min: number; max: number }, val: number) => {
  slider.value.value = val
  if (prop) await prop.set(slider.prop, val)
}

const toggleHdr = async () => {
  if (window.electronAPI?.player) {
    await window.electronAPI.player.setHdr(!props.hdrEnabled)
  }
}

const rotate = async (delta: number) => {
  rotation.value = (rotation.value + delta + 360) % 360
  if (prop) await prop.set('video-rotate', rotation.value)
}

const toggleHFlip = async () => {
  hFlip.value = !hFlip.value
  // Toggle hflip via vf append/remove
  if (prop) {
    if (hFlip.value) {
      await prop.set('vf', 'hflip')
    } else {
      await prop.set('vf', '')
    }
  }
}

const resetAll = async () => {
  brightness.value = 0
  contrast.value = 0
  saturation.value = 0
  hue.value = 0
  sharpen.value = 0
  gamma.value = 0
  rotation.value = 0
  hFlip.value = false

  if (prop) {
    await Promise.all([
      prop.set('brightness', 0),
      prop.set('contrast', 0),
      prop.set('saturation', 0),
      prop.set('hue', 0),
      prop.set('sharpen', 0),
      prop.set('gamma', 0),
      prop.set('video-rotate', 0),
      prop.set('vf', '')
    ])
  }
}

// Sync current values from mpv when panel opens
async function syncFromMpv() {
  if (!prop) return
  try {
    const [b, c, s, h, sh, g, rot] = await Promise.all([
      prop.get('brightness'),
      prop.get('contrast'),
      prop.get('saturation'),
      prop.get('hue'),
      prop.get('sharpen'),
      prop.get('gamma'),
      prop.get('video-rotate')
    ])
    brightness.value = Number(b) || 0
    contrast.value = Number(c) || 0
    saturation.value = Number(s) || 0
    hue.value = Number(h) || 0
    sharpen.value = Number(sh) || 0
    gamma.value = Number(g) || 0
    rotation.value = Number(rot) || 0
  } catch { /* ignore */ }
}

watch(() => props.visible, (visible) => {
  if (visible) syncFromMpv()
})
</script>

<style scoped>
.picture-content {
  display: flex;
  flex-direction: column;
}

.pr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid var(--p-bd);
}

.pr:last-child {
  border-bottom: none;
}

.pr-l {
  font-size: 12px;
  color: var(--p-t2);
  min-width: 36px;
  flex-shrink: 0;
}

.pr-hint {
  font-size: 10px;
  color: var(--p-t2);
  opacity: 0.6;
  margin-top: 2px;
}

.sl-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  margin-left: 12px;
}

.sl-input {
  flex: 1;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  outline: none;
}

.sl-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--p-t1);
  cursor: pointer;
}

.sl-v {
  font-size: 11px;
  color: var(--p-t2);
  min-width: 28px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.toggle {
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.15);
  position: relative;
  cursor: pointer;
  transition: background var(--dur-normal);
  flex-shrink: 0;
  border: none;
}

.toggle.on {
  background: var(--acc);
}

.toggle::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  top: 2px;
  left: 2px;
  transition: left var(--dur-normal);
}

.toggle.on::after {
  left: 16px;
}

.rotation-controls {
  display: flex;
  align-items: center;
  gap: 5px;
}

.rotation-value {
  font-size: 11px;
  color: var(--p-t1);
  min-width: 28px;
  text-align: center;
  font-variant-numeric: tabular-nums;
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

.reset-btn {
  margin-top: 12px;
  padding: 6px;
  border-radius: var(--r1);
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: var(--p-t2);
  font-size: 11px;
  cursor: pointer;
  text-align: center;
  transition: all var(--dur-fast);
}

.reset-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--p-t1);
}

.pr.disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
