# Sprite mode — seamless loop workflow (keyframe → first-last clip → transparent animation)

Status: design brief, 2026-09-22. Owner request: add a workflow to `sprite`
that reproduces the "3D icon that loops forever" effect — a GPT Image
keyframe, a Seedance 2.5 first-last clip with the *same* image at both ends
(so the loop closes by construction), video matting to a transparent
animation, and frontend-ready formats (WebP / APNG / WebM / Lottie), with
optional frame interpolation to 60 fps. The reference clip the owner supplied
(`7gXGzPMovoc0dIk7.mp4`, a claymation flame on grey) is the quality bar.

Every implementation task reads this document; the task sections at the end
pin the contracts the parallel workers must agree on. Mode version after this
work: **0.3.0**.

## What the reference clip measures as

| | |
|---|---|
| clip | 1440×1440, h264, 24 fps, 122 frames, 5.083 s, grey plate `#808080`-ish |
| frame 0 vs frame 121 (silhouette diff, `Σ|a−b| / Σ max(a,b)` at 96 px) | **0.0065** |
| median frame-to-frame change | 0.020 (max 0.069) |
| opening / closing hold | none — the flame moves from frame 1 and never freezes |
| motion shape | two slow sways (peaks of 0.19 and 0.17 away from frame 0 at ~1.2 s and ~3.6 s), a soft return |

So a loop that reads as seamless has a seam a third of a normal step, no
holds, and about 100–120 full-rate frames. Those are the numbers the new
`inspect` report has to print, and the bar the trial has to hit.

Two things the existing pipeline cannot do today, measured on this clip:

- `sprite-sheet.mjs contact` **crashes on it**: `probeLastFrameTime` returns
  the exact PTS of the last frame (121/24 = 5.041667 s) and `ffmpeg -ss` at
  that exact float decodes nothing (`-ss 5.041` works, `-ss 5.0417` writes no
  file, exit 0). The clamp has to sit *before* the last frame, not on it.
- `from-video` samples ≤ 100 frames by seeking; a UI loop needs every frame
  (96–122 at 24 fps, up to 300 at 60 fps) decoded in one pass, unaligned.

## The model: a `loop` is a kind of motion

A **loop motion** (`kind: "loop"`) is a motion whose deliverable is a
seamless, full-rate, transparent animation for a UI — not an atlas for a
game engine. Everything else about the mode stays: one character per content
set, `project.json` written only by `sprite-project.mjs`, pixels written only
by `sprite-sheet.mjs`, the stage plays `frames[]` at the motion's fps, the
agent looks before it claims.

What differs from a sprite motion:

| | sprite motion (today) | loop motion (new) |
|---|---|---|
| frames | 8–16, evenly sampled or sliced, feet-aligned, cleaned | every frame of the loop window (≤ 400), **unaligned, uncleaned** — the movement *is* the content, a bobbing icon must keep bobbing, sparks must keep flying |
| frame files | `frames/NN.png` (2 digits, ≤ 100) | `frames/NNN.png` (3 digits) |
| plate removal | colorkey (`from-video`) or BiRefNet on the sheet | colorkey + despill on a chroma plate **or** the clip's own alpha (VEED / Bria matting) |
| deliverables | `sheet.png` + `atlas.json`, `preview.gif`/`.webp` | `loop.webp`, `loop.apng`, `loop.webm` (VP9 alpha), `loop.json` (Lottie image sequence); no atlas, no GIF |
| quality gate | anchor / body drift, scale drift, clipped cells | **seam vs step** (does the loop close), alpha coverage, empty frames, export sizes |
| source clip | i2v on chroma green | **first-last with the same keyframe at both ends**, on chroma green (default) |
| interpolation | — | optional: free `minterpolate` (loop-wrapped) or paid Topaz on fal |

Decisions taken here (the owner can overturn any of them):

| # | Decision | Choice and why |
|---|---|---|
| L1 | Concept name | `Motion.kind?: "loop"` (absent = sprite). `source` keeps meaning "how the frames were obtained" (`video`); `kind` says what the motion *is for*. |
| L2 | Frames are registered assets | Yes, one asset + provenance edge per frame, as today (`<motion>-frame-NNN`). The PNG sequence is itself a deliverable (canvas / Rive / engines), the stage plays it, and one bookkeeping path is better than two. Cap 400 frames. |
| L3 | Plate | Chroma green is the default plate for the keyframe flatten and the clip prompt, because the free colorkey path is proven in this mode (`#08f00d` / `#04ed0a` measured) and the paid matting endpoints work on green too. Whether colorkey+despill is *good enough at 1:1 on soft 3D shading* is what the trial decides; the docs record the measured default. |
| L4 | Matting endpoints | Both `veed/video-background-removal` ($0.0225 / 30 frames with edge refinement, `subject_is_person: false` for an icon) and `bria/video/background-removal` ($0.14 / s, `Transparent`, ProRes 4444) behind one script, because the trial has to compare them and neither has a track record here. Sources: https://fal.ai/models/veed/video-background-removal , https://fal.ai/models/bria/video/background-removal/api |
| L5 | Interpolation | `sprite-sheet.mjs loop --fps 60` = ffmpeg `minterpolate`, loop-wrapped, on the plate clip (free). `interpolate-video.mjs` = `fal-ai/topaz/upscale/video` with `target_fps` ($0.01 / s ≤ 720p, doubled at 60 fps), the tool the reference author used. Interpolation runs **before** matting; `loop` refuses `--fps` on an alpha clip and says so. Source: https://fal.ai/models/fal-ai/topaz/upscale/video |
| L6 | Lottie | Plain Lottie JSON with base64-embedded PNG image layers (one layer per frame). Plays in lottie-web and dotLottie players; no zip writer. `.lottie` (dotLottie) is a follow-up if asked. |
| L7 | Keyframe bookkeeping | New `set-keyframe` (mirrors `set-sheet`): `<motion>-keyframe` (as generated, white plate) and `<motion>-keyframe-alpha` (BiRefNet cut-out). The green flatten is a working file, not an asset (same rule as `first.png` today). |
| L8 | Derived clips | `add-video --derived-from <videoId> --op matte|interpolate --model veed|bria|topaz` writes a `derive` edge from the parent clip; sidecar entry `mode: "derived"`. `register-run --video` then names the clip the frames were really cut from. |

## Files on disk (loop motion)

```
<character>/motions/<id>/
  keyframe.png            # GPT Image, white plate, as generated       <id>-keyframe
  keyframe-alpha.png      # remove-background.mjs (BiRefNet)           <id>-keyframe-alpha
  first-green.png         # flatten --bg #00ff00 — working file, not an asset
  video-seedance-1.mp4    # first-last clip, both ends = first-green   <id>-video-1
  video-veed-2.webm       # (optional) matte of video-1                <id>-video-2  (derived, op matte)
  video-topaz-3.mp4       # (optional) 60 fps of video-1               <id>-video-3  (derived, op interpolate)
  contact.png             # working file
  frames/000.png … NNN.png                                             <id>-frame-NNN
  loop.webp  loop.apng  loop.webm  loop.json                           <id>-webp  <id>-apng  <id>-webm  <id>-lottie
  inspect.json            # loop-shaped report (below)
  run.json                # `loop --json` output, consumed by register-run
```

`.apng` is served as `image/apng` by the content server (`Bun.file().type`
at `server/index.ts:369`; verified `bun -e 'console.log(Bun.file("x.apng").type)'`
→ `image/apng`, `.webm` → `video/webm`, `.mov` → `video/quicktime`), so the
export keeps its honest extension.

## Contract 1 — `sprite-sheet.mjs loop` (T1)

```
loop <clip> --out <motionDir> --name <motionId>
  [--trim-start s] [--trim-end s]           # timestamps, exactly as from-video / contact
  [--key auto|#rrggbb|none|alpha]           # auto (default): measure frame 0's corner plate, colorkey it
                                            # alpha: the clip carries alpha (VEED webm, Bria mov) — decode it, no keying
                                            # none: opaque frames, no plate (warning)
  [--similarity 0.22] [--blend 0.05]        # colorkey, video defaults
  [--despill | --no-despill]                # ffmpeg `despill` on the plate hue before keying; default ON when keying
  [--trim-holds | --no-trim-holds]          # default ON, see below
  [--crop union|none] [--pad 8]             # union alpha bbox across kept frames + pad; default union
  [--width W]                               # scale (premultiplied alpha — no dark fringe), keeps aspect
  [--fps N]                                 # minterpolate the plate clip to N fps, loop-wrapped; refused with --key alpha
  [--formats webp,apng,webm,lottie]         # default all four
  [--threshold 16] [--json]
```

Behaviour, in order:

1. **Probe** the clip (`probeVideoStream` + duration). Detect alpha for
   `--key alpha`: `pix_fmt` with an alpha plane, ProRes 4444, or a VP9 webm
   with `alpha_mode=1` (decode with `-c:v libvpx-vp9` — the native `vp9`
   decoder drops alpha).
2. **Decode every frame of the window in one ffmpeg pass** (no per-frame
   `-ss`): `-ss start -to end` on the input, `-vf` chain
   `[despill=type=green|…,]colorkey=<color>:<similarity>:<blend>`, output
   `rgba` rawvideo or a PNG sequence into a temp dir. Keyed pixels get the
   `zeroKeyedRgb` treatment (RGB zeroed under the alpha threshold) — the same
   rule `key` and `from-video` apply.
3. **Interpolate** (`--fps N`, plate clips only): build the kept window plus a
   copy of frame 0 appended, run `minterpolate=fps=N:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
   on the *plate* frames (yuv420p), drop the trailing frames that are the
   appended copy, then key the result. The in-betweens between the last frame
   and frame 0 are kept — that is what makes the wrap smooth.
4. **Trim holds** (`--trim-holds`, default on): silhouette masks at
   `ANALYSIS_WIDTH` for every frame (keyed alpha, or luma minus median for
   `--key none`), `toFirst[i] = diff(mask0, maski)`, `step[i] = diff(maski, maski+1)`,
   `med = median(step)`, `HOLD = max(0.005, 0.25·med)`. Drop **trailing**
   frames while `toFirst[last] < HOLD` (the return to the keyframe, frozen);
   drop **leading** frames while `step[0] < HOLD` (an opening freeze — keep
   the last frame of it). Report `dropped: { leading, trailing }`. On the
   reference clip nothing is dropped (last `toFirst` 0.0065 > HOLD 0.005);
   on a Seedance first-last clip the duplicate closing keyframe is dropped.
5. **Seam**: `seam = diff(mask[lastKept], mask[0])`, `step = med`,
   `maxStep`. Warning when `seam > 2·step`: *"the loop does not close — the
   last frame is 0.13 from the first against a normal step of 0.02; shoot
   again with the same image at both ends, or pass --trim-start/--trim-end
   from the contact sheet"*.
6. **Crop + scale**: union bbox over kept frames (alpha ≥ threshold) + pad,
   identical rect on every frame (relative motion preserved); `--width`
   scales in premultiplied space (`premultiply=inplace=1,scale=…,unpremultiply=inplace=1`
   or the equivalent) so soft edges do not darken. Write `frames/NNN.png`
   (three digits; `FRAME_RE` becomes `^(\d{2,3})\.png$`, contiguity check
   unchanged, `MAX_LOOP_FRAMES = 400`).
7. **Exports** (each skipped with a warning when its encoder is missing):
   - `loop.webp` — the existing webp args (`libwebp`, `yuva420p`, `-q:v 85`, `-loop 0`), **no** `flags=neighbor` (a 3D icon is not pixel art).
   - `loop.apng` — `-f apng -plays 0 -pred mixed`, rgba.
   - `loop.webm` — `libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 30 -row-mt 1`; `-auto-alt-ref 0` is required for alpha.
   - `loop.json` — Lottie: `{ v:"5.7.4", fr:fps, ip:0, op:N, w, h, nm, ddd:0, assets:[{id:"img_i", w, h, u:"", p:"data:image/png;base64,…", e:1}], layers:[{ddd:0, ind:i+1, ty:2, nm, refId:"img_i", sr:1, ks:{o:{a:0,k:100}, r:{a:0,k:0}, p:{a:0,k:[0,0,0]}, a:{a:0,k:[0,0,0]}, s:{a:0,k:[100,100,100]}}, ao:0, ip:i, op:i+1, st:0, bm:0}] }`. Warn when the file exceeds 8 MB (`--width` is the remedy).
8. **`inspect.json`** (loop shape, also returned as `inspect` in the JSON):

```json
{ "kind": "loop", "frameCount": 96, "cell": { "width": 520, "height": 600 },
  "fps": 24, "duration": 4.0, "seam": 0.0065, "step": 0.020, "maxStep": 0.069,
  "alphaCoverage": 0.31, "keyColor": "#08f00d", "emptyFrames": [],
  "dropped": { "leading": 0, "trailing": 1 },
  "exports": { "webp": 1843201, "apng": 9120033, "webm": 612330, "lottie": 12400021 },
  "warnings": [] }
```

   No `anchorDrift` / `bodyDrift` / `maxJump` / `scaleDrift`: a loop is not
   judged on them and a number nobody judges is noise. Loop warnings: seam
   (above), `alphaCoverage > 0.9` when keyed ("was it shot on a flat plate?"),
   `--key none` ("frames are opaque"), empty frames, `frameCount < 8`,
   missing encoder, Lottie size.

9. **`--json`** (the run summary `register-run` consumes):

```json
{ "kind": "loop", "source": "video", "video": "<abs clip>", "motionDir": "<abs>",
  "frames": ["<abs>/frames/000.png", "…"], "sampledAt": [0, 0.0417, "…"],
  "fps": 24, "duration": 4.0, "trim": { "start": 0, "end": 4.042 },
  "dropped": { "leading": 0, "trailing": 1 }, "keyColor": "#08f00d", "alphaCoverage": 0.31,
  "cell": { "width": 520, "height": 600 },
  "webp": "<abs>/loop.webp", "apng": "<abs>/loop.apng", "webm": "<abs>/loop.webm", "lottie": "<abs>/loop.json",
  "inspect": { "…": "as above" }, "warnings": [] }
```

   `sampledAt[i]` is the source timestamp of frame i (after interpolation:
   `i / N` from the window start). No `sheet`, `atlas`, `gif`, `cells`.

Also in T1: **fix `probeLastFrameTime`** so the clamp lands strictly before
the last frame's PTS (half a frame period earlier), with a 24 fps fixture
whose last PTS is a non-terminating decimal (121/24) pinning the regression
for `contact` and `from-video`.

## Contract 2 — `sprite-project.mjs` and the sidecar (T2)

Sidecar additions (`modes/sprite/domain.ts`, `references/project-json.md`):

```ts
interface Motion {
  …
  kind?: "loop";                       // absent = sprite motion
  keyframe?: string;                   // asset id, `<motion>-keyframe`
  keyframeAlpha?: string;              // asset id, `<motion>-keyframe-alpha`
  exports?: { apng?: string; webm?: string; lottie?: string };   // asset ids; the WebP stays `motion.webp`
}
interface InspectSummary { …; seam?: number; step?: number; }    // absent unless the report carried finite numbers
type VideoModel = "seedance-2.5" | "h3-max" | "veed" | "bria" | "topaz";
type VideoMode  = "i2v" | "first-last" | "r2v" | "derived";
interface MotionVideo { …; derivedFrom?: string; op?: "matte" | "interpolate"; }
```

Asset ids: `<motion>-keyframe`, `<motion>-keyframe-alpha`, `<motion>-frame-NNN`
(three digits for a loop run; `runOwnedIds` accepts 2–3 digits), `<motion>-apng`
(image), `<motion>-webm` (video), `<motion>-lottie` (text). Export assets carry
`metadata.size` (bytes) so the viewer can print sizes without fetching.

Commands:

- `add-motion --id <id> --kind loop --fps 24 [--label] [--prompt] [--status]`
  — `--rows/--cols` optional for a loop (default 1×1), `source` defaults to
  `video`. A sprite motion is unchanged.
- `set-keyframe --motion <id> --file motions/<id>/keyframe.png [--alpha motions/<id>/keyframe-alpha.png] [--model] [--prompt] [--from <refIds>] [--status generating|processing|ready]`
  — mirrors `set-sheet` (placeholder leg with `--status generating`, measured
  once the file lands); `--alpha` registers `<id>-keyframe-alpha` with a
  `derive` edge (`step: "key"`) from the keyframe. Refused on a non-loop motion.
- `add-video … --derived-from <videoId> --op matte|interpolate --model veed|bria|topaz [--file …] [--status]`
  — no `--mode`, `--prompt`, `--from`; `derive` edge from the parent clip's
  asset with `params: { op, model }`; sidecar `{ mode: "derived", derivedFrom, op, prompt: "" }`.
  `set-video` unchanged; `show` prints derived clips as `video-2 ← video-1 (matte, veed)`.
- `register-run` on a run with `kind: "loop"`: `sheet`/`atlas`/`gif` are
  **optional** (a sprite run still requires them — no behaviour change);
  registers `webp` (existing id) and the three new exports; sets
  `motion.kind = "loop"`, `motion.exports`, `motion.source = "video"`,
  `motion.fps = run.fps` (interpolation changes it), `grid = {1,1}`; frame
  edges as `from-video` (`params.t`); the inspect summary copies `seam` and
  `step`. `--video` names the clip the frames came from, and the existing
  uri check (`run.video` vs the asset's uri) stays.

## Contract 3 — the viewer (T2)

- **Rail**: a `loop` chip beside the status chip (as the `video` chip today), en "loop", zh-CN "循环".
- **Stage**: for a loop motion the ground / pivot guide is off (no anchor
  exists) and the `sizeLine` reads measured size · frames @ fps. Before
  frames exist, `resolveFrameSource` puts the keyframe (`keyframeAlpha ?? keyframe`)
  on the stage as a 1×1 `raw-sheet` source; `stageWarnings` says
  *"No frames yet — the stage shows the keyframe; the clip is rendering or `sprite-sheet.mjs loop` has not run."*
  `playbackStateData` gains `kind: "loop"` when set.
- **Panel**: for a loop motion the first tab is **Loop** (en "Loop", zh "循环"):
  the WebP over the checker at natural rendering (`imageRendering: auto`, not
  pixelated), a meta line (frames · fps · duration · seam verdict), download
  links WebP / APNG / WebM / Lottie with sizes. **Video** lists the source clip
  and derived clips (`matte of video-1 · veed`). **Atlas** shows an empty state:
  *"A loop has no atlas — the frames are the PNG sequence (96 frames, 520×600)."*
- **Inspect block** for a loop: seam against its limit (2 × step, amber when
  over, verdict "closes" / "does not close"), step, frames, fps, duration,
  alpha coverage, then the warnings. The anchor rows are not rendered.
- Every visible string goes through `strings.ts` (the literal scan test enforces it).
- Browser evidence: a screenshot of a loop motion's stage + panel from a
  `--dev --viewing` session on a fixture (T2 builds a small loop fixture with
  ffmpeg — a moving box on green, keyed — through T1's contract; if T1 is not
  merged yet, hand-build the files to the contract shape).

## Contract 4 — shared fal scripts (T4)

Both in `modes/_shared/scripts/`, plain ESM, `fal-queue.mjs` driver, `--json`,
`.d.mts` twin, request builders unit-tested without network (the
`remove-background.test.ts` precedent), price and endpoint in the header.

- `remove-video-background.mjs --input <clip> --output <file> --model veed|bria [--person] [--no-refine] [--deadline-s] [--json]`
  - veed → `https://fal.run/veed/video-background-removal`, `{ video_url, output_codec: "vp9", refine_foreground_edges: !noRefine, subject_is_person: person }`; result `video[0]`; `--output` must end `.webm`.
  - bria → `https://fal.run/bria/video/background-removal`, `{ video_url, background_color: "Transparent", output_container_and_codec: "mov_proresks", preserve_audio: false }`; result `video`; `--output` must end `.mov`. Limits: ≤ 30 s, ≤ 4000².
  - JSON `{ path, url, file_size, model, endpoint, alpha: true }`.
- `interpolate-video.mjs --input <clip> --output <mp4> [--target-fps 60] [--upscale 1] [--model proteus] [--deadline-s] [--json]`
  → `https://fal.run/fal-ai/topaz/upscale/video`, `{ video_url, model: "Proteus", upscale_factor, target_fps, H264_output: true }`. `target_fps` 16–60. JSON `{ path, url, file_size, target_fps, upscale_factor }`. The trial verifies `upscale_factor: 1` is accepted; if fal refuses it, the minimum becomes 2 and the header says so.

Local files go through `falMediaUrl` (data URI ≤ 30 MB); output through
`downloadFalFile` to `<output>.tmp` then rename.

## Contract 5 — the skill text and manifest (T3)

- `SKILL.md`: description gains "seamless transparent loops for a UI";
  **Workflow E — A seamless loop for the UI** with these steps: (1) interview
  in one message — the subject (an icon or the character), the motion verb
  (sway / flicker / breathe / bob / spin), the style sentence (the claymation
  3D icon anchor or the character's own), duration 4 s (5 s for two beats),
  target width; (2) `add-motion --kind loop --status planned`; (3) keyframe:
  `set-keyframe --status generating` → `generate_image.mjs` 1024×1024
  `--quality high --background opaque`, white plate, refs attached when it is
  the character → `remove-background.mjs --model heavy --resolution 1024` →
  `set-keyframe --file … --alpha …` → `flatten --bg "#00ff00"` → `navigate-to`
  + `capture`, look; (4) `add-video --mode first-last --from <id>-keyframe-alpha --status generating`
  + the wait sentence (≈ 7 min); (5) `seedance-video.mjs --image first-green.png --end-image first-green.png --duration 4 --resolution 480p --no-audio`
  with the loop prompt template; `set-video --status ready`; (6) `contact`,
  look; (7) optional matting (`remove-video-background.mjs`) and/or
  interpolation (`interpolate-video.mjs`, *before* matting), each registered
  with `add-video --derived-from`; (8) `sprite-sheet.mjs loop … --json > run.json`;
  (9) `register-run [--video]`; (10) read seam vs step, `navigate-to`, `play`,
  `pause` + `capture` at the seam (last frame, then frame 0), report the
  numbers and the export sizes. Cross-link from B step 0 (a smooth
  transparent animation for a UI is E, not a third source). Commands section:
  `regenerate-motion` on a loop = a new take from the same keyframe unless the
  note asks for a new keyframe. Wall-time table rows for the new steps
  (placeholders "measured in the trial" until the trial fills them).
- `references/prompting.md`: **The 3D icon keyframe** — style anchor
  ("Smooth claymation-style 3D icon, soft matte clay, rounded forms, soft
  studio key light from the upper left, no outline"), single subject centred,
  ~70 % of the frame, generous margin, white plate, *no floor, no cast or
  contact shadow, no reflection, no vignette, no text*; and the character
  variant (refs attached, one pose).
- `references/video-preview.md`: **The seamless loop clip** — first-last
  with the same image at both ends, the prompt template (locked camera,
  constant size, the organic motion in one sentence, flat chroma green, "the
  final frame returns exactly to the opening pose so the loop closes
  seamlessly"), duration/cost, the matting and interpolation scripts with
  prices, and the ordering rule (interpolate, then matte).
- `references/pipeline.md`: the `loop` subcommand, its JSON, the loop
  `inspect` fields and warnings, three-digit frames, the `add-motion --kind`,
  `set-keyframe`, `add-video --derived-from`, `register-run` changes.
- `references/project-json.md`: the shapes in Contract 2, the layout above, the id table.
- `manifest.ts`: version `0.3.0` + changelog; description (en / zh-CN / ja)
  mentions seamless UI loops (WebP / APNG / WebM / Lottie); `sharedScripts`
  += `remove-video-background.mjs`, `interpolate-video.mjs`; `falApiKey`
  description mentions video matting and interpolation; `get-playback-state`
  description mentions `kind`; `mdScene` unchanged.
- `README.md` / `README.zh.md` sprite rows mention the loop deliverables.
- Version literal search (`0.2.1`) in tests; `bun run check:guidance`.

## Trial (after merge, owner-visible before any bump)

One real run with the repo keys, on the mode's own scripts, recorded into
`video-preview.md` with numbers: a claymation flame keyframe (same subject as
the reference, so the comparison is apples to apples) → BiRefNet → green →
Seedance first-last 4 s 480p (~$0.9, ~7 min) → `contact` → `loop` (colorkey +
despill) → exports; then VEED on the same clip (~$0.07) → `loop --key alpha`;
edge crops side by side at 1:1; then Topaz 60 fps (~$0.08) vs `--fps 60`
minterpolate. Decide the documented default from what the crops show, fill
the wall-time table, then a cold-start blind trial on its own port.

## Tasks

| Task | Worktree / branch | Owns | Must not touch |
|---|---|---|---|
| **T1 pipeline** | `.claude/worktrees/sprite-loop-pipeline` / `sprite-loop/pipeline` | `modes/sprite/skill/scripts/sprite-sheet.mjs`, `modes/sprite/__tests__/sprite-sheet.test.ts`, `modes/sprite/__tests__/fixtures/**` | project script, domain, viewer, docs, manifest |
| **T2 project + viewer** | `.claude/worktrees/sprite-loop-project` / `sprite-loop/project` | `modes/sprite/skill/scripts/sprite-project.mjs`, `modes/sprite/domain.ts`, `modes/sprite/viewer/**`, `modes/sprite/__tests__/{sprite-project,domain,viewer-logic}.test.ts` | sprite-sheet.mjs, docs, manifest |
| **T3 skill + manifest** | `.claude/worktrees/sprite-loop-skill` / `sprite-loop/skill` | `modes/sprite/skill/SKILL.md`, `modes/sprite/skill/references/*.md`, `modes/sprite/manifest.ts`, `modes/sprite/__tests__/{mode-definition,registration}.test.ts`, `README.md`, `README.zh.md` | scripts, domain, viewer |
| **T4 fal scripts** | `.claude/worktrees/sprite-loop-fal` / `sprite-loop/fal` | `modes/_shared/scripts/remove-video-background.{mjs,d.mts}`, `modes/_shared/scripts/interpolate-video.{mjs,d.mts}`, `modes/_shared/scripts/__tests__/*` | the sprite manifest (T3 whitelists them), everything under `modes/sprite/` |

Gates per task: `bun run typecheck`; `bun test modes/sprite` (T1–T3) or
`bun test modes/_shared` (T4); T2 additionally a browser screenshot; T3
additionally `bun run check:guidance`. The integration worktree runs the
routine suite after the four merge.
