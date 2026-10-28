# Using compositio

Everything happens in the browser: files are read where they are and never uploaded. Results are new files in the downloads; originals are never touched.

## 1. Add files

- Drop audio or video files, or a folder, anywhere on the page; or press «Choose files»
- On a phone, the system picker is the way in; on Android, files can also be shared to compositio once it is installed
- «Try an example» adds three sample tracks
- Each new file is analysed in the background: format, duration, the silence at its ends (-60 dBFS) and its waveform; the editor shows its technical line, with the bitrate of lossy files. The file you open has its waveform first
- The checkbox of a file marks it for processing and for the mix; the file you press opens in the editor

## 2. Edit a file

- Drag the in and out handles, or type the times (`m:ss.mmm`)
- The handles at the top corners of the region set the fades; each fade has a curve
- Space plays and stops; I and O set in and out at the playhead; arrows move the playhead, a handle or the whole region
- Ctrl+wheel zooms, Shift+wheel scrolls; the strip under the waveform moves the view
- «Result», heard by default, plays the file as it will come out (trim, fades, normalizing); «Original» plays it as it is
- What you edit belongs to the file: it counts the same when the file is processed alone or inside the mix

## 3. Process

- «Output» has five steps, in order: extract audio, trim, normalize, convert, name
- «Shared settings» apply to every file; «This file only» gives the active file its own values, marked in the list
- «Process N checked» processes the checked files; with none checked, «Process this file» processes the one in the editor
- A preset replaces the shared settings; presets can be saved, renamed, exported and imported. On the start page, a preset button under «Process with» adds the files chosen with it or dropped on it and processes them at once
- Nothing downloads by itself: results wait in «Exports», which opens when a job ends, with them checked. «Download checked» downloads them, file by file or with «As one zip»; on phones several always go as one zip, since the browser keeps only the first of several downloads in a row. Each result also has its own «Download» and «Remove»
- «Exports» is the bar at the bottom on desktop and tablet, and a tab on phones; it also shows the progress of the jobs under way, which can be cancelled and retried. Results are kept while the page stays open

## 4. Mix

- «Add selection» puts the checked files at the end of the mix
- On desktop, drag a file from the list to the strip and it goes in where it lands; a checked file brings all the checked ones
- Drag a track to reorder it, or press Alt+arrows on it; Delete takes it out
- Drag the overlap at the start of a track to change its crossfade, or use the arrows on it; press it to open the transition
- The transition popup sets duration, curve and dry cut, and «Listen» plays about 20 s around the cross
- «Play the mix» plays it from the files with its fades, crossfades and loudness matching; changes are heard while it plays. Space plays and pauses anywhere in the mix but a field. Sample rate and MP3 are only heard in the generated mix
- The ruler over the strip moves the playhead: press or drag on it, or use the arrows (5 s, Shift 30 s), Home and End
- Zoom the strip with its buttons, Ctrl and the wheel, or two fingers on the ruler; on phones a position slider takes its place
- Each track shows its own fades and the mix's fades as ramps over it
- Below the strip: default crossfade, fade in and out of the whole mix, loudness matching with its target, WAV or MP3, 44.1 or 48 kHz
- «Times CSV» saves the start of each track; «Generate mix» makes the mix, which waits in «Exports»

## 5. Montages

- «Save montage» keeps the work with a name: files by name and size, their edits, the mix and the shared settings. No audio is stored
- «Open montage» lists the saved ones; opening one can be undone with Ctrl+Z
- When a montage opens without its files, it lists the missing ones: add them and they are paired, or open without them
- Montages export and import as `.compositio.json` files, to move them to another browser or device

## Undo and saving

- Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) undo and redo edits, order, settings and openings, up to 200 steps
- The work in progress is saved in the browser as you go; reopening the page brings it back, with its files listed as missing until they are added again

## Problems

- «About» › «Copy details» copies what is needed to report a problem; «Open an issue» goes to the repository
- Limits of each browser: [browsers.md](browsers.md)
