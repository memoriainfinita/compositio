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
| Chrome 156, desktop | The Playwright suite run by hand once (2026-10-28): 55 of 57 pass; the other two assume Firefox (the page reloads once on the first visit, and the dark theme is forced) |
| Safari on iOS | Checked by hand by the author (2026-10-28) |
| Firefox 158, Android 15 (Xiaomi) | The engine checks of step 1, and processing and downloading in the app, by hand |
| Chrome on Android | Checked by hand by the author (2026-10-28) |

## Known differences

| | Firefox | Chrome | Safari on iOS |
|---|---|---|---|
| Multithreading (for video) | Yes, after reloading once on the first visit; also on Android | Yes on desktop (Chromium 152, Chrome 156) | Not checked separately |
| Saving | Downloads only; on Android each asks to be confirmed, and of a batch downloaded file by file only the first arrives: the zip arrives whole, and the queue downloads the others one by one | Downloads (a save dialog exists, unused) | Downloads behave differently |
| Install as an app | No install offer | Install offer on the start screen | No install offer |
| Share files to compositio | Not checked | Android, once installed | No |
| Screen kept on while processing | Yes (Firefox 155; Firefox 158 on Android) | Works (checked by hand) | Works (checked by hand) |

Safari on iOS has less memory for the page than desktop browsers.
