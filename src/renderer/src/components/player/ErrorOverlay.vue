<template>
  <Transition name="fade">
    <div v-if="visible" class="error-overlay">
      <div class="error-box">
        <div class="error-icon">
          <Icon :name="errorType === 'codec' ? 'alert-triangle' : errorType === 'network' ? 'globe' : 'folder'" :size="40" />
        </div>
        <div class="error-title">{{ title }}</div>
        <div class="error-msg">
          {{ message }}
          <span v-if="detail" class="error-detail">{{ detail }}</span>
        </div>
        <div class="error-actions">
          <template v-if="errorType === 'codec'">
            <button class="err-btn" @click="$emit('soft-decode')">{{ $t('player.error.softDecode') }}</button>
            <button class="err-btn err-btn-primary" @click="$emit('retry')">{{ $t('player.error.retry') }}</button>
          </template>
          <template v-else-if="errorType === 'not-found'">
            <button class="err-btn" @click="$emit('relocate')">{{ $t('player.error.relocate') }}</button>
            <button class="err-btn" @click="$emit('remove')">{{ $t('player.error.removeFromList') }}</button>
          </template>
          <template v-else-if="errorType === 'network'">
            <button class="err-btn err-btn-primary" @click="$emit('retry')">{{ $t('player.error.retry') }}</button>
          </template>
          <template v-else>
            <button class="err-btn err-btn-primary" @click="$emit('retry')">{{ $t('player.error.retry') }}</button>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'

const { t } = useI18n()

interface Props {
  visible: boolean
  errorType?: 'codec' | 'not-found' | 'network' | 'generic'
  errorMessage?: string
  filePath?: string
}

const props = withDefaults(defineProps<Props>(), {
  errorType: 'generic',
  errorMessage: '',
  filePath: ''
})

defineEmits<{
  retry: []
  'soft-decode': []
  relocate: []
  remove: []
}>()

const title = computed(() => {
  switch (props.errorType) {
    case 'codec': return t('player.error.cannotPlay')
    case 'not-found': return t('player.error.fileNotFound')
    case 'network': return t('player.error.networkError')
    default: return t('player.error.playbackError')
  }
})

const message = computed(() => {
  switch (props.errorType) {
    case 'codec':
      return props.errorMessage || t('player.error.codecMsg')
    case 'not-found':
      return t('player.error.fileNotFoundMsg')
    case 'network':
      return props.errorMessage || t('player.error.networkMsg')
    default:
      return props.errorMessage || t('player.error.unknownMsg')
  }
})

const detail = computed(() => {
  if (props.errorType === 'not-found' && props.filePath) {
    return props.filePath
  }
  if (props.errorType === 'codec' && props.errorMessage) {
    return `mpv error: ${props.errorMessage}`
  }
  return ''
})
</script>

<style scoped>
.error-overlay {
  position: absolute;
  top: 38px;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.error-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 300px;
  text-align: center;
}

.error-icon {
  opacity: 0.7;
  color: var(--p-t1);
}

.error-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--p-t1);
}

.error-msg {
  font-size: 12px;
  color: var(--p-t2);
  line-height: 1.55;
}

.error-detail {
  display: block;
  font-size: 10px;
  opacity: 0.6;
  margin-top: 4px;
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  word-break: break-all;
}

.error-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.err-btn {
  padding: 6px 14px;
  border-radius: var(--r1);
  border: 1px solid var(--p-bd);
  background: rgba(255, 255, 255, 0.08);
  color: var(--p-t2);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--dur-fast);
}

.err-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--p-t1);
}

.err-btn-primary {
  background: var(--acc);
  border-color: var(--acc);
  color: #fff;
}

.err-btn-primary:hover {
  background: var(--acc-h);
  border-color: var(--acc-h);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-normal);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
