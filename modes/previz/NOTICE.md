# NOTICE

This mode reproduces a practice described by an upstream project. This file
pins what we took, what we adapted, what we added, and tracks the upstream
version so future updates can be diff-merged.

## Upstream

- **Name**: blender-video-workflows (modengsir/blender-video-workflows)
- **URL**: https://github.com/modengsir/blender-video-workflows
- **License**: MIT
- **Version pinned**: commit `8dbcdc4b7d1f1d8b701e8de6e9258b63d63a5afb`
- **Read at**: 2026-09-20
- **Kept verbatim**: [`upstream/blender-video-workflows/`](upstream/blender-video-workflows/) — the unmodified snapshot of that commit, license included, as the original reference. It is never installed into a workspace.

Upstream is two instruction-only Codex skills — `original-from-text` and
`recreate-from-reference` — with no scripts, no kit and, by its own
`VALIDATION.md`, no end-to-end run. What it contributes is the **practice**:
block the shot in 3D first, then condition a video model on that greybox.

## What we borrowed

| Pneuma file | Upstream source | Note |
|---|---|---|
| `skill/SKILL.md` (workflow order: plan → block → render → accept → prompt → generate) | `original-from-text/SKILL.md` | The order of the steps and the insistence that the greybox is accepted BEFORE any generation. Rewritten in this mode's own words and wired to `previz.mjs` subcommands upstream does not have. |
| `skill/SKILL.md` + `skill/references/greybox.md` (the acceptance list) | both upstream skills' acceptance sections | The list of what to check — frame count, (upstream's contralateral gait phase, foot slide, penetration, contact, trigger order, camera smoothness, end hold, and the take-side motion/camera/order/integrity checks. Short rule phrasings are close to upstream because they are the rule; everything around them (three-valued status, per-revision history, the `stuck` rule) is ours. |
| `skill/references/greybox.md` (greybox grammar) | `original-from-text/SKILL.md` → scene construction | Untextured primitives, one simple light, the real camera, a blue emissive standing in for "the device is triggered". |
| `skill/references/recreate.md` | `recreate-from-reference/SKILL.md` | The recreate entry: trim the segment, read its framing and timing, rebuild it as blocking, compare against the source. |

Nothing is transcribed verbatim beyond short rule phrasings of the kind above.
No upstream file is vendored into this repository.

## What we adapted

- Upstream's two separate skills → **one** skill with two entries; the recreate
  steps branch off step 1 and rejoin at the greybox.
- Upstream's prose acceptance list → a **machine-checked record**:
  `previz.mjs check` writes `pass | fail | unverified` per check against the
  current greybox revision, keeps the history, and computes `stuck` when the
  same check fails on two consecutive revisions. Upstream says to check; this
  mode makes "nobody looked" a state you can see.
- Upstream's "render the animation and give it to the model" → `previz.mjs
  render`, which refuses a scene whose frame range disagrees with the shot
  spec, records what ffprobe measured, and bumps a revision every take is tied
  back to.
- Upstream's free-text shot description → `shot.json`: a spec, timed beats
  with `causedBy` so cause precedes effect, the assumptions the mode made when
  the user gave no numbers.

## What we added

Everything executable. Upstream ships no code.

- `skill/scripts/previz.mjs` — the whole CLI (`doctor`, `init`, `shot`,
  `beats`, `reference`, `render`, `sheet`, `compare`, `check`, `checklist`,
  `generate`, `select`, `status`).
- `skill/scripts/blender/previz_kit.py` — the greybox grammar as an importable
  Python module: rooms and primitives, a limbless pawn figure, eased root travel with a
  pace check, hinged props, eased camera moves, accents that
  record themselves, and a `finish()` that validates the range and exports
  GLB + `scene.meta.json`.
- The video stage — Seedance 2.5 reference-to-video through
  `modes/_shared/scripts/seedance-video.mjs`, priced before submission and
  recorded `submitted` before the request leaves.
- The viewer — the shot's player: every lane on one clock, the beats on the
  timeline, the acceptance record, the prompt pack and the bill.

## What we dropped

- **Limb animation in the greybox, and the acceptance items that go with it.**
  Upstream animates the figure's joints (root motion, contralateral arm swing,
  a reach to the button) and checks gait phase, foot slide and hand contact.
  This mode shipped that first, then removed it on the product owner's review
  of real takes: a hand-keyed box gait reads as unnatural and gives the model
  a stiff walk to imitate. Subjects are now limbless pawns that carry position,
  facing and timing; the body's action is written into the prompt. Measured on
  the same lab shot (2026-09-20, Seedance 2.5, 480p): with a pawn and the
  action in words the model produced a natural walk with real steps, stopped
  where and when the pawn stopped, pressed the button around the prompted
  second and kept cause before effect. The checks became `blocking`, `pace`
  and `framing`, plus `take-body` on the generated video.
- Upstream's model-agnostic "give the greybox to your video model" is narrowed
  to one endpoint that was actually validated end to end (Seedance 2.5
  reference-to-video). A second model is deferred rather than claimed.
- Upstream's `VALIDATION.md` (which records that the workflow had not been run)
  has no counterpart here; this mode's evidence is its own spike, recorded in
  the design brief.

## License excerpts

```
MIT License

Copyright (c) 2026 modengsir

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
