---
name: pneuma-lucid
description: >
  Pneuma Lucid Mode workspace guidelines. Use for ANY task in this workspace:
  dreaming a target screenshot, building or improving a Three.js scene, game
  or app toward it, sourcing 3D assets (image-to-3D, headless Blender,
  procedural), capturing and judging rounds, reading the exit rules, or
  optimizing frame rate. Defines the project layout, the loop scripts, the
  scene bridge, and how to look through the viewer before claiming progress.
  Consult before your first action in a new conversation.
---

# Pneuma Lucid Skill

<!-- pneuma:start -->

## Scene

You are chasing a picture. The user describes a scene, game or app that
should look extraordinary; you dream its target screenshot with your image
tool, build a static Three.js scene toward it, capture the live frame through
the viewer, and hand every capture to a fresh judge who scores it against the
target. In front of the user is the loop's instrument panel: the live scene, the
dream beside or over it with a wipe, the score across rounds, the budget clock
and the asset ledger. They see every round land and click a round to hand you
back exactly which frame they mean. The record of the loop — target, rounds,
verdicts, assets, and the decision to stop — is kept by a script, not by your
memory.

## Viewer contract

One **project** is one top-level directory (a content set). It holds
`lucid.json`, `target.png`, `rounds/NN/capture.png`, `assets/` and `scene/`.
The stage renders `scene/index.html` in a same-origin iframe, so everything
the scene loads must be a relative path inside `scene/`.

### What the user can select

The user clicks a round chip on the rail or a view (Live / Target / Split).
Their next message carries a `<viewer-context mode="lucid">` block with the
project, its exit state, best and latest totals, the selected round's score and
gaps, and an `Address:` line — the machine-routable handle for that object.

### ViewerAddress vocabulary

| Key | Kind | Meaning |
|---|---|---|
| `contentSet` | framework-reserved | The project directory (`"lantern-shrine"`). The project **is** the content set. |
| `round` | coarse | 1-based round index; navigating shows that round's capture against the target. |
| `view` | fine | `"live"` (the running scene), `"target"` (the dream), or `"split"` (wipe compare). |

Example: `{ "contentSet": "lantern-shrine", "round": 3, "view": "split" }`.
Copy an address verbatim into `<viewer-locator label="…" address='{…}' />` — a
clickable card that takes the user there — or into the `capture` action's
`params.address`. A `capture` with no address screenshots whatever is on
stage: the live scene through the bridge, or the round / target the user has
selected — `navigate-to` `{ "view": "live" }` first when you mean the scene.

### Actions you can invoke

- **`navigate-to`** — point the stage at a round or a view. Call it before
  `capture` so you shoot what you mean, and after a round so the user lands
  on it in Split.
- **`get-scene-state`** — read what the stage and the scene report:
  `{ stage: { width, height, aspect }, bridge, registered, ready, loading,
  fps, fpsSource, frameMs, drawCalls, triangles, textures, errors, notes,
  lastCapture, viewport }`. `stage` is always there, even before a scene
  exists — it is the aspect to dream at. `bridge: false` means the page does
  not load `lucid-bridge.js`; `registered: false` means `main.js` never called
  `window.lucid.register(...)`. Either way you are blind — fix it first.
  `fps` counts displayed frames once registered (`fpsSource: "render"`) — at
  most one per animation frame however many passes the scene draws;
  `passesPerFrame` above 1 means reflections or other extra passes. Before
  registration `fps` is only the animation-frame cadence.
- **`reload-scene`** — restart the iframe after a batch of edits or a new
  model. The viewer also reloads on its own 1.5 s after the last scene file
  change.
- **`capture`** — framework built-in. With the live scene on stage it waits up
  to 4 s for the scene to be ready, renders one frame through the bridge and
  returns a PNG path; that PNG is the round's capture. It is the WebGL frame
  only: HTML overlays (titles, HUD, buttons) are not in it, and the judge never
  sees them. `get-scene-state.lastCapture` says what the last capture was:
  `source` must be `"live"` and `ready` must be `true` for a frame you send to
  the judge — a still of a round or of the target is not a new capture.

### Three sensing layers, in cost order

1. **Read** — `get-scene-state`: free, instant. Stage size, ready, errors,
   fps, draw calls, textures, your own `notes`. Read it before every capture
   and after every reload.
2. **Look** — `capture`: the only way to see what the user sees. Look before
   you claim anything about the picture.
3. **Judge** — a fresh subagent with the target and the capture. Never score
   your own frame.

There is no fourth layer. You cannot drive the user's browser, attach a
debugger, or open another browser to poke at the page; do not search host
processes for a way in. Anything you need to test inside the scene — clicks,
drags, wheel, keys, timings — runs as a temporary module inside the page and
publishes its result with `window.lucid.note("check-name", { … })`, which
`get-scene-state` returns under `notes`. Remove the module before judging.

## Core rules

- **Every script runs from the workspace, never from the skill.** The form is
  `node {SKILL_PATH}/scripts/<script>.mjs …` — `{SKILL_PATH}` is absolute, so
  there is nothing to `cd` into. Project and file arguments are
  workspace-relative (`lantern-shrine`, `lantern-shrine/assets/arch.png`).
- **`lucid.json`, `target.png` and `rounds/` are written only by
  `{SKILL_PATH}/scripts/lucid.mjs`.** It numbers rounds, archives replaced
  targets, validates verdicts, and computes the exit state from the whole
  history. Read the file freely; write it through the script. The decision to
  stop, rethink or keep going is `lucid.mjs status`, not your recollection.
- **Dream at the stage's aspect, as an in-engine screenshot.** Read
  `get-scene-state.stage` first; a 16:9 dream judged against a 3:2 stage is
  letterboxing the scene can never match. Ask the image tool for a real-time
  render of the requested style — the words *voxel*, *low-poly*, *orthographic*
  belong in the prompt when the user asked for them — and lock the result with
  `lucid.mjs target <project> --set <png>`. The image tool saves outside the
  project and its result payload is large; use only the saved path it reports,
  never echo the payload. The lock copies the file in, and only an image inside
  the workspace shows up as a thumbnail in the chat.
- **Judge with a fresh subagent, never yourself.** `lucid.mjs judge-prompt`
  writes the brief to `rounds/NN/judge-brief.md`; give the subagent that path
  and nothing else — no history, no fork, no notes of yours. It writes
  `rounds/NN/verdict.json`; `lucid.mjs verdict <project> --round N` ingests it.
  The brief includes the previous verdict on purpose: the judge reuses a gap's
  `id` when the gap persists, and consistency across rounds is what makes the
  trend meaningful.
- **Never judge a scene that is not ready.** `get-scene-state` must report
  `ready: true` and no errors, the loading overlay must be gone, and
  `lastCapture.ready` must be true; a wasted verdict costs a whole round.
- **Do not lower visual fidelity to hit a time budget.** Running out of time
  with meaningful, beautiful progress beats finishing something rough. Also do
  not degrade the picture for frame rate until the judge says `optimize-fps`;
  then lossless wins first.
- **Image-to-3D is not "downloading assets".** When the user forbids
  downloads, they mean existing art from the internet; a model generated from
  your own cut-out of the target is yours. Vendored three.js is a library, not
  an asset. When the requested style is itself made of primitives — voxel,
  low-poly, blocky — procedural geometry is the faithful choice, not a
  shortcut; the ladder in `references/assets.md` says where each rung fits.
- **Blender only through `{SKILL_PATH}/scripts/blender.mjs`.** Headless,
  scripted, observable; never the binary directly, never interactively.
- **Scripts retry upstream failures themselves.** Call once; when a script
  reports a failure state, read it and act — do not write a retry loop.
- **When the user said not to ask, do not ask.** At `done`, `stalled` or
  `budget-exhausted` report the state in one line and stop; the questions the
  exit table suggests are for users who want to be asked.
- **Never touch `.pneuma/`, `.agents/` or `.claude/`.**

## Workflow

### Before the first dream

1. Confirm you have an image-generation tool. Without one this mode cannot
   start: say so and ask the user to switch to a model that has it (GPT-6
   Astra in Codex).
2. `node {SKILL_PATH}/scripts/blender.mjs doctor` — records which asset rungs
   exist on this machine. {{#blenderConfigured}}A Blender path is configured
   for this workspace.{{/blenderConfigured}} {{#imageTo3dEnabled}}Image-to-3D
   is enabled (fal key present).{{/imageTo3dEnabled}}{{#imageTo3dDisabled}}
   Image-to-3D is off (no fal key); the ladder skips that rung.{{/imageTo3dDisabled}}

### Start a project — init first, then dream

```
node {SKILL_PATH}/scripts/lucid.mjs init <project> --title "…" --brief "<the user's words>" --fps-target {{fpsTarget}} [--budget-minutes N]
```

`init` writes the manifest, a runnable starter `scene/` and vendors three.js.
If the user gave a time limit, pass it as `--budget-minutes`: the clock starts
now, at init, because the user's clock started when they asked. Then
`get-scene-state` — the starter is on stage, so `stage` gives you the exact
aspect — and dream the target at that aspect (`references/target-image.md`),
unless the user supplied one. Lock it:

```
node {SKILL_PATH}/scripts/lucid.mjs target <project> --set <path/to/generated.png>
```

`navigate-to` `{ "contentSet": "<project>", "view": "target" }` and tell the
user in one line what you are about to build. Do not ask for approval when the
user said to just go.

The starter's anchors — relative imports, the environment map, the pixel-ratio
cap, resize handling, continuous rendering, `window.lucid.register` — are what
to keep. Its camera, placeholder content and controls are yours to replace.

### Build toward the target

1. **Write the asset plan from the picture, and give every hero element a
   rung.** List what the target shows — hero objects, characters, props,
   environment, camera, lighting, atmosphere, motion — and register each asset
   (`lucid.mjs asset <project> add …`) with the rung it comes from:
   {{#imageTo3dEnabled}}anything organic, ornate or characterful (statues,
   gates, lanterns, characters, trees, hero props) → `image-to-3d`, cut out of
   the target itself;{{/imageTo3dEnabled}} hard-surface pieces with real
   geometry (arches, braziers, stairs, columns, modular walls) → `blender`
   (the kit builds them with bevels, arrays and booleans, exported with
   normals); repeated modules, terrain, water, particles, rain, UI →
   `procedural`. A voxel or low-poly brief makes primitives faithful for the
   masonry, not for the hero: a blocky statue still comes out better from a
   blocky cut-out than from stacked boxes. `references/assets.md` is the
   ladder with the exact commands per rung; walk it for every asset that
   matters.
2. **Source in parallel with building.** Cut the hero elements out of the
   target with the image tool, plan them with
   `node {SKILL_PATH}/scripts/image-to-3d.mjs recipe hero` (or
   `hero-multiview`, `prop`), `check` → `submit`, and keep writing the scene
   while the jobs run; `collect` a minute or two later. Build the Blender
   pieces headless (`blender.mjs run` on a copy of `make_prop.py`). Every
   model, whatever its source, goes through `blender.mjs prep` (ground, size
   by its aligning dimension, merge shells, single-sided) and `glb.mjs
   inspect` before it enters the scene.
3. **Textures, then maps.** Albedo from the image tool; normal, roughness and
   ORM from `node {SKILL_PATH}/scripts/texture.mjs`; `tile-check` before you
   trust "seamless". A material with only an albedo reads flat.
4. **Write the scene on the starter with `references/three-scene.md` open**:
   load models through `assets.js` (`loadModel` by one dimension,
   `instance` for copies, `playClip` for rigged ones), environment map on,
   textures before triangles for performance.
5. After each batch of edits: `reload-scene`, `get-scene-state` (ready, no
   errors, fps), `capture`, look. Fix what you see before you spend a verdict.
   Test controls and behaviors inside the page and read the result from
   `notes` — never by looking for a browser to drive.

### Judge a round

Put the live scene on stage first — `navigate-to` `{ "view": "live" }` clears any
round or target the user left selected — then `get-scene-state` (ready, no
errors) and `capture` with no address; confirm `lastCapture.source` is
`"live"`. A capture taken with a round or the target on stage returns that
still, and a judge scoring the target against itself is a wasted round.

```
node {SKILL_PATH}/scripts/lucid.mjs round <project> add --capture <png from capture> --fps <fps from get-scene-state>
node {SKILL_PATH}/scripts/lucid.mjs judge-prompt <project>
```

The first line it prints is the brief's file path. Spawn a fresh subagent with
a clean context and a one-line prompt: read that file and do what it says. It
looks at both images and writes `rounds/NN/verdict.json`. Ingest and read the
exit state:

```
node {SKILL_PATH}/scripts/lucid.mjs verdict <project> --round N
node {SKILL_PATH}/scripts/lucid.mjs status <project>
```

Then act on `exit` exactly as `references/judging.md` says: `continue` — work
every gap, biggest area first, next round; `stall-approaching` — stop tweaking,
make one dramatic architectural change and record it as `--kind rethink`;
`stalled` — stop spending and tell the user; `optimize-fps` — lossless
optimizations, re-judge; `done` — show the round; `budget-exhausted` — finish
the current fix, judge once, report. After every verdict, `navigate-to`
`{ "round": N, "view": "split" }` and give the user one line with the total and
a `<viewer-locator>`.

### An existing scene, or a re-dream

When the user asks for a better version of something that already runs,
capture the current scene first and feed that capture to the image tool as the
baseline for the new target — an improvement, not a divergence. Lock it with
`target --set --reason "re-dream"`; the old target is archived, rounds keep the
version they were judged against, and the exit rules restart from zero against
the new dream.

## Commands

The viewer exposes two buttons. When a message ends with a command
notification, do this:

- **`judge-round`** — the user wants a score now. Run "Judge a round" on the
  current live scene, even mid-build.
- **`re-dream`** — the user wants a better target. Follow "An existing scene,
  or a re-dream", then continue the loop against the new target.

<!-- pneuma:end -->

## References

Read when you need depth on the topic.

| Topic | File |
|---|---|
| Dreaming the target: aspect, prompt rules, fresh vs existing, locking | `references/target-image.md` |
| The scene: layout, environment map, scale/orientation, rigged models, performance, GLB hygiene, in-page checks | `references/three-scene.md` |
| Assets: the sourcing ladder, image-to-3D recipes, the Blender boundary, the entry checklist | `references/assets.md` |
| Judging: running a round, reading a verdict, the exit rules | `references/judging.md` |
| Scripts: every subcommand of `lucid.mjs`, `glb.mjs`, `blender.mjs`, `image-to-3d.mjs` | `references/scripts.md` |
