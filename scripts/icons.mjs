// Writes the app icons into public/icons/ from the logo «Encuentro» (spec, «Interfaz»): an SVG and
// PNGs of 192 and 512 px, plain and maskable (logo inside the 80 % safe zone), on the dark ground.
// Run by hand when the logo changes: `node scripts/icons.mjs`. Renders with Playwright's Firefox.
import { mkdir, writeFile } from 'node:fs/promises';
import { firefox } from '@playwright/test';

const GROUND = '#121417';
const LINE = '#e6e8eb';
const ACCENT = '#5ac8d8';

/** `scale`: share of the square the logo's circles take. */
const svg = (scale) => {
  const s = scale;
  const t = (50 * (1 - s)).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${GROUND}"/>
  <g transform="translate(${t} ${t}) scale(${s})" fill="none">
    <circle cx="36" cy="50" r="28" stroke="${LINE}" stroke-width="7"/>
    <circle cx="64" cy="50" r="28" stroke="${LINE}" stroke-width="7"/>
    <path d="M50 25.7 A28 28 0 0 1 50 74.3 A28 28 0 0 1 50 25.7 Z" fill="${ACCENT}"/>
  </g>
</svg>
`;
};

const ICONS = [
  { name: 'icon', scale: 0.9 },
  // The circles span 64 of 100 units; at 0.62 they stay inside the central 80 %.
  { name: 'maskable', scale: 0.62 },
];

await mkdir('public/icons', { recursive: true });
const browser = await firefox.launch();
const page = await browser.newPage();
for (const { name, scale } of ICONS) {
  const source = svg(scale);
  await writeFile(`public/icons/${name}.svg`, source);
  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
    await page.screenshot({ path: `public/icons/${name}-${size}.png`, clip: { x: 0, y: 0, width: size, height: size } });
  }
}
await browser.close();
