# Architecture

```
UI (Svelte)                      Web Worker
───────────                      ──────────
Home ─► Tool page                worker.ts
          ├ Dropzone / FileList    └ getAction(id).run(files, params, ctx)
          ├ ParamPanel (generated        └ await import('../engines/…')  ← lazy
          │   from action.params)            ├ qpdf.ts        (WASM)
          ├ Run ── runner.ts ──Comlink──►    ├ mupdf.ts       (WASM)
          └ Results                          ├ ghostscript.ts (WASM)
                                             ├ image.ts       (jSquash WASM)
                                             └ pdflib.ts      (JS)
```

## Folders

| Path | What lives there |
|---|---|
| `src/core/types.ts` | `ActionDefinition`, parameter specs, presets: the contract every tool follows |
| `src/core/params.ts` | defaults, presets, validation |
| `src/core/ranges.ts` | page-range parser shared by PDF tools |
| `src/core/files.ts` | MIME detection, naming, ZIP, downloads |
| `src/core/runner.ts` | main-thread job API: progress, cancel, previews |
| `src/core/worker.ts` | worker entry; runs actions and renders thumbnails |
| `src/engines/` | one thin wrapper per engine; the only place engine APIs are called |
| `src/actions/` | one file per tool, plus `index.ts` (the registry) |
| `src/ui/` | Svelte components; nothing tool-specific |
| `tests/` | Vitest unit tests |

## Key decisions

- **Actions are data + one function.** The UI never knows about a specific
  tool. It renders controls from `params`, presets from `presets`, and calls
  `run` in a worker. Adding a tool is one new file.
- **Simple first, flexible on demand.** Parameters marked `advanced` go into a
  collapsed drawer. Presets set several parameters at once; the panel shows
  "Custom settings" when values no longer match a preset.
- **Everything heavy runs in a worker.** Jobs get their own worker so Cancel
  can terminate it instantly. Thumbnails use a separate long-lived worker so
  previews never wait behind a job.
- **Lazy engines.** Actions `await import()` engines inside `run`, so opening
  Merge never downloads Ghostscript.
- **Quality guards.** Compress tools return the original when the "compressed"
  result would be larger, with a note explaining why.
- **Zero-copy transfers.** File bytes move to and from workers as transferred
  `ArrayBuffer`s.
