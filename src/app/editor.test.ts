import { describe, expect, it } from 'vitest';
import type { Peaks } from '../engine/peaks.ts';
import type { MediaInfo } from '../model/media.ts';
import { addFiles, emptyProject } from '../model/project.ts';
import { createStore } from '../model/store.ts';
import { wantAllPeaks, wantPeaks, type EditorEngine } from './editor.ts';
import { createFiles } from './files.ts';

const audio: MediaInfo = {
  container: 'wav',
  duration: 10,
  tracks: [{ kind: 'audio', index: 0, codec: 'pcm_s16le', channels: 2, sampleRate: 48000, bitDepth: 16 }],
  tags: {},
  hasCover: false,
};

/** Records each waveform asked for and each raise; jobs never finish. */
function fakeEngine() {
  const asked: { name: string; priority: string | undefined }[] = [];
  const raised: [string, string][] = [];
  const engine = {
    peaks: (file: File, _info: MediaInfo, _track: number, _onPart: (p: Peaks) => void, priority?: string) => {
      asked.push({ name: file.name, priority });
      return { id: `job-${file.name}`, result: new Promise<Peaks>(() => {}) };
    },
    queue: { raise: (id: string, priority: string) => raised.push([id, priority]) },
  } as unknown as EditorEngine;
  return { engine, asked, raised };
}

function session(...names: string[]) {
  const store = createStore(emptyProject());
  store.run((p) => addFiles(p, names.map((name) => ({ id: name, name, size: 4, duration: 10 }))));
  const files = createFiles(store);
  // Only the first has its File: the others are missing until dropped again.
  files.sources.value = new Map([[names[0]!, new File([new Uint8Array(4)], names[0]!)]]);
  files.infos.value = new Map(names.map((n) => [n, audio]));
  return { store, files };
}

describe('waveforms', () => {
  it('asks every file present in the background, once, and none missing', () => {
    const { store, files } = session('a.wav', 'b.wav');
    const { engine, asked } = fakeEngine();
    wantAllPeaks(files, engine, store.get());
    wantAllPeaks(files, engine, store.get());
    expect(asked).toEqual([{ name: 'a.wav', priority: 'background' }]);

    files.sources.value = new Map([...files.sources.value, ['b.wav', new File([new Uint8Array(4)], 'b.wav')]]);
    wantAllPeaks(files, engine, store.get());
    expect(asked.map((a) => a.name)).toEqual(['a.wav', 'b.wav']);
  });

  it('moves a waveform waiting in the background ahead when the editor opens its file', () => {
    const { store, files } = session('a.wav');
    const { engine, asked, raised } = fakeEngine();
    wantAllPeaks(files, engine, store.get());
    wantPeaks(files, engine, 'a.wav', 0);
    expect(asked).toHaveLength(1);
    expect(raised).toEqual([['job-a.wav', 'view']]);
  });
});
