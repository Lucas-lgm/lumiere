<template>
  <Teleport to="body">
    <Transition name="kb-fade">
      <div v-if="visible" class="kb-overlay" @click.self="$emit('update:visible', false)">
        <div class="kb-panel">
          <div class="kb-header">
            <span class="kb-title">{{ $t('player.shortcuts.title') }}</span>
            <button class="btn-i kb-close" @click="$emit('update:visible', false)">
              <Icon name="x" :size="14" />
            </button>
          </div>
          <div class="kb-grid">
            <div class="kb-section">
              <div class="kb-section-t">{{ $t('player.shortcuts.sectionPlayback') }}</div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.playPause') }}</span><div class="kb-keys"><span class="key">Space</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.seekBack10') }}</span><div class="kb-keys"><span class="key">←</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.seekFwd10') }}</span><div class="kb-keys"><span class="key">→</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.seekBack30') }}</span><div class="kb-keys"><span class="key">⇧</span><span class="key">←</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.seekFwd30') }}</span><div class="kb-keys"><span class="key">⇧</span><span class="key">→</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.prevNext') }}</span><div class="kb-keys"><span class="key">⇧⌘←</span><span class="key">⇧⌘→</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.speedUpDown') }}</span><div class="kb-keys"><span class="key">]</span><span class="key">[</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.frameBack') }}</span><div class="kb-keys"><span class="key">,</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.frameFwd') }}</span><div class="kb-keys"><span class="key">.</span></div></div>
            </div>

            <div class="kb-section">
              <div class="kb-section-t">{{ $t('player.shortcuts.sectionPicture') }}</div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.fullscreen') }}</span><div class="kb-keys"><span class="key">F</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.volUp') }}</span><div class="kb-keys"><span class="key">↑</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.volDown') }}</span><div class="kb-keys"><span class="key">↓</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.mute') }}</span><div class="kb-keys"><span class="key">M</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.screenshot') }}</span><div class="kb-keys"><span class="key">⌘S</span></div></div>
            </div>

            <div class="kb-section">
              <div class="kb-section-t">{{ $t('player.shortcuts.sectionOther') }}</div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.abLoop') }}</span><div class="kb-keys"><span class="key">⌘L</span></div></div>
            </div>

            <div class="kb-section">
              <div class="kb-section-t">{{ $t('player.shortcuts.sectionUI') }}</div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.openFile') }}</span><div class="kb-keys"><span class="key">⌘O</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.pasteUrl') }}</span><div class="kb-keys"><span class="key">⌘N</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.showPlaylist') }}</span><div class="kb-keys"><span class="key">⌘P</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.showHelp') }}</span><div class="kb-keys"><span class="key">⌘?</span></div></div>
              <div class="kb-row"><span class="kb-desc">{{ $t('player.shortcuts.backToLib') }}</span><div class="kb-keys"><span class="key">⌘←</span></div></div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import Icon from '../base/Icon.vue'

defineProps<{
  visible: boolean
}>()

defineEmits<{
  'update:visible': [value: boolean]
}>()
</script>

<style scoped>
.kb-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .4);
}

.kb-panel {
  width: 640px;
  max-width: 90vw;
  max-height: 80vh;
  background: var(--bg);
  border: 1px solid var(--bd);
  border-radius: var(--r3);
  box-shadow: 0 16px 48px rgba(0, 0, 0, .25);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.kb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}

.kb-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--t1);
}

.kb-close {
  color: var(--t3);
}

.kb-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow-y: auto;
}

.kb-section {
  padding: 14px;
}

.kb-section-t {
  font-size: 11px;
  font-weight: 600;
  color: var(--t3);
  text-transform: uppercase;
  letter-spacing: .06em;
  margin-bottom: 8px;
}

.kb-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid var(--bd);
}

.kb-row:last-child {
  border-bottom: none;
}

.kb-desc {
  font-size: 12px;
  color: var(--t2);
}

.kb-keys {
  display: flex;
  gap: 3px;
  align-items: center;
}

.key {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-a);
  border: 1px solid var(--bd-h);
  font-size: 10px;
  font-weight: 600;
  color: var(--t1);
  font-family: 'SF Mono', 'JetBrains Mono', 'Menlo', monospace;
  line-height: 1.4;
  white-space: nowrap;
}

/* Transition */
.kb-fade-enter-active,
.kb-fade-leave-active {
  transition: opacity .2s ease;
}

.kb-fade-enter-active .kb-panel,
.kb-fade-leave-active .kb-panel {
  transition: transform .2s ease, opacity .2s ease;
}

.kb-fade-enter-from,
.kb-fade-leave-to {
  opacity: 0;
}

.kb-fade-enter-from .kb-panel,
.kb-fade-leave-to .kb-panel {
  transform: scale(.96);
  opacity: 0;
}
</style>
