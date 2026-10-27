// Builds src/sw/sw.ts into dist/sw.js after the app build, with the list of files to precache
// and a version that changes whenever any of them changes.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { build, type Plugin, type ResolvedConfig } from 'vite';
import { CSP_HEADER } from './csp.ts';

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

export function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'compositio-sw',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      const files = listFiles(outDir)
        .map((path) => relative(outDir, path).replaceAll('\\', '/'))
        // ffmpeg cores are cached on first use, not on install: two of them weigh ~65 MB.
        .filter((path) => !path.startsWith('ffmpeg/') && path !== 'sw.js' && !path.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const path of files) hash.update(path).update(readFileSync(join(outDir, path)));
      const cores = readdirSync(join(outDir, 'ffmpeg')).sort().join('+');

      await build({
        configFile: false,
        root: config.root,
        logLevel: 'warn',
        define: {
          __PRECACHE__: JSON.stringify(files),
          __VERSION__: JSON.stringify(hash.digest('hex').slice(0, 12)),
          __FFMPEG_CORES__: JSON.stringify(cores),
          __CSP__: JSON.stringify(CSP_HEADER),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          target: 'es2022',
          lib: { entry: resolve(config.root, 'src/sw/sw.ts'), formats: ['iife'], name: 'sw', fileName: () => 'sw.js' },
        },
      });
    },
  };
}
