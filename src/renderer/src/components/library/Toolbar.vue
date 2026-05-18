<template>
  <div class="lib-top-simple">
    <div class="lib-top-actions">
      <SearchBox
        ref="searchBoxRef"
        v-if="showSearch"
        :model-value="searchQuery"
        :placeholder="$t('searchBox.placeholder')"
        @update:model-value="$emit('update:search-query', $event)"
        @search="$emit('search', $event)"
      />
      <button ref="addBtnRef" class="btn-p" @click="handleAddClick">＋</button>
    </div>
    <div v-if="showViewToggle" class="lib-top-right">
      <ViewToggle
        :model-value="viewMode"
        @update:model-value="$emit('update:view-mode', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SearchBox from '../base/SearchBox.vue'
import ViewToggle from '../base/ViewToggle.vue'
import { useContextMenu, type MenuItem } from '../../composables/useContextMenu'
import type { ViewMode } from '../../types/media'

const { t } = useI18n()

interface Props {
  viewMode: ViewMode
  showSearch?: boolean
  showViewToggle?: boolean
  searchQuery?: string
}

withDefaults(defineProps<Props>(), {
  showSearch: true,
  showViewToggle: true,
  searchQuery: ''
})

const emit = defineEmits<{
  'add-file': []
  'add-folder': []
  'add-url': []
  'update:view-mode': [mode: ViewMode]
  'update:search-query': [query: string]
  search: [query: string]
}>()

const addBtnRef = ref<HTMLElement | null>(null)
const searchBoxRef = ref<InstanceType<typeof SearchBox> | null>(null)

defineExpose({ focusSearch: () => searchBoxRef.value?.focus() })
const clipboardUrl = ref<string | null>(null)
const { showMenu } = useContextMenu()

function truncateUrl(url: string): string {
  return url.length > 40 ? url.substring(0, 37) + '...' : url
}

async function checkClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (text && /^https?:\/\/.+/i.test(text.trim())) {
      clipboardUrl.value = text.trim()
    } else {
      clipboardUrl.value = null
    }
  } catch {
    clipboardUrl.value = null
  }
}

const handleAddClick = async (e: MouseEvent) => {
  await checkClipboard()

  const items: MenuItem[] = [
    { id: 'add-file', label: t('toolbar.addFile'), icon: 'file' },
    { id: 'add-folder', label: t('toolbar.addFolder'), icon: 'folder-open' },
    { type: 'separator' },
    { id: 'add-url', label: t('toolbar.addUrl'), icon: 'link' }
  ]
  if (clipboardUrl.value) {
    items.push(
      { type: 'separator' },
      { id: 'paste-url', label: t('toolbar.paste', { url: truncateUrl(clipboardUrl.value) }), icon: 'clipboard' }
    )
  }

  // Position below the button
  if (addBtnRef.value) {
    const rect = addBtnRef.value.getBoundingClientRect()
    const fakeEvent = { ...e, clientX: rect.left, clientY: rect.bottom + 4, preventDefault: () => {} } as MouseEvent
    showMenu(fakeEvent, items, (id) => {
      if (id === 'add-file') emit('add-file')
      else if (id === 'add-folder') emit('add-folder')
      else if (id === 'add-url') emit('add-url')
      else if (id === 'paste-url') emit('add-url')
    })
  }
}
</script>

<style scoped>
.lib-top-simple {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  background: var(--bg-s);
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}

.lib-top-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1;
}

.lib-top-right {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
