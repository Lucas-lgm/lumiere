<template>
  <div class="settings-page">
    <!-- Header -->
    <div class="settings-header">
      <button class="btn-i settings-back" @click="$emit('close')">
        <Icon name="chevron-left" :size="16" />
      </button>
      <span class="settings-header-title">{{ $t('settings.title') }}</span>
    </div>

    <div class="settings-layout">
      <!-- Left nav -->
      <div class="settings-nav">
        <div
          v-for="cat in SETTINGS_CATEGORIES"
          :key="cat.id"
          class="settings-nav-item"
          :class="{ on: activeCategory === cat.id }"
          @click="activeCategory = cat.id"
        >
          <span class="settings-nav-icon"><Icon :name="cat.icon" :size="13" /></span>
          <span class="settings-nav-label">{{ $t(cat.labelKey) }}</span>
        </div>
        <div class="settings-nav-version">v0.1.0</div>
      </div>

      <!-- Right content -->
      <div class="settings-content">
        <SettingsPlayback v-if="activeCategory === 'playback'" :settings="settings" />
        <SettingsShortcuts v-if="activeCategory === 'shortcuts'" :settings="settings" />
        <SettingsGeneral
          v-if="activeCategory === 'general'"
          :settings="settings"
          @open-log-dir="openLogDir"
          @reset="confirmReset"
        />
        <SettingsAbout v-if="activeCategory === 'about'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Icon from '../base/Icon.vue'
import { useSettings, SETTINGS_CATEGORIES, type SettingsCategory } from '../../composables/useSettings'
import SettingsPlayback from './SettingsPlayback.vue'
import SettingsShortcuts from './SettingsShortcuts.vue'
import SettingsGeneral from './SettingsGeneral.vue'
import SettingsAbout from './SettingsAbout.vue'

const emit = defineEmits<{
  close: []
}>()

const { settings, resetAll } = useSettings()

const activeCategory = ref<SettingsCategory>('playback')

function openLogDir() {
  window.electronAPI?.settings?.openLogDir()
}

async function confirmReset() {
  await resetAll()
}

// Esc closes settings page
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.settings-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  background: var(--bg-s);
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}

.settings-back {
  color: var(--t3);
}

.settings-header-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--t1);
}

.settings-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Left nav */
.settings-nav {
  width: 160px;
  flex-shrink: 0;
  border-right: 1px solid var(--bd);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--r1);
  font-size: 12px;
  font-weight: 500;
  color: var(--t2);
  cursor: pointer;
  transition: all .12s;
}

.settings-nav-item:hover {
  background: var(--bg-h);
  color: var(--t1);
}

.settings-nav-item.on {
  background: var(--acc-d);
  color: var(--acc);
}

.settings-nav-icon {
  font-size: 13px;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.settings-nav-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.settings-nav-version {
  margin-top: auto;
  font-size: 10px;
  color: var(--t3);
  padding: 8px 10px;
}

/* Right content */
.settings-content {
  flex: 1;
  padding: 14px;
  overflow-y: auto;
}
</style>
