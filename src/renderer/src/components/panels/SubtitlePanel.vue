<template>
  <SlidePanel
    :visible="visible"
    :title="$t('panel.subtitle.title')"
    icon="subtitles"
    :context="context"
    @close="$emit('close')"
  >
    <!-- Tabs -->
    <div class="panel-tabs">
      <button
        :class="['panel-tab', { active: activeTab === 'tracks' }]"
        @click="activeTab = 'tracks'"
      >{{ $t('panel.subtitle.tabTracks') }}</button>
      <button
        :class="['panel-tab', { active: activeTab === 'style' }]"
        @click="activeTab = 'style'"
      >{{ $t('panel.subtitle.tabStyle') }}</button>
      <button
        :class="['panel-tab', { active: activeTab === 'ai' }]"
        @click="activeTab = 'ai'"
      >{{ $t('panel.subtitle.tabAI') }}</button>
    </div>

    <!-- Tab 1: Subtitle tracks -->
    <SubtitleTracksTab
      v-if="activeTab === 'tracks'"
      :subtitle-tracks="subtitleTracks"
      :primary-sub-id="primarySubId"
      :secondary-sub-id="secondarySubId"
      :sub-delay="subDelay"
      :sub-encoding="subEncoding"
      @set-primary-sub="setPrimarySub"
      @set-secondary-sub="setSecondarySub"
      @adjust-delay="adjustDelay"
      @apply-encoding="applyEncoding"
      @sub-file-selected="onSubFileSelected"
    />

    <!-- Tab 2: Style -->
    <SubtitleStyleTab
      v-if="activeTab === 'style'"
      :is-bitmap-sub="isBitmapSub"
      :sub-scale="subScale"
      :sub-font="subFont"
      :sub-color="subColor"
      :sub-border-color="subBorderColor"
      :sub-pos="subPos"
      @set-sub-scale="setSubScale"
      @set-sub-pos="setSubPos"
      @set-sub-color="setSubColor"
      @set-sub-border-color="setSubBorderColor"
      @apply-font="applyFont"
    />

    <!-- Tab 3: AI subtitles -->
    <SubtitleAiTab
      v-if="activeTab === 'ai'"
      :visible="activeTab === 'ai' && visible"
      :media-path="null"
      @subtitle-loaded="onSubtitleLoaded"
    />
  </SlidePanel>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SlidePanel from '../base/SlidePanel.vue'
import SubtitleTracksTab from './SubtitleTracksTab.vue'
import SubtitleStyleTab from './SubtitleStyleTab.vue'
import SubtitleAiTab from './SubtitleAiTab.vue'

const { t } = useI18n()

interface Props {
  visible: boolean
  context?: 'player' | 'library'
}

const props = withDefaults(defineProps<Props>(), {
  context: 'player'
})

defineEmits<{
  close: []
}>()

const activeTab = ref<'tracks' | 'style' | 'ai'>('tracks')

// Track state
const subtitleTracks = ref<any[]>([])
const primarySubId = ref<string>('none')
const secondarySubId = ref<string>('none')
const subDelay = ref(0)
const subEncoding = ref('auto')

// Style state
const subScale = ref(1.0)
const subFont = ref('')
const subColor = ref('#ffffff')
const subBorderColor = ref('#000000')
const subPos = ref(100)

const prop = window.electronAPI?.playerProperty

// Bitmap subtitle detection (SUP/PGS/VOBSUB/DVB image formats don't support style modification)
const BITMAP_CODECS = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub']
const currentSubCodec = computed(() => {
  if (primarySubId.value === 'none') return ''
  const track = subtitleTracks.value.find((t: any) => String(t.id) === primarySubId.value)
  return track?.codec?.toLowerCase() || ''
})
const isBitmapSub = computed(() => BITMAP_CODECS.includes(currentSubCodec.value))

const loadTracks = async () => {
  if (!window.electronAPI?.player) return
  try {
    const tracks = await window.electronAPI.player.getTracks()
    subtitleTracks.value = (tracks || []).filter((t: any) => t.type === 'sub')
  } catch { /* ignore */ }
}

const setPrimarySub = async (val: string) => {
  primarySubId.value = val
  if (!window.electronAPI?.player) return
  await window.electronAPI.player.setSubtitleTrack(val === 'none' ? null : Number(val))
}

const setSecondarySub = async (val: string) => {
  secondarySubId.value = val
  if (!prop) return
  await prop.set('secondary-sid', val === 'none' ? 'no' : Number(val))
}

const adjustDelay = async (delta: number) => {
  subDelay.value = Math.round((subDelay.value + delta) * 10) / 10
  if (prop) await prop.set('sub-delay', subDelay.value)
}

const applyEncoding = async (val: string) => {
  subEncoding.value = val
  if (prop) await prop.set('sub-codepage', val === 'auto' ? 'auto' : val)
}

const onSubFileSelected = async (filePath: string) => {
  if (prop) {
    await prop.command('sub-add', filePath)
    // Reload track list
    await loadTracks()
    await syncSelection()
  }
}

// HTML #RRGGBB → ASS &H00BBGGRR (alpha=00 opaque, BGR order)
function hexToAss(hex: string): string {
  const r = hex.slice(1, 3).toUpperCase()
  const g = hex.slice(3, 5).toUpperCase()
  const b = hex.slice(5, 7).toUpperCase()
  return `&H00${b}${g}${r}`
}

// Build ASS style overrides string
function buildStyleOverrides(): string {
  const parts: string[] = []
  parts.push(`PrimaryColour=${hexToAss(subColor.value)}`)
  parts.push(`OutlineColour=${hexToAss(subBorderColor.value)}`)
  if (subFont.value) {
    parts.push(`Fontname=${subFont.value}`)
  }
  return parts.join(',')
}

// Apply style
const applyStyleToMpv = async () => {
  if (!prop) return

  // Step 1: force mode must come first! Subsequent UPDATE_SUB_HARD triggers need total_override=true
  await prop.set('sub-ass-override', 'force')

  // Step 2: Write style properties (triggers UPDATE_OSD only, no rebuild)
  await prop.set('sub-color', subColor.value)
  await prop.set('sub-border-color', subBorderColor.value)
  if (subFont.value) await prop.set('sub-font', subFont.value)

  // Step 3: Use change-list command to set OPT_STRINGLIST, triggers UPDATE_SUB_HARD
  // prop.set may silently fail for STRINGLIST type, change-list is the mpv recommended approach
  const overrides = buildStyleOverrides()
  await prop.command('change-list', 'sub-ass-style-overrides', 'set', overrides)
}

const setSubScale = async (val: number) => {
  subScale.value = val
  if (prop) await prop.set('sub-scale', val)
}

const applyFont = async (val: string) => {
  subFont.value = val
  await applyStyleToMpv()
}

const setSubColor = async (val: string) => {
  subColor.value = val
  await applyStyleToMpv()
}

const setSubBorderColor = async (val: string) => {
  subBorderColor.value = val
  await applyStyleToMpv()
}

const setSubPos = async (val: number) => {
  subPos.value = val
  if (prop) await prop.set('sub-pos', val)
}

// Sync currently selected subtitle tracks
async function syncSelection() {
  if (!prop) return
  try {
    const [sid, ssid] = await Promise.all([
      prop.get('sid'),
      prop.get('secondary-sid')
    ])
    primarySubId.value = sid === false || sid === 'no' ? 'none' : String(sid)
    secondarySubId.value = ssid === false || ssid === 'no' ? 'none' : String(ssid)
  } catch { /* ignore */ }
}

// Sync all state when panel opens
async function syncFromMpv() {
  await loadTracks()
  if (!prop) return
  try {
    const [delay, scale, pos, color, borderColor, font, codepage, sid, ssid] = await Promise.all([
      prop.get('sub-delay'),
      prop.get('sub-scale'),
      prop.get('sub-pos'),
      prop.get('sub-color'),
      prop.get('sub-border-color'),
      prop.get('sub-font'),
      prop.get('sub-codepage'),
      prop.get('sid'),
      prop.get('secondary-sid')
    ])
    subDelay.value = Number(delay) || 0
    subScale.value = Number(scale) || 1.0
    subPos.value = Number(pos) ?? 100
    if (color) subColor.value = mpvColorToHex(String(color))
    if (borderColor) subBorderColor.value = mpvColorToHex(String(borderColor))
    if (font) subFont.value = String(font)
    if (codepage) subEncoding.value = String(codepage)
    primarySubId.value = sid === false || sid === 'no' ? 'none' : String(sid)
    secondarySubId.value = ssid === false || ssid === 'no' ? 'none' : String(ssid)
  } catch { /* ignore */ }
}

// mpv color readback format #AARRGGBB or R/G/B/A → HTML #RRGGBB
function mpvColorToHex(c: string): string {
  if (c.startsWith('#') && c.length === 9) {
    // #AARRGGBB → #RRGGBB
    return '#' + c.slice(3)
  }
  if (c.startsWith('#')) return c.slice(0, 7)
  const parts = c.split('/')
  if (parts.length >= 3) {
    const r = Math.round(Number(parts[0]) * 255)
    const g = Math.round(Number(parts[1]) * 255)
    const b = Math.round(Number(parts[2]) * 255)
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    }
  }
  return c
}

// AI subtitle loaded, refresh tracks
const onSubtitleLoaded = async () => {
  await loadTracks()
  await syncSelection()
}

watch(() => props.visible, (v) => {
  if (v) {
    syncFromMpv()
  }
})
</script>

<style scoped>
.panel-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}

.panel-tab {
  flex: 1;
  padding: 5px;
  text-align: center;
  border-radius: var(--r1);
  font-size: 11px;
  font-weight: 500;
  color: var(--p-t2);
  background: var(--p-bg-s);
  border: none;
  cursor: pointer;
  transition: all var(--dur-fast);
}

.panel-tab.active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--p-t1);
  font-weight: 600;
}
</style>
