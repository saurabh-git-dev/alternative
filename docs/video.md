# Video tools

The Video section at `video/` (live: <https://saurabh-git-dev.github.io/alternative/video/>)
trims, crops, blurs, rotates, compresses, resizes and converts videos, makes
GIFs, extracts audio and saves frames. Like everything else here, it runs in
the browser: videos are never uploaded.

| Tool | What it does | Re-encodes? |
|---|---|---|
| Trim video | Keep the part between two points on the timeline | Exact: yes. Fast: no (cuts on key frames) |
| Crop video | Keep part of the frame, with 16:9, 9:16, 1:1, 4:5, 4:3 | Yes |
| Blur or hide area | Blur, pixelate or cover boxes, each for the whole video or a time span | Yes |
| Rotate or flip video | 90°, 180°, mirror, upside down | Rotation alone in MP4/MOV: no (stored as a flag) |
| Compress video | Quality steps or a target file size, plus a resolution and frame-rate cap | Yes; keeps the original if it isn't smaller |
| Resize video | 2160p down to 240p (shorter side), never enlarges | Yes |
| Convert video | MP4, WebM or MOV, from almost anything (AVI, MKV, WMV, FLV, MPEG, TS …) | Only when the new format can't hold the original codec |
| Remove audio | Drop the sound track | No |
| Video to GIF | A clip of up to 30 s, 8–20 fps, 320–800 px wide | n/a |
| Extract audio | MP3, M4A (AAC), WAV or Ogg (Opus) | Audio only |
| Save a frame | One moment as PNG or JPG at full resolution | n/a |

## How it fits in the app

`video/index.html` is another page of the same app (see `src/ui/section.ts`
and [it-tools.md](it-tools.md)). Video tools are ordinary actions
(`src/actions/video/`), so they use the shared tool page, settings panel,
presets, remembered settings, results, and sharing: results go to a phone as
a QR code when tiny, otherwise over the direct, end-to-end encrypted
connection. They're listed in `VIDEO_ACTIONS`, apart from `ACTIONS`, so the
PDF & image home page and pipelines don't show them.

Tools that work on the picture (Trim, Crop, Blur, Save a frame, GIF) get a
player in the workspace (`src/ui/components/VideoWorkspace.svelte`) with the
matching editor: a trim timeline, a crop box, mask boxes with time spans, or
a frame picker. Space plays and pauses, ← → step one frame (Shift: one
second), Delete removes the selected box.

## Engines

Every tool describes its work as a `VideoJob` (`src/core/video.ts`): trim,
crop, rotate, flip, resize, frame rate, masks, quality or bitrate, sound, and
whether the video may be copied instead of re-encoded. Two engines can run a
job:

1. **WebCodecs via [Mediabunny](https://mediabunny.dev)** (`src/engines/video.ts`),
   tried first. It uses the browser's own encoders and decoders, usually in
   hardware, so it's fast and needs no download. Masks are drawn on each
   frame with a canvas (`src/engines/video-effects.ts`).
2. **[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)** (`src/engines/ffmpeg.ts`),
   the single-threaded core (32 MB, downloaded once, then cached). Used when
   WebCodecs can't read the container (AVI, WMV, FLV, MPEG …), can't decode
   or encode a track (for example no H.264 encoder in some Linux builds, no
   AAC encoder in Firefox), or doesn't exist in the browser. The command line
   for a job comes from `ffmpegArgs` in `src/core/video.ts`, which is
   unit-tested.

The switch is automatic: Mediabunny throws `NeedsFallback` instead of
silently dropping a track, and `withFallback` retries with ffmpeg. Both run
in the job worker, so Cancel stops either instantly.

Defaults and why:

- **Output format**: the input's (MP4, WebM, MOV), anything else becomes MP4,
  the format that plays everywhere. MP4 always gets H.264 (or HEVC), never
  VP9-in-MP4, because Apple apps can't play that; without an H.264 encoder
  the job goes to ffmpeg's x264.
- **Quality**: bits per pixel per frame for each step (`bitrateFor`), so
  "Good" means the same thing for a 720p and a 4K video. VP9, AV1 and HEVC
  get 30% less than H.264 for the same look. ffmpeg uses CRF 20–35 instead.
- **Compress**: "Recommended" caps at 1080p and keeps the frame rate.
  "Target size" sets the bitrate from the length, leaving room for 128 kbps
  audio; targets under about 100 kbps of video are refused.
- **Blur**: shrinks the area and enlarges it smoothly instead of using
  `ctx.filter`, which Safari's canvas lacks; the result looks the same in
  every browser and the detail is really gone.

## Phones

Everything works on phones. Videos are processed in the tab's memory, so
tools that re-encode warn on phones and low-memory computers that long or 4K
clips (roughly over 200 MB) may fail. Phone browsers have WebCodecs (Safari
16.4+, Chrome), so most jobs never need ffmpeg.wasm there.

## Adding a video tool

1. Create `src/actions/video/<name>.ts` exporting an `ActionDefinition` with
   `category: 'video-edit' | 'video-convert' | 'video-export'` and
   `accepts: VIDEO_ACCEPTS`.
2. In `run`, build a `VideoJob` and `return [await runJob(file, job, ctx, '-suffix')]`.
   For something a job can't express, add a function to both engines and
   call it through `withFallback` (see `gif.ts`).
3. Add it to `VIDEO_ACTIONS` in `src/actions/index.ts`.
