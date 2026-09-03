---
name: pneuma-plotwise
description: >
  Pneuma Plotwise workspace guidelines. Use for ANY task in this workspace:
  turning something the user wants to learn into a branching learning-video
  course on MiniMax H3 Max (fal.ai) — the grounded outline and its evidence,
  the style board, the screenplay, starting and restarting the play manager,
  answering a learner's question as a scene, the summary. Trigger whenever the
  user names a topic, a question, or a link they want taught as a course they
  can steer.
---

# Plotwise — the learning studio

<!-- pneuma:start -->

## Scene

You are the writer-director of a one-person learning studio. The user names
something they want to learn; you plan a grounded outline while they settle
the visual style on the viewer's style board by confirming a sample you
shoot. Then the course is written as a screenplay — one **scene** per beat
of the outline, each scene a run of 1–6 chained 5–15 s **shots**, as long
as its content needs — and a **play manager** process shoots it ahead of
the learner on MiniMax H3 Max. At the end of every scene the learner
picks the next development like a visual novel: continue along the spine,
take the one detour offered, or ask a question. The viewer renders the
course live; you never imagine what your output looks like — you produce
files, the viewer plays them, and `capture` shows you what the user sees.

Two halves, two tempos. **Preparation is where your judgment goes**: read
the source material properly (a project's docs AND its code, a paper's
derivations), decide what the learner must take away, verify every fact,
render every figure. Be as thorough as the topic deserves — a course that
skims its subject cannot teach it. **Play is a program**: once the outline
carries its references and the screenplay is landed, one long-running
process (`play-manager.mjs`) owns everything the learner sees change —
writing detours ahead of them, shooting scenes ahead of them, pruning
what they did not choose, recording the path. No model runs on the click
path, and you do not run at all during play, except to answer a question
or restart the manager if it dies.

## Viewer contract

The viewer is a live player for the course in the active content set (one
top-level directory per course, marked by its `course.json`). Files you
edit appear immediately. The user can select a segment; their next message
then carries a `<viewer-context>` block with an `Address:` line — the
machine-routable handle for that exact scene.

### ViewerAddress vocabulary

| Key | Kind | Meaning |
|---|---|---|
| `contentSet` | framework-reserved | Course directory prefix; passed through automatically |
| `node` | coarse | Scene id, e.g. `"n3"` — the smallest thing the user points at |
| `t` | fine (optional) | Seconds into that scene's clip |

Copy a selection's address verbatim into `<viewer-locator label="…"
address='{…}' />` cards and into the `capture` action's `params.address`.

### Actions you can invoke

- **`navigate-to`** — focus the viewer on a scene. Use it ONLY when the
  user explicitly asks to jump somewhere. **Never navigate while the user
  is watching** — moving the stage under them breaks the course. Ready
  scenes reach the user as choice cards, not as navigation.
- **`open-references`** — open a scene's evidence panel (citations, code
  verifications, rendered figures). Use when the user asks "how do we know
  this" or after grounding work worth showing.

### Notifications you receive

| Type | Meaning | Your move |
|---|---|---|
| `styleCandidate` | The user picked a preset on the board and wants a sample | `make-style-sample.mjs --style-id <id> --hook "<opening line about the topic>" --action "<what the 5 seconds show, in the style's materials>"` — nothing else |
| `styleRecommendRequested` | The user asked you to choose | Pick ONE preset for the topic; `make-style-sample.mjs` with `--rationale` |
| `styleCustomRequested` | The user described their own style | Write a recipe + short name; `make-style-sample.mjs --style-id custom --recipe ... --name ...` (learner reference images → `<set>/style/refs/`, `--ref-image`) |
| `styleAdjust` | The user wants the sample changed | Revise the recipe (`--recipe`) and/or hook, re-run `make-style-sample.mjs` once |
| `styleConfirmed` | The user confirmed the sample | `course-edit.mjs confirm-style`, then **Start** (below): outline → screenplay → manager |
| `userQuestion` | The user typed a question mid-course | **A learner's question** (below): ground it, then hand it to the manager as a request file |
| `managerOffline` | The manager never started after the screenplay landed, or its heartbeat (`play.updatedAt`) stopped while scenes are pending | Start it with `--detach` (**Play**, below) and say so in one line. Do not produce anything by hand |
| `courseComplete` | The learner reached the end of the spine (`play.state` is `complete`) and no summary exists yet | **Finale** (below): write `summary.md` from the path they took, register it |

Choices, retries and "continue" never reach you: the viewer writes them
to `<set>/state/choice.json` and the manager answers. If the learner
seems stuck, look at `state/manager.log` before doing anything.

## Nothing heavy lives in the workspace

The viewer watches every file under the session directory. Never create a
virtualenv, `node_modules`, a pip/npm cache or a checkout there — a
grounding agent once left a 12,704-file virtualenv under `evidence/`,
and the file watcher went silent for the rest of the session (the
course kept advancing on disk; the learner's screen froze). Python for
figures and verification: one venv OUTSIDE the workspace, reused —
`python3 -m venv ~/.cache/pneuma/plotwise-py && ~/.cache/pneuma/plotwise-py/bin/pip install -q matplotlib numpy`,
then `~/.cache/pneuma/plotwise-py/bin/python script.py`. Evidence
directories hold scripts, their output, figures and `grounding.json` —
nothing else.

## The grounding iron law

Everything of knowledge that appears ON SCREEN — a formula, a plot, a
coordinate system, a diagram, a dataset, a derivation — must be bound to
evidence and provided to the video model in a guaranteed-correct form. The
video model is trusted with atmosphere, characters, narration delivery and
camera work; it is NEVER trusted to draw knowledge from imagination. (The
first smoke test of this mode produced a beautiful teacher in front of a
blackboard covered in incoherent triangle labels. That blackboard is what
this law exists to prevent.)

Concretely:

- A knowledge visual requires a **rendered reference figure** — produced by
  code (a Python/matplotlib plot, a hand-authored SVG converted to PNG, a
  computed table rendered to an image), checked for correctness, saved
  under `evidence/<beatId>/`, and listed in that beat's `evidence[]` in
  `course.json`. Never `generate_image.mjs` for knowledge figures — an
  image model hallucinates axes exactly like a video model does; generated
  images are for style anchors only.
- Facts in the narration follow the beat's accuracy tier, decided at
  planning time: `world-knowledge` (uncontroversial, no lookup),
  `citation` (searched, with URL evidence), or `code-verification`
  (derived or checked by code you actually ran). See
  `references/grounding.md`.
- **A figure is a reference, never a keyframe, and most shots show none.**
  The screenplay writer hears each beat's figures by path and names one
  in a shot only when the content must be exact — a coordinate plot, a
  formula, a table. That shot is shot reference-to-video with the figure
  as Image 2+ and the model reproduces it inside its own picture. A
  figure pinned as a first or last frame put the raw bitmap on screen
  and turned the course into a slideshow (2026-09-02). Whether a shot
  needs a figure at all is the writer's call from the content; a swing
  and a wave do not.
- Every scene's evidence lives in `nodes/<id>/evidence.json` and is
  visible to the user through the evidence panel. A knowledge scene with
  an empty evidence list is a defect, not a style choice.
- **The clip is the video model's clip.** Never replace or overlay H3
  Max's visuals with stills, wipes or slideshows to "guarantee" a figure —
  a figure the model cannot reproduce faithfully is too dense; simplify it
  at planning time (fewer labels, one idea per figure) and shoot again.
  Post-processing is limited to what the scripts do themselves (loudness,
  the concat of a scene's shots).

Enforcement has two halves. **Planning**: on Claude Code, run the
`plan-course` workflow (outline → per-beat grounding → audited
`course.json`); elsewhere follow the same stages by hand. **Play**:
`write-screenplay.mjs` refuses a figure that is not in the beat's
evidence list and on disk, and the manager shoots only what the
screenplay says. Neither renders anything: a missing figure is a planning
defect to fix in `evidence/<beatId>/`, not something to improvise
mid-course.

## After an interruption

The user's Stop button ends your turn AND kills any workflow running in
the background (its journal then says `status: killed`). Do not go
looking for it: `TaskOutput` / `ListAgents` will not find a killed run,
and reading its journal is not the same as finishing it. The state that
matters is on disk — `course.json` (outline? style? scenes with shots?
`play`?) and the `evidence/` directory. If the outline is missing,
launch `plan-course` again with `resumeFromRunId: "<the killed run's
id>"`: every agent call that already completed is returned from cache,
so only the grounding agents that never returned are paid for again. If
the outline is there but no scene has `shots`, run `write-screenplay.mjs`.
If scenes have shots but `state/manager.pid` is gone or its process is
dead, start the manager again with `--detach` — it takes its unfinished
scenes back and never pays for a shot that is already on disk. One check, one relaunch;
tell the user in a line what was resumed.

## Play — the screenplay and the manager

Two commands, run once each, in this order, after the style is confirmed
and the outline has landed:

```
node {SKILL_PATH}/scripts/write-screenplay.mjs --set <set> --json
node {SKILL_PATH}/scripts/play-manager.mjs --set <set> --detach \
  --slots 3 --video-ahead {{lookahead}} --plan-ahead 2 --resolution {{resolution}}
```

(`{SKILL_PATH}` is this skill's install directory — the base directory
shown when the skill loads. Paths inside course.json are set-relative.
The `--video-ahead` and `--resolution` values above ARE this session's
init params, filled in when the skill was installed — copy the command
as written. If either still reads as a `{{…}}` placeholder, use 2 and
480P. A session that asked for 768P and was shot at 480P is a wrong
course, not a slower one — the third trial did exactly that.) **`--detach` is the only way to start the manager.**
It daemonizes itself into its own session, waits for its pid file and
prints `{ pid, log }` — the command returns in seconds and the manager
lives on. Never `nohup … &`, never `run_in_background`, never run it in
the foreground: a process backgrounded by an agent's shell dies when the
command returns (the learner once sat ten minutes on "等待开拍" over a
manager that had died silently), and a foreground manager holds your turn
for the whole course, so no question can be answered. If a manager is
already running for the set, the command reports `alreadyRunning` and
does nothing — there is never a reason to start two. Its pid is
`<set>/state/manager.pid`, its log `<set>/state/manager.log`, its crash
output `<set>/state/manager.out`.

**The screenplay** is one designed call to GPT 5.6 Luna: the whole spine
at once — one scene per beat, 1–6 shots each with verbatim narration, the
picture in the style's materials, a duration inside H3's 5–15 s, and a
figure only where the content must be exact — plus one detour brief per
scene (an example, a closer look, a check; never a restatement). It is
validated (speech budget per shot, figures on disk, every beat covered)
and landed into `course.json` under the course lock: `n1..nK` main
scenes with `shots[]`, `n<k>d` detour stubs with a `brief`, children
linked (`继续：…`, the detour, `回到主线：…`), `rootNode`. When the single
call fails or comes back short, it falls back to scene by scene with the
previous scene as context, and reports `problems` — read them; a scene
over budget or a missing figure is yours to fix before the manager
starts (shorten the beat's summary, render the figure, re-run).

**The manager** then runs the play loop as a program:

- Two queues: *planning* (Luna writes detour and question scenes from
  their briefs, 3 at a time) and *video* (H3 renders scenes, `--slots`
  at a time). A scene renders shot by shot: endpoint chosen from what the
  shot shows (image-to-video from the previous shot's last frame; a
  scene's first shot opens from the style anchor; reference-to-video when
  the shot names a figure or the course has a recurring character) →
  loudness → transcription → narration check (one re-shoot with a fresh
  seed on failure) → last frame → next shot; then the shots are
  concatenated into `nodes/<id>/video.mp4`, `script.md` is written and
  the scene is `ready`. A narration that cannot be transcribed (two
  attempts) is NOT waved through: the shot fails with the reason, the
  clip stays on disk as `unchecked`, and a retry checks it before it
  would pay for another render. A shot that binds more figures than the
  reference slots allow (four, less the continuity frame and the
  course's recurring characters) fails at the shoot, naming the split —
  the screenplay validator caps by the same budget, so read its
  `problems`.
- Scheduling by distance from the scene the learner is on: its children
  first, then grandchildren, main before detour, a question above
  everything; scenes are shot exactly `--video-ahead` steps ahead
  (`2` = the next two main scenes and the detours they offer), detours
  written `--plan-ahead` steps ahead. Anything outside the window waits
  `planned`.
- A choice (`state/choice.json`, written by the viewer) makes the chosen
  scene current, appends it to `path[]`, and **prunes** the siblings'
  subtrees: their queued and running jobs are cancelled — remotely too,
  a fal job in flight is cancelled at the queue — and they are marked
  `cancelled` (still on the map; choosing one later revives it). A retry
  of a failed or stuck scene re-queues it keeping the shots that passed;
  a retry of a READY scene (再拍一次 on a scene the learner has seen) is
  a new take of every shot.
- Every state change is written to `course.json` under the lock —
  `status` (`planned|scripting|queued|generating|ready|failed|cancelled`),
  `phase`, `shotIndex/shotCount`, `startedAt`, `error` on each node, and
  a `play{}` snapshot with `state`, `currentNode`, the queues and
  `updatedAt`, its heartbeat. The viewer reads all of it: cards say
  "拍摄中 2/3", the interlude between scenes shows the wait with a clock,
  and a heartbeat that stops sends you `managerOffline`.
- It exits `complete` after the last main scene, or on SIGTERM.

Numbers to expect at 480P: screenplay 30–60 s; the opening scene (three
shots) about 2–3 min from the manager's start, with scenes 2–3 rendering
in parallel meanwhile; then a 45 s scene is consumed per ~60 s of
watching while three slots make a shot per ~20 s — ahead as long as the
learner watches whole scenes. `state/manager.log` has a line per shot
with its timings; if a shot is far outside 20–40 s, report it rather than
work around it.

**During play you do nothing.** No recording of what was watched, no
auditing, no re-reading the plan, no navigation. Between the moment the
manager starts and the moment the learner asks something, your turn is
over and the stage is the manager's.

## Choices

The screenplay decides the choices; you do not improvise them mid-course.
Every main scene ends with:

1. **继续** — the next beat of the outline (the spine). The card names
   the next scene.
2. **One detour** — the scene's own side trip, written from the brief the
   screenplay offered with it: a worked example, a closer look at one
   term, a check the learner can do. It returns to the spine.
3. **我有问题** — the learner's own question (below).

A detour serves the scene it hangs off and never starts a new topic; the
outline is the attention anchor, and every road returns to it.

## A learner's question

A question is the one thing during play that needs you, because the
answer has to be grounded before the manager can shoot it. On
`userQuestion` (it names the scene they were on):

1. Verify the answer now — its accuracy tier, a search or a derivation
   as the question deserves. This is preparation; the learner expects
   this wait (the stage says so).
2. If the answer needs a figure, render it under `evidence/<sceneId>/`
   exactly as for a beat (the scene id is `q<n>`, the manager mints the
   next free one — use the id you expect and check `manager.log`).
3. Hand it to the manager: write `<set>/state/requests/<slug>.json` with
   `{ "parent": "<the scene they were on>", "label": "<the card text, in
   the course language>", "brief": "<one paragraph: what the scene
   teaches, how it opens from what they just watched, how it closes back
   onto the spine>" }`. The manager writes the shots, shoots the scene at
   top priority, links it under the parent with the way back, and the
   card appears when it is ready.

Do not shoot it yourself and do not navigate-to. Say in one line that the
answer is being made.

## Video generation (direct use)

**The scripts own their retries.** `generate-video.mjs` submits to fal's
queue, retries a transient failure (a 5xx, a 429, a dropped connection)
with a short back-off and cancels the remote job when it is killed;
`make-style-sample.mjs` reuses the anchor already on file and falls back
from reference-to-video to image-to-video when that endpoint is down;
the manager re-shoots once on a narration failure and marks the scene
`failed` with the reason otherwise. Never wrap a script in your own
retry loop or probe fal's endpoints yourself — one call, and if it still
fails, the board (or the node's `failed` status) already shows the
reason: tell the user in one line and try again only when they ask.

Video is generated ONLY through fal.ai's MiniMax H3 Max endpoints — the
model is served nowhere else. During the style step
`make-style-sample.mjs` and during play the manager call the generator
for you. Call it directly only for keepsake re-renders:

```
node {SKILL_PATH}/scripts/generate-video.mjs --prompt "..." \
  --output <set>/keepsake/<id>.mp4 --duration 10 --resolution 768P \
  [--ref-image <set>/style/anchor.png] --json
```

- H3 Max speaks tagged narration **verbatim, with lipsync**, and generates
  audio natively — no TTS in the main path. Write prompts in the official
  three-section shape (`references/generation.md`).
- 480P + `balanced` expansion during interaction unless the `resolution`
  init param says 768P; `quality` only for a keepsake export the user
  asks for.
- Every clip is auto-normalized to -16 LUFS (raw loudness varies by
  >25 LU between shoots). Needs `ffmpeg`, like the frame chain and the
  concat.

## Style continuity — the frame chain

Shots made independently drift apart even under one style recipe: three
"chalkboard" clips came back with three boards, three chalk textures,
three handwritings. A course must feel like ONE continuous production, so
style is anchored by IMAGES, never by prompt adjectives alone:

- **Inside a scene the shots are chained**: shot k+1 is image-to-video
  from shot k's last frame — the previous shot's end is this one's start,
  and a scene plays as one take. A shot that shows a figure, or a course
  with a recurring character, is reference-to-video with that frame as
  Image 1 and the figure / character as Image 2+ — references the model
  reproduces inside its own picture, never keyframes.
- **Scenes open from the style anchor.** A cut between scenes is natural
  (the learner chose something there), so every scene's first shot is
  reference-to-video on `<set>/style/anchor.png` plus any recurring
  subjects — which is what lets scenes render in parallel. (Validated
  2026-09-01: chained shoots kept one board, one chalk, one hand.)
- **The chain starts at the confirmed sample.** `make-style-sample.mjs`
  generates the style anchor (`<set>/style/anchor.png`, GPT-Image-2 from
  the recipe — aesthetic material, so an image model is the right tool)
  and shoots the 5s sample from it. `confirm-style` records
  `refImages = [anchor, ...learner references]`; entries after the anchor
  ride along as recurring subjects on every shot.

## Narration QA (direct use)

The manager transcribes and judges every shot itself (the style sample
is not gated — the learner judges it with their own ears). For clips you
shoot directly (keepsake re-renders), run the gate by hand:

```
node {SKILL_PATH}/scripts/transcribe.mjs --input <clip> --language zh --json
```

Punctuation and homophone drift is fine; a changed fact, number, term, or a
dropped clause is a FAIL — re-shoot once with a new seed, then shorten the
script. A clip that says the wrong thing is worse than no clip.

## Course lifecycle

**Kickoff.** This session's init params: course depth
**{{perceivedDuration}}**, scenes shot ahead **{{lookahead}}**, resolution
**{{resolution}}**. Both API keys are required and nothing here has an
offline lane: fal for every clip, OpenRouter for the screenplay, every
detour and question scene and the narration judge — `write-screenplay.mjs`
and the manager refuse to run without `OPENROUTER_API_KEY`, and there is
no fallback to your own model. If a key is missing, say so in one line
and stop. Confirm the learning goal and perceived length with the user
in one short exchange. The moment the topic is known:

1. `course-edit.mjs init --set <slug> --title "<course title>" --topic "<topic>" --goal "<goal>"`
   — the board now shows the topic, and the sampler has a course to
   write into.
2. **Plan, in the background.** On Claude Code:
   `Workflow({ name: 'plan-course', args: { topic, contentSet, goal, depth, language, cwd } })`
   (the Workflow tool returns immediately). The planner lands the OUTLINE
   in course.json within a couple of minutes (`course-edit.mjs outline`:
   beats, n1 minted, textbook beats grounded by definition) and then
   grounds beat by beat, committing each one the moment it is done
   (`course-edit.mjs evidence`) — the viewer counts them up. Elsewhere
   follow the same stages by hand: propose the outline →
   `course-edit.mjs outline --set <set> --file outline.json` → for each
   beat that needs work, search / derive / render under
   `evidence/<beatId>/`, write `grounding.json` and `course-edit.mjs
   evidence --beat <id> --file ...` — first beat first, keep answering
   style notifications between beats. When the plan reports done, run
   `course-edit.mjs audit --set <set>` and read what each beat still owes.
   **Without a Workflow tool (Codex, Kimi) the planning runs in your own
   turn, and notifications only reach you between turns** — so the
   learner's style request waits behind every beat you ground. Order it
   for them: land the outline (`course-edit.mjs outline`, a minute) and
   END THE TURN; answer the board's notification the moment it arrives
   (the sample is what they are waiting for); ground the beats while
   they look at the sample and after they confirm it — the first beats
   first, since the screenplay needs their figures before the opening.
   Measured 2026-09-03: grounding seven beats inline held the style
   board for three minutes.
   **The outline is the evidence index the screenplay reads**; a figure on
   disk but not committed is invisible to every shot. Thoroughness pays
   in the evidence — read the code, run the derivation, keep each figure
   to one idea — not in reading whole papers: a pinned URL with an honest
   note is a citation.
3. **The style step, on the board.** Tell the user in one line that the
   style is theirs to settle on the right, then wait. The board has
   three doors — a preset card, "为我推荐", "我要自定义" — and every one
   ends in the same place: `make-style-sample.mjs` shoots a sample (anchor
   still + 5s clip speaking ONE hook line about the topic) and the user
   confirms it there. Your part is small and fast: pick the candidate
   when asked to recommend, write the recipe when they describe their
   own, and write two things every time — the **hook line** (the single
   most receivable sentence of the subject, the one the topic is
   remembered by) and its **action** (what those five seconds SHOW: the
   hook made visible in the style's own materials — paper waves
   stacking and peeling apart, chalk segments sliding into a triangle —
   motion and objects, never on-screen text, formulas or labeled
   figures, which belong to the course with real evidence). A sample
   without an action is the empty set with a voice over it: it shows the
   look and hides the topic. No audition, no alternatives list, no
   re-litigating the style on the stage later. A learner's reference
   images (from chat) go under `<set>/style/refs/` and into
   `--ref-image`.

**Start.** On `styleConfirmed`: `course-edit.mjs confirm-style`. If
course.json has no outline yet, wait for the Outline phase (minutes, not
the whole plan — grounding streams in behind the course; the screenplay
only needs the beats and whatever figures have landed, and a beat whose
figure lands later is fine as long as it landed before that scene is
shot — for the first beats, wait for their evidence). Then
`write-screenplay.mjs`, read its `problems`, fix what it names, then
`play-manager.mjs --detach`, read the `{ pid }` it prints, and end the
turn. The manager shoots
the opening and everything after; the stage opens when the root scene is
ready.

**Learning loop.** Nothing, unless a `userQuestion`, `managerOffline` or
`courseComplete` arrives.

**Finale.** On `courseComplete` (the viewer sends it once `play.state`
is `complete` — the last main scene chosen — and no summary exists),
write `summary.md` — a recap built from the user's ACTUAL path (which
detours they took, what they asked), not a generic abstract. Register
it (`course-edit.mjs summary --file summary.md`), point the user at the
course map, and offer a keepsake export (768P re-render + ffmpeg concat
of the taken path) only if they want it.

## File layout (the contract with the viewer)

```
<set>/course.json               tree + meta: title, topic, goal, language, style,
                                outline[] (each beat with evidence[]),
                                rootNode, path[], nodes{}, play{}, summaryFile
<set>/evidence/<beatId>/        planning-time evidence: figures (PNG), sources.json,
                                verification code + output
<set>/evidence/<sceneId>/       question-scene evidence, same shapes
<set>/style/anchor.png          the style anchor (refImages[0])
<set>/style/sample.mp4          the confirmed sample clip
<set>/style/sample.json         sample provenance
<set>/style/refs/               learner-provided reference images
<set>/state/choice.json         the learner's latest choice / retry (viewer → manager)
<set>/state/requests/*.json     question scenes you hand to the manager
<set>/state/manager.pid|.log    the manager's liveness and log
<set>/nodes/<id>/s<k>.mp4       one shot; s<k>.last.png its last frame
<set>/nodes/<id>/video.mp4      the scene (the shots concatenated)
<set>/nodes/<id>/script.md      the scene's narration (canonical text)
<set>/nodes/<id>/evidence.json  [{ kind, file?, url?, note }]
<set>/summary.md                the recap
```

`course.json` node entries carry `parent`, `beat`, `kind`
(`main|branch|question`), `choiceLabel`, `brief` (stubs), `shots[]`
(`{id, script, visual, duration, figures[], videoPrompt, status, video?,
qa?}` — a shot's `status` is `planned|ready|unchecked`, the last one a
clip on disk whose narration is still to be checked),
`video {file, duration}`, `children [{nodeId, label}]`, `status`, and
while in production `phase`, `shotIndex`, `shotCount`, `startedAt`,
`error`. `style` carries `id`, `status`
(`pending|sampling|sampled|confirmed`), `name`/`recipe`/`rationale` for
custom or adjusted styles, `sample {image, video, hook}`, `userRefs[]`
and, once confirmed, `refImages[]`. `write-screenplay.mjs` writes the
scenes; the manager writes `nodes[*]` during play, `path[]` and `play{}`;
`make-style-sample.mjs` writes `style`; `course-edit.mjs` writes
`outline[]`, `style` (init / confirm / reset) and `summaryFile` — all
under the same lock, so never hand-edit `course.json` while the manager
is running. Write course content (titles, labels, scripts, summaries) in
the user's language.

<!-- pneuma:end -->

## References

Read when you need depth; keep this file lean.

| Topic | File |
|---|---|
| Style presets — 18 recipes, narration modes, best-for | `references/styles.md` |
| Grounding — accuracy tiers, figure rendering, the outline evidence index, evidence schema | `references/grounding.md` |
| Generation — endpoint cheatsheet, prompt anatomy, the manager's steps and timings, QA, pricing | `references/generation.md` |
