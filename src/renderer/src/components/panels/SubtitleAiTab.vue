<template>
  <div class="panel-content">
    <!-- Binary unavailable -->
    <div v-if="!aiAvailable" class="ai-unavailable">
      <Icon name="subtitles" :size="28" />
      <span class="empty-title">{{ $t('panel.subtitle.aiUnavailable') }}</span>
      <span class="empty-hint">{{ $t('panel.subtitle.aiUnavailableHint') }}</span>
    </div>

    <template v-else>
      <!-- Model selection -->
      <div class="pr">
        <span class="pr-l">{{ $t('panel.subtitle.aiModel') }}</span>
        <div class="ai-model-row">
          <select class="sel-box" v-model="aiSelectedModel">
            <option v-for="m in aiModels" :key="m.size" :value="m.size">
              {{ m.label }}{{ m.downloaded ? '' : ' *' }}
            </option>
          </select>
          <button
            v-if="currentModelInfo && !currentModelInfo.downloaded && !aiModelDownloading"
            class="btn-sm btn-acc"
            @click="downloadSelectedModel"
          >{{ $t('panel.subtitle.aiModelDownload') }}</button>
          <button
            v-if="currentModelInfo && currentModelInfo.downloaded"
            class="btn-sm btn-danger"
            @click="deleteSelectedModel"
          >{{ $t('panel.subtitle.aiModelDelete') }}</button>
        </div>
      </div>

      <!-- Model download progress -->
      <div v-if="aiModelDownloading" class="ai-progress-area">
        <div class="ai-progress-text">{{ $t('panel.subtitle.aiModelDownloading', { percent: Math.round(aiModelDownloadProgress * 100) }) }}</div>
        <div class="ai-progress-bar">
          <div class="ai-progress-fill" :style="{ width: (aiModelDownloadProgress * 100) + '%' }"></div>
        </div>
      </div>

      <!-- Language selection -->
      <div class="pr">
        <span class="pr-l">{{ $t('panel.subtitle.aiLanguage') }}</span>
        <select class="sel-box" v-model="aiLanguage">
          <option value="auto">{{ $t('panel.subtitle.aiLanguageAuto') }}</option>
          <option value="zh">{{ $t('panel.subtitle.aiLanguageZh') }}</option>
          <option value="en">{{ $t('panel.subtitle.aiLanguageEn') }}</option>
          <option value="ja">{{ $t('panel.subtitle.aiLanguageJa') }}</option>
          <option value="ko">{{ $t('panel.subtitle.aiLanguageKo') }}</option>
          <option value="fr">{{ $t('panel.subtitle.aiLanguageFr') }}</option>
          <option value="de">{{ $t('panel.subtitle.aiLanguageDe') }}</option>
          <option value="es">{{ $t('panel.subtitle.aiLanguageEs') }}</option>
          <option value="pt">{{ $t('panel.subtitle.aiLanguagePt') }}</option>
          <option value="ru">{{ $t('panel.subtitle.aiLanguageRu') }}</option>
        </select>
      </div>

      <!-- Audio track selection -->
      <div v-if="aiAudioTracks.length > 1" class="pr">
        <span class="pr-l">{{ $t('panel.subtitle.aiAudioTrack') }}</span>
        <select class="sel-box" v-model="aiSelectedAudioTrack">
          <option v-for="(track, idx) in aiAudioTracks" :key="track.id" :value="idx">
            {{ formatAudioTrackLabel(track) }}
          </option>
        </select>
      </div>

      <!-- SRT already exists hint -->
      <div v-if="aiSrtExists && aiPhase !== 'transcribing' && aiPhase !== 'extracting'" class="ai-srt-exists">
        <span class="ai-check">&#10003;</span>
        <span>{{ $t('panel.subtitle.aiSrtExists') }}</span>
      </div>

      <!-- Generate/Cancel buttons -->
      <div class="pr ai-action-row">
        <button
          v-if="aiPhase !== 'extracting' && aiPhase !== 'transcribing'"
          class="btn-sm btn-primary"
          :disabled="!canGenerate"
          @click="startGeneration"
        >{{ aiSrtExists ? $t('panel.subtitle.aiRegenerate') : $t('panel.subtitle.aiGenerate') }}</button>
        <button
          v-else
          class="btn-sm btn-danger"
          @click="cancelGeneration"
        >{{ $t('panel.subtitle.aiCancel') }}</button>
      </div>

      <!-- Transcription progress -->
      <div v-if="aiPhase === 'extracting' || aiPhase === 'transcribing'" class="ai-progress-area">
        <div class="ai-progress-text">
          {{ aiPhase === 'extracting'
            ? $t('panel.subtitle.aiExtracting', { percent: Math.round(aiProgress * 100) })
            : $t('panel.subtitle.aiTranscribing', { percent: Math.round(aiProgress * 100) })
          }}
        </div>
        <div class="ai-progress-bar">
          <div class="ai-progress-fill" :style="{ width: (aiProgress * 100) + '%' }"></div>
        </div>
        <div v-if="aiPhase === 'transcribing' && aiLastText" class="ai-live-text">{{ aiLastText }}</div>
      </div>

      <!-- Complete hint -->
      <div v-if="aiPhase === 'complete'" class="ai-complete">
        <span class="ai-check">&#10003;</span>
        <span>{{ $t('panel.subtitle.aiComplete') }}</span>
      </div>

      <!-- Error hint -->
      <div v-if="aiPhase === 'error'" class="ai-error">
        {{ $t('panel.subtitle.aiError', { error: aiErrorMsg }) }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../base/Icon.vue'

const { t } = useI18n()

interface Props {
  visible: boolean
  mediaPath: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'subtitle-loaded': []
}>()

const transcription = window.electronAPI?.transcription
const prop = window.electronAPI?.playerProperty

const aiAvailable = ref(true)
const aiModels = ref<any[]>([])
const aiSelectedModel = ref('base')
const aiLanguage = ref('auto')
const aiAudioTracks = ref<any[]>([])
const aiSelectedAudioTrack = ref(0)
const aiPhase = ref<string>('') // '' | 'extracting' | 'transcribing' | 'complete' | 'error'
const aiProgress = ref(0)
const aiErrorMsg = ref('')
const aiSrtExists = ref(false)
const aiModelDownloading = ref(false)
const aiModelDownloadProgress = ref(0)
const aiLastText = ref('')
const currentMediaPath = ref<string | null>(null)

const currentModelInfo = computed(() =>
  aiModels.value.find((m: any) => m.size === aiSelectedModel.value) || null
)

const canGenerate = computed(() => {
  if (!currentMediaPath.value) return false
  if (!currentModelInfo.value?.downloaded) return false
  return true
})

// Map audio track lang tags (ISO 639) to whisper language codes
const LANG_MAP: Record<string, string> = {
  chi: 'zh', zho: 'zh', zh: 'zh', cmn: 'zh',
  eng: 'en', en: 'en',
  jpn: 'ja', ja: 'ja',
  kor: 'ko', ko: 'ko',
  fra: 'fr', fre: 'fr', fr: 'fr',
  deu: 'de', ger: 'de', de: 'de',
  spa: 'es', es: 'es',
  por: 'pt', pt: 'pt',
  rus: 'ru', ru: 'ru',
}

function inferWhisperLang(langTag: string): string | null {
  if (!langTag) return null
  const key = langTag.toLowerCase().split('-')[0].split('_')[0]
  return LANG_MAP[key] || null
}

// When user switches audio track, auto-update language
watch(aiSelectedAudioTrack, (idx) => {
  const track = aiAudioTracks.value[idx]
  if (track?.lang) {
    const detected = inferWhisperLang(track.lang)
    if (detected) aiLanguage.value = detected
  }
})

const formatAudioTrackLabel = (track: any): string => {
  const parts: string[] = []
  if (track.title) parts.push(track.title)
  if (track.lang) parts.push(track.lang)
  if (track.codec) parts.push(track.codec.toUpperCase())
  return parts.join(' · ') || t('player.controls.audioTrackLabel', { id: track.id })
}

const initAiTab = async () => {
  if (!transcription) {
    aiAvailable.value = false
    return
  }

  // Get current media path from player
  try {
    const path = await prop?.get('path')
    currentMediaPath.value = path || null
  } catch {
    currentMediaPath.value = null
  }

  // Check availability
  try {
    const result = await transcription.checkAvailability()
    aiAvailable.value = result.available
  } catch {
    aiAvailable.value = false
    return
  }

  // Load models
  try {
    aiModels.value = await transcription.listModels()
  } catch { /* ignore */ }

  // Load audio tracks for track selection
  try {
    const tracks = await window.electronAPI?.player.getTracks()
    aiAudioTracks.value = (tracks || []).filter((t: any) => t.type === 'audio')
    // Default to currently active audio track, and infer language from it
    if (aiAudioTracks.value.length > 0) {
      const aid = await prop?.get('aid')
      const activeIdx = aiAudioTracks.value.findIndex((t: any) => t.id === Number(aid))
      aiSelectedAudioTrack.value = activeIdx >= 0 ? activeIdx : 0

      // Auto-set transcription language from audio track's lang tag
      const activeTrack = aiAudioTracks.value[aiSelectedAudioTrack.value]
      if (activeTrack?.lang) {
        const detected = inferWhisperLang(activeTrack.lang)
        if (detected) aiLanguage.value = detected
      }
    }
  } catch { /* ignore */ }

  // Check existing SRT
  if (currentMediaPath.value) {
    try {
      const srt = await transcription.checkSrt(currentMediaPath.value)
      aiSrtExists.value = !!srt
    } catch { /* ignore */ }

    // Check active transcription status
    try {
      const status = await transcription.getStatus(currentMediaPath.value)
      if (status) {
        aiPhase.value = status.phase
        aiProgress.value = status.progress
      }
    } catch { /* ignore */ }
  }
}

const startGeneration = async () => {
  if (!transcription || !currentMediaPath.value) return

  aiPhase.value = 'extracting'
  aiProgress.value = 0
  aiErrorMsg.value = ''
  aiLastText.value = ''

  try {
    const result = await transcription.start(currentMediaPath.value, {
      model: aiSelectedModel.value,
      language: aiLanguage.value,
      audioTrackIndex: aiAudioTracks.value.length > 1 ? aiSelectedAudioTrack.value : undefined,
      force: aiSrtExists.value,
    })

    // If it returns already complete (cached SRT)
    if (result.phase === 'complete' && result.srtPath) {
      aiPhase.value = 'complete'
      aiProgress.value = 1
      aiSrtExists.value = true
      // Load the SRT into mpv
      if (prop) await prop.command('sub-add', result.srtPath)
      emit('subtitle-loaded')
    }
  } catch (err: any) {
    aiPhase.value = 'error'
    aiErrorMsg.value = err.message || 'Unknown error'
  }
}

const cancelGeneration = async () => {
  if (!transcription || !currentMediaPath.value) return
  await transcription.cancel(currentMediaPath.value)
  aiPhase.value = ''
  aiProgress.value = 0
}

const downloadSelectedModel = async () => {
  if (!transcription) return
  aiModelDownloading.value = true
  aiModelDownloadProgress.value = 0
  try {
    await transcription.downloadModel(aiSelectedModel.value)
    // Refresh model list
    aiModels.value = await transcription.listModels()
  } catch (err: any) {
    aiErrorMsg.value = err.message || 'Download failed'
  } finally {
    aiModelDownloading.value = false
    aiModelDownloadProgress.value = 0
  }
}

const deleteSelectedModel = async () => {
  if (!transcription) return
  try {
    await transcription.deleteModel(aiSelectedModel.value)
    aiModels.value = await transcription.listModels()
  } catch { /* ignore */ }
}

// Subscribe to transcription events
let unsubProgress: (() => void) | null = null
let unsubComplete: (() => void) | null = null
let unsubError: (() => void) | null = null
let unsubModelProgress: (() => void) | null = null

const setupTranscriptionListeners = () => {
  if (!transcription) return

  unsubProgress = transcription.onProgress((data: any) => {
    if (data.mediaPath === currentMediaPath.value) {
      aiPhase.value = data.phase
      aiProgress.value = data.progress
      if (data.message) aiLastText.value = data.message
    }
  })

  unsubComplete = transcription.onComplete(async (data: any) => {
    if (data.mediaPath === currentMediaPath.value) {
      aiPhase.value = 'complete'
      aiProgress.value = 1
      aiSrtExists.value = true
      // Auto-load the generated SRT into mpv
      if (prop && data.srtPath) {
        await prop.command('sub-add', data.srtPath)
        emit('subtitle-loaded')
      }
    }
  })

  unsubError = transcription.onError((data: any) => {
    if (data.mediaPath === currentMediaPath.value) {
      aiPhase.value = 'error'
      aiErrorMsg.value = data.error || 'Unknown error'
    }
  })

  unsubModelProgress = transcription.onModelDownloadProgress((data: any) => {
    if (data.model === aiSelectedModel.value) {
      aiModelDownloadProgress.value = data.progress
    }
  })
}

const cleanupTranscriptionListeners = () => {
  unsubProgress?.()
  unsubComplete?.()
  unsubError?.()
  unsubModelProgress?.()
  unsubProgress = null
  unsubComplete = null
  unsubError = null
  unsubModelProgress = null
}

watch(() => props.visible, (v) => {
  if (v) {
    initAiTab()
    setupTranscriptionListeners()
  } else {
    cleanupTranscriptionListeners()
  }
}, { immediate: true })
</script>

<style scoped>
.panel-content {
  display: flex;
  flex-direction: column;
}

.pr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid var(--p-bd);
}

.pr:last-child {
  border-bottom: none;
}

.pr-l {
  font-size: 12px;
  color: var(--p-t2);
}

.sel-box {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: var(--r1);
  padding: 4px 8px;
  font-size: 11px;
  color: var(--p-t1);
  cursor: pointer;
  max-width: 140px;
  appearance: none;
  -webkit-appearance: none;
}

.btn-sm {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: var(--r1);
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: var(--p-t2);
  cursor: pointer;
  transition: all var(--dur-fast);
}

.btn-sm:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--p-t1);
}

.ai-unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 0;
  color: var(--p-t2);
  opacity: 0.6;
}

.empty-title {
  font-size: 12px;
  font-weight: 500;
}

.empty-hint {
  font-size: 10px;
  opacity: 0.7;
}

.ai-model-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-action-row {
  justify-content: center;
  padding: 12px 0;
}

.btn-primary {
  background: var(--acc);
  color: #fff;
  font-weight: 500;
  padding: 6px 20px;
}

.btn-primary:hover {
  filter: brightness(1.1);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  filter: none;
}

.btn-acc {
  color: var(--p-acc);
}

.btn-danger {
  color: #ff453a;
}

.btn-danger:hover {
  background: rgba(255, 69, 58, 0.1);
}

.ai-progress-area {
  padding: 8px 0;
}

.ai-progress-text {
  font-size: 11px;
  color: var(--p-t2);
  margin-bottom: 6px;
}

.ai-progress-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.ai-progress-fill {
  height: 100%;
  background: var(--p-acc);
  border-radius: 2px;
  transition: width var(--dur-slow) ease;
}

.ai-live-text {
  font-size: 11px;
  color: var(--p-t2);
  margin-top: 6px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: var(--r1);
  line-height: 1.5;
  max-height: 60px;
  overflow-y: auto;
  word-break: break-all;
}

.ai-srt-exists {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  font-size: 11px;
  color: #30d158;
  background: rgba(48, 209, 88, 0.08);
  border-radius: var(--r1);
  margin: 4px 0;
}

.ai-complete {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  font-size: 11px;
  color: #30d158;
  background: rgba(48, 209, 88, 0.08);
  border-radius: var(--r1);
  margin: 4px 0;
}

.ai-check {
  font-size: 14px;
  font-weight: 600;
}

.ai-error {
  font-size: 11px;
  color: #ff453a;
  padding: 8px;
  background: rgba(255, 69, 58, 0.08);
  border-radius: var(--r1);
  margin: 4px 0;
}
</style>
