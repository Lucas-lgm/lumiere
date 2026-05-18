import { beforeEach, describe, expect, it, vi } from 'vitest'

const appMock = {
  isPackaged: false,
  getAppPath: vi.fn(() => '/mock/app'),
  getLocale: vi.fn(() => 'en-US'),
}

const sessionMock = {
  defaultSession: {
    setProxy: vi.fn(() => Promise.resolve()),
  },
}

vi.mock('electron', () => ({
  app: appMock,
  session: sessionMock,
}))

vi.mock('../../i18n', () => ({
  setMainLocale: vi.fn(),
  resolveMainLocale: vi.fn((value: string) => value),
}))

vi.mock('../../../infrastructure/logging', () => ({
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  setGlobalLogLevel: vi.fn(),
  parseLogLevel: vi.fn((value: string) => value),
}))

describe('AppSettingsBridge enhancement presets', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  async function loadInitSettings(videoEnhancement: string) {
    const { AppSettingsBridge } = await import('../appSettingsBridge')

    const playerConfig = {
      setProperty: vi.fn(() => Promise.resolve()),
      setVolume: vi.fn(() => Promise.resolve()),
      setInitSettings: vi.fn(),
    }

    const config = {
      getAppSettings: vi.fn(() => ({
        hwdec: 'auto',
        httpProxy: '',
        cacheSize: 150,
        bufferSize: 2,
        defaultSpeed: 1,
        autoLoadSubtitle: true,
        autoLoadAudio: true,
        logLevel: 'info',
        preferredLang: 'system',
        videoEnhancement,
        language: 'system',
        windowFollowVideo: true,
        rememberProgress: true,
        chapterNav: false,
        autoThumbnail: true,
        mpvOptions: '',
        hwdecCodec: 'videotoolbox',
        whisperModel: 'base',
        whisperLanguage: 'auto',
      })),
    }

    const bridge = new AppSettingsBridge(playerConfig as any, config as any, {
      rebuildAppMenu: vi.fn(),
      broadcastToAllRenderers: vi.fn(),
      setAspectRatioLock: vi.fn(),
    })

    bridge.applyInitOptions()

    expect(playerConfig.setInitSettings).toHaveBeenCalledTimes(1)
    return playerConfig.setInitSettings.mock.calls[0][0]
  }

  it('loads the fsr preset as EASU followed by RCAS during init', async () => {
    const initSettings = await loadInitSettings('fsr')

    expect(initSettings.extraOptions).toContain(
      'glsl-shaders=/mock/app/resources/shaders/fsr/FSR_EASU.glsl:/mock/app/resources/shaders/fsr/FSR_RCAS.glsl'
    )
  })

  it('loads the live preset as RAVU-Lite-AR during init', async () => {
    const initSettings = await loadInitSettings('live')

    expect(initSettings.extraOptions).toContain(
      'glsl-shaders=/mock/app/resources/shaders/ravu/ravu-lite-ar-r3.hook'
    )
  })
})
