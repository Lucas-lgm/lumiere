<template>
  <header
    class="p-top"
    @mouseenter="onControlBarEnter()"
    @mouseleave="onControlBarLeave()"
  >
    <div class="window-controls">
      <template v-if="!isFullscreen">
        <button class="window-btn close" @click.stop="handleWindowAction('close')"></button>
        <button class="window-btn minimize" @click.stop="handleWindowAction('minimize')"></button>
        <button class="window-btn fullscreen" @click.stop="toggleFullscreen()"></button>
      </template>
    </div>
    <h1 class="title">{{ currentVideoName || $t('player.controls.title') }}</h1>
    <button class="cb top-playlist-btn" @click="togglePanel('playlist')" :title="$t('player.controls.playlist')">
      <Icon name="list-video" :size="18" />
    </button>
  </header>
</template>

<script setup lang="ts">
import Icon from '../base/Icon.vue'
import { injectStrict, playerCoreKey, playerPanelKey } from '../../composables/playerInjectKeys'

const { currentVideoName, isFullscreen, onControlBarEnter, onControlBarLeave, handleWindowAction, toggleFullscreen } = injectStrict(playerCoreKey)
const { togglePanel } = injectStrict(playerPanelKey)
</script>

<style scoped>
.p-top {
  padding: 13px 14px;
  background: linear-gradient(to bottom, rgba(0,0,0,.72) 0%, transparent 100%);
  -webkit-app-region: drag;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 1;
  transition: opacity var(--dur-slow) ease, transform var(--dur-slow) ease;
  will-change: opacity, transform;
  position: relative;
  z-index: 20;
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
  pointer-events: auto;
}

.title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: center;
  min-width: 0;
}

.top-playlist-btn {
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

.window-btn {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  background-color: #808080;
  opacity: 0.9;
  transition: opacity 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.window-btn.close {
  background-color: #ff5f57;
}

.window-btn.minimize {
  background-color: #febc2e;
}

.window-btn.fullscreen {
  background-color: #28c840;
}

.window-btn:hover {
  opacity: 1;
}

/* macOS traffic light hover icons via ::after */
.window-btn::after {
  content: '';
  display: block;
  width: 8px;
  height: 8px;
  opacity: 0;
  transition: opacity .1s;
}

.window-controls:hover .window-btn::after {
  opacity: 1;
}

/* ✕ close icon */
.window-btn.close::after {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Cpath d='M1.5 1.5l5 5M6.5 1.5l-5 5' stroke='%234d0000' stroke-width='1.2' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;
}

/* − minimize icon */
.window-btn.minimize::after {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Cpath d='M1.5 4h5' stroke='%23995700' stroke-width='1.2' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;
}

/* ⛶ fullscreen icon (two diagonal expanding arrows) */
.window-btn.fullscreen::after {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Cpath d='M1 3V1h2M7 5v2H5' stroke='%23006500' stroke-width='1.2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat;
}

/* cb base styles needed for top-playlist-btn */
.cb {
  width: 32px;
  height: 32px;
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
</style>
