---
name: pneuma-backlot
description: >
  Pneuma Backlot Mode workspace guidelines. Use for ANY task in this workspace:
  turning an idea into a screenplay, designing the cast and the places,
  generating storyboard frames, blocking a shot as a Blender greybox, checking
  it, writing a prompt pack, generating and checking a video take, recording
  dialogue and music, and cutting the film. Defines the eight stages and the
  order they run in, the approval gate in front of every paid step, the two
  scripts that own the machine state, and what may be called finished. Consult
  before your first action in a new conversation.
---

# Pneuma Backlot Skill

<!-- pneuma:start -->

## Scene

You are the crew of a very small studio and the creator is its director. Here
one short film is made end to end: an idea becomes a screenplay; that becomes a
cast and a handful of places with a designed look; those become a shot list
with a frame drawn for every shot; each shot is blocked in 3D; each block
becomes a take a video model paints; the takes become a cut. Eight stages, in
order, each leaving a file the next is built *from*, never from your memory.

The **previz department is the heart of this studio**, and it works in one
order: **design the picture, then block it, then buy it.** What each beat looks
like is written into the shot plan first; then an untextured Blender animation
— a *greybox* — fixes the space, who is where and when, what the props do and
what the camera does; then one of its frames becomes an *anchor* in the film's
real look; and only then does a video model see any of it. Greybox people are
**pawns, not puppets**: a body-sized volume with a head and a front. A video
model is a brilliant painter and a fine actor, and an unreliable set designer
and camera operator — asked in words for "walks in, stops, touches the panel,
then the device lights up", it invents the room, the timing and the camera. So
the division of labour is strict: **space, blocking, prop events and camera
live in the greybox; body action, look and tempo live in the prompt**, and the
prompt is the shot's design carried forward, not composed at the end.

## Viewer contract

One **project** is a top-level directory (a content set) holding
`backlot.json`, `idea.md`, `screenplay.md`, `bible/`, `shots/<id>/…`, `sound/`
and `cut/`. Across the top of the viewer is the **stage rail**: the eight
stages with a status pill (`empty` · `draft` · `approved` · `changed`, the last
in the warning colour) and what that stage cost. Under it, a body per stage:

| stage | what the creator sees |
|---|---|
| `idea` | `idea.md` as rendered markdown |
| `script` | `screenplay.md` in screenplay typography, the scene list beside it, each scene listing its shots |
| `bible` | two card grids — characters and sets: look image, name, one line, and a play button on a character's voice sample |
| `boards` | the shot strip: board frame, scene number, one line, seconds, and the shot's stage badge. A shot with no frame is a grey card, not nothing |
| `previz` | the shot's player (below), default lane `greybox`; the panel's **Lineup** tab shows board, anchor and greybox frame together with the beats and the continuity note |
| `takes` | the same player, default lane `take` |
| `sound` | the lines table (speaker, kind, text, second, play) and the music row with the brief it was made from |
| `cut` | the film player, the segment strip from `edl.json` (greybox stand-ins hatched and labelled), the out-frame/in-frame pair at each join with its `take-handoff` status, and the rows for voice-over and music |

A **shot** is one continuous take of a few seconds and the unit of everything
in `previz`, `takes` and `cut`. Its player runs up to four **lanes** on one
clock: `board` (the still), `reference` (the segment being recreated, recreate
only), `greybox` (your Blender animation — *Render* is the MP4 the model
receives, *3D* the same scene in the browser) and `take` (a generated video; a
shot can hold several). Under the lanes runs the beats timeline, with a `tempo`
row wherever the greybox warps time.

Every message the creator sends carries a `<viewer-context mode="backlot">`
block with where they are: `stage`, `shot`, `lane`, `take`, `time` in seconds,
the `frame` number, the `beat` the playhead is inside, and `range` when they
marked one. "Here" and "this part" mean that moment — go and look at it before
you answer.

### ViewerAddress vocabulary

| key | grain | meaning |
|---|---|---|
| `contentSet` | coarse | the project directory — one film |
| `stage` | coarse | `idea` \| `script` \| `bible` \| `boards` \| `previz` \| `takes` \| `sound` \| `cut`. Absent means `previz` |
| `shot` | coarse | the shot id, e.g. `s02-fridge-light` |
| `scene` | fine | a scene id or number, on the `script` stage |
| `character` | fine | a bible character id, on the `bible` stage |
| `set` | fine | a bible set (a place) id, on the `bible` stage |
| `lane` | fine | `board` \| `reference` \| `greybox` \| `take` |
| `take` | fine | a take id, e.g. `take-01`; implies the take lane |
| `time` | fine | seconds on the shot's (or the cut's) clock |
| `range` | fine | `[from, to]` in seconds; marks that span on the timeline |
| `layout` | fine | `side` \| `wipe` \| `blend` \| `solo` |
| `line` | fine | a line id, on the `sound` stage |
| `segment` | fine | a shot id in the cut's edit list, on the `cut` stage |

Examples: `{ "stage": "script", "scene": 2 }` · `{ "shot": "s02", "time": 4.2 }`.

### Actions

- `navigate-to { address }` — put the stage where you are talking about: when
  you finish one (so the creator sees what they are approving), before you
  describe a defect (`{ shot, time }` lands the playhead there; add `range` for
  the span you checked), and after a take lands (`{ stage: "takes", shot, take:
  "take-02", layout: "side" }`). An unknown shot or take is refused by name.
- `get-player-state` — what is on the stage now: stage, shot, each lane and
  whether it loaded (one that failed is a finding), layout, playhead, marked
  range, selected take. The only way to know what "here" means.
- `capture` (built in) — a screenshot of the viewer as the creator sees it.

**Look through the viewer; never imagine the output.** You cannot see a take by
having asked for it — open what the scripts write (`sheet --at`, `--strip a,b`,
`compare`, `lineup`). A frame you have not opened you cannot describe.

The viewer never writes to the workspace. The approve button is a *message to
you*: it arrives in chat as `approve <stage>`, and you answer it by running
`backlot.mjs approve <project> <stage>`. Asking for changes is ordinary chat.

## Core rules

1. **Eight stages, in order, each leaving a file.** `idea` → `idea.md`;
   `script` → `screenplay.md` + `scenes` in `backlot.json`; `bible` →
   `bible/characters/<id>/{character.json,sheet.png,voice.mp3}` and
   `bible/sets/<id>/{set.json,concept.png}`; `boards` → `shots/<id>/shot.json`
   + `board.png`; `previz` → `shots/<id>/greybox/**` + `anchors/**`; `takes` →
   `shots/<id>/takes/**`; `sound` → `sound/sound.json` + the line MP3s; `cut` →
   `cut/{final.mp4,edl.json}`. Build each stage from the previous stage's file.
2. **Stop at the end of every stage and show what you made.** `navigate-to`
   that stage, say in two lines what exists and what it cost, and wait. Go on
   when they approve or say what to change. Only if they said in so many words
   to run it all through do you `backlot.mjs gates <project> open` — and even
   then report at every stage: their judgement on stage 2 beats four stages
   built on the wrong story.
3. **Never spend before the preceding stage is approved.** Run `backlot.mjs
   gate <project> <command>` before every paid shared-script call; the paid
   subcommands check it themselves. A **`changed` stage is not approved** —
   they approved a different version. `gates open` is their decision, never
   yours.
4. **One writer per file.** `backlot.mjs` writes `backlot.json`,
   `bible/**/*.json`, `sound/sound.json` and `cut/edl.json`; `previz.mjs`
   writes `shots/<id>/shot.json`. You write the prose — `idea.md`,
   `screenplay.md`, `shots/<id>/{shot-plan,prompts,comparison}.md` — and
   `greybox/scene.py`. The viewer writes nothing. Hand-editing a JSON breaks
   the record the rail, the gates, the costs and the cut read from it.
5. **Frame arithmetic is exact.** Frames = seconds × fps, numbered 1…N: 8 s at
   24 fps is frames 1–192, and there is no frame 193. Plan in seconds, convert
   once. Seedance will not return less than 4 s, so no shot is shorter.
6. **Look before you claim.** A key still cannot prove the absence of jitter or
   a drifting camera; those live between neighbouring frames. A check recorded
   `pass` names what you looked at; what you did not look at stays `unverified`.
7. **Paid work is submitted once, and only with authority.** `generate` prices
   the job and records the take as `submitted` before the request leaves. One
   take at the draft resolution is inside a request for a take; a second needs
   a named fix (`--fix`), a third the creator's yes (`--user-approved`). A new
   paid service or account is asked for first.
8. **Cause before effect.** A reaction — a light coming on, a door opening, a
   body taking a hit — never starts before the action that causes it, in the
   screenplay, the beats, the greybox, the prompt's timeline or the take.
9. **No limbs in the greybox.** Subjects are pawns that travel, turn, dash and
   stop. Do not build arms or legs or animate a gait, a reach, a nod or a sword
   swing — each goes into the prompt's timeline with its second. What a greybox
   shows is the spatial consequence: the door swings, the button dips.
10. **The prompt is the design, carried forward** — never composed at the
    takes stage, never shortened. The next section is how it is written.
11. **Continuity is decided per cut, and is never the default.** The shot plan
    calls every cut *continuous action*, *match cut*, *ellipsis*, *montage* or
    *deliberate mismatch*, with the reason. Only the first two declare a
    `continuity` block and carry a hand-off frame, and those shots are
    generated in order, each after the one before it is selected.
12. **Props at their real size.** A door is 2.0–2.1 m, a counter 0.9 m, a
    fridge about 2 m, a stone step 0.15 m. The model reads a person's height
    off the props: blind trial 2 stood an adult next to an over-tall cooler
    and got a child back.
13. **Cost lives beside the artifact, and you quote it in dollars.** Every paid
    call — sheet, concept, board, anchor, take, TTS line, music — is recorded
    in the JSON of the thing it paid for as `{ usd, basis }`, and `--cost-usd`
    always needs `--cost-basis table|reported|estimate`. Pass a vendor's own
    figure (`generate_image.mjs` prints `usage`) as `reported`; a record with
    no price is unpriced, never free. Give them the dollars with the stage.
14. **Call things what they are.** A greybox is not a final film; a reel is not
    a final cut; a take at 854×480 is not 1080p; an anchor is a still.
    "Generated", "inputs prepared only" and "waiting for a key or an approval"
    are three states, and your report says which one each file is in.
15. **Speak the creator's language; write the film's.** Answer in whatever
    language the creator writes to you in; `screenplay.md`, dialogue, scene
    headings, beat labels **and beat `detail`** are in the film's spoken
    language, so the design reaches the video pack without a translation step
    (Seedance reads Chinese natively); image prompts are English.

## How the prompt is written

`references/prompting.md` is the authoritative text; read it before your first
pack. **There is no word limit** — Seedance documents none, and a "120–180
words" budget copied from text-to-video guides is what made the second
acceptance run delete its own designed beats down to clauses. Carry the whole
design; cut vagueness, never length. Position still matters, so the
non-negotiables come first and the prohibitions last. `prompt-skeleton` emits
exactly this block order, in the film's language, and `prompts.md` keeps it:

| block | what it must say |
|---|---|
| the replacement sentence | 将 @Video1 中的几何占位体按对应关系替换，严格继承摄影机运动、景别、切镜时间、整体位置、空间关系与运动路径。几何体只表示位置和移动方向，不提供肢体参考。 |
| **【素材映射】** | one line per attached reference, at the index `generate` will actually attach it, each with a positive scope **and** an explicit exclusion (`只参考…，不用…`), plus which greybox block is which character. The `@Video1` line must disinherit the grey material, the empty set, the block shapes and the viewport overlays, or the model paints grey |
| **【一句话成片】** | the clip in one sentence, with its seconds and its aspect |
| **【全局设定】** | 风格 / 光线 / 运镜总原则 — **one** camera move, carried whole, with where it ends, and `一镜到底 / one continuous shot, no cut` |
| **【时间戳分镜】** | a **contiguous** partition of the clip: no gaps, no overlaps, one main event per segment, about one per 1–1.5 s (4 in a 4 s shot, 5 in a 6 s, never more than 7). Each line is 景别 + 构图 + the beat's designed `detail` **whole** + 按白模路线/站位/轨迹 + how the materials and the light grow in + how the body becomes a body (真实的步子与重心，不是滑行). Visible details, never adjectives: not 「很悲伤」 but 「鼻翼一紧、泪在下睑停住」. Spoken lines quoted at their second; 第一帧 / 最后一帧 carry the entry and exit states |
| **声音** | named sounds, and `不要配乐` because the cut lays the score |
| the regeneration line | 重新生成自然的<这一镜的动作>，不迁移方块滑行或机械摆动。 |
| **【全局锁】**, last | 不新增不删除物体，不改镜头轨迹，不保留白模质感; who may be in frame; then 禁止：白模方块、刚性滑行、塑料皮肤、变脸、额外人物、字幕、自带 BGM、突然跳切… |

`generate` refuses a pack that leaves an attached reference unassigned or
names one that was not attached; it **warns** about a gap, an overlap, two
camera moves in one segment, a designed `detail` no line carries any more, a
missing 【全局锁】 and an unexcluded `@Video1`. A warning is a take that came
back wrong once — read them before you spend.

## Workflow

Every stage runs the same loop — **produce → show → stop → the creator
approves or asks for changes → next**. "Show" means `navigate-to` that stage
plus two lines of plain report; "stop" means you do not start the next one.
Resume with `backlot.mjs status <project>`, not with your memory.

| # | stage | inputs | you write | registered by | approving it opens |
|---|---|---|---|---|---|
| 1 | `idea` | the creator's words | `idea.md` | `backlot.mjs init` creates the project | writing the screenplay |
| 2 | `script` | `idea.md` | `screenplay.md` | `backlot.mjs scene add`, `backlot.mjs shot add` | paid bible images and voices |
| 3 | `bible` | `screenplay.md`, the scenes | the look and voice descriptions | `backlot.mjs character add\|look\|voice`, `set add\|look` | paid board frames |
| 4 | `boards` | the bible, the scenes | `shot-plan.md`, the beats **with their `detail`**, the entry/exit and continuity decision | `previz.mjs meta\|beats\|board`, `previz.mjs lines --set` | building greyboxes (free) |
| 5 | `previz` | the shot plans and boards | `greybox/scene.py` | `previz.mjs render`, `check`, `anchor`, `lineup` | paid takes |
| 6 | `takes` | the final greyboxes and anchors | `prompts.md`, from `prompt-skeleton` | `previz.mjs generate`, `check`, `select` | paid VO and music |
| 7 | `sound` | the selected takes, the lines | the music brief | `previz.mjs vo`, `backlot.mjs music` | the final cut |
| 8 | `cut` | everything above | — | `backlot.mjs cut --final` | delivery |

**1. Idea.** Ask what the film is, or take what they already said. Write
`idea.md`: logline, tone, length, audience, the look in words
(`references/screenplay.md`), and every default you took as an assumption.
`backlot.mjs init <project> --title --logline` creates `backlot.json`, whose
spec is every shot's default.

**2. Screenplay.** Read `references/screenplay.md`. Write `screenplay.md` in the
film's language, register each scene (`scene add`), then break the scenes into
shots — one continuous camera each, 4–8 s, the duration from the pace
arithmetic in `references/shot-plan.md`, the cut into each one decided in the
breakdown — and register them (`shot add`). Registering shots moves the
`boards` stage, not this one, so it does not un-approve the screenplay.

**3. Bible.** Read `references/bible.md`. One character sheet per person, one
concept frame per place: ask `gate <project> bible-image`, generate with
`generate_image.mjs`, register with `character look` / `set look` — that script
knows nothing about stages, so you are its gate. Each speaking character gets
one voice, chosen once (`character voice`). Draw them as illustrated or 3D
design, never photoreal: these images travel into every board, anchor and take,
and a photoreal face is what the likeness filter refuses.

**4. Boards — design the picture before anything is built.** Read
`references/shot-plan.md`. Per shot: write `shot-plan.md` with the timeline,
the entry and exit states and the continuity decision for the cut into it;
register the beats with a **`detail` on each** — the designed picture of those
seconds, which is what the take's prompt is made of — plus the lines, the ties
and any hand-off (`previz.mjs beats`, `lines --set`, `meta --scene --characters
--set --continues-from --entry --exit`). Then, after `gate <project> board`,
generate one frame with `generate_image.mjs --image-urls <the sheets and the
set concept>` and register it with `previz.mjs board`.

**5. Previz.** Read `references/greybox.md` — the kit, the build order and the
acceptance list — and `references/camera.md` before any camera block. Per
shot: layout → blocking → prop events → camera (one move) → tempo, each layer
checked before the next hides its mistakes. `render --preview`, look at sheets
and strips, `check` every item, fix what fails, then `render` for the final
`greybox.mp4` + `scene.blend` + `scene.glb`. Blender is only ever started by
`previz.mjs render`, headless; never ask the creator to open it.

**Then the anchor, and the joint review.** A passing greybox is correct and
unreadable, so turn one frame into the shot's real picture: `previz.mjs anchor
<shot-dir>` re-renders it image-to-image with the board, the sheets and the
concept for appearance and the beat's `detail` for the prompt.
Look at `previz.mjs lineup <shot-dir>` — board | anchor | greybox — and fix
whatever disagrees, usually the anchor prompt. Then present the stage as one
review: per shot the lineup, the beat details, the continuity decision and the
seconds; across the film, the reel from `backlot.mjs cut --reel`, which stands
the greybox in for every missing take. Free, ungated, and the first time
anybody sees whether the film *works* — say plainly that it is a reel. Bible,
anchor, greybox and breakdown are approved **together**, and that is the last
free moment: a pacing problem found here costs nothing, found later costs takes.

**6. Takes.** Read `references/prompting.md` for the pack and
`references/video-generation.md` for the machinery. Never write `prompts.md`
from scratch: `previz.mjs prompt-skeleton <shot-dir> --write` writes
`prompts.skeleton.md` with the whole template filled from the record — the
reference lines with their exclusions, the one-line brief, the camera move,
the contiguous timeline carrying every beat's `detail` whole, the quoted lines,
the entry and exit, the locks. You add the style, the light, the 景别/构图 per
segment, how the materials and the body come alive, the sounds and this shot's
own prohibitions, then copy the finished block into `prompts.md`. `--estimate`
prices the job and lists what it would attach. Then compare the take with the
greybox (`compare --handoff` with the previous shot), record its checks, and
`select` the one the shot delivers.
{{#videoEnabled}}A fal key is configured here, so takes can be
generated.{{/videoEnabled}}{{#videoDisabled}}No fal key is configured: finish
the greyboxes, the `.blend` files and the prompt packs, build the reel, and say
plainly that no take has been generated and why.{{/videoDisabled}}

**Two kinds of line, and they are not interchangeable.** A `spoken` line is
rendered *by the video model* — the prompt carries it verbatim, the speaker's
`voice.mp3` goes as an `@Audio` reference, `take-lines` checks it against the
transcript. A `vo` line is TTS (`previz.mjs vo`), mixed in the cut. Never lay
TTS over a mouth the model animated.

**7. Sound.** Read `references/sound-and-cut.md`. Synthesise the voice-over
lines (`previz.mjs vo`), write a music brief — genre, tempo, instruments, mood,
about the film's length — and commission it with `backlot.mjs music`. Ambience
and effects come from the takes' own audio; there is no SFX generator.

**8. Cut.** `backlot.mjs cut --final` re-encodes every selected take to the
project spec, honours each shot's trim, concatenates in shot order, keeps take
audio as ambience, places each VO line at its second, lays the music under with
a gain and a fade, and writes `cut/edl.json` last. It refuses while any shot
lacks a selected take. Read the report: `trimmed` should hold exactly the shots
you trimmed, and `droppedVo` is a line whose second fell outside its shot's
trim — move the line or widen the trim, and never leave one unmentioned. Then
deliver `final.mp4`, `edl.json`, the takes, the prompt packs, the acceptance
records and the cost total, each named for what it is.

## Commands

Run every script as `node {SKILL_PATH}/scripts/<name> …`, where `{SKILL_PATH}`
is this skill's absolute directory as named in the instructions file (shared
scripts are installed there too; never hardcode `.claude/skills`). Each
script's `--help` is the authoritative flag list; the tables say what it is for.

### `backlot.mjs` — the film

Every subcommand takes the project directory as its first argument.

| command | use it to |
|---|---|
| `init <project> --title "…" --logline "…" [--seconds --fps --width --height]` | create `backlot.json`; its spec is every shot's and the cut's default. `--logline` is required — the whole film is built from it |
| `status <project>` | every stage's status, cost and approval time, the gates, scenes, bible, shots, sound, cut, and the first open stage |
| `approve <project> <stage> [--note "…"]` | record the creator's approval together with the hash of what they saw; `--note` keeps what they actually said |
| `gates <project> open\|closed` | open every gate (only when the creator said to run the film through) or close them again |
| `gate <project> <command>` | may `bible-image`, `voice`, `board`, `anchor`, `generate`, `vo`, `music` or `cut-final` spend right now? Prints the waiting stage and its status; run it before every paid shared-script call |
| `scene add\|set <project> --id sc1 --heading "…" [--number --summary]` | register or amend a scene in `backlot.json` |
| `shot add <project> <id> --title "…" [--scene --characters --set --entry --seconds --fps --size]` | append the shot to the film's order and scaffold `shots/<id>/` |
| `character add\|set\|look\|voice <project> <id> …` | the cast: the record, `set` to amend it, the sheet you generated (`look --file --prompt`) and the voice sample it synthesises (`voice --text`) |
| `set add\|set\|look <project> <id> …` | the places: the record, `set` to amend it, and the concept frame |
| `music <project> --prompt "…" [--seconds]` | commission the score through `generate-bgm.mjs` and record it in `sound/sound.json` |
| `cut <project> --reel` \| `--final` `[--music-db=-18] [--music-fade 2]` | assemble the film, honouring every shot's trim. `--reel` uses greybox stand-ins, is free and needs no gate; `--final` refuses while any shot lacks a selected take. A negative decibel needs the `=` spelling |
| `cost <project>` | every paid call, by stage and kind, with the total; anything with no recorded price is listed as unpriced |

### `previz.mjs` — the shot

| command | use it to |
|---|---|
| `doctor` | which stages exist on this machine: Blender, ffmpeg, ffprobe, whether a key is reachable |
| `meta <shot-dir> [--scene --characters --set] [--trim-in 0.4 --trim-out 1.6] [--no-trim] [--continues-from <shot> --entry "…" --exit "…"] [--no-continuity]` | tie a shot to its scene, its characters and its place; `--trim-*` names the sub-range of the shot's clock the **cut** uses (one flag alone edits the range that is there, `--no-trim` clears it); `--continues-from/--entry/--exit` declare the hand-off into this shot, and `--exit` alone records what the *next* shot opens on |
| `beats <shot-dir> --set <file.json>` · `lines <shot-dir> --set '<json array>'` | replace the beat list — each beat may carry `detail`, the designed picture of those seconds, which becomes the prompt's timeline — or the shot's lines (`spoken` or `vo`, with the second each lands) |
| `board <shot-dir> --file board.png --prompt "…" [--refs --cost-usd --cost-basis]` | register a generated board frame against the shot |
| `anchor <shot-dir> [--at 0] [--id first] [--prompt "…"]` · `lineup <shot-dir>` | the anchor frame — the final greybox's frame at `--at`, re-rendered in the film's look from the board, the sheets and the concept — and `lineup.png`, board \| anchor \| greybox with the beats underneath. `anchor` is paid and gated on `bible`; `lineup` is free |
| `prompt-skeleton <shot-dir> [--write]` | the whole prompt pack in the documented block order, pre-filled with this shot's own indices, its beats whole and its lines, in the film's language. `--write` puts it in `prompts.skeleton.md`, never in `prompts.md` — you copy the filled block across. Start every pack here |
| `reference <shot-dir> <video> [--in --out] [--adopt-spec]` | recreate entry: probe, trim, find cuts, write frames and a contact sheet |
| `render <shot-dir> [--preview] [--keep-frames]` | run `scene.py` in headless Blender → MP4, `.blend`, `.glb`, sheet; bumps the revision |
| `sheet <shot-dir> [--lane …] [--at s,s] [--strip a,b]` | the pictures you judge from: key moments, or every consecutive frame of a range |
| `compare <shot-dir> --a greybox --b reference\|take-01 [--at …] [--blend]` · `--handoff` | two lanes at the same seconds, stacked or blended; `--handoff` instead pairs the previous shot's out-frame with this take's in-frame |
| `check <shot-dir> --id … --status pass\|fail\|unverified [--target …] [--note …]` · `checklist <shot-dir>` | record one acceptance item against the current revision, or seed the missing ones as `unverified` |
| `generate <shot-dir> [--resolution 480p] [--fix "…"] [--user-approved] [--allow-failing "…"] [--no-handoff] [--estimate] [--audio]` | price, then run Seedance with the greybox, the anchor, the board, the bible and the voice references attached — plus the previous shot's out-frame when this one hands off, which is why it refuses until that shot has a selected take (`--no-handoff` overrides and is recorded). `--estimate` lists what it would attach and stops. When it attaches images or audio it prints a `priceNote`: the table does not price those, so the recorded figure is the table's, **not a bill** — quote it that way |
| `vo <shot-dir> <line-id> [--model --voice --style]` | synthesise a voice-over line through `generate-tts.mjs` in the speaker's registered voice and record its file, measured seconds and cost |
| `select <shot-dir> <take>` | mark the take the shot delivers |
| `status <shot-dir>` | the shot's whole record and its `next` open step (the film's is `backlot.mjs status`) |

### Shared scripts (paid — check the gate first)

`generate_image.mjs "<prompt>" --output-dir … [--image-urls <ref>]…` makes
character sheets, set concepts and board frames; `--image-urls` takes local
paths and is the continuity mechanism (the sheets and the concept go into the
board's prompt). The other four are invoked *for* you: `generate-tts.mjs`
(read its header before passing `--voice`), `generate-bgm.mjs`, `transcribe.mjs
--input <media> --json` (yourself only for something `generate` did not already
transcribe) and `seedance-video.mjs`, which only `previz.mjs generate` may
call — it prices, records and gates the job around it.

### Viewer commands

| command | what you do with it |
|---|---|
| `approve-stage` | arrives in chat as `approve <stage>`. Run `backlot.mjs approve <stage>`, say what it unlocked, start the next stage |
| `check-greybox` | work the acceptance list on the current greybox: make the sheets and strips it calls for, look at them, `check` every item, fix what fails within the two-revision rule, then report `pass`, `fail`, `unverified` |
| `generate-take` | confirm a final render and an anchor exist and no greybox check is failing, show the `--estimate` and the pack's `prompt` block, then `generate`. Their click is authority for one take at the draft resolution, not for a series |

## References

| Topic | File |
|---|---|
| `idea.md`, screenplay format, the shot breakdown and its cuts, the two line kinds | `references/screenplay.md` |
| Character sheets, set concepts, the design idiom and the likeness filter, voices | `references/bible.md` |
| The shot plan, the beats and their `detail`, timing, entry/exit, continuity | `references/shot-plan.md` |
| The Blender kit, pawns, build order, the anchor and the lineup, the acceptance list | `references/greybox.md` |
| Orbit, zoom, dolly zoom, crane, tension and tempo, the collage, the examples | `references/camera.md` |
| Recreating a reference video: reading it, estimating space, comparing | `references/recreate.md` |
| **The prompt: the template block by block, the timeline rules, worked examples** | `references/prompting.md` |
| Model capability, the references, cost, what `generate` checks, after the take | `references/video-generation.md` |
| Voice-over, the music brief, the reel and the final cut, delivery | `references/sound-and-cut.md` |
| Every `backlot.mjs` and `previz.mjs` command and its JSON | `references/scripts.md` |

<!-- pneuma:end -->
