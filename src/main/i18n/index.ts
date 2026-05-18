import zhCN from './zh-CN.json'
import en from './en.json'

const messages: Record<string, Record<string, string>> = { 'zh-CN': zhCN, en }
let currentLocale = 'zh-CN'

export function setMainLocale(locale: string): void {
  currentLocale = locale
}

export function getMainLocale(): string {
  return currentLocale
}

export function resolveMainLocale(preference: string): string {
  if (preference !== 'system') return preference
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron')
  const locale: string = app.getLocale()
  if (locale.startsWith('zh')) return 'zh-CN'
  return 'en'
}

export function t(key: string, params?: Record<string, string>): string {
  let text = messages[currentLocale]?.[key] ?? messages['en']?.[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v)
    }
  }
  return text
}
