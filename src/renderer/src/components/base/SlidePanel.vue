<template>
  <Transition :name="isNarrow ? 'slide-panel-bottom' : 'slide-panel'">
    <div
      v-if="visible"
      :class="['slide-panel', `slide-panel--${context}`, { 'slide-panel--modal': isNarrow }]"
    >
      <!-- Narrow-window backdrop (modal mode): click to close -->
      <div v-if="isNarrow" class="sp-backdrop" @click="emit('close')" />
      <div class="ph">
        <div class="ph-left">
          <Icon v-if="icon" :name="icon" :size="13" />
          <span class="ph-title">{{ title }}</span>
        </div>
        <button class="ph-close" :class="{ 'ph-close--modal': isNarrow }" @click="emit('close')">
          <Icon name="x" :size="14" />
        </button>
      </div>
      <div class="pb">
        <slot />
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Icon from './Icon.vue'

interface Props {
  visible: boolean
  title: string
  icon?: string
  context?: 'player' | 'library'
}

withDefaults(defineProps<Props>(), {
  context: 'player'
})

const emit = defineEmits<{
  close: []
}>()

// Narrow-window detection (≤400px → modal mode)
const NARROW_BREAKPOINT = 400
const isNarrow = ref(false)

let mq: MediaQueryList | null = null

function onMediaChange(e: MediaQueryListEvent | MediaQueryList) {
  isNarrow.value = e.matches
}

onMounted(() => {
  mq = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`)
  isNarrow.value = mq.matches
  mq.addEventListener('change', onMediaChange)
})

onUnmounted(() => {
  mq?.removeEventListener('change', onMediaChange)
})
</script>

<style scoped>
/* ─── Base panel (wide window: right-side slide-in) ─── */
.slide-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 260px;
  display: flex;
  flex-direction: column;
  z-index: 100;
  overflow: hidden;
}

/* Player context — frosted glass */
.slide-panel--player {
  background: rgba(28, 28, 30, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: var(--shadow-popover);
}

/* Library context — theme-aware solid */
.slide-panel--library {
  background: var(--bg-e);
  box-shadow: var(--shadow-popover);
}

/* Panel header */
.ph {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 15px 10px;
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.slide-panel--player .ph {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.ph-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ph-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--t1);
}

.slide-panel--player .ph-title {
  color: #ffffff;
}

.slide-panel--player .ph-left {
  color: #ffffff;
}

.ph-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  color: var(--t3);
  cursor: pointer;
  border-radius: var(--r1);
  transition: all var(--dur-fast);
}

.ph-close:hover {
  background: var(--bg-h);
  color: var(--t1);
}

.slide-panel--player .ph-close {
  color: rgba(255, 255, 255, 0.5);
}

.slide-panel--player .ph-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

/* Panel body */
.pb {
  flex: 1;
  overflow-y: auto;
  padding: 11px 15px;
  -webkit-app-region: no-drag;
}

/* ─── Narrow window modal mode (≤400px) ─── */
.sp-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 199;
}

.slide-panel--modal {
  /* Override: full width, full height, fixed position, bottom-anchored */
  position: fixed;
  top: auto;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  /* Modal height: leave ~60px at top so user can tap backdrop to dismiss */
  height: calc(100% - 60px);
  border-radius: 12px 12px 0 0;
  z-index: 200;
}

/* Taller close button in modal mode for easier tap */
.ph-close--modal {
  width: 32px;
  height: 32px;
}

/* ─── Transition: right-side slide (wide) ─── */
.slide-panel-enter-active {
  animation: slide-in-right var(--dur-panel) var(--ease-default);
}

.slide-panel-leave-active {
  animation: slide-out-right var(--dur-panel) var(--ease-default);
}

/* ─── Transition: bottom slide (narrow modal) ─── */
.slide-panel-bottom-enter-active {
  animation: slide-in-bottom var(--dur-panel) var(--ease-default);
}

.slide-panel-bottom-leave-active {
  animation: slide-out-bottom var(--dur-panel) var(--ease-default);
}

/* ─── Backdrop fade transition ─── */
.sp-backdrop-enter-active {
  transition: opacity var(--dur-panel) var(--ease-default);
}

.sp-backdrop-leave-active {
  transition: opacity var(--dur-panel) var(--ease-default);
}

.sp-backdrop-enter-from,
.sp-backdrop-leave-to {
  opacity: 0;
}

@keyframes slide-in-bottom {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@keyframes slide-out-bottom {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}
</style>
