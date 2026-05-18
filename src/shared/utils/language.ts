/**
 * Language mapping: primary language → mpv alang/slang preference string.
 * Includes ISO 639-1, ISO 639-2/T, common variants, and English fallback.
 */
const LANG_MAP: Record<string, string> = {
  zh: 'zh,chi,zho,zh-CN,zh-Hans,cmn,en',
  ja: 'ja,jpn,en',
  ko: 'ko,kor,en',
  en: 'en,eng,en-US,en-GB',
  fr: 'fr,fre,fra,en',
  de: 'de,ger,deu,en',
  es: 'es,spa,en',
  pt: 'pt,por,en',
  ru: 'ru,rus,en',
  it: 'it,ita,en',
}

/**
 * Derive mpv audio & subtitle language preferences from user setting and system locale.
 *
 * @param preferredLang  User's preferred language setting ('system' or ISO 639-1 code)
 * @param systemLocale   System locale string (e.g. 'zh-CN', 'en-US', 'ja')
 * @returns `{ alang, slang }` for mpv property configuration
 */
export function deriveLanguagePreference(
  preferredLang: string = 'system',
  systemLocale: string = 'en'
): { alang: string; slang: string } {
  // If user specified a non-system preference, use it directly
  if (preferredLang && preferredLang !== 'system') {
    const pref = LANG_MAP[preferredLang] || `${preferredLang},en`
    return { alang: pref, slang: pref }
  }

  // Otherwise derive from system locale
  const lang = systemLocale.split('-')[0]
  const pref = LANG_MAP[lang] || `${lang},en`
  return { alang: pref, slang: pref }
}
