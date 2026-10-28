// The ways files come in: the system picker and a drop anywhere on the window, folders included.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { addIncoming } from '../app/files.ts';
import { PICKER_ACCEPT, walkEntries, type EntryLike, type Incoming } from '../app/intake.ts';
import type { AppState } from '../app/state.ts';
import { t } from '../i18n/index.ts';
import { announce } from './layout.ts';

/** True while files are dragged over the window: the drop overlay shows. */
export const dragging = signal(false);

/** Drops a target took for itself (a quick action): the window only ends the drag. */
export const takenDrops = new WeakSet<Event>();

export async function takeIn(app: AppState, batch: readonly Incoming[]): Promise<string[]> {
  if (!app.engine || batch.length === 0) return [];
  const r = await addIncoming(app.store, app.files, app.engine, batch);
  const said = [
    r.added && t('files.added', { n: r.added }),
    r.paired && t('files.paired', { n: r.paired }),
    r.duplicates && t('files.duplicates', { n: r.duplicates }),
  ].filter(Boolean);
  if (said.length) announce(said.join('. '));
  return r.ids;
}

/** The system's file picker, several at a time. The only way in on phones. `then` gets the ids added. */
export function chooseFiles(app: AppState, then?: (ids: string[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = PICKER_ACCEPT;
  input.hidden = true;
  const done = () => input.remove();
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    done();
    void takeIn(app, files.map((file) => ({ file, path: file.name }))).then((ids) => ids.length && then?.(ids));
  });
  input.addEventListener('cancel', done);
  // Some browsers only open a picker that is in the document.
  document.body.append(input);
  input.click();
}

const hasFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes('Files');

/**
 * Entries must be taken during the drop event itself: the list empties when it returns. Without
 * `webkitGetAsEntry`, the plain files (no folders).
 */
export function dropped(data: DataTransfer): Promise<Incoming[]> {
  const entries = [...data.items].flatMap((item) => {
    const entry = item.kind === 'file' ? item.webkitGetAsEntry?.() : null;
    return entry ? [entry as unknown as EntryLike] : [];
  });
  if (entries.length) return walkEntries(entries);
  return Promise.resolve([...data.files].map((file) => ({ file, path: file.name })));
}

/** Files dropped anywhere on the window are added. */
export function useDropAnywhere(app: AppState): void {
  useEffect(() => {
    // dragenter and dragleave fire for every child crossed; the count says when it really left.
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      dragging.value = true;
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) dragging.value = false;
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      dragging.value = false;
      if (takenDrops.has(e)) return;
      void dropped(e.dataTransfer).then((batch) => takeIn(app, batch));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [app]);
}
