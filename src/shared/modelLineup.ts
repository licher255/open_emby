/** 刺绣模型谱系命名 —— emby-<代数>-<代号>（天体系列）。
 *  规则：
 *  - 代数（gen）：模型架构代际。1 = 首代风格化体系（Luna），2 = Terra 代
 *  - 小版本：同代内的改进版。emby-1.1-sol = Luna 代的第二个模型
 *  - 代号（codename）：天体系列，小写进 id，展示时首字母大写
 *  - kind：模型在制版链路中的角色
 *
 *  已规划谱系：emby-1-luna → emby-1.1-sol → emby-2-terra → …
 */
export interface ModelLineupEntry {
  id: string // 'emby-1-luna'
  gen: number // 1
  codename: string // 'Luna'
  kind: 'stylize' | 'inpaint' | 'agent' | 'segment'
  status: 'planned' | 'training' | 'available'
  notes: string
}

export const MODEL_LINEUP: ModelLineupEntry[] = [
  {
    id: 'emby-1-luna',
    gen: 1,
    codename: 'Luna',
    kind: 'stylize',
    status: 'planned',
    notes: '首代刺绣风格化模型：图稿 → 制版友好的平涂色块（当前由原生 KMeans 节点占位，candle 扩散落地后替换）'
  },
  {
    id: 'emby-1.1-sol',
    gen: 1.1,
    codename: 'Sol',
    kind: 'stylize',
    status: 'planned',
    notes: 'Luna 代改进版（规划中）'
  },
  {
    id: 'emby-2-terra',
    gen: 2,
    codename: 'Terra',
    kind: 'inpaint',
    status: 'planned',
    notes: '第二代架构（规划中），覆盖局部重绘/修复'
  }
]
