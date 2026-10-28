// «Procesar» and the quick actions: plan, name, queue, and say what happened.

import { batchSettings, prepare, processable, run } from '../../app/output.ts';
import { showExports, type AppState } from '../../app/state.ts';
import { t } from '../../i18n/index.ts';
import type { Preset } from '../../model/formats.ts';
import { effectiveSettings, type OutputSettings } from '../../model/settings.ts';
import { announce } from '../layout.ts';

function start(app: AppState, ids: readonly string[], settingsFor: Parameters<typeof prepare>[3]): void {
  const { engine, files } = app;
  const project = app.store.get();
  if (!engine || ids.length === 0) return;
  const { items, refused } = prepare(project, files, ids, settingsFor);
  const said = [items.length && t('process.queued', { n: items.length }), refused.length && t('process.refused', { n: refused.length, names: refused.map((r) => r.name).join(', ') })];
  announce(said.filter(Boolean).join('. '));
  void run(engine, files, project, items).then((ids) => showExports(app, ids));
}

/** The checked files, or the one in the editor, with the shared settings and their own values. */
export const processSelection = (app: AppState): void => start(app, processable(app.store.get(), app.files).ids, batchSettings(app.store.get()));

/**
 * A preset in place of the batch on the given files; each file keeps its own values on top, as it
 * would with the batch. The batch is untouched.
 */
export function quickAction(app: AppState, preset: Preset, ids: readonly string[]): void {
  const settings: OutputSettings = preset.settings;
  start(app, ids, (f) => effectiveSettings(settings, f.edits.own));
}
