# NOTICE

The Sprite mode's 0.5.0 round migrated the methods an upstream project's
author treats as reliable into this mode's own pipeline. This file pins what
we **ported** (the same method and constants, re-expressed in JavaScript), what
we **adapted** (their idea, our design — "inspired by"), what we did not take
and why, and reproduces the upstream's own notices.

**The pin marks what we took, not what we read.** It moves only when we take
something from a newer upstream commit. Reading a release and deciding it
holds nothing for this mode is a complete outcome that changes nothing here.
Upstream moves fast (260 commits in its first six weeks); counting commits
past the pin measures its pace, not a debt of ours.

## Upstream

- **Name**: sprite-gen (`aldegad/sprite-gen`)
- **Author**: Alex Kim ([@aldegad](https://github.com/aldegad))
- **Repository**: <https://github.com/aldegad/sprite-gen>
- **License**: Apache License 2.0 (SPDX: `Apache-2.0`), Copyright 2026 Alex Kim.
  The license text ships with this mode at
  [`licenses/sprite-gen-LICENSE`](licenses/sprite-gen-LICENSE), byte for byte
  the upstream `LICENSE` at the pinned commit.
- **Version pinned**: commit `fbd1a08d47e39c673c73eb494cfde8435b3b13b6`
  (package version 2.11.0, 2026-09-26 — two README commits past tag
  `v2.11.0`)
- **Read at**: 2026-09-27

Upstream is a Python CLI plus a Codex / Claude skill. Nothing of it is
vendored or installed: every port is Node built-ins plus ffmpeg, like the rest
of `skill/scripts/`, and upstream's Python ran only in a throwaway environment
to compare outputs. Each port carries a header comment of the form
`Ported from aldegad/sprite-gen (Apache-2.0) <path>@fbd1a08: <what>. Changes:
<what we changed>.`; each adaptation says `Inspired by aldegad/sprite-gen
<path>`. The measured before/after behind every default is in the skill
references' "Measured" sections, dated 2026-09-27.

## Ported

Same method, same constants, re-expressed in JS. The **Changes** column is the
statement of modification Apache-2.0 §4(b) asks for; the file headers say the
same in more detail.

| Pneuma file | Upstream source (at `fbd1a08`) | Changes |
|---|---|---|
| `skill/scripts/chroma.mjs` — the un-mixing chroma keyer | `sprite_gen/frames/extract.py`: `remove_chroma_background`, `despill_color`, `unmix_key_blend`, `detect_background_key_rgb`, and their constants | One cut radius around the plate as measured over 8 frames (upstream's border rule rejects broadcast green `#00b140`); the key channels taken from the plate's own hue; edge pixels classified by channel excess, not the mean tint (upstream's rule lowered alpha on 42–77 % of a yellow-furred character's edge). Ours: an edge pixel un-mixed against the deeper subject within 3 px, then the subject's frequent colours, before the tint (the tint alone left saturated red/blue rims green at alpha 255); plate-coloured shade that touches no subject — a floor shadow — flooded away from the cut |
| `skill/scripts/cycle.mjs` — the whole-clip period, gait guard, one-shots, seam floor | `sprite_gen/video/loop.py`: `_small_features`, `distance_matrix`, `frame_masses`, `detect_cycle` (period choice, the v2.5.5 gait guard, the v2.5.0 ambiguous-harmonic check), `_repeat_context`, `periodicity_floor`, `detect_one_shot`, `PIN_NOISE_MAX`, the walk / run floors of `STATE_PROFILES` | Our 0.4–2.5 s window with a coverage floor per lag; the profile reads one more lag past the window (never a single pair, never in the mean) so a dip at its edge is a minimum; no dip in the window is no cycle; ambiguity flagged, acted on only with `--gait`; every non-overlapping one-shot listed, and only when there is no cycle; a candidate window must move |
| `skill/scripts/drift.mjs` — drift-trend and body-ramp alignment | `sprite_gen/video/loop.py`: `drift_reference`, `body_wrap_offset`, `ramp_frames`, `body_centre` | A 10 % foot band (upstream 8 %), empty frames skipped; edges zero-filled rather than wrapped; the ramp returns shifts; `body_centre` becomes `massCenterX` |
| `skill/scripts/canvas.mjs` — room in the first frame (`flatten --room`) | `sprite_gen/video/canvas.py`: `pad_canvas`, `STATE_CANVAS`, `SHAPE_DEFAULTS` | Re-expressed as `roomCanvas`; identical geometry on 168 of 168 cases run against the Python; a facing other than left/right is refused |
| `skill/scripts/pixel-lattice.mjs` — the pixel lattice (`run --pixel`, `pixel`) | `sprite_gen/frames/extract.py`: edge-histogram pitch detection and fractional refinement, `_best_phase`, `resolve_frame_pitch`, `_grid_edges`, `solid_alpha_bbox` / `tighten_components`, `refine_edges_to_boundaries`, `snap_by_edges`, `_dominant_block_color`, `build_shared_palette` / `apply_palette`, `enforce_outline`, the palette lock, the `_snap_strip` consensus; `docs/pixel-unfake.md` | Divisor seeds down to a fifth (upstream: a third); a consensus ceiling needs a quarter of the frames' support; `--pitch-hint` is the family centre, not a last resort; a same-colour run length over 1.5× the consensus overrules a majority of divisor readings; refused when fewer than half the frames read a grid; the declared height is ours — a snap 1.5× off it is re-cut at the height's pitch when the frames back it, else refused before the motion is touched; an empty palette is never pinned. Not ported: component extraction, `arbitrate_pitch`, `conform_row_logical`, `register_row_frames`, the whole-strip detection fallback |
| `skill/scripts/breathe.mjs` — a breathing idle from one still | `sprite_gen/effects/anatomy.py` (the anatomy), `sprite_gen/effects/breathe.py` (the deformation and the whole-pixel bake, mirrored in `serve/curator/src/breathe.js`), helpers from `sprite_gen/frames/extract.py` (`solid_alpha_bbox`) and `sprite_gen/frames/segment.py` (`mask_components`, `smooth_profile`) | The canvas grows instead of refusing, within a 3 MP working canvas; default depth 0.02 (upstream 0.06, tuned on 32–64 px pixel art); no sidecar or curator plumbing. Ours: the `smooth` mode (it stretches only inside the solid box), overrides in the still's coordinates, the per-frame head check and its extremes, the prop-crossing and head-never-moves warnings |
| `skill/scripts/shadow.mjs` — the projected ground shadow (`export --shadow`) | `sprite_gen/effects/shadow.py` (projection maths, geometry, defaults, ranges); tests adapted from `tests/effects/test_shadow.py` | A true Gaussian blur (not Pillow's box approximation); reads outside the frame are transparent; the shadow is composited under the sprite |
| `skill/scripts/aseprite.mjs` — the Aseprite JSON shape (`export --format aseprite`) | `sprite_gen/compose/export_aseprite.py` | The hash form only, with `anchor` / `pivot` per frame and rects from our atlases. Ours: stacking several motions' sheets into one character sheet |
| `skill/scripts/sheet-prompt.mjs` — the layout guide and the per-state text | `sprite_gen/gen/prepare.py`: `DEFAULT_SAFE_MARGIN_RATIO` (9.4 %), `draw_guide` (one row pixel-identical), the walk / run / front-walk / wave / jump lines of `STATE_REQUIREMENTS` | Rows as well as columns; our grammar wins where the two conflict (white plate, grid sheet, one paragraph) |
| `skill/references/video-preview.md` — the per-state video sentences | `sprite_gen/video/batch.py`: `HOLD_TEXT`, `MOTION_TEXT`, `ACTION_COMMON_TEXT`, `PINNED_LOOP_TEXT` | Text ported; the jump sentence is ours (one jump, not repeated hops) |
| `skill/scripts/recolor.mjs` — colourways for palette-pinned pixel art | `sprite_gen/effects/recolor.py` (exact and tolerance matching, the uncovered-colour report, histogram / palette ordering, map validation; alpha > 8 is solid, at most 64 uncovered colours listed); tests adapted from `tests/effects/test_recolor_bake.py` | Tolerance per colourway; `#`-prefixed hex; slug names; runs over a motion's frames, then `pack` and `gif`; an aggregated report; the draft map read off the pinned palette. Ours: the numbered swatch sheet (at most 256 swatches, 32 MP), the colourway record on the character and motions, the declared-height check. Not ported: manifest propagation |

### Transitive credit — perfectpixel-studio (MIT)

The same-colour run-length pitch estimator in `skill/scripts/pixel-lattice.mjs`
(a second opinion beside the lattice score, and its cross-check) is ported from
upstream's `estimate_pixel_grid_runlen` and `crosscheck_pitch_runlen` in
`sprite_gen/frames/extract.py`, which upstream itself ported from
**perfectpixel-studio** (<https://github.com/gykim80/perfectpixel-studio>,
`internal/sprite/pixelize.go`), Copyright Andrew Kim (gykim80), MIT License.
The credit is carried as upstream carries it (its NOTICE, reproduced below).
Upstream's other perfectpixel-studio ports — the alpha-centroid alignment,
the projection segmentation and the YCbCr matte — were not taken.

## Inspired by

Their idea, our design; nothing of upstream's code.

| Pneuma | Upstream idea |
|---|---|
| `keyResidue` (`chroma.mjs`, reported by `inspect`, `from-video`, `loop`, `transition`) | `sprite_gen/frames/check_visible_magenta.py` — count the visible key-coloured pixels an output still carries |
| The edge un-mix's palette fallback (`chroma.mjs` `subjectPalette`) | `sprite_gen/frames/decontam.py` — explain an edge pixel as the plate mixed with a colour the subject's interior owns |
| `flatten`'s plate check (`plateProximity`) | `sprite_gen/gen/prepare.py` `choose_chroma_key` — a key must clear every subject pixel by the erase radius |
| The near-duplicate and row-boundary warnings (`frame-steps.mjs`, `inspect`) | `sprite_gen/qa/inspect.py` `_motion_presence`, `sprite_gen/qa/score.py` |
| `from-video --body-height` | `sprite_gen/video/loop.py` `--body-height` / `first_frame_height` |
| `headDrift` in `inspect` | upstream's head-and-torso registration (`body_wrap_offset`) |
| The code-built sheet prompt and its identity-over-motion lines (`sheet-prompt.mjs`) | `sprite_gen/gen/prepare.py` `row_prompt` |
| The facing lock and the anchor clause | `sprite_gen/gen/prepare.py` `DIRECTION_FACING`, `direction_prefix_requirements`, `directional_requirements` |
| The no-detached-effects clause | `sprite_gen/gen/prepare.py` `TRANSPARENCY_ARTIFACT_RULES` |
| Pinning the first frame of an idle or attack clip | `sprite_gen/video/batch.py` `PIN_LAST_FRAME_STATES` |
| The frame-count guidance (an idle is 8 frames; our numbers from our own takes) | `docs/states-and-frames.md` |
| Direction anchors, the mirrored side, the asymmetry gate (`mirror.mjs`, `prompting.md` *Direction anchors*) | `docs/directional-anchor-workflow.md`, `sprite_gen/gen/prepare.py` ("CANONICAL DIRECTION ANCHOR … change only the facing"), `sprite_gen/gen/gen_set.py` (fix a failed anchor, do not work around it) |
| A separate shadow sheet for engines | `sprite_gen/effects/shadow.py` |
| Routes, and asking only what is missing (SKILL.md, *Pick the route*) | `docs/user-workflow.md`, `sprite_gen/workflow/guide.py` (loosely) |

## What we did not take, and why

- **Frame curation, candidate takes, AI in-betweens** (`curate/`,
  `serve/curator/`, `effects/reroll.py`, `effects/interpolate.py`) — the
  product owner's call: this mode's users are not animators, and a frame
  editor is a professional's tool. Bad frames stay the agent's job.
- **Palette decontamination** (`frames/decontam.py`) and the **YCbCr matte** —
  upstream ships both off by default; our paid matte already measures zero
  green on loops. Decontamination's idea — a palette learned from the
  subject's interior — backs one fallback of our own edge un-mix (see
  *Inspired by*); its luma transfer, flank regain and guards were not taken.
- **The facing detector** (`gen/facing*.py`) — upstream says it can be wrong
  at high confidence and publishes no accuracy; looking at a capture covers it.
- **The score-and-correct loop** — canned hints with no identity metric; its
  two useful signals came over as the near-duplicate and row-jump warnings.
- **Layer tracks** — every landmark hand-declared per frame; Rive covers
  state switching here.
- **Scene, background tile and stride measurement** — composition and level
  art belong to other modes.
- **Grok-specific levers** (2 s clips — Seedance's minimum is 4 s — magenta
  painting, request staggering) and **magenta plates / automatic key choice**
  — our sheets are white plus a matting model, and the green-screen matte we
  use is green only; the plate check warns instead of switching plates.

## Upstream NOTICE — verbatim

The upstream `NOTICE` file at the pinned commit, reproduced as Apache-2.0
§4(d) asks:

```
sprite-gen
Copyright 2026 Alex Kim

This project is inspired by the Apache-2.0 licensed hatch-pet component-row
workflow. sprite-gen targets generic game sprite atlases and does not include
Codex pet assets, pet packages, or hatch-pet visual assets.

The `align_x: "alpha-centroid"` frame alignment (sprite_gen/extract.py) is a
port of the alpha-weighted mass-centroid alignment from perfectpixel-studio
(https://github.com/gykim80/perfectpixel-studio, internal/sprite/extract.go),
Copyright Andrew Kim (gykim80), MIT License.

The `segmentation: "projection"` frame separation (sprite_gen/segment.py) is a
port of the projection-profile + DP optimal-cut segmentation from
perfectpixel-studio (https://github.com/gykim80/perfectpixel-studio,
internal/sprite/segment.go), Copyright Andrew Kim (gykim80), MIT License.

The opt-in `chroma.mode: "ycbcr"` background matting (sprite_gen/extract.py) is
a port of the chrominance-plane matting — CbCr border-mode key detection,
Hermite soft matte, key-direction despill, border flood fill and the pure-key
rematte self-diagnostic — from perfectpixel-studio
(https://github.com/gykim80/perfectpixel-studio, internal/sprite/chroma.go),
Copyright Andrew Kim (gykim80), MIT License.

The estimation-only `estimate_pixel_grid_runlen` pitch estimator
(sprite_gen/extract.py) is a port of the unfake same-color run-length mode
block-size estimation from perfectpixel-studio
(https://github.com/gykim80/perfectpixel-studio, internal/sprite/pixelize.go),
Copyright Andrew Kim (gykim80), MIT License.
```

## License

Upstream's license, Apache License 2.0, in full:
[`licenses/sprite-gen-LICENSE`](licenses/sprite-gen-LICENSE). What §4 asks of
a redistributed derivative is met here: the license text travels with the
mode, each ported file says it was ported and what changed, and upstream's
NOTICE is reproduced above. The mode as a whole is distributed under this
repository's license.
