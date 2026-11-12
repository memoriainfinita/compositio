// The app's own settings, apart from the project: «Motor de vídeo» is the only one with a control so
// far (in «Acerca de»). The language is read at startup from the same document.

import { effect, signal } from '@preact/signals';
import type { VideoEngine } from '../engine/index.ts';
import type { AppSettings } from '../model/formats.ts';

/** Which engine makes video; the engine reads it at every job. */
export const videoEngine = signal<VideoEngine>('auto');

/**
 * Loads the stored settings into the signals and saves the document again when one changes. A document
 * this version could not read is never passed here, so it is never overwritten.
 */
export function bindAppSettings(stored: AppSettings | null, save: (settings: AppSettings) => void): void {
  const base: AppSettings = stored ?? { language: 'auto', defaultPresetId: null, videoEngine: 'auto' };
  videoEngine.value = base.videoEngine;
  let first = true;
  effect(() => {
    const value = videoEngine.value;
    if (first) {
      first = false;
      return;
    }
    save({ ...base, videoEngine: value });
  });
}
