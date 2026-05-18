<template>
  <div class="panel-content">
    <div v-if="isBitmapSub" class="bitmap-hint">
      {{ $t('panel.subtitle.bitmapHint') }}
    </div>
    <div class="pr">
      <span class="pr-l">{{ $t('panel.subtitle.size') }}</span>
      <div class="sl-wrap">
        <input
          type="range"
          class="sl-input"
          :value="subScale"
          min="0.5"
          max="3"
          step="0.1"
          :style="sliderBg(subScale, 0.5, 3)"
          @input="$emit('set-sub-scale', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="sl-v">{{ subScale.toFixed(1) }}x</span>
      </div>
    </div>

    <div class="pr">
      <span class="pr-l">{{ $t('panel.subtitle.font') }}</span>
      <select class="sel-box" :value="subFont" @change="$emit('apply-font', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ $t('panel.subtitle.fontDefault') }}</option>
        <option value="PingFang SC">PingFang SC</option>
        <option value="STHeiti">{{ $t('panel.subtitle.fontStheiti') }}</option>
        <option value="Microsoft YaHei">{{ $t('panel.subtitle.fontMsyahei') }}</option>
        <option value="Arial">Arial</option>
        <option value="sans-serif">Sans-serif</option>
      </select>
    </div>

    <div class="pr">
      <span class="pr-l">{{ $t('panel.subtitle.colorStroke') }}</span>
      <div class="color-swatches">
        <input type="color" class="color-swatch" :value="subColor" @input="$emit('set-sub-color', ($event.target as HTMLInputElement).value)" :title="$t('panel.subtitle.colorTitle')" />
        <input type="color" class="color-swatch swatch-dark" :value="subBorderColor" @input="$emit('set-sub-border-color', ($event.target as HTMLInputElement).value)" :title="$t('panel.subtitle.strokeTitle')" />
      </div>
    </div>

    <div class="pr">
      <span class="pr-l">{{ $t('panel.subtitle.position') }}</span>
      <div class="sl-wrap">
        <input
          type="range"
          class="sl-input"
          :value="subPos"
          min="0"
          max="100"
          step="1"
          :style="sliderBg(subPos, 0, 100)"
          @input="$emit('set-sub-pos', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="sl-v">{{ subPos }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  isBitmapSub: boolean
  subScale: number
  subFont: string
  subColor: string
  subBorderColor: string
  subPos: number
}

defineProps<Props>()

defineEmits<{
  'set-sub-scale': [value: number]
  'set-sub-pos': [value: number]
  'set-sub-color': [value: string]
  'set-sub-border-color': [value: string]
  'apply-font': [value: string]
}>()

const sliderBg = (val: number, min: number, max: number) => {
  const pct = ((val - min) / (max - min)) * 100
  return { background: `linear-gradient(to right, var(--p-acc) ${pct}%, rgba(255,255,255,.1) ${pct}%)` }
}
</script>

<style scoped>
.panel-content {
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
}

.sel-box {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: var(--r1);
  padding: 4px 8px;
  font-size: 11px;
  color: var(--p-t1);
  cursor: pointer;
  max-width: 140px;
  appearance: none;
  -webkit-appearance: none;
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
}

.color-swatches {
  display: flex;
  gap: 5px;
}

.color-swatch {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid var(--p-bd);
  cursor: pointer;
  padding: 0;
  -webkit-appearance: none;
  appearance: none;
}

.color-swatch::-webkit-color-swatch-wrapper {
  padding: 0;
}

.color-swatch::-webkit-color-swatch {
  border: none;
  border-radius: 3px;
}

.bitmap-hint {
  font-size: 10px;
  color: var(--p-t2);
  opacity: 0.7;
  padding: 8px;
  margin-bottom: 8px;
  background: rgba(255, 170, 0, 0.08);
  border-radius: var(--r1);
  line-height: 1.5;
}
</style>
