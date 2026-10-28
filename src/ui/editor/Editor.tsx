// The editor («Definitivo», «MovilEditor»): the active file's picture when it has one, its waveform
// with the region, transport and «Resultado» / «Original», and the fields for in, out and fades. Space plays, I and O
// set in and out at the playhead, anywhere in the editor but inside a field.

import { useComputed, useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { editorTrack, measureKey, wantListening, wantMeasurement, wantPeaks } from '../../app/editor.ts';
import { useApp } from '../../app/state.ts';
import { t, type Key } from '../../i18n/index.ts';
import type { FileEdits } from '../../model/edits.ts';
import type { FileRef } from '../../model/formats.ts';
import { audioTracks, clockTime, isVideo, type MediaInfo } from '../../model/media.ts';
import { setEdits } from '../../model/project.ts';
import { CURVES, effectiveSettings, type Curve, type Fade } from '../../model/settings.ts';
import { techLine } from '../format.ts';
import { FitIcon, PauseIcon, PlayIcon, ZoomInIcon, ZoomOutIcon } from '../icons.tsx';
import { Player, type Side } from './player.ts';
import { preview } from './preview.ts';
import { regionOut, setFadeIn, setFadeOut, setIn, setOut } from './region.ts';
import { fit, parseClock, zoomAt } from './view.ts';
import { Waveform } from './Waveform.tsx';

type Patch = Partial<Omit<FileEdits, 'own'>>;

const CURVE_LABEL: Record<Curve, Key> = {
  tri: 'curve.tri',
  qsin: 'curve.qsin',
  hsin: 'curve.hsin',
  esin: 'curve.esin',
  log: 'curve.log',
  exp: 'curve.exp',
};

/** Waits this long after the last edit before measuring again for B. */
const MEASURE_DELAY = 700;

const typing = (el: EventTarget | null): boolean => el instanceof HTMLElement && el.closest('input, select, textarea') !== null;

export function EditorPanel({ compact = false }: { compact?: boolean }) {
  const { project, files } = useApp();
  const file = project.value.files.find((f) => f.id === files.active.value);
  const info = file && files.infos.value.get(file.id);
  const here = file ? files.sources.value.has(file.id) : false;
  return (
    <section class="card editor" aria-labelledby="editor-title">
      <h2 id="editor-title" class="panel-title">
        {t('editor.title')}
      </h2>
      {file ? (
        <>
          <div class="editor-file">
            <span class="strong">{file.name}</span>
            <span class="muted small mono">{info ? techLine(file.name, info) : here ? '' : t('files.missing')}</span>
          </div>
          {here && info && audioTracks(info).length > 0 ? (
            <Stage key={file.id} file={file} info={info} compact={compact} />
          ) : (
            <>
              {here && info && <p class="empty">{t('editor.noAudio')}</p>}
              <EditFields file={file} duration={info?.duration ?? file.duration ?? 0} fadesOff={false} compact={compact} />
            </>
          )}
        </>
      ) : (
        <p class="empty">{t('editor.empty')}</p>
      )}
    </section>
  );
}

/** One file in the editor; re-created when the active file changes. */
function Stage({ file, info, compact }: { file: FileRef; info: MediaInfo; compact: boolean }) {
  const { project, files, engine, store } = useApp();
  const source = files.sources.value.get(file.id)!;
  const duration = info.duration;
  const settings = effectiveSettings(project.value.batch, file.edits.own);
  const track = editorTrack(info, settings);
  const silences = files.silences.value.get(file.id) ?? null;
  const fadesOff = settings.extract.mode === 'copy';

  const view = useSignal(fit(duration));
  const time = useSignal(0);
  const playing = useSignal(false);
  // The result is heard by default; measuring for it waits for a play or for choosing it.
  const side = useSignal<Side>('b');
  const armed = useSignal(false);
  const section = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLMediaElement>(null);
  const [player, setPlayer] = useState<Player | null>(null);

  useEffect(() => {
    if (engine) wantPeaks(files, engine, file.id, track);
  }, [track]);

  // The file plays from itself; a listening copy takes over when the browser cannot.
  const listening = files.listening.value.get(file.id);
  const fileUrl = useMemo(() => URL.createObjectURL(source), [source]);
  useEffect(() => () => URL.revokeObjectURL(fileUrl), [fileUrl]);
  const src = listening ?? fileUrl;

  useEffect(() => {
    const el = media.current;
    if (!el) return;
    const p = new Player(
      el,
      (now, g) => {
        time.value = now;
        // For tests and for whoever inspects: the gain B applies right now.
        section.current?.setAttribute('data-gain', g.toFixed(3));
      },
      (on) => {
        playing.value = on;
        if (on) armed.value = true;
      },
    );
    p.setSide(side.peek());
    setPlayer(p);
    return () => p.dispose();
  }, [src]);

  const measurements = files.measurements.value;
  const key = measureKey(file.id, file.edits, settings, silences);
  const measured = measurements.get(key) ?? null;
  // While a new measurement runs, the last one of this file is near enough for listening.
  const last = useRef(measured);
  if (measured) last.current = measured;
  const p = preview(file.edits, duration, settings, silences, measured ?? last.current);
  useEffect(() => player?.setPreview(p));

  useEffect(() => {
    if (!engine || side.value !== 'b' || !armed.value || !settings.normalize.enabled || measured) return;
    const timer = setTimeout(() => wantMeasurement(files, engine, file.id, file.edits, settings), MEASURE_DELAY);
    return () => clearTimeout(timer);
  }, [key, side.value, armed.value]);

  const onPatch = (patch: Patch, group?: string) => store.run((pr) => setEdits(pr, file.id, patch), group);
  const seek = (s: number) => player?.seek(s);

  const [copying, setCopying] = useState(false);
  const unplayable = () => {
    if (!engine || listening) return;
    setCopying(true);
    const opus = document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== '';
    wantListening(files, engine, file.id, track, opus ? 'opus' : 'aac');
  };

  const keys = (e: KeyboardEvent) => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey || !player) return;
    const k = e.key.toLowerCase();
    if (e.key === ' ') {
      e.preventDefault();
      void player.toggle();
    } else if (k === 'i') {
      e.preventDefault();
      onPatch(setIn(file.edits, duration, player.time));
    } else if (k === 'o') {
      e.preventDefault();
      onPatch(setOut(file.edits, duration, player.time));
    }
  };

  const timeText = useComputed(() => clockTime(time.value));
  const video = isVideo(info);
  const bind = (el: HTMLMediaElement | null) => void (media.current = el);
  const mediaProps = { ref: bind, src, preload: 'metadata' as const, onError: unplayable };

  return (
    <div ref={section} class="editor-stage" onKeyDown={keys} data-side={side.value} data-gain="1">
      {/* A new element per source: Web Audio takes an element only once. */}
      {video ? <video key={src} {...mediaProps} class="editor-video" playsInline /> : <audio key={src} {...mediaProps} hidden />}
      <Waveform
        fileId={file.id}
        duration={duration}
        peaks={files.peaks.value.get(file.id) ?? null}
        edits={file.edits}
        silences={silences}
        fadesOff={fadesOff}
        view={view}
        time={time}
        playing={playing}
        onSeek={seek}
        onPatch={onPatch}
      />
      <div class="transport">
        <button type="button" class="icon-button" aria-label={t(playing.value ? 'editor.pause' : 'editor.play')} title={t(playing.value ? 'editor.pause' : 'editor.play')} aria-keyshortcuts="Space" onClick={() => void player?.toggle()}>
          {playing.value ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span class="mono small transport-time">
          {timeText} / {clockTime(duration)}
        </span>
        <div class="segmented" role="group" aria-label={t('editor.compare')}>
          {(['b', 'a'] as const).map((s) => (
            <button key={s} type="button" class="segment" aria-pressed={side.value === s} title={t(s === 'a' ? 'editor.aHint' : 'editor.bHint')} onClick={() => {
              side.value = s;
              if (s === 'b') armed.value = true;
              player?.setSide(s);
            }}>
              {t(s === 'a' ? 'editor.original' : 'editor.result')}
            </button>
          ))}
        </div>
        {side.value === 'b' && p.unmeasured && !last.current && <span class="muted small">{t('editor.unmeasured')}</span>}
        {copying && !listening && (
          <span class="muted small" role="status">
            {t('editor.listening')}
          </span>
        )}
        <span class="grow" />
        <button type="button" class="icon-button" aria-label={t('editor.zoomOut')} title={t('editor.zoomOut')} onClick={() => (view.value = zoomAt(view.value, time.value, 2, duration))}>
          <ZoomOutIcon />
        </button>
        <button type="button" class="icon-button" aria-label={t('editor.zoomIn')} title={t('editor.zoomIn')} onClick={() => (view.value = zoomAt(view.value, time.value, 0.5, duration))}>
          <ZoomInIcon />
        </button>
        <button type="button" class="icon-button" aria-label={t('editor.fit')} title={t('editor.fit')} onClick={() => (view.value = fit(duration))}>
          <FitIcon />
        </button>
      </div>
      <EditFields file={file} duration={duration} fadesOff={fadesOff} compact={compact} />
    </div>
  );
}

/** A time typed as `m:ss.mmm`; applied on Enter or leaving the field, Escape puts it back. */
function TimeField({ id, label, value, onCommit }: { id: string; label: string; value: number; onCommit(s: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const s = parseClock(draft);
    setDraft(null);
    if (s !== null) onCommit(s);
  };
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input
        id={id}
        class="input mono"
        inputMode="decimal"
        spellcheck={false}
        value={draft ?? clockTime(value)}
        aria-invalid={draft !== null && parseClock(draft) === null ? 'true' : undefined}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape' && draft !== null) {
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
    </div>
  );
}

function FadeField({ id, label, fade, disabled, onChange }: { id: string; label: string; fade: Fade; disabled: boolean; onChange(f: Partial<Fade>): void }) {
  return (
    <div class="field fade-field" title={disabled ? t('editor.fadesCopy') : undefined}>
      <label for={id}>{label}</label>
      <div class="row">
        <input
          id={id}
          class="input mono"
          type="number"
          min={0}
          step={0.1}
          disabled={disabled}
          value={String(Number(fade.duration.toFixed(3)))}
          onChange={(e) => {
            const n = Number(e.currentTarget.value);
            if (Number.isFinite(n)) onChange({ duration: n });
          }}
        />
        <select class="input" aria-label={`${label}: ${t('editor.curve')}`} title={t('editor.curve')} disabled={disabled} value={fade.curve} onChange={(e) => onChange({ curve: e.currentTarget.value as Curve })}>
          {CURVES.map((c) => (
            <option key={c} value={c}>
              {t(CURVE_LABEL[c])}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function EditFields({ file, duration, fadesOff, compact }: { file: FileRef; duration: number; fadesOff: boolean; compact: boolean }) {
  const { store } = useApp();
  const e = file.edits;
  const run = (patch: Patch) => store.run((p) => setEdits(p, file.id, patch));
  const known = duration > 0;
  const fades = (
    <div class="edit-row">
      <FadeField id="fade-in" label={t('editor.fadeIn')} fade={e.fadeIn} disabled={fadesOff} onChange={(f) => run(f.duration === undefined ? { fadeIn: { ...e.fadeIn, ...f } } : known ? setFadeIn(e, duration, f.duration) : { fadeIn: { ...e.fadeIn, ...f } })} />
      <FadeField id="fade-out" label={t('editor.fadeOut')} fade={e.fadeOut} disabled={fadesOff} onChange={(f) => run(f.duration === undefined ? { fadeOut: { ...e.fadeOut, ...f } } : known ? setFadeOut(e, duration, f.duration) : { fadeOut: { ...e.fadeOut, ...f } })} />
    </div>
  );
  return (
    <div class="edit-fields">
      <div class="edit-row">
        <TimeField id="edit-in" label={t('editor.in')} value={e.in} onCommit={(s) => run(known ? setIn(e, duration, s) : { in: s })} />
        <TimeField id="edit-out" label={t('editor.out')} value={known ? regionOut(e, duration) : (e.out ?? 0)} onCommit={(s) => run(known ? setOut(e, duration, s) : { out: s })} />
      </div>
      {compact ? (
        <details class="fades-fold">
          <summary>{t('editor.fades')}</summary>
          {fades}
        </details>
      ) : (
        fades
      )}
    </div>
  );
}
