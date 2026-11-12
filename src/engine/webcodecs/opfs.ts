// The output files of the WebCodecs engine live in OPFS, outside the page's memory. The queue keeps
// a File that reads from disk; removing the job removes the file.

import { OUTPUT_DIR } from './protocol.ts';

const dir = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    return await (await navigator.storage.getDirectory()).getDirectoryHandle(OUTPUT_DIR, { create: true });
  } catch {
    return null;
  }
};

export const opfsAvailable = (): boolean => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;

export async function readOutput(name: string): Promise<File> {
  const d = await dir();
  if (!d) throw new Error('OPFS unavailable');
  return (await d.getFileHandle(name)).getFile();
}

/**
 * A terminated worker may still hold its file for a moment (Chrome refuses the removal until it lets
 * go), so removing tries again briefly; what stays is swept at the next start.
 */
export async function removeOutput(name: string): Promise<void> {
  const d = await dir();
  if (!d) return;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await d.removeEntry(name);
      return;
    } catch (e) {
      if ((e as DOMException).name === 'NotFoundError') return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** At startup: files of sessions that ended without «Limpiar» are no one's any more. */
export async function sweepOutputs(): Promise<void> {
  const d = await dir();
  if (!d) return;
  const names: string[] = [];
  for await (const name of (d as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
  for (const name of names) await d.removeEntry(name).catch(() => {});
}

let counter = 0;
export const newOutputName = (): string => `${Date.now().toString(36)}-${(counter++).toString(36)}.mp4`;
