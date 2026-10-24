# IT tools

Developer utilities at `it/` (live: <https://saurabh-git-dev.github.io/alternative/it/>),
in the spirit of [IT-Tools](https://github.com/CorentinTh/it-tools). Like the
PDF and image tools, everything runs in the browser; nothing typed into a
tool is sent anywhere.

## How it fits in the app

`it/index.html` is a second page of the **same** app (`vite.config.ts` builds
both). `src/ui/section.ts` reads the path to decide which section is showing:
the header switch, home page and titles change, every other route stays the
same. So sharing, direct transfers and the QR scanner work identically in
both sections, and the header links each section to the other.

| Route (inside `it/`) | Page |
|---|---|
| `#/` | IT home (`src/ui/it/ItHome.svelte`) |
| `#/<tool id>` | a tool (`src/ui/it/ItTool.svelte`) |
| `#/<tool id>/<state>` | a tool opened with input and options from a link (`src/it/links.ts`) |
| `#/share`, `#/connect`, `#/s/…` … | the shared pages, as in the main section |

## Folders

| Path | What lives there |
|---|---|
| `src/it/types.ts` | the contract: tool metadata, transform specs, options |
| `src/it/registry.ts` | every tool's metadata and a loader; the code loads only when a tool opens |
| `src/it/lib/` | pure logic (hashes, encodings, cron, subnets …), unit-tested in `tests/it-tools.test.ts` |
| `src/it/transforms/` | text-in, text-out tools declared as data |
| `src/ui/it/` | the home page, the tool page, the generic `TransformTool`, shared pieces (`OutputActions`, `CopyButton`, `it.css`) |
| `src/ui/it/tools/` | custom tools that need their own UI (generators, calculators, regex, diff, QR code generator and scanner) |

## Sharing

Where sharing helps, it's built in rather than bolted on:

- **Every output** has Copy, Save and Share. Share is the app-wide menu
  (`src/ui/components/ShareMenu.svelte`): a connected device gets the text
  as a chat message it can copy; "Someone else" connects a new device by QR
  code; small outputs can also go as a QR code and link (a password, a UUID,
  a JWT payload, a Wi-Fi QR).
- **Copy link to this** packs a transform's input and options into the link
  itself (deflate + base64url in the fragment), so a colleague opens the same
  tool with the same JSON, cron line or URL. Tools whose input may be secret
  (JWT, HMAC, Encrypt) don't offer it, and password/key options are never put
  in links or remembered.
- **Encrypt text** locks text with a password (AES-256-GCM, PBKDF2) before it
  goes into a QR code or chat.
- **Received share links** with text suggest IT tools: Decrypt for text from
  Encrypt text, Format JSON, JSON → YAML/CSV, CSV → JSON, Decode JWT, Base64
  decode (`src/it/suggest.ts`).

## Adding a tool

Most tools are transforms: text in, text out.

1. Write the logic as pure functions in `src/it/lib/` and test them.
2. Declare the transform in a `src/it/transforms/*.ts` module:

   ```ts
   export const reverse: TransformSpec = {
     input: { sample: 'Hello' },
     options: { words: { kind: 'toggle', label: 'Reverse word order only', default: false } },
     run: (input, o) => (o.words ? input.split(' ').reverse().join(' ') : [...input].reverse().join('')),
     output: { name: 'reversed' },
   };
   ```

   `run` may be async, may return rows (`{ label, value }[]`, each with its
   own copy button), and should throw an `Error` with a friendly message for
   bad input. For two-way tools, add a `choice` option with values
   `encode`/`decode` and name it in `direction`: it's drawn as a switch and
   the output gets a Swap button. Set `sensitive: true` if the input can hold
   secrets, and `secret: true` on password or key options.
3. Add one line to `IT_TOOLS` in `src/it/registry.ts` with
   `load: transform(<module>, '<export>')`. Ids must not clash with app
   routes (a test checks).

For a custom tool, write a component in `src/ui/it/tools/` that takes
`ItToolProps` (`initial` is text handed over by a link), lay it out with the
`it-panes` / `it-pane` classes from `it.css`, give outputs an
`<OutputActions>` so they can be shared, and register it with
`load: () => import('../ui/it/tools/Name.svelte')`.

The test "every transform runs its own example" runs each transform's
`sample`, so a new transform gets a smoke test for free.
