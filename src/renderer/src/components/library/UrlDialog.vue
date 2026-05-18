<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="dialog-overlay" @click.self="handleCancel">
        <div class="dialog-box">
          <div class="dialog-header">
            <span class="dialog-title">{{ $t('player.url.title') }}</span>
            <button class="btn-i dialog-close" @click="handleCancel">
              <Icon name="x" :size="14" />
            </button>
          </div>
          <div class="dialog-body">
            <label class="dialog-label">{{ $t('player.url.label') }}</label>
            <input
              ref="inputRef"
              v-model="urlValue"
              type="text"
              class="dialog-input"
              :placeholder="$t('player.url.placeholder')"
              @keyup.enter="handleConfirm"
            />
            <div v-if="urlError" class="dialog-error">{{ urlError }}</div>
          </div>
          <div class="dialog-footer">
            <button class="btn-s" @click="handleCancel">{{ $t('player.url.cancel') }}</button>
            <button class="btn-p" @click="handleConfirm">{{ $t('player.url.play') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'

const { t } = useI18n()

interface Props {
  visible: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  confirm: [url: string]
}>()

const urlValue = ref('')
const urlError = ref('')
const inputRef = ref<HTMLInputElement>()

// Auto-detect clipboard URL when dialog opens
watch(() => props.visible, async (show) => {
  if (show) {
    urlValue.value = ''
    urlError.value = ''
    // Try to read clipboard
    try {
      const text = await navigator.clipboard.readText()
      if (text && /^https?:\/\/.+/i.test(text.trim())) {
        urlValue.value = text.trim()
      }
    } catch { /* clipboard access denied, ignore */ }
    // Focus input
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  }
})

function handleConfirm() {
  const trimmed = urlValue.value.trim()
  if (!trimmed) {
    urlError.value = t('player.url.errorEmpty')
    return
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    urlError.value = t('player.url.errorInvalid')
    return
  }
  urlError.value = ''
  emit('confirm', trimmed)
  emit('update:visible', false)
}

function handleCancel() {
  urlValue.value = ''
  urlError.value = ''
  emit('update:visible', false)
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, .4);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-box {
  width: 420px;
  background: var(--bg-e);
  border: 1px solid var(--bd);
  border-radius: var(--r3);
  box-shadow: 0 8px 32px rgba(0, 0, 0, .18);
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--bd);
}

.dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--t1);
}

.dialog-close {
  color: var(--t3);
}

.dialog-body {
  padding: 18px;
}

.dialog-label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--t2);
  margin-bottom: 6px;
}

.dialog-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  color: var(--t1);
  background: var(--bg-h);
  border: 1px solid var(--bd);
  border-radius: var(--r1);
  outline: none;
  transition: border-color var(--dur-fast);
  box-sizing: border-box;
}

.dialog-input:focus {
  border-color: var(--acc);
}

.dialog-input::placeholder {
  color: var(--t3);
}

.dialog-error {
  font-size: 11px;
  color: var(--red);
  margin-top: 6px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--bd);
}

/* Transition */
.dialog-enter-active {
  transition: opacity var(--dur-normal);
}

.dialog-enter-active .dialog-box {
  transition: transform var(--dur-normal) cubic-bezier(.4, 0, .2, 1);
}

.dialog-leave-active {
  transition: opacity var(--dur-fast);
}

.dialog-enter-from {
  opacity: 0;
}

.dialog-enter-from .dialog-box {
  transform: scale(.96);
}

.dialog-leave-to {
  opacity: 0;
}
</style>
