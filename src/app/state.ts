// What the interface reads: the project and its history as signals, the session's files, the
// engine and its loading, a pending update.

import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Engine } from '../engine/index.ts';
import type { Project } from '../model/project.ts';
import type { Store } from '../model/store.ts';
import { createFiles, type Files } from './files.ts';
import { createMontageLibrary, type MontageLibrary } from './montages.ts';
import { createPresetStore, type PresetStore } from './presets.ts';

/** Bytes of the core downloaded so far; null before loading starts or when it is not tracked. */
export type EngineLoad = { state: 'loading'; loaded: number; total: number } | { state: 'ready' } | { state: 'failed' } | null;

export interface AppState {
  store: Store;
  project: ReadonlySignal<Project>;
  canUndo: ReadonlySignal<boolean>;
  canRedo: ReadonlySignal<boolean>;
  files: Files;
  presets: PresetStore;
  montages: MontageLibrary;
  engine: Engine | null;
  engineLoad: Signal<EngineLoad>;
  /** Set when a new version waits; calling it applies the version. */
  update: Signal<(() => void) | null>;
}

const nowhere = { put: async () => {}, remove: async () => {} };

export function createAppState(
  store: Store,
  engine: Engine | null = null,
  presets: PresetStore = createPresetStore([], () => {}),
  montages: MontageLibrary = createMontageLibrary([], nowhere),
): AppState {
  const project = signal(store.get());
  const canUndo = signal(store.canUndo());
  const canRedo = signal(store.canRedo());
  // Created first: its subscription prunes the selection before the interface re-renders.
  const files = createFiles(store);
  store.subscribe((p) => {
    project.value = p;
    canUndo.value = store.canUndo();
    canRedo.value = store.canRedo();
  });
  return { store, project, canUndo, canRedo, files, presets, montages, engine, engineLoad: signal(null), update: signal(null) };
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp outside AppContext');
  return app;
}
