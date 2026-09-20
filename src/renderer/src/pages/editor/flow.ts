/** Stage 2 节点流：前处理后生成规整色域，线稿始终从同一张色域图提取。 */
export const FLOW_NODES = [
  { id: 'load', label: 'LoadImage' },
  { id: 'background', label: 'RemoveBG' },
  { id: 'blocks', label: 'Stylize·ColorBlocks' },
  { id: 'saveBlocks', label: 'SaveImage·色块' },
  { id: 'lineart', label: 'LineArt' },
  { id: 'saveLine', label: 'SaveImage·线稿' }
] as const

export type NodeState = 'pending' | 'running' | 'done' | 'error'
