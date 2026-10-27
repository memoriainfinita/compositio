// Copies ffmpeg.wasm cores and coi-serviceworker into public/ so they are served from the site.
import { cpSync, mkdirSync } from 'node:fs';

const copies = [
  ['node_modules/@ffmpeg/core/dist/esm', 'public/ffmpeg/st'],
  ['node_modules/@ffmpeg/core-mt/dist/esm', 'public/ffmpeg/mt'],
  ['node_modules/coi-serviceworker/coi-serviceworker.js', 'public/coi-serviceworker.js'],
];

mkdirSync('public/ffmpeg', { recursive: true });
for (const [from, to] of copies) cpSync(from, to, { recursive: true });
