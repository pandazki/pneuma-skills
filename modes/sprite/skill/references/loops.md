# Loops and transitions, step by step

The commands behind SKILL.md's workflow E (a seamless loop for a UI) and
workflow F (transition clips that connect loops in one `.riv`). SKILL.md
keeps what to decide with the user — the interview, the money, what counts as
done; this page is every call in order, with the numbers measured on them.
The clip prompts themselves are in `video-preview.md`; every `loop`,
`transition` and `lineup` flag is in `pipeline.md`.

Both workflows spend the fal key: a Seedance take is ≈ $0.83 for 4 s at 480p
square (≈ $1.0 for 5 s), a `veed-gs` matte ≈ $0.10, a Topaz interpolation ≈
$0.10, RIFE ≈ $0.03. Say the price and the wait before each paid call, quote
the `cost:` line each script prints after it (`seedance-video.mjs`,
`remove-video-background.mjs`, `interpolate-video.mjs`), and keep the running
total against the brief's budget.

## Workflow E — a seamless loop

1. **Interview in one message** (SKILL.md, workflow E): the subject, the
   motion verb, the style sentence, the duration, the width — plus the frame
   ceiling and a budget. `loop` writes at most 400 frames, so `duration × fps
   ≤ 400`: 60 fps fits up to 6.6 s, and a 7–8 s loop is a 48 fps loop.
2. **Register the motion, then the brief.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir <character> \
     --id <id> --label "<Label>" --kind loop --fps 24 --status planned --json
   node {SKILL_PATH}/scripts/sprite-project.mjs set-motion --dir <character> \
     --motion <id> --brief-duration 4 --brief-width 512 \
     --brief-interpolator topaz --brief-budget 3 --json
   ```

   `--kind loop` needs no grid, defaults `source` to `video`, and is the only
   motion `set-keyframe` accepts. `add-video` **refuses** a generated clip on
   a loop motion with no brief; any answer can change later with one flag.
3. **Draw the keyframe, then look at it.** Reserve it first, so the stage is
   not empty while the model draws:

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs set-keyframe --dir <character> \
     --motion <id> --file motions/<id>/keyframe.png \
     --prompt "<the prompt you are about to send>" --status generating --json
   ```

   Then one `generate_image.mjs` call — 1024×1024, `--quality high`,
   `--background opaque`, a white plate asked for in the prompt, and
   `--image-urls` once per reference when the subject is the character
   (`prompting.md` has the call and the 3D-icon prompt). It picks the model
   itself and reports it in its JSON `model` field; pass **that** to the
   closing `set-keyframe`. Cut it out and register both halves:

   ```bash
   node {SKILL_PATH}/scripts/remove-background.mjs \
     --input <character>/motions/<id>/keyframe.png \
     --output <character>/motions/<id>/keyframe-alpha.png \
     --model heavy --resolution 1024 --json

   node {SKILL_PATH}/scripts/sprite-project.mjs set-keyframe --dir <character> \
     --motion <id> --file motions/<id>/keyframe.png \
     --alpha motions/<id>/keyframe-alpha.png --model "<the model the JSON reported>" --json
   ```

   The second call flips the same ids to `ready` (it needs `--alpha`;
   omitted `--model` / `--prompt` keep what the reserving call recorded).
   Then flatten the cut-out onto the clip's plate and *look* at what you drew:

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs flatten \
     <character>/motions/<id>/keyframe-alpha.png \
     --out <character>/motions/<id>/first-green.png --bg "#00ff00" --json
   ```

   `navigate-to` the motion, `capture`, and check the four things that cost a
   whole clip to get wrong: one subject, a clear margin, no floor or contact
   shadow, no text — and read `plateCheck`. `first-green.png` is a working
   file, never registered.
4. **Register the clip, and say how long it takes.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion <id> --file motions/<id>/video-seedance-1.mp4 \
     --model seedance-2.5 --mode first-last --from <id>-keyframe-alpha \
     --prompt "<the loop prompt>" --status generating --json
   ```

   `--from` names the *asset* the clip grew out of — the cut-out keyframe.
   Then one line to the user: the price, and **three to eleven minutes**,
   every end of that range measured on this queue, none of it the clip's
   fault.
5. **Shoot it with the same image at both ends.**

   ```bash
   node {SKILL_PATH}/scripts/seedance-video.mjs \
     --prompt "<the loop template from references/video-preview.md>" \
     --image <character>/motions/<id>/first-green.png \
     --end-image <character>/motions/<id>/first-green.png \
     --duration 4 --resolution 480p --no-audio \
     --output <character>/motions/<id>/video-seedance-1.mp4 --json
   ```

   The template adds the sentence that makes the model land there. One call,
   then leave it alone — it polls the queue and retries transient failures
   itself, and a second submission is a second bill. Afterwards:

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs set-video --dir <character> \
     --motion <id> --video video-1 --status ready --json
   ```

   (or `--status failed --notes "<what the script reported>"`). The video id
   is the one `add-video` printed.

   **A second take is the user's money too.** When `contact` shows a freeze or
   an open seam, do not re-shoot on your own judgement — put the numbers, the
   price and the wait in front of the user *together with the free
   alternative* (6b, a retime of the take you already have), and take the
   answer. The same applies to a second Topaz or VEED call.
6. **Look at the clip before you cut it** — `sprite-sheet.mjs contact`, as in
   SKILL.md B-video step 6, with a loop's question in mind: does the motion
   ever freeze, and does the end come back to the opening pose? A first-last
   loop usually reads **no cycle** — it drifts from its keyframe and back
   once, which is fine; a long `stillEnd` hold is the duplicate closing
   keyframe (step 8 trims it).

   6b. **Retime the plate (optional, free).** Seedance has idle-loop failure
   modes no prompt wording fixes — a 1.5–2 s freeze at the inhale apex, a
   double blink, a tail that sits still (`video-preview.md`). `contact`'s
   `profile.deltas` shows them as a run of near-zero steps. Reordering the
   clip's own frames costs nothing and invents nothing:

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs retime \
     <character>/motions/<id>/video-seedance-1.mp4 \
     --keep 2-45,60-66,75-112 --out <character>/motions/<id>/video-retime-2.mp4 --json

   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion <id> --file motions/<id>/video-retime-2.mp4 \
     --derived-from <id>-video-1 --op retime --model ffmpeg --json
   ```

   Ranges are inclusive frame indices **in playback order**, repeats allowed.
   It runs on the PLATE, before interpolation and matting. After a retime the
   frames at the wrap are whichever your ranges put there (`firstIs` /
   `lastIs`), so step 10's measured seam is the only evidence the cycle still
   closes — say that rather than "same image at both ends".
7. **Optional, and in this order: interpolate, then matte.** Interpolation
   reads opaque pixels, so it runs on the **plate** clip; matting makes the
   clip transparent, and after it `loop --fps` is refused.

   **Interpolation is the user's choice, and the brief already holds it** —
   `brief.interpolator`, printed by `show`. Use it and do not ask twice. Only
   when there is no brief (a motion from before the interview existed) put
   the three in one message, with the session's default first.

   | | What it does | Cost | The wrap |
   |---|---|---|---|
   | **`topaz`** — `interpolate-video.mjs --target-fps 60` | Exactly 60 fps, the sharpest in-betweens measured | ≈ $0.10 per 5 s clip, 49–69 s | **Not closed** — it never sees the last frame against the first; `loop --seam-fill` handles the seam |
   | **`rife`** — `interpolate-video.mjs --model rife --between 1 --loop` | Learned in-betweens that MULTIPLY the rate: 24 fps becomes 48 | ≈ $0.03 per 5 s clip; the queue can hold it for minutes | **Closed** — `loop: true` interpolates the wrap too |
   | **`ffmpeg`** — `sprite-sheet.mjs loop --fps 60`, no extra call | Block-matching `minterpolate`, loop-wrapped | free | **Half closed** — `--seam-fill` finishes the job |

   The owner's position: **Topaz's ten cents is acceptable**, and the free
   `minterpolate` is the fallback for a session with no fal key — not the
   recommendation. Say the price with the choice.

   ```bash
   node {SKILL_PATH}/scripts/interpolate-video.mjs \
     --input <character>/motions/<id>/video-seedance-1.mp4 \
     --output <character>/motions/<id>/video-topaz-2.mp4 \
     --target-fps 60 --json

   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion <id> --file motions/<id>/video-topaz-2.mp4 \
     --derived-from <id>-video-1 --op interpolate --model topaz --json

   node {SKILL_PATH}/scripts/remove-video-background.mjs \
     --input <character>/motions/<id>/video-topaz-2.mp4 \
     --output <character>/motions/<id>/video-veed-3.webm \
     --model veed-gs --json

   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion <id> --file motions/<id>/video-veed-3.webm \
     --derived-from <id>-video-2 --op matte --model veed-gs --json
   ```

   Each derived clip is registered once its file exists (`--status`
   defaults to `ready`), naming its parent and the endpoint that really made
   it; the number in the id is the next free one.

   **Of the two, the matte is the one worth paying for**: VEED's is the
   softest edge measured, and the fix for what a colour key cannot separate
   (smoke, glow, a plate that is not green). The free key is no compromise
   either — it un-mixes the plate out of every edge (ten real loops: no plate
   colour, no dark rim), not yet compared side by side. **Pick the endpoint
   by the plate**: chroma green → `--model veed-gs` (≈ $0.10 for 121
   frames); any other → `--model veed` (≈ $0.09), `bria` if VEED fails.
   Whatever the user picks, **read the seam again afterwards**: Topaz opened
   it on the trial clip because it never sees the wrap (`video-preview.md`).
8. **Cut the loop.** Hand it the clip whose pixels you want — the **last** one
   in the chain:

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs loop \
     <character>/motions/<id>/video-veed-3.webm \
     --out <character>/motions/<id> --name <id> --key alpha --width 512 --json \
     > <character>/motions/<id>/run.json
   ```

   `--key alpha` decodes the alpha a matted clip carries. Straight off the
   plate clip it is the same command without `--key`: `auto` measures the
   plate the model painted and un-mixes it. Frames land at `frames/000.png`
   (three digits, up to 400) with the four exports beside them.

   **`--width` comes from the brief** — `brief.width`, doubled for retina if
   the user gave you the CSS size; never from the clip. Omitted, `loop` caps
   the frames at 512 px (`widthDefaulted: true`) — a guard, not a choice.
   Measured on 119 frames of 512×596: WebP 3.4 MB, APNG 21 MB, WebM 367 KB,
   Lottie 28 MB; at `--width 256` the Lottie is about 7 MB.

   **`--seam-fill auto|none|<N>`** (default `auto`). When the seam is past
   `seamLimit`, `auto` appends `N = min(4, ceil(seam/step) − 1)` in-between
   frames at the wrap (`minterpolate`), so the loop grows by N frames and
   `seamFill` says N. It closes a seam that is *nearly* closed; a clip that
   ends somewhere else is still a reshoot.
9. **Record the run.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> \
     --motion <id> --run <character>/motions/<id>/run.json --video <id>-video-3 --json
   ```

   `--video` names the clip the frames were really cut from — the file you
   handed step 8; left off, the newest clip is assumed (with a note), and a
   mismatch against the run's clip path is reported. `register-run` also
   warns when the frames are more than 2 px off `brief.width`: cut again
   with the right `--width` (free) before you report.
10. **Read the seam, then look at it.** Report `seam` against `seamLimit`, in
    numbers, and `seamFill` when it is not 0 — those frames are the wrap
    filled in. Then `navigate-to` the motion, `play` it, `pause` and
    `capture` the **last** frame, then `navigate-to` frame 0 and `capture`
    that: two screenshots a step apart is what a seam looks like. After a
    retime this is the *only* evidence the cycle closes. Close with the frame
    count, fps, duration, the four export sizes and the running cost; a
    28 MB Lottie is a deliverable nobody can ship, and a narrower `--width`
    is the remedy.

### How long each step takes (measured)

| Step | Wall time |
|---|---|
| a loop keyframe (1024², `--quality high`) | ≈ 30 s |
| `remove-background.mjs --model heavy --resolution 1024` | ≈ 6 s |
| **a 5 s Seedance 480p first-last loop clip** | **≈ 200 s — but budget seven minutes; 632 s has been measured** |
| `remove-video-background.mjs --model veed` / `veed-gs` (121 frames) | 23–30 s |
| `interpolate-video.mjs --target-fps 60` (Topaz, 5 s clip) | ≈ 50 s |
| `interpolate-video.mjs --model rife --between 1 --loop` (5 s clip) | 21 s of compute — but 231 s wall on a cold queue |
| `sprite-sheet.mjs loop` (119 frames, 512×596, four exports) | ≈ 24 s |

Quote the clip as a **range**: the difference was the queue, not the clip.

## Workflow F — connect the loops for Rive

Every loop was shot from its own keyframe, so switching between two of them
jumps. Rive cannot blend two frames, so the continuity has to be in the
pictures: a **hub** loop (idle), **transition clips** that start on one
loop's frame 0 and end on another's, and a state machine that changes state
only where the pictures meet. `rive` builds that machine from whatever
transitions are registered; these steps make them.

1. **Look first — it is free.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs lineup <character> --json
   ```

   It writes `<character>/lineup.png`, every ready loop's frame 0 beside the
   hub's on one floor line, and per loop a `poseGap` and a `suggestion`
   (`direct` or `transition`). Open the PNG and look: the threshold was
   calibrated on one character (`pipeline.md`, "lineup").
2. **Decide which loops need a clip.** A loop whose frame 0 is already the
   hub's pose can cut; one that sits, or holds a mug, cannot. Only **hub → X**
   is shot: the way back is X → hub played backwards, free (step 7).
3. **Price it and ask for a budget.** Per entry: one take ≈ $0.83 (Seedance,
   4 s, 480p) and one matte ≈ $0.10 (`veed-gs`); no interpolation, because a
   Rive file plays at 24 fps. Five entries is about $4.7. Put the list, the
   price and the wait (three to eleven minutes a take) in one message, take
   the answer, and keep a running total.
4. **Register, brief and shoot each entry.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir <character> \
     --kind transition --from idle --to coffee --json
   node {SKILL_PATH}/scripts/sprite-project.mjs set-motion --dir <character> \
     --motion idle-to-coffee --brief-duration 1.2 --brief-budget 1 --json
   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion idle-to-coffee --file motions/idle-to-coffee/video-seedance-1.mp4 \
     --model seedance-2.5 --mode first-last \
     --from idle-keyframe-alpha,coffee-keyframe-alpha \
     --prompt "<the prompt>" --duration 4 --status generating --json
   node {SKILL_PATH}/scripts/seedance-video.mjs \
     --prompt "<the transition template from references/video-preview.md>" \
     --image <character>/motions/idle/first-green.png \
     --end-image <character>/motions/coffee/first-green.png \
     --duration 4 --resolution 480p --no-audio \
     --output <character>/motions/idle-to-coffee/video-seedance-1.mp4 --json
   ```

   The id is `<from>-to-<to>`. `--brief-duration` is how long the clip should
   **play** in the file (one to one and a half seconds), not the take's
   length. `first-green.png` is each loop's flattened keyframe from workflow E
   step 3 (flatten it again if it is gone). Then `set-video --video video-1
   --status ready`, or `--status failed` with `--notes`.
5. **Matte it** with `remove-video-background.mjs --model veed-gs`, registered
   with `add-video --derived-from <that video id> --op matte --model veed-gs`,
   exactly as in workflow E step 7.
6. **Cut it, and read both ends.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs transition \
     <character>/motions/idle-to-coffee/video-veed-2.webm --character <character> \
     --from idle --to coffee --key alpha --duration 1.2 --json \
     > <character>/motions/idle-to-coffee/run.json
   node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> \
     --motion idle-to-coffee --run <character>/motions/idle-to-coffee/run.json \
     --video <the matte's video id> --json
   ```

   It drops the frames a first-last take spends waiting at each end, retimes
   to `--duration`, and measures `startGap` (against idle's frame 0) and
   `endGap` (against coffee's) beside the clip's own `step`. `gap ≤ 2·step`
   lands. Quote all three numbers. A warning means the take did not begin or
   end on the keyframe: a later `--trim-start` or an earlier `--trim-end` is
   free, a new take is the user's money.
7. **Make the exits, free.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir <character> \
     --kind transition --from coffee --to idle --json
   node {SKILL_PATH}/scripts/sprite-sheet.mjs transition --reverse-of idle-to-coffee \
     --character <character> --json \
     | node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> \
       --motion coffee-to-idle --run - --json
   ```

   The exit is the entry's frames backwards (`reverseOf`); the `.riv` embeds
   nothing for it. Play it before you report it. **When a reversed exit reads
   wrong** — a mug put down is not a mug picked up backwards — say what you
   saw, and offer a real exit take at the price of an entry.
8. **Export, and look through the preview.** `rive <character>
   --include-loops`, registered (SKILL.md, **Exporting**). In the Export
   tab's Rive preview, press a loop's button and watch the state line: idle →
   idle-to-coffee → coffee. Report from the file's `stateMachine`: the routes,
   each loop's wait, and every direct cut with its `poseGap`.

**Say the limits plainly.** Leaving a loop waits for the end of its cycle
(`stateMachine.waits`; tanka's loops run 3.8–5.1 s). Routes go through the
hub: from coffee to typing plays coffee → idle, then idle → typing. A pair
with no transition cuts, and the report lists where and how far apart the
poses are.
