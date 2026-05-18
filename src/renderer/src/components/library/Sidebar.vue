<template>
  <div class="lib-sidebar" :class="{ collapsed }">
    <!-- Home -->
    <div
      class="lib-sb-item"
      :class="{ on: props.activeFilter === 'all' }"
      @click="$emit('filter-change', 'all')"
    >
      <span class="lib-sb-icon"><Icon name="home" :size="14" /></span>
      <span class="lib-sb-text">{{ $t('sidebar.home') }}</span>
    </div>

    <!-- Series (folder group view) -->
    <div
      class="lib-sb-item"
      :class="{ on: props.activeFilter === 'series' }"
      @click="$emit('filter-change', 'series')"
    >
      <span class="lib-sb-icon"><Icon name="folder-open" :size="14" /></span>
      <span class="lib-sb-text">{{ $t('sidebar.series') }}</span>
    </div>

    <div class="lib-sb-sep"></div>

    <!-- Folders -->
    <div class="lib-sb-label">
      <span class="lib-sb-label-text">{{ $t('sidebar.folders') }}</span>
      <span class="lib-sb-label-action" @click.stop="$emit('mount-path-add')">＋</span>
    </div>

    <template v-for="mountPath in props.mountPaths" :key="mountPath.id">
      <div
        class="lib-sb-item lib-sb-child"
        :class="{ on: props.selectedMountPath === mountPath.id }"
        @click="$emit('mount-path-select', mountPath.id)"
        @contextmenu.prevent="handleMountPathContext($event, mountPath.id)"
      >
        <span class="lib-sb-text">{{ mountPath.path.split('/').pop() }}</span>
      </div>
    </template>

    <!-- Bottom fixed area -->
    <div class="lib-sb-bottom">
      <div class="lib-sb-item" @click="$emit('open-settings')">
        <span class="lib-sb-icon"><Icon name="settings" :size="14" /></span>
        <span class="lib-sb-text">{{ $t('sidebar.settings') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'
import { useContextMenu } from '../../composables/useContextMenu'
import type { MountPath } from '../../types/mount'

const { t } = useI18n()

interface Props {
  activeFilter: string
  mountPaths: MountPath[]
  selectedMountPath: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'filter-change': [filter: string]
  'mount-path-select': [id: string]
  'mount-path-add': []
  'mount-path-remove': [id: string]
  'mount-path-refresh': [id: string]
  'open-settings': []
}>()

const { showMenu } = useContextMenu()
const collapsed = ref(false)

function toggleCollapse() {
  collapsed.value = !collapsed.value
}

function handleMountPathContext(e: MouseEvent, id: string) {
  showMenu(e, [
    { id: 'refresh', icon: 'refresh', label: t('sidebar.contextMenu.refresh') },
    { type: 'separator' },
    { id: 'remove', icon: 'trash', label: t('sidebar.contextMenu.remove'), danger: true }
  ], (actionId) => {
    if (actionId === 'refresh') emit('mount-path-refresh', id)
    else if (actionId === 'remove') emit('mount-path-remove', id)
  })
}

// ⌘\ shortcut to collapse sidebar
function handleKeydown(e: KeyboardEvent) {
  if (e.metaKey && e.key === '\\') {
    e.preventDefault()
    toggleCollapse()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

defineExpose({ collapsed, toggleCollapse })
</script>

<style scoped>
.lib-sidebar {
  width: 180px;
  min-width: 180px;
  background: var(--bg-s);
  border-right: 1px solid var(--bd);
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(20px);
  flex-shrink: 0;
  overflow-y: auto;
  transition: width .2s var(--ease-default), min-width .2s var(--ease-default);
}

.lib-sidebar.collapsed {
  width: 48px;
  min-width: 48px;
}

.lib-sidebar.collapsed .lib-sb-text,
.lib-sidebar.collapsed .lib-sb-label {
  display: none;
}

.lib-sidebar.collapsed .lib-sb-item {
  justify-content: center;
  padding: 5px 0;
}

.lib-sidebar.collapsed .lib-sb-child {
  padding-left: 0;
}

/* Sidebar label (section headers) */
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

/* Sidebar items */
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
  border-radius: 0;
}

.lib-sb-item:hover {
  background: var(--bg-h);
  color: var(--t1);
}

.lib-sb-item.on {
  background: var(--bg-a);
  color: var(--t1);
  font-weight: 600;
}


.lib-sb-child {
  padding-left: 24px;
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

.lib-sb-sep {
  height: 1px;
  background: var(--bd);
  margin: 6px 14px;
}

.lib-sb-bottom {
  margin-top: auto;
  padding-top: 6px;
  border-top: 1px solid var(--bd);
}

/* ===== RESPONSIVE ===== */
/* ≤500px: auto-collapse sidebar to icon mode */
@media (max-width: 500px) {
  .lib-sidebar {
    width: 48px;
    min-width: 48px;
  }

  .lib-sidebar .lib-sb-text,
  .lib-sidebar .lib-sb-label {
    display: none;
  }

  .lib-sidebar .lib-sb-item {
    justify-content: center;
    padding: 5px 0;
  }

  .lib-sidebar .lib-sb-child {
    padding-left: 0;
  }
}
</style>
