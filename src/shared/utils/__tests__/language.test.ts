import { describe, it, expect } from 'vitest'
import { deriveLanguagePreference } from '../language'

describe('deriveLanguagePreference', () => {
  // ── Explicit preference (non-system) ──

  it('zh → Chinese priority chain + English fallback', () => {
    const { alang, slang } = deriveLanguagePreference('zh', 'en-US')
    expect(alang).toBe('zh,chi,zho,zh-CN,zh-Hans,cmn,en')
    expect(slang).toBe(alang)
  })

  it('en → English variant', () => {
    const { alang } = deriveLanguagePreference('en', 'zh-CN')
    expect(alang).toBe('en,eng,en-US,en-GB')
  })

  it('ja → Japanese + English fallback', () => {
    const { alang } = deriveLanguagePreference('ja', 'en')
    expect(alang).toBe('ja,jpn,en')
  })

  it('unknown language → use original + English fallback', () => {
    const { alang } = deriveLanguagePreference('th', 'en')
    expect(alang).toBe('th,en')
  })

  // ── System mode ──

  it('system + zh-CN locale → Chinese priority chain', () => {
    const { alang } = deriveLanguagePreference('system', 'zh-CN')
    expect(alang).toBe('zh,chi,zho,zh-CN,zh-Hans,cmn,en')
  })

  it('system + zh-TW locale → Chinese priority chain (zh prefix match)', () => {
    const { alang } = deriveLanguagePreference('system', 'zh-TW')
    expect(alang).toBe('zh,chi,zho,zh-CN,zh-Hans,cmn,en')
  })

  it('system + en-US locale → English variant', () => {
    const { alang } = deriveLanguagePreference('system', 'en-US')
    expect(alang).toBe('en,eng,en-US,en-GB')
  })

  it('system + ko locale → Korean + English fallback', () => {
    const { alang } = deriveLanguagePreference('system', 'ko')
    expect(alang).toBe('ko,kor,en')
  })

  it('system + unknown locale → raw value + English fallback', () => {
    const { alang } = deriveLanguagePreference('system', 'sv-SE')
    expect(alang).toBe('sv,en')
  })

  // ── Edge cases ──

  it('default params (no arguments) → English', () => {
    const { alang } = deriveLanguagePreference()
    expect(alang).toBe('en,eng,en-US,en-GB')
  })

  it('alang and slang are always identical', () => {
    const cases = ['zh', 'en', 'ja', 'system']
    for (const lang of cases) {
      const { alang, slang } = deriveLanguagePreference(lang, 'en')
      expect(alang).toBe(slang)
    }
  })
})
