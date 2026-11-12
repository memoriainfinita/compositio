// The picture of a video mix: the file format and its quality, and the canvas every clip is brought
// to (size and rate of the first clip, or fixed ones) with how each clip sits in it.

import { useApp } from '../../app/state.ts';
import { t } from '../../i18n/index.ts';
import { setMix } from '../../model/project.ts';
import { FRAME_RATES, H264_PRESETS, HAP_VARIANTS, PRORES_PROFILES } from '../../model/settings.ts';
import type { MixVideo } from '../../model/timeline.ts';
import { HAP_LABEL, PROFILE_LABEL } from '../output/Inspector.tsx';
import { NumberField, Select } from '../output/controls.tsx';
import { rateLabel, SIZES } from '../output/Picture.tsx';

const FIT_LABEL = { letterbox: 'picture.scaleLetterbox', fill: 'picture.scaleFill', stretch: 'picture.scaleStretch' } as const;
const PRESET_LABEL = { veryfast: 'output.presetVeryfast', fast: 'output.presetFast', medium: 'output.presetMedium', slow: 'output.presetSlow' } as const;

function Field({ id, label, title, children }: { id: string; label: string; title?: string; children: (id: string) => preact.ComponentChildren }) {
  return (
    <span class="mix-field" title={title}>
      <label for={id}>{label}</label>
      {children(id)}
    </span>
  );
}

export function VideoOptions() {
  const { project, store } = useApp();
  const v = project.value.mix.video;
  const set = (values: Partial<MixVideo>) => store.run((p) => setMix(p, { video: { ...p.mix.video, ...values } }));
  const sizeKey = `${v.width}x${v.height}`;
  return (
    <div class="mix-options mix-video-options" role="group" aria-label={t('mix.videoOptions')}>
      <Field id="mix-vformat" label={t('output.videoFormat')}>
        {(id) => (
          <Select
            id={id}
            value={v.format}
            options={[
              ['mp4', t('output.videoMp4')],
              ['prores', t('output.videoProres')],
              ['hap', t('output.videoHap')],
            ]}
            onChange={(format) => set({ format })}
          />
        )}
      </Field>
      {v.format === 'mp4' ? (
        <>
          <Field id="mix-vcrf" label={t('output.quality')}>
            {(id) => <NumberField id={id} value={v.h264Crf} min={0} max={51} step={1} unit="CRF" onChange={(h264Crf) => set({ h264Crf })} />}
          </Field>
          <Field id="mix-vpreset" label={t('output.encoderSpeed')}>
            {(id) => <Select id={id} value={v.h264Preset} options={H264_PRESETS.map((p) => [p, t(PRESET_LABEL[p])] as const)} onChange={(h264Preset) => set({ h264Preset })} />}
          </Field>
        </>
      ) : v.format === 'hap' ? (
        <Field id="mix-vhap" label={t('output.hapVariant')} title={t('output.hapVariantHint')}>
          {(id) => <Select id={id} value={v.hapVariant} options={HAP_VARIANTS.map((h) => [h, t(HAP_LABEL[h])] as const)} onChange={(hapVariant) => set({ hapVariant })} />}
        </Field>
      ) : (
        <Field id="mix-vprofile" label={t('output.proresProfile')}>
          {(id) => <Select id={id} value={v.proresProfile} options={PRORES_PROFILES.map((p) => [p, PROFILE_LABEL[p]] as const)} onChange={(proresProfile) => set({ proresProfile })} />}
        </Field>
      )}
      <Field id="mix-vcanvas" label={t('mix.canvas')} title={t('mix.canvasHint')}>
        {(id) => (
          <Select
            id={id}
            value={v.canvas}
            options={[
              ['first', t('mix.canvasFirst')],
              ['fixed', t('mix.canvasFixed')],
            ]}
            onChange={(canvas) => set({ canvas })}
          />
        )}
      </Field>
      {v.canvas === 'fixed' && (
        <>
          <Field id="mix-vsizes" label={t('picture.sizes')}>
            {(id) => (
              <Select
                id={id}
                value={SIZES.some(([w, h]) => `${w}x${h}` === sizeKey) ? sizeKey : 'custom'}
                options={[['custom', t('picture.custom')], ...SIZES.map(([w, h]) => [`${w}x${h}`, `${w}×${h}`] as const)]}
                onChange={(key) => {
                  const [width, height] = key.split('x').map(Number);
                  if (width && height) set({ width, height });
                }}
              />
            )}
          </Field>
          <Field id="mix-vwidth" label={t('picture.width')}>
            {(id) => <NumberField id={id} value={v.width} min={2} max={8192} step={2} unit="px" onChange={(width) => set({ width })} />}
          </Field>
          <Field id="mix-vheight" label={t('picture.height')}>
            {(id) => <NumberField id={id} value={v.height} min={2} max={8192} step={2} unit="px" onChange={(height) => set({ height })} />}
          </Field>
        </>
      )}
      <Field id="mix-vfit" label={t('mix.canvasFit')} title={t('mix.canvasFitHint')}>
        {(id) => <Select id={id} value={v.fit} options={(Object.keys(FIT_LABEL) as (keyof typeof FIT_LABEL)[]).map((f) => [f, t(FIT_LABEL[f])] as const)} onChange={(fit) => set({ fit })} />}
      </Field>
      <Field id="mix-vfps" label={t('picture.fps')}>
        {(id) => (
          <Select<'source' | (typeof FRAME_RATES)[number]>
            id={id}
            value={v.fps}
            options={[['source', t('mix.canvasFirst')], ...FRAME_RATES.map((r) => [r, rateLabel(r)] as const)]}
            onChange={(fps) => set({ fps })}
          />
        )}
      </Field>
    </div>
  );
}
