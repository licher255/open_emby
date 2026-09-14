import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { defaultSettings } from '@shared/defaultSettings'
import type { AppSettings } from '@shared/types'

let cache: AppSettings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): AppSettings {
  if (cache) return cache
  const p = settingsPath()
  if (existsSync(p)) {
    try {
      cache = { ...defaultSettings, ...JSON.parse(readFileSync(p, 'utf-8')) }
      return cache!
    } catch { /* fall through to defaults */ }
  }
  cache = { ...defaultSettings }
  return cache
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  cache = { ...getSettings(), ...patch }
  const p = settingsPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(cache, null, 2), 'utf-8')
  return cache
}
