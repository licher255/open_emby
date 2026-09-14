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
  comfyCheckpoint: 'sd15.safetensors', // 按本机 ComfyUI 实际底模修改
  sidecarUrl: 'http://127.0.0.1:8100'
}
