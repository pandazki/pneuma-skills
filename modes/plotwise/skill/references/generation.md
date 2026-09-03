# Generation — H3 Max cheatsheet, prompt anatomy, QA, cost

Measured facts from the 2026-09-01 smoke tests (5s @ 480P): text-to-video
returned in 2s wall / 0.78s GPU, image-to-video 3s / 0.56s,
reference-to-video 19s / 2.4s (reference analysis dominates). Verbatim
Chinese narration with lipsync was transcribed back word-for-word. The
inference itself is nearly free; wall time is prompt expansion + reference
analysis — so keep expansion `balanced` and reference counts low in the
interactive loop.

## Endpoint cheatsheet

All three share: `prompt` (required), `prompt_expansion_mode` (required —
`balanced` ~1s / `quality` ≤30s), `duration` 5-15 (default 5),
`resolution` 480P/768P, `seed`, and return `{ video.url,
expanded_prompt?, timings?, seed? }`.

| Endpoint | Extra inputs | Aspect | Use for |
|---|---|---|---|
| `text-to-video` | — | `16:9` default; 21:9…9:16 | Atmosphere-only segments, style auditions without figures |
| `image-to-video` | `image_url` (first frame), `end_image_url` (last frame) | Follows the input image — crop to control | A figure as the opening shot; state-A → state-B evolutions via first/last keyframes; continuity from a previous segment's final frame |
| `reference-to-video` | `reference_image_urls[]`, `reference_video_urls[]` (2-15s each, ≤15s total), `reference_audio_urls[]` (never audio alone); ≤12 files total; prompt addresses them as `Image 1`, `Video 1`, `Audio 1` | `adaptive` default | Recurring subjects (host, user's character), multiple figures in one clip, style anchoring. Only endpoint that returns `seed` unprompted |

Identity note (smoke-validated): when prompt wording and a reference image
disagree about a subject, the model follows the IMAGE. Use that — it is
the enforcement mechanism for both characters and figures.

## Prompt anatomy (the official H3 format)

MiniMax publishes the exact prompt-writing spec its expander rewrites
toward (github.com/MiniMax-AI/MiniMax-H3, skills/h3-prompt-writing —
researched 2026-09-01). Writing prompts in that shape directly is the
most deterministic path through the expander (`expanded_prompt` comes
back null when it left a well-formed prompt unchanged). Three labeled
sections:

1. **`integrated_multimodal_description:`** `[Shot 1]` + ONE continuous
   shot (multi-cut sequences drift — the documented failure mode):
   - Style recipe as concrete visual detail; never abstract words like
     "cinematic".
   - **Close or medium framing whenever a face matters** — wide-shot face
     distortion is architecture-level, prompting cannot fix it.
   - Camera inline as natural English, motion + amplitude + speed
     ("pushes in with small amplitude at slow speed") — NOT bracket tags
     (Director-era `[Push in]` syntax is pre-H3).
   - **Dialogue tags**: speaker description + stable ID, then
     `<d>[Chinese] exact line</d>`. Voiceover uses the exact phrase
     `says in an off-screen voiceover:` + the `<d>` tag + a statement
     that no on-screen lips move.
   - Reference bindings: each Image/Video/Audio gets exactly ONE stated
     job. Still-image references are far more reliable than video refs.
   - **Explicit negative constraints, every prompt** (there is no
     negative_prompt param; prose negation is officially recommended):
     no soft dissolves or fluid morphs; no on-screen text beyond what is
     spelled verbatim in double quotes; no garbled characters.
2. **`overall_soundscape:`** diegetic ambience only, 1-2 sentences, or
   `N/A` (which silences ALL ambience — use deliberately).
3. **`non_diegetic_music:`** **`N/A` by default** — leaving music
   unspecified is the documented cause of random background tracks. Name
   instrumentation/tempo only when the style truly calls for scoring.

`write-script.mjs` templates all of this; keep hand-written prompts (style
auditions, re-shoots) in the same shape. Persist the returned
`expanded_prompt` in `generation.json`: it is the recyclable base for
"same again, but..." re-shoots and the course's provenance record.

## Loudness

H3 Max's output loudness is wildly inconsistent — one 18-clip batch
measured a 26.5 LU spread (-35.8 to -9.3 LUFS), which plays as "some
segments whisper, some shout" and destroys the course's continuity as
surely as a style break. `generate-video.mjs` therefore normalizes every
downloaded clip to **-16 LUFS** (two-pass EBU R128 loudnorm, video stream
copied untouched) as a built-in step; the `--json` output reports
`loudness.input_i` and whether normalization ran. It needs `ffmpeg` on
PATH (already required by the continuity chain's frame extraction) and
degrades to a stderr warning without it. `--no-normalize` opts out — only
for debugging the raw model output, never for course segments.

## Style continuity mechanics

Measured failure (2026-09-01, first seed shoot): three segments under the
same "chalkboard" recipe returned three different boards, chalk textures
and handwritings. Prompt adjectives do not carry style across shoots —
reference images do. The chained re-shoot of the same seed (each segment
anchored on its parent's last frame) came back as one continuous
production, with board content accumulating naturally between segments.

The chain, per segment:

```
ffmpeg -sseof -0.1 -i <set>/nodes/<parent>/video.mp4 -frames:v 1 \
  <set>/nodes/<id>/prev-frame.png
node {SKILL_PATH}/scripts/generate-video.mjs \
  --prompt "Image 1 is the exact scene this shot continues from — the same
    board/set, stroke texture, handwriting, lighting and framing must carry
    over precisely. Image 2 is <figure binding>. Continuing seamlessly from
    Image 1, ... <narration clause>" \
  --ref-image <id>/prev-frame.png --ref-image <figure.png> ...
```

- Image 1 is ALWAYS the continuity anchor; figures/characters start at
  Image 2. Record `continuity` in generation.json.
- Root segment / audition: no parent frame exists — generate a style
  anchor once (`generate_image.mjs`, GPT-Image-2, from the style recipe;
  aesthetic material only, so an image model is allowed), store it at
  `<set>/style/anchor.png` + course.json `style.refImages`, and anchor the
  root and every audition sample on it.
- The chain (`produce-segment.mjs --endpoint auto`, decided after the
  script): a segment that shows no figure and has no recurring character
  — most of them — is image-to-video with `--image prev-frame.png`, the
  parent's last frame as this shot's first; a segment whose script shows
  a figure (or a course with a character) is reference-to-video with
  Image 1 = the parent's last frame (continuity binding) and Image 2+ =
  the figures it shows and the characters, ≤ 4 total, the numbered
  bindings injected into the prompt by the producer. **Never pass a
  figure as `--image` or `--end-image`**: a keyframe is copied verbatim,
  the raw matplotlib bitmap fills the screen, the next segment chains
  from it, and the course turns into a slideshow (seen 2026-09-02).
- Cost and robustness note: reference analysis is the slow part of r2v
  (~19s wall in the smoke test vs 2-3s for t2v/i2v), and on 2026-09-02
  the r2v endpoint answered 504 `downstream_service_unavailable` for hours
  while t2v and i2v answered — the producer and the sampler fall back to
  image-to-video from the continuity frame when that happens.

## The play loop — write-screenplay.mjs, then play-manager.mjs

Two programs, no agent between the steps. **The screenplay** (once,
before play): GPT 5.6 Luna writes the whole spine in one structured call
— one scene per beat, 1–6 shots each (verbatim narration, the picture,
5–15 s, a figure only where the content must be exact), one detour brief
per scene — validated (speech budget per shot, figures on disk, every
beat covered) and landed into course.json under the lock; falls back to
scene-by-scene when the single call fails or comes back short. 30–60 s.

**The manager** (one process for the whole course) renders scenes in
`--slots` parallel lanes, each scene shot by shot in fixed order:

| Step | What | Typical wall time (480P, 10-15s shot) |
|---|---|---|
| refs | endpoint from what the shot shows: inside a scene, image-to-video from the previous shot's last frame (most shots); reference-to-video with that frame as Image 1 and the figures / characters as Image 2+ when the shot names a figure or the course has a character; a scene's first shot opens reference-to-video on the style anchor | 0s |
| shoot | `generate-video.mjs` on fal's queue: balanced expansion, loudness normalized, remote cancel on SIGTERM | 20-40s |
| qa | `transcribe.mjs` (warmed) → similarity; ≥ 0.97 passes, < 0.60 fails, between → one Luna judgment | 5-15s |
| reshoot | at most once, fresh seed, on QA failure | +shoot +qa |
| frame | the shot's last frame → `nodes/<id>/s<k>.last.png`, the next shot's start | < 1s |
| concat | after the last shot: ffmpeg concat (stream copy, re-encode fallback) → `nodes/<id>/video.mp4`, `script.md`; status `ready` | 1-3s |

Detour and question scenes are written first (planning queue, Luna,
from their `brief`), then join the video queue. Scheduling is by distance
from the scene the learner is on (children, then grandchildren), main
before detour, a question above everything; a choice prunes the
unchosen subtrees — queued and running jobs are cancelled, fal jobs in
flight cancelled at the queue — and marks them `cancelled`. Every state
change lands in course.json under the lock (`status`, `phase`,
`shotIndex/shotCount`, `startedAt`, `error`, and the `play{}` snapshot
whose `updatedAt` is the heartbeat). `state/manager.log` has a line per
shot with its timings; a step far outside its band is a finding to
report (an endpoint slowdown, a script over budget), not something to
route around.

Never hand-edit course.json while the manager runs; the learner's
inputs are `state/choice.json` (viewer) and `state/requests/*.json`
(the director's question scenes).

## Provenance

Per shot, kept on the shot entry in course.json by the manager: `endpoint`
(`text|image|reference`), `video {file, duration}`, `qa {similarity,
coverage, verdict, judge}`; a rejected take stays beside it as
`s<k>.rejected.mp4`. The style sample keeps its own `style/sample.json`
and `style/anchor.json` (what the anchor was generated from, so it is
reused rather than redrawn). `state/manager.log` carries the timings.

## QA gate mechanics

```
node scripts/transcribe.mjs --input <clip> --language <lang> --json
```

Compare transcript vs `script.md`. Judge like an editor, not a diff tool:
punctuation, spacing, and homophone spelling drift are fine; any changed
fact, number, name, term, or dropped/added clause fails. On fail: one
re-shoot with a fresh seed (do NOT reuse the failing seed); on second
fail, the script is probably too long for the duration — shorten it (or
extend `--duration`) and shoot again. Log every attempt in
`generation.json.qa`.

Visual QA for figure segments: `capture` the segment, compare the on-screen
figure to the rendered original. Mangled figure = fail, same protocol.

## Cost discipline

Post-promo pricing (2026-09-01): t2v/i2v 480P $0.05/s, 768P $0.08/s; r2v
$0.08/s flat + reference tokens (first ~4096 free — about four 1024²
images; beyond that ~$0.02 per 1k tokens). Wizper transcription is ~cents.

- A 5s 480P segment ≈ $0.25 (t2v/i2v) / $0.40 (r2v). Pre-generating both
  candidates ≈ 2× per node. A typical 8-main-beat course with branches and
  a couple of side quests lands around $5-10 at 480P.
- 480P + `balanced` during interaction, always. 768P and `quality` are for
  the keepsake re-render of the taken path, on request.
- Keep reference files per shoot ≤ 4 unless the segment truly needs more —
  reference analysis is the slow part of r2v.
- Sync endpoints (`fal.run`) are fine at these latencies. If a batch
  render (keepsake, or `quality` expansion) is queued, run shoots
  sequentially in the background rather than parallel-blasting a dozen
  sync requests.

## Voiceover caveat (open verification)

On-camera lipsync narration is smoke-validated verbatim. Voiceover-mode
verbatim delivery in no-character styles (chalkboard, math-anim) has not
been formally verified yet — trust the QA gate to catch drift, and if a
style consistently fails narration QA, fall back to `generate-tts.mjs`
narration muxed over the clip (document the deviation in
generation.json), then report the finding so the recipe can be fixed.
