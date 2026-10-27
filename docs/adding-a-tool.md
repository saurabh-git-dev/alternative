# Adding a tool

1. **Create the action** in `src/actions/<pdf|image>/<name>.ts`:

```ts
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';

/**
 * Grayscale PDF: remove colour.
 * Engine: Ghostscript (re-distils with a gray colour model).
 */
export const grayscalePdf: ActionDefinition = {
  id: 'pdf.grayscale',
  title: 'Grayscale PDF',
  description: 'Convert a colour PDF to black and white.',
  category: 'pdf-optimize',
  icon: '◐',
  accepts: ['application/pdf'],
  mode: 'each',              // 'each' = batch-friendly; 'all' = one run with every file
  verb: 'Convert',
  engines: ['ghostscript'],
  params: {
    quality: {
      kind: 'enum',
      label: 'Quality',
      default: 'high',
      options: [
        { value: 'high', label: 'High' },
        { value: 'small', label: 'Smaller file' },
      ],
    },
  },
  async run([file], params, ctx) {
    const { runGhostscript } = await import('../../engines/ghostscript'); // lazy!
    ctx.progress(0.1, 'Converting');
    const bytes = await runGhostscript(file.bytes, ['-sDEVICE=pdfwrite', '-sColorConversionStrategy=Gray']);
    return [{ name: `${baseName(file.name)}-gray.pdf`, type: 'application/pdf', bytes }];
  },
};
```

2. **Register it** in `src/actions/index.ts` (import + add to `ACTIONS`).

3. **Test it**: add a case to `tests/` if the logic is pure JS; otherwise try
   it with `npm run dev`.

## Parameter kinds

| kind | Renders as | Notes |
|---|---|---|
| `enum` | segmented buttons (≤4 options) or dropdown | `display: 'select'` forces a dropdown; option `hint`s show under the control |
| `number` | slider, or number box with `display: 'input'` | `min`, `max`, `step`, `unit` |
| `boolean` | switch | |
| `text` | text box | `secret` for passwords (never saved), `validate` for errors |
| `color` | colour picker | `#rrggbb` |
| `position` | 3×3 grid | `top-left` … `bottom-right` |
| `pageOrder` | thumbnail page editor | value is `{ page, rotate }[]` |
| `crop` | crop box on the first image, or over the player for videos | value is a `Box` in fractions (0–1) |
| `regions` | boxes drawn on PDF pages | value is `PageBox[]` (fractions, top-left origin) |
| `signature` | signature pad + placement on pages | value is `{ image, placements }` |
| `formFields` | the PDF's own form fields | value is `{ [fieldName]: string \| boolean }` |
| `annotations` | annotation tools drawn on PDF pages | value is `Annotation[]` |
| `textEdits` | the page's own text, clickable to edit, plus new text | value is the changed lines only, `TextItem[]` |
| `timeRange` | video player with a trim timeline | value is `{ start, end }` in seconds (`end` 0 = to the end); `initialLength`, `maxLength` |
| `videoTime` | video player to pick a moment | value is seconds |
| `masks` | boxes drawn over the video, each with a time span | value is `MaskBox[]`; `preview` makes the boxes show the chosen effect |

The kinds from `pageOrder` down are *workspace* kinds: they render in the main area instead of
the settings panel, reset when a new file is loaded, and are never
remembered. A tool has at most one.

## Optional hooks

- `inspect(file)`: return values to prefill from the first file (e.g. Edit
  metadata shows the current title). Runs in the preview worker.
- `livePreview: true`: image tools get a live preview of the first image,
  re-rendered on a downscaled copy whenever a setting changes.
- `produces(inputType, params)`: the MIME type `run` returns, when it differs
  from the input (e.g. PDF → JPG). Pipelines use it to check that steps fit
  together; see [Pipelines](pipelines.md).

Any parameter can set `advanced: true` (goes in the drawer), `help` (hint
text) and `visibleWhen: (values) => boolean`.

## Guidelines

- Pick defaults a non-technical person would want, and say why in a comment.
- Labels in plain language ("Remove hidden metadata", not "Strip XMP").
- Throw `Error`s with messages a user can act on ("Unlock it first").
- Never return a worse file than the input when the tool's goal is "smaller".

## Video tools

Video tools are actions too, registered in `VIDEO_ACTIONS` (not `ACTIONS`)
so they show in the Video section rather than on the PDF & image home page.
Describe the work as a `VideoJob` and call `runJob` from
`src/actions/video/shared.ts`; it picks WebCodecs or ffmpeg.wasm. See
[video.md](video.md).

