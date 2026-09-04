# Generation — H3 Max cheatsheet, prompt anatomy, the play loop, QA, cost

The unit of production is a **montage clip**: one H3 generation of up to
15 s in which the model cuts by itself across a time-coded shot list of
3-9 cuts, with the narration distributed across the clip's timeline. A
scene is 1-3 clips (`nodes/<id>/c1.mp4`, `c2.mp4`, …) concatenated into
`nodes/<id>/video.mp4`. "Shot" in this file means one cut inside a clip;
the thing that is shot, paid for and QA'd is the clip.

Measured wall times, 2026-09-01 smoke (5 s clips @ 480P): text-to-video
2 s wall / 0.78 s GPU, image-to-video 3 s / 0.56 s, reference-to-video
19 s / 2.4 s (reference analysis dominates). Verbatim Chinese narration
with lipsync was transcribed back word-for-word. On 2026-09-04 a 15 s
multi-cut montage came back in ≈10 s at 480P with `balanced` expansion.
The inference itself is nearly free; wall time is prompt expansion +
reference analysis + fal's queue — so keep expansion `balanced` and bind
only what continuity needs (the anchor, the voice, and the figures this
clip's cuts actually name).

## Endpoint cheatsheet

All three share: `prompt` (required), `prompt_expansion_mode` (required —
`balanced` ~1s / `quality` ≤30s), `duration` 5-15 (`generate-video.mjs`
defaults to 5; a course clip is 8-15, and 15 is the norm), `resolution`
480P/768P, `seed`, and return `{ video.url, expanded_prompt?, timings?,
seed? }`.

| Endpoint | Extra inputs | Aspect | Use for |
|---|---|---|---|
| `text-to-video` | — | `16:9` default; 21:9…9:16 | Nothing in a course's normal path: the manager lands here only when a clip binds nothing at all — no style anchor, no voice reference, no character, no figure. It is how the 2026-09-04 writer trials were shot, with no anchor and no references |
| `image-to-video` | `image_url` (first frame), `end_image_url` (last frame) | Follows the input image — crop to control | The escape hatch, and only from the ANCHOR: `planRefs` mode `"image"` pins it as an actual first frame (nothing else can ride along, so a clip that shows a figure is never shot this way), and `make-style-sample.mjs` falls back to it when reference-to-video answers 5xx. `end_image_url` is used by nothing in plotwise — a figure pinned as a keyframe fills the screen with the raw bitmap and turns the course into a slideshow (2026-09-02) |
| `reference-to-video` | `reference_image_urls[]`, `reference_video_urls[]` (2-15s each, ≤15s total), `reference_audio_urls[]` (never audio alone); ≤12 files total, at most **4 images analysed**; prompt addresses them as `Image 1`, `Video 1`, `Audio 1` | `adaptive` default | **Every clip of every course**, and the style sample. The only endpoint that takes an audio reference (the course's voice), and the only one that returns `seed` unprompted |

Identity note (smoke-validated): when prompt wording and a reference image
disagree about a subject, the model follows the IMAGE. Use that — it is
the enforcement mechanism for both characters and figures.

## Prompt anatomy — four plain blocks

`h3-prompt.mjs::buildClipPrompt` assembles every clip out of the writer's
structured fields, in this order (the module numbers the labels it emits;
the skeleton and the reasoning for each rule are in
`references/h3-best-practices.md`):

1. `1. Style anchor:` the recipe verbatim, then `Subject:` in one line —
   and, for a scene of more than one clip, one line saying this is part
   k of n of one continuous scene (same set, materials, palette, light;
   never shown on screen). The model has no memory across clips.
2. `2. Shot list — N cuts in Ds, cut on the times given:` one line per
   cut — `0-2s Cut 1: <subject + action + setting>. [camera]` — with a
   parenthesised figure clause on the cut that shows a figure ("drawn in
   the scene's own materials … every label, axis and number unaltered").
   `normalizeCuts` clamps the times, closes the tail to the clip's end
   and fills in a missing camera (a cut with no camera is a dead frame),
   reporting each fix.
3. `3. Narration —` off-screen voiceover, or on-camera with lips in sync,
   then one timed line per moment: `0-3s <d>[Chinese]…</d>`.
   `normalizeNarration` spreads untimed lines evenly rather than dropping
   them, and says it did.
4. `4. Audio:` ambience and action effects with the moments they land,
   closed by "Nothing louder than the voice, and no music".
5. `5. Do not show:` the standing negatives (`negativesFor` — invented
   on-screen text, garbled glyphs, dissolves and morphs, camera shake,
   plus the people negatives for a style with people) then the style's
   own line from the writer.

**Reference bindings are injected at the shoot, never written.**
`insertReferenceBlock(prompt, lines)` puts `Reference material: Image 1
is … Audio 1 is …` between block 1 and block 2, with the lines numbered
by `bindingLines` off the order `planRefs` chose. A writer guessing
"Image 2" guesses wrong.

**`--expansion balanced` is load-bearing, not a saving.** The prompt is
these plain blocks; fal's expander is what rewrites them into H3's own
`[Shot N]` / `overall_soundscape` sections (measured 2026-09-04).
`quality` (up to ~30 s of rewriting) is for a keepsake render only.

Language: the structural labels and the quoted style recipe are English;
the cuts, narration, audio line and negatives are in the course's
language. Keep hand-written prompts (keepsake re-shoots) in the same
shape.

## The style sample — the anchor and the voice come from here

```
node scripts/make-style-sample.mjs --set <dir> --style-id <id> \
  --hook "<the spoken line>" --action "<the visual device these seconds SHOW>" \
  [--recipe "<custom recipe>"] [--name …] [--rationale …] \
  [--ref-image style/refs/a.png]... [--duration 15] [--resolution 480P] --json
```

Two products, and everything downstream inherits them:

- **`style/anchor.png`** — a style KEY FRAME, not an empty set:
  GPT-Image-2 composes the recipe around the topic's own device, caught
  at its most legible moment, filling the frame, no text, 16:9. This
  still becomes Image 1 of every clip in the course, so an anchor of "the
  set, ready but not yet in use" hands its emptiness to every montage.
  `--action` is required for exactly that reason.
- **`style/sample.mp4`** — the hook's first montage clip: written by Luna
  under `SAMPLE_SYSTEM`, checked by `validateSampleClip` (one clip, no
  figures — nothing is rendered before a course is planned), assembled by
  the same `buildClipPrompt` + `insertReferenceBlock`, and shot
  **reference-to-video from the anchor** with the learner's
  `--ref-image`s after it. Keyless, or when the writer call fails, it
  degrades to ONE cut over `--action` — still the same four blocks — and
  records that in `writer` / `writer_problems`.

The anchor on file is reused when style id, recipe, topic and action all
match `style/anchor.json`, so a re-run after a failed shoot does not pay
for a frame that did not change. `style.status` moves pending → sampling
(anchor written) → sampled (clip written); a failure resets it to pending
with `sample.error` so the board shows the reason instead of spinning.
The sample is not QA-gated — the learner judges it by eye and ear. On
`confirm-style` the anchor becomes `style.refImages[0]`, and the manager
turns the sample's narration into the course's voice reference.

## Loudness

H3 Max's output loudness is wildly inconsistent — one 18-clip batch
measured a 26.5 LU spread (-35.8 to -9.3 LUFS), which plays as "some
clips whisper, some shout" and destroys the course's continuity as
surely as a style break. `generate-video.mjs` therefore normalizes every
downloaded clip to **-16 LUFS** (two-pass EBU R128 loudnorm, video
stream copied) and leaves every clip in ONE audio format (AAC 48 kHz
stereo): the clips of a scene are concatenated, and a stream-copy join of
clips with different sample rates once produced a 141 s file from 47 s of
clips. The same pass moves the MP4 index to the front, which is why every
clip load and seek is not two round trips. The `--json` output reports
`loudness.input_i` and whether normalization ran. It needs `ffmpeg` on
PATH (as do the voice reference, the last-frame extraction and the
concat) and degrades to a stderr warning without it. `--no-normalize`
opts out — only for debugging the raw model output, never for course
clips.

## Style continuity mechanics — every clip binds the same shape

Measured failure (2026-09-01): three clips under the same "chalkboard"
recipe returned three different boards, chalk textures and handwritings.
Prompt adjectives do not carry a look across shoots — reference images
do, and a reference audio carries the narrator. So continuity is not a
mode to choose any more: **every clip binds the same things**, in this
order (`clipRefs` in the manager decides who rides via `planRefs`;
`bindingLines` writes the wording):

- **Image 1 is the style anchor** (`style/anchor.png`,
  `style.refImages[0]`) — a look reference, not a picture to show.
- **The recurring characters ride next** (`style.refImages[1..]`): the
  learner's own references, and for a speaker on screen the two extra
  angles the continuity kit draws once from the sample's first frame.
  Every clip gets them, including the first — a face the first clip
  invented cannot be caught up with later.
- **This clip's figures take what is left**, in the order of the cuts
  that show them; each binding names the cut it appears in, so the model
  knows when as well as which.
- **Audio 1 is the voice** — the confirmed sample's narration
  (`style/voice.mp3`, ≤15 s, fal wants at least 2 s), on every clip, so
  the narrator keeps one voice across the course. It rides outside the
  image budget (fal takes 12 files in all).
- **The budget is four analysed images.** What is left for figures is
  `MAX_REFS` less the anchor slot less one per recurring character
  (`figureBudget`). Over it the manager **fails the clip** naming the
  split ("split the figures across clips") rather than let the last
  figure fall off silently at fal, and the screenplay validator caps by
  the same number so the writer hears it before anything is shot.
- **Never a figure as `--image` or `--end-image`.** A keyframe is copied
  verbatim; figures are references the model reproduces inside its own
  picture.
- **The frame chain is retired.** No clip starts from another clip's
  frame; a scene is clips joined by matched cuts. The last frame is still
  extracted (`nodes/<id>/c<k>.last.png`) — it is what the interlude shows
  while the next scene is still shooting. Why the chain went, and what it
  cost to keep it: `references/h3-best-practices.md`.
- Robustness note: reference analysis is the slow, paid part of r2v, and
  on 2026-09-02 the endpoint answered 504
  `downstream_service_unavailable` for hours while t2v and i2v answered.
  The style sampler falls back to image-to-video from the anchor; a
  course clip fails honestly (the scene shows 再拍一次) rather than
  imagine a figure.

## The play loop — write-screenplay.mjs, then play-manager.mjs

Two programs, no agent between the steps.

**The screenplay** (once, before play): `write-screenplay.mjs --set <dir>
[--model] [--json]`. GPT 5.6 Luna writes the whole spine in one
structured call — one scene per outline beat, 1-3 clips of 8-15 s, each
clip a montage of 3-9 timed cuts with its own camera, the narration timed
across the clip, a visual device per beat, one detour brief per scene —
then it is validated (clip and cut counts; a timeline that starts at 0
with no gap over 0.5 s; the speech budget × `SPEECH_OVERRUN`; figures
that exist on disk and fit the figure budget; writing on screen with no
figure behind it; a device and a detour on every scene; every beat
covered) and landed into course.json under the lock as `n1..nK` plus
`n<k>d` detour stubs. `--json` reports `{ scenes, clips, cuts, problems,
mode }`; `mode: "fallback"` means the single call failed or came back
short of the spine and it was rewritten scene by scene. It refuses to run
without a confirmed style or a non-empty outline. The recorded 30-60 s
was measured on the 0.5 spine call — a 0.6 answer carries shot lists, so
treat it as a floor.

**The manager** (one process for the whole course) renders scenes in
`--slots` parallel lanes, each scene clip by clip in fixed order:

| Step | What | Wall time |
|---|---|---|
| kit | Once, before any video: the confirmed sample's narration → `style/voice.mp3`; for a course with a speaker on screen (or learner references) two more angles of the host from the sample's first frame → `style/character-{1,2}.png`. Best effort, every step logged; scripting starts without it, shooting waits for it | seconds for the voice; the character sheet measured 77 s, once per course |
| refs | `clipRefs`: the same bindings for every clip, this clip's figures resolved against the beat's evidence and ordered by their cuts | 0s |
| shoot | `generate-video.mjs` on fal's queue: balanced expansion, loudness normalized, one audio format, remote cancel on SIGTERM / deadline (`CLIP_DEADLINE_S` = 360 s a clip) | 20-40s for one 15 s reference clip with the voice at 480P (the band this file has recorded since 0.5, whose unit was already reference-to-video + voice). Single measurements in `h3-best-practices.md` → *Measured*: 18.4 s for a 7 s clip on a busy afternoon, 24-36 s at 768P |
| qa | `transcribe.mjs` (two attempts) → `normalizeForCompare` (digits and symbols as the words they were spoken as) → `compareNarration`; ≥ 0.97 passes, ≥ 0.90 at full coverage (±0.08) passes, < 0.60 fails, in between → one Luna judgment (keyless, 0.90 splits it). Transcription failing twice fails the CLIP with the reason — the file stays as `unchecked` and a retry checks it before paying for another render | 5-15s for a clip of this length |
| reshoot | at most once, fresh seed, on QA failure; the rejected take stays as `c<k>.rejected.mp4` | +shoot +qa |
| frame | the clip's last frame → `nodes/<id>/c<k>.last.png`, which the interlude shows while the next scene shoots | < 1s |
| concat | after the last clip: ffmpeg into `nodes/<id>/video.mp4` — video stream-copied when every clip has the same stream shape, the audio always re-encoded through a 30 ms fade at each join, then the joined duration verified against the sum of its parts; a single-clip scene is simply renamed. Then `script.md`, `evidence.json`; status `ready` | the recorded 1-3s predates the per-join fade — a floor now that audio is always re-encoded |

Detour and question scenes are written first (planning queue, Luna,
from their `brief`), then join the video queue. Scheduling is by distance
from the scene the learner is on (children, then grandchildren, exactly
`--video-ahead` steps), main before detour, a question above everything
and always inside the window wherever it hangs; a choice prunes the
unchosen subtrees — queued and running jobs are cancelled, fal jobs in
flight cancelled at the queue — and marks them `cancelled`, while
everything reachable from the chosen scene is kept and a road not taken
can be revived. A retry of a failed scene keeps its `ready` and
`unchecked` clips; a retry of a ready scene is a new take of every clip.
Every state change lands in course.json under the lock (`status`,
`phase` (`script` / `shoot` / `qa`), `clipIndex/clipCount`, `startedAt`,
`error`, and the `play{}` snapshot whose `updatedAt` is the heartbeat,
written at least every 20 s while a job runs); re-scheduling is triggered
by a key LEAVING a queue's active set, never from inside a job's own tail
(which would still see itself running).

`state/manager.log` carries a line per scene when it goes ready (clip
count and duration), each continuity-kit step, a QA failure and its
re-shoot, a scripting or rendering failure with its reason, and every
choice, retry and question. Per-clip timings are not in it — they come
back in `generate-video.mjs --json`. A step far outside its band is a
finding to report (an endpoint slowdown, a script over budget), not
something to route around.

Never hand-edit course.json while the manager runs; the learner's
inputs are `state/choice.json` (viewer) and `state/requests/*.json`
(the director's question scenes).

## Provenance

Per clip, kept on the clip entry in course.json by the manager: `status`
(`planned` / `ready` / `unchecked`), `video {file, duration}`, `qa
{similarity, coverage, verdict, judge}`, `endpoint` (`reference`
normally; `text` when the clip bound nothing), `h3Practices` (the
`H3_PRACTICES_VERSION` it was shot under, so a course can be read against
the practice of its day), and the `videoPrompt` its fields were assembled
into. A rejected take stays beside it as `c<k>.rejected.mp4`. The
expanded prompt and the seed are NOT kept per course clip — the sample
records both. Per scene: `nodes/<id>/script.md` and `evidence.json`. The
style sample keeps `style/sample.json` (recipe, hook, action, the
endpoint used and any fallback reason, writer + problems, the clip, the
assembled prompt, `expanded_prompt`, seed, refs, loudness, timings) and
`style/anchor.json` (what the frame on file was made from, so it is
reused rather than redrawn).

## QA gate mechanics (direct use)

```
node scripts/transcribe.mjs --input <clip> --language <lang> --json
```

For a clip you shot yourself (a keepsake re-render): compare the
transcript to the script. Judge like an editor, not a diff tool:
punctuation, spacing, and homophone spelling drift are fine; any changed
fact, number, name, term, or dropped/added clause fails. On fail: one
re-shoot with a fresh seed (do NOT reuse the failing seed); on second
fail, the script is probably too long for the duration — shorten it (or
extend `--duration`) and shoot again.

Visual check for a scene that shows a figure, when the learner reports
it: `capture` the scene, compare the on-screen figure to the rendered
original. Mangled figure = a too-dense figure — simplify it at the
evidence, then 再拍一次.

## Cost discipline

Post-promo pricing (2026-09-01): t2v/i2v 480P $0.05/s, 768P $0.08/s; r2v
$0.08/s flat + reference tokens (first ~4096 free — about four 1024²
images; beyond that ~$0.02 per 1k tokens). Wizper transcription is ~cents;
the anchor is one GPT-Image-2 call per course, plus two more for the
character sheet when the course has a person to keep.

- Arithmetic on those prices, not a measurement: every clip is
  reference-to-video, so a 15 s clip is $1.20 of clip time plus its
  reference tokens, a two-clip scene $2.40, and an 8-beat course whose
  detours are shot ahead lands in the $30-40 range. The manager shoots
  `lookahead` scenes ahead plus their detours, so a learner who always
  continues pays for roughly one unwatched detour per scene.
- The r2v rate above is flat, so on the course's own endpoint **480P
  buys time, not money**: a 15 s montage came back in ≈10 s at 480P
  while the 768P writer trials took 24-36 s (2026-09-04, both
  text-to-video — the resolution gap is measured, the price parity is
  read off the table above). Stay at 480P + `balanced` while the learner
  is watching unless the `resolution` init param says otherwise;
  `quality` expansion only for a keepsake re-render of the taken path,
  on request.
- Keep references per clip ≤ 4 — the budget is enforced at two layers,
  and reference analysis is the slow part of r2v.
- Everything goes through fal's queue (`fal-queue.mjs`): a job is
  cancelled remotely when the manager prunes it, when its deadline
  passes, or when its status cannot be read any more, and a submit whose
  answer was lost is never sent twice (fal has no idempotency key — a
  second send could be a second paid job).

## Narration — what is verified, and what a person still has to judge

On-camera lipsync narration is smoke-validated verbatim (2026-09-01).
Voiceover across a montage is validated too, as of 2026-09-04: a `<d>`
line added to a community montage prompt was spoken verbatim with the
cutting intact, and a lesson written in the same grammar came back
verbatim in three no-character styles (flat-vector, papercraft,
clean-3d). What no measurement settles is whether the voice reference
actually locks the timbre — the objective proxy barely separates a
matched voice from an unmatched one — so a voice experiment leaves the
clips for a person to listen to. If a style consistently fails narration
QA, report the finding so the recipe can be fixed; never mux TTS over a
course clip, and trust the QA gate to catch drift.
