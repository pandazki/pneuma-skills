# Mode design brief — Backlot (片场)

Status: **approved for implementation, 2026-09-20** (name, scope, gating and
seed budget chosen by the user in the discovery interview). Supersedes the
single-shot brief in [2026-09-20-previz-mode.md](2026-09-20-previz-mode.md):
everything that brief built — the pawn greybox, the three-lane player, the
shot pipeline in `previz.mjs`, the blind-trial findings — moves into this mode
unchanged as its *previz* and *takes* stages. The experiment record
[2026-09-20-previz-experiments.md](2026-09-20-previz-experiments.md) remains
the evidence base.

## Identity

- name: `backlot`
- displayName: `{ en: "Backlot", zh: "片场", ja: "バックロット" }`
- description: *From an idea to a finished cut — screenplay, character and set
  bible, storyboard frames, 3D greybox previz, model-rendered takes, dialogue
  and music. The creator approves every stage before the next one starts.*
- icon: lucide-style single-path line icon — a clapperboard whose open top
  half is a wireframe box (the greybox inside the film).
- supportedBackends: `claude-code`, `codex` (as previz);
  `agent.reasoningEffort: "medium"` — the user's acceptance baseline is Codex
  GPT-6 Astra at medium, and blind trials 2–3 passed at that setting.
- hidden: no; featured-eligible: yes

## Domain

The creator is making **one short film**. The work moves through eight
stages in a fixed order; every stage leaves a file the creator can read, and
the next stage is built *from* that file, never from the agent's memory:

| # | stage | id | what the creator sees | machine truth |
|---|---|---|---|---|
| 1 | Idea | `idea` | logline, tone, length, audience | `idea.md` |
| 2 | Screenplay | `script` | scenes, action, dialogue | `screenplay.md` (human) + `scenes` in `backlot.json` |
| 3 | Bible | `bible` | characters and sets, each with a look image and (characters) a voice | `bible/characters/<id>/character.json` + `sheet.png` + `voice.mp3`; `bible/sets/<id>/set.json` + `concept.png` |
| 4 | Boards | `boards` | the shot list with one concept frame per shot | `shots/<id>/shot.json` (order in `backlot.json.shots`) + `shots/<id>/board.png` |
| 5 | Previz | `previz` | the greybox per shot, checked | `shots/<id>/greybox/**` (unchanged from previz) |
| 6 | Takes | `takes` | rendered takes per shot, checked, one selected | `shots/<id>/takes/**` (unchanged) |
| 7 | Sound | `sound` | voice-over lines, music | `sound/lines/<id>.mp3`, `sound/music.mp3`, `sound/sound.json` |
| 8 | Cut | `cut` | the assembled film with its edit list | `cut/final.mp4`, `cut/reel.mp4`, `cut/edl.json` |

The greybox stage is the thing this mode is *about*: it fixes space,
blocking, prop events and camera in 3D before any money is spent on a video
model, exactly as the previz brief established ("pawns, not puppets"). The
stages before it exist so the greybox is built from an approved story with
an approved look; the stages after it turn approved shots into a film.

### Division of labour per stage

- **Idea, Screenplay** — agent judgment, plain markdown; scripts only
  register scenes and validate structure.
- **Bible** — look by image generation (`generate_image.mjs`, shared),
  character voices by TTS sample (`generate-tts.mjs`, shared); scripts
  register and validate, the agent writes the descriptions.
- **Boards** — one frame per shot by image generation with the bible images
  as references (`--image-urls`), so faces, wardrobe and set dressing hold
  across shots before a single take is bought.
- **Previz, Takes** — the existing previz pipeline. The take now carries the
  bible and board as references beside the greybox: `@Video1` greybox,
  `@Image1` board frame, `@Image2…` character sheets and set concept,
  `@Audio1…` character voice samples when a line is spoken on screen.
- **Sound** — voice-over / narration lines by TTS; music by Lyria
  (`generate-bgm.mjs`, promoted from clipcraft to `modes/_shared/scripts`
  as a copy — clipcraft is not modified in this change and can switch to the
  shared copy in its own release). Ambience and effects come from the takes'
  native audio; no SFX generator exists in the repository and none is added.
- **Cut** — deterministic ffmpeg assembly in a script: selected takes in shot
  order, take audio kept as ambience, voice-over placed at its second, music
  under, fades; `--reel` builds the same cut with the greybox standing in for
  any shot without a take (a story reel, free).

### Dialogue policy

A line in a shot is either **spoken** (on screen) or **vo** (voice-over).
Spoken lines are rendered *by the video model*: the take prompt carries the
line verbatim and the character's `voice.mp3` as an `@Audio` reference, and
the take is checked with `transcribe.mjs` (`take-lines`: the transcript must
contain the line) — the plotwise pattern. VO lines are TTS files mixed in the
cut. Mixing TTS over a mouth the model animated is never done; that is the
lip-sync failure the two kinds exist to avoid.

## Invariants and implementation choice

- **Order of stages is a contract, and paid stages sit behind a gate.** A
  stage's status is `empty | draft | approved | changed`. `approved` is
  recorded by `backlot.mjs approve <stage>` together with a content hash of
  that stage's files; when the files change afterwards the status becomes
  `changed` and the creator sees it. Paid commands (`boards` frames, bible
  images, `previz.mjs generate`, `sound`, `cut` final) refuse unless the
  preceding stage is `approved`, or the project's gates are open
  (`backlot.mjs gates open`, which the agent runs only when the creator has
  said, in so many words, to run through). Verified by CLI tests.
- **One writer per file.** `backlot.mjs` is the only writer of `backlot.json`,
  `bible/**/*.json`, `sound/sound.json`, `cut/edl.json`; `previz.mjs` remains
  the only writer of `shots/<id>/shot.json`. The agent writes markdown, the
  Blender scene and prompt packs; the viewer writes nothing. Approval from
  the viewer is a *command to the agent* (`approve-stage`), not a write.
- **Every previz invariant holds unchanged** (frames = seconds × fps; checks
  with history; `stuck`; takes recorded `submitted` before the request; a
  second take needs `--fix`, a third `--user-approved`; never call 480p 1080p;
  cause before effect). Their tests move with the code.
- **The cut is an honest projection of the shots.** `edl.json` lists each
  segment's source (`take-02` or `greybox`), its offset and duration; the
  viewer seeks by it. A reel with greybox stand-ins is labelled a reel, never
  a final. `cut` refuses to produce `final.mp4` while any shot lacks a
  selected take.
- **Cost is a first-class record.** Every paid call (image, TTS, music,
  take) is recorded with its stage, price and time; the project Cost view
  sums by stage. Prices come from the shared scripts' tables where they
  exist; where the vendor returns `usage.cost` (OpenRouter images, Lyria),
  that figure is recorded and marked *reported*.
- **State and writers:** persistent work = the files above; transient UI
  state = selected stage/shot/lane/time/layout, held in the viewer and
  addressable through `ViewerAddress`; no viewer-side persistence.
- **Reuse:** the whole of `modes/previz` (viewer, scripts, kit, tests,
  upstream snapshot) moves to `modes/backlot`; shared scripts
  `generate_image`, `generate-tts`, `transcribe`, `seedance-video`,
  `fal-queue`; plotwise's patterns (continuity kit, transcript QA, ffmpeg
  concat) are re-implemented in `backlot.mjs`, not imported — they are
  mode-owned code there. No `@pneuma-craft` dependency: this mode's
  composition is one linear cut described by `edl.json`, and the timeline
  model in `@pneuma-craft/timeline` would be an abstraction over a list.
- **Added complexity:** the stage/gate machine (one enum, one hash, one
  guard function) and a second script. Both are justified by the user's
  gating decision and by the previz finding that agents spend when they
  think they should.

## Source layer

- kind: `aggregate-file` (as previz)
- domain type: `Film` — `{ dir, title, stages: Record<StageId, StageState>, scenes: Scene[], characters: Character[], sets: SetPiece[], shots: Shot[], sound: SoundState, cut: CutState | null, cost: CostLine[], warnings }`. `Shot` is previz's `Shot` plus `scene`, `board: { file, rev } | null`, `lines: Line[]`.
- why: one film is one object with parts that live in many files; the viewer
  needs the whole to draw the rail and the cut.
- domain.ts: yes (extends previz's `load`; `save` remains a no-op — the
  viewer never writes).

## Workspace model

- type: `"manifest"`; multiFile: true; ordered: true (shot order);
  hasActiveFile: false; supportsContentSets: true (one film per set, as previz).

## ViewerAddress vocabulary

- coarse keys: `contentSet?`, `stage`, `shot?`
- fine keys: `scene?` (script), `character?` / `set?` (bible), `lane?`,
  `take?`, `time?`, `range?`, `layout?` (previz/takes, unchanged),
  `line?` (sound), `segment?` (cut)
- examples: `{ stage: "script", scene: 2 }`,
  `{ stage: "previz", shot: "fridge-light", lane: "greybox", time: 4.2 }`,
  `{ stage: "cut", segment: "fridge-light" }`
- documented in `skill/SKILL.md`.

## Action space

| id | label | category | agentInvocable | params |
|---|---|---|---|---|
| navigate-to | Go to | navigate | true | `{ address }` |
| get-player-state | Where is the player | inspect | true | — |
| approve-stage | Approve this stage | command (user → agent) | false | `{ stage }` → chat "approve <stage>" |
| check-greybox / generate-take | (previz, unchanged) | command | false | `{ shot }` |

`approve-stage` is a button on the stage rail; it sends a message the agent
acts on with `backlot.mjs approve`. Requesting changes is ordinary chat.

## Viewer

One screen, the **stage rail** across the top (eight stages with status pill
and stage cost; the current stage highlighted; the approve button on a
`draft`/`changed` stage), and a body that changes with the stage:

- **Idea / Screenplay** — rendered markdown with screenplay typography; the
  scene list on the left; each scene lists its shots (link → boards).
- **Bible** — two card grids, characters and sets: image, name, one-line,
  voice sample play button on characters.
- **Boards** — the shot strip: board frame, scene number, one-line, seconds,
  the shot's stage badge (planned / greybox n checks / take selected); click
  → previz for that shot. A shot with no frame shows a grey card, not
  nothing.
- **Previz / Takes** — the existing player (lanes, layouts, beats, 3D
  inspection, panel tabs) with a fourth lane `board` (still) and the
  existing right panel; `Takes` differs from `Previz` only in the default
  lane/layout and which checks are shown first.
- **Sound** — lines table (speaker, kind, text, seconds, play), music row
  with play and the brief it was made from.
- **Cut** — the film player; under it a segment strip from `edl.json`
  (click to seek; greybox stand-ins hatched and labelled), then rows for
  voice-over and music showing where they land.
- **Cost** — panel tab at project level: totals by stage, every paid call.

Partial states are drawn as such: a stage with nothing shows the stage's
one-line explanation and what the agent will produce; a shot in flight shows
its `submitted` take with elapsed time. No emoji; SVG icons.

## Skill

`skill/SKILL.md` follows scene → viewer contract → rules → workflow →
commands → references. The workflow is the eight stages with the gate at
each: *produce → show → stop → the creator approves or asks for changes →
next*. The gate sentence is explicit: the agent stops at the end of a stage
unless the creator has told it to run through, and never spends before the
preceding stage is approved. References: existing five (rewritten for the
project-level flow) plus `screenplay.md` (format, scene → shot breakdown,
durations from pace arithmetic, the two line kinds), `bible.md` (sheet spec:
neutral background, three-quarter/front/profile, the same face every time;
set concept: wide establishing frame matching the greybox layout; voice
choice and sample text), `sound-and-cut.md` (TTS voices, music brief, mix
levels, reel vs final). The three trial lessons stay where they are.

## Scripts

- `backlot.mjs` (new): `init`, `status`, `stage <id>` (compute), `approve
  <stage>`, `gates open|closed`, `scene add|set`, `character add|set`, `set
  add|set` (sets = places), `board <shot> --file`, `lines <shot> --set`,
  `voice <character>` (TTS sample), `vo <shot> <line>` (TTS line), `music
  --prompt`, `cut [--reel]`, `cost`.
- `previz.mjs` (moved, unchanged except: `generate` accepts `--ref-image`,
  `--ref-audio` pass-through and appends `take-lines` when the shot has a
  spoken line; the stage gate check before spending).
- `modes/_shared/scripts/generate-bgm.mjs` (copied from clipcraft, with its
  `.d.mts` and a test; clipcraft untouched).

## Seed strategy

- shape: content sets, one film each; first set is a **wuxia fight** (user's
  direction, 2026-09-20): a high-quality martial-arts-animation feel, an open
  space crowded with reference geometry — a ruined mountain temple courtyard:
  stone terrace, broken colonnade, a bell tower, prayer flags, a great tree,
  scattered blocks — two fighters, and a camera that does what video models
  cannot do on their own: a wide orbit around the duel, a dolly zoom
  (Hitchcock) as the challenger lands, a multi-angle collage of one strike
  cut from three cameras, a crane rise at the end. Six to seven shots of
  4–6 s (~30 s of film), one voice-over line, drums-and-guqin music. The
  greybox is the argument here: the space and the camera are exact, and the
  prompt carries the fighting bodies.
- kit additions this story needs (public API, tested): `orbit(cam, center,
  radius, height, deg_from, deg_to, start, end)`, `zoom(cam, mm_from,
  mm_to, start, end)`, `dolly_zoom(cam, subject, dist_from, dist_to, start,
  end)` (moves the camera along its axis and compensates focal length so
  the subject's size holds), and `dash(fig, path, start, end)` for a leap
  or burst faster than `travel`'s walking paces (pace `"leap"`, validated
  separately so the walk paces stay honest).
- budget: ≤ $15 as agreed; expected ≈ $10 (about 30 s of 480p takes at
  ~$0.26/s of output incl. the billed reference, plus ~8 images, TTS,
  music; one re-shot in reserve). The seed is produced by a real session of
  the mode (Codex, GPT-6 Astra medium — the user's acceptance baseline),
  not by hand, so it doubles as the first end-to-end run of the stage flow.

## External integrations

- proxy: none. init.params: `blenderPath`, `falApiKey` (sensitive),
  `openrouterApiKey` (sensitive; images and music). envMapping
  `BLENDER_PATH`, `FAL_KEY`, `OPENROUTER_API_KEY`.
- skill.mcpServers: none. viewer.refreshStrategy: `auto`.
- NOTICE.md: yes — the previz NOTICE moves; upstream snapshot
  `upstream/blender-video-workflows/` moves with it. inspiredBy unchanged.
- external effects: every paid call is recorded before the request leaves
  (previz's `submitted` discipline extended to images, TTS and music via the
  cost log); a retry is a new record; nothing is called reversible.

## Cloud surfaces

- hosted player: no (as previz — three.js lane, media files, live checks; a
  reel could be shared later as a plain MP4).
- artifact deploy: none.

## Launcher surface

- visibility: public; featured-eligible: yes.

## Evolution directive

> Learn how this creator tells stories: the voice and pace of their
> screenplays, the faces and places they keep, their shot grammar and camera
> habits, how much they want to approve at each stage, and the look they
> keep asking the prompt for.

## Migration from `previz`

`git mv modes/previz modes/backlot`; rename identifiers (`PrevizPreview` →
`BacklotPreview`, `previz.json` → `backlot.json`, registry and README rows,
docs); `previz.mjs` and `previz_kit.py` keep their names — they *are* the
previz stage. The `first-light` seed becomes a second content set only if it
fits the new schema for free; otherwise it is dropped in favour of
`last-customer`. Tests move and must stay green before any new code lands.

## Tonight's scope and order

1. Move and rename (mechanical), tests green.
2. In parallel: `backlot.mjs` + `domain.ts` + tests; the viewer's rail and
   six stage views; skill rewrite + `generate-bgm` promotion.
3. Register, README rows, typecheck, tests.
4. Seed run (real session, Claude backend), showcase re-shoot, browser
   verification of every stage view.

## Appendix — contracts (authoritative for implementation)

### Files and their single writer

| file | writer | notes |
|---|---|---|
| `backlot.json` | `backlot.mjs` | project manifest, approvals, order |
| `idea.md`, `screenplay.md`, `shots/<id>/{shot-plan,prompts,comparison}.md`, `greybox/scene.py` | agent | prose and the Blender script |
| `bible/characters/<id>/character.json`, `bible/sets/<id>/set.json` | `backlot.mjs` | image/voice records incl. cost |
| `sound/sound.json` | `backlot.mjs` | music record |
| `cut/edl.json` | `backlot.mjs` | edit list of the last cut/reel |
| `shots/<id>/shot.json` | `previz.mjs` | unchanged owner; gains `scene`, `characters`, `set`, `board`, `lines` |
| viewer | nothing | read-only; approval is a command to the agent |

**There is no separate cost ledger.** Every paid record (`take.cost`,
`board.cost`, `line.cost`, `sheet.cost`, `voice.sample.cost`, `music.cost`)
lives beside the artifact it paid for, with `{ usd, basis }` where `basis`
is `"table"` (price table), `"reported"` (vendor `usage.cost`) or
`"estimate"`. `domain.ts` aggregates them into `Film.cost` by stage.

### `backlot.json`

```jsonc
{
  "version": 1,
  "title": "最后一位顾客",
  "logline": "…",
  "defaults": { "seconds": 8, "fps": 24, "width": 1280, "height": 720 },
  "gates": "closed",                    // "closed" | "open"
  "approvals": {                        // only approvals are stored; status is derived
    "script": { "at": 1758380000000, "hash": "9f3a1c2e" }
  },
  "scenes": [ { "id": "sc1", "number": 1, "heading": "INT. 便利店 — 夜", "summary": "…" } ],
  "characters": ["kai", "clerk"],       // bible ids, in order
  "sets": ["store"],
  "shots": ["s01-enter", "s02-fridge-light", "s03-counter"]
}
```

### Stage state — one algorithm, two runtimes

`modes/backlot/skill/scripts/stage-state.mjs` (+ `.d.mts`) is imported by
both `backlot.mjs`/`previz.mjs` (Node) and `domain.ts` (browser), the way
`prices.mjs` already is. It exports:

- `STAGES = ["idea","script","bible","boards","previz","takes","sound","cut"]`
- `stageInputs(stage, texts)` — the *text* files that define a stage's
  content (markdown, JSON records; media never enters the hash — a media
  file's identity is the `{ file, revision }` record its JSON carries).
- `hashStage(stage, texts)` — FNV-1a 32-bit hex over the canonical
  concatenation of those inputs.
- `stageStatus(stage, texts, approvals)` → `"empty" | "draft" | "approved" | "changed"`.
- `gateFor(command)` → the stage that must be `approved` before the command
  may spend: `bible-image|voice ← script`, `board ← bible`,
  `generate ← previz`, `vo|music ← takes`, `cut --final ← sound`. `gates:
  "open"` satisfies every gate; `cut --reel`, `render`, `check` need none.

Stage inputs: `idea` ← `idea.md`; `script` ← `screenplay.md` + `scenes`;
`bible` ← every `character.json`/`set.json`; `boards` ← `shots` order +
each shot's `title, scene, characters, set, spec, beats, board`; `previz` ←
each shot's `greybox.final.revision` + greybox check statuses; `takes` ←
each shot's selected take id + take check statuses; `sound` ← `sound.json`
+ every `lines[].file`; `cut` ← `edl.json`.

A stage is `empty` when its inputs are absent, `draft` when present and
unapproved, `approved` when the stored hash equals the current one,
`changed` otherwise. The rail shows `changed` in the warning colour.

### `shot.json` additions (previz.mjs)

```jsonc
"scene": "sc1",
"characters": ["kai"],                // bible ids present in the shot
"set": "store",
"board": { "file": "board.png", "revision": 1, "prompt": "…", "refs": ["bible/characters/kai/sheet.png"], "at": 0, "cost": { "usd": 0.13, "basis": "reported" } },
"lines": [
  { "id": "l1", "speaker": "kai", "kind": "spoken", "text": "还开着吗？", "at": 5.2, "file": null, "seconds": null, "cost": null },
  { "id": "l2", "speaker": "narrator", "kind": "vo", "text": "凌晨三点，这家店只有一个客人。", "at": 0.8, "file": "sound/l2.mp3", "seconds": 3.1, "cost": { "usd": 0.01, "basis": "table" } }
]
```

`previz.mjs` subcommands added: `board <shot-dir> --file <png> --prompt
--refs` (registers a frame; generation itself is `generate_image.mjs`),
`lines <shot-dir> --set <json>`, `vo <shot-dir> <line-id>` (TTS through
`generate-tts.mjs`, records file/seconds/cost), `meta <shot-dir> --scene
--characters --set`. `init` and `shot` move to `backlot.mjs` (`backlot.mjs
shot add <id> --scene sc1 --title …` writes the order into `backlot.json`
and creates the shot directory through the same `createShot` in
`shot.mjs`). `generate` gathers references automatically — `@Video1`
greybox, `@Image1` board, then character sheets and set concept in bible
order, then voice samples for spoken lines' speakers — passes them through
to `seedance-video.mjs`, and refuses a prompt pack that names a reference
index it did not attach. It appends `take-lines` to the take checks when
the shot has a spoken line; the check's evidence is a `transcribe.mjs`
transcript stored beside the take. **Reference syntax**: use whatever
`seedance-video.mjs` documents (`@Video1` per its header) and correct the
previz references where they say otherwise.

### Bible records (backlot.mjs)

```jsonc
// bible/characters/kai/character.json
{ "version": 1, "id": "kai", "name": "小凯", "description": "…", "look": "prompt text used for the sheet",
  "sheet": { "file": "sheet.png", "revision": 1, "cost": { … } } | null,
  "voice": { "model": "seed-speech", "voiceId": "…", "style": "…",
             "sample": { "file": "voice.mp3", "text": "…", "seconds": 4.2, "cost": { … } } | null } | null }
// bible/sets/store/set.json
{ "version": 1, "id": "store", "name": "便利店", "description": "…", "look": "…",
  "concept": { "file": "concept.png", "revision": 1, "cost": { … } } | null }
```

`backlot.mjs character add|set-look|voice`, `backlot.mjs set add|set-look`.
Image generation is the shared script; `set-look --file` registers the
result and records the cost the script reported.

### Sound and cut (backlot.mjs)

```jsonc
// sound/sound.json
{ "version": 1, "music": { "file": "music.mp3", "prompt": "…", "model": "google/lyria-3-pro-preview", "seconds": 26.0, "cost": { … } } | null }
// cut/edl.json
{ "version": 1, "kind": "reel" | "final", "file": "reel.mp4" | "final.mp4", "seconds": 24.0, "builtAt": 0, "probe": { … },
  "segments": [ { "shot": "s01-enter", "source": "take-01" | "greybox", "offset": 0, "seconds": 8 } ],
  "vo": [ { "shot": "s01-enter", "line": "l2", "at": 0.8, "file": "shots/s01-enter/sound/l2.mp3" } ],
  "music": { "file": "sound/music.mp3", "gainDb": -18, "fadeOutSeconds": 2 } | null }
```

`backlot.mjs cut [--reel|--final]` re-encodes every segment to the project
spec, concatenates, keeps take audio as ambience (greybox stand-ins are
silent), places VO at `segment.offset + line.at`, lays music under at
`gainDb` with a fade-out, and writes `edl.json` last. `--final` refuses
while any shot lacks a selected take.

### Pictures come from the greybox (added 2026-09-21 evening, user)

Round 3 exposed that storyboard frames drawn from text + bible before the
greybox are not continuous with each other — eight pictures with no shared
space or camera — while the greybox is exactly that shared source. The user's
call: **greybox first, then key frames from it.** The `boards` stage therefore
becomes the **shot plan** — shots registered, beats with `detail`, camera,
continuity decision, trim — with no paid image; `board.png` is no longer
produced (the field stays readable for old projects and is not attached to
takes). The `previz` stage renders the greybox and then the **key frames**
(`previz.mjs anchor`, ids `first` and `key`) from the greybox frame as
composition plus the bible as appearance; those are the storyboard the
creator reviews in the lineup (key frame | greybox frame) and the `@Image`
references the take receives. Reference order becomes `@Video1` greybox →
`@Image1` anchor first → other anchors → sheets → concept → hand-off.
The design-first principle is unchanged: the design is the plan's text; the
pictures are derived from the plan through the greybox, not drawn beside it.
Boards-stage cost drops to zero; anchor cost stays in previz.

### Conditioning is decided per shot (added 2026-09-21 night, user)

Round 3 proved the cost of "greybox everywhere": eight consistent shots and
no 亮点 — locked cameras, still pawns, the fight elided. The greybox is a
tool, not the film. Each shot in the plan declares its `conditioning`:

- `greybox` — space, geography or a camera move the model cannot do alone
  (the establishing orbit, the crane, the dolly zoom, the geometric "one
  inch"). `@Video1` attached; the prompt inherits layout and camera from it.
- `free` — the fight beats and the charm beats. No `@Video1`; references are
  the character sheets and the style frame; the prompt is written for
  spectacle (the exchange as verbs, the camera as a move that follows the
  action, slow motion at the peak). A greybox may still exist for the reel
  and for continuity of positions, but it is not sent.
- `hybrid` — `@Video1` attached for positions and the camera path, with the
  prompt explicitly allowing dynamic body action and camera acceleration
  inside that layout.

`previz.mjs meta --conditioning greybox|free|hybrid` records it (default
`greybox` for old projects); `planReferences` omits `@Video1` for `free`;
`prompt-skeleton` emits the matching opening sentence and camera block; the
greybox checks are not required for a `free` shot (the gate for `generate`
on a `free` shot is the previz stage approval only); the viewer marks the
conditioning on the shot card and the cut's segment strip. The shot-plan
reference gains the decision rule: one hard thing per shot still holds, but
"hard thing" means the model's job — a fight exchange in one locked medium
shot is one hard thing; four static inserts of a sword at a throat is no
scene at all.

### Continuity across shots (added 2026-09-21 after the first acceptance run)

The first run proved the flow and exposed the gap: every take was generated
alone, so the body action a model invents in shot N ends in a pose shot N+1
never sees. Fights need the cut to be *one* motion seen from two cameras.
Two mechanisms, both in the mode:

**Hand-off is opt-in, and serves the expression** (user, 2026-09-21: some
cuts exist to break continuity — an ellipsis, a jump cut, a montage; the
contract must never be a blanket requirement). A shot without a
`continuity` block is generated exactly as before. The skill says when to
declare one (one continuous action seen from a new camera; a match cut) and
when not to (a time jump, a change of place, a rhythmic montage, a
deliberate mismatch), and the agent decides per cut in the shot plan.

**Prompt pack v2 — aligned with Seedance's own guidance** (fal.ai guide and
the community guides, read 2026-09-21): lead with subject and motion, one
primary camera move per clip with its end state (our collage design already
gives every shot exactly one move), **assign a job to every reference**
(`@Video1 = layout, positions, timing and the camera move only — its grey
shapes are placeholders, not the look; @Image2 = the keeper's appearance
only, hold it; @Audio1 = the keeper's voice`) because an unassigned
reference bleeds its lighting and framing, quote dialogue, name the sounds
and say `no music` when the cut will lay music, write motion as verbs with
physical consequences, prefer affirmative phrasing, and above ~8 s use a
**time-coded timeline** (`Seconds 0.0–0.5: …`) whose ranges are the shot's
beats — the greybox clock — rather than a paragraph. Front-load the
non-negotiables; adherence decays with position. `previz.mjs
prompt-skeleton <shot-dir>` emits this skeleton mechanically (reference
assignments with the indices `generate` will attach, one timeline line per
beat with its seconds, the entry line when a hand-off exists, spoken lines
quoted, `no music` by default) for the agent to fill; `generate` refuses a
pack that leaves an attached reference unassigned.

**Design first, carried forward** (user, 2026-09-21: "先想好怎么设计分镜和画面，才做白模；进 Seedance 时把原始设计画面的详细描述 + 白模无法表达的细节 + 设定一并给进去"). The prompt is not written fresh at the takes stage. At the boards stage every beat gets a `detail` — the designed picture for those seconds: body action, expression, wardrobe and material notes, physical consequence, tempo — written before the greybox; the greybox is built from that plan; `prompt-skeleton` emits `Seconds a–b: <detail>` from the beats, and the agent adds only what is still missing (reference assignments, look, camera end state, entry/exit). `Beat.detail?: string` is part of the `boards` stage hash.

**Anchor frames and the joint review** (user, 2026-09-21: Seedance leans
hard on anchor shots and reference images; use GPT-Image 2.5's camera
language to make the picture first, then review 设定 / 锚点图 / 白模 /
剧本与分镜 together before any video is bought). Once a shot's greybox is
accepted, `previz.mjs anchor <shot-dir> [--at s] [--id first]` renders an
**anchor frame**: GPT-Image 2.5 image-to-image with the greybox frame at
`at` as the composition reference plus the board, the character sheets and
the set concept as appearance references, prompted from the shot's design
(beat details at that second, look). It is stored as `anchors/<id>.png` with
a record `anchors: [{ id, at, file, revision, prompt, refs, cost }]` on
`shot.json`; several anchors per shot are allowed (`first` by default; a
`last` anchor gives the next shot a look-continuous hand-off picture). The
anchor is the composition and look truth for the take: `generate` attaches
it as `@Image1` (role `anchor:first`), the board after it (role `board`),
then sheets, concept, hand-off; the skeleton assigns their jobs
accordingly. `previz.mjs lineup <shot-dir>` writes `lineup.png` — board |
anchor | greybox frame side by side — and the viewer's previz stage shows
the same **lineup** per shot with the beat details and the continuity
decision: that lineup is what the creator approves at the previz gate, and
it is the joint review the user asked for. Anchors belong to the `previz`
stage (its hash includes them; the `generate` gate is unchanged); their
cost is recorded like a board's. Gate for `anchor`: `bible` approved and a
final greybox present.

**Hand-off.** `shot.json` gains

```jsonc
"continuity": {
  "from": "s03-orbit" | null,          // the shot whose last used frame this shot continues
  "entry": "challenger mid-lunge, blade extended at chest height, 1.2 m from the keeper, facing screen right",
  "exit":  "blades in contact, keeper's blade turning the thrust aside, both weight forward"
} | null
```

set by `previz.mjs meta <shot-dir> --continues-from <shot> --entry "…" --exit "…"`
(`--no-continuity` clears). `from` must be an earlier shot in `backlot.json.shots`.
Rules enforced by `previz.mjs generate` when `continuity.from` is set:

1. the previous shot must have a **selected** take, else refuse (`--no-handoff`
   overrides and records it on the take) — contiguous shots are shot in order;
2. the script extracts the previous take's frame at that shot's trim `out`
   (or its end) into `takes/handoff-in.png` and attaches it as the LAST image
   reference, reported in `refs` as `{ kind: "image", index: n, role: "handoff" }`;
3. the prompt pack must mention that index and the word/phrase the skill
   prescribes for it; the pack's first sentence describes the entry state;
4. the take checks gain `take-handoff` ("First frame continues the previous
   shot's last frame — positions, facing, weapons, action"), and
   `previz.mjs compare <shot-dir> --handoff` writes `takes/qa/<take>/handoff.png`:
   previous out-frame | this in-frame side by side, for the agent to look at.

The beats also gain the entry: `hashStage("boards")` includes `continuity`, so
changing a hand-off re-opens the shot list.

**Tempo.** The greybox is the clock the model follows, so tempo lives in the
greybox: the kit gains `slowmo(start, end, factor)` — a scene-wide time
remap baked at `finish()` (all object, camera and accent keys pass through
one piecewise-linear time curve; the shot's `seconds` stays the shot's
seconds, the *action* stretches) — and `impact(cam, at, push=0.15,
shake=0.02, seconds=0.25)` for the hit. `scene.meta.json` records
`time_warp: [{from, to, factor}]` so the viewer can draw a tempo row on the
beats timeline. The skill's camera reference gains a "tension" section: the
hold before the strike, the low angle at contact, the speed ramp into the
hit, the whip, and how each is written in the prompt ("slow motion, dust
hanging") so the model reads the greybox's slow seconds as slow motion
rather than as slow actors.

**Viewer.** The cut view draws, at each segment boundary, the out-frame and
in-frame pair with the `take-handoff` status; the beats timeline gains a
`tempo` row from `time_warp`.

### Landmarks the model can read (added 2026-09-22, after the urban trial)

Seven takes of one street disagreed about which side the shop was on while
the greybox had it in the same place every time. A grey block is a shape,
not a place: conditioned on grey lumps the model decides which lump is the
shop once per take, and the pack had no line that could settle it. Three
mechanisms, one sidecar:

- `previz_kit.landmark(name, objects, label=None, color=None)` paints every
  object of a named place one saturated colour from an eight-entry palette
  (`red blue yellow green magenta cyan orange purple`; the ninth landmark,
  a reused colour, a duplicate name or an object already in another
  landmark is refused). `finish()` writes to `scene.meta.json`:
  `landmarks: [{name, label, color, rgb, objects, in_frame: {first, last}}]`
  (does the place's centre project inside the camera view on frame 1 / the
  last frame) and `subjects_detail: [{name, color, rgb, behind: {first,
  last} | null}]` — per pawn, the landmarks farther from the camera than
  the pawn within 25° of the camera's line to it, nearest first, on the
  ground plane; a prop subject carries `behind: null`. The Workbench MP4
  carries the colours; the glTF does not (Blender's exporter writes every
  node-less material at the default grey, pinned by a kit test), so the
  viewer's 3D lane replays them from the sidecar exactly as it replays
  accents.
- `prompt-skeleton` writes, from that sidecar and nothing else: one
  `@Video1 中的<颜色>体块 = <label>` line per landmark under the `@Video1`
  assignment; the pawn's own colour into its character line (the former
  `<TODO: 它的颜色>`); and a `地理：` sentence in 【全局设定】 after 场景 —
  who stands in front of what at the first frame (and, when it differs, at
  the last), and which places are not in the picture. A rendered greybox
  with no landmarks is warned about; a landmark with a colour outside the
  palette is warned about because the pack can only call it `<TODO: 颜色>`.
  Free shots are unchanged: their geography is words in the beat details.
- The film's one style key frame must be location-neutral: it rides on
  every take, so a place inside it is painted into shots that place is not
  in (the urban trial's frame was a girl under the shop awning, and the
  awning came back in takes where the shop was behind the camera).
  `backlot.mjs style --keyframe` warns when the file is a set's concept
  frame (path inside `bible/sets/<id>/`, bytes equal to a registered
  concept, or `--prompt` naming a set); it never refuses.

### Domain type (domain.ts)

```ts
type StageId = "idea"|"script"|"bible"|"boards"|"previz"|"takes"|"sound"|"cut";
type StageStatus = "empty"|"draft"|"approved"|"changed";
interface StageState { id: StageId; status: StageStatus; approvedAt: number|null; usd: number }
interface Scene { id: string; number: number; heading: string; summary: string; shots: string[] }
interface Character { id; name; description; look; sheet: MediaRecord|null; voice: VoiceRecord|null; dir }
interface SetPiece { id; name; description; look; concept: MediaRecord|null; dir }
interface MediaRecord { file: string; revision: number; cost: Cost|null }
interface Line { id; speaker; kind: "spoken"|"vo"; text; at: number|null; file: string|null; seconds: number|null; cost: Cost|null }
interface Shot extends PrevizShot { scene: string|null; characters: string[]; set: string|null; board: BoardRecord|null; lines: Line[] }
interface CostLine { stage: StageId; kind: "image"|"tts"|"music"|"take"; label: string; usd: number; basis: string; at: number|null; ref: string }
interface Project { dir; title; logline; defaults; gates: "open"|"closed"; stages: StageState[]; scenes; characters; sets; shots; sound: SoundState; cut: CutState|null; cost: CostLine[]; warnings }
interface Film { projects: Record<string, Project> }
```

### ViewerAddress

`{ contentSet?, stage?, shot?, scene?, character?, set?, lane?, take?, time?, range?, layout?, line?, segment? }` — `stage` defaults to `previz` when absent so every existing previz address keeps working.

## Open questions / deferred

- Seedance audio pricing with a `@Audio` reference and with audio output
  on — read from the fal page before the price table is extended.
- Two pawns in one greybox and spoken-line rendering are untested; the seed
  run is the first test. If spoken lines fail QA twice, the seed ships with
  the line as voice-over and the finding is recorded.
- A hosted story reel (MP4 share) later; 720p finals later; a second video
  model later.
