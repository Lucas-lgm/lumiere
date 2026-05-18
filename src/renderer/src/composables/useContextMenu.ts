import { ref, readonly } from 'vue'

export interface MenuItem {
  id?: string
  icon?: string
  label?: string
  danger?: boolean
  disabled?: boolean
  type?: 'separator'
}

const visible = ref(false)
const position = ref({ x: 0, y: 0 })
const items = ref<MenuItem[]>([])
let selectHandler: ((id: string) => void) | null = null

export function useContextMenu() {
  function showMenu(
    event: MouseEvent,
    menuItems: MenuItem[],
    onSelect?: (id: string) => void
  ) {
    event.preventDefault()
    items.value = menuItems
    position.value = { x: event.clientX, y: event.clientY }
    selectHandler = onSelect || null
    visible.value = true
  }

  function hideMenu() {
    visible.value = false
    selectHandler = null
  }

  function handleSelect(id: string) {
    const handler = selectHandler
    hideMenu()
    handler?.(id)
  }

  return {
    visible: readonly(visible),
    position: readonly(position),
    items: readonly(items),
    showMenu,
    hideMenu,
    handleSelect
  }
}
