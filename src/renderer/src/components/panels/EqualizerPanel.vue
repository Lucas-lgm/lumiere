<template>
  <SlidePanel
    :visible="visible"
    :title="$t('panel.equalizer.title')"
    icon="sliders-horizontal"
    :context="context"
    @close="$emit('close')"
  >
    <template #default>
      <div class="eq-content">
        <!-- Enable toggle -->
        <div class="pr">
          <span class="pr-l">{{ $t('panel.equalizer.enable') }}</span>
          <button :class="['toggle', { on: eq.enabled.value }]" @click="eq.toggleEnabled()"></button>
        </div>

        <!-- Preset selector -->
        <div class="pr" v-if="eq.isLoaded.value">
          <span class="pr-l">{{ $t('panel.equalizer.preset') }}</span>
          <select class="preset-select" :value="eq.currentPreset.value" @change="onPresetChange">
            <option v-for="p in eq.allPresets.value" :key="p.name" :value="p.name">
              {{ presetLabel(p.name) }}
            </option>
          </select>
        </div>

        <!-- Band sliders -->
        <div class="bands-container" v-if="eq.isLoaded.value">
          <div
            class="band-col"
            v-for="(gain, i) in eq.bands.value"
            :key="i"
          >
            <span class="band-db">{{ formatDb(gain) }}</span>
            <div class="band-slider-wrap">
              <input
                type="range"
                class="band-slider"
                :value="gain"
                :min="-12"
                :max="12"
                step="0.5"
                orient="vertical"
                @input="onBandInput(i, Number(($event.target as HTMLInputElement).value))"
              />
            </div>
            <span class="band-freq">{{ bandLabel(i) }}</span>
          </div>
        </div>

        <!-- Save as preset -->
        <div class="save-preset-row">
          <input
            class="preset-name-input"
            v-model="eq.savedPresetName.value"
            :placeholder="$t('panel.equalizer.presetName')"
            @keyup.enter="doSavePreset"
          />
          <button class="btn-save" @click="doSavePreset">{{ $t('panel.equalizer.savePreset') }}</button>
        </div>

        <!-- Reset -->
        <button class="reset-btn" @click="eq.resetAll()">{{ $t('panel.equalizer.resetAll') }}</button>
      </div>
    </template>
  </SlidePanel>
</template>

<script setup lang="ts">
import { watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SlidePanel from '../base/SlidePanel.vue'
import { useAudioEqualizer } from '../../composables/useAudioEqualizer'
import { EQUALIZER_BANDS } from '../../../../shared/types/ipc'

const { t } = useI18n()

interface Props {
  visible: boolean
  context?: 'player' | 'library'
}

const props = withDefaults(defineProps<Props>(), {
  context: 'player',
})

defineEmits<{
  close: []
}>()

const eq = useAudioEqualizer()

const bandLabel = (i: number) => {
  const freq = EQUALIZER_BANDS[i]
  return freq >= 1000 ? `${freq / 1000}k` : String(freq)
}

const formatDb = (val: number) => {
  if (val > 0) return `+${val}`
  return String(val)
}

const presetLabel = (name: string) => {
  const key = `panel.equalizer.${name}`
  const translated = t(key)
  return translated !== key ? translated : name
}

const onBandInput = (index: number, value: number) => {
  eq.setBand(index, value)
}

const onPresetChange = (e: Event) => {
  const target = e.target as HTMLSelectElement
  eq.setPreset(target.value)
}

const doSavePreset = () => {
  if (eq.savedPresetName.value.trim()) {
    eq.saveCustomPreset(eq.savedPresetName.value.trim())
    eq.savedPresetName.value = ''
  }
}

watch(() => props.visible, (visible) => {
  if (visible && !eq.isLoaded.value) {
    eq.loadState()
  }
})
</script>

<style scoped>
.eq-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid var(--p-bd);
}

.pr-l {
  font-size: 12px;
  color: var(--p-t2);
  min-width: 36px;
  flex-shrink: 0;
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

.preset-select {
  flex: 1;
  margin-left: 12px;
  padding: 4px 6px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid var(--p-bd);
  background: rgba(255, 255, 255, 0.06);
  color: var(--p-t1);
  cursor: pointer;
  outline: none;
}

.bands-container {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  padding: 12px 0;
  min-height: 160px;
  border-bottom: 1px solid var(--p-bd);
}

.band-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.band-db {
  font-size: 9px;
  color: var(--p-t2);
  font-variant-numeric: tabular-nums;
  min-height: 12px;
  margin-bottom: 4px;
  text-align: center;
}

.band-slider-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
}

.band-slider {
  -webkit-appearance: none;
  appearance: none;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 3px;
  height: 80px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.band-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--p-t1);
  cursor: pointer;
}

.band-freq {
  font-size: 9px;
  color: var(--p-t3);
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

.save-preset-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.preset-name-input {
  flex: 1;
  padding: 5px 8px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid var(--p-bd);
  background: rgba(255, 255, 255, 0.06);
  color: var(--p-t1);
  outline: none;
}

.preset-name-input::placeholder {
  color: var(--p-t3);
}

.btn-save {
  padding: 5px 8px;
  font-size: 11px;
  border-radius: 4px;
  border: none;
  background: var(--acc);
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity var(--dur-fast);
}

.btn-save:hover {
  opacity: 0.8;
}

.reset-btn {
  margin-top: 4px;
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
</style>
