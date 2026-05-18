<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="modal-overlay" @mousedown.self="handleOverlayClick">
        <div class="modal-dialog" :style="{ width }">
          <div class="modal-header">
            <span class="modal-title">{{ title }}</span>
            <button class="modal-close" @click="close">
              <Icon name="x" :size="14" />
            </button>
          </div>
          <div class="modal-body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'

interface Props {
  modelValue: boolean
  title?: string
  width?: string
  closeOnClickModal?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  width: '480px',
  closeOnClickModal: true
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function handleOverlayClick() {
  if (props.closeOnClickModal) close()
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
}

.modal-dialog {
  background: var(--bg);
  border: none;
  border-radius: var(--r-m, 10px);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

[data-theme="dark"] .modal-dialog {
  background: var(--bg-e);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}

.modal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--t1);
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  color: var(--t3);
  cursor: pointer;
  border-radius: var(--r-s, 6px);
  transition: all var(--dur-fast);
}

.modal-close:hover {
  color: var(--t1);
  background: var(--bg-h);
}

.modal-body {
  padding: 18px;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--bd);
  flex-shrink: 0;
}

/* Transition */
.modal-enter-active {
  transition: opacity var(--dur-normal) ease-out;
}

.modal-enter-active .modal-dialog {
  transition: transform var(--dur-normal) ease-out;
}

.modal-leave-active {
  transition: opacity var(--dur-fast) ease-in;
}

.modal-leave-active .modal-dialog {
  transition: transform var(--dur-fast) ease-in;
}

.modal-enter-from {
  opacity: 0;
}

.modal-enter-from .modal-dialog {
  transform: scale(0.96) translateY(-8px);
}

.modal-leave-to {
  opacity: 0;
}

.modal-leave-to .modal-dialog {
  transform: scale(0.98);
}
</style>
