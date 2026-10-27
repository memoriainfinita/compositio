# Limits by browser

## Every browser

ffmpeg.wasm runs ffmpeg 5.1.4 compiled to WebAssembly:
- 2 GB at most per file (32-bit WebAssembly); larger files are not added
- 10 to 100 times slower than native ffmpeg
- The result is held in memory until it is downloaded: a long mix in WAV may not fit, and the app warns above 1 GiB
- The ffmpeg core (about 31 MB) downloads on the first visit and stays cached for offline use

## Tested

| Browser | State |
|---|---|
| Firefox 155, desktop | Automatic tests on every change (Playwright) |
| Chrome | Not tested yet |
| Safari on iOS | Not tested yet |
| Firefox and Chrome on Android | Not tested yet |

## Known differences

| | Firefox | Chrome | Safari on iOS |
|---|---|---|---|
| Multithreading (for video) | Yes, after reloading once on the first visit | Yes on desktop (Chromium 152) | [PENDING: test] |
| Saving | Downloads only | Downloads (a save dialog exists, unused) | Downloads behave differently |
| Install as an app | No install offer | Install offer on the start screen [PENDING: test] | No install offer |
| Share files to compositio | [PENDING: test on Android] | Android, once installed [PENDING: test] | No |
| Screen kept on while processing | Yes (Firefox 155) | [PENDING: test] | [PENDING: test] |

Safari on iOS has less memory for the page than desktop browsers.
