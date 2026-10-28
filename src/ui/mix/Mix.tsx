// The mix («Definitivo», «Tableta», «MovilMezcla», «MovilOpcionesMezcla»): listening to it, its
// clips over the timeline with a ruler, zoom and draggable overlaps, the mix options, the times
// and «Generar».

import { useSignal, type Signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import Sortable from 'sortablejs';
import { blocker, generate, memoryRisk, saveTimes, stripLayout } from '../../app/mix.ts';
import { useApp, type AppState } from '../../app/state.ts';
import { t } from '../../i18n/index.ts';
import { addClips, moveClip, removeClip, setMix, setTransition, type Project } from '../../model/project.ts';
import { transitionOf, type Clip, type Layout, type MixSettings } from '../../model/timeline.ts';
import { fileSize, shortTime } from '../format.ts';
import { CloseIcon, ListIcon, SlidersIcon, WarnIcon } from '../icons.tsx';
import { announce } from '../layout.ts';
import { Dialog } from '../Dialog.tsx';
import { montageDialog } from '../Montages.tsx';
import { NumberField } from '../output/Inspector.tsx';
import { MixTransport, Playhead, Ruler, useMixPlayback, type Playback, type Zoom } from './Playback.tsx';
import { MAX_TRANSITION, seconds, TransitionDialog } from './Transition.tsx';

const nameOf = (p: Project, clip: Clip): string => p.files.find((f) => f.id === clip.fileId)?.name ?? '';

/** Reorders through SortableJS, then hands the DOM back to Preact and moves the clip in the model. */
function useSortable(list: { current: HTMLElement | null }, app: AppState, handle?: string) {
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const sortable = Sortable.create(el, {
      animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150,
      draggable: '.mix-item',
      // Pointer events instead of native drag and drop: the same with mouse, pen and touch.
      forceFallback: true,
      handle,
      filter: '.mix-overlap',
      preventOnFilter: false,
      onEnd(e) {
        const { oldIndex, newIndex, item, from } = e;
        if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] ?? null);
        const p = app.store.get();
        const clip = p.clips[oldIndex];
        app.store.run((q) => moveClip(q, oldIndex, newIndex));
        if (clip) announce(t('mix.moved', { name: nameOf(p, clip), n: newIndex + 1 }));
      },
    });
    return () => sortable.destroy();
  }, []);
}

/** Alt+arrows move a clip, Delete takes it out. */
function clipKeys(app: AppState, index: number) {
  return (e: KeyboardEvent) => {
    const p = app.store.get();
    const clip = p.clips[index];
    if (!clip) return;
    const name = nameOf(p, clip);
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
      const to = index + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= p.clips.length) return;
      e.preventDefault();
      app.store.run((q) => moveClip(q, index, to));
      announce(t('mix.moved', { name, n: to + 1 }));
      // The same clip keeps the focus at its new place.
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-clip="${clip.id}"]`)?.focus());
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      app.store.run((q) => removeClip(q, clip.id));
      announce(t('mix.removed', { name }));
    }
  };
}

function MixHead({ layout }: { layout: Layout }) {
  const app = useApp();
  const { project, files, store } = app;
  const n = project.value.clips.length;
  const add = () => {
    const ids = project.value.files.filter((f) => files.selected.value.has(f.id)).map((f) => f.id);
    store.run((p) => addClips(p, ids, (id) => (files.infos.value.get(id)?.tracks.some((tr) => tr.kind === 'video') ? 'video' : 'audio')));
    announce(t('mix.added', { n: ids.length }));
  };
  return (
    <div class="mix-head">
      <h2 id="mix-title" class="panel-title">
        {t('mix.title')}
      </h2>
      {n > 0 && <span class="muted small mono">{t('mix.summary', { n, duration: shortTime(layout.duration) })}</span>}
      <span class="grow" />
      <button type="button" class="button small-button" disabled={files.selected.value.size === 0} onClick={add}>
        {t('mix.addSelection')}
      </button>
    </div>
  );
}

/** Wide enough to grab and to read its seconds, even when the overlap is a few pixels. */
const overlapWidth = (overlap: number, pps: number): number => Math.max(36, overlap * pps);

/** Overlap handle: drag in 0.1 s steps, arrows 0.5 s (Shift 5 s), press or Enter for the popup. */
function Overlap({ clip, prevName, overlap, pps, onOpen }: { clip: Clip; prevName: string; overlap: number; pps: number; onOpen(): void }) {
  const app = useApp();
  const drag = useRef<{ x: number; d0: number; moved: boolean } | null>(null);
  const mix = app.project.value.mix;
  const t0 = transitionOf(clip, mix);
  const set = (duration: number, group: string) => {
    const d = Math.round(Math.min(MAX_TRANSITION, Math.max(0, duration)) * 10) / 10;
    app.store.run((p) => {
      const c = p.clips.find((x) => x.id === clip.id);
      return c ? setTransition(p, clip.id, { ...transitionOf(c, p.mix), duration: d, cut: false }) : p;
    }, group);
  };
  const label = t('mix.overlap', { name: prevName });
  return (
    <div
      role="slider"
      tabIndex={0}
      class="mix-overlap"
      aria-label={label}
      title={label}
      aria-valuemin={0}
      aria-valuemax={MAX_TRANSITION}
      aria-valuenow={t0.duration}
      aria-valuetext={seconds(overlap)}
      style={{ width: `${overlapWidth(overlap, pps)}px` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, d0: t0.duration, moved: false };
      }}
      onPointerMove={(e) => {
        const g = drag.current;
        if (!g) return;
        const dx = e.clientX - g.x;
        if (Math.abs(dx) < 3 && !g.moved) return;
        g.moved = true;
        // Dragging to the left pulls the clip over the previous one: a longer overlap.
        set(g.d0 - dx / pps, `overlap-drag-${clip.id}-${g.x}`);
      }}
      onPointerUp={() => {
        const g = drag.current;
        drag.current = null;
        if (g && !g.moved) onOpen();
      }}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 5 : 0.5;
        const keys: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step };
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        } else if (e.key in keys) {
          e.preventDefault();
          set(t0.duration + keys[e.key]!, `overlap-key-${clip.id}`);
        } else if (e.key === 'Home') {
          e.preventDefault();
          set(0, `overlap-key-${clip.id}`);
        }
      }}
    >
      <span class="mono">{seconds(overlap)}</span>
    </div>
  );
}

/** A small waveform when the file already has its peaks in the session. */
function Thumb({ fileId }: { fileId: string }) {
  const { files } = useApp();
  const peaks = files.peaks.value.get(fileId);
  if (!peaks || peaks.ready === 0) return <div class="mix-thumb" aria-hidden="true" />;
  const n = 60;
  const per = Math.max(1, Math.floor(peaks.ready / n));
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = 0;
    for (let k = i * per; k < Math.min(peaks.ready, (i + 1) * per); k++) {
      lo = Math.min(lo, peaks.min[k] ?? 0);
      hi = Math.max(hi, peaks.max[k] ?? 0);
    }
    const x = ((i / (n - 1)) * 100).toFixed(1);
    top.push(`${x} ${(20 - hi * 19).toFixed(1)}`);
    bottom.unshift(`${x} ${(20 - lo * 19).toFixed(1)}`);
  }
  return (
    <svg class="mix-thumb" aria-hidden="true" viewBox="0 0 100 40" preserveAspectRatio="none">
      <path d={`M${top.join(' L')} L${bottom.join(' L')} Z`} />
    </svg>
  );
}

/** The most the strip zooms in, in pixels per second. */
const MAX_PPS = 100;

/** Pixels per second that fit the whole mix in the panel; very long ones scroll, never under 2. */
const fitPps = (width: number, duration: number): number => Math.max(2, (width - 8) / Math.max(1, duration));

function Strip({ layout, onOpen, pb, zoom, width }: { layout: Layout; onOpen(index: number): void; pb: Playback; zoom: Zoom; width: Signal<number> }) {
  const app = useApp();
  const { project, files } = app;
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  useSortable(list, app);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => (width.value = el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const p = project.value;
  const pps = fitPps(width.value, layout.duration) * zoom.value.value;

  // A zoom keeps a time under the same pixel: the pointer's for Ctrl+wheel and pinch, else the
  // playhead when it is in sight, else the middle.
  const anchor = useRef<number | null>(null);
  const last = useRef(pps);
  useLayoutEffect(() => {
    const el = box.current;
    const old = last.current;
    last.current = pps;
    if (!el || old === pps) return;
    const now = pb.time.peek();
    const seen = now * old >= el.scrollLeft && now * old <= el.scrollLeft + el.clientWidth;
    const at = anchor.current ?? (seen ? now : (el.scrollLeft + el.clientWidth / 2) / old);
    anchor.current = null;
    el.scrollLeft = at * pps - (at * old - el.scrollLeft);
  }, [pps]);
  const zoomBy = (factor: number, at: number) => {
    anchor.current = at;
    zoom.value.value = Math.min(zoom.max, Math.max(1, zoom.value.peek() * factor));
  };

  return (
    <div
      ref={box}
      class="mix-strip"
      onWheel={(e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        zoomBy(e.deltaY < 0 ? 1.25 : 0.8, (e.clientX - r.left + e.currentTarget.scrollLeft) / pps);
      }}
    >
      <Ruler pb={pb} pps={pps} duration={layout.duration} onZoom={zoomBy} />
      <ol ref={list} class="mix-track" aria-labelledby="mix-title">
        {p.clips.map((clip, i) => {
          const placed = layout.placed[i];
          const len = placed ? placed.end - placed.start : 0;
          const overlap = placed?.overlapIn ?? 0;
          const here = files.sources.value.has(clip.fileId);
          const active = files.active.value === clip.fileId;
          const name = nameOf(p, clip);
          const cut = i > 0 && transitionOf(clip, p.mix).cut;
          const short = layout.issues.some((x) => x.code === 'overlap-too-long' && x.clipId === clip.id);
          return (
            <li
              key={clip.id}
              class={`mix-item${active ? ' active' : ''}${here ? '' : ' missing'}${cut ? ' cut' : ''}${pb.current.value === i ? ' playing' : ''}`}
              style={{ width: `${Math.max(48, len * pps)}px`, marginLeft: i === 0 ? '0' : cut ? '4px' : `${-overlap * pps}px`, zIndex: i + 1 }}
            >
              <button
                type="button"
                class="mix-clip"
                data-clip={clip.id}
                aria-current={active ? 'true' : undefined}
                title={t('mix.clip', { name })}
                onClick={() => here && (files.active.value = clip.fileId)}
                onKeyDown={clipKeys(app, i)}
              >
                <span class="mix-clip-head" style={{ paddingLeft: i > 0 && !cut ? `${overlapWidth(overlap, pps)}px` : '0' }}>
                  <span class="mono muted">{placed ? shortTime(placed.start) : ''}</span>
                  <span class="mix-clip-name">{name}</span>
                </span>
                {here ? <Thumb fileId={clip.fileId} /> : <span class="file-missing">{t('mix.missing')}</span>}
              </button>
              {i > 0 && !cut && <Overlap clip={clip} prevName={nameOf(p, p.clips[i - 1]!)} overlap={overlap} pps={pps} onOpen={() => onOpen(i)} />}
              {cut && (
                <button type="button" class="mix-cut" aria-label={t('mix.cutMark', { name })} title={t('mix.cutMark', { name })} onClick={() => onOpen(i)} />
              )}
              {short && <span class="mix-short" role="img" aria-label={t('mix.shortened', { s: seconds(overlap) })} title={t('mix.shortened', { s: seconds(overlap) })} />}
            </li>
          );
        })}
      </ol>
      <Playhead pb={pb} pps={pps} box={box} />
    </div>
  );
}

/** Phones: a vertical list with grips; between clips, the transition opens its popup. */
function MobileList({ layout, onOpen, pb }: { layout: Layout; onOpen(index: number): void; pb: Playback }) {
  const app = useApp();
  const { project, files } = app;
  const list = useRef<HTMLOListElement>(null);
  useSortable(list, app, '.mix-grip');
  const p = project.value;
  return (
    <ol ref={list} class="mix-list" aria-labelledby="mix-title">
      {p.clips.map((clip, i) => {
        const placed = layout.placed[i];
        const here = files.sources.value.has(clip.fileId);
        const name = nameOf(p, clip);
        const tr = transitionOf(clip, p.mix);
        return (
          <li key={clip.id} class={`mix-item${here ? '' : ' missing'}${pb.current.value === i ? ' playing' : ''}`}>
            {i > 0 && (
              <button type="button" class="mix-chip mono" aria-label={`${t('transition.title')}: ${tr.cut ? t('transition.cut') : seconds(placed?.overlapIn ?? 0)}`} onClick={() => onOpen(i)}>
                {tr.cut ? t('transition.cut') : seconds(placed?.overlapIn ?? 0)}
              </button>
            )}
            <div class="mix-row">
              <span class="mix-grip" role="img" aria-label={t('mix.drag', { name })} title={t('mix.drag', { name })}>
                <ListIcon />
              </span>
              <button type="button" class="mix-clip" data-clip={clip.id} title={t('mix.clip', { name })} onClick={() => here && (files.active.value = clip.fileId)} onKeyDown={clipKeys(app, i)}>
                <span class="mix-clip-name">{name}</span>
                <span class="mono muted small">{here ? (placed ? shortTime(placed.start) : '') : t('mix.missing')}</span>
              </button>
              <button
                type="button"
                class="icon-button small"
                aria-label={t('mix.removed', { name })}
                title={t('mix.removed', { name })}
                onClick={() => {
                  app.store.run((q) => removeClip(q, clip.id));
                  announce(t('mix.removed', { name }));
                }}
              >
                <CloseIcon />
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ComponentChildren }) {
  return (
    <span class="mix-field">
      <label for={id}>{label}</label>
      {children}
    </span>
  );
}

function MixOptions() {
  const { project, store } = useApp();
  const mix = project.value.mix;
  const set = (values: Partial<MixSettings>, group?: string) => store.run((p) => setMix(p, values), group);
  return (
    <div class="mix-options">
      <Field id="mix-crossfade" label={t('mix.crossfade')}>
        <NumberField id="mix-crossfade" value={mix.transition.duration} min={0} max={MAX_TRANSITION} step={0.5} unit="s" onChange={(n) => set({ transition: { ...mix.transition, duration: n } })} />
      </Field>
      <Field id="mix-fade-in" label={t('mix.fadeIn')}>
        <NumberField id="mix-fade-in" value={mix.fadeIn.duration} min={0} max={60} step={0.5} unit="s" onChange={(n) => set({ fadeIn: { ...mix.fadeIn, duration: n } })} />
      </Field>
      <Field id="mix-fade-out" label={t('mix.fadeOut')}>
        <NumberField id="mix-fade-out" value={mix.fadeOut.duration} min={0} max={60} step={0.5} unit="s" onChange={(n) => set({ fadeOut: { ...mix.fadeOut, duration: n } })} />
      </Field>
      <span class="mix-field">
        <label class="row">
          <input type="checkbox" class="check" checked={mix.matchLoudness} onChange={(e) => set({ matchLoudness: e.currentTarget.checked })} />
          {t('mix.match')}
        </label>
        <NumberField id="mix-lufs" label={t('mix.matchTarget')} value={mix.matchLufs} min={-40} max={-5} step={0.5} unit="LUFS" onChange={(n) => set({ matchLufs: n })} />
      </span>
      <span class="segmented" role="group" aria-label={t('mix.format')}>
        {(['wav', 'mp3'] as const).map((f) => (
          <button key={f} type="button" class="segment" aria-pressed={mix.format === f} onClick={() => set({ format: f })}>
            {f.toUpperCase()}
          </button>
        ))}
      </span>
      <select class="input mix-rate" aria-label={t('mix.rate')} title={t('mix.rate')} value={String(mix.sampleRate)} onChange={(e) => set({ sampleRate: Number(e.currentTarget.value) as MixSettings['sampleRate'] })}>
        <option value="48000">48 kHz</option>
        <option value="44100">44,1 kHz</option>
      </select>
    </div>
  );
}

function MemoryAlert({ layout }: { layout: Layout }) {
  const { project, store } = useApp();
  const mix = project.value.mix;
  const bytes = memoryRisk(mix, layout.duration);
  if (bytes === null) return null;
  // 320 kbps.
  const mp3 = (layout.duration * 320_000) / 8;
  return (
    <div class="alert warn" role="alert">
      <WarnIcon />
      <div class="alert-text">
        <span class="strong">{t('mix.memory')}</span>
        <span class="alert-detail">{t('mix.memoryDetail', { wav: fileSize(bytes), mp3: fileSize(mp3) })}</span>
      </div>
      <button type="button" class="button small-button" onClick={() => store.run((p) => setMix(p, { format: 'mp3' }))}>
        {t('mix.useMp3')}
      </button>
    </div>
  );
}

function MixActions({ compact }: { compact?: boolean }) {
  const app = useApp();
  const { project, files, engine } = app;
  const p = project.value;
  const why = blocker(p, files, engine);
  const go = () => {
    if (!engine || why) return;
    const { name } = generate(engine, app.store.get(), files);
    announce(t('mix.queued', { name }));
  };
  const times = () => announce(t('mix.saved', { name: saveTimes(app.store.get(), files) }));
  return (
    <div class="mix-actions">
      <button type="button" class={compact ? 'icon-button bordered' : 'button'} aria-label={t('mix.times')} title={t('mix.times')} disabled={p.clips.length === 0} onClick={times}>
        {compact ? <ListIcon /> : t('mix.times')}
      </button>
      <button type="button" class={`button primary${compact ? ' grow' : ''}`} disabled={why !== null} title={why ? t(`mix.block.${why}`) : undefined} onClick={go}>
        {t('mix.generate')}
      </button>
    </div>
  );
}

/** The mix panel; `compact` is the phone's list with the options in a sheet. */
export function MixPanel({ compact }: { compact?: boolean }) {
  const app = useApp();
  const p = app.project.value;
  // Read so the strip follows the files arriving and their silences.
  void app.files.infos.value;
  void app.files.silences.value;
  const layout = stripLayout(p, app.files);
  const open = useSignal<number | null>(null);
  const options = useSignal(false);
  const pb = useMixPlayback();
  const width = useSignal(0);
  const zoomed = useSignal(1);
  const zoom: Zoom = { value: zoomed, max: Math.max(1, MAX_PPS / fitPps(width.value, layout.duration)) };
  // Space plays the mix from anywhere in its panel but a field, as in the editor.
  const keys = (e: KeyboardEvent) => {
    if (e.key !== ' ' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea, dialog')) return;
    if (pb.missing || pb.live.duration === 0) return;
    e.preventDefault();
    pb.toggle();
  };
  return (
    <section class={`card mix${compact ? ' compact' : ''}`} aria-labelledby="mix-title" onKeyDown={keys}>
      <MixHead layout={layout} />
      {p.clips.length > 0 && <MixTransport pb={pb} total={layout.duration} zoom={compact ? undefined : zoom} compact={compact} />}
      {p.clips.length === 0 ? (
        <p class="empty">{t('mix.empty')}</p>
      ) : compact ? (
        <MobileList layout={layout} onOpen={(i) => (open.value = i)} pb={pb} />
      ) : (
        <Strip layout={layout} onOpen={(i) => (open.value = i)} pb={pb} zoom={zoom} width={width} />
      )}
      <MemoryAlert layout={layout} />
      {compact ? (
        <>
          <button type="button" class="button wide" onClick={() => (options.value = true)}>
            <SlidersIcon />
            {t('mix.options')}
          </button>
          <MixActions compact />
          <Dialog open={options.value} onClose={() => (options.value = false)} title={t('mix.options')} variant="sheet">
            <MixOptions />
            <div class="dialog-actions">
              <button
                type="button"
                class="button"
                onClick={() => {
                  options.value = false;
                  montageDialog.value = 'save';
                }}
              >
                {t('montage.save')}
              </button>
              <button type="button" class="button primary" onClick={() => (options.value = false)}>
                {t('mix.done')}
              </button>
            </div>
          </Dialog>
        </>
      ) : (
        <div class="mix-foot">
          <MixOptions />
          <span class="grow" />
          <MixActions />
        </div>
      )}
      <TransitionDialog index={open.value} layout={layout} onClose={() => (open.value = null)} />
    </section>
  );
}
