// Plays the mix from its files, never rendered: an <audio> per clip near the playhead, each through
// a gain that follows `soundingAt` every frame. The clock is the page's; an element that drifts
// from it is put back in place. Playing the mix pauses whatever else plays on the page, and the
// other way round.

import { context } from '../editor/player.ts';
import { soundingAt, type Live, type LiveClip } from './live.ts';

/** Seconds ahead a clip gets its element, so it is ready when its turn comes. */
const AHEAD = 5;
/** Seconds an element may drift from the clock before it is moved back. */
const DRIFT = 0.25;

interface Voice {
  url: string;
  el: HTMLAudioElement;
  gain: GainNode | null;
}

export class MixPlayer {
  private live: Live;
  private voices = new Map<string, Voice>();
  private clock = { at: 0, t: 0 };
  private paused = 0;
  private on = false;
  private frame = 0;

  constructor(
    live: Live,
    /** The URL a file plays from, or null while it has none. */
    private urlOf: (fileId: string) => string | null,
    /**
     * Every frame while playing, and after each change: the time, the gain of each clip heard and
     * how many elements are playing.
     */
    private readonly onTime: (t: number, gains: ReadonlyMap<number, number>, voices: number) => void,
    private readonly onPlaying: (playing: boolean) => void,
    /** A file the browser cannot play; it plays again once `urlOf` gives a copy. */
    private readonly onUnplayable: (fileId: string) => void,
  ) {
    this.live = live;
    document.addEventListener('play', this.otherPlays, true);
  }

  get playing(): boolean {
    return this.on;
  }

  get time(): number {
    return this.on ? this.clock.t + (performance.now() - this.clock.at) / 1000 : this.paused;
  }

  /** The mix or the files changed: what plays follows at once. */
  update(live: Live, urlOf: (fileId: string) => string | null): void {
    this.live = live;
    this.urlOf = urlOf;
    if (!this.on) this.paused = Math.min(this.paused, live.duration);
    this.sync(false);
  }

  play(): void {
    if (this.on || this.live.duration === 0) return;
    const ctx = context();
    // Not awaited: without an audio device resume never settles, and the mix must play anyway.
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
    for (const v of this.voices.values()) this.wire(v);
    if (this.paused >= this.live.duration) this.paused = 0;
    for (const m of document.querySelectorAll<HTMLMediaElement>('audio, video')) m.pause();
    this.clock = { at: performance.now(), t: this.paused };
    this.on = true;
    this.onPlaying(true);
    this.sync(true);
    this.frame = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.on) return;
    this.paused = this.time;
    this.on = false;
    cancelAnimationFrame(this.frame);
    this.sync(false);
    this.onPlaying(false);
  }

  toggle(): void {
    if (this.on) this.pause();
    else this.play();
  }

  seek(t: number): void {
    const to = Math.min(Math.max(t, 0), this.live.duration);
    if (this.on) this.clock = { at: performance.now(), t: to };
    else this.paused = to;
    this.sync(true);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    document.removeEventListener('play', this.otherPlays, true);
    for (const id of [...this.voices.keys()]) this.drop(id);
  }

  private readonly otherPlays = (e: Event) => {
    if (this.on && e.target instanceof HTMLMediaElement) this.pause();
  };

  private readonly tick = () => {
    if (!this.on) return;
    if (this.time >= this.live.duration) {
      this.paused = this.live.duration;
      this.on = false;
      this.sync(false);
      this.onPlaying(false);
      return;
    }
    this.sync(false);
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Puts every element where the clock says; `jump` moves even the ones within the drift. */
  private sync(jump: boolean): void {
    const t = this.time;
    const sounding = soundingAt(this.live, t);
    const keep = new Set<string>();
    const gains = new Map<number, number>();
    for (const s of sounding) {
      const c = this.live.clips[s.index]!;
      keep.add(c.clipId);
      gains.set(s.index, s.gain);
      const v = this.voice(c);
      if (!v) continue;
      this.setGain(v, s.gain);
      const off = Math.abs(v.el.currentTime - s.fileTime);
      if (jump || off > DRIFT || (this.on && v.el.paused)) v.el.currentTime = s.fileTime;
      if (this.on && v.el.paused) void v.el.play().catch(() => {});
      if (!this.on && !v.el.paused) v.el.pause();
    }
    // The next clips get ready at their first second.
    for (const c of this.live.clips) {
      if (keep.has(c.clipId) || c.at <= t || c.at > t + AHEAD) continue;
      keep.add(c.clipId);
      const v = this.voice(c);
      if (!v) continue;
      this.setGain(v, 0);
      if (!v.el.paused) v.el.pause();
      if (Math.abs(v.el.currentTime - c.from) > DRIFT) v.el.currentTime = c.from;
    }
    for (const id of [...this.voices.keys()]) if (!keep.has(id)) this.drop(id);
    this.onTime(t, gains, [...this.voices.values()].filter((v) => !v.el.paused).length);
  }

  private voice(c: LiveClip): Voice | null {
    const url = this.urlOf(c.fileId);
    const had = this.voices.get(c.clipId);
    if (had && had.url === url) return had;
    if (had) this.drop(c.clipId);
    if (!url) return null;
    const el = new Audio();
    el.preload = 'auto';
    el.addEventListener('error', () => this.onUnplayable(c.fileId));
    el.src = url;
    el.currentTime = c.from;
    // A new element per voice: Web Audio takes an element only once.
    const v: Voice = { url, el, gain: null };
    this.voices.set(c.clipId, v);
    if (this.on) this.wire(v);
    return v;
  }

  /** The graph is made once the context exists, after a user gesture. */
  private wire(v: Voice): void {
    const ctx = context();
    if (!ctx || v.gain) return;
    v.gain = ctx.createGain();
    v.gain.gain.value = 0;
    // From now on the gain node sets the level.
    v.el.volume = 1;
    ctx.createMediaElementSource(v.el).connect(v.gain).connect(ctx.destination);
  }

  private setGain(v: Voice, g: number): void {
    const ctx = context();
    if (v.gain && ctx) v.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.005);
    else v.el.volume = Math.min(1, Math.max(0, g));
  }

  private drop(id: string): void {
    const v = this.voices.get(id);
    if (!v) return;
    this.voices.delete(id);
    v.el.pause();
    v.gain?.disconnect();
    v.el.removeAttribute('src');
    v.el.load();
  }
}
