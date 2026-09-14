import type { EnvStatus, ModelInfo, PluginManifest } from '@shared/types'

/** window.openEmby 由 preload 注入；此处做类型化包装 */
export const bridge = () => window.openEmby

export type { EnvStatus, ModelInfo, PluginManifest }
