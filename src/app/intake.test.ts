import { describe, expect, it } from 'vitest';
import type { FileRef } from '../model/formats.ts';
import { defaultEdits } from '../model/edits.ts';
import { looksLikeMedia, MAX_FILE_BYTES, naturalCompare, sortIncoming, walkEntries, type EntryLike, type Incoming } from './intake.ts';

const file = (name: string, type = '', lastModified = 1) => new File([new Uint8Array(0)], name, { type, lastModified });

/** A File whose size can be anything without allocating it. */
const sized = (name: string, size: number, lastModified = 1): File => {
  const f = file(name, '', lastModified);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

const incoming = (f: File, path = f.name): Incoming => ({ file: f, path });
const ref = (id: string, name: string, size: number): FileRef => ({ id, name, size, duration: 10, edits: defaultEdits() });

describe('intake', () => {
  it('takes audio and video by type or by a known extension', () => {
    expect(looksLikeMedia(file('a.bin', 'audio/x-weird'))).toBe(true);
    expect(looksLikeMedia(file('clip', 'video/mp4'))).toBe(true);
    expect(looksLikeMedia(file('Tormenta.FLAC'))).toBe(true);
    // Some systems call .ts TypeScript.
    expect(looksLikeMedia(file('show.ts', 'text/vnd.trolltech.linguist'))).toBe(true);
    expect(looksLikeMedia(file('notes.txt', 'text/plain'))).toBe(false);
    expect(looksLikeMedia(file('cover.jpg', 'image/jpeg'))).toBe(false);
    expect(looksLikeMedia(file('.wav'))).toBe(false);
  });

  it('orders names the way people count', () => {
    const names = ['Pista 10.wav', 'pista 2.wav', 'Pista 1.wav', 'Acto 2/01.wav', 'Acto 1/02.wav', 'Acto 10/01.wav'];
    expect([...names].sort(naturalCompare)).toEqual(['Acto 1/02.wav', 'Acto 2/01.wav', 'Acto 10/01.wav', 'Pista 1.wav', 'pista 2.wav', 'Pista 10.wav']);
  });

  it('sorts a batch: too big, not media, duplicates, new files in natural order', () => {
    const present = sized('01.wav', 500, 7);
    const big = sized('Ensayo general.mp4', MAX_FILE_BYTES + 1);
    const edge = sized('limite.wav', MAX_FILE_BYTES);
    const batch = [
      incoming(file('10.wav')),
      incoming(sized('01.wav', 500, 7)),
      incoming(file('2.wav')),
      incoming(big),
      incoming(file('leeme.txt', 'text/plain')),
      incoming(edge),
      incoming(file('2.wav')),
    ];
    const r = sortIncoming(batch, [present], []);
    expect(r.accepted.map((a) => a.file.name)).toEqual(['2.wav', '10.wav', 'limite.wav']);
    expect(r.tooBig).toEqual([big]);
    expect(r.notMedia.map((f) => f.name)).toEqual(['leeme.txt']);
    // One already in the project, one twice in the same drop.
    expect(r.duplicates.map((f) => f.name)).toEqual(['01.wav', '2.wav']);
  });

  it('tells apart equal files in different subfolders of one drop', () => {
    const r = sortIncoming([incoming(sized('01.wav', 5), 'Show/Acto 2/01.wav'), incoming(sized('01.wav', 5), 'Show/Acto 10/01.wav'), incoming(sized('01.wav', 5), 'Show/Acto 2/01.wav')], [], []);
    expect(r.accepted.map((a) => a.path)).toEqual(['Show/Acto 2/01.wav', 'Show/Acto 10/01.wav']);
    expect(r.duplicates).toHaveLength(1);
  });

  it('keeps the date in the comparison: a newer file with the same name and size is new', () => {
    const r = sortIncoming([incoming(sized('a.wav', 5, 2))], [sized('a.wav', 5, 1)], []);
    expect(r.accepted).toHaveLength(1);
    expect(r.duplicates).toHaveLength(0);
  });

  it('pairs the missing files of a restored session instead of adding them', () => {
    const missing = [ref('x', 'Obertura.wav', 1000), ref('y', 'Final.wav', 3000)];
    const obertura = sized('Obertura.wav', 1000);
    const finalNew = sized('final.WAV', 2999);
    const r = sortIncoming([incoming(obertura), incoming(finalNew), incoming(file('Extra.wav'))], [], missing);
    expect([...r.paired]).toEqual([
      ['x', obertura],
      ['y', finalNew],
    ]);
    expect(r.accepted.map((a) => a.file.name)).toEqual(['Extra.wav']);
  });

  it('walks dropped folders and their subfolders, reading each in chunks', async () => {
    const leaf = (fullPath: string): EntryLike => ({
      isFile: true,
      isDirectory: false,
      fullPath,
      file: (ok) => ok(file(fullPath.split('/').at(-1)!)),
    });
    const broken: EntryLike = { isFile: true, isDirectory: false, fullPath: '/x.wav', file: (_ok, fail) => fail(new Error('gone')) };
    const dir = (fullPath: string, chunks: EntryLike[][]): EntryLike => ({
      isFile: false,
      isDirectory: true,
      fullPath,
      createReader: () => {
        const left = [...chunks];
        return { readEntries: (ok) => ok(left.shift() ?? []) };
      },
    });
    const show = dir('/Show', [[leaf('/Show/01.wav'), dir('/Show/Acto 2', [[leaf('/Show/Acto 2/03.wav')]])], [leaf('/Show/02.wav')]]);
    const r = await walkEntries([show, leaf('/suelto.mp3'), broken]);
    expect(r.map((i) => i.path)).toEqual(['Show/01.wav', 'Show/Acto 2/03.wav', 'Show/02.wav', 'suelto.mp3']);
    expect(r.map((i) => i.file.name)).toEqual(['01.wav', '03.wav', '02.wav', 'suelto.mp3']);
  });
});
