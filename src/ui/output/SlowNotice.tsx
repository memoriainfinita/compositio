// Under «Procesar»: the files that would take several times their length, with the engine each
// would use. It informs and never blocks: a batch should not stop at every video.

import { useEffect, useState } from 'preact/hooks';
import { batchSettings, prepare, processable, slowFiles, type Slowness } from '../../app/output.ts';
import { useApp } from '../../app/state.ts';
import { engineLabel } from '../../engine/index.ts';
import { formatNumber, lang, t } from '../../i18n/index.ts';

const WAIT = 400;

const engineName = (backend: Slowness['backend']): string => engineLabel(backend);

export function SlowNotice() {
  const { project, files, engine } = useApp();
  const [slow, setSlow] = useState<{ key: string; list: Slowness[] } | null>(null);
  void files.selected.value;
  void files.sources.value;
  void files.infos.value;
  void files.active.value;
  const current = project.value;
  const { ids } = processable(current, files);
  // Only video outputs are ever slow: nothing is asked for sound files.
  const wanted = ids.filter((id) => batchSettings(current)(current.files.find((f) => f.id === id)!).extract.kind === 'video');
  const key = wanted.length ? JSON.stringify([wanted, current.batch, wanted.map((id) => current.files.find((f) => f.id === id)!.edits)]) : '';

  useEffect(() => {
    if (!engine || !key) return;
    let live = true;
    const timer = setTimeout(() => {
      const project = current;
      const { items } = prepare(project, files, wanted, batchSettings(project));
      void slowFiles(engine, files, project, items).then((list) => live && setSlow({ key, list }));
    }, WAIT);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);

  if (!key || slow?.key !== key || slow.list.length === 0) return null;
  const names = slow.list.map((s) => t('process.slowEntry', { name: s.name, engine: engineName(s.backend), ratio: formatNumber(s.ratio, lang.value, 1) })).join(', ');
  return (
    <p class="slow-notice" role="status" data-testid="slow-notice">
      {t('process.slow', { n: slow.list.length, names })}
    </p>
  );
}
