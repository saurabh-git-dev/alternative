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

Any parameter can set `advanced: true` (goes in the drawer), `help` (hint
text) and `visibleWhen: (values) => boolean`.

## Guidelines

- Pick defaults a non-technical person would want, and say why in a comment.
- Labels in plain language ("Remove hidden metadata", not "Strip XMP").
- Throw `Error`s with messages a user can act on ("Unlock it first").
- Never return a worse file than the input when the tool's goal is "smaller".
