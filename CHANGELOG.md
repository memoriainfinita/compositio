# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [semver](https://semver.org/).

## [Unreleased]

### Added

- Project setup: pnpm, Vite, TypeScript, ESLint, Vitest, Playwright in Firefox, CI and deployment to GitHub Pages
- Service worker: cross-origin isolation, offline app shell, versioned ffmpeg.wasm cache, updates on user request
- Data model: media by track, per-file edits, mix timeline, declarative operations that build ffmpeg commands, versioned montage, preset and settings formats, undo and redo, IndexedDB storage with autosave
- Engine: ffmpeg.wasm runner with WORKERFS inputs, progress and cancellation, media probing, silence detection, a job queue and screen wake lock
- Interface shell: dark and light themes, Spanish and English, desktop, tablet and phone layouts, keyboard and screen reader support, strict Content Security Policy, self-hosted fonts
- Files: drop files or folders anywhere, or choose them; each batch is probed and added at once in natural order; batch selection, removing with undo, missing files of a restored session paired when dropped again, alerts for files over 2 GB, files that are not media and single-thread mode, the engine download in megabytes on the start screen
- Editor: own waveform drawn part by part, playback from the file, region and fade handles, zoom and overview, keyboard shortcuts, in, out and fade fields, real-time A/B
- Output: batch or per-file settings, the five steps, processing with direct download, one by one or as a zip, the queue with cancel and retry, presets with import and export, quick actions
- Mix: clips from the selection on a strip, reordering by dragging or keyboard, draggable overlaps and dry cuts, a transition popup that previews about 20 s around the cross, mix fades, loudness matching, WAV 24-bit or MP3 at 44.1 or 48 kHz, times as CSV, a warning when the WAV mix may not fit in memory
- Montages: save with a name, replace or save as new, a library with open, export, import and delete, opening as an undo step, reopening that pairs files by name and size and can open without the missing ones, space used shown
