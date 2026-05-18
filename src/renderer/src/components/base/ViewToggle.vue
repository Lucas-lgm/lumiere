<template>
  <div class="seg">
    <button
      v-for="mode in modes"
      :key="mode.value"
      :class="['seg-i', { on: modelValue === mode.value }]"
      @click="emit('update:modelValue', mode.value)"
    >
      {{ mode.icon }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ViewMode } from '../../types/media'

defineProps<{
  modelValue: ViewMode
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ViewMode]
}>()

const modes = [
  { value: 'grid' as ViewMode, icon: '▦' },
  { value: 'list' as ViewMode, icon: '≡' }
]
</script>

<style scoped>
.seg {
  display: flex;
  background: var(--bg-e);
  border-radius: var(--r1);
  padding: 2px;
  gap: 1px;
}

.seg-i {
  padding: 4px 10px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--t2);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--dur-fast);
  background: transparent;
  border: none;
  font-family: inherit;
}

.seg-i.on {
  background: var(--bg-a);
  color: var(--t1);
}

.seg-i:hover:not(.on) {
  color: var(--t1);
}
</style>
