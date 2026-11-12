# compositio

[![Live demo](https://img.shields.io/badge/demo-live-5ac8d8?style=flat)](https://memoriainfinita.github.io/compositio/)
[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)

*Compositio*, Latin for putting together.

Prepare audio and video for live shows in the browser. Everything runs on your device, with [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) and the browser's own video codecs (WebCodecs, through [Mediabunny](https://github.com/Vanilagy/mediabunny)); no file leaves it.

**Live:** https://memoriainfinita.github.io/compositio/

**Status:** version 0.1.0, the first one ([changelog](CHANGELOG.md)). How to use it: [docs/guide](docs/guide/README.md). What each browser can do: [docs/guide/browsers.md](docs/guide/browsers.md).

![compositio on a phone, dark theme: the mix tab with five tracks, their start times and crossfades, and the position slider](docs/guide/img/compositio-demo.png)

## Files

- Drop files or a folder, subfolders included, anywhere on the page, or choose them with the system picker, the only way on phones
- Each batch is read with ffprobe and added at once, in natural order (2 before 10), as one undo step
- Checkboxes for what to process or mix, all or none, and Remove with undo
- The editor shows the active file's format, sample rate, bit depth and channels
- Alerts for files over 2 GB, files that are not audio or video, and single-thread mode in browsers without multithreading
- A restored session lists its files as missing until they are dropped again

## Editor

- Waveform drawn part by part, playback from the file without decoding it whole
- In and out handles, fades with six curves, silences at the ends shaded
- Zoom, overview strip, keyboard shortcuts (Space, I, O, arrows)
- Result and original in real time, before processing

## Output

- Five steps in a fixed order: extract audio, trim, normalize (two-pass loudnorm, LUFS or peak), convert (WAV, FLAC, MP3, AAC/M4A, Opus, OGG), name; a sixth, picture, for a video
- Video: rotate, crop by dragging on the picture, rescale, change the frame rate and the speed, fade to black, keep, replace or remove the sound, grab a frame; out as H.264 (MP4), ProRes or HAP (MOV)
- Video by WebCodecs when the browser can, with ffmpeg.wasm as the fallback and for ProRes; HAP, Hap and Hap Q, is made by compositio itself. Says before processing which engine will work and how long it expects it to take
- Shared settings or settings for one file, with a mark on files that have their own
- The checked files are processed, or the one in the editor when none is checked
- Presets, with import and export, and six to start with (WAV, theatre, MP3, H.264, ProRes, HAP); on the start screen, presets as quick actions that process at once
- «Exports»: progress, cancel and retry, and the results, which wait there to be downloaded one by one, checked, or as one zip

## Mix

- Tracks on a strip over the timeline, reordered by dragging or with the keyboard, with their fades drawn on them
- On desktop, files dragged from the list into the strip, where they land
- Play the mix from the files, with a ruler, playhead and zoom
- Overlaps dragged on the strip or set to the tenth of a second; dry cuts
- Listen to about 20 s around a transition before generating the whole mix
- Fade in and out, loudness matching, WAV 24-bit or MP3 320, 44.1 or 48 kHz
- A video mix: the clips' pictures on a common canvas, crossfaded with the sound's time and curve, a monitor and thumbnails on the strip, and H.264, ProRes or HAP out
- Start times as CSV

## Montages

- Save the work with a name, open it later, export and import it as a file
- A montage keeps settings only, never the audio: when reopened, files are paired by name and size

## App

- Installable where the browser offers it; files can be shared to it on Android
- «Try an example» with three sample tracks
- About, with the licences and the code of compositio, ffmpeg.wasm and FFmpeg, and a button that copies the technical details for an issue

![compositio on desktop, light theme: the file list, the editor with the waveform of the active file, the mix strip with five tracks and their fades under its ruler and playhead, and the output steps](docs/guide/img/compositio-desktop.png)

## Limits

ffmpeg.wasm is WebAssembly in the browser:
- 2 GB per input file
- 10 to 100 times slower than native ffmpeg; at 1080p it does not keep up with real time, which is why WebCodecs makes the video wherever it exists (not in Firefox on Android)
- What ffmpeg.wasm makes is held in memory until it is downloaded; what WebCodecs and HAP make is written to the browser's disk space as it goes
- Results are downloads; originals are never overwritten

## Look

Dark and light themes that follow the system, Spanish and English, and layouts for phone, tablet and desktop. Works offline after the first visit.

## Browsers

The tests run in Firefox. Limits by browser: [docs/guide/browsers.md](docs/guide/browsers.md).

## Stack

Preact, Vite and TypeScript; ffmpeg.wasm with ffmpeg 5.1.4; Mediabunny for WebCodecs; SortableJS; client-zip. pnpm.

## Scripts

```bash
pnpm dev         # development server
pnpm test        # unit tests (vitest)
pnpm build       # production build
pnpm e2e         # end-to-end tests in Firefox (after build)
pnpm lint        # eslint
```

The screenshots of the [guide](docs/guide/README.md) come from `node scripts/screenshots.mjs`, against `pnpm preview` on port 4174. The reasons behind the decisions are in [docs/design](docs/design).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

GPL-3.0-only. See [LICENSE](LICENSE). ffmpeg.wasm (`@ffmpeg/core`, `@ffmpeg/core-mt`) is GPL-2.0-or-later. Mediabunny is MPL-2.0, which allows it inside a GPL-3.0 program; its code is at https://github.com/Vanilagy/mediabunny.

## Credits

Developed by [@memoriainfinita](https://github.com/memoriainfinita) with the assistance of Claude (Anthropic).
