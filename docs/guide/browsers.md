# Limits by browser

## Every browser

ffmpeg.wasm runs ffmpeg 5.1.4 compiled to WebAssembly:
- 2 GB at most per file (32-bit WebAssembly); larger files are not added
- 10 to 100 times slower than native ffmpeg
- What ffmpeg.wasm makes is held in memory until it is downloaded: a long mix in WAV may not fit, and the app warns above 1 GiB. What WebCodecs and HAP make is written to the browser's disk space as it goes (see Video below)
- The ffmpeg core (about 31 MB) downloads on the first visit and stays cached for offline use

## Video

Three engines make video; the app picks one and says which before processing.

| | Firefox 155, desktop | Chrome 156, desktop | Chrome 156, Android | Firefox 158, Android |
|---|---|---|---|---|
| H.264 (MP4) | WebCodecs, in software | WebCodecs, by hardware or in software | WebCodecs | ffmpeg.wasm: the browser has no video encoder or decoder |
| ProRes (MOV) | ffmpeg.wasm | ffmpeg.wasm | ffmpeg.wasm | ffmpeg.wasm |
| HAP (MOV) | Yes | Yes | Not measured | No: it needs the browser to decode the video |
| Where the result is kept | Disk space (WebCodecs, HAP), memory (ffmpeg.wasm) | Same | Same | Memory |

What was measured:
- On the Xiaomi phone with Chrome, a mix of three 1080p clips took 27.8 s with WebCodecs. ffmpeg.wasm had not finished after 480 s
- 1080p H.264 with WebCodecs runs at about 1.4 times real time; with ffmpeg.wasm, at 0.4 to 0.7 times
- HAP files made in Firefox and in Chrome are read by native ffmpeg as `hap`, with the picture and the sound, for Hap and for Hap Q

What was not checked:
- Dragging the crop on the picture with a finger on a real phone
- Firefox on Android for anything beyond H.264 through ffmpeg.wasm
- HAP in a player or media server: the first encoder was checked with Hap and without sound in one; the sound and Hap Q have not been played
- How fast HAP is on a phone

## Tested

| Browser | State |
|---|---|
| Firefox 155, desktop | Automatic tests on every change (Playwright) |
| Chrome 156, desktop | The Playwright suite run by hand once (2026-10-28): 55 of 57 pass; the other two assume Firefox (the page reloads once on the first visit, and the dark theme is forced). The WebCodecs and HAP tests run in Chrome as their own project |
| Safari on iOS | Checked by hand by the author (2026-10-28) |
| Firefox 158, Android 15 (Xiaomi) | The engine checks of step 1, and processing and downloading in the app, by hand |
| Chrome on Android | Checked by hand by the author (2026-10-28); video by WebCodecs measured on the Xiaomi phone |

## Known differences

| | Firefox | Chrome | Safari on iOS |
|---|---|---|---|
| Multithreading (for video) | Yes, after reloading once on the first visit; also on Android | Yes on desktop (Chromium 152, Chrome 156) | Not checked separately |
| Saving | Downloads only; on Android each asks to be confirmed, and of a batch downloaded file by file only the first arrives: the zip arrives whole, and the queue downloads the others one by one | Downloads (a save dialog exists, unused) | Downloads behave differently |
| Install as an app | No install offer | Install offer on the start screen | No install offer |
| Share files to compositio | Not checked | Android, once installed | No |
| Screen kept on while processing | Yes (Firefox 155; Firefox 158 on Android) | Works (checked by hand) | Works (checked by hand) |

Safari on iOS has less memory for the page than desktop browsers.
