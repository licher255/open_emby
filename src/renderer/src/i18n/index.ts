import { create } from 'zustand'
import { en, type LocaleKey } from './en'
import { zhCN } from './zh-CN'

export const LOCALES = ['en', 'zh-CN'] as const
export type Locale = (typeof LOCALES)[number]

const MESSAGES: Record<Locale, Record<LocaleKey, string>> = { en, 'zh-CN': zhCN }

interface I18nState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useI18n = create<I18nState>((set) => ({
  locale: 'en', // 原生默认语言
  setLocale: (locale) => {
    document.documentElement.lang = locale // 同步 <html lang>，屏幕阅读器与字体回滚依赖它
    set({ locale })
  }
}))

/** 翻译 + {var} 插值；缺译回退英文 */
export function t(key: LocaleKey, vars?: Record<string, string | number>): string {
  const table = MESSAGES[useI18n.getState().locale]
  let s = table[key] ?? en[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

/** React hook 形式（订阅 locale 变化触发重渲染） */
export function useT() {
  const locale = useI18n((s) => s.locale)
  return (key: LocaleKey, vars?: Record<string, string | number>): string => {
    void locale // 订阅用
    return t(key, vars)
  }
}

/** 应用启动时从设置加载语言 */
export async function initLocale(): Promise<void> {
  try {
    const s = await window.openEmby.settings.get()
    if (s.locale && (LOCALES as readonly string[]).includes(s.locale)) {
      useI18n.getState().setLocale(s.locale as Locale)
    }
  } catch { /* 默认英文 */ }
}

/** 数字/日期的本地化格式 */
export function localeTag(): string {
  return useI18n.getState().locale === 'zh-CN' ? 'zh-CN' : 'en-US'
}
