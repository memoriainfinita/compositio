# Batches

Trim, normalize and convert many files with the same settings, and name them as you like.

## The five steps

«Output» has five steps, in order. They apply to every checked file.

1. **Extract audio:** choose the audio track, and re-encode it or copy it without re-encoding. Copying applies no fades or normalizing, and the app says so
2. **Trim:** use the in and out points set in the editor; optionally remove the silence at the ends, or cut without re-encoding (MP3 and AAC)
3. **Normalize:** to a loudness (LUFS, with the maximum true peak and loudness range) or to a peak. The file is measured first and then adjusted
4. **Convert:** format, sample rate, bits (with dither or 32-bit float for WAV), channels, MP3 constant or variable bitrate, quality for OGG, and keeping the metadata
5. **Name:** a pattern with the original name, the position among the processed files, and the title or artist from the metadata

The app warns, in the step it concerns, about what will not do what you may expect: going from one lossy format to another loses quality, fades that do not fit in the cut are shortened, a sample rate the format does not allow is replaced by the nearest one.

## Shared settings and one file's own

- «Shared settings» apply to every file
- «This file only» gives the file in the editor its own values; a dot in the list marks the files that have their own, and each own value can go back to the shared one
- Trim points and fades are always the file's own

## Presets

- A preset replaces the shared settings. Three come ready: WAV 48 kHz 24-bit, Theatre (WAV 48 kHz, -14 LUFS) and MP3 320
- Save the current shared settings with a name; presets can be renamed, deleted, exported and imported
- On the start page, a preset button under «Process with» adds the files you choose with it, or drop on it, and processes them at once

## Process and download

- «Process N checked» sends the files to the queue, which works one at a time; the order is the one of the list
- Results wait in «Exports», which opens when a job ends, with them checked. «Download checked» downloads them, file by file or with «As one zip»
- Each result also has its own «Download» and «Remove». Jobs under way can be cancelled and retried
- Results are kept while the page stays open

On phones, several downloads always go as one zip: the browser keeps only the first of several downloads in a row.
