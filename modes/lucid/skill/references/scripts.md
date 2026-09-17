# Scripts — the mode's four programs

Every script runs from the workspace as `node {SKILL_PATH}/scripts/<name>.mjs …`,
prints one JSON object on stdout (except `lucid.mjs judge-prompt`, which prints
the judge brief as plain text), and reports failure as one `ERROR:` line on
stderr with exit code 1. `--help` on each is the authoritative reference; this
file is the map.

## `lucid.mjs` — the loop's record

`node {SKILL_PATH}/scripts/lucid.mjs <subcommand> <dir> [options]`

The only writer of `<project>/lucid.json`, `target.png` and `rounds/**`. `<dir>`
is the project directory, relative to the workspace or absolute. Add
`--now <ISO-8601>` to pin the clock (tests do; you never need to).

| Subcommand | What it does |
|---|---|
| `init <dir> --title "…" --brief "…" [--fps-target 60] [--budget-minutes N] [--no-vendor] [--version <semver>]` | Creates the manifest (status `dreaming`), `rounds/`, `assets/`, and a runnable `scene/` (starter `index.html` + `main.js` + `lucid-bridge.js`), then vendors three.js unless `--no-vendor`. `--budget-minutes` starts the clock at init — the user's clock started when they asked. Never clobbers existing files; refuses a directory that already has a `lucid.json`. A vendoring failure is reported as `vendor.ok = false` and does not fail init. |
| `vendor-three <dir> [--version <semver>]` | `npm pack three@<version>` (default: latest) and copies exactly six files (`three.module.js`, `three.core.js`, the GLTFLoader, OrbitControls, BufferGeometryUtils and SkeletonUtils addons) into `scene/vendor/` plus `VERSION`, staged and swapped in as a unit. Needs the network. |
| `target <dir> --set <png> [--reason "…"]` | Locks the dream. The first lock flips status to `looping`; a replacement archives the old target to `target-history/v<N>.png`, bumps `target.version` and restarts the trajectory: every round carries the `targetVersion` it was judged against, only rounds matching the locked version feed the exit rules, and the reply says how many verdicts stopped counting (`supersededRounds`). |
| `round <dir> add --capture <png> [--fps N] [--kind iterate\|rethink] [--note "…"] [--verdict <file\|->]` | Records round N and copies the capture to `rounds/NN/capture.png`. Refuses before a target is locked. Without `--fps` the loop can never reach `done`. `--kind rethink` marks the deliberate redesign a stall calls for. |
| `verdict <dir> --round N [--file <json\|->] [--replace]` | Reads `rounds/NN/verdict.json` by default (the judge writes it there), validates the JSON (ranges, recomputed total, gap ids), stores it inline, recomputes the evaluation. |
| `status <dir>` | Where the loop stands: `evaluation.exit`, reasons, best/last, trend (all over the current target version; `judgedAgainstTarget` vs the file-wide `judged`), the budget clock (checked from the moment it starts, even before the first verdict), what `scene/` holds, `costs` (the project's fal jobs priced at list price from `prices.mjs`, in total and per round; the viewer's cost panel adds image generations and tokens), one line of advice. Exit code 0 always. |
| `budget <dir> [--minutes N] [--pause-credit M]` | Sets or updates the budget (`0` removes it); starts the clock now when it has not started. `--pause-credit M` gives back M minutes the wall clock counted while nobody worked (credits ran out, the session was closed, the machine slept): after a resume read `status` → `budget.sinceLastWriteMinutes` and credit the part that was a pause. Credits only accumulate; `--minutes` keeps them. |
| `asset <dir> add --id <id> --role hero\|prop\|environment --source image-to-3d\|image\|blender\|procedural\|user [--state …] [--files a,b] [--note "…"]` / `asset <dir> update --id <id> [--state planned\|generating\|ready\|placed\|failed] [--files …] [--note "…"]` | The ledger. Moves no files; `--files` are project-relative. |
| `judge-prompt <dir> [--round N]` | Writes the complete brief for a fresh judge to `rounds/NN/judge-brief.md` and prints it, first line = the file's absolute path: rubric, absolute paths of target and capture, the project brief, the previous verdict (with the instruction to reuse a persisting gap's `id`), the exact output schema, and where to write `verdict.json`. Hand the subagent the path. |
| `bridge <dir> --refresh` | Re-copies `lucid-bridge.js` into `scene/` after a skill update. |

Exit states (`status` → `evaluation.exit`): `dreaming`, `continue`, `done`,
`optimize-fps`, `stall-approaching`, `stalled`, `budget-exhausted`. Their
meaning and what to do about each is in `judging.md`.

## `image-to-3d.mjs` — fal image-to-3D jobs (needs the fal key)

`node {SKILL_PATH}/scripts/image-to-3d.mjs check|submit|collect <jobs.json> [--concurrency 4]`

The job file (`assets/fal-jobs.json`; paths relative to the file) lists jobs
with `id`, `endpoint`, `image`, `output` and an endpoint-specific `input`:

| Role | `endpoint` | `input` |
|---|---|---|
| architecture, characters, hero props, trees | `tripo3d/h3.1/image-to-3d` | `{ "texture": true, "pbr": true, "face_limit": 200000 }` |
| small props and set dressing | `fal-ai/trellis` (no `/image-to-3d` suffix) | `{ "mesh_simplify": 0.95, "texture_size": 1024 }` |

- `check` is offline and never writes: it validates ids, endpoints, the
  option mix, image magic bytes and payload size. Run it before every submit.
- `submit` posts every ready job, records the returned queue URLs, skips images
  that do not exist yet (`waiting-for-image`) — so run it again as cut-outs
  land. It never resubmits a job that has a `request_id`, is `submitting`, or
  is `submission-uncertain`.
- `collect` is one status / result / download pass; re-run it while you do
  other work. `downloaded` means a complete GLB is on disk, not that it looks
  right.

Recovery states, read `state` + `error_stage` before deciding anything:

| state | Meaning | What you do |
|---|---|---|
| `rejected` | fal refused the request before creating a job (400/401/403/404/405/422) | Fix the endpoint / input / key and submit again |
| `not-submitted` | the connection never opened | Submit again when the network is back |
| `submitting` / `submission-uncertain` | the request left and lost its answer; a paid job may exist | Reconcile against fal's request history; never clear ids or URLs to get past the guard |
| `result-error` | the queue finished but the result could not be fetched | Retry `collect`; do not regenerate |
| `download-error` | the result was fetched but no complete GLB was saved | Retry `collect` |

A replacement job for a failed one gets a new `id` and may reuse the `output`
path; two live jobs must never share one output path. A stale `<jobs>.lock`
after a crash is removed by hand only when no run is active.

## `glb.mjs` — read and clean GLBs

`node {SKILL_PATH}/scripts/glb.mjs inspect|resize|simplify|optimize|unpack|ratio-for …`

`inspect` is pure JS (no download, no GPU); the rewriting subcommands wrap
`@gltf-transform/cli@4.5.0` through `npx --yes` (network on first use).

| Subcommand | What it does |
|---|---|
| `inspect <glb> [--json]` | Bytes, meshes, primitives, triangles, vertices, nodes, skins/joints, animations, materials (doubleSided, metallic/roughness), textures and images with pixel sizes read from their headers, `extensionsUsed/Required`, world bbox with size and longest axis, and `warnings[]`. Normalized integer accessors are decoded per the glTF rule, so a quantized model reports its real size. |
| `resize <in> <out> --size 1024` | Textures only; before/after bytes and largest texture. |
| `simplify <in> <out> --ratio R [--error 1]` | Before/after triangles. "Did not drop" is a real state (lattices, foliage cards), not a failure. |
| `optimize <in> <out> [--texture-size 1024] [--simplify-ratio R] [--simplify-error 1]` | Quantize compression on purpose (no runtime decoder). Simplification only with `--simplify-ratio`; the tool's own default error bound (0.0001) would stop the decimator before the ratio, so the wrapper defaults it to 1. |
| `unpack <in> <out>` | Decodes meshopt/Draco to plain buffers — required before Blender can import and before `inspect` can measure heights. |
| `ratio-for --role character\|vehicle\|prop\|building\|environment\|vegetation` | Recommended simplify ratio with a reason (character/vehicle 0.35, prop 0.3, building 0.45, environment 0.5, vegetation 0.75). |

Warning codes from `inspect`: `double-sided-all`, `texture-over-2048`,
`needs-decoder`, `quantized` (informational), `no-uv`, `no-materials`,
`thin-pole-height`, `unit-normalized` — their meaning is in `three-scene.md`.
Two things to expect in the output: with `needs-decoder` set, the height
distribution (and so `thin-pole-height`) is skipped until you `unpack`; and
`optimize` prunes solid-colour textures by default, so `largestTexture` can
honestly go from `4096x4096` to `none`.

## `texture.mjs` — the maps an image model does not produce

`node {SKILL_PATH}/scripts/texture.mjs info|normal|roughness|tile-check|make-tileable|resize|pack-orm …`

Deterministic pixel arithmetic, Node built-ins only (its own PNG codec: 8-bit
and 16-bit greyscale/RGB/RGBA, non-interlaced; palette and interlaced files
are refused by name).

| Subcommand | What it does |
|---|---|
| `info <png>` | Size, bit depth, colour type, alpha, bytes, and the whole tile-check estimate. |
| `normal <albedo> <out> [--strength 2] [--blur 1] [--invert-y]` | Tangent-space normal map from luminance (Sobel, wrap sampling; flat = `(128,128,255)`; OpenGL/glTF +Y up, `--invert-y` for DirectX). `--strength=-2` (with the `=`) inverts relief for pale-mortar / light-grout surfaces; `relief` under 1 means no usable relief. |
| `roughness <albedo> <out> [--min 0.35] [--max 0.95] [--invert]` | Darker and busier → rougher (`0.65·(1−L) + 0.35·detail`), mapped into `[min, max]`. |
| `tile-check <png>` | `seamScore` (edge step relative to the mean interior step; 0 = perfect wrap, threshold 2), `tileable`, `worstEdge`, and `structured` when the seam is the texture's own structure (bricks, planks) rather than a defect. |
| `make-tileable <in> <out> [--blend 0.12]` | Half-offset + mirror cross-fade over `blend × size`; warns on a structured or already-tileable input (it would smear real structure). |
| `resize <in> <out> --size N` | Box-filter downscale only; non-power-of-two sizes are a warning, upscaling is refused. |
| `pack-orm <ao\|-> <roughness> <metallic\|-> <out>` | R = AO (255 when `-`), G = roughness, B = metallic (0 when `-`): the glTF metallicRoughness layout. |

## `blender.mjs` — headless Blender, the only way in

`node {SKILL_PATH}/scripts/blender.mjs doctor|run|render-views|convert|probe …`

| Subcommand | What it does |
|---|---|
| `doctor [--json] [--strict]` | How Blender was found (flag → `$BLENDER_PATH` → PATH → platform locations), its version, and whether gltf-transform is cached. Exit 0 as a report; `--strict` exits 1 when Blender is missing. |
| `run <script.py> [--no-kit] [--timeout 600] [--json] [-- <args…>]` | `<blender> --background --factory-startup --python <script.py> -- <args…>` with `blender/` on `sys.path` so the script can `import kit` (`--no-kit` leaves the path alone); Blender's output streams through with a `[blender]` prefix and its exit code is propagated (124 on timeout). |
| `prep <in> <out.glb> [--yaw <deg>] [--height <m> \| --longest <m> \| --width <m>] [--decimate <ratio>] [--merge] [--thin <name,name>] (`--thin` matches object names as imported, before `--merge` fuses them; the decision lives on the materials and survives the merge)` | The entry checklist in one pass: import (glb/gltf/fbx/obj) → optional merge of loose shells → yaw → bake rotation and scale → feet to y = 0, centred → normalize by exactly one dimension → optional decimate → backface culling on except `--thin` parts → export, then the inspect checklist. Two dimensions are refused before Blender starts. |
| `kit` | Prints `blender/kit.py`'s API (20 functions: `reset`, `import_model`, `mesh_objects`, `world_bbox`, `yaw`, `apply_transforms`, `ground`, `normalize`, `decimate`, `single_sided`, `merge_fragments`, `bevel`, `array`, `boolean`, `set_material`, `export_glb`, …) and how a script imports it. Needs no Blender. `blender/make_prop.py` is the template to copy for a hard-surface prop. |
| `render-views <glb> <out.png> [--size 512]` | Six orthographic views on one 3×2 sheet plus a `<out.png>.json` sidecar with the tile order. Verifies the sheet is over 10 KB. |
| `convert <fbx> <out.glb> [--yaw <deg>] [--texture-size 1024] [--double-sided]` | FBX → GLB with the yaw baked into the vertices and backface culling on; then inspects the result and prints the checklist. `helper.yawBaked: false` means the rotation stayed on a node (parented or shared meshes) — read the `!` line. |
| `probe <glb\|fbx>` | What Blender sees after import: objects with triangle counts (and whether they are the importer's own `glTF_not_exported` helpers), armatures and bones, world bbox in glTF axes, images. |

Writing a script for `run`: read arguments with
`sys.argv[sys.argv.index('--') + 1:]`, print a line per step, `sys.exit(1)`
after an `ERROR:` line on refusal, and verify the files you write by size —
Blender can exit 0 after an uncaught exception. `--background` has no OpenGL
context: Workbench and EEVEE render, viewport overlays do not. Probe an
operator with `kit.operator_exists("wm.fbx_import")` (it calls
`bpy.ops.<mod>.<name>.get_rna_type()`, which raises `KeyError` when the
operator is missing); `hasattr(bpy.ops.wm, x)` is always true, and
`bpy.types.<MODULE>_OT_<name>` misses every built-in C++ operator.

Reading the six-view sheet: a tile's name (`-Z front`, `+X right`, `+Z back`,
`-X left`, `+Y top`, `iso`) is the glTF direction from the model's centre TO
the camera — the tile shows the face that points that way. The model's front
is whichever tile shows its face; write that direction down as the yaw to
bake. `front`/`back` in the tile names are nominal, not a claim about the
model.

## Negative numbers on the command line

`--yaw -90` works: every script joins a negative number onto the option
before it parses, so `--yaw -90` and `--yaw=-90` mean the same thing. A
negative value directly after a boolean flag (`--merge -5`) is still joined
onto that flag and rejected, which is the right answer.

