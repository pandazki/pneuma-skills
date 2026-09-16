# NOTICE

This mode borrows content from an upstream project. This file pins what we
took, what we adapted, what we dropped, and tracks the upstream version so
future updates can be diff-merged.

## Upstream

- **Name**: dream-loop (achimala/dream-loop)
- **URL**: https://github.com/achimala/dream-loop
- **License**: MIT
- **Version pinned**: commit `9bddb90` ("Simplify Plus workflow to get better results for cheaper; restructure and simplify skill layout substantially")
- **Synced at**: 2026-09-16

## What we borrowed

| Pneuma file | Upstream source | Note |
|---|---|---|
| `skill/scripts/lucid.mjs` (`JUDGE_RUBRIC` constant printed by `judge-prompt`) | `references/pro-mode/workflow.md` → "Judge" | Transcribed rubric text (composition / lighting / materials / details, fractional scores, comprehensive actionable gaps, consistency with the previous verdict); Pneuma adds a stable `id` per gap and a JSON output schema |
| `skill/scripts/lucid.mjs` (exit evaluation) | `references/pro-mode/workflow.md` → "Exit criteria" | Same thresholds (score ≥ 8 + acceptable fps = done; no full-point gain in two rounds or a repeated gap = stall approaching; a failed rethink = stalled); encoded as code with `rethink` rounds instead of prose |
| `skill/references/target-image.md` | `SKILL.md` → "The target image" | Adapted: in-engine screenshot not concept art; capture-first refinement for an existing product; time budget rule |
| `skill/references/assets.md` | `references/pro-mode/assets-3d.md` | Adapted: the four-rung sourcing ladder, cut-out-from-target inputs, the two model roles, "textures from the image tool, never noise" |
| `skill/scripts/image-to-3d.mjs` | `scripts/fal-batch.mjs` + `references/fal.md` | Job-file semantics (`check` / `submit` / `collect`, resumable state machine, never resubmit an uncertain paid job, GLB validation, no credential to the download host) re-expressed over `modes/_shared/scripts/fal-queue.mjs`; the two endpoint recipes (`tripo3d/h3.1/image-to-3d`, `fal-ai/trellis`) and their option validation |
| `__tests__/image-to-3d.test.ts` | `scripts/fal-batch.test.mjs` | Test cases ported to bun:test |

## What we adapted

- Upstream's `.dream-loop/` working folder → one Pneuma content set per
  project (`<project>/lucid.json`, `target.png`, `rounds/`, `assets/`,
  `scene/`) owned by `lucid.mjs`, so the viewer can render the loop.
- Upstream's `preview-server.py` `/__capture` endpoint → the scene bridge
  (`lucid-bridge.js`) answering the viewer, plus the framework's built-in
  `capture` action.
- Upstream's "Plus" (orchestrate cheaper subagents) and "Pro" (build yourself,
  judge with a subagent) workflows → one workflow; the judge is always a fresh
  subagent, which the codex backend provides.
- Upstream's prose exit criteria → `lucid.mjs status`, so the decision to stop
  is computed from the recorded history rather than remembered.

## What we dropped

- Subscription-tier detection ("check whether the user is on a low or high
  tier") — not observable from a Pneuma session and not a product concept here.
- "If you are a very large model, stop and ask the user to switch to a smaller
  one" — the mode is locked to one backend and the user chooses the model.
- Downloading assets from the internet as rung 1 remains opt-in exactly as
  upstream states it; no script was added for it.

## Informed by, not copied

`skill/references/three-scene.md` and `assets.md` restate measured findings
(environment maps for PBR on light backgrounds, textures as the memory budget,
`SkeletonUtils.clone`, six-view orientation checks, baking yaw into vertices,
`doubleSided` and quantization traps, the Blender-vs-gltf-transform decimation
comparison, auto-weights failing on fragmented meshes) from
*3D Vibe Coding 手册* (alchaincyf/3d-vibe-coding-handbook, CC BY-NC-SA 4.0).
That license is incompatible with this repository, so no code, prose, images
or scripts from it were reproduced; the facts are cited as facts.

## License excerpts

```
MIT License

Copyright (c) 2026 Anshu Chimala

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
