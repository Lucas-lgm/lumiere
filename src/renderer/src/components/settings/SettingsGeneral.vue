<template>
  <div>
    <div class="settings-section-title">{{ $t('settings.general.appearance.title') }}</div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.general.theme.label') }}</div>
      </div>
      <select v-model="themePreference" class="sel-box" @change="handleThemeChange">
        <option value="system">{{ $t('settings.general.theme.system') }}</option>
        <option value="light">{{ $t('settings.general.theme.light') }}</option>
        <option value="dark">{{ $t('settings.general.theme.dark') }}</option>
      </select>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.general.language.label') }}</div>
      </div>
      <select v-model="settings.language" class="sel-box">
        <option value="system">{{ $t('settings.general.language.system') }}</option>
        <option value="zh-CN">{{ $t('settings.general.language.zhCN') }}</option>
        <option value="en">{{ $t('settings.general.language.en') }}</option>
      </select>
    </div>

    <div class="settings-section-title">{{ $t('settings.general.library.title') }}</div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.general.autoThumbnail.label') }}</div>
        <div class="settings-hint">{{ $t('settings.general.autoThumbnail.hint') }}</div>
      </div>
      <div class="toggle" :class="{ on: settings.autoThumbnail }" @click="settings.autoThumbnail = !settings.autoThumbnail"></div>
    </div>

    <div class="settings-section-title">{{ $t('settings.general.network.title') }}</div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.general.httpProxy.label') }}</div>
        <div class="settings-hint">{{ $t('settings.general.httpProxy.hint') }}</div>
      </div>
      <input
        v-model="settings.httpProxy"
        type="text"
        class="settings-input"
        :placeholder="$t('settings.general.httpProxy.placeholder')"
      />
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.general.bufferSize.label') }}</div>
      </div>
      <select v-model.number="settings.bufferSize" class="sel-box">
        <option :value="1">1 MB</option>
        <option :value="2">2 MB</option>
        <option :value="4">4 MB</option>
        <option :value="8">8 MB</option>
        <option :value="16">16 MB</option>
      </select>
    </div>

    <div class="settings-section-title">{{ $t('settings.general.advanced.title') }}</div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.general.mpvOptions.label') }}</div>
        <div class="settings-hint">{{ $t('settings.general.mpvOptions.hint') }}</div>
      </div>
      <button class="btn-s" @click="showMpvOptions = !showMpvOptions">
        {{ showMpvOptions ? $t('settings.general.mpvOptions.collapse') : $t('settings.general.mpvOptions.edit') }}
      </button>
    </div>
    <textarea
      v-if="showMpvOptions"
      v-model="settings.mpvOptions"
      class="settings-textarea"
      rows="4"
      placeholder="--vo=gpu-next&#10;--hwdec=videotoolbox"
    ></textarea>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.general.logLevel.label') }}</div>
        <div class="settings-hint">{{ $t('settings.general.logLevel.hint') }}</div>
      </div>
      <div class="settings-row-actions">
        <select v-model="settings.logLevel" class="sel-box">
          <option value="no">{{ $t('settings.general.logLevel.off') }}</option>
          <option value="fatal">{{ $t('settings.general.logLevel.fatal') }}</option>
          <option value="error">{{ $t('settings.general.logLevel.error') }}</option>
          <option value="warn">{{ $t('settings.general.logLevel.warn') }}</option>
          <option value="info">{{ $t('settings.general.logLevel.info') }}</option>
          <option value="debug">{{ $t('settings.general.logLevel.debug') }}</option>
          <option value="trace">{{ $t('settings.general.logLevel.trace') }}</option>
        </select>
        <button class="btn-s btn-open-log" @click="$emit('open-log-dir')">{{ $t('settings.general.logLevel.openBtn') }}</button>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.general.cacheSize.label') }}</div>
      </div>
      <select v-model.number="settings.cacheSize" class="sel-box">
        <option :value="50">50 MB</option>
        <option :value="100">100 MB</option>
        <option :value="150">150 MB</option>
        <option :value="300">300 MB</option>
        <option :value="500">500 MB</option>
      </select>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label settings-label-danger">{{ $t('settings.general.reset.label') }}</div>
        <div class="settings-hint">{{ $t('settings.general.reset.hint') }}</div>
      </div>
      <button
        v-if="!resetConfirming"
        class="btn-s btn-danger"
        @click="resetConfirming = true"
      >{{ $t('settings.general.reset.btn') }}</button>
      <div v-else class="reset-confirm">
        <button class="btn-s btn-danger" @click="handleReset">{{ $t('settings.general.reset.confirm') }}</button>
        <button class="btn-s" @click="resetConfirming = false">{{ $t('settings.general.reset.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { AppSettings } from '../../composables/useSettings'
import { useTheme } from '../../composables/useTheme'

defineProps<{
  settings: AppSettings
}>()

const emit = defineEmits<{
  'open-log-dir': []
  'reset': []
}>()

const { preference: themePreference, setPreference: setThemePreference } = useTheme()

const showMpvOptions = ref(false)
const resetConfirming = ref(false)

function handleThemeChange() {
  setThemePreference(themePreference.value)
}

function handleReset() {
  emit('reset')
  resetConfirming.value = false
}
</script>

<style scoped>
.settings-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--t3);
  letter-spacing: .06em;
  text-transform: uppercase;
  margin-bottom: 10px;
  margin-top: 16px;
}

.settings-section-title:first-child {
  margin-top: 0;
}

.settings-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--bd);
  gap: 12px;
}

.settings-row:last-child {
  border-bottom: none;
}

.settings-row-info {
  flex: 1;
  min-width: 0;
}

.settings-label {
  font-size: 12px;
  color: var(--t2);
}

.settings-label-danger {
  color: var(--red);
}

.settings-hint {
  font-size: 10px;
  color: var(--t3);
  margin-top: 2px;
  max-width: 260px;
  line-height: 1.4;
}

.settings-input {
  width: 160px;
  padding: 5px 8px;
  font-size: 11px;
  font-family: inherit;
  color: var(--t1);
  background: var(--bg-h);
  border: 1px solid var(--bd);
  border-radius: var(--r1);
  outline: none;
  transition: border-color var(--dur-fast);
  flex-shrink: 0;
}

.settings-input:focus {
  border-color: var(--acc);
}

.settings-input::placeholder {
  color: var(--t3);
}

.settings-textarea {
  width: 100%;
  padding: 8px 10px;
  font-size: 11px;
  font-family: 'SF Mono', 'Menlo', monospace;
  color: var(--t1);
  background: var(--bg-h);
  border: 1px solid var(--bd);
  border-radius: var(--r1);
  outline: none;
  resize: vertical;
  line-height: 1.5;
  box-sizing: border-box;
}

.settings-textarea:focus {
  border-color: var(--acc);
}

.settings-textarea::placeholder {
  color: var(--t3);
}

.settings-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.btn-open-log {
  font-size: 10px;
  padding: 3px 8px;
}

.btn-danger {
  color: var(--red);
  border-color: rgba(255, 95, 87, .3);
}

.btn-danger:hover {
  background: rgba(255, 95, 87, .08);
}

.reset-confirm {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
</style>
