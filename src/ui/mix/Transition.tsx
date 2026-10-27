// `PopTransicion`: the transition into one clip, edited as a draft and saved on «Aplicar» in one undo
// step. «Escuchar» renders about 20 s around the cross with the draft.

import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { preview } from '../../app/mix.ts';
import { useApp } from '../../app/state.ts';
import { formatNumber, t, type Key } from '../../i18n/index.ts';
import { setTransition } from '../../model/project.ts';
import { CURVES, type Curve } from '../../model/settings.ts';
import { transitionOf, type Layout, type Transition } from '../../model/timeline.ts';
import { Dialog } from '../Dialog.tsx';
import { NumberField } from '../output/Inspector.tsx';

export const MAX_TRANSITION = 30;

export const seconds = (s: number): string => `${formatNumber(s, undefined, s % 1 ? 1 : 0)} s`;

interface Props {
  /** Index in the mix of the clip the transition goes into; null when closed. */
  index: number | null;
  layout: Layout;
  onClose(): void;
}

export function TransitionDialog({ index, layout, onClose }: Props) {
  const app = useApp();
  const { project, store, engine, files } = app;
  const p = project.value;
  const clip = index === null ? undefined : p.clips[index];
  const prev = index === null ? undefined : p.clips[index - 1];
  const draft = useSignal<Transition | null>(null);
  /** «Aplicar» saves null: the clip follows the mix default from then on. */
  const useDefault = useSignal(false);
  const listening = useSignal<{ id: string | null; url: string | null }>({ id: null, url: null });
  const audio = useRef<HTMLAudioElement>(null);

  const stop = () => {
    const l = listening.peek();
    if (l.id) engine?.queue.cancel(l.id);
    if (l.url) URL.revokeObjectURL(l.url);
    listening.value = { id: null, url: null };
  };

  // Every opening starts from what is saved.
  useEffect(() => {
    draft.value = clip ? { ...transitionOf(clip, p.mix) } : null;
    useDefault.value = clip?.transitionIn === null;
    return stop;
  }, [clip?.id]);

  if (!clip || !prev || !draft.value) return <Dialog open={false} onClose={onClose} title={t('transition.title')}>{null}</Dialog>;
  const d = draft.value;
  const nameOf = (fileId: string) => p.files.find((f) => f.id === fileId)?.name ?? '';
  const set = (patch: Partial<Transition>) => {
    draft.value = { ...d, ...patch };
    useDefault.value = false;
  };
  const issue = layout.issues.find((i) => i.code === 'overlap-too-long' && i.clipId === clip.id);

  const listen = () => {
    if (!engine || index === null) return;
    stop();
    const job = preview(engine, store.get(), files, index, d);
    if (!job) return;
    listening.value = { id: job.id, url: null };
    job.result.then(
      (r) => {
        if (listening.peek().id !== job.id) return;
        listening.value = { id: null, url: URL.createObjectURL(r.blob) };
      },
      () => {
        if (listening.peek().id === job.id) listening.value = { id: null, url: null };
      },
    );
  };

  const apply = () => {
    store.run((q) => setTransition(q, clip.id, useDefault.value ? null : d));
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={t('transition.title')}>
      <div class="transition">
        <p class="transition-names">
          <span>{nameOf(prev.fileId)}</span>
          <span class="muted">{nameOf(clip.fileId)}</span>
        </p>
        <div class="setting">
          <label for="transition-range">{t('transition.duration')}</label>
          <div class="setting-control row">
            <input
              id="transition-range"
              class="grow range"
              type="range"
              min={0}
              max={MAX_TRANSITION}
              step={0.5}
              value={d.duration}
              disabled={d.cut}
              aria-valuetext={seconds(d.duration)}
              onInput={(e) => set({ duration: Number(e.currentTarget.value) })}
            />
            <NumberField id="transition-seconds" label={t('transition.seconds')} value={d.duration} min={0} max={MAX_TRANSITION} step={0.1} unit="s" onChange={(n) => set({ duration: n })} />
          </div>
        </div>
        <div class="setting">
          <label for="transition-curve">{t('editor.curve')}</label>
          <div class="setting-control">
            <select id="transition-curve" class="input" value={d.curve} disabled={d.cut} onChange={(e) => set({ curve: e.currentTarget.value as Curve })}>
              {CURVES.map((c) => (
                <option key={c} value={c}>
                  {t(`curve.${c}` as Key)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label class="row check-row">
          <input type="checkbox" class="check" checked={d.cut} onChange={(e) => set({ cut: e.currentTarget.checked })} />
          {t('transition.cut')}
        </label>
        {issue && issue.code === 'overlap-too-long' && <p class="step-warning">{t('mix.shortened', { s: seconds(issue.max) })}</p>}
        <button
          type="button"
          class="button small-button"
          disabled={useDefault.value}
          onClick={() => {
            draft.value = { ...p.mix.transition };
            useDefault.value = true;
          }}
        >
          {t('transition.default')}
        </button>
        {listening.value.url && <audio ref={audio} class="transition-audio" controls autoPlay src={listening.value.url} aria-label={t('transition.preview')} />}
        <div class="dialog-actions">
          <button type="button" class="button" disabled={!engine || listening.value.id !== null} onClick={listen}>
            {listening.value.id !== null ? t('transition.preparing') : t('transition.listen')}
          </button>
          <button type="button" class="button primary" onClick={apply}>
            {t('transition.apply')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
