# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [semver](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-28

First version.

### Added

- Project setup: pnpm, Vite, TypeScript, ESLint, Vitest, Playwright in Firefox, CI and deployment to GitHub Pages
- Service worker: cross-origin isolation, offline app shell, versioned ffmpeg.wasm cache, updates on user request
- Data model: media by track, per-file edits, mix timeline, declarative operations that build ffmpeg commands, versioned montage, preset and settings formats, undo and redo, IndexedDB storage with autosave
- Engine: ffmpeg.wasm runner with WORKERFS inputs, progress and cancellation, media probing, silence detection, a job queue that can move a waiting job ahead, and screen wake lock
- Interface shell: dark and light themes, Spanish and English, desktop, tablet and phone layouts, keyboard and screen reader support, strict Content Security Policy, self-hosted fonts
- Files: drop files or folders anywhere, or choose them; each batch is probed and added at once in natural order; checkboxes for what to process or mix, removing with undo, missing files of a restored session paired when dropped again, alerts for files over 2 GB, files that are not media and single-thread mode, the engine download in megabytes on the start screen; every file's waveform made in the background
- Editor: own waveform drawn part by part, playback from the file, region and fade handles, zoom and overview, keyboard shortcuts, in, out and fade fields, «Result» and «Original» in real time, the technical line with the bitrate of lossy files
- Output: shared or per-file settings, the five steps, processing the checked files or, with none checked, the one in the editor, presets with import and export, quick actions on the start screen
- Exports: the jobs under way with cancel and retry, and the results, which wait there to be downloaded one by one, checked, or as one zip; nothing downloads by itself
- Mix: clips from the checked files or dragged from the list onto a strip, reordering by dragging or keyboard, draggable overlaps and dry cuts, fades drawn on each clip, playing the mix from the files with a ruler, playhead and zoom, a transition popup that previews about 20 s around the cross, mix fades, loudness matching, WAV 24-bit or MP3 at 44.1 or 48 kHz, times as CSV, a warning when the WAV mix may not fit in memory
- Montages: save with a name, replace or save as new, a library with open, export, import and delete, opening as an undo step, reopening that pairs files by name and size and can open without the missing ones, space used shown
- Installable app: manifest with icons, install offer where the browser makes one, sharing files to compositio on Android
- «Try an example»: three sample tracks made in the browser, in the files and the mix
- About: licences and links to the code of compositio, ffmpeg.wasm and FFmpeg; «Report a problem» copies the technical details for an issue

### Fixed

- On phones the new-version notice no longer covers the bottom bar
- A blank page after a new deploy while the app was open, when the server varies by Origin
- On Android, the bottom bar and the foot of the output sheet were off screen: the browser bar counted in the height

[Unreleased]: https://github.com/memoriainfinita/compositio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/memoriainfinita/compositio/releases/tag/v0.1.0
