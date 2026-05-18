<template>
  <div
    :class="['sidebar-mount-item', { active }]"
    @click="$emit('select')"
  >
    <span class="sidebar-item-icon"><Icon name="folder-open" :size="14" /></span>
    <span class="sidebar-mount-path">{{ mountPath.path }}</span>
    <span class="sidebar-mount-count">({{ mountPath.resourceCount }})</span>
    <div class="sidebar-mount-actions" @click.stop>
      <span
        class="sidebar-mount-action"
        :title="$t('mountPathItem.refresh')"
        @click="$emit('refresh')"
      >
        <Icon name="refresh" :size="12" />
      </span>
      <span
        class="sidebar-mount-action"
        :title="$t('mountPathItem.remove')"
        @click="$emit('remove')"
      >
        ×
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'
import type { MountPath } from '../../types/mount'

const { t } = useI18n()

interface Props {
  mountPath: MountPath
  active?: boolean
}

withDefaults(defineProps<Props>(), {
  active: false
})

defineEmits<{
  select: []
  refresh: []
  remove: []
}>()
</script>

<style scoped>
.sidebar-mount-item {
  padding: 10px 20px;
  color: #ccc;
  cursor: pointer;
  transition: all var(--dur-normal);
  display: flex;
  align-items: center;
  gap: 8px;
  border-left: 3px solid transparent;
  font-size: 0.85rem;
}

.sidebar-mount-item:hover {
  background: #2a2a32;
  color: #fff;
}

.sidebar-mount-item.active {
  background: #2d2d35;
  color: #fff;
  border-left-color: #4a9eff;
}

.sidebar-item-icon {
  width: 20px;
  text-align: center;
  font-size: 1rem;
  flex-shrink: 0;
}

.sidebar-mount-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.sidebar-mount-count {
  font-size: 0.75rem;
  color: #888;
  margin-left: 4px;
  flex-shrink: 0;
}

.sidebar-mount-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--dur-normal);
  flex-shrink: 0;
}

.sidebar-mount-item:hover .sidebar-mount-actions {
  opacity: 1;
}

.sidebar-mount-action {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  transition: background var(--dur-normal);
}

.sidebar-mount-action:hover {
  background: #3a3a42;
}
</style>
