// The picture of a video in the editor: turned by the rotation chosen in «Imagen», with the crop drawn
// over it. The rectangle is a help for the pointer and is hidden from assistive technology: the
// numeric fields of «Imagen» carry the same four values and are the accessible way to them.

import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { dragRect, HANDLES, type Handle } from '../../model/crop.ts';
import type { Size } from '../../model/media.ts';
import type { Rect } from '../../model/video.ts';

export interface PictureFrameProps {
  /** The picture as seen: the file's tag and the chosen rotation applied. */
  frame: Size;
  rotate: 0 | 90 | 180 | 270;
  crop: Rect | null;
  onCrop(rect: Rect, group: string): void;
  children: ComponentChildren;
}

let gestures = 0;

export function PictureFrame({ frame, rotate, crop, onCrop, children }: PictureFrameProps) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; start: Rect; x: number; y: number; group: string } | null>(null);

  const down = (handle: Handle) => (e: PointerEvent) => {
    if (e.button !== 0 || !crop) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, start: crop, x: e.clientX, y: e.clientY, group: `crop-${++gestures}` };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    const r = box.current?.getBoundingClientRect();
    if (!d || !r || r.width === 0) return;
    const k = frame.width / r.width;
    onCrop(dragRect(d.start, d.handle, (e.clientX - d.x) * k, (e.clientY - d.y) * k, frame), d.group);
  };
  const up = () => (drag.current = null);

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  return (
    <div ref={box} class="picture-frame" data-turn={rotate} style={`--ratio: ${frame.width / frame.height}`}>
      {children}
      {crop && (
        <div class="crop-overlay" aria-hidden="true">
          <div
            class="crop-rect"
            data-testid="crop-rect"
            style={{ left: pct(crop.x, frame.width), top: pct(crop.y, frame.height), width: pct(crop.width, frame.width), height: pct(crop.height, frame.height) }}
            onPointerDown={down('move')}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            {HANDLES.map((h) => (
              <div key={h} class={`crop-handle crop-${h}`} data-handle={h} onPointerDown={down(h)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
