// The waveform with its region: a canvas underneath, and over it the playhead and the handles as
// sliders, so the keyboard and screen readers reach everything the mouse does. Below, the overview
// strip moves the view along the file (as in aures).

import { useSignalEffect, type Signal } from '@preact/signals';
import type { HTMLAttributes } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Peaks } from '../../engine/index.ts';
import { lang, t } from '../../i18n/index.ts';
import { clockTime } from '../../model/media.ts';
import type { FileEdits, Silences } from '../../model/edits.ts';
import { drawScene, themeColors, type Scene } from './draw.ts';
import { moveRegion, regionOut, setFadeIn, setFadeOut, setIn, setOut } from './region.ts';
import { clampView, fit, timeToX, xToTime, zoomAt, pan, type View } from './view.ts';

type Patch = Partial<Omit<FileEdits, 'own'>>;
type Part = 'in' | 'out' | 'region' | 'fadeIn' | 'fadeOut';

export interface WaveformProps {
  fileId: string;
  duration: number;
  peaks: Peaks | null;
  edits: FileEdits;
  silences: Silences | null;
  /** Fades do nothing (copying the track): no fade handles. */
  fadesOff: boolean;
  view: Signal<View>;
  time: Signal<number>;
  playing: Signal<boolean>;
  onSeek(t: number): void;
  onPatch(patch: Patch, group?: string): void;
}

const ZOOM = 1.25;
let gestures = 0;

/** Size of an element in CSS pixels, kept current. The canvas is absolute so writing it never resizes its box. */
function useSize<T extends HTMLElement>(): [{ current: T | null }, { w: number; h: number }, number] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dpr, setDpr] = useState(globalThis.devicePixelRatio || 1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    // A window moved to another screen changes the ratio without resizing anything.
    let mq: MediaQueryList | null = null;
    const watch = () => {
      mq?.removeEventListener('change', watch);
      setDpr(devicePixelRatio || 1);
      mq = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`);
      mq.addEventListener('change', watch);
    };
    watch();
    return () => {
      ro.disconnect();
      mq?.removeEventListener('change', watch);
    };
  }, []);
  return [ref, size, dpr];
}

/** Redraws when the theme switches: the colours live in CSS. */
function useScheme(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const bump = () => setN((x) => x + 1);
    mq.addEventListener('change', bump);
    return () => mq.removeEventListener('change', bump);
  }, []);
  return n;
}

function Canvas({ scene }: { scene: Scene }) {
  const [box, size, dpr] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  // Not read: a theme switch re-renders, and every render redraws.
  useScheme();
  useEffect(() => {
    const c = canvas.current;
    if (!c || size.w === 0) return;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    if (ctx) drawScene(ctx, c.width, c.height, dpr, scene, themeColors(c));
  });
  return (
    <div ref={box} class="wave-canvas-box">
      <canvas ref={canvas} class="wave-canvas" aria-hidden="true" />
    </div>
  );
}

const seconds = (s: number) => t('editor.seconds', { n: new Intl.NumberFormat(lang.value, { maximumFractionDigits: 2 }).format(s) });

export function Waveform(props: WaveformProps) {
  const { duration, edits, view, time, playing, fileId } = props;
  const [box, size] = useSize<HTMLDivElement>();
  const head = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const drag = useRef<{ part: Part | 'seek'; group: string; t0: number; in0: number } | null>(null);
  const touches = useRef(new Map<number, number>());
  const pinch = useRef<{ dist: number; view: View } | null>(null);

  const v = view.value;
  const w = size.w;
  const out = regionOut(edits, duration);
  const x = (s: number) => Math.min(Math.max(timeToX(s, w, v), 0), w);

  // The playhead moves every frame without re-rendering: straight to the DOM.
  const place = (now: number, vv: View) => {
    const el = head.current;
    const width = box.current?.clientWidth ?? 0;
    if (el && width > 0) {
      const px = timeToX(now, width, vv);
      el.style.transform = `translateX(${px}px)`;
      el.hidden = px < 0 || px > width;
    }
    surface.current?.setAttribute('aria-valuenow', now.toFixed(3));
    surface.current?.setAttribute('aria-valuetext', clockTime(now));
  };
  useSignalEffect(() => {
    const now = time.value;
    const vv = view.value;
    place(now, vv);
    // While playing, the view turns the page when the playhead leaves it.
    if (playing.value && (now > vv.e || now < vv.s)) view.value = clampView(now, now + (vv.e - vv.s), latest.current.duration);
  });
  useEffect(() => place(time.peek(), view.peek()), [w]);

  const timeAt = (clientX: number): number => {
    const r = box.current!.getBoundingClientRect();
    return Math.min(Math.max(xToTime(clientX - r.left, r.width, view.peek()), 0), latest.current.duration);
  };

  const patchFor = (part: Part, at: number, from: { t0: number; in0: number }): Patch => {
    const { edits: e, duration: d } = latest.current;
    switch (part) {
      case 'in':
        return setIn(e, d, at);
      case 'out':
        return setOut(e, d, at);
      case 'region':
        return moveRegion(e, d, from.in0 + (at - from.t0));
      case 'fadeIn':
        return setFadeIn(e, d, at - e.in);
      case 'fadeOut':
        return setFadeOut(e, d, regionOut(e, d) - at);
    }
  };

  const down = (part: Part | 'seek') => (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (e.pointerType === 'touch' && part === 'seek') {
      touches.current.set(e.pointerId, e.clientX);
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        pinch.current = { dist: Math.abs(a! - b!), view: view.peek() };
        drag.current = null;
        return;
      }
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).focus();
    const at = timeAt(e.clientX);
    drag.current = { part, group: `wave-${++gestures}`, t0: at, in0: latest.current.edits.in };
    if (part === 'seek') latest.current.onSeek(at);
  };

  const move = (e: PointerEvent) => {
    if (pinch.current && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, e.clientX);
      const [a, b] = [...touches.current.values()];
      const dist = Math.abs(a! - b!);
      if (dist > 10 && pinch.current.dist > 10) {
        const p = pinch.current;
        view.value = zoomAt(p.view, timeAt((a! + b!) / 2), p.dist / dist, latest.current.duration);
      }
      return;
    }
    const d = drag.current;
    if (!d) return;
    const at = timeAt(e.clientX);
    if (d.part === 'seek') latest.current.onSeek(at);
    else latest.current.onPatch(patchFor(d.part, at, d), d.group);
  };

  const up = (e: PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    drag.current = null;
  };

  // Not a JSX handler: wheel listeners must be active (non-passive) to keep the page from scrolling or zooming.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const d = latest.current.duration;
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        view.value = zoomAt(view.peek(), timeAt(e.clientX), e.deltaY > 0 ? ZOOM : 1 / ZOOM, d);
      } else if (e.shiftKey || sideways) {
        e.preventDefault();
        const vv = view.peek();
        const delta = (sideways ? e.deltaX : e.deltaY) || e.deltaX;
        view.value = pan(vv, (Math.sign(delta) * (vv.e - vv.s)) / 10, d);
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  /** Keys on a handle: 10 ms, 100 ms with Shift, 1 s with Page keys; Home and End to the limits. */
  const nudge = (part: Part) => (e: KeyboardEvent) => {
    const { edits: ed, duration: d } = latest.current;
    const step = e.shiftKey ? 0.1 : 0.01;
    const keys: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 1, PageDown: -1 };
    const o = regionOut(ed, d);
    const value = { in: ed.in, out: o, region: ed.in, fadeIn: ed.in + ed.fadeIn.duration, fadeOut: o - ed.fadeOut.duration }[part];
    let at: number;
    if (e.key === 'Home') at = part === 'fadeIn' ? ed.in : part === 'fadeOut' ? -Infinity : 0;
    else if (e.key === 'End') at = part === 'fadeOut' ? o : Infinity;
    else if (e.key in keys) {
      // A fade's slider is its duration: up lengthens it, whichever way that moves the handle.
      const k = keys[e.key]!;
      at = part === 'fadeOut' && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key.startsWith('Page')) ? value - k : value + k;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    latest.current.onPatch(patchFor(part, at, { t0: ed.in, in0: ed.in }), `key-${part}-${fileId}`);
  };

  const surfaceKeys = (e: KeyboardEvent) => {
    const { duration: d } = latest.current;
    const now = time.peek();
    const step = e.shiftKey ? 10 : 1;
    const vv = view.peek();
    const actions: Record<string, () => void> = {
      ArrowLeft: () => latest.current.onSeek(Math.max(0, now - step)),
      ArrowRight: () => latest.current.onSeek(Math.min(d, now + step)),
      Home: () => latest.current.onSeek(0),
      End: () => latest.current.onSeek(d),
      ArrowUp: () => (view.value = zoomAt(vv, now, 1 / ZOOM ** 2, d)),
      ArrowDown: () => (view.value = zoomAt(vv, now, ZOOM ** 2, d)),
      '0': () => (view.value = fit(d)),
    };
    const act = actions[e.key];
    if (!act || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    act();
  };

  const slider = (part: Part, label: string, value: number, min: number, max: number, text: string, cls: string, left: number, extra?: HTMLAttributes<HTMLDivElement>) => (
    <div
      role="slider"
      tabIndex={0}
      class={`wave-handle ${cls}`}
      aria-label={label}
      title={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(3))}
      aria-valuetext={text}
      style={{ left: `${left}px` }}
      onPointerDown={down(part)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={nudge(part)}
      {...extra}
    />
  );

  const scene: Scene = { view: v, duration, peaks: props.peaks, region: { start: edits.in, end: out }, fadeIn: props.fadesOff ? undefined : edits.fadeIn, fadeOut: props.fadesOff ? undefined : edits.fadeOut, silences: props.silences };
  const length = out - edits.in;

  return (
    <div class="wave-wrap">
      <div ref={box} class="wave" data-ready={props.peaks ? String(props.peaks.ready >= duration) : 'false'}>
        <Canvas scene={scene} />
        <div
          ref={surface}
          role="slider"
          tabIndex={0}
          class="wave-surface"
          aria-label={t('editor.position')}
          aria-valuemin={0}
          aria-valuemax={Number(duration.toFixed(3))}
          aria-keyshortcuts="Space I O ArrowLeft ArrowRight ArrowUp ArrowDown 0"
          onPointerDown={down('seek')}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={surfaceKeys}
        />
        <div ref={head} class="wave-playhead" aria-hidden="true" />
        {w > 0 && (
          <>
            {slider('region', t('editor.region'), edits.in, 0, duration - length, `${clockTime(edits.in)} – ${clockTime(out)}`, 'region', x(edits.in), {
              style: { left: `${x(edits.in)}px`, width: `${Math.max(x(out) - x(edits.in), 0)}px` },
            })}
            {slider('in', t('editor.in'), edits.in, 0, duration, clockTime(edits.in), 'in', x(edits.in))}
            {slider('out', t('editor.out'), out, 0, duration, clockTime(out), 'out', x(out))}
            {!props.fadesOff && slider('fadeIn', t('editor.fadeIn'), edits.fadeIn.duration, 0, length, seconds(edits.fadeIn.duration), 'fade fade-in', x(edits.in + edits.fadeIn.duration))}
            {!props.fadesOff && slider('fadeOut', t('editor.fadeOut'), edits.fadeOut.duration, 0, length, seconds(edits.fadeOut.duration), 'fade fade-out', x(out - edits.fadeOut.duration))}
          </>
        )}
      </div>
      <Overview {...props} />
    </div>
  );
}

/** The whole file small, with the stretch the waveform shows; dragging along it moves that stretch. */
function Overview({ duration, peaks, edits, view }: WaveformProps) {
  const ref = useRef<HTMLDivElement>(null);
  const v = view.value;
  const whole = fit(duration);
  const go = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const at = xToTime(e.clientX - r.left, r.width, whole);
    const span = view.peek().e - view.peek().s;
    view.value = clampView(at - span / 2, at + span / 2, duration);
  };
  const zoomed = v.e - v.s < duration - 1e-6;
  return (
    <div
      ref={ref}
      class="overview"
      aria-hidden="true"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        go(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && go(e)}
    >
      <Canvas scene={{ view: whole, duration, peaks, region: { start: edits.in, end: regionOut(edits, duration) } }} />
      {zoomed && <div class="overview-window" style={{ left: `${(v.s / duration) * 100}%`, width: `${((v.e - v.s) / duration) * 100}%` }} />}
    </div>
  );
}
