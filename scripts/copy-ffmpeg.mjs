// Copies the ffmpeg.wasm cores into public/ffmpeg/<package>-<version>/ so the site serves them itself.
// The version in the path lets the service worker cache them for good: a new core is a new URL.
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';

const cores = ['core', 'core-mt'];
rmSync('public/ffmpeg', { recursive: true, force: true });
for (const name of cores) {
  const dir = `node_modules/@ffmpeg/${name}`;
  const { version } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  const from = `${dir}/dist/esm`;
  if (!existsSync(from)) throw new Error(`missing ${from}`);
  cpSync(from, `public/ffmpeg/${name}-${version}`, { recursive: true });
}
