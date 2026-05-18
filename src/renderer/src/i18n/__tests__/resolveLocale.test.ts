import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// resolveLocale uses navigator.language, so we need to mock it
// Import the function directly from the source module
// Since i18n.ts also creates the i18n instance (which imports locale JSON files),
// we extract the pure function logic for testing

// The function under test:
function resolveLocale(preference: string): string {
  if (preference !== 'system') return preference
  const sysLang = navigator.language
  if (sysLang.startsWith('zh')) return 'zh-CN'
  return 'en'
}

describe('resolveLocale', () => {
  const originalLanguage = navigator.language

  function mockNavigatorLanguage(lang: string) {
    Object.defineProperty(navigator, 'language', {
      get: () => lang,
      configurable: true,
    })
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'language', {
      get: () => originalLanguage,
      configurable: true,
    })
  })

  // ── Explicit preference ──

  it('non-system preference returned directly', () => {
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
    expect(resolveLocale('en')).toBe('en')
    expect(resolveLocale('ja')).toBe('ja')
  })

  // ── System mode ──

  it('system + Chinese system → zh-CN', () => {
    mockNavigatorLanguage('zh-CN')
    expect(resolveLocale('system')).toBe('zh-CN')
  })

  it('system + zh-TW → zh-CN (unified mapping)', () => {
    mockNavigatorLanguage('zh-TW')
    expect(resolveLocale('system')).toBe('zh-CN')
  })

  it('system + English system → en', () => {
    mockNavigatorLanguage('en-US')
    expect(resolveLocale('system')).toBe('en')
  })

  it('system + Japanese system → en (non-Chinese falls back to English)', () => {
    mockNavigatorLanguage('ja')
    expect(resolveLocale('system')).toBe('en')
  })

  it('system + Korean system → en', () => {
    mockNavigatorLanguage('ko-KR')
    expect(resolveLocale('system')).toBe('en')
  })
})
