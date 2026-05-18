<template>
  <div>
    <div class="settings-section-title">{{ $t('settings.shortcuts.playbackControl.title') }}</div>
    <SettingsShortcutRow :label="$t('settings.shortcuts.playPause')" v-model="settings.shortcuts['play-pause']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.seekBack10')" v-model="settings.shortcuts['seek-back-10']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.seekFwd10')" v-model="settings.shortcuts['seek-fwd-10']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.seekBack30')" v-model="settings.shortcuts['seek-back-30']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.seekFwd30')" v-model="settings.shortcuts['seek-fwd-30']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.prevVideo')" v-model="settings.shortcuts['prev-video']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.nextVideo')" v-model="settings.shortcuts['next-video']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.speedUp')" v-model="settings.shortcuts['speed-up']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.speedDown')" v-model="settings.shortcuts['speed-down']" />

    <div class="settings-section-title">{{ $t('settings.shortcuts.visualAudio.title') }}</div>
    <SettingsShortcutRow :label="$t('settings.shortcuts.fullscreen')" v-model="settings.shortcuts['fullscreen']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.volumeUp')" v-model="settings.shortcuts['volume-up']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.volumeDown')" v-model="settings.shortcuts['volume-down']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.mute')" v-model="settings.shortcuts['mute']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.screenshot')" v-model="settings.shortcuts['screenshot']" />

    <div class="settings-section-title">{{ $t('settings.shortcuts.interface.title') }}</div>
    <SettingsShortcutRow :label="$t('settings.shortcuts.openFile')" v-model="settings.shortcuts['open-file']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.pasteUrl')" v-model="settings.shortcuts['paste-url']" />
    <SettingsShortcutRow :label="$t('settings.shortcuts.backLibrary')" v-model="settings.shortcuts['back-library']" />
  </div>
</template>

<script setup lang="ts">
import SettingsShortcutRow from './SettingsShortcutRow.vue'
import type { AppSettings } from '../../composables/useSettings'

defineProps<{
  settings: AppSettings
}>()
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
</style>
