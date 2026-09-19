import type { AppSettings } from './types'

export const defaultSettings: AppSettings = {
  contribution: {
    enabled: false,
    scope: 'off',
    contributorId: '' // 首次开启授权时生成随机 UUID
  },
  dataRoot: 'E:\\Project-刺绣机',
  engineUrl: 'http://127.0.0.1:8189', // emby-engine（crates/emby-engine，Rust 原生）
  sidecarUrl: 'http://127.0.0.1:8100',
  locale: 'en' // 原生英文，设置页可切换
}
