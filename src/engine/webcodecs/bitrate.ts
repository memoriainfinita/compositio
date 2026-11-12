// WebCodecs encodes to a bitrate, not to a CRF. This turns the CRF the person chose into the bitrate
// that gives about the same quality: bits per pixel per frame at CRF 18, halving
// every 6 CRF steps, as x264's scale does. An approximation, checked against ffmpeg in the engine tests.

const BPP_AT_18 = 0.25;
const MIN_BITRATE = 100_000;

export function h264Bitrate(width: number, height: number, fps: number, crf: number): number {
  const bpp = BPP_AT_18 * 2 ** ((18 - crf) / 6);
  return Math.max(MIN_BITRATE, Math.round(width * height * fps * bpp));
}
