// What the engine would do with the active file's video and how long it would take, asked in the
// background as the settings change; null for sound files, and while the answer is on its way.

import { useEffect, useState } from 'preact/hooks';
import type { Assessment } from '../../engine/jobs.ts';
import { jobInput } from '../../app/output.ts';
import { useApp } from '../../app/state.ts';
import type { FileRef } from '../../model/formats.ts';
import type { OutputSettings } from '../../model/settings.ts';

const WAIT = 300;

export function useAssessment(file: FileRef | undefined, settings: OutputSettings): Assessment | null {
  const { files, project, engine } = useApp();
  const [result, setResult] = useState<{ key: string; value: Assessment | null } | null>(null);
  const source = file ? files.sources.value.get(file.id) : undefined;
  const info = file ? files.infos.value.get(file.id) : undefined;
  const wanted = settings.extract.kind === 'video' && !!file && !!source && !!info;
  const key = wanted ? JSON.stringify([file!.id, file!.edits.in, file!.edits.out, file!.edits.fadeIn.duration, file!.edits.fadeOut.duration, settings.extract, settings.picture, settings.convert]) : '';

  useEffect(() => {
    if (!wanted || !engine) return;
    let current = true;
    const timer = setTimeout(() => {
      const input = jobInput(files, project.peek(), { id: file!.id, info: info!, settings });
      engine.assess(source!, input).then(
        (value) => current && setResult({ key, value }),
        () => current && setResult({ key, value: null }),
      );
    }, WAIT);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key]);

  return wanted && result?.key === key ? result.value : null;
}
