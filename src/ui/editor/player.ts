// Plays the active file from itself (an <audio> or <video> with a blob URL), never decoded whole.
// A is the file as it is. B goes through a gain that follows the kept range, the fades and the
// normalizing gain every frame, so switching between them never stops the sound.

import { gainAt, type Preview } from './preview.ts';

export type Side = 'a' | 'b';

let shared: AudioContext | null = null;
/** One context for the page: the editor and the mix play through it. */
export const context = (): AudioContext | null => {
  if (!shared && typeof AudioContext === 'function') shared = new AudioContext();
  return shared;
};

export class Player {
  side: Side = 'a';
  private preview: Preview | null = null;
  private gain: GainNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private frame = 0;

  constructor(
    readonly media: HTMLMediaElement,
    /** Every frame while playing, and after each seek: the time and the gain being applied. */
    private readonly onTime: (t: number, gain: number) => void,
    private readonly onPlaying: (playing: boolean) => void,
  ) {
    media.addEventListener('play', this.started);
    media.addEventListener('pause', this.stopped);
    media.addEventListener('ended', this.stopped);
    media.addEventListener('seeked', this.report);
  }

  get playing(): boolean {
    return !this.media.paused;
  }

  get time(): number {
    return this.media.currentTime;
  }

  setPreview(p: Preview): void {
    this.preview = p;
    this.apply();
  }

  setSide(side: Side): void {
    this.side = side;
    if (side === 'b' && this.playing) this.intoRange();
    this.apply();
  }

  async play(): Promise<void> {
    // The graph is made on the first play: a user gesture, which the AudioContext needs.
    const ctx = context();
    if (ctx && !this.source) {
      this.source = ctx.createMediaElementSource(this.media);
      this.gain = ctx.createGain();
      this.source.connect(this.gain).connect(ctx.destination);
    }
    // Not awaited: without an audio device (a server, some setups) resume never settles, and the
    // element must play anyway.
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
    if (this.side === 'b') this.intoRange();
    this.apply();
    // A source the browser cannot play rejects here; its `error` event asks for a listening copy.
    await this.media.play().catch(() => {});
  }

  pause(): void {
    this.media.pause();
  }

  toggle(): Promise<void> | void {
    return this.playing ? this.pause() : this.play();
  }

  seek(t: number): void {
    const end = Number.isFinite(this.media.duration) ? this.media.duration : t;
    this.media.currentTime = Math.min(Math.max(t, 0), end);
    this.report();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.media.pause();
    this.media.removeEventListener('play', this.started);
    this.media.removeEventListener('pause', this.stopped);
    this.media.removeEventListener('ended', this.stopped);
    this.media.removeEventListener('seeked', this.report);
    this.source?.disconnect();
    this.gain?.disconnect();
  }

  /** B starts inside the kept range: playing from before it or past it begins at its start. */
  private intoRange(): void {
    const r = this.preview?.range;
    if (r && (this.media.currentTime < r.start || this.media.currentTime >= r.end)) this.media.currentTime = r.start;
  }

  private current(): number {
    return this.side === 'b' && this.preview ? gainAt(this.preview, this.media.currentTime) : 1;
  }

  private apply(): void {
    const g = this.current();
    if (this.gain && shared) this.gain.gain.setTargetAtTime(g, shared.currentTime, 0.005);
    this.onTime(this.media.currentTime, g);
  }

  private readonly report = () => this.apply();

  private readonly tick = () => {
    const r = this.preview?.range;
    if (this.side === 'b' && r && this.media.currentTime >= r.end) {
      this.media.pause();
      this.media.currentTime = r.end;
    }
    this.apply();
    if (this.playing) this.frame = requestAnimationFrame(this.tick);
  };

  private readonly started = () => {
    this.onPlaying(true);
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.tick);
  };

  private readonly stopped = () => {
    cancelAnimationFrame(this.frame);
    this.apply();
    this.onPlaying(false);
  };
}
