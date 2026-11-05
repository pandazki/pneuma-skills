# Final-artifact candidate comparison

`compare` measures the delivered artifact, independently of `inspect.json`, a frames directory, or a cleanup report. It does not adopt or register a candidate. Inputs remain unchanged. Use a fresh output directory.

```sh
node {SKILL_PATH}/scripts/sprite-sheet.mjs compare baseline.png \
  --candidate candidate.png --out work/compare-png --json
node {SKILL_PATH}/scripts/sprite-sheet.mjs compare baseline/atlas.json \
  --candidate candidate/atlas.json --out work/compare-atlas --json
node {SKILL_PATH}/scripts/sprite-sheet.mjs compare baseline.gif \
  --candidate candidate.gif --out work/compare-gif --json
node {SKILL_PATH}/scripts/sprite-sheet.mjs compare baseline.png \
  --candidate cleaned-copy/baseline.png --out work/compare-cleanup \
  --alpha-clean --max-alpha 15 --keep-edge 2 --json
```

Resolve `{SKILL_PATH}` from the loaded skill directory. The output parent must
exist. A declared cleanup objective is recomputed from the baseline pixels with
the stated parameters; an old cleanup report is never trusted.

Supported inputs are static RGBA8 PNG, the current untrimmed Pneuma TexturePacker JSON hash atlas with one explicit animation, and GIF. Atlas images must remain within the atlas directory, including after symlink resolution. Rectangles, source geometry, ordering, duration, loop semantics, pivot and anchor agreement are validated. Final sheet pixels are read again rather than trusting extracted cells. Animated PNG, 16-bit PNG, other animation formats and inferred GIF delays are refused. No frame, time, size, or canvas normalization takes place.

The JSON report distinguishes `identical`, `comparable`, and `unknown`. It lists changed geometry, timing, loop behavior, pivots, frame order, atlas rectangles and pixels. The report includes both artifact descriptors with actual canvas sizes, durations, loop semantics, pivots, frame labels and rectangles. Geometry or playback differences prevent a direct pixel comparison from establishing equivalence. A PNG has no animation timing. GIF uses each decoded frame's true delay and its embedded repeat count. Missing repeat extensions mean one play.

`artisticQuality` and `improvement` remain `unknown` even when pixels are identical or the alpha cleanup contract is verified. A smaller seam, less movement, or a frozen candidate cannot establish improvement. Human review must assess intent, subject identity, anatomy where applicable, translucency, animation and style.

The optional cleanup objective reports `verified`, `no-op`, `violated` or `unverified`. Verification requires matching geometry, rectangle mapping and playback metadata and exact equality to a fresh cleanup of the baseline. This checks the cleanup algorithm's narrow mechanical pixel contract, including its original-mask protection. It does not infer whether faint pixels were unwanted. An omitted objective is `undeclared`.

Evidence includes `comparison.json`, tiled `baseline.png` and `candidate.png`,
and `difference.png` when frame geometry matches. Each tile fits within 256 by
256 pixels without enlargement, with at most eight columns and 64 sampled
frames spread across the animation. The report maps each tile to its original
frame index, preview rectangle and source dimensions. Preview sampling uses
nearest neighbours; all measurements and hashes use full-resolution pixels.
Difference RGB is the maximum of each RGB-channel difference and the alpha
difference, with opaque output alpha. A nonzero alpha difference has a display
floor of 64 so faint changes remain visible. Alpha-only changes to black pixels are
therefore visible. Small changes can remain faint, so read the numeric report
and examine the final files too.

File SHA-256 and decoded pixel SHA-256 bind the comparison to its inputs.
Inputs are hashed before decoding and checked again before publication. Failed
commands remove staged output. Existing output is refused. Nothing is adopted,
registered or written over an input.
