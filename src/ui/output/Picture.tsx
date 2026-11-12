// «Imagen»: rotation, crop, size, frame rate, speed and the fade to black. The crop's four numbers
// are the accessible way to the rectangle the editor draws over the picture; both write the same value.

import { useApp } from '../../app/state.ts';
import { engineLabel } from '../../engine/index.ts';
import { formatNumber, lang, t, type Key } from '../../i18n/index.ts';
import { clampRect, framedSize, initialCrop, withField } from '../../model/crop.ts';
import { videoTracks, type MediaInfo } from '../../model/media.ts';
import { FRAME_RATES, ROTATIONS, SCALE_MODES } from '../../model/settings.ts';
import { gridOf } from '../../model/operations.ts';
import { describePicture, type Rect } from '../../model/video.ts';
import { Check, NumberField, Select, Setting, type Ctx } from './controls.tsx';
import { useAssessment } from './useAssessment.ts';

const SCALE_LABEL: Record<(typeof SCALE_MODES)[number], Key> = {
  source: 'picture.scaleSource',
  fit: 'picture.scaleFit',
  fill: 'picture.scaleFill',
  letterbox: 'picture.scaleLetterbox',
  stretch: 'picture.scaleStretch',
};

export const SIZES: readonly (readonly [number, number])[] = [
  [3840, 2160],
  [1920, 1080],
  [1280, 720],
  [854, 480],
];

export const rateLabel = (r: string): string => {
  const [n, d] = r.split('/').map(Number) as [number, number | undefined];
  return new Intl.NumberFormat(lang.value, { maximumFractionDigits: 3 }).format(n / (d ?? 1));
};

const SPEEDS = [0.5, 1, 2] as const;

export function Picture({ ctx, info }: { ctx: Ctx; info: MediaInfo | undefined }) {
  const { project, files } = useApp();
  const p = ctx.settings.picture;
  const track = info ? videoTracks(info)[0] : undefined;
  const frame = track ? framedSize(track, p.rotate) : null;
  const file = ctx.file ?? project.value.files.find((f) => f.id === files.active.value);
  const assessment = useAssessment(file, ctx.settings);
  const description = track ? describePicture(track, p, null, gridOf(ctx.settings.convert.videoFormat)) : null;
  const size = description && !('error' in description) ? description.size : null;
  const crop = p.crop;
  const setCrop = (rect: Rect | null) => ctx.set('picture', { crop: rect });
  const field = (key: keyof Rect, label: string, min: number) =>
    crop && frame ? (
      <label class="crop-field">
        <span>{label}</span>
        <NumberField id={`crop-${key}`} label={label} value={crop[key]} min={min} max={key === 'x' || key === 'width' ? frame.width : frame.height} step={2} unit="px" onChange={(n) => setCrop(withField(crop, key, n, frame))} />
      </label>
    ) : null;

  return (
    <>
      {!track && info && <p class="muted small">{t('picture.noVideo')}</p>}
      <Setting ctx={ctx} step="picture" name="rotate" label={t('picture.rotate')}>
        {(id) => <Select id={id} value={p.rotate} options={ROTATIONS.map((r) => [r, `${r}°`] as const)} onChange={(rotate) => {
          // A quarter turn changes the frame the crop lives in: it is kept inside the new one.
          const turned = track ? framedSize(track, rotate) : null;
          ctx.set('picture', { rotate, ...(crop && turned ? { crop: clampRect(crop, turned) } : {}) });
        }} />}
      </Setting>
      <Check ctx={ctx} step="picture" name="crop" label={t('picture.crop')} checked={crop !== null} onChange={(on) => setCrop(on && frame ? initialCrop(frame) : null)} />
      {crop && frame && (
        <div class="crop-fields" role="group" aria-label={t('picture.crop')}>
          {field('x', t('picture.cropX'), 0)}
          {field('y', t('picture.cropY'), 0)}
          {field('width', t('picture.cropWidth'), 2)}
          {field('height', t('picture.cropHeight'), 2)}
        </div>
      )}
      <Setting ctx={ctx} step="picture" name="scale" label={t('picture.scale')}>
        {(id) => <Select id={id} value={p.scale.mode} options={SCALE_MODES.map((m) => [m, t(SCALE_LABEL[m])] as const)} onChange={(mode) => ctx.set('picture', { scale: { ...p.scale, mode } })} />}
      </Setting>
      {p.scale.mode !== 'source' && (
        <>
          <Setting ctx={ctx} step="picture" name="scale" label={t('picture.sizes')}>
            {(id) => (
              <Select<string>
                id={id}
                value={SIZES.some(([w, h]) => w === p.scale.width && h === p.scale.height) ? `${p.scale.width}x${p.scale.height}` : 'custom'}
                options={[['custom', t('picture.custom')], ...SIZES.map(([w, h]) => [`${w}x${h}`, `${w}×${h}`] as const)]}
                onChange={(v) => {
                  const [w, h] = v.split('x').map(Number);
                  if (w && h) ctx.set('picture', { scale: { ...p.scale, width: w, height: h } });
                }}
              />
            )}
          </Setting>
          <div class="crop-fields">
            <label class="crop-field">
              <span>{t('picture.width')}</span>
              <NumberField id="scale-width" label={t('picture.width')} value={p.scale.width} min={2} max={8192} step={2} unit="px" onChange={(width) => ctx.set('picture', { scale: { ...p.scale, width } })} />
            </label>
            <label class="crop-field">
              <span>{t('picture.height')}</span>
              <NumberField id="scale-height" label={t('picture.height')} value={p.scale.height} min={2} max={8192} step={2} unit="px" onChange={(height) => ctx.set('picture', { scale: { ...p.scale, height } })} />
            </label>
          </div>
        </>
      )}
      {size && (
        <p class="muted small mono picture-size" data-testid="picture-size">
          {t('picture.result', { w: size.width, h: size.height })}
        </p>
      )}
      <Setting ctx={ctx} step="picture" name="fps" label={t('picture.fps')}>
        {(id) => <Select<'source' | (typeof FRAME_RATES)[number]> id={id} value={p.fps} options={[['source', t('output.source')], ...FRAME_RATES.map((r) => [r, rateLabel(r)] as const)]} onChange={(fps) => ctx.set('picture', { fps })} />}
      </Setting>
      <Setting ctx={ctx} step="picture" name="speed" label={t('picture.speed')}>
        {(id) => (
          <>
            <NumberField id={id} value={p.speed} min={0.25} max={4} step={0.25} unit="×" onChange={(speed) => ctx.set('picture', { speed })} />
            {SPEEDS.map((s) => (
              <button key={s} type="button" class="button small-button" aria-pressed={p.speed === s} onClick={() => ctx.set('picture', { speed: s })}>
                {`${formatNumber(s, lang.value, 1)}×`}
              </button>
            ))}
          </>
        )}
      </Setting>
      <Check ctx={ctx} step="picture" name="fadeToBlack" label={t('picture.fade')} checked={p.fadeToBlack} onChange={(fadeToBlack) => ctx.set('picture', { fadeToBlack })} />
      {assessment && (
        <p class="muted small picture-engine" role="status" data-testid="picture-engine">
          {assessment.backend ? t('picture.engine', { engine: engineLabel(assessment.backend) }) : t('picture.engineNone')}
          {' · '}
          {t('picture.pace', { n: formatNumber(assessment.ratio, lang.value, 1) })}
        </p>
      )}
    </>
  );
}
