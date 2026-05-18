<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="['toast-item', `toast-${toast.type}`]"
          @click="remove(toast.id)"
        >
          <Icon :name="iconName(toast.type)" :size="14" />
          <span class="toast-msg">{{ toast.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'
import { useToast } from '../../composables/useToast'

const { toasts, remove } = useToast()

function iconName(type: string) {
  switch (type) {
    case 'success': return 'check'
    case 'error': return 'x'
    case 'warning': return 'alert-triangle'
    default: return 'info'
  }
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 48px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: var(--r-s, 6px);
  font-size: 12px;
  color: #fff;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
  cursor: pointer;
  white-space: nowrap;
  max-width: 400px;
}

.toast-msg {
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast-success {
  background: rgba(52, 199, 89, 0.9);
}

.toast-error {
  background: rgba(255, 59, 48, 0.9);
}

.toast-warning {
  background: rgba(255, 149, 0, 0.9);
}

.toast-info {
  background: rgba(10, 132, 255, 0.9);
}

/* Transitions */
.toast-enter-active {
  transition: all 0.25s ease-out;
}

.toast-leave-active {
  transition: all var(--dur-normal) ease-in;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.toast-move {
  transition: transform var(--dur-normal) ease;
}
</style>
