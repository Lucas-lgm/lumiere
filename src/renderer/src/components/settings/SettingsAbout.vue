<template>
  <div class="about-card">
    <div class="about-icon"><Icon name="clapperboard" :size="40" /></div>
    <div class="about-name">Lumiere</div>
    <div class="about-ver">{{ $t('settings.about.version') }}</div>
    <div class="about-desc">{{ $t('settings.about.desc') }}</div>

    <div class="about-dep">
      <span class="about-dep-label">mpv</span>
      <span class="about-dep-ver">0.41</span>
    </div>

    <div class="about-copy">© {{ year }} Lumiere</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Icon from '../base/Icon.vue'

const year = ref(2026)

onMounted(() => {
  year.value = new Date().getFullYear()
})
</script>

<style scoped>
.about-card {
  max-width: 540px;
  margin: 0 auto;
  padding: 20px;
  text-align: center;
}

.about-icon {
  font-size: 40px;
}

.about-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -.02em;
  color: var(--t1);
  margin-top: 6px;
}

.about-ver {
  font-size: 11px;
  color: var(--t3);
  margin-top: 2px;
}

.about-desc {
  font-size: 11px;
  color: var(--t2);
  line-height: 1.6;
  margin-top: 12px;
  white-space: pre-line;
}

.about-dep {
  display: inline-flex;
  gap: 6px;
  align-items: baseline;
  font-size: 11px;
  margin-top: 14px;
}

.about-dep-label {
  color: var(--t3);
}

.about-dep-ver {
  color: var(--t2);
}

.about-copy {
  font-size: 9px;
  color: var(--t3);
  opacity: .6;
  margin-top: 10px;
}
</style>
