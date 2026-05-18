<template>
  <div class="lib-sb-section">
    <div v-if="title" class="lib-sb-label">
      <span class="lib-sb-label-text">{{ title }}</span>
      <span
        v-if="showAddButton"
        class="lib-sb-label-action"
        @click.stop="$emit('add')"
        :title="addButtonTitle"
      >
        ＋
      </span>
    </div>
    <div class="lib-sb-section-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  title: string
  showAddButton?: boolean
  addButtonTitle?: string
}

withDefaults(defineProps<Props>(), {
  showAddButton: false,
  addButtonTitle: 'Add'
})

defineEmits<{
  add: []
}>()
</script>

<style scoped>
.lib-sb-section {
  margin-bottom: 4px;
}

.lib-sb-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--t3);
  letter-spacing: .04em;
  text-transform: uppercase;
}

.lib-sb-label-action {
  cursor: pointer;
  color: var(--acc);
  font-size: 12px;
  font-weight: 500;
  padding: 0 2px;
  border-radius: 3px;
  transition: background var(--dur-fast);
}

.lib-sb-label-action:hover {
  background: var(--acc-d);
}

.lib-sb-section-content {
  display: flex;
  flex-direction: column;
}
</style>
