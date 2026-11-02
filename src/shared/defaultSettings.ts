import type { AppSettings } from './types'

export const defaultSettings: AppSettings = {
  contribution: {
    enabled: false,
    scope: 'off',
    contributorId: '' // 首次开启授权时生成随机 UUID
  },
  dataRoot: 'E:\\Project-刺绣机',
  engineUrl: 'http://127.0.0.1:8189', // emby-engine（Rust：节点图 + AI 网关 + 模型管理）
  draftBackend: 'model',
  sidecarUrl: 'http://127.0.0.1:8100',
  locale: 'en' // 原生英文，设置页可切换
}
