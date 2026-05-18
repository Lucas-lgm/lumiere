<template>
  <Transition name="load-fade">
    <div v-if="visible" class="loading-overlay">
    <div class="loading-content">
      <div class="loading-spinner"></div>
      <span class="loading-text">
        {{
          isSwitchingVideo
            ? $t('player.controls.switching')
            : isNetworkBuffering
                ? networkBufferingPercent !== null
                  ? $t('player.controls.bufferingPercent', { percent: networkBufferingPercent })
                  : $t('player.controls.buffering')
                : isSeeking
                  ? $t('player.controls.seeking')
                  : $t('player.controls.loading')
        }}
      </span>
      <span v-if="!isSwitchingVideo && !isSeeking && !isNetworkBuffering && currentVideoName" class="loading-filename">
        {{ currentVideoName }}
      </span>
      <span v-if="!isSwitchingVideo && !isSeeking && resumeHint" class="loading-resume">
        {{ $t('player.controls.resumeFrom', { time: resumeHint }) }}
      </span>
    </div>
  </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { injectStrict, playerCoreKey } from '../../composables/playerInjectKeys'

const { isLoading, isSwitchingVideo, isNetworkBuffering, networkBufferingPercent, isSeeking, currentVideoName, resumeHint } = injectStrict(playerCoreKey)
const visible = computed(() => isLoading.value || isSwitchingVideo.value)
</script>

<style scoped>
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  z-index: 15;
}

.loading-content {
  padding: 1rem 1.5rem;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 320px;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  color: #ffffff;
  font-size: 0.9rem;
}

.loading-filename {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.loading-resume {
  color: var(--accent);
  font-size: 0.8rem;
  font-weight: 500;
}

/* Fade transition */
.load-fade-enter-active {
  transition: opacity var(--dur-slow) ease;
}

.load-fade-leave-active {
  transition: opacity var(--dur-fast) ease;
}

.load-fade-enter-from,
.load-fade-leave-to {
  opacity: 0;
}
</style>
