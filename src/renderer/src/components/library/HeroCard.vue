<template>
  <div class="lib-hero" @click="$emit('play')">
    <div class="lib-hero-thumb" :style="thumbStyle">
      <Icon name="film" :size="30" class="hero-placeholder-icon" />
      <img
        v-if="thumbnailUrl"
        :src="thumbnailUrl"
        class="hero-thumb-img"
        @error="thumbnailUrl = null"
      />
      <!-- Hover play button -->
      <div class="lib-hero-play"></div>
      <!-- HDR/DV badge -->
      <span v-if="badge" :class="['vc-badge', badge === 'HDR' ? 'hdr-b' : 'dv-b']">{{ badge }}</span>
      <!-- Progress bar -->
      <div class="lib-hero-progress">
        <div class="lib-hero-progress-f" :style="{ width: progressPercent + '%' }"></div>
      </div>
    </div>
    <div class="lib-hero-body">
      <div class="lib-hero-title">{{ title }}</div>
      <div class="lib-hero-sub">{{ subtitle }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import Icon from '../base/Icon.vue'
import { useThumbnail } from '../../composables/useThumbnail'

interface Props {
  title: string
  subtitle: string
  filePath: string
  progressPercent: number
  badge?: 'HDR' | 'DV' | null
}

const props = withDefaults(defineProps<Props>(), {
  badge: null
})

defineEmits<{
  play: []
}>()

const { getThumbnail } = useThumbnail()
const thumbnailUrl = ref<string | null>(null)

const thumbStyle = computed(() => {
  if (thumbnailUrl.value) {
    return {}
  }
  // Deterministic gradient based on title
  const gradients = [
    'background:linear-gradient(135deg,#1a1230,#0d0820)',
    'background:linear-gradient(135deg,#0f1a2a,#0a1018)',
    'background:linear-gradient(135deg,#1a0a0a,#120505)',
    'background:linear-gradient(135deg,#1a1508,#100d04)',
    'background:linear-gradient(135deg,#0a1a12,#060f0a)',
    'background:linear-gradient(135deg,#181218,#0e0a0e)'
  ]
  let hash = 0
  for (let i = 0; i < props.title.length; i++) {
    hash = ((hash << 5) - hash) + props.title.charCodeAt(i)
    hash |= 0
  }
  return gradients[Math.abs(hash) % gradients.length]
})

onMounted(async () => {
  if (props.filePath && !props.filePath.startsWith('http')) {
    const url = await getThumbnail(props.filePath)
    if (url) {
      thumbnailUrl.value = url
    }
  }
})
</script>

<style scoped>
.lib-hero {
  width: 240px;
  min-width: 240px;
  background: var(--bg);
  border-radius: var(--r2);
  border: none;
  box-shadow: var(--shadow-card);
  overflow: hidden;
  cursor: pointer;
  transition: all .18s;
}

.lib-hero:hover {
  transform: translateY(-2px) scale(1.01);
  box-shadow: var(--shadow-card-hover);
}

.lib-hero-thumb {
  width: 100%;
  height: 135px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  position: relative;
  overflow: hidden;
}

.hero-placeholder-icon {
  color: rgba(255, 255, 255, .2);
  z-index: 0;
}

.hero-thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
}

/* Hover play button */
.lib-hero-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(.85);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(0, 0, 0, .4);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all .25s ease;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .3);
  z-index: 3;
  cursor: pointer;
}

.lib-hero-play::after {
  content: '';
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 7px 0 7px 12px;
  border-color: transparent transparent transparent #ffffff;
  margin-left: 2px;
}

.lib-hero:hover .lib-hero-play {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.lib-hero:hover .lib-hero-play:hover {
  background: rgba(0, 0, 0, .6);
  transform: translate(-50%, -50%) scale(1.05);
}

/* Badge */
.vc-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 3px;
  letter-spacing: .05em;
  z-index: 2;
}

.hdr-b {
  background: linear-gradient(135deg, #f97316, #ef4444);
  color: #fff;
}

.dv-b {
  background: linear-gradient(135deg, #1560e0, #0d3ab0);
  color: #fff;
}

/* Progress bar */
.lib-hero-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: rgba(0, 0, 0, .4);
  z-index: 2;
}

.lib-hero-progress-f {
  height: 100%;
  background: var(--acc);
  border-radius: 0 2px 2px 0;
}

.lib-hero-body {
  padding: 7px 9px 8px;
}

.lib-hero-title {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
  color: var(--t1);
}

.lib-hero-sub {
  font-size: 10px;
  color: var(--t3);
}

/* ===== RESPONSIVE ===== */
/* ≤500px: narrow hero card */
@media (max-width: 500px) {
  .lib-hero {
    width: 180px;
    min-width: 180px;
  }

  .lib-hero-thumb {
    height: 101px;
  }
}

/* ≤400px: further reduce at very narrow widths */
@media (max-width: 400px) {
  .lib-hero {
    width: 150px;
    min-width: 150px;
  }

  .lib-hero-thumb {
    height: 84px;
  }
}
</style>
