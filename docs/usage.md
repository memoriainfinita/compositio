# Using compositio

Everything happens in the browser: files are read where they are and never uploaded. Results are new files in the downloads; originals are never touched.

## 1. Add files

- Drop audio or video files, or a folder, anywhere on the page; or press «Choose files»
- On a phone, the system picker is the way in; on Android, files can also be shared to compositio once it is installed
- «Try an example» adds three sample tracks
- Each new file is analysed in the background: format, duration, and the silence at its ends (-60 dBFS)
- The checkbox of a file puts it in the batch; the file you press opens in the editor

## 2. Edit a file

- Drag the in and out handles, or type the times (`m:ss.mmm`)
- The handles at the top corners of the region set the fades; each fade has a curve
- Space plays and stops; I and O set in and out at the playhead; arrows move the playhead, a handle or the whole region
- Ctrl+wheel zooms, Shift+wheel scrolls; the strip under the waveform moves the view
- A/B switches between the original and how the result will sound (fades, trim, normalizing)
- What you edit belongs to the file: it counts the same when the file is processed alone or inside the mix

## 3. Process

- «Output» has five steps, in order: extract audio, trim, normalize, convert, name and download
- «Batch» changes the settings of every file; «This file» gives the active file its own values, marked in the list
- «Process N» processes the files in the batch. One file downloads directly; several download one by one or as a zip (step 5)
- A preset replaces the batch settings; presets can be saved, renamed, exported and imported. A preset button processes the selection with it at once, and takes files dropped on it
- The queue at the bottom shows progress; its popup cancels, retries and downloads

## 4. Mix

- «Add selection» puts the batch files at the end of the mix
- Drag a track to reorder it, or press Alt+arrows on it; Delete takes it out
- Drag the overlap at the start of a track to change its crossfade, or use the arrows on it; press it to open the transition
- The transition popup sets duration, curve and dry cut, and «Listen» plays about 20 s around the cross
- Below the strip: default crossfade, fade in and out of the whole mix, loudness matching with its target, WAV or MP3, 44.1 or 48 kHz
- «Times CSV» saves the start of each track; «Generate mix» downloads the mix

## 5. Montages

- «Save montage» keeps the work with a name: files by name and size, their edits, the mix and the batch settings. No audio is stored
- «Open montage» lists the saved ones; opening one can be undone with Ctrl+Z
- When a montage opens without its files, it lists the missing ones: add them and they are paired, or open without them
- Montages export and import as `.compositio.json` files, to move them to another browser or device

## Undo and saving

- Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) undo and redo edits, order, settings and openings, up to 200 steps
- The work in progress is saved in the browser as you go; reopening the page brings it back, with its files listed as missing until they are added again

## Problems

- «About» › «Copy details» copies what is needed to report a problem; «Open an issue» goes to the repository
- Limits of each browser: [browsers.md](browsers.md)
