// What happens to files on their way into the project, before ffprobe sees them: which ones look
// like media, which are too big, already there, or the missing files of a restored session. Pure.

import { pairFiles, type Candidate } from '../model/project.ts';
import type { FileRef } from '../model/formats.ts';

/** WebAssembly is 32-bit here: ffmpeg.wasm cannot read past 2 GB (spec, «Límites»). */
export const MAX_FILE_BYTES = 2 * 1024 ** 3;

export const MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  // Audio
  'wav', 'wave', 'bwf', 'aif', 'aiff', 'aifc', 'caf', 'flac', 'alac', 'mp3', 'mp2', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus',
  'wma', 'ac3', 'eac3', 'dts', 'mka', 'wv', 'ape', 'amr', 'au',
  // Video
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', 'flv', 'ogv', 'mxf',
]);

/** What the file picker offers: by type, and by extension for systems that do not know the type. */
export const PICKER_ACCEPT = ['audio/*', 'video/*', ...[...MEDIA_EXTENSIONS].map((e) => `.${e}`)].join(',');

export const extension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** A first guess; ffprobe has the last word. */
export const looksLikeMedia = (file: { name: string; type: string }): boolean =>
  /^(audio|video)\//.test(file.type) || MEDIA_EXTENSIONS.has(extension(file.name));

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** «Pista 2» before «Pista 10». */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** A file as it arrives, with the path it had inside a dropped folder. */
export interface Incoming {
  file: File;
  /** `Show/Act 1/01.wav` for a file in a dropped folder; the name alone otherwise. */
  path: string;
}

/** Same name, size and date: the same file dropped twice. */
export const sameFile = (a: File, b: File): boolean => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

export interface Sorted {
  /** New files, in natural order of their paths. */
  accepted: Incoming[];
  /** Missing files of the project that these files stand for: file id → file. */
  paired: Map<string, File>;
  tooBig: File[];
  notMedia: File[];
  duplicates: File[];
}

/**
 * Sorts one batch. `present` are the project's files that have their File, `missing` those that
 * lack it (a restored session).
 */
export function sortIncoming(
  batch: readonly Incoming[],
  present: readonly File[],
  missing: readonly FileRef[],
  maxBytes = MAX_FILE_BYTES,
): Sorted {
  const out: Sorted = { accepted: [], paired: new Map(), tooBig: [], notMedia: [], duplicates: [] };
  const media: Incoming[] = [];
  for (const item of batch) {
    if (!looksLikeMedia(item.file)) out.notMedia.push(item.file);
    else if (item.file.size > maxBytes) out.tooBig.push(item.file);
    else media.push(item);
  }

  const pairs = pairFiles(missing, media.map((m): Candidate => ({ name: m.file.name, size: m.file.size })));
  const used = new Set(pairs.values());
  for (const [id, index] of pairs) out.paired.set(id, media[index]!.file);

  // Within one drop the path tells apart equal files in different subfolders (`Acto 1/01.wav`).
  for (const [index, item] of media.entries()) {
    if (used.has(index)) continue;
    const again = present.some((f) => sameFile(f, item.file)) || out.accepted.some((a) => a.path === item.path && sameFile(a.file, item.file));
    if (again) out.duplicates.push(item.file);
    else out.accepted.push(item);
  }
  out.accepted.sort((a, b) => naturalCompare(a.path, b.path));
  return out;
}

// The parts of the File and Directory Entries API that a drop uses, so tests can fake them.
export interface FileEntryLike {
  isFile: true;
  isDirectory: false;
  fullPath: string;
  file(ok: (f: File) => void, fail: (e: unknown) => void): void;
}
export interface DirectoryEntryLike {
  isFile: false;
  isDirectory: true;
  fullPath: string;
  createReader(): { readEntries(ok: (entries: EntryLike[]) => void, fail: (e: unknown) => void): void };
}
export type EntryLike = FileEntryLike | DirectoryEntryLike;

const relative = (fullPath: string): string => fullPath.replace(/^\/+/, '');

/** Every file under the dropped entries, subfolders included. Unreadable entries are skipped. */
export async function walkEntries(entries: readonly EntryLike[]): Promise<Incoming[]> {
  const out: Incoming[] = [];
  const visit = async (entry: EntryLike): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => entry.file(resolve, () => resolve(null)));
      if (file) out.push({ file, path: relative(entry.fullPath) || file.name });
      return;
    }
    const reader = entry.createReader();
    // readEntries hands out a directory in chunks (100 in Chrome) until it returns none.
    for (;;) {
      const chunk = await new Promise<EntryLike[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (chunk.length === 0) break;
      for (const child of chunk) await visit(child);
    }
  };
  for (const entry of entries) await visit(entry);
  return out;
}
