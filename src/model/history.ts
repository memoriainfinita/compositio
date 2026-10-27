// Undo and redo over whole snapshots. States are never mutated, so a snapshot shares every part
// that did not change and costs little.

export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
  /** Last recorded group and when: steps of one drag count as a single undo. */
  group: { key: string; at: number } | null;
}

export const HISTORY_LIMIT = 200;
/** Steps of the same group closer than this merge into one. */
export const GROUP_WINDOW_MS = 1000;

export const createHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], group: null });

export function record<T>(h: History<T>, next: T, opts: { group?: string; now?: number } = {}): History<T> {
  if (Object.is(next, h.present)) return h;
  const now = opts.now ?? Date.now();
  const group = opts.group ? { key: opts.group, at: now } : null;
  if (group && h.group?.key === group.key && now - h.group.at < GROUP_WINDOW_MS) {
    return { ...h, present: next, future: [], group };
  }
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], group };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past.at(-1);
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], group: null };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...future] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future, group: null };
}

export const canUndo = (h: History<unknown>): boolean => h.past.length > 0;
export const canRedo = (h: History<unknown>): boolean => h.future.length > 0;
