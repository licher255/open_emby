import type { OpenEmbyApi } from './index'

declare global {
  interface Window {
    openEmby: OpenEmbyApi
  }
}

export {}
