<template>
  <Teleport to="body">
    <div
      v-if="menuVisible"
      class="ctx-menu-overlay"
      @mousedown="handleClose"
    >
      <div
        ref="menuRef"
        class="ctx-menu"
        :style="menuStyle"
        @mousedown.stop
      >
        <template v-for="item in menuItems" :key="item.id || item.label || item.type">
          <div v-if="item.type === 'separator'" class="ctx-sep" />
          <div
            v-else
            :class="['ctx-item', { danger: item.danger, disabled: item.disabled }]"
            @click="handleItemClick(item)"
          >
            <span class="ctx-icon">
              <Icon v-if="item.icon" :name="item.icon" :size="13" />
            </span>
            {{ item.label }}
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import Icon from './Icon.vue'
import { useContextMenu, type MenuItem } from '../../composables/useContextMenu'

const { visible, position, items, hideMenu, handleSelect } = useContextMenu()

const menuRef = ref<HTMLElement | null>(null)
const adjustedPos = ref({ x: 0, y: 0 })

const menuVisible = computed(() => visible.value)
const menuItems = computed(() => items.value as MenuItem[])

const menuStyle = computed(() => ({
  left: `${adjustedPos.value.x}px`,
  top: `${adjustedPos.value.y}px`
}))

// Watch for visibility to adjust position within viewport
import { watch } from 'vue'

watch(visible, async (v) => {
  if (!v) return
  adjustedPos.value = { x: position.value.x, y: position.value.y }

  await nextTick()
  if (menuRef.value) {
    const rect = menuRef.value.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    if (rect.right > vw) {
      adjustedPos.value.x = Math.max(0, vw - rect.width - 8)
    }
    if (rect.bottom > vh) {
      adjustedPos.value.y = Math.max(0, vh - rect.height - 8)
    }
  }
})

function handleClose() {
  hideMenu()
}

function handleItemClick(item: MenuItem) {
  if (item.disabled) return
  if (item.id) {
    handleSelect(item.id)
  } else {
    hideMenu()
  }
}
</script>

<style scoped>
.ctx-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.ctx-menu {
  position: fixed;
  background: var(--bg-e);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--bd-h);
  border-radius: var(--r-m, 10px);
  box-shadow: var(--shadow-popover);
  padding: 4px;
  min-width: 180px;
  overflow: hidden;
  animation: ctx-in 120ms ease-out;
}

@keyframes ctx-in {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 12px;
  border-radius: var(--r-s, 6px);
  font-size: 12px;
  color: var(--t2);
  cursor: pointer;
  transition: background var(--dur-fast);
}

.ctx-item:hover {
  background: var(--bg-h);
}

.ctx-item.danger {
  color: #ff6060;
}

.ctx-item.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.ctx-icon {
  font-size: 13px;
  width: 16px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ctx-sep {
  height: 1px;
  background: var(--bd);
  margin: 4px 8px;
}
</style>
