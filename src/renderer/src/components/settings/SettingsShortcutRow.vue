<template>
  <div class="shortcut-row" :class="{ recording }">
    <div class="shortcut-label">{{ label }}</div>
    <div class="shortcut-key" @click="startRecording">
      <template v-if="recording">
        <span class="shortcut-recording">{{ $t('settings.shortcut.recording') }}</span>
      </template>
      <template v-else>
        <span class="shortcut-combo">{{ displayValue }}</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

interface Props {
  label: string
  modelValue: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const recording = ref(false)

const KEY_DISPLAY: Record<string, string> = {
  'Meta': '⌘',
  'Shift': '⇧',
  'Alt': '⌥',
  'Control': '⌃',
  'ArrowLeft': '←',
  'ArrowRight': '→',
  'ArrowUp': '↑',
  'ArrowDown': '↓',
  'Space': '␣',
  'Escape': 'Esc',
  'Enter': '↩',
  'Backspace': '⌫',
  'Delete': '⌦',
  'Tab': '⇥',
}

const displayValue = computed(() => {
  if (!props.modelValue) return t('settings.shortcut.unset')
  return props.modelValue
    .split('+')
    .map(k => KEY_DISPLAY[k] || k.toUpperCase())
    .join('')
})

function startRecording() {
  recording.value = true
  window.addEventListener('keydown', handleKeydown, true)
}

function stopRecording() {
  recording.value = false
  window.removeEventListener('keydown', handleKeydown, true)
}

function handleKeydown(e: KeyboardEvent) {
  e.preventDefault()
  e.stopPropagation()

  if (e.key === 'Escape') {
    stopRecording()
    return
  }

  // Skip lone modifier keys
  if (['Meta', 'Shift', 'Alt', 'Control'].includes(e.key)) return

  const parts: string[] = []
  if (e.metaKey) parts.push('Meta')
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key)

  emit('update:modelValue', parts.join('+'))
  stopRecording()
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>

<style scoped>
.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid var(--bd);
}

.shortcut-row:last-child {
  border-bottom: none;
}

.shortcut-label {
  font-size: 12px;
  color: var(--t2);
}

.shortcut-key {
  padding: 3px 10px;
  min-width: 60px;
  text-align: center;
  font-size: 11px;
  font-family: 'SF Mono', 'Menlo', monospace;
  color: var(--t1);
  background: var(--bg-h);
  border: 1px solid var(--bd);
  border-radius: var(--r1);
  cursor: pointer;
  transition: all var(--dur-fast);
  user-select: none;
}

.shortcut-key:hover {
  border-color: var(--acc);
}

.shortcut-row.recording .shortcut-key {
  border-color: var(--acc);
  box-shadow: 0 0 0 2px var(--acc-d);
}

.shortcut-recording {
  color: var(--acc);
  font-family: inherit;
  font-size: 11px;
}

.shortcut-combo {
  letter-spacing: .04em;
}
</style>
