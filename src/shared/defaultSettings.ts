import type { AppSettings } from './types'

export const defaultSettings: AppSettings = {
  contribution: {
    enabled: false,
    scope: 'off',
    contributorId: '' // 首次开启授权时生成随机 UUID
  },
  dataRoot: 'E:\\Project-刺绣机',
  comfyuiUrl: 'http://127.0.0.1:8188',
  comfyuiExe: 'D:\\comfyui\\ComfyUI.exe',
  sidecarUrl: 'http://127.0.0.1:8100'
}
