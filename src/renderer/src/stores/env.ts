import { create } from 'zustand'
import type { EnvStatus } from '@shared/types'

interface EnvState {
  status: EnvStatus | null
  refresh: () => Promise<void>
}

export const useEnvStore = create<EnvState>((set) => ({
  status: null,
  refresh: async () => {
    const status = await window.openEmby.envStatus()
    set({ status })
  }
}))
