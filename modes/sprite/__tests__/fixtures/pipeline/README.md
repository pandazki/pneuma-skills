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
(`docs/proposals/2026-09-09-sprite-mode-design.md`, "Canonical fixture"),
byte-identical to `../mini/project.json` but for one deliberate difference:

**Timestamps.** The canonical fixture stamps the frames, the atlas and the GIF
at three different times. They are produced by one `register-run` invocation,
so they share its `--at` value.

Everything else matches, `params.inputs` included: the fan-in rule is that a
derive edge with two or more inputs (`pack`, `gif`, an `r2v` or `first-last`
video) names its first input as `fromAssetId` and lists the whole set in
`operation.params.inputs`, while a single-parent edge (`atlas <- sheet`, a
sheet generated from one ref) carries no `inputs` key at all.
