<template>
  <div class="panel-content">
    <!-- No subtitle track hint -->
    <div v-if="subtitleTracks.length === 0" class="empty-tracks">
      <Icon name="subtitles" :size="28" />
      <span class="empty-title">{{ $t('panel.subtitle.noTracks') }}</span>
      <span class="empty-hint">{{ $t('panel.subtitle.noTracksHint') }}</span>
    </div>

    <div class="pr">
      <span class="pr-l">{{ $t('panel.subtitle.primary') }}</span>
      <select class="sel-box" :value="primarySubId" @change="$emit('set-primary-sub', ($event.target as HTMLSelectElement).value)">
        <option value="none">{{ $t('panel.subtitle.none') }}</option>
        <option v-for="t in subtitleTracks" :key="t.id" :value="t.id">
          {{ formatTrackLabel(t) }}
        </option>
      </select>
    </div>

    <div class="pr pr-col">
      <div class="pr-row">
        <span class="pr-l">{{ $t('panel.subtitle.secondary') }}</span>
        <select class="sel-box" :value="secondarySubId" @change="$emit('set-secondary-sub', ($event.target as HTMLSelectElement).value)">
          <option value="none">{{ $t('panel.subtitle.secondaryOff') }}</option>
          <option v-for="t in subtitleTracks" :key="t.id" :value="t.id">
            {{ formatTrackLabel(t) }}
          </option>
        </select>
      </div>
      <div class="pr-hint">{{ $t('panel.subtitle.dualHint') }}</div>
    </div>

    <div class="pr">
      <span class="pr-l">{{ $t('panel.subtitle.external') }}</span>
      <button class="btn-sm" @click="loadExternalSub">{{ $t('panel.subtitle.selectFile') }}</button>
      <input
        ref="fileInputRef"
        type="file"
        accept=".srt,.ass,.sub,.ssa,.vtt,.sup,.idx"
        style="display: none"
        @change="onSubFileSelected"
      />
    </div>

    <div class="pr">
      <span class="pr-l">{{ $t('panel.subtitle.delay') }}</span>
      <div class="delay-control">
        <button class="btn-ic" @click="$emit('adjust-delay', -0.1)"><Icon name="minus" :size="12" /></button>
        <span class="delay-value">{{ subDelay.toFixed(1) }} s</span>
        <button class="btn-ic" @click="$emit('adjust-delay', 0.1)"><Icon name="plus" :size="12" /></button>
      </div>
    </div>

    <div class="pr">
      <span class="pr-l">{{ $t('panel.subtitle.encoding') }}</span>
      <select class="sel-box" :value="subEncoding" @change="$emit('apply-encoding', ($event.target as HTMLSelectElement).value)">
        <option value="auto">{{ $t('panel.subtitle.encodingAuto') }}</option>
        <option value="utf-8">UTF-8</option>
        <option value="gbk">GBK</option>
        <option value="big5">Big5</option>
        <option value="shift_jis">Shift_JIS</option>
        <option value="euc-kr">EUC-KR</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'

const { t } = useI18n()

interface Props {
  subtitleTracks: any[]
  primarySubId: string
  secondarySubId: string
  subDelay: number
  subEncoding: string
}

defineProps<Props>()

const emit = defineEmits<{
  'set-primary-sub': [value: string]
  'set-secondary-sub': [value: string]
  'load-external-sub': []
  'adjust-delay': [delta: number]
  'apply-encoding': [value: string]
  'sub-file-selected': [filePath: string]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)

const loadExternalSub = () => {
  fileInputRef.value?.click()
}

const onSubFileSelected = (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !(file as any).path) return
  const filePath = (file as any).path as string
  emit('sub-file-selected', filePath)
  input.value = ''
}

const formatTrackLabel = (track: any): string => {
  const parts: string[] = []
  if (track.title) parts.push(track.title)
  if (track.lang) parts.push(track.lang)
  if (track.codec) parts.push(track.codec.toUpperCase())
  if (track.external) parts.push(t('panel.subtitle.trackExternal'))
  else parts.push(t('panel.subtitle.trackInternal'))
  return parts.join(' · ') || t('panel.subtitle.trackId', { id: track.id })
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

.pr-col {
  flex-direction: column;
  align-items: stretch;
}

.pr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.pr-l {
  font-size: 12px;
  color: var(--p-t2);
}

.pr-hint {
  font-size: 10px;
  color: var(--p-t2);
  opacity: 0.6;
  margin-top: 2px;
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

.delay-control {
  display: flex;
  align-items: center;
  gap: 6px;
}

.delay-value {
  font-size: 12px;
  min-width: 40px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--p-t1);
}

.empty-tracks {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 0;
  color: var(--p-t2);
  opacity: 0.6;
}

.empty-title {
  font-size: 12px;
  font-weight: 500;
}

.empty-hint {
  font-size: 10px;
  opacity: 0.7;
}
</style>
