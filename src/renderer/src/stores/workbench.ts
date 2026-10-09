import { create } from 'zustand'

export type StepId = 'import' | 'stylize' | 'plan' | 'stitches' | 'export'

export interface StepInfo {
  id: StepId
  done: boolean
  artifact: string
}

/** 工作台共享状态：Editor 发布步骤树，App 侧边栏渲染并驱动切换 */
interface WorkbenchState {
  expertMode: boolean
  setExpertMode: (value: boolean) => void
  steps: StepInfo[]
  activeStep: StepId
  historyCount: number
  historyOpen: boolean
  setSteps: (steps: StepInfo[]) => void
  setActiveStep: (id: StepId) => void
  setHistoryCount: (n: number) => void
  setHistoryOpen: (open: boolean) => void
}

export const useWorkbench = create<WorkbenchState>((set) => ({
  expertMode: false,
  setExpertMode: (expertMode) => set({ expertMode }),
  steps: [],
  activeStep: 'import',
  historyCount: 0,
  historyOpen: false,
  setSteps: (steps) => set({ steps }),
  setActiveStep: (activeStep) => set({ activeStep }),
  setHistoryCount: (historyCount) => set({ historyCount }),
  setHistoryOpen: (historyOpen) => set({ historyOpen })
}))
