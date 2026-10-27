# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [semver](https://semver.org/).

## [Unreleased]

### Added

- Project setup: pnpm, Vite, TypeScript, ESLint, Vitest, Playwright in Firefox, CI and deployment to GitHub Pages
- Service worker: cross-origin isolation, offline app shell, versioned ffmpeg.wasm cache, updates on user request
- Data model: media by track, per-file edits, mix timeline, declarative operations that build ffmpeg commands, versioned montage, preset and settings formats, undo and redo, IndexedDB storage with autosave
- Engine: ffmpeg.wasm runner with WORKERFS inputs, progress and cancellation, media probing, silence detection, a job queue and screen wake lock
- Interface shell: dark and light themes, Spanish and English, desktop, tablet and phone layouts, keyboard and screen reader support, strict Content Security Policy, self-hosted fonts
