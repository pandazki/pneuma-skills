# pipeline fixtures

Inputs for `sprite-sheet.test.ts` and `sprite-project.test.ts`.

- `make-sheet.mjs` — draws every sprite sheet the suites need with ffmpeg at
  test time, so no binary blobs live in the repo. Also carries `readBbox`,
  the tests' independent decoder (they never trust the script under test to
  report its own pixels).
- `bounce-run.json` — a hand-written `sprite-sheet.mjs run` summary with
  workspace-relative paths, fed to `sprite-project.mjs register-run`. Its
  `inspect` block is the canonical fixture's, not a real measurement. It
  carries the `cells` key a real run emits, which `register-run` must ignore:
  the pre-align cells are intermediate files, not assets.
- `expected-project.json` — the whole `project.json` the command sequence
  `init → add-ref → add-motion → set-sheet → register-run` must produce.

`expected-project.json` is the design spec's canonical `mini` fixture
(`docs/proposals/2026-09-09-sprite-mode-design.md`, "Canonical fixture") with
two deliberate differences:

1. **`params.inputs` on the `pack` and `gif` derive edges.** The spec states
   the fan-in rule twice — "Derive edges for a multi-input step (`pack`,
   `gif`, `r2v` video) use the first input as `fromAssetId` and list every
   input id in `operation.params.inputs`" (Shared vocabulary) and "pack/gif
   from frame 00 with `params.inputs` = all frame ids" (TASK-4b) — while the
   illustrative fixture body omits them. Without `inputs` the provenance
   graph cannot answer "which frames produced this atlas?", so the normative
   rule wins. `inputs` is emitted only for genuine fan-in (two or more
   inputs); a single input is fully described by `fromAssetId`, which is why
   the `set-sheet` and `atlas` edges match the canonical fixture verbatim.
2. **Timestamps.** The canonical fixture stamps the frames, the atlas and the
   GIF at three different times. They are produced by one `register-run`
   invocation, so they share its `--at` value. TASK-4c excludes timestamps
   from the byte-for-byte comparison for exactly this reason.
