// «Probar con un ejemplo»: three sample tracks made in the browser, so the app can be tried
// without files of one's own. Chords with a slow pulse and fades at both ends, 16-bit stereo WAV.

const RATE = 44100;
export const EXAMPLE_SECONDS = 20;

/** Frequencies of each sample: A minor, F major, C major. */
const CHORDS: readonly (readonly number[])[] = [
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [130.81, 164.81, 196],
];

export function wavBytes(seconds: number, freqs: readonly number[], rate = RATE): Uint8Array<ArrayBuffer> {
  const frames = Math.round(seconds * rate);
  const buf = new ArrayBuffer(44 + frames * 4);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + frames * 4, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, frames * 4, true);
  const fade = rate * 1.5;
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const envelope = Math.min(1, i / fade, (frames - 1 - i) / fade) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.5 * t));
    let s = 0;
    for (const f of freqs) s += Math.sin(2 * Math.PI * f * t);
    const value = Math.round((s / freqs.length) * envelope * 0.5 * 32767);
    // A slightly different level on each side, so the stereo image is not flat.
    v.setInt16(44 + i * 4, value, true);
    v.setInt16(46 + i * 4, Math.round(value * 0.9), true);
  }
  return new Uint8Array(buf);
}

/** The sample files, named in the interface language. */
export const exampleFiles = (names: readonly string[]): File[] =>
  names.map((name, i) => new File([wavBytes(EXAMPLE_SECONDS, CHORDS[i % CHORDS.length]!)], name, { type: 'audio/wav', lastModified: Date.now() }));
