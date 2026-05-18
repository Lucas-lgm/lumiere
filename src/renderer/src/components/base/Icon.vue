<template>
  <component
    :is="iconComponent"
    :size="size"
    :stroke-width="strokeWidth"
    :class="['icon', { disabled }]"
    :style="color ? { color } : undefined"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  Volume1,
  Maximize,
  Minimize,
  Settings,
  Repeat,
  Repeat1,
  Shuffle,
  Folder,
  FolderOpen,
  HardDrive,
  Globe,
  RadioTower,
  Star,
  Clock,
  ListVideo,
  RefreshCw,
  Link,
  Lightbulb,
  Loader,
  FileText,
  Check,
  CheckCircle,
  Circle,
  X,
  AlertTriangle,
  Home,
  ArrowUp,
  Clapperboard,
  Film,
  Search,
  Inbox,
  ArrowRight,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Rewind,
  FastForward,
  Subtitles,
  AudioLines,
  SlidersHorizontal,
  Scissors,
  Wrench,
  Info,
  Copy,
  FolderSearch,
  MonitorPlay,
  Ellipsis,
  RotateCcw,
  RotateCw,
  FlipHorizontal2,
  GripVertical,
  Clipboard,
  Trash2,
  Download,
  ExternalLink,
  type LucideIcon
} from 'lucide-vue-next'

interface Props {
  name: string
  size?: number
  strokeWidth?: number
  color?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 16,
  strokeWidth: 2,
  color: undefined,
  disabled: false
})

const iconMap: Record<string, LucideIcon> = {
  // Playback
  'play': Play,
  'pause': Pause,
  'skip-back': SkipBack,
  'skip-forward': SkipForward,
  'stop': Square,
  'rewind': Rewind,
  'fast-forward': FastForward,

  // Volume
  'volume': Volume2,
  'volume-2': Volume2,
  'volume-1': Volume1,
  'volume-x': VolumeX,

  // Window
  'maximize': Maximize,
  'minimize': Minimize,

  // Player modes
  'repeat': Repeat,
  'repeat-1': Repeat1,
  'shuffle': Shuffle,

  // Files & Folders
  'folder': Folder,
  'folder-open': FolderOpen,
  'hard-drive': HardDrive,
  'file': FileText,

  // Navigation
  'home': Home,
  'arrow-up': ArrowUp,
  'arrow-right': ArrowRight,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'search': Search,

  // Network
  'globe': Globe,
  'radio-tower': RadioTower,
  'link': Link,

  // Media
  'clapperboard': Clapperboard,
  'film': Film,
  'monitor-play': MonitorPlay,
  'subtitles': Subtitles,
  'audio-lines': AudioLines,

  // Actions
  'settings': Settings,
  'refresh': RefreshCw,
  'plus': Plus,
  'check': Check,
  'check-circle': CheckCircle,
  'circle': Circle,
  'x': X,
  'copy': Copy,
  'info': Info,
  'ellipsis': Ellipsis,

  // Panels
  'sliders-horizontal': SlidersHorizontal,
  'scissors': Scissors,
  'wrench': Wrench,
  'list-video': ListVideo,

  // Status
  'alert-triangle': AlertTriangle,
  'lightbulb': Lightbulb,
  'loader': Loader,
  'star': Star,
  'clock': Clock,
  'inbox': Inbox,
  'folder-search': FolderSearch,

  // Panel-specific
  'minus': Minus,
  'chevron-down': ChevronDown,
  'rotate-ccw': RotateCcw,
  'rotate-cw': RotateCw,
  'flip-horizontal': FlipHorizontal2,
  'grip-vertical': GripVertical,
  'clipboard': Clipboard,
  'trash': Trash2,
  'download': Download,
  'external-link': ExternalLink,
}

const iconComponent = computed(() => {
  return iconMap[props.name] || null
})
</script>

<style scoped>
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  vertical-align: middle;
  color: currentColor;
  transition: opacity var(--dur-fast, .15s) ease;
}

.icon.disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
