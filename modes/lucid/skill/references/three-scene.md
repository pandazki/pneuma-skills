# The scene — Three.js correctness anchors

The scene is a self-contained static site under `<project>/scene/`. The viewer
serves it from `/content/<project>/scene/index.html`; a stranger could serve
the same directory with any static file server. Everything below is a
correctness anchor learned from real projects that put AI-generated GLBs into
Three.js: each one has a symptom that looks like something else.

## Layout and loading

- `index.html` loads `./lucid-bridge.js` first, then an importmap
  (`"three": "./vendor/three.module.js"`, `"three/addons/": "./vendor/addons/"`),
  then `./main.js` as a module. All paths relative — the page runs from a
  sub-path in the viewer and must keep running from any host.
- Vendor exactly the six files `lucid.mjs vendor-three` copies, from one
  version. `BufferGeometryUtils.js` is not optional even if you never import
  it: `GLTFLoader` imports it, and the failure looks like a blank page with one
  404, not like a missing loader. `SkeletonUtils.js` is what lets you clone
  rigged models. Mixed versions fail exactly like missing files.
- Never load models over `file://` and never point the importmap at a CDN for
  the product — the viewer, the hosted player and any sub-path host all serve
  relative paths; a CDN is one more machine that has to be up.
- Register with the bridge the moment the renderer exists:
  `window.lucid?.register({ renderer, scene, camera })`, and wrap asset loading
  in `window.lucid?.setLoading(true)` … `setLoading(false)`. Without the
  registration the viewer cannot capture a real frame or measure fps, and the
  loop is blind.

## Lighting: the environment map is not optional

PBR materials with any metalness render **near-black on a light background**
when `scene.environment` is unset — diffuse is suppressed and there is nothing
to reflect. It hides on dark backgrounds and surfaces the day you brighten the
scene, and it looks exactly like a broken model. The starter's `studioEnv()`
(a canvas gradient with a dark bottom, wrapped as an equirectangular
`CanvasTexture` through `PMREMGenerator`) fixes it with no external HDR file.
Two details are what make it work: the gradient **must have a dark portion**
(a white-to-light-grey map reflects only brightness and the picture goes flat
and weightless), and a light-background scene should **not** enable ACES
tone mapping (it presses the background to grey). The other honest route is
`material.metalness = 0; material.roughness ≈ 0.9` — a matte look is a real
look; black is not.

## Scale and origin: measure, never assume

AI-generated GLBs arrive normalized to **longest edge ≈ 1.0 unit** — not
height: a bench is 1.0 × 0.55 × 0.41, a taxi 0.52 × 0.57 × 1.0. Their origins
also differ: some sit at the geometric centre, some at the feet. Treat every
asset as unknown and normalize on load:

```js
const box = new THREE.Box3().setFromObject(root);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
root.position.sub(new THREE.Vector3(center.x, box.min.y, center.z)); // feet to y = 0
root.scale.setScalar(targetHeight / size.y);
```

Then ask: **which dimension aligns this asset with its neighbours?** A street
tree aligns by crown width (spacing), a building by façade width, a character
by eye height. Normalizing a round-crowned tree by height turned a row of trees
into a solid hedge. And check `glb.mjs inspect` for `thin-pole-height`: a
bounding box carried by an umbrella pole or an antenna makes the real body
half size when normalized by total height.

`Box3.setFromObject` on a **SkinnedMesh** is stale — its bounds cache does not
follow the pose, so a rigged character can be scaled until only its shoes are
visible. Read the true size from the GLB (`glb.mjs inspect` prints the
POSITION bounds) and scale from a known number.

## Orientation: only a picture can tell you

Bounding boxes cannot tell front from back — a 90° yaw swaps X and Z and a
180° yaw changes nothing. Different asset families face different ways
(+Z, −Z, +X are all common, and rigged presets differ from static ones).
Render six views with `blender.mjs render-views` (front/back/left/right/top/
iso) and read the yaw off the sheet; then **bake the rotation into the
vertices** (`blender.mjs convert --yaw`) rather than leaving it in a node
matrix — a loader that measures with node matrices but normalizes raw geometry
silently misplaces a rotated node, with a clean console.

## Rigged models

- Clone with `SkeletonUtils.clone()`, never `object.clone()` — plain clones
  share one skeleton and every instance moves in lock-step like a parade.
- One `AnimationMixer` per instance, and offset the phase
  (`mixer.setTime((x * 0.37 + z * 0.11) % clip.duration)`) or the parade is
  back.
- Strip root-motion position tracks from walk cycles and let gameplay code
  move the character; a clip with a 1.3-unit hip translation on a 1-unit
  person snaps back to its origin at every loop.

## Performance: it is the textures

The reflex when a scene stutters is to cut triangles. Measure first: a scene
whose whole render chain took 0.4 ms of GPU time and 1.5 ms of JS per frame at
5 megapixels was still unusable — because 17 assets carried 8192² PBR textures
(one 8K RGBA image is ~268 MB decoded, ~358 MB with mipmaps; 5 GiB in total)
and the GPU spent every frame swapping textures. `glb.mjs resize --size 1024`
(2048 for a hero the camera gets close to) removed the stutter and nobody
could see the difference at gameplay distance. Budget textures before
triangles; `glb.mjs inspect` prints every texture's size and flags
`texture-over-2048`.

Other cheap wins, in the order they are worth checking: disable canvas
antialias when an `EffectComposer` renders to a target (MSAA on the canvas
does nothing for the scene); shadow maps not re-rendered every frame for
static lights; bloom at half resolution; adaptive resolution with a wide dead
band (drop below ~48 fps, restore above ~90) so a machine steady at 50 fps
does not oscillate and rebuild buffers.

Measure with the bridge (`get-scene-state` → `fps`, `frameMs`, `drawCalls`,
`triangles`) with nothing else on the GPU; a headless recorder or another
tab's WebGL doubles the variance and the minimum is the only trustworthy
number. A 0.4 ms difference between two runs is noise, not an improvement.

## GLB hygiene before an asset enters the scene

Run `glb.mjs inspect` on every model and read the warnings:

- `needs-decoder` — `EXT_meshopt_compression` / draco need a runtime decoder;
  `glb.mjs unpack` strips meshopt (also required before Blender can import).
- `double-sided-all` — every face is shaded twice; a Blender export default.
  Only thin things (leaves, flags, signs) need `doubleSided`.
- `quantized` — `KHR_mesh_quantization` stores int16 positions with
  `normalized: true`; a parser that ignores the flag reads a 1-unit model as
  32767 units. Three.js handles it; your own maths must too.
- `no-uv` — a "geometry only" export cannot be textured later; regenerate.
- `unit-normalized` — needs a real-world scale in the scene (see above).

## Checks that run inside the page

The viewer's `capture` is the WebGL frame: HTML overlays are not in it, and
nothing outside the page can click, drag or scroll for you — there is no
browser to drive and no debugger to attach. To verify controls, timing or any
behaviour, write a temporary module the page imports, dispatch synthetic
pointer / wheel / key events there, measure what you need, and publish the
result with `window.lucid.note("controls-check", { pass, … })`;
`get-scene-state` returns it under `notes`. Remove the module and reload
before judging. Synthetic events prove your handlers, not the OS pointer —
say so when you report.

## Self-check before you judge

- The loading overlay must be gone. Four rounds were once spent tuning
  materials on a frame that was a white `#load` div over the whole canvas.
  If a capture is uniformly washed out, check for an overlay before touching
  materials.
- `get-scene-state.ready` must be true and `errors` empty; `bridge: false`
  means the page does not include the bridge — fix that before anything else.
- Every `scene.add` has an owner; an orphaned mesh floating in frame is a
  classic "why is that there" gap.
