import type { Key } from '../i18n/index.ts';
import { stepsFor, type OutputSettings, type Step } from '../model/settings.ts';

export const STEP_LABEL: Record<Step, Key> = {
  extract: 'output.extract',
  trim: 'output.trim',
  picture: 'output.picture',
  normalize: 'output.normalize',
  convert: 'output.convert',
  output: 'output.output',
};

/** The steps «Salida» shows: the picture's only when the output is a video. */
export const inspectorSteps = (settings: OutputSettings): readonly Step[] => stepsFor(settings.extract.kind === 'video');
