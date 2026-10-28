// Listening to the mix: the player over the mix as it is now, its transport row, and the ruler
// and playhead over the strip. Edits heard at once; the mix is rendered only by «Generar».

import { useSignal, useSignalEffect, type Signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { editorTrack, wantListening } from '../../app/editor.ts';
import { liveGains, mixClips } from '../../app/mix.ts';
import { useApp } from '../../app/state.ts';
import { t } from '../../i18n/index.ts';
import { clockTime } from '../../model/media.ts';
import { effectiveSettings } from '../../model/settings.ts';
import { FitIcon, PauseIcon, PlayIcon, ZoomInIcon, ZoomOutIcon } from '../icons.tsx';
import { clipAt, livePlan, type Live } from './live.ts';
import { MixPlayer } from './player.ts';

export interface Playback {
  player: MixPlayer;
  live: Live;
  time: Signal<number>;
  playing: Signal<boolean>;
  /** Index in the mix of the clip heard, the later one in a crossfade; -1 when none. */
  current: Signal<number>;
  /** Some clip has no file here: the mix cannot be heard. */
  missing: boolean;
  /** Matching is on and some clip is not measured yet: it sounds without its gain meanwhile. */
  unmeasured: boolean;
  toggle(): void;
}

export function useMixPlayback(): Playback {
  const { project, files, engine, store } = useApp();
  const p = project.value;
  const heard = useSignal(false);
  const time = useSignal(0);
  const playing = useSignal(false);
  const current = useSignal(-1);
  const made = useRef(new Map<string, { file: File; url: string }>());
  const latest = useRef({ engine, live: null as Live | null });

  void files.listening.value;
  const all = mixClips(p, files);
  // Measuring waits for the first listen: editing the mix alone never queues it.
  const gains = p.mix.matchLoudness ? liveGains(heard.value ? engine : null, p, files) : null;
  const live = livePlan(all.clips, p.mix, gains);
  latest.current = { engine, live };

  const urlOf = (id: string): string | null => {
    const copy = files.listening.peek().get(id);
    if (copy) return copy;
    const file = files.sources.peek().get(id);
    if (!file) return null;
    const had = made.current.get(id);
    if (had?.file === file) return had.url;
    if (had) URL.revokeObjectURL(had.url);
    const url = URL.createObjectURL(file);
    made.current.set(id, { file, url });
    return url;
  };

  const [player] = useState(
    () =>
      new MixPlayer(
        live,
        urlOf,
        (now, g, voices) => {
          time.value = now;
          const l = latest.current.live;
          current.value = l ? clipAt(l, now) : -1;
          // For tests and for whoever inspects: the gain of each clip heard right now.
          const stage = document.querySelector('.mix-transport');
          stage?.setAttribute('data-time', now.toFixed(2));
          stage?.setAttribute('data-gains', [...g].map(([i, v]) => `${i}:${v.toFixed(3)}`).join(' '));
          stage?.setAttribute('data-voices', String(voices));
        },
        (on) => (playing.value = on),
        (fileId) => {
          const e = latest.current.engine;
          const q = store.get();
          const ref = q.files.find((f) => f.id === fileId);
          const info = files.infos.peek().get(fileId);
          if (!e || !ref || !info) return;
          const opus = document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== '';
          wantListening(files, e, fileId, editorTrack(info, effectiveSettings(q.batch, ref.edits.own)), opus ? 'opus' : 'aac');
        },
      ),
  );
  useEffect(() => player.update(live, urlOf));
  useEffect(
    () => () => {
      player.dispose();
      for (const m of made.current.values()) URL.revokeObjectURL(m.url);
    },
    [],
  );

  return {
    player,
    live,
    time,
    playing,
    current,
    missing: all.missing.length > 0,
    unmeasured: p.mix.matchLoudness && gains === null,
    toggle() {
      heard.value = true;
      player.toggle();
    },
  };
}

/** The zoom of the strip: 1 shows the whole mix; above that, more pixels per second. */
export interface Zoom {
  value: Signal<number>;
  max: number;
}

/** `total` is the strip's length: with files missing it still says how long the mix will be. */
export function MixTransport({ pb, total, zoom, compact }: { pb: Playback; total: number; zoom?: Zoom; compact?: boolean }) {
  const disabled = pb.missing || pb.live.duration === 0;
  const on = pb.playing.value;
  const z = zoom?.value.value ?? 1;
  return (
    <div class="transport mix-transport" data-time="0.00" data-gains="" data-voices="0">
      <button
        type="button"
        class="icon-button"
        aria-label={t(on ? 'mix.pause' : 'mix.play')}
        title={disabled && pb.missing ? t('mix.block.missing') : t(on ? 'mix.pause' : 'mix.play')}
        aria-keyshortcuts="Space"
        disabled={disabled}
        onClick={pb.toggle}
      >
        {on ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span class="mono small transport-time">
        {clockTime(pb.time.value)} / {clockTime(total)}
      </span>
      {pb.unmeasured && pb.playing.value && <span class="muted small">{t('editor.unmeasured')}</span>}
      {compact && (
        <input
          class="grow range"
          type="range"
          aria-label={t('mix.position')}
          min={0}
          max={pb.live.duration}
          step={0.1}
          value={pb.time.value}
          aria-valuetext={clockTime(pb.time.value)}
          disabled={disabled}
          onInput={(e) => pb.player.seek(Number(e.currentTarget.value))}
        />
      )}
      {zoom && (
        <>
          <span class="grow" />
          <button type="button" class="icon-button" aria-label={t('mix.zoomOut')} title={t('mix.zoomOut')} disabled={z <= 1} onClick={() => (zoom.value.value = Math.max(1, z / 2))}>
            <ZoomOutIcon />
          </button>
          <button type="button" class="icon-button" aria-label={t('mix.zoomIn')} title={t('mix.zoomIn')} disabled={z >= zoom.max} onClick={() => (zoom.value.value = Math.min(zoom.max, z * 2))}>
            <ZoomInIcon />
          </button>
          <button type="button" class="icon-button" aria-label={t('mix.fit')} title={t('mix.fit')} disabled={z === 1} onClick={() => (zoom.value.value = 1)}>
            <FitIcon />
          </button>
        </>
      )}
    </div>
  );
}

/** Seconds between the ruler's marks: the first step that leaves room for a label. */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
const stepFor = (pps: number): number => STEPS.find((s) => s * pps >= 64) ?? 3600;

/**
 * The ruler over the strip: a slider for the position. A press or a drag puts the playhead there,
 * arrows move 5 s (Shift 30 s); two fingers zoom.
 */
export function Ruler({ pb, pps, duration, onZoom }: { pb: Playback; pps: number; duration: number; onZoom(factor: number, at: number): void }) {
  const el = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, number>());
  const pinch = useRef<number | null>(null);
  const width = duration * pps;
  const step = stepFor(pps);
  const marks: number[] = [];
  for (let s = 0; s <= duration; s += step) marks.push(s);

  useSignalEffect(() => {
    const now = pb.time.value;
    el.current?.setAttribute('aria-valuenow', now.toFixed(1));
    el.current?.setAttribute('aria-valuetext', clockTime(now));
  });

  const timeAt = (clientX: number): number => {
    const r = el.current!.getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left) / pps, 0), duration);
  };
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return a === undefined || b === undefined ? 0 : Math.abs(a - b);
  };

  return (
    <div
      ref={el}
      class="mix-ruler"
      role="slider"
      tabIndex={0}
      aria-label={t('mix.position')}
      aria-valuemin={0}
      aria-valuemax={Number(duration.toFixed(1))}
      style={{ width: `${width}px` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, e.clientX);
        if (pointers.current.size === 2) pinch.current = spread();
        else pb.player.seek(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, e.clientX);
        if (pinch.current !== null) {
          const d = spread();
          if (pinch.current > 0 && d > 0) onZoom(d / pinch.current, timeAt(e.clientX));
          pinch.current = d;
        } else pb.player.seek(timeAt(e.clientX));
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
      }}
      onKeyDown={(e) => {
        const by = e.shiftKey ? 30 : 5;
        const now = pb.player.time;
        const to: Record<string, number> = { ArrowRight: now + by, ArrowUp: now + by, ArrowLeft: now - by, ArrowDown: now - by, Home: 0, End: duration };
        if (e.key in to) {
          e.preventDefault();
          pb.player.seek(to[e.key]!);
        }
      }}
    >
      {marks.map((s) => (
        <span key={s} class="mix-mark mono" style={{ left: `${s * pps}px` }} aria-hidden="true">
          {clockTime(s).replace(/\.\d+$/, '')}
        </span>
      ))}
    </div>
  );
}

/** The playhead over the strip; it moves every frame without re-rendering. */
export function Playhead({ pb, pps, box }: { pb: Playback; pps: number; box: { current: HTMLElement | null } }) {
  const head = useRef<HTMLDivElement>(null);
  const place = (now: number, follow: boolean) => {
    const x = now * pps;
    if (head.current) head.current.style.transform = `translateX(${x}px)`;
    // While playing, the strip turns the page when the playhead leaves it.
    const el = box.current;
    if (el && follow && (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth)) el.scrollLeft = x - el.clientWidth * 0.1;
  };
  useSignalEffect(() => place(pb.time.value, pb.playing.value));
  useEffect(() => place(pb.time.peek(), false), [pps]);
  return <div ref={head} class="mix-playhead" aria-hidden="true" />;
}
