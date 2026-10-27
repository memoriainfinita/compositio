// What the interface reads: the project and its history as signals, the engine, a pending update.

import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Engine } from '../engine/index.ts';
import type { Project } from '../model/project.ts';
import type { Store } from '../model/store.ts';

export interface AppState {
  store: Store;
  project: ReadonlySignal<Project>;
  canUndo: ReadonlySignal<boolean>;
  canRedo: ReadonlySignal<boolean>;
  engine: Engine | null;
  /** Set when a new version waits; calling it applies the version. */
  update: Signal<(() => void) | null>;
}

export function createAppState(store: Store, engine: Engine | null = null): AppState {
  const project = signal(store.get());
  const canUndo = signal(store.canUndo());
  const canRedo = signal(store.canRedo());
  store.subscribe((p) => {
    project.value = p;
    canUndo.value = store.canUndo();
    canRedo.value = store.canRedo();
  });
  return { store, project, canUndo, canRedo, engine, update: signal(null) };
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp outside AppContext');
  return app;
}
