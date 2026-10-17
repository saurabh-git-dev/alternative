# Screen recorder

A Loom-style recorder at `record/` (live: <https://saurabh-git-dev.github.io/alternative/record/>).
It records the screen, the camera or both, with the microphone and/or the
computer's sound, and keeps every recording in the browser to watch, rename,
share, download, edit or delete later. Nothing is uploaded.

## Recording

`src/core/recorder.ts` wraps the browser's MediaRecorder:

- **Screen + camera** shares the screen and shows the camera in a round bubble
  that floats above every window (`src/ui/record/bubble.ts`: Document
  Picture-in-Picture in Chrome and Edge, classic video Picture-in-Picture
  elsewhere). Share the *entire screen* and the bubble is part of the
  recording. Drawing the camera into the video ourselves would need a canvas
  redrawn every frame, which browsers pause while the tab is in the
  background, which is exactly when you're recording another window.
- **Screen** or **Camera** alone.
- **Microphone** (echo cancellation and noise suppression on) and **computer
  sound** (Chrome and Edge: a tab's sound, or the whole system on Windows and
  ChromeOS) are mixed into one track with Web Audio.
- 720p, 1080p (default) or 1440p at up to 30 fps, a 3-second countdown, pause
  and resume, discard. The browser's own "Stop sharing" button ends the
  recording too.
- Format: MP4 (H.264/AAC) where the browser records it (Safari, recent
  Chrome), otherwise WebM (VP9/Opus).

## Storage

`src/core/recordings.ts` keeps recordings in IndexedDB (`tools-recordings`):
a `recordings` store with one entry per recording (title, date, length, size,
thumbnail) and a `chunks` store with the video data keyed by
`[recording id, sequence]`.

- MediaRecorder hands over a chunk every second, and each is written straight
  away, so a closed tab or crash loses at most the last second. The next visit
  marks such recordings **recovered** (`recoverInterrupted`).
- When a recording stops, `src/ui/record/finalize.ts` rewrites WebM files
  without re-encoding (Mediabunny, in a worker) so players know their length
  and can seek, then saves a thumbnail and the exact length.
- The app asks the browser to keep its storage (`navigator.storage.persist()`)
  and shows how much is used. Recordings live only in this browser: clearing
  site data or a private window removes them.

## Library

Each recording can be played, renamed (click its title), downloaded, shared,
edited or deleted (`src/ui/record/RecordingLibrary.svelte`).

- **Share** uses the app's direct connection: scan a QR code with the other
  device and the file goes across end-to-end encrypted, any size
  ([share-links.md](share-links.md)).
- **Edit** opens a video tool (trim, compress, blur, crop, GIF, audio,
  convert) in the Video section with the recording loaded, through the route
  `video/#/tool/<tool>/recording/<id>`. The result is a new file; the
  recording itself stays as it was.

## Phones

Phone browsers can't share their screen, so on phones only Camera is offered,
with a note. Phones also pause recording when the browser goes to the
background, so the page asks to stay open while recording.
