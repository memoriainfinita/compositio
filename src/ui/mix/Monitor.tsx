// The picture of a video mix at the playhead, with the canvas's shape. Each clip on screen plays from
// its own <video>, which is also where its sound comes from; during a crossfade the two are stacked
// and the incoming one takes the opacity its curve gives it. Rotation, crop, the fades to black and
// speed are not shown here: the file that «Generar» makes has them.

import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../i18n/index.ts';
import { pictureAt } from './live.ts';
import type { Playback } from './Playback.tsx';

export function MixMonitor({ pb }: { pb: Playback }) {
  const box = useRef<HTMLDivElement>(null);
  const { live } = pb;
  // Read here so the picture follows the clock and a seek while paused.
  const now = pb.time.value;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const shown = new Set<HTMLElement>();
    for (const [n, layer] of pictureAt(live, now).entries()) {
      const clip = live.clips[layer.index];
      const video = clip ? pb.player.videoOf(clip.clipId) : null;
      if (!video) continue;
      video.className = 'mix-monitor-video';
      video.style.opacity = String(layer.alpha);
      video.style.zIndex = String(n + 1);
      video.style.objectFit = live.fit;
      if (video.parentElement !== el) el.append(video);
      shown.add(video);
    }
    for (const child of [...el.children]) if (!shown.has(child as HTMLElement)) child.remove();
  });
  return <div ref={box} class="mix-monitor" role="img" aria-label={t('mix.monitor')} title={t('mix.monitorHint')} data-testid="mix-monitor" style={`--ratio: ${live.ratio.toFixed(4)}`} />;
}
