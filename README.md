# compositio

Prepare audio and video for live shows in the browser: continuous mixes, trimming, normalizing, converting, batch processing. Everything runs on your device with [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm); no file leaves it.

**Status:** in development. Nothing usable yet.

Planned for the first version: continuous mixes (crossfades between tracks), trim with fades, loudness normalization, format conversion and audio extraction from video, on one file or in batches. Works on desktop and mobile, installable, offline after the first visit.

## Limits

ffmpeg.wasm is WebAssembly in the browser:
- 2 GB per input file
- 10 to 100 times slower than native ffmpeg
- Results are downloads; originals are never overwritten

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

GPL-3.0-only. See [LICENSE](LICENSE). ffmpeg.wasm (`@ffmpeg/core`, `@ffmpeg/core-mt`) is GPL-2.0-or-later.
