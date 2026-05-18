<template>
  <div
    ref="progWrapRef"
    class="prog-wrap"
    @mousedown="onProgressMouseDown"
    @mouseenter="progHover = true"
    @mouseleave="progHover = false"
    @mousemove="onProgressHoverMove"
  >
    <!-- Chapter markers layer -->
    <div v-if="chapters.length > 1" class="prog-chs">
      <span
        v-for="(ch, i) in chapters"
        :key="i"
        class="ch"
        :style="{
          left: ch.startPercent + '%',
          width: ch.widthPercent + '%',
          background: ch.endPercent <= progressPercent
            ? 'var(--accent)'
            : ch.startPercent >= progressPercent
              ? 'rgba(255,255,255,.2)'
              : `linear-gradient(to right, var(--accent) ${((progressPercent - ch.startPercent) / ch.widthPercent * 100)}%, rgba(255,255,255,.2) ${((progressPercent - ch.startPercent) / ch.widthPercent * 100)}%)`
        }"
        @mouseenter="onChapterHover(ch, i)"
        @mouseleave="onChapterLeave()"
        @mousedown.stop
        @click.stop="onChapterClick(ch)"
      ></span>
      <!-- Chapter tooltip -->
      <div
        v-if="hoveredChapter"
        class="ch-tooltip"
        :style="{ left: chapterTooltipLeft + '%' }"
      >
        <div class="ch-tooltip-title">{{ hoveredChapter.title || $t('player.controls.chapterTitle', { n: hoveredChapterIndex + 1 }) }}</div>
        <div class="ch-tooltip-time">{{ formatTime(hoveredChapter.time) }} — {{ formatTime(hoveredChapterEndTime) }}</div>
      </div>
    </div>
    <!-- Track (normal progress bar when no chapters) -->
    <div class="prog-track" :class="{ hover: progHover }">
      <!-- Buffer ranges -->
      <div
        v-for="(buf, i) in bufferPercents"
        :key="i"
        class="prog-buf"
        :style="{ left: buf.left + '%', width: buf.width + '%' }"
      ></div>
      <!-- AB loop overlay -->
      <div
        v-if="abLoop.a !== null && abLoop.b !== null && duration > 0"
        class="prog-ab"
        :style="{
          left: (abLoop.a / duration * 100) + '%',
          width: ((abLoop.b - abLoop.a) / duration * 100) + '%'
        }"
      ></div>
      <!-- Blue fill -->
      <div class="prog-fill" :style="{ width: progressPercent + '%' }"></div>
      <!-- Thumb -->
      <div
        class="prog-thumb"
        :class="{ visible: progHover || isScrubbing }"
        :style="{ left: progressPercent + '%' }"
      ></div>
    </div>
    <!-- Hover preview box (always visible on hover, content switches by state) -->
    <div
      v-if="progHover && !isScrubbing && !hoveredChapter"
      class="prog-preview"
      :style="{ left: clampedPreviewLeft }"
    >
      <!-- State: thumbnail loaded -->
      <img
        v-if="hoverThumbnail"
        class="prog-preview-thumb"
        :src="hoverThumbnail.url"
        :width="160"
        :height="90"
        draggable="false"
      />
      <!-- State: loading -->
      <div v-else-if="thumbLoading" class="prog-preview-skeleton">
        <div class="prog-preview-spinner"></div>
      </div>
      <!-- State: fallback (no thumbnail, not loading) -->
      <div v-else class="prog-preview-skeleton"></div>
      <div class="prog-preview-time">{{ formatTime(progHoverTime) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { injectStrict, playerCoreKey, playerTimelineKey } from '../../composables/playerInjectKeys'
import { formatTime } from '../../composables/useProgressBar'

const { duration, isScrubbing } = injectStrict(playerCoreKey)
const {
  progHover, progHoverPercent, progHoverTime,
  bufferPercents, progressPercent, progWrapRef,
  hoverThumbnail, thumbLoading, onProgressMouseDown, onProgressHoverMove,
  chapters, hoveredChapter, hoveredChapterIndex,
  hoveredChapterEndTime, chapterTooltipLeft,
  onChapterHover, onChapterLeave, onChapterClick,
  abLoop,
} = injectStrict(playerTimelineKey)

// Clamp preview box so it stays within the progress bar bounds (half preview width = 80px)
const clampedPreviewLeft = computed(() => {
  const previewHalfWidth = 80 // 160px / 2
  const rawLeft = progHoverPercent.value
  return `clamp(${previewHalfWidth}px, calc(${rawLeft}% ), calc(100% - ${previewHalfWidth}px))`
})
</script>

<style scoped>
.prog-wrap {
  position: relative;
  padding: 10px 0 6px;
  cursor: pointer;
  /* Prevent text selection during drag */
  user-select: none;
  -webkit-user-select: none;
}

/* ── Chapter markers (above progress track, with gap) ── */
.prog-chs {
  position: relative;
  height: 3px;
  margin-bottom: 4px;
  z-index: 2;
  pointer-events: auto;
}

.ch {
  position: absolute;
  height: 100%;
  border-radius: 1.5px;
  transition: background 0.15s ease, height 0.12s ease;
  cursor: pointer;
}

.ch:hover {
  height: 5px;
  top: -1px;
  filter: brightness(1.3);
}

/* ── Chapter tooltip ── */
.ch-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.9);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 10px;
  color: #fff;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  z-index: 12;
}

.ch-tooltip-title {
  font-weight: 500;
  margin-bottom: 2px;
}

.ch-tooltip-time {
  opacity: 0.7;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

/* ── Track ── */
.prog-track {
  position: relative;
  height: 4px;
  background: rgba(255,255,255,.2);
  border-radius: 2px;
  transition: transform 0.15s ease;
  overflow: visible;
}

/* Expand on hover — use transform to avoid changing layout height, prevent cursor jitter */
.prog-track.hover {
  transform: scaleY(1.5);
}

/* 24px hit area via ::after */
.prog-track::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 24px;
  transform: translateY(-50%);
}

/* ── Buffer bar ── */
.prog-buf {
  position: absolute;
  top: 0;
  height: 100%;
  background: rgba(255,255,255,.25);
  border-radius: 2px;
  pointer-events: none;
}

/* ── AB loop region ── */
.prog-ab {
  position: absolute;
  top: 0;
  height: 100%;
  background: rgba(255,200,50,.35);
  border-radius: 2px;
  pointer-events: none;
  z-index: 1;
}

/* ── Blue fill ── */
.prog-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  pointer-events: none;
  z-index: 2;
}

/* ── Thumb ── */
.prog-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  background: #ffffff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 4px rgba(0,0,0,.4);
  z-index: 3;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.prog-thumb.visible {
  opacity: 1;
  /* Compensate for .prog-track.hover scaleY(1.5) to keep it circular */
  transform: translate(-50%, -50%) scaleY(calc(1 / 1.5));
}

/* ── Hover time tooltip ── */
.prog-tooltip {
  position: absolute;
  bottom: 100%;
  transform: translateX(-50%);
  margin-bottom: 6px;
  padding: 3px 7px;
  background: rgba(0,0,0,.85);
  color: #fff;
  font-size: 0.75rem;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}

/* ── Hover thumbnail preview (sprite sheet) ── */
.prog-preview {
  position: absolute;
  bottom: calc(100% + 12px);
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.9);
  border-radius: var(--r-s, 6px);
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  z-index: 11;
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: preview-in 100ms ease-out both;
}

@keyframes preview-in {
  from {
    opacity: 0;
    transform: translateX(-50%) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }
}

.prog-preview-skeleton {
  width: 160px;
  height: 90px;
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
}

.prog-preview-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: rgba(255, 255, 255, 0.7);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.prog-preview-thumb {
  display: block;
  flex-shrink: 0;
  width: 160px;
  height: 90px;
  object-fit: cover;
  border-radius: 0;
}

.prog-preview-time {
  font-size: 11px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.9);
  text-align: center;
  padding: 4px 8px;
  letter-spacing: 0.02em;
}
</style>
