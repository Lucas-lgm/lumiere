<template>
  <div class="lib-search" :class="{ focused }">
    <span class="lib-search-icon"><Icon name="search" :size="12" /></span>
    <input
      ref="inputRef"
      v-model="searchValue"
      type="text"
      :placeholder="resolvedPlaceholder"
      class="lib-search-input"
      @input="handleInput"
      @focus="focused = true"
      @blur="focused = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'

const { t } = useI18n()

interface Props {
  placeholder?: string
  modelValue?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '',
  modelValue: ''
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  search: [value: string]
}>()

const searchValue = ref(props.modelValue)
const focused = ref(false)
const inputRef = ref<HTMLInputElement>()

// Use prop placeholder if provided, otherwise use i18n key
const resolvedPlaceholder = computed(() =>
  props.placeholder || t('searchBox.placeholder')
)

watch(() => props.modelValue, (v) => { searchValue.value = v })

function handleInput() {
  emit('update:modelValue', searchValue.value)
  emit('search', searchValue.value)
}

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<style scoped>
.lib-search {
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(0, 0, 0, .04);
  border: none;
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--t3);
  min-width: 140px;
  max-width: 240px;
  flex: 1;
  transition: box-shadow var(--dur-fast);
}

[data-theme="dark"] .lib-search {
  background: rgba(255, 255, 255, .06);
}

.lib-search.focused {
  box-shadow: var(--focus-ring);
}

.lib-search-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.lib-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12px;
  color: var(--t1);
  font-family: inherit;
  min-width: 0;
}

.lib-search-input::placeholder {
  color: var(--t3);
}
</style>
