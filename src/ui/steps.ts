import type { Key } from '../i18n/index.ts';
import type { Step } from '../model/settings.ts';

export const STEP_LABEL: Record<Step, Key> = {
  extract: 'output.extract',
  trim: 'output.trim',
  normalize: 'output.normalize',
  convert: 'output.convert',
  output: 'output.output',
};
