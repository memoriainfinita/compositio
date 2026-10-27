# compositio

[![Live demo](https://img.shields.io/badge/demo-live-5ac8d8?style=flat)](https://memoriainfinita.github.io/compositio/)
[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)

*Compositio*, Latin for putting together.

Prepare audio and video for live shows in the browser. Everything runs on your device with [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm); no file leaves it.

**Live:** https://memoriainfinita.github.io/compositio/

**Status:** in development. Files can be added and inspected; processing, the editor and the mix are not there yet.

![compositio on a phone, dark theme: six WAV files with their durations, four of them in the batch, and an alert about a text file that was not added](docs/compositio-demo.png)

## Files

- Drop files or a folder, subfolders included, anywhere on the page, or choose them with the system picker, the only way on phones
- Each batch is read with ffprobe and added at once, in natural order (2 before 10), as one undo step
- Checkboxes for the batch, all or none, and Remove with undo
- The editor shows the active file's format, sample rate, bit depth and channels
- Alerts for files over 2 GB, files that are not audio or video, and single-thread mode in browsers without multithreading
- A restored session lists its files as missing until they are dropped again

![compositio on desktop, light theme: the file list with the active file, its technical line in the editor, and the five output steps](docs/compositio-desktop.png)

## Limits

ffmpeg.wasm is WebAssembly in the browser:
- 2 GB per input file
- 10 to 100 times slower than native ffmpeg
- Results are downloads; originals are never overwritten

## Look

Dark and light themes that follow the system, Spanish and English, and layouts for phone, tablet and desktop. Works offline after the first visit.

## Browsers

The tests run in Firefox.

## Stack

Preact, Vite and TypeScript; ffmpeg.wasm with ffmpeg 5.1.4. pnpm.

## Scripts

```bash
pnpm dev         # development server
pnpm test        # unit tests (vitest)
pnpm build       # production build
pnpm e2e         # end-to-end tests in Firefox (after build)
pnpm lint        # eslint
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

GPL-3.0-only. See [LICENSE](LICENSE). ffmpeg.wasm (`@ffmpeg/core`, `@ffmpeg/core-mt`) is GPL-2.0-or-later.

## Credits

Developed by [@memoriainfinita](https://github.com/memoriainfinita) with the assistance of Claude (Anthropic).
