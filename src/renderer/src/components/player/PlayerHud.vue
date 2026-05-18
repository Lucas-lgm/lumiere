<template>
  <Transition name="hud-fade">
    <div v-if="hud.type" class="hud-overlay">
      <div class="hud-content">
        <Icon v-if="hud.type === 'volume'" :name="volumeIconName" :size="28" />
        <Icon v-else-if="hud.type === 'seek'" name="fast-forward" :size="28" />
        <Icon v-else-if="hud.type === 'zoom'" name="maximize" :size="28" />
        <Icon v-else-if="hud.type === 'loop'" name="repeat" :size="28" />
        <span class="hud-value">{{ hud.value }}</span>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import Icon from '../base/Icon.vue'
import { injectStrict, playerControlsKey, playerOverlayKey } from '../../composables/playerInjectKeys'

const { hud } = injectStrict(playerOverlayKey)
const { volumeIconName } = injectStrict(playerControlsKey)
</script>

<style scoped>
.hud-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 18;
}

.hud-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 24px;
  background: rgba(0, 0, 0, 0.75);
  border-radius: 12px;
  color: #fff;
}

.hud-value {
  font-size: 1.1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* HUD fade transition */
.hud-fade-enter-active {
  transition: opacity 0.15s ease;
}
.hud-fade-leave-active {
  transition: opacity 0.4s ease;
}
.hud-fade-enter-from,
.hud-fade-leave-to {
  opacity: 0;
}
</style>
