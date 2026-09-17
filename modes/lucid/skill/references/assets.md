# Assets — the sourcing ladder and the Blender boundary

Work down the ladder for every asset that matters in the target. Do not
default to procedural geometry to save time or because it feels safer; the
rungs exist because each one produces a materially better-looking result than
the one below it for the kinds of things it is good at. The one honest
exception is style: when the user asked for voxel, low-poly or blocky
construction, geometry built from primitives *is* the faithful rendering of
that style, and a photoreal image-to-3D mesh would fight it — choose
procedural on purpose then, and say so in the ledger note.

What "do not download assets" means: existing art fetched from the internet
(rung 1). A model generated from your own cut-out of the target (rung 2) is
not a download, and the vendored three.js library is a dependency, not an
asset. Record every asset in
the ledger (`lucid.mjs asset <project> add …` / `update …`) so the viewer and the user can see
where each thing came from and whether it landed.

## 1. Download an existing asset

Only if the user explicitly allowed downloading assets. If unspecified, assume
not allowed. When allowed and you find the right model, this is the cheapest
rung.

## 2. Image-to-3D (needs the fal key)

{{#imageTo3dEnabled}}
Available in this session. This is the strongest rung for anything organic,
ornate or characterful — statues, characters, hero props, gates, lanterns,
trees — and it is where the target's look comes from: a model generated from a
cut-out OF THE TARGET carries the target's materials and silhouette into the
scene, which no primitive ever will. It does not count as "downloading
assets".

**The recipe, per asset** (every command from the workspace, paths
project-relative):

1. **Cut it out of the target.** Give the image tool `target.png` as the
   reference and ask for exactly that object, alone, on a flat solid
   background, same style and materials as in the target, front three-quarter
   view with all features visible; for a hero, ask for four views in one pass
   — front, left, back, right — as separate images (the multiview recipe).
   Save each under `<project>/assets/<id>.png` (or `<id>-front.png` …).
2. **Plan the job.** `node {SKILL_PATH}/scripts/image-to-3d.mjs recipe hero`
   (or `hero-multiview`, or `prop` for small dressing) prints the job JSON;
   paste it into `<project>/assets/fal-jobs.json` with the id, image and
   `output` (`../scene/models/<id>.glb`) filled in. The hero recipe already
   sets `auto_size` (real-world metres — no guessing the scale),
   `orientation: "align_image"` (the model's front follows the cut-out's,
   which is NOT the same as facing +Z — one `blender.mjs render-views` sheet
   still confirms the yaw before you bake it), and `detailed` geometry and
   texture.
3. `node {SKILL_PATH}/scripts/image-to-3d.mjs check <project>/assets/fal-jobs.json`
   (offline) → `submit` → keep building → `collect` a minute or two later.
   `downloaded` means a valid file landed; `format: "fbx"` (a `quad` job)
   means run `blender.mjs convert` first.
4. **Before it enters the scene:** `glb.mjs inspect` (textures over 2048 →
   `glb.mjs resize --size 1024`; `needs-decoder` → `glb.mjs unpack`), then
   `blender.mjs prep <in> scene/models/<id>.glb --height <m>` (or `--width` /
   `--longest`) to ground it, size it by its aligning dimension, merge loose
   shells and make it single-sided in one pass — even with `auto_size`, the
   prep is what puts the feet at y = 0.
5. **Load it** with the starter's `assets.js`: `loadModel('./models/<id>.glb',
   { height })`, `instance(...)` for copies, `playClip(...)` when it is rigged.
   Record it: `lucid.mjs asset <project> update --id <id> --state placed`.

| Recipe | Endpoint | When |
|---|---|---|
| `hero` | `tripo3d/h3.1/image-to-3d` | one cut-out; architecture, characters, hero props, trees (~$0.30) |
| `hero-multiview` | `tripo3d/h3.1/multiview-to-3d` | 2–4 views of the same object, front first; the geometry you cannot afford to get wrong |
| `prop` | `fal-ai/trellis` | small props and set dressing (~$0.02) |

Options worth knowing beyond the presets (`image-to-3d.mjs --help` has the
glossary): `face_limit` caps the mesh for screen size and instance count;
`quad: true` asks for quad topology (retopology for rigging or sculpt-clean
silhouettes; the result is an FBX); `model_seed` / `texture_seed` make a rerun
reproducible; `texture_alignment: "geometry"` when the cut-out's lighting
should not be baked into the albedo.

The script never resubmits an uncertain job; read `state` and `error_stage`
(`references/scripts.md`) before deciding anything. Jobs take one to two
minutes — submit as each cut-out lands and keep building while they run.
{{/imageTo3dEnabled}}
{{#imageTo3dDisabled}}
Not available in this session (no fal.ai key). Say so once if the target
needs organic or ornate assets that only this rung produces well, and move to
rung 3; the user can add a key in the launcher.
{{/imageTo3dDisabled}}

### What comes back is a static mesh

Image-to-3D returns a textured mesh with no skeleton and no clips. When the
brief asks for a moving character, say so before that mesh becomes the
character pipeline: the honest options are vertex deformation for a gait and
cloth, a procedural rig you build in `main.js`, or a rigged model the user
supplies. Auto-weighting a fragmented generated mesh in Blender is the
thing `assets.md` warns against, and Tripo's own rig/retarget API is not
on this ladder. Record the limitation in the ledger note and in the report.

## 3. Blender, headless, through `blender.mjs` only

Two jobs, both programs:

**Every incoming model goes through `prep`** — whatever rung produced it:

```
node {SKILL_PATH}/scripts/blender.mjs prep <in.glb|fbx|obj> <project>/scene/models/<id>.glb --height <m> [--yaw <deg>] [--merge] [--decimate <ratio>] [--thin leaf,flag]
```

import → optional `--merge` of loose shells (AI meshes are hundreds of them;
merge unless the model is rigged) → yaw → rotation and scale baked into the
vertices → feet to y = 0, centred → normalized by exactly ONE of `--height`,
`--width`, `--longest` (the dimension that aligns it with its neighbours) →
optional decimation → backface culling on except `--thin` parts → export,
then the same checklist `glb.mjs inspect` prints. A model that went through
`prep` loads with `loadModel(url)` and no dimension at all.

**Hard-surface pieces come from the kit.** Arches with mouldings, braziers,
stairs, columns, modular wall segments — the things primitives make look like
toys — are built in a script you copy from the template:

```
cp {SKILL_PATH}/scripts/blender/make_prop.py <project>/assets/brazier.py   # edit shape, sizes, materials
node {SKILL_PATH}/scripts/blender.mjs run <project>/assets/brazier.py -- <project>/scene/models/brazier.glb
node {SKILL_PATH}/scripts/blender.mjs kit                                   # the helper API, one line per function
```

`import kit` gives a script `reset`, `import_model`, `bevel`, `array`,
`boolean`, `set_material` (colour, roughness, metallic, texture), `ground`,
`normalize`, `decimate`, `merge_fragments`, `single_sided`, `export_glb` and
the rest; every function prints one line. The template builds a bevelled,
arrayed, boolean-cut brazier and exports it grounded — change the shape, keep
the shape of the script. Texture the result with the image tool plus
`texture.mjs` maps.

What Blender is NOT for here, measured: decimation (`glb.mjs simplify` is
equivalent and needs no 300 MB dependency), texture downscaling (`glb.mjs
resize` touches only the image bytes), auto-weight rigging of an AI mesh
(hundreds of disconnected shells without edge loops — the spine drags the
legs), splitting an AI mesh into parts (loose parts are fragments, not
wheels). Never open Blender interactively, never call the binary directly:
the wrapper is what makes a run observable and portable. `--background` has
no OpenGL context: Workbench/EEVEE renders work, viewport overlays do not.

## 4. Procedural geometry

Build it in code, and still texture it with the image tool (albedo, normal,
skybox). Do this only when it is the last rung standing, or when it genuinely
produces the closest match — architecture made of repeated modules, terrain,
water, particles, UI. Do not do it to save time.

## Textures, always — and the maps the image tool cannot make

Whichever rung produced the geometry, albedo textures come from the image
tool, not from noise functions; skyboxes too. Ask for tileable, flat-lit,
top-down material images at the size you will actually sample (1024² is
enough for most surfaces), one material per image. A material without a
texture where the target has one is a `materials` gap the judge will name
every round — and an albedo alone reads flat under real-time light. Derive
the rest with `node {SKILL_PATH}/scripts/texture.mjs` (pure arithmetic over
the pixels, no model, no binary):

1. `texture.mjs tile-check albedo.png` — `tileable: false` with a plain
   seam means `texture.mjs make-tileable albedo.png albedo.png`; a
   `structured` verdict (bricks, planks) means the seam is real structure —
   look at a 2×2 preview before you "fix" it.
2. `texture.mjs normal albedo.png normal.png --strength 2` — look at the
   result: if grooves read as ridges (pale mortar, light grout) re-run with
   `--strength -2`. `relief` under 1 in the report means the albedo has no
   usable relief.
3. `texture.mjs roughness albedo.png rough.png` — darker and busier reads
   rougher; `--invert` for polished dark stone.
4. `texture.mjs pack-orm - rough.png - orm.png` → the glTF
   metallicRoughness layout; load with `textureFrom(url, { srgb: false })`
   for normal / ORM and `srgb: true` for albedo.
5. `texture.mjs resize` to 1024² (hero 2048²) before it enters the scene;
   textures, not triangles, are the memory budget.

## Before an asset enters the scene — the checklist

1. `glb.mjs inspect` — triangles, textures and their sizes, warnings.
2. `glb.mjs unpack` if `needs-decoder`; `glb.mjs resize --size 1024` if any
   texture is over 2048 (hero 2048).
3. Orientation: image-to-3D with the `hero` recipe already faces the way the
   cut-out does; for anything else `blender.mjs render-views` and read the
   yaw off the six views.
4. Decide the alignment dimension (crown, façade, eye height) and the size in
   scene units, then `blender.mjs prep … --height|--width|--longest <m>`
   (with `--yaw` when needed); write both into the ledger note.
5. `lucid.mjs asset <project> update --id <id> --state placed` once it renders in the capture.

## Files before references, and what a reload does not do

The viewer reloads the scene on its own when a scene CODE file changes
(html, js, mjs, css, json), 1.5 s after the last write. Two consequences:

- Reference a model or texture from code only once the file is on disk. A
  `main.js` that names a GLB still being generated reloads into a 404 that
  looks like broken work; write the reference when `collect` reports
  `downloaded`, or keep it behind a guard until then.
- Replacing a texture or a model under `scene/` with the same name reloads
  nothing: the running scene keeps the old bytes in GPU memory, and a capture
  shows the old picture even though the new file is on disk. After swapping
  a binary, call `reload-scene`; or give the new file a new name and change
  the reference, which reloads anyway.

