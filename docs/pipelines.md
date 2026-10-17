# Pipelines

`#/pipeline` chains tools: each step runs on the files the previous step
produced, e.g. *Images to PDF → OCR PDF → Compress PDF*.

Code: `src/core/pipeline.ts` (model, type planning, runner, link encoding,
recipes; unit-tested in `tests/pipeline.test.ts`) and
`src/ui/pages/Pipeline.svelte`. Saved pipelines live in localStorage
(`src/ui/settings.ts`) and appear on the home page under **Automate**.

## How steps fit together

Every action declares what it accepts. For what it *returns*, an action can
implement `produces(inputType, params)`; without it, PDF tools return their
input type and image tools return the same format when the codecs can
encode it (else PNG). `planTypes` walks those types through the steps, so
the builder disables steps that can't take the previous output and flags
any that break when steps are reordered.

`all`-mode tools (Merge PDF, Images to PDF) combine every file arriving at
that step into one. `each`-mode tools keep track of which original file
each output came from, so the results page still shows before/after sizes.

## What can't be a step

Tools whose main parameter is edited on the document itself (`pageOrder`,
`crop`, `regions`, `signature`, `formFields`) need a person per file, so
they are left out.

## Links and passwords

**Copy link** puts the pipeline (tool ids and settings, no files) in
`#/pipeline/<base64url JSON>`. Passwords are removed from links and from
saved pipelines; a step that needs one asks for it before running.
Settings added to a tool later are filled with their defaults when an older
pipeline is opened.

## Adding a recipe

Append to `RECIPES` in `src/core/pipeline.ts`: a name, a one-line
description, and the action ids, with any parameter overrides.
