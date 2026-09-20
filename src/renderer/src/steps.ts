import type { LocaleKey } from './i18n/en'
import type { IconName } from './components/Icon'
import type { StepId } from './stores/workbench'

export const STEP_ORDER: StepId[] = ['import', 'stylize', 'plan', 'stitches', 'export']

export const STEP_KEY: Record<StepId, LocaleKey> = {
  import: 'step.import',
  stylize: 'step.stylize',
  plan: 'step.plan',
  stitches: 'step.stitches',
  export: 'step.export'
}

export const STEP_ICON: Record<StepId, IconName> = {
  import: 'image',
  stylize: 'palette',
  plan: 'clipboard-list',
  stitches: 'route',
  export: 'file-export'
}
