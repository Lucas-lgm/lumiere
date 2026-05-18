<template>
  <!-- PIP idle: 2px progress bar (always visible) -->
  <div class="pip-idle-bar">
    <div class="pip-idle-prog" @mousedown="onProgressMouseDown($event)">
      <div class="pip-idle-prog-fill" :style="{ width: progressPercent + '%' }"></div>
    </div>
  </div>

  <!-- PIP hover overlay: top buttons + bottom controls -->
  <div class="pip-overlay" :class="{ visible: pipHover }">
    <!-- Top: close + return buttons -->
    <div class="pip-top">
      <button class="pip-btn" @click="closePip()" :title="$t('player.controls.pipClose')">
        <Icon name="x" :size="12" />
      </button>
      <button class="pip-btn" @click="returnFromPip()" :title="$t('player.controls.pipReturn')">
        <Icon name="external-link" :size="12" />
      </button>
    </div>
    <!-- Bottom: 3px progress bar + playback controls -->
    <div class="pip-bottom">
      <div class="pip-prog" @mousedown="onProgressMouseDown($event)">
        <div class="pip-prog-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <div class="pip-row">
        <button class="cb" @click="playPrevFromPlaylist()" :title="$t('player.controls.prev')">
          <Icon name="skip-back" :size="14" />
        </button>
        <button class="cb play" @click="togglePlayPause()" :title="isPlaying ? $t('player.controls.pause') : $t('player.controls.play')">
          <Icon :name="isPlaying ? 'pause' : 'play'" :size="16" />
        </button>
        <button class="cb" @click="playNextFromPlaylist()" :title="$t('player.controls.next')">
          <Icon name="skip-forward" :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '../base/Icon.vue'
import { injectStrict, playerCoreKey, playerTimelineKey, playerOverlayKey } from '../../composables/playerInjectKeys'

const { isPlaying, togglePlayPause, playPrevFromPlaylist, playNextFromPlaylist } = injectStrict(playerCoreKey)
const { progressPercent, onProgressMouseDown } = injectStrict(playerTimelineKey)
const { pipHover, closePip, returnFromPip } = injectStrict(playerOverlayKey)
</script>

<style scoped>
/* ── PIP idle: 2px progress bar, always visible ── */
.pip-idle-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 15;
  -webkit-app-region: no-drag;
  transition: opacity 150ms ease-in;
}

.pip-idle-prog {
  height: 2px;
  background: rgba(255,255,255,.15);
  cursor: pointer;
}

.pip-idle-prog-fill {
  height: 100%;
  background: var(--accent);
  pointer-events: none;
}

/* ── PIP hover overlay ── */
.pip-overlay {
  position: absolute;
  inset: 0;
  z-index: 16;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease-in;
}

.pip-overlay.visible {
  opacity: 1;
  pointer-events: auto;
  transition: opacity 200ms ease-out;
}

/* Top bar: gradient + close/return buttons */
.pip-top {
  display: flex;
  justify-content: space-between;
  padding: 8px 10px;
  background: linear-gradient(to bottom, rgba(0,0,0,.6) 0%, transparent 100%);
}

.pip-btn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,.15);
  backdrop-filter: blur(8px);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background .15s;
  -webkit-app-region: no-drag;
}

.pip-btn:hover {
  background: rgba(255,255,255,.3);
}

/* Bottom bar: gradient + 3px progress + controls */
.pip-bottom {
  padding: 0 6px 6px;
  background: linear-gradient(to top, rgba(0,0,0,.75) 0%, transparent 100%);
}

.pip-prog {
  height: 3px;
  background: rgba(255,255,255,.15);
  border-radius: 2px;
  cursor: pointer;
  margin-bottom: 4px;
  position: relative;
  -webkit-app-region: no-drag;
}

.pip-prog-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  pointer-events: none;
}

.pip-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

/* cb base styles for pip controls */
.cb {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: rgba(255,255,255,.75);
  border-radius: 6px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  -webkit-app-region: no-drag;
}

.cb:hover {
  background: rgba(255,255,255,.1);
  color: #fff;
}

.cb:active {
  transform: scale(0.92);
}

.cb.play {
  color: #ffffff;
  width: 32px;
  height: 32px;
}

.cb.play:hover {
  background: rgba(255,255,255,.12);
}
</style>
