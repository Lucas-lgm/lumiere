<template>
  <div
    :class="['lib-sb-item', { on: active, 'lib-sb-child': child }]"
    @click="$emit('click')"
  >
    <span v-if="icon && !child" class="lib-sb-icon">
      <slot name="icon">
        <Icon :name="icon" :size="14" />
      </slot>
    </span>
    <span class="lib-sb-text">
      <slot>{{ label }}</slot>
    </span>
  </div>
</template>

<script setup lang="ts">
import Icon from '../base/Icon.vue'

interface Props {
  active?: boolean
  icon?: string
  label?: string
  child?: boolean
}

withDefaults(defineProps<Props>(), {
  active: false,
  icon: '',
  label: '',
  child: false
})

defineEmits<{
  click: []
}>()
</script>

<style scoped>
.lib-sb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  font-size: 12px;
  color: var(--t2);
  cursor: pointer;
  transition: all .12s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lib-sb-item:hover {
  background: rgba(0, 0, 0, .03);
  color: var(--t1);
}

.lib-sb-item.on {
  background: rgba(0, 0, 0, .06);
  color: var(--t1);
  font-weight: 600;
}

:global([data-theme="dark"]) .lib-sb-item:hover {
  background: rgba(255, 255, 255, .04);
}

:global([data-theme="dark"]) .lib-sb-item.on {
  background: rgba(255, 255, 255, .08);
}

.lib-sb-child {
  padding-left: 32px;
  font-size: 11px;
  color: var(--t3);
}

.lib-sb-child:hover {
  color: var(--t1);
}

.lib-sb-icon {
  width: 16px;
  text-align: center;
  font-size: 13px;
  flex-shrink: 0;
}

.lib-sb-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
