import { create } from 'zustand'

export type DialogRequest =
  | { kind: 'confirm'; message: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; message: string; initial: string; resolve: (value: string | null) => void }

interface DialogState {
  current: DialogRequest | null
  open: (req: DialogRequest) => void
  close: () => void
}

export const useDialogStore = create<DialogState>((set) => ({
  current: null,
  open: (current) => set({ current }),
  close: () => set({ current: null })
}))

/** 应用内确认框（替代 window.confirm，保持视觉语言一致）；danger 标红主按钮 */
export function confirmDialog(message: string, opts?: { danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({ kind: 'confirm', message, danger: opts?.danger, resolve })
  })
}

/** 应用内输入框（替代 window.prompt）；取消或空输入返回 null */
export function promptDialog(message: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({ kind: 'prompt', message, initial, resolve })
  })
}
