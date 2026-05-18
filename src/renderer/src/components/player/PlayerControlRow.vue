<template>
  <div class="ctrl-row">
    <!-- Left: transport controls + time -->
    <div class="ctrl-left">
      <button class="cb" @click="playPrevFromPlaylist()" :title="$t('player.controls.prev')">
        <Icon name="skip-back" :size="16" />
      </button>
      <button class="cb seek" @click="seekRelative(-10)" :title="$t('player.controls.seekBack10')">
        <Icon name="rewind" :size="11" /><span class="seek-label">10</span>
      </button>
      <button class="cb play" @click="togglePlayPause()" :title="isPlaying ? $t('player.controls.pause') : $t('player.controls.play')">
        <Icon :name="isPlaying ? 'pause' : 'play'" :size="18" />
      </button>
      <button class="cb seek" @click="seekRelative(30)" :title="$t('player.controls.seekFwd30')">
        <span class="seek-label">30</span><Icon name="fast-forward" :size="11" />
      </button>
      <button class="cb" @click="playNextFromPlaylist()" :title="$t('player.controls.next')">
        <Icon name="skip-forward" :size="16" />
      </button>
      <span class="p-time">
        <span class="p-time-cur">{{ formatTime(currentTime) }}</span> / {{ formatTime(duration) }}
      </span>
    </div>

    <!-- Right: function buttons + volume + more + fullscreen -->
    <div class="ctrl-right">
      <!-- Subtitle panel -->
      <button
        class="fb"
        :class="{ on: activePanel === 'subtitle' }"
        @click="togglePanel('subtitle')"
        :title="$t('player.controls.subtitle')"
      >
        <Icon name="subtitles" :size="16" />
      </button>
      <!-- Audio track popover -->
      <div v-if="audioTracks.length >= 1" class="audio-wrap">
        <button
          class="fb"
          :class="{ on: audioPopoverOpen }"
          @click.stop="audioPopoverOpen = !audioPopoverOpen"
          :title="$t('player.controls.audioTrack')"
        >
          <Icon name="audio-lines" :size="16" />
        </button>
        <div v-if="audioPopoverOpen" class="track-popover">
          <div class="track-popover-title">{{ $t('player.controls.audioTrack') }}</div>
          <div
            v-for="t in audioTracks"
            :key="t.id"
            class="track-item"
            :class="{ on: t.id === selectedAudioTrackId }"
            @click="onSwitchAudioTrack(t.id)"
          >
            {{ formatAudioTrackLabel(t) }}
          </div>
        </div>
      </div>
      <!-- Speed picker -->
      <div class="spd-wrap">
        <button
          class="spd-badge"
          @click="onToggleSpeedPicker"
          :title="$t('player.controls.speed')"
        >
          {{ playbackSpeed === 1 ? '1x' : playbackSpeed + 'x' }}
        </button>
        <div v-if="speedPickerOpen" class="spd-picker">
          <button
            v-for="s in speedPresets"
            :key="s"
            class="spd-preset"
            :class="{ active: playbackSpeed === s }"
            @click="onSelectSpeed(s)"
          >
            {{ s }}×
          </button>
          <div class="spd-divider"></div>
          <div class="spd-custom">
            <input
              type="range"
              class="spd-sl"
              min="0.1"
              max="4"
              step="0.05"
              :value="playbackSpeed"
              @input="onSpeedSliderInput($event)"
            />
            <span class="spd-val">{{ playbackSpeed.toFixed(2) }}×</span>
          </div>
        </div>
      </div>
      <!-- Volume (0-130 range, 75% mark = mpv 100%) -->
      <div class="vol-wrap">
        <button class="cb" @click="toggleMute()" :title="volume > 0 ? $t('player.controls.muteOn') : $t('player.controls.muteOff')">
          <Icon :name="volumeIconName" :size="16" />
        </button>
        <div
          class="vol-track-wrap"
          @mousedown="onVolumeMouseDown($event)"
        >
          <div class="vol-track">
            <div
              class="vol-fill"
              :class="{ 'vol-over': volume > 100 }"
              :style="{ width: volumePercent + '%' }"
            ></div>
            <div class="vol-75" :title="$t('player.controls.volumeMark')"></div>
            <div
              class="vol-thumb"
              :style="{ left: volumePercent + '%' }"
            ></div>
          </div>
        </div>
      </div>
      <!-- ··· More menu -->
      <div class="more-wrap">
        <button class="more-btn" @click="onToggleMoreMenu" :title="$t('player.controls.more')">
          <Icon name="ellipsis" :size="16" />
        </button>
        <div v-if="moreMenuOpen" class="more-menu">
          <button class="mm-item" :class="{ on: abLoopActive }" @click="onAbLoopClick">
            <Icon name="repeat" :size="14" />
            <span>{{ $t('player.controls.abLoop') }}</span>
          </button>
          <div class="mm-divider"></div>
          <button class="mm-item" @click="onMoreMenuItem('picture')">
            <Icon name="sliders-horizontal" :size="14" />
            <span>{{ $t('player.controls.picture') }}</span>
          </button>
          <button class="mm-item" @click="onMoreMenuItem('crop')">
            <Icon name="scissors" :size="14" />
            <span>{{ $t('player.controls.crop') }}</span>
          </button>
          <button class="mm-item" @click="onMoreMenuItem('mediaInfo')">
            <Icon name="info" :size="14" />
            <span>{{ $t('player.controls.mediaInfo') }}</span>
          </button>
          <div class="mm-divider"></div>
          <button class="mm-item" @click="onMoreMenuItem('animExport')">
            <Icon name="film" :size="14" />
            <span>{{ $t('player.controls.animExport') }}</span>
          </button>
        </div>
      </div>
      <!-- PIP -->
      <button class="fb" @click="togglePipMode" :title="$t('player.controls.pip')">
        <Icon name="monitor-play" :size="16" />
      </button>
      <!-- Fullscreen -->
      <button class="fs-btn" @click="toggleFullscreen" :title="$t('player.controls.fullscreen')">
        <Icon name="maximize" :size="16" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'
import { formatTime } from '../../composables/useProgressBar'
import {
  injectStrict, playerCoreKey, playerControlsKey,
  playerPanelKey, playerOverlayKey
} from '../../composables/playerInjectKeys'
import type { TrackInfo } from '../../../../../shared/types/ipc'

const { t } = useI18n()

const {
  isPlaying, currentTime, duration,
  seekRelative, togglePlayPause,
  playPrevFromPlaylist, playNextFromPlaylist,
  toggleFullscreen,
} = injectStrict(playerCoreKey)

const {
  volume, volumePercent, volumeIconName,
  onVolumeMouseDown, toggleMute,
  playbackSpeed, speedPresets,
  toggleSpeedPicker, selectSpeed, onSpeedSliderInput,
  audioTracks, selectedAudioTrackId, switchAudioTrack,
} = injectStrict(playerControlsKey)

const { activePanel, togglePanel } = injectStrict(playerPanelKey)
const { togglePipMode, showHud, toggleAbLoop, formatAbLoopHud, abLoopActive } = injectStrict(playerOverlayKey)

// Local popover state
const audioPopoverOpen = ref(false)
const moreMenuOpen = ref(false)
const speedPickerOpen = ref(false)

function formatAudioTrackLabel(track: TrackInfo): string {
  const parts: string[] = [t('player.controls.audioTrackLabel', { id: track.id })]
  if (track.lang) parts.push(track.lang)
  if (track.title) parts.push(track.title)
  if (track.codec) parts.push(track.codec.toUpperCase())
  return parts.join(' · ')
}

function onSwitchAudioTrack(id: number) {
  audioPopoverOpen.value = false
  switchAudioTrack(id)
}

function onToggleSpeedPicker() {
  speedPickerOpen.value = !speedPickerOpen.value
}

function onSelectSpeed(speed: number) {
  speedPickerOpen.value = false
  selectSpeed(speed)
}

function onToggleMoreMenu() {
  moreMenuOpen.value = !moreMenuOpen.value
}

function onMoreMenuItem(panel: string) {
  moreMenuOpen.value = false
  togglePanel(panel as any)
}

async function onAbLoopClick() {
  moreMenuOpen.value = false
  const result = await toggleAbLoop()
  showHud('loop', formatAbLoopHud(result))
}

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (moreMenuOpen.value && !target.closest('.more-wrap')) moreMenuOpen.value = false
  if (speedPickerOpen.value && !target.closest('.spd-wrap')) speedPickerOpen.value = false
  if (audioPopoverOpen.value && !target.closest('.audio-wrap')) audioPopoverOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})
</script>

<style scoped>
.ctrl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 4px;
  gap: 8px;
}

.ctrl-left {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.ctrl-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 1;
  min-width: 0;
}

/* ── Control button base (cb) ── */
.cb {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: rgba(255,255,255,.75);
  border-radius: 50%;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.cb:hover {
  background: rgba(255,255,255,.1);
  color: #fff;
}

.cb:active {
  transform: scale(0.92);
}

/* Play/Pause button — always white, same size as other buttons */
.cb.play {
  color: #ffffff;
}

.cb.play:hover {
  background: rgba(255,255,255,.12);
}

/* ── Seek buttons (◀◀10s / 30s▶▶) ── */
.cb.seek {
  gap: 1px;
  font-size: 11px;
  font-weight: 700;
  color: rgba(255,255,255,.75);
  width: auto;
  padding: 0 4px;
}

.seek-label {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

/* ── Time display ── */
.p-time {
  font-size: 0.8rem;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  color: rgba(255,255,255,.55);
  margin-left: 6px;
  white-space: nowrap;
  user-select: none;
}

.p-time-cur {
  color: #ffffff;
}

/* ── Function buttons (subtitle, audio) ── */
.fb {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: rgba(255,255,255,.55);
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.fb:hover {
  background: rgba(255,255,255,.1);
  color: rgba(255,255,255,.85);
}

.fb:active {
  transform: scale(0.92);
}

.fb.on {
  color: var(--accent);
}

.fb.on:hover {
  color: var(--p-t1);
  background: rgba(255,255,255,.1);
}

/* ── Audio track popover ── */
.audio-wrap {
  position: relative;
}

.track-popover {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 8px;
  background: rgba(28, 28, 30, .95);
  backdrop-filter: blur(16px);
  border-radius: var(--r2, 8px);
  padding: 4px;
  min-width: 180px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, .5), 0 2px 8px rgba(0, 0, 0, .3);
  z-index: 20;
}

.track-popover-title {
  padding: 6px 10px 4px;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, .4);
  text-transform: uppercase;
  letter-spacing: .04em;
}

.track-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, .85);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.track-item:hover {
  background: rgba(255, 255, 255, .08);
}

.track-item.on {
  color: var(--p-t1);
  font-weight: 600;
}

.track-item.on::before {
  content: '✓';
  font-size: 11px;
  font-weight: 700;
  min-width: 14px;
}

.track-item:not(.on)::before {
  content: '';
  min-width: 14px;
}

/* ── Speed picker ── */
.spd-wrap {
  position: relative;
}

.spd-picker {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 120px;
  background: rgba(30, 30, 30, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 8px;
  padding: 4px;
  z-index: 30;
  box-shadow: 0 8px 32px rgba(0, 0, 0, .5), 0 2px 8px rgba(0, 0, 0, .3);
  display: flex;
  flex-direction: column;
}

.spd-preset {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  border-radius: 5px;
  cursor: pointer;
  text-align: center;
  transition: background 0.12s;
}

.spd-preset:hover {
  background: rgba(255, 255, 255, 0.1);
}

.spd-preset.active {
  color: var(--accent);
  font-weight: 600;
}

.spd-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 8px;
}

.spd-custom {
  padding: 6px 8px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.spd-sl {
  width: 100%;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 1.5px;
  outline: none;
  cursor: pointer;
}

.spd-sl::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}

.spd-val {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

/* ── Speed badge ── */
.spd-badge {
  height: 22px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: rgba(255,255,255,.06);
  color: rgba(255,255,255,.7);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.spd-badge:hover {
  background: rgba(255,255,255,.12);
  color: #fff;
}

/* ── Volume ── */
.vol-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}

.vol-track-wrap {
  width: 100px;
  height: 28px;
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  padding: 4px 0;
}

.vol-track {
  position: relative;
  width: 100%;
  height: 4px;
  background: rgba(255,255,255,.2);
  border-radius: 2px;
}

.vol-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: #ffffff;
  border-radius: 2px;
  pointer-events: none;
  transition: background 0.15s ease;
}

/* Red indicator when volume exceeds 100% (original level) */
.vol-fill.vol-over {
  background: linear-gradient(to right, #ffffff 75%, #ff453a 100%);
}

/* 75% mark line */
.vol-75 {
  position: absolute;
  left: 75%;
  top: -2px;
  width: 1px;
  height: calc(100% + 4px);
  background: rgba(255,255,255,.25);
  pointer-events: none;
}

.vol-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  background: #ffffff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 4px rgba(0,0,0,.4);
  pointer-events: none;
  transition: transform 0.15s ease;
}

.vol-track-wrap:hover .vol-thumb {
  transform: translate(-50%, -50%) scale(1.25);
}

/* ── More menu (···) ── */
.more-wrap {
  position: relative;
}

.more-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: rgba(255,255,255,.6);
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.more-btn:hover {
  background: rgba(255,255,255,.1);
  color: #fff;
}

.more-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  min-width: 140px;
  background: rgba(30, 30, 30, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 8px;
  padding: 4px;
  z-index: 30;
  box-shadow: 0 8px 32px rgba(0, 0, 0, .5), 0 2px 8px rgba(0, 0, 0, .3);
}

.mm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.8rem;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s;
  white-space: nowrap;
}

.mm-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.mm-item.on {
  color: var(--accent);
}

.mm-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 2px 8px;
}

/* ── Fullscreen button ── */
.fs-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: rgba(255,255,255,.75);
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.fs-btn:hover {
  background: rgba(255,255,255,.1);
  color: #fff;
}

/* ════════════════════════════════════
   Responsive breakpoints
   ════════════════════════════════════ */
/* Medium-narrow window ≤640px: hide secondary controls */
@media (max-width: 640px) {
  .ctrl-right .spd-wrap {
    display: none;
  }

  .vol-track-wrap {
    width: 50px;
  }

  .cb.seek {
    display: none;
  }
}

/* Narrow window ≤500px: keep only essential controls */
@media (max-width: 500px) {
  .ctrl-right .fb,
  .ctrl-right .spd-wrap,
  .ctrl-right .audio-wrap {
    display: none;
  }

  .vol-track-wrap {
    width: 40px;
  }

  .p-time {
    font-size: 0.7rem;
  }

  .cb.seek {
    display: none;
  }
}

/* Ultra-narrow window ≤400px: minimal controls */
@media (max-width: 400px) {
  .ctrl-right .fb,
  .ctrl-right .spd-wrap,
  .ctrl-right .audio-wrap,
  .ctrl-right .more-wrap {
    display: none;
  }

  .vol-track-wrap {
    width: 36px;
  }

  .p-time {
    font-size: 0.7rem;
  }

  .cb.seek {
    display: none;
  }
}
</style>
