import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../model/formats.ts';
import { bindAppSettings, videoEngine } from './settings.ts';

describe('app settings', () => {
  it('loads the stored engine and saves the whole document when it changes', () => {
    const saved: AppSettings[] = [];
    const stored: AppSettings = { language: 'es', defaultPresetId: 'p', videoEngine: 'ffmpeg' };
    bindAppSettings(stored, (s) => saved.push(s));
    expect(videoEngine.value).toBe('ffmpeg');
    expect(saved).toEqual([]);
    videoEngine.value = 'webcodecs';
    expect(saved).toEqual([{ language: 'es', defaultPresetId: 'p', videoEngine: 'webcodecs' }]);
  });

  it('starts from the defaults when nothing is stored', () => {
    const saved: AppSettings[] = [];
    bindAppSettings(null, (s) => saved.push(s));
    expect(videoEngine.value).toBe('auto');
    videoEngine.value = 'ffmpeg';
    expect(saved).toEqual([{ language: 'auto', defaultPresetId: null, videoEngine: 'ffmpeg' }]);
  });
});
