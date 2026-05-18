<template>
  <div class="lib-section-head">
    <div class="lib-section-title">{{ title }}</div>
    <div v-if="subtitle" class="lib-section-sub">{{ subtitle }}</div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  title: string
  subtitle?: string
}

withDefaults(defineProps<Props>(), {
  subtitle: ''
})
</script>

<style scoped>
.lib-section-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 2px;
}

.lib-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--t1);
}

.lib-section-sub {
  font-size: 11px;
  color: var(--t3);
}
</style>
