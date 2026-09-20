# Previz mode — design brief

**Status:** built and trialled (2026-09-20) · **Branch:** `feat/previz-mode` · experiment record: [2026-09-20-previz-experiments.md](2026-09-20-previz-experiments.md) — read its last section before extending this brief: the mode's scope is about to widen from previz to the whole creative flow.

Superseded by [2026-09-20-backlot-mode.md](2026-09-20-backlot-mode.md) (the mode was renamed `backlot`; previz is its greybox stage).

Reproduces the practice of [modengsir/blender-video-workflows](https://github.com/modengsir/blender-video-workflows)
(MIT, commit `8dbcdc4b`, 2026-09-20): block the shot in 3D first, then let a video
model paint the look on top of it.

> 3D greybox animation → prompt pack → video model conditioned on the greybox

Upstream is two instruction-only Codex skills (original-from-text, recreate-from-reference) with
no scripts and, by its own `VALIDATION.md`, no end-to-end run. This mode keeps the practice
word for word where it is a rule, and turns every repeatable step into a program.

## Evidence that the practice works (spike, 2026-09-20)

Headless Blender 5.2 built and rendered the upstream "8-second lab" example (192 frames,
Workbench, 1280×720) in ~11 s. Seedance 2.5 reference-to-video, given that greybox as
`[Video1]` plus a look prompt, returned an 854×480 / 8 s / 24 fps clip in 4 m 52 s (~$2.1) that
kept the room layout, the walk-in and stop, the hand reaching the console, the device turning
blue only after the touch, and the slow push-in. The decisive half of the claim holds.

## Revision — pawns, not puppets (2026-09-20, after the first takes)

The product owner reviewed the first real takes: the result matched expectations, but the
greybox's hand-keyed legs looked unnatural, and their call was that a greybox should not direct
limbs or small motions at all — it exists to state the space, the blocking and the camera; the
body is the model's job. A paid A/B on the same lab shot confirmed it: a limbless pawn gliding
along the path, with the walk and the button press written into the prompt, came back as a
natural walk with real steps that stopped where and when the pawn stopped, pressed the button at
the prompted second and kept cause before effect; a sentence about the final framing also fixed
the over-push seen in the earlier take.

What changed against the rest of this brief: the kit's `mannequin` / `walk` / `reach` are
replaced by `figure` (a pawn: torso volume, head, front marker) and `travel` (eased root motion
with a pace validator), plus `hinge` / `swing` for doors; the standard checks `gait-phase`,
`foot-slide` and `contact` are replaced by `blocking`, `pace` and `framing`, and takes gain
`take-body`; the shot plan marks every timeline line as *blocked* (greybox) or *acted* (prompt);
the prompt pack names the pawns as stand-ins and directs the body in seconds. Sections below
that still describe the mannequin record the first build, not the current one.

## Identity

- name: `previz` · displayName: `Previz` / `预演` / `プリビズ`
- description: Block the shot in 3D first — a Blender greybox animation fixes space, action and
  camera; a video model then renders the look on top of it. Start from an idea or from a
  reference video.
- icon: line icon, a camera frustum looking at a small cube on a ground line.
- backends: `claude-code`, `codex` (both run scripts and read images; nothing here needs a
  model-side image tool). `agent.reasoningEffort: "high"`.
- visibility: public. `inspiredBy` + `NOTICE.md` (the skill's rules are adapted from upstream text).

## Domain

A **project** is a short film: an ordered list of **shots**. A shot is one continuous take of a
few seconds, and it is the unit of everything — planning, greybox, acceptance, prompt, takes,
cost. A shot has up to three **lanes** that share one timeline:

| lane | what it is | who makes it |
|---|---|---|
| `reference` | the segment of the user's video being recreated (recreate entry only) | user |
| `greybox` | the Blender animation: untextured geometry, simple light, the real camera | agent, headless Blender |
| `take` | a generated video conditioned on the greybox; a shot can hold several | video model |

The viewer is the shot's player: the lanes side by side on one playhead, the shot plan's beats
drawn on the timeline, the acceptance record, the prompt pack, and what it all cost.

## Invariants

1. **The greybox MP4 is the conditioning truth.** What the model received is a file with a probe
   record; the 3D lane in the viewer is an inspection aid and is labelled as one.
2. **One writer for machine state.** `shot.json` / `previz.json` are written only by
   `previz.mjs`. The agent authors prose (`shot-plan.md`, `prompts.md`, `comparison.md`) and the
   Blender script (`greybox/scene.py`); the viewer never writes.
3. **Frame arithmetic is exact.** `frames = seconds × fps`, frames `1..N`, never `N+1`. `render`
   refuses a scene whose range disagrees with the shot spec, and records what ffprobe measured.
4. **Nothing is "passed" unseen.** Every acceptance check is `pass | fail | unverified`, and a
   check nobody looked at stays `unverified`. `status` never summarises as "all passed" while
   one is not `pass`.
5. **Cause before effect.** A trigger beat names its cause beat; `render` metadata and the
   prompt timeline keep that order.
6. **Paid work is submitted once.** A take is recorded as `submitted` before the request leaves,
   and ends `done` or `failed` with the request id. A second take needs a named fix; a third
   needs `--user-approved`. A take is never called 1080p unless the probe says so.
7. **The same defect twice stops the loop.** A check failing on two consecutive greybox
   revisions is reported as `stuck`; the agent saves the version and reports instead of
   rendering again.
8. **A greybox is never called a final film**, and a missing service is a reported gap, not a
   silent success: no fal key → deliver plan, greybox, `.blend`, prompt pack, and say so.

## Workspace layout

```
<project>/previz.json                  project manifest
<project>/shots/<shot>/shot.json       machine state (previz.mjs only)
<project>/shots/<shot>/shot-plan.md    the shot plan (agent prose)
<project>/shots/<shot>/reference/      source.mp4 · sheet.png · frames/   (recreate only)
<project>/shots/<shot>/greybox/        scene.py · scene.blend · preview.mp4 · greybox.mp4
                                       scene.glb · scene.meta.json · sheet.png · frames/ (gitignored scratch)
<project>/shots/<shot>/prompts.md      the prompt pack
<project>/shots/<shot>/takes/          take-01.mp4 · take-01.prompt.txt
<project>/shots/<shot>/comparison.md   greybox vs reference (recreate) / take vs greybox notes
<project>/shots/<shot>/compare/        side-by-side sheets the agent looked at
```

### `previz.json`

```jsonc
{ "version": 1, "title": "First Light",
  "defaults": { "seconds": 8, "fps": 24, "width": 1280, "height": 720 },
  "shots": ["lab-walk"] }
```

### `shot.json`

```jsonc
{
  "version": 1,
  "id": "lab-walk",
  "title": "The researcher wakes the device",
  "entry": "original",                       // "original" | "recreate"
  "spec": { "seconds": 8, "fps": 24, "width": 1280, "height": 720, "frames": 192 },
  "assumptions": ["8 s / 24 fps / 1280×720 are defaults — the user gave none"],
  "beats": [                                  // the shot plan's timeline, in seconds
    { "id": "establish", "label": "Doorway establishes", "from": 0, "to": 0.5, "kind": "hold" },
    { "id": "walk", "label": "Walks to the console", "from": 0.5, "to": 3.8, "kind": "action" },
    { "id": "touch", "label": "Raises a hand to the button", "from": 4.5, "to": 5.5, "kind": "action" },
    { "id": "glow", "label": "Device brightens blue", "from": 5.5, "to": 7.5, "kind": "trigger", "causedBy": "touch" },
    { "id": "push", "label": "Camera pushes in, settles", "from": 0, "to": 7.5, "kind": "camera" }
  ],
  "reference": null,                          // or { file, sourceName, in, out, probe, cuts[], sheet }
  "greybox": {
    "revision": 2,                            // bumps on every render
    "script": "greybox/scene.py",
    "preview": { "file": "greybox/preview.mp4", "revision": 2, "probe": { /* ffprobe facts */ }, "renderedAt": 0, "renderSeconds": 4.1 },
    "final":   { "file": "greybox/greybox.mp4", "revision": 2, "probe": { }, "renderedAt": 0, "renderSeconds": 11.2 },
    "glb": "greybox/scene.glb", "meta": "greybox/scene.meta.json",
    "blend": "greybox/scene.blend", "sheet": "greybox/sheet.png"
  },
  "checks": [                                 // the acceptance record
    { "id": "gait-phase", "label": "Opposite arm and leg swing together", "target": "greybox",
      "status": "pass", "range": [0.5, 3.8], "note": "checked frames 12–92 on a strip", "revision": 2,
      "history": [{ "revision": 1, "status": "fail", "note": "same-side swing" }] }
  ],
  "stuck": [],                                // check ids failing on two consecutive revisions
  "prompt": { "file": "prompts.md" },
  "takes": [
    { "id": "take-01", "status": "done",      // "submitted" | "done" | "failed"
      "model": "bytedance/seedance-2.5", "endpoint": "reference", "resolution": "480p",
      "seconds": 8, "refSeconds": 8, "greyboxRevision": 2, "requestId": "…",
      "file": "takes/take-01.mp4", "promptFile": "takes/take-01.prompt.txt",
      "probe": { }, "cost": { "usd": 2.12, "basis": "(8 s out + 8 s ref) × $0.1323" },
      "submittedAt": 0, "finishedAt": 0, "fix": null, "selected": true, "note": "" }
  ]
}
```

### `greybox/scene.meta.json` (written by the Blender kit at render time)

```jsonc
{ "fps": 24, "frames": 192, "seconds": 8, "width": 1280, "height": 720,
  "camera": "cam", "subjects": ["root"],             // glTF node names
  "accents": [ { "objects": ["device_core"], "from": 5.5, "to": 7.5, "color": [0.08, 0.42, 1.0] } ],
  "blender": "5.2.1", "engine": "BLENDER_WORKBENCH" }
```

Measured on Blender 5.2.1 (2026-09-20, the spike's scene → 381 KB GLB): with
`export_animation_mode="SCENE"` + `export_force_sampling=True` the exporter writes **one
animation per animated object** (named after the object), every channel sampled on all 192
frames with glTF time = `frame / fps` — so frame 1 sits at `1/24 s` and the clip ends at `8.0 s`.
The player therefore plays *every* clip on one mixer and maps shot time `t` to
`(1 + round(t × fps)) / fps`. The camera's `TRACK_TO` constraint arrives baked as
translation + rotation, and the glTF camera carries `yfov` and the render aspect.

glTF carries transforms and the camera; it does not carry Workbench material-colour animation.
The accent list is the one non-transform animation the greybox grammar has (upstream: a blue
emissive stands in for "the device is triggered"), so it travels in the sidecar and the 3D lane
replays it.

## Scripts (`modes/previz/skill/scripts/`)

`previz.mjs` — the one CLI. Every subcommand takes `--json`, prints one object, and keeps
progress on stderr. Node ≥ 20, no dependencies, same argv conventions as `lucid.mjs`
(reuse `argv.mjs`'s negative-number handling by copying the helper into `_shared` only if that
is a pure move; otherwise a local copy is fine).

| command | does |
|---|---|
| `doctor` | Blender (path, version), ffmpeg, ffprobe, fal key present (never printed); says which stages are open |
| `init <project> [--title] [--seconds --fps --size]` | writes `previz.json` |
| `shot <project> <id> --title … [--entry original|recreate] [--seconds --fps --size]` | scaffolds the shot directory, `shot.json`, a `scene.py` starter that already renders, and empty `shot-plan.md` / `prompts.md` templates |
| `beats <shot-dir> --set <file.json>` | replaces the beat list (validated: inside `[0, seconds]`, `causedBy` exists and starts no later than its effect) |
| `reference <shot-dir> <video> [--in s --out s]` | probes, trims the segment to `reference/source.mp4` (re-encoded, even dimensions), detects cuts, extracts first/last/evenly spaced frames, writes `reference/sheet.png`; can adopt the reference's fps/size/duration into the spec with `--adopt-spec` |
| `render <shot-dir> [--preview] [--timeout s]` | runs `greybox/scene.py` in headless Blender with the kit on `sys.path`; PNG sequence → H.264 yuv420p MP4 (faststart) → full decode check → ffprobe → `scene.glb` + `scene.meta.json` + `scene.blend` + `sheet.png`; bumps the revision; refuses on a frame-count or size mismatch. `--preview` renders at 50 % and skips nothing else |
| `sheet <shot-dir> [--lane greybox|reference|take-01] [--at 0.5,3.8,…] [--strip from,to]` | contact sheet at named seconds, or a strip of every consecutive frame in a range (jitter and foot-slide are only visible between neighbours) |
| `compare <shot-dir> --a greybox --b reference|take-01 [--at …] [--blend]` | the two lanes at the same timestamps, stacked, or 50 % blended for silhouette matching → `compare/*.png` |
| `check <shot-dir> --id <check> --status pass|fail|unverified [--target greybox|take-01] [--range a,b] [--note …]` | records one acceptance check against the current revision; computes `stuck` |
| `checklist <shot-dir>` | seeds the standard checks (below) as `unverified` — also done by `shot` |
| `generate <shot-dir> [--resolution 480p|720p] [--seconds n] [--fix "…"] [--user-approved] [--estimate]` | reads the prompt from `prompts.md`'s fenced `prompt` block, prices the job, records the take `submitted`, runs Seedance 2.5 reference-to-video with the final greybox as `[Video1]`, records `done`/`failed`, probes the result. `--estimate` prices and stops |
| `select <shot-dir> <take>` | marks the take the shot delivers |
| `status <project|shot-dir>` | everything above as one object, plus `next` (the first open stage) and `costs` |

Standard checks (upstream's acceptance list): `frame-count`, `gait-phase` (contralateral swing),
`foot-slide`, `penetration` (feet/floor, legs, hand/prop, head/door), `contact` (hand reaches the
trigger), `trigger-order` (effect never precedes cause), `camera-smooth` (no jitter, no
overshoot), `end-hold` (last ~0.5 s settled unless the user asked for motion); for takes:
`take-motion`, `take-camera`, `take-order`, `take-integrity` (people/limb count, no cuts);
for recreate: `ref-framing`, `ref-timing`.

`blender/previz_kit.py` — the greybox grammar, importable from `scene.py`:

- `setup(seconds, fps, width, height)` — factory-empty scene, Workbench studio light, soft
  shadow + cavity, grey world; reads size/preview scale and output dir from the runner's args
- primitives: `box`, `cylinder`, `sphere`, `plane`, `room(width, depth, height, door=…)`;
  three materials `WHITE / GREY / DARK` plus `accent_material()`
- `mannequin(name, height=1.75)` → root empty + pelvis/torso/head/limbs hinged at the joints
- `walk(m, path=[(x,y),…], start, end, settle=0.7, stride=None)` — root travels the path; gait
  phase is a function of distance travelled (no foot slide); opposite arm/leg; step height and
  swing fade out through the settle window; returns the arrival pose
- `reach(m, side, target, start, end)`, `turn(m, …)`, `hold(…)`; `move(obj, keys, ease=…)` for props/vehicles
- `camera(lens)`, `camera_move(cam, keys=[(t, location, look_at)…], settle=0.5)` — eased, no overshoot
- `accent(objects, start, end, color)` — keys the Workbench colour and records the accent
- `finish()` — validates range, renders the PNG sequence, saves `.blend`, exports GLB
  (`export_animation_mode="SCENE"`, sampled, cameras on), writes `scene.meta.json`

Raw `bpy` stays available; the kit is a starting vocabulary, not a fence.

Blender discovery/launch: reuse lucid's approach (`BLENDER_PATH` → PATH → platform defaults,
`--background --factory-startup --python`). Do **not** edit `modes/lucid`; if a shared helper is
worth extracting, that is a later, separate change.

Video: `modes/_shared/scripts/seedance-video.mjs` + `fal-queue.mjs` via `sharedScripts`
(import `generateSeedanceVideo`; an additive `requestId` in its result is allowed, with a test).
Prices (fal, read 2026-09-20): with a video reference $0.1323/s at 480p, $0.2838/s at 720p, and
the reference's duration is billed alongside the output's; without one $0.2205/s and $0.4730/s.

## Viewer

```
┌ shots ─┬──────────────── stage ─────────────────────────┬─ panel ────────┐
│ ▣ 01   │  [ reference ] [ greybox ▾ Render|3D ] [ take ▾ ] │ Plan │ Checks   │
│ ▣ 02   │   layout: Side · Wipe · Blend · Solo              │ Prompt │ Takes  │
│        │                                                   │ Cost           │
│        ├───────────────────────────────────────────────────┤                │
│        │ ▶ 0.25× 0.5× 1×  ⟲   ◀▮ ▮▶   03.80 s · f 92 / 192 │                │
│        │ [establish][ walk ............][settle][touch][ glow ....... ]│    │
│        │ camera ─────────────────────────────── push ───── │                │
└────────┴───────────────────────────────────────────────────┴────────────────┘
```

- **One clock.** A single transport drives every lane: `<video>.currentTime` for the MP4 lanes
  (drift-corrected while playing, exact while scrubbing/stepping) and `AnimationMixer.setTime`
  for the 3D lane. Frame step is `1 / fps`. Space = play/pause, ←/→ = one frame, `[` `]` = jump
  to previous/next beat edge, `L` = loop the current beat.
- **Lanes.** Reference (only when the shot has one), Greybox, Take (selector when several;
  `submitted`/`failed` takes show their state instead of a player). Each lane header states what
  it is and its probe facts (`1280×720 · 24 fps · 192 f`).
- **Layouts.** *Side* (2-up or 3-up), *Wipe* (A over B with a draggable divider), *Blend*
  (A over B with an opacity slider — silhouette matching against a reference), *Solo*.
- **Greybox lane: Render | 3D.** *Render* plays the MP4 the model received. *3D* loads
  `scene.glb` with three.js: **Shot camera** (the exported camera, animated — what Blender
  rendered) or **Free** (orbit). In Free the shot camera is drawn as a frustum gizmo moving along
  its path line, subjects leave a floor trail, and a ground grid gives scale — the person can
  check blocking and the camera move in space without opening Blender. Matte grey materials, a
  hemisphere + key light with soft shadows; accents replayed from `scene.meta.json`. The lane
  carries a quiet "inspection view — the model saw Render" caption in 3D.
- **Timeline.** Beats as labelled segments in rows by kind (action / trigger / camera / hold);
  trigger beats draw a link back to their cause; failed checks with a range paint that range red
  on a thin track under the beats; click to seek, drag to scrub, shift-drag to mark a range.
- **Panel.** *Plan* — `shot-plan.md` rendered, assumptions called out. *Checks* — the acceptance
  record grouped by target, status chips (`pass` / `fail` / `unverified` — unverified is visibly
  not-green), click a check to seek to its range; `stuck` banner. *Prompt* — `prompts.md` with a
  copy button. *Takes* — one card per take: model, resolution, duration, request id, cost, the fix
  it was made for, selected flag. *Cost* — per-take and project total, labelled an estimate, the
  per-second table it was computed from.
- **Shots rail.** Poster frame, title, duration, stage dots (plan · greybox · accepted · take).
- **States.** No greybox yet → the plan fills the stage; rendering/submitted → named waiting
  states; a missing file is a named empty lane, never a broken player.
- three.js is an npm dependency (`three`, `@types/three`), dynamically imported by the 3D lane
  only. It is viewer chrome here, not workspace content (unlike lucid's scene).

### ViewerAddress

`{ contentSet?, shot, lane?, take?, time?, range?, layout? }` — `shot` is the coarse key
(shot id); `lane` is `reference | greybox | take`; `take` a take id; `time` seconds on the shared
clock; `range` `[from, to]` seconds; `layout` `side | wipe | blend | solo`. The playhead
(`shot`, `lane`, `take`, `time`, frame, beat id) is always in the viewer context; a marked range
is included when set, so "the hand goes through the console here" arrives with its moment.

### Actions

| id | category | agentInvocable | params |
|---|---|---|---|
| `navigate-to` | navigate | true | `{ address }` — refuses unknown shots/takes by name |
| `get-player-state` | custom | true | — → shot, lanes and whether each loaded, layout, playhead, marked range, selected take, 3D camera mode |

Commands (user → agent): `check-greybox` "Go through the acceptance list on this greybox",
`generate-take` "Generate a take from this greybox".

## Source layer

- `film` — `aggregate-file` over `**/previz.json` + `**/shots/*/shot.json`, loaded by
  `domain.ts` into `{ projects: [{ dir, title, defaults, shots: Shot[] }] }`. Read-only from the
  viewer (`save` refuses — invariant 2).
- `docs` — `file-glob` over `**/shots/*/shot-plan.md`, `prompts.md`, `comparison.md`.
- `metas` — `file-glob` over `**/greybox/scene.meta.json`.
- Media (`.mp4`, `.glb`, `.png`) are **not** watched: every watch-pattern match is read as
  UTF-8 text by the watcher and by `GET /api/files`, and the fixture's PNG sheets alone turned a
  10 KB snapshot into 4 MB of mangled binary (measured while building the viewer). The revision
  in `shot.json` is the change signal; media are fetched over `/content/…?rev=<n>`. Every watch
  pattern ends in a literal extension.

Contract notes settled during the build: a failed take's reason lives in `take.note`;
`reference.cuts` are seconds into the **trimmed** segment; the frame shown for second `t` is
`1 + round(t × fps)` clamped to the last frame; a check's `target` is `greybox` or an existing
take id, and `check` refuses anything else.

Workspace model: `manifest`, `manifestFile: "previz.json"`, multiFile, ordered,
`supportsContentSets: true` (a content set is a project directory), `topBarNavigation: false`
(the shots rail is the navigation).

## Skill

`SKILL.md` (scene → viewer contract → rules → workflow → commands → references) plus:
`references/shot-plan.md`, `greybox.md` (upstream's production + acceptance rules, the kit),
`recreate.md`, `video-generation.md` (capability check, prompt pack, cost, retries, honesty),
`scripts.md`. Both entries live in one skill; the recreate steps branch off step 1.

## Seed and showcase

One project, `first-light/`, with the lab shot complete: plan, kit-based `scene.py`, greybox
(MP4 + GLB + meta), acceptance record, prompt pack and the real Seedance take from the spike —
so a new user presses play on a greybox next to the film it became. Videos re-encoded small.
Showcase from real viewer screenshots, as lucid did.

## External integrations

`init.params`: `blenderPath`, `falApiKey` (sensitive) → `envMapping` `BLENDER_PATH`, `FAL_KEY`.
No proxy, no MCP. External effect: a fal job is paid on acceptance; cancellation at the deadline
is remote; a finished-but-undownloaded job is recoverable from the recorded URL.

## Cloud surfaces

Hosted player: **no** for 0.1 (the viewer would work from files alone, but it has not been run
in a player build; revisit once the mode has real use). Artifact deploy: none.

## Evolution directive

Learn the user's shot habits: default duration, aspect and frame rate, how they describe camera
moves, which looks they ask the video model for, how strict they are at greybox acceptance, and
what they spend per take — and write them back as this skill's defaults.

## Deferred

Film assembly (concat selected takes), MiniMax H3 as a second model, lens (zoom) animation in the
3D lane, automatic gait/foot-slide measurement inside Blender, hosted player.
