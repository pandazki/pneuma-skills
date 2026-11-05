# Final-artifact candidate comparison

`compare` measures the delivered artifact, independently of `inspect.json`, a frames directory, or a cleanup report. It does not adopt or register a candidate. Inputs remain unchanged. Use a fresh output directory.

The integration handler is `runCompare({ baseline, candidate, out, alphaClean? }, codecs)` in `scripts/compare.mjs`. Supply the existing `readRgba`, `writeRgbaPng`, and `decodeGifFrames` helpers. The optional `cleanAlphaHaze` callback recomputes a declared cleanup objective from original pixels with explicit `{ maxAlpha, keepEdge }` parameters.

Supported inputs are static PNG, the current untrimmed Pneuma TexturePacker JSON hash atlas with one explicit animation, and GIF. Atlas images must remain within the atlas directory, including after symlink resolution. Rectangles, source geometry, ordering, duration, loop semantics, pivot and anchor agreement are validated. Final sheet pixels are read again rather than trusting extracted cells. Other animation formats and inferred GIF delays are refused. No frame, time, size, or canvas normalization takes place.

The JSON report distinguishes `identical`, `comparable`, and `unknown`. It lists changed geometry, timing, loop behavior, pivots, frame order and pixels. Geometry or playback differences prevent a direct pixel comparison from establishing equivalence. A PNG has no animation timing. GIF uses each decoded frame's true delay and its embedded repeat count. Missing repeat extensions mean one play.

`artisticQuality` and `improvement` remain `unknown` even when pixels are identical or the alpha cleanup contract is verified. A smaller seam, less movement, or a frozen candidate cannot establish improvement. Human review must assess intent, subject identity, anatomy where applicable, translucency, animation and style.

The optional cleanup objective reports `verified`, `no-op`, `violated` or `unverified`. Verification requires matching geometry and playback metadata and exact equality to a fresh cleanup of the baseline. This checks the cleanup algorithm's narrow mechanical pixel contract, including its original-mask protection. It does not infer whether faint pixels were unwanted. An omitted objective is `undeclared`.

Evidence includes `comparison.json`, full-resolution vertically stacked `baseline.png` and `candidate.png`, and an absolute RGB `difference.png` when frame geometry matches. Difference alpha is opaque so RGB changes remain visible; alpha loss is quantified separately in JSON. File SHA-256 and decoded pixel SHA-256 bind the comparison to its inputs. Inputs are hashed before decoding and checked again before publication. A thrown error carries the input digests collected so far in `error.inputs`. Failed commands remove staged output. Existing output is refused.
