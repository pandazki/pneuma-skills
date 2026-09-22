# pipeline fixtures

Inputs for `sprite-sheet.test.ts` and `sprite-project.test.ts`.

- `make-sheet.mjs` — draws every sprite sheet and clip the suites need with
  ffmpeg at test time, so no binary blobs live in the repo. Also carries
  `readBbox`, the tests' independent decoder (they never trust the script
  under test to report its own pixels).
  - `buildSheet` / `buildClip` — the sheet grid and the breathing clip the
    sampling commands are pinned on.
  - `buildExprClip` — a clip whose box position is any expression in `t`, and
    whose codec may be ProRes 4444 (a clip that carries its own alpha). The
    loop cases use it for a named frame count, a frozen tail, a motion that
    never returns, and a matted source.
  - `clipFrameDeltas` — max |Δ| between consecutive frames. Any fixture that
    argues "every frame is different" is measured with this before anything is
    asserted on it; `drawbox` evaluates its `x`/`y` once at config time, so a
    "moving" drawbox fixture is a still image with a duration.
  - `alphaColorAudit` / `edgeLuma` — what survives under the transparency, and
    how bright the partially transparent edge is. The second is what tells a
    premultiplied resize from a straight-alpha one: a white subject scaled in
    straight alpha comes back with a grey rim.
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
