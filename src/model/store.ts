// Holds the project with its history and tells subscribers about every change.

import { canRedo, canUndo, createHistory, record, redo, undo, type History } from './history.ts';
import type { Project } from './project.ts';

export interface Store {
  get(): Project;
  /** Applies a pure command. `group` merges the steps of one gesture into a single undo. */
  run(command: (p: Project) => Project, group?: string): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Replaces the project and forgets the history, as when opening a montage. */
  reset(project: Project): void;
  subscribe(listener: (p: Project) => void): () => void;
}

export function createStore(initial: Project, now: () => number = Date.now): Store {
  let history: History<Project> = createHistory(initial);
  const listeners = new Set<(p: Project) => void>();

  const set = (next: History<Project>) => {
    const changed = next.present !== history.present;
    history = next;
    if (changed) for (const l of listeners) l(history.present);
  };

  return {
    get: () => history.present,
    run: (command, group) => set(record(history, command(history.present), { group, now: now() })),
    undo: () => set(undo(history)),
    redo: () => set(redo(history)),
    canUndo: () => canUndo(history),
    canRedo: () => canRedo(history),
    reset: (project) => set(createHistory(project)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
