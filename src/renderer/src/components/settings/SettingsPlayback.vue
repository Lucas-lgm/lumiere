<template>
  <div>
    <div class="settings-section-title">{{ $t('settings.playback.decoding.title') }}</div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.playback.hwdec.label') }}</div>
        <div class="settings-hint">{{ $t('settings.playback.hwdec.hint') }}</div>
      </div>
      <select v-model="settings.hwdec" class="sel-box">
        <option value="auto">{{ $t('settings.playback.hwdec.auto') }}</option>
        <option value="auto-safe">{{ $t('settings.playback.hwdec.autoSafe') }}</option>
        <option value="no">{{ $t('settings.playback.hwdec.no') }}</option>
      </select>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.playback.hwdecCodec.label') }}</div>
      </div>
      <select v-model="settings.hwdecCodec" class="sel-box">
        <option value="videotoolbox">{{ $t('settings.playback.hwdecCodec.videotoolbox') }}</option>
        <option value="auto">{{ $t('settings.playback.hwdecCodec.auto') }}</option>
      </select>
    </div>

    <div class="settings-section-title">{{ $t('settings.playback.behavior.title') }}</div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.playback.rememberProgress.label') }}</div>
        <div class="settings-hint">{{ $t('settings.playback.rememberProgress.hint') }}</div>
      </div>
      <div class="toggle" :class="{ on: settings.rememberProgress }" @click="settings.rememberProgress = !settings.rememberProgress"></div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.playback.autoLoadSubtitle.label') }}</div>
        <div class="settings-hint">{{ $t('settings.playback.autoLoadSubtitle.hint') }}</div>
      </div>
      <div class="toggle" :class="{ on: settings.autoLoadSubtitle }" @click="settings.autoLoadSubtitle = !settings.autoLoadSubtitle"></div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.playback.autoLoadAudio.label') }}</div>
      </div>
      <div class="toggle" :class="{ on: settings.autoLoadAudio }" @click="settings.autoLoadAudio = !settings.autoLoadAudio"></div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.playback.defaultSpeed.label') }}</div>
      </div>
      <select v-model.number="settings.defaultSpeed" class="sel-box">
        <option :value="0.5">0.5×</option>
        <option :value="0.75">0.75×</option>
        <option :value="1">1×</option>
        <option :value="1.25">1.25×</option>
        <option :value="1.5">1.5×</option>
        <option :value="2">2×</option>
      </select>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.playback.chapterNav.label') }}</div>
        <div class="settings-hint">{{ $t('settings.playback.chapterNav.hint') }}</div>
      </div>
      <div class="toggle" :class="{ on: settings.chapterNav }" @click="settings.chapterNav = !settings.chapterNav"></div>
    </div>

    <div class="settings-section-title">{{ $t('settings.playback.enhancement.title') }}</div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.playback.enhancement.label') }}</div>
        <div class="settings-hint">{{ $t('settings.playback.enhancement.hint') }}</div>
      </div>
      <select v-model="settings.videoEnhancement" class="sel-box">
        <option value="off">{{ $t('settings.playback.enhancement.off') }}</option>
        <option value="crisp">{{ $t('settings.playback.enhancement.crisp') }}</option>
        <option value="live">{{ $t('settings.playback.enhancement.live') }}</option>
        <option value="anime">{{ $t('settings.playback.enhancement.anime') }}</option>
        <option value="fsr">{{ $t('settings.playback.enhancement.fsr') }}</option>
      </select>
    </div>

    <div class="settings-section-title">{{ $t('settings.playback.window.title') }}</div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.playback.windowFollowVideo.label') }}</div>
        <div class="settings-hint">{{ $t('settings.playback.windowFollowVideo.hint') }}</div>
      </div>
      <div class="toggle" :class="{ on: settings.windowFollowVideo }" @click="settings.windowFollowVideo = !settings.windowFollowVideo"></div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-label">{{ $t('settings.playback.preferredLang.label') }}</div>
        <div class="settings-hint">{{ $t('settings.playback.preferredLang.hint') }}</div>
      </div>
      <select v-model="settings.preferredLang" class="sel-box">
        <option value="system">{{ $t('settings.general.language.system') }}</option>
        <option value="zh">{{ $t('settings.playback.preferredLangList.zh') }}</option>
        <option value="en">{{ $t('settings.playback.preferredLangList.en') }}</option>
        <option value="ja">{{ $t('settings.playback.preferredLangList.ja') }}</option>
        <option value="ko">{{ $t('settings.playback.preferredLangList.ko') }}</option>
        <option value="fr">{{ $t('settings.playback.preferredLangList.fr') }}</option>
        <option value="de">{{ $t('settings.playback.preferredLangList.de') }}</option>
        <option value="es">{{ $t('settings.playback.preferredLangList.es') }}</option>
        <option value="pt">{{ $t('settings.playback.preferredLangList.pt') }}</option>
        <option value="ru">{{ $t('settings.playback.preferredLangList.ru') }}</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
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

.settings-hint {
  font-size: 10px;
  color: var(--t3);
  margin-top: 2px;
  max-width: 260px;
  line-height: 1.4;
}
</style>
