import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../model/settings.ts';
import { inspectorSteps } from './steps.ts';

describe('inspectorSteps', () => {
  it('shows the picture only when the output is a video', () => {
    const s = defaultSettings();
    expect(inspectorSteps(s)).toEqual(['extract', 'trim', 'normalize', 'convert', 'output']);
    s.extract = { ...s.extract, kind: 'video' };
    expect(inspectorSteps(s)).toEqual(['extract', 'trim', 'picture', 'normalize', 'convert', 'output']);
  });
});
