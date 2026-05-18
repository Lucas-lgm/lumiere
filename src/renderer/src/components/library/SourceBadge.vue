<template>
  <span :class="['src', `src-${badgeClass}`]">
    {{ badgeText }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ResourceSource } from '../../types/media'

const { t } = useI18n()

const props = defineProps<{
  source: ResourceSource
}>()

const badgeText = computed(() => {
  const map: Record<ResourceSource, string> = {
    local: t('sourceBadge.local'),
    network: t('sourceBadge.network'),
    nas: t('sourceBadge.nas'),
    mounted: t('sourceBadge.mounted')
  }
  return map[props.source] || t('sourceBadge.unknown')
})

const badgeClass = computed(() => {
  const map: Record<ResourceSource, string> = {
    local: 'l',
    network: 'n',
    nas: 'nas',
    mounted: 'l'
  }
  return map[props.source] || 'l'
})
</script>

<style scoped>
.src {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  letter-spacing: .04em;
}

.src-l {
  background: rgba(136, 136, 160, .15);
  color: var(--t3);
}

.src-n {
  background: rgba(0, 122, 255, .15);
  color: var(--acc);
}

.src-nas {
  background: rgba(100, 200, 100, .15);
  color: #64c864;
}
</style>
