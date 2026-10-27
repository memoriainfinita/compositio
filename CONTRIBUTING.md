# Contributing

## Setup

compositio uses pnpm 11 (version pinned in `package.json`), with exact dependency versions and a committed lockfile.

```bash
pnpm install
pnpm dev          # dev server; sends the COOP/COEP headers itself
pnpm typecheck    # app and service worker
pnpm lint
pnpm test         # unit tests, Vitest
pnpm build        # copies the ffmpeg.wasm cores to public/ffmpeg/, then builds dist/ with dist/sw.js
pnpm e2e          # Playwright in Firefox against dist/; run pnpm build first
```

The first `pnpm e2e` may need the browser: `pnpm exec playwright install firefox`.

CI runs lint, unit tests, build and e2e on every push and pull request. A push to `main` that passes deploys `dist/` to GitHub Pages.

## Service worker

`src/sw/sw.ts`, built to `dist/sw.js` by `build/sw-plugin.ts`:
- Adds COOP/COEP to every response, so the page is cross-origin isolated on GitHub Pages and multithreaded ffmpeg.wasm can run. The first visit reloads once to get them
- Precaches the app on install; caches each ffmpeg core the first time it is fetched, under a path with its version
- A new version waits until the user accepts it

## Rules

- GitHub Actions are pinned to a commit, never a tag
- Tests produce no sound: Firefox runs with `media.volume_scale` at 0
