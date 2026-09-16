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
ornate or characterful — buildings, characters, hero props, vegetation. It
does not count as "downloading assets".

Produce the **input image from the target**: give the image tool the target
and ask for a clean cut-out of exactly that object on a solid or transparent
background, same style, same viewing angle as a turnaround would want (front
three-quarter, all features visible). That keeps the model aligned with the
target instead of reimagined. One object per image.

Two recipes, chosen per role:

| Role | Endpoint | Starting input | Cost (approx.) |
|---|---|---|---|
| hero / architecture / characters / trees | `tripo3d/h3.1/image-to-3d` | `{ "texture": true, "pbr": true, "face_limit": 200000 }` | ~$0.30 |
| small props and dressing | `fal-ai/trellis` | `{ "mesh_simplify": 0.95, "texture_size": 1024 }` | ~$0.02 |

Plan them in `assets/fal-jobs.json`, then `image-to-3d.mjs check` (offline),
`submit` (as soon as each cut-out exists — do not wait for the whole batch),
and `collect` later while you keep building. Jobs take one to two minutes.
The script never resubmits an uncertain job; read `error_stage` before
deciding anything. `downloaded` means a valid GLB landed, not that it looks
right: inspect it (`glb.mjs inspect`), render six views
(`blender.mjs render-views`) to read its orientation, and expect to fix scale
and yaw on the way in (see `three-scene.md`).

Choose `face_limit` for screen size and instance count; H3.1's automatic
count can be very dense. Resize textures to 1024² (hero 2048²) before the
model enters the scene.
{{/imageTo3dEnabled}}
{{#imageTo3dDisabled}}
Not available in this session (no fal.ai key). Say so once if the target
needs organic or ornate assets that only this rung produces well, and move to
rung 3; the user can add a key in the launcher.
{{/imageTo3dDisabled}}

## 3. Model it in Blender (headless, through `blender.mjs` only)

Blender earns its place for what the other rungs cannot do: modelling a
specific hard-surface object from scratch with a Python script, converting an
FBX to GLB, giving a static mesh an armature, baking a normal map, assembling
parts, hero clean-up. Drive it only through `blender.mjs run <script.py>`;
never open it interactively and never call the binary directly — the wrapper
is what makes the run observable and portable.

What is measured, so you do not reach for Blender out of habit:

- **Decimation is not a reason.** On the same asset, Blender's decimate and
  `gltf-transform simplify` produced equivalent meshes (6,772 vs 6,781 faces,
  365 vs 369 KiB); the command line is faster and needs no 300 MB dependency.
  Use `glb.mjs simplify` / `optimize` for that.
- **Texture downscaling is not a reason.** `glb.mjs resize` changes only the
  image bytes; a Blender round-trip re-orders vertices, recomputes normals and
  flips materials to double-sided by default.
- **Auto-weights on AI meshes do not work.** Generated meshes are hundreds of
  disconnected fragments without edge loops; `ARMATURE_AUTO` bends the whole
  body when you rotate the spine. Rigging belongs to the image-to-3D
  provider's own rigging, or to a retopologized mesh.
- **Connected components are not semantic parts.** Splitting a generated car
  by loose parts gives ~350 fragments, none of them a wheel.

Writing a Blender script for an asset: read the argument list after `--`
(`sys.argv[sys.argv.index('--') + 1:]`), print a line per step (headless has no
other observability), build with `bpy` primitives and modifiers, assign
materials with `use_backface_culling = True` unless the surface is genuinely
thin, export GLB with `export_apply=True`, and verify the output by size, not
exit code. Then texture it with the image tool (albedo, and a normal map when
the surface needs relief) — generated textures look better and take less time
than procedural noise, and a flat-colour substitute is never acceptable when
the target shows a material.

`--background` has no OpenGL context: Workbench/EEVEE renders work, viewport
overlays do not. `render_views.py` is the only picture you need of a model.

## 4. Procedural geometry

Build it in code, and still texture it with the image tool (albedo, normal,
skybox). Do this only when it is the last rung standing, or when it genuinely
produces the closest match — architecture made of repeated modules, terrain,
water, particles, UI. Do not do it to save time.

## Textures, always

Whichever rung produced the geometry, textures and normal maps come from the
image tool, not from noise functions; skyboxes too. Ask for tileable, flat-lit
images at the size you will actually sample (1024² is enough for most
surfaces). A material without a texture where the target has one is a
`materials` gap the judge will name every round.

## Before an asset enters the scene — the checklist

1. `glb.mjs inspect` — triangles, textures and their sizes, warnings.
2. `glb.mjs unpack` if `needs-decoder`; `glb.mjs resize --size 1024` if any
   texture is over 2048 (hero 2048).
3. `blender.mjs render-views` — read the front from the six views; note the
   yaw. Bake it (`blender.mjs convert --yaw` for FBX input, or rotate the
   geometry once at load and never again).
4. Decide the alignment dimension (crown, façade, eye height) and the target
   size in scene units; write both into the ledger note.
5. `lucid.mjs asset <project> update --id <id> --state placed` once it renders in the capture.
