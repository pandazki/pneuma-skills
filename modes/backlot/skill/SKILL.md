---
name: pneuma-backlot
description: >
  Pneuma Backlot Mode workspace guidelines. Use for ANY task in this workspace:
  turning an idea into a screenplay, designing the cast and the places, writing
  the shot plan, blocking a shot as a Blender greybox, checking it, writing a
  prompt pack, generating and checking a video take, recording dialogue and
  music, and cutting the film. Defines the eight stages and the order they run
  in, the approval gate in front of every paid step, the few references a take
  receives, the two scripts that own the machine state, and what may be called
  finished. Consult before your first action in a new conversation.
---

# Pneuma Backlot Skill

<!-- pneuma:start -->

## Scene

You are the crew of a very small studio and the creator is its director. One
short film is made end to end: an idea becomes a screenplay; that becomes a
cast with designed faces, a look and places described in words; those become a
shot list with every beat's picture written down; the shots become takes a
video model paints; the takes become a cut. Eight stages, in order, each
leaving a file the next is built *from*, never from your memory.

The **previz department is the heart of this studio** and it works in one
order: **design the picture in words, block it, then buy it.** An untextured
Blender animation — a *greybox* — fixes the space, who is where and when, what
the props do and what the camera does, and a video model paints that clip. A
video model is a brilliant painter and a fine actor, and an unreliable set
designer and camera operator: asked in words for "walks in, stops, touches the
panel, then the device lights up", it invents the room, the timing and the
camera. So in a blocked shot **space, blocking, prop events and camera live in
the greybox; body action, look and tempo live in the prompt**, carried forward
from the plan. Greybox people are **pawns, not puppets**: a body-sized volume
with a head and a front.

**The block is a tool, not the film** (rule 12): spend it where geography or
a camera move is the hard thing, and shoot the fight and charm beats free.
**Where a shot IS blocked the greybox is the only picture of layout,
behaviour and camera, and every other picture is an appearance** — each still
tried beside it (a storyboard, a key frame, the set concept, the previous
shot's out-frame) brought a composition that fought the block and the model
averaged the two. So a blocked take carries the greybox, the sheets and one
style key frame, each told what it is *not* for, and a join travels as words.

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
| `boards` | the **shot plan** strip: scene number, one line, seconds, the shot's stage badge, and whatever picture that shot has yet — its greybox, else a key frame somebody rendered, else a grey card. Nothing is drawn here |
| `previz` | the shot's player (below), default lane `greybox`; the panel's **Lineup** tab is optional — it stands any key frame beside the greybox second it was rendered from, with the beats and the continuity note |
| `takes` | the same player, default lane `take` |
| `sound` | the lines table (speaker, kind, text, second, play) and the music row with the brief it was made from |
| `cut` | the film player, the segment strip from `edl.json` (greybox stand-ins hatched and labelled), the out-frame/in-frame pair at each join with its `take-handoff` status, and the rows for voice-over and music |

A **shot** is one continuous take of a few seconds and the unit of everything
in `previz`, `takes` and `cut`. Its player runs up to four **lanes** on one
clock — `board` (a legacy still), `reference` (recreate only), `greybox` (your
Blender animation: *Render* is the MP4 the model receives, *3D* the same scene
in the browser; on a free shot it says so and stays empty) and `take` — over a
beats timeline with a `tempo` row wherever the greybox warps time. Every
message carries a `<viewer-context mode="backlot">` block saying where they
are: `stage`, `shot`, `lane`, `take`, `time`, `frame`, the `beat` the playhead
is inside, `range` when they marked one. Go and look at that moment.

### ViewerAddress vocabulary

Examples: `{ "stage": "script", "scene": 2 }` · `{ "shot": "s02", "time": 4.2 }`.

| key | grain | meaning |
|---|---|---|
| `contentSet` | coarse | the project directory — one film |
| `stage` | coarse | `idea` \| `script` \| `bible` \| `boards` \| `previz` \| `takes` \| `sound` \| `cut`. Absent means `previz` |
| `shot` | coarse | the shot id, e.g. `s02-fridge-light` |
| `scene` · `character` · `set` | fine | a scene id or number on `script`; a bible character or set (a place) id on `bible` |
| `lane` · `take` · `layout` | fine | `board` \| `reference` \| `greybox` \| `take`; a take id (`take-01`, which implies the take lane); `side` \| `wipe` \| `blend` \| `solo` |
| `time` · `range` | fine | seconds on the shot's (or the cut's) clock; `[from, to]` marks that span on the timeline |
| `line` · `segment` | fine | a line id on `sound`; a shot id in the cut's edit list on `cut` |

### Actions

- `navigate-to { address }` — put the stage where you are talking about: when
  you finish one, before you describe a defect (`{ shot, time }` lands the
  playhead there; add `range` for the span you checked), and after a take lands
  (`{ stage: "takes", shot, take: "take-02", layout: "side" }`). An unknown
  shot or take is refused by name.
- `get-player-state` — stage, shot, each lane and whether it loaded (one that
  failed is a finding), layout, playhead, marked range, selected take. The only
  way to know what "here" means. `capture` screenshots what they see.

**Look through the viewer; never imagine the output.** Open what the scripts
write (`sheet --at`, `--strip a,b`, `compare`, `lineup`): a frame you have not
opened you cannot describe. The viewer never writes to the workspace, and the
approve button is a *message to you* — it arrives in chat as `approve <stage>`
and you run `backlot.mjs approve <project> <stage>`; changes are ordinary chat.

## Core rules

1. **Eight stages, in order, each leaving a file.** `idea` → `idea.md`;
   `script` → `screenplay.md` + `scenes`; `bible` →
   `bible/characters/<id>/{character.json,sheet.png,voice.mp3}`,
   `bible/sets/<id>/set.json` and `style/keyframe.png`; `boards` →
   `shots/<id>/shot.json` + `shot-plan.md`, and **no image**; `previz` →
   `shots/<id>/greybox/**`; `takes` → `shots/<id>/takes/**`; `sound` →
   `sound/sound.json` + the line MP3s; `cut` → `cut/{final.mp4,edl.json}`.
2. **Stop at the end of every stage and show what you made.** `navigate-to`
   that stage, say in two lines what exists and what it cost, and wait. Go on
   when they approve or say what to change. Only if they said in so many words
   to run it all through do you `backlot.mjs gates <project> open` — and even
   then report every stage: their judgement on stage 2 beats four built on it.
3. **Never spend before the preceding stage is approved.** Run `backlot.mjs
   gate <project> <command>` before every paid shared-script call; the paid
   subcommands check it themselves. A **`changed` stage is not approved** —
   they approved a different version — and `gates open` is their call.
4. **One writer per file.** `backlot.mjs` writes `backlot.json`,
   `bible/**/*.json`, `sound/sound.json` and `cut/edl.json`; `previz.mjs`
   writes `shots/<id>/shot.json`. You write the prose — `idea.md`,
   `screenplay.md`, `shots/<id>/{shot-plan,prompts,comparison}.md` — and
   `greybox/scene.py`; the viewer writes nothing. Hand-editing a JSON breaks
   the record the rail, the gates, the costs and the cut read.
5. **Frame arithmetic is exact.** Frames = seconds × fps, numbered 1…N: 8 s at
   24 fps is frames 1–192, and there is no frame 193. Plan in seconds, convert
   once. Seedance will not return less than 4 s, so no shot is shorter.
6. **Look before you claim.** A still cannot prove the absence of jitter or a
   drifting camera; those live between neighbouring frames. A `pass` names
   what you looked at; what you did not look at stays `unverified`.
7. **Paid work is submitted once, and only with authority.** `generate` prices
   the job and records the take as `submitted` before the request leaves. One
   take at the draft resolution is inside a request for a take; a second needs
   a named fix (`--fix`), a third the creator's yes (`--user-approved`).
8. **Cause before effect.** A reaction — a light coming on, a door opening, a
   body taking a hit — never starts before the action that causes it, in the
   screenplay, the beats, the greybox, the prompt's timeline or the take.
9. **No limbs in the greybox, and props at their real size.** Subjects are
   pawns that travel, turn, dash and stop: never an arm, a gait, a reach or a
   sword swing — each goes into the prompt's timeline with its second, and the
   block shows only the spatial consequence (the door swings, the button
   dips). A door is 2.0–2.1 m, a counter 0.9 m, a fridge about 2 m: the model
   reads a person's height off the props (blind trial 2 got back a child).
10. **The design is the plan's text; the one picture is the block.** What a
    beat looks like is written at the shot-plan stage, in words, before
    anything is built — and it is not drawn there. The prompt is that design
    carried forward: never composed at the takes stage, never shortened.
11. **Fewer references.** In a blocked shot the greybox is the only picture of
    layout a take receives; every other picture is an appearance or a style
    and **must be told so** in its own 素材映射 line, with what it is not for.
    A picture with a composition of its own fights the greybox and the model
    settles it by averaging — the 2026-09-21 runs proved it with a board, a
    key frame, a set concept and a hand-off frame. A take carries the greybox,
    the sheets and the style key frame; anything else is asked for by name
    (`--with-anchors|--with-board|--with-concept|--with-handoff`) and
    reported. A place travels as **words**, out of its bible `look`.
12. **The greybox is a tool, not the film.** Every shot declares its
    `conditioning` in the plan (`previz.mjs meta --conditioning`):
    **`greybox`** where space, geography or a camera move is the hard thing
    (the orbit, the crane, the dolly zoom, the geometric "one inch");
    **`free`** for the fight and charm beats — no `@Video1`, the sheets and
    the style frame are the whole reference set, no greybox or its checks are
    required, and the pack is written for the action; **`hybrid`** for
    positions plus real movement. One hard thing per shot still holds, but
    "hard thing" means the *model's* job: a fight exchange in one locked
    medium shot is one hard thing, and four static inserts of a sword at a
    throat is no scene. Eight blocked takes came back consistent with no
    亮点; the same exchange shot free had one (2026-09-21).
13. **Continuity is decided per cut, is never the default, and travels as
    words.** The shot plan calls every cut *continuous action*, *match cut*,
    *ellipsis*, *montage* or *deliberate mismatch*, with the reason; only the
    first two declare a `continuity` block, and those shots are generated in
    order. The previous frame is cut for `compare --handoff` and **not sent**
    (every shot given it inherited that camera), so the `--entry`/`--exit`
    sentences are the join and `--with-handoff` is for one that failed.
14. **Cost lives beside the artifact, and you quote it in dollars.** Every paid
    call — sheet, style frame, key frame, take, TTS line, music — is recorded
    in the JSON of the thing it paid for as `{ usd, basis }`, and `--cost-usd`
    always needs `--cost-basis table|reported|estimate` (a vendor's own figure
    is `reported`). A record with no price is unpriced, never free.
15. **Call things what they are.** A greybox is not a final film; a reel is not
    a final cut; a take at 854×480 is not 1080p; a key frame is a still.
    "Generated", "inputs prepared only" and "waiting for a key or an approval"
    are three states; your report says which one each file is in.
16. **Speak the creator's language; write the film's.** Answer in whatever
    language they write in; `screenplay.md`, dialogue, scene headings, beat
    labels **and beat `detail`** are in the film's language, so the design
    reaches the pack untranslated (Seedance reads Chinese); prompts for
    images are English.

## How the prompt is written

`references/prompting.md` is the authoritative text; read it before your first
pack. **There is no word limit** — a "120–180 words" budget copied from
text-to-video guides made the second acceptance run delete its own designed
beats. Carry the whole design; cut vagueness, never length, non-negotiables
first and prohibitions last. `prompt-skeleton` emits this block order in the
film's language — **for a `free` shot it drops the replacement sentence, the
`@Video1` line, 按白模路线 and the 白模 locks, opens on the 成片 sentence and
lets the camera move with the action; `hybrid` adds one sentence allowing
dynamic body and camera speed inside the block**:

| block | what it must say |
|---|---|
| the replacement sentence, first | the blocks in @Video1 *are* these subjects; inherit its camera, shot sizes, timing, positions and paths, and take no body reference from them |
| **【素材映射】** | one line per attached reference, at the index `generate` will attach it, each with a positive scope **and** an explicit exclusion (`只参考…，不用…`). In order: `@Video1` the greybox — it must disinherit the grey material, the empty set, the block shapes and the viewport overlays, or the model paints grey; one line per landmark (`@Video1 中的红体块 = 便利店雨棚`), so a colour in the picture means a place; one line per sheet (`白模中的<颜色>体块 = <角色>，只参考脸型、发型、服装与配饰，不用背景`); the style key frame (`只参考画风、线条与上色方式，不参考构图与人物`); `@Audio…` the voices. Nothing else unless the job was asked for it |
| **【一句话成片】**, then **【全局设定】** | the clip in one sentence with its seconds and aspect; then 风格 / 场景 / 光线 / 运镜总原则. 场景 is the set's bible `look`, pre-filled — the place travels as text and its structure is @Video1's; 地理 is measured off the block and says who is in front of what, and what is not in frame. 运镜 is **one** camera move, carried whole, with where it ends, and `一镜到底 / one continuous shot, no cut` |
| **【时间戳分镜】** | a **contiguous** partition of the clip: no gaps, no overlaps, one main event per segment, about one per 1–1.5 s (4 in a 4 s shot, 5 in a 6 s, never more than 7). Each line is 景别 + 构图 + the beat's designed `detail` **whole** + 按白模路线/站位/轨迹 + how the materials and the light grow in + how the body becomes a body (真实的步子与重心，不是滑行). Visible details, never adjectives: not 「很悲伤」 but 「鼻翼一紧、泪在下睑停住」. Spoken lines quoted at their second; 第一帧 / 最后一帧 carry the entry and exit states, and on a continuing shot the 第一帧 line opens `承接上一镜（sXX）的结束状态：` — that sentence, plus `不沿用上一镜的机位`, **is** the hand-off |
| **声音**, the regeneration line, then **【全局锁】** last | named sounds and `不要配乐` (the cut lays the score); 重新生成自然的<这一镜的动作>，不迁移方块滑行或机械摆动; then 不新增不删除物体，不改镜头轨迹，不保留白模质感, who may be in frame, and 禁止：白模方块、刚性滑行、塑料皮肤、变脸、额外人物、字幕、自带 BGM、突然跳切… |

`generate` refuses a pack that leaves an attached reference unassigned or
names one that was not attached; it **warns** about a gap, an overlap, two
camera moves in one segment, a designed `detail` no line carries, a missing
【全局锁】, an unexcluded `@Video1` and a film with no style key frame — each
a take that came back wrong once. `prompt-skeleton` takes the same `--with-…`
flags as `generate`, and the two must match.

## Workflow

Every stage runs the same loop — **produce → show → stop → the creator
approves or asks for changes → next**. "Show" is `navigate-to` that stage plus
two lines of report; "stop" means you do not start the next one. Resume with
`backlot.mjs status <project>`, never from memory. What each approval buys:
`idea` → the screenplay; `script` → paid bible images and voices; `bible` →
blocking the shots; `boards` (the shot plan, free) → greyboxes, also free;
`previz` → paid takes; `takes` → paid VO and music; `sound` → the final cut.

**1. Idea.** Ask what the film is, or take what they already said. Write
`idea.md`: logline, tone, length, audience, the look in words
(`references/screenplay.md`), and every default you assumed. `backlot.mjs init
<project> --title --logline` creates `backlot.json`; its spec is every shot's.

**2. Screenplay.** Read `references/screenplay.md`. Write `screenplay.md` in
the film's language, register each scene (`scene add`), then break the scenes
into shots — one continuous camera each, 4–8 s, the duration from the pace
arithmetic in `references/shot-plan.md` — and register them (`shot add`),
which moves the `boards` stage, not this one.

**3. Bible — the sheets and one style frame; the set is words.** Read
`references/bible.md`. One **character sheet** per person, written as a design
brief, and **one style key frame for the film** (`backlot.mjs style
--keyframe`): a key moment in the intended idiom at `xhigh`, chosen by the
creator among two or three directions, saying how the film is drawn and
nothing about what is in it — and **location-neutral** (a bust, a texture, a
patch of sky): it rides on EVERY take, so a place in it is painted into shots
that place is not in, and `style --keyframe` warns when it looks like a set
concept. Those are the only pictures a take gets from
here, so ask `gate <project> bible-image` before `generate_image.mjs` (it
knows nothing about stages), then register with `character look`. Each
speaking character gets one voice, chosen once; illustrated or 3D design,
never photoreal — that is what the likeness filter refuses. **A place is
described, not drawn**: `set add --look "…"` carries materials, colours and
**real metres** into every pack, and a concept frame is optional.

**4. The shot plan — design the picture in words, and draw nothing.** Read
`references/shot-plan.md`. Free, and it produces no image. Per shot: write
`shot-plan.md` with the timeline, the entry and exit states, the continuity
decision for the cut into it and **how the shot is conditioned** — `greybox`,
`free` or `hybrid`, with the reason (rule 12); register the beats with a
**`detail` on each** — the designed picture of those seconds, which the
greybox is built from and the prompt is made of — plus the lines, the ties,
the conditioning and any hand-off (`previz.mjs beats`, `lines --set`, `meta
--scene --characters --set --conditioning --continues-from --entry --exit`).
Show the shot list and stop. **Do not draw here**: a storyboard drawn before
the block contradicts it, and the block can satisfy none of them.

**5. Previz — block the shots that are blocked, check them, show the reel.**
Read `references/greybox.md` — the kit, the build order and the acceptance
list — and `references/camera.md` before any camera block. **A `free` shot has
nothing to do here**; it goes from its plan to its pack. For each blocked
shot: layout → blocking → prop events → camera (one move) → tempo, each layer
checked before the next hides its mistakes. **Name the places**: every spot
the beats mention gets a `pv.landmark(...)`, one saturated colour each, eight
at most — grey lumps make the model invent the geography once per take (seven
takes of one street disagreed about which side the shop was on). **Colour
places, not props**: walls, roofs, shelters and gates take the colour; a
bicycle or a bench stays grey and is placed in the beat detail next to a
coloured place, because a small prop comes back painted its code colour.
`render --preview`, look at sheets and strips, `check` every item, fix what
fails, then `render` for the final
`greybox.mp4` + `scene.blend` + `scene.glb`. Blender is only ever started by
`previz.mjs render`, headless; never ask the creator to open it.

Then present the stage as one review: per shot its conditioning, its greybox
(where it has one), the beat details, the continuity decision and the
seconds; across the film, the reel from `backlot.mjs cut --reel` — greybox
stand-ins, a black title card for a free shot with no block — free, ungated,
and the first time anybody sees whether the film *works*. Say plainly that it
is a reel. Bible, greybox and breakdown are approved **together**: the last
free moment. **Pictures here are optional** — `previz.mjs anchor` re-renders
one greybox frame in the film's look and `lineup` stands the two side by
side, paid, for the creator; no take receives one without `--with-anchors`.

**6. Takes.** Read `references/prompting.md` for the pack and
`references/video-generation.md` for the machinery. Never write `prompts.md`
from scratch: `previz.mjs prompt-skeleton <shot-dir> --write` fills the whole
template from the record — **in the shape this shot's conditioning asks for**
— the reference lines with their exclusions, the set's written look, the
one-line brief, the camera, the contiguous timeline carrying every beat's
`detail` whole, the quoted lines, the entry and exit, the locks. You add the
style, the light, the 景别/构图 per segment, how materials and body come
alive, the sounds and this shot's own prohibitions, then copy the block in.
**The references are the greybox (unless the shot is free), the sheets and
the style key frame** — nothing else unless you pass a `--with-…` flag to
*both* commands; `--estimate` prices the job and lists what it attaches. Then
look at the take — against the greybox where there is one, against the plan's
beats where there is not, and at `compare --handoff` on a continuing shot —
record the checks and `select` the one it delivers.
{{#videoEnabled}}A fal key is configured here, so takes can be
generated.{{/videoEnabled}}{{#videoDisabled}}No fal key: finish the greyboxes,
the `.blend` files and the packs, build the reel, and say plainly that no take
was generated and why.{{/videoDisabled}}

**Two kinds of line, and they are not interchangeable.** A `spoken` line is
rendered *by the video model* — the prompt carries it verbatim, the speaker's
`voice.mp3` goes as `@Audio`, `take-lines` checks it against the transcript. A
`vo` line is TTS (`previz.mjs vo`), mixed in the cut. Never lay TTS over a
mouth the model animated.

**7. Sound.** Read `references/sound-and-cut.md`. Synthesise the voice-over
lines (`previz.mjs vo`), write a music brief — genre, tempo, instruments,
mood, length — and commission it with `backlot.mjs music`. Ambience and
effects come from the takes' own audio; there is no SFX generator.

**8. Cut.** `backlot.mjs cut --final` re-encodes every selected take to the
project spec, honours each shot's trim, concatenates in shot order, keeps take
audio as ambience, places each VO line at its second, lays the music under and
writes `cut/edl.json` last; it refuses while any shot lacks a selected take.
Read the report: `trimmed` holds the shots you trimmed, `droppedVo` a line
whose second fell outside its trim — move it or widen the trim, never leave
one unmentioned. Then deliver `final.mp4`, `edl.json`, the takes, the packs,
the acceptance records and the cost total, each named for what it is.

## Commands

Run every script as `node {SKILL_PATH}/scripts/<name> …`, where `{SKILL_PATH}`
is this skill's absolute directory as named in the instructions file (shared
scripts live there too; never hardcode `.claude/skills`). Each `--help` is the
authoritative flag list; these tables say what a command is for.

### `backlot.mjs` — the film

Every subcommand takes the project directory as its first argument.

| command | use it to |
|---|---|
| `init <project> --title "…" --logline "…" [--seconds --fps --width --height]` | create `backlot.json`; its spec is every shot's and the cut's default. `--logline` is required — the whole film is built from it |
| `status <project>` | every stage's status, cost and approval time, the gates, scenes, bible, shots, sound, cut, and the first open stage |
| `approve <project> <stage> [--note "…"]` | record the creator's approval together with the hash of what they saw; `--note` keeps what they actually said |
| `gates <project> open\|closed` · `gate <project> <command>` | open every gate (only when the creator said to run the film through) or close them again; and ask whether `bible-image`, `voice`, `board`, `anchor`, `generate`, `vo`, `music` or `cut-final` may spend right now — run that before every paid shared-script call |
| `scene add\|set <project> --id sc1 --heading "…"` · `shot add <project> <id> --title "…" [--scene --characters --set --entry --seconds --fps --size]` | the film's spine: register or amend a scene, and append a shot to the order, scaffolding `shots/<id>/` |
| `character add\|set\|look\|voice <project> <id> …` · `set add\|set\|look <project> <id> …` | the cast: the record, `set` to amend it, the sheet you generated (`look --file --prompt`) and the voice sample it synthesises (`voice --text`). And the places: the record — **`--look` is the set's picture**, pre-filled into every pack, and `set add` warns without one — plus an optional concept frame no take carries unless asked |
| `style <project> --keyframe <png>` \| `--clear` | the film's **style reference**, and it is essential: one picture that says how this film is rendered — idiom, palette, light, finish — and nothing about what is in the frame. Copied into the project and attached to every take (and every key frame). `generate` warns when a film has none. Free |
| `music <project> --prompt "…" [--seconds]` · `cost <project>` | commission the score through `generate-bgm.mjs` into `sound/sound.json`; and total every paid call by stage and kind — anything with no recorded price is listed as unpriced |
| `cut <project> --reel` \| `--final` `[--music-db=-18] [--music-fade 2]` | assemble the film, honouring every shot's trim. `--reel` uses greybox stand-ins — and a black title card for a free shot with no block — is free and needs no gate; `--final` refuses while any shot lacks a selected take. A negative decibel needs the `=` spelling |

### `previz.mjs` — the shot

| command | use it to |
|---|---|
| `doctor` · `render <shot-dir> [--preview] [--keep-frames]` · `reference <shot-dir> <video> [--in --out] [--adopt-spec]` | which stages exist on this machine (Blender, ffmpeg, ffprobe, whether a key is reachable); run `scene.py` in headless Blender → MP4, `.blend`, `.glb`, sheet, bumping the revision; and the recreate entry — probe a reference video, trim it, find its cuts, write frames and a contact sheet |
| `meta <shot-dir> [--scene --characters --set] [--conditioning greybox\|free\|hybrid] [--trim-in 0.4 --trim-out 1.6] [--no-trim] [--continues-from <shot> --entry "…" --exit "…"] [--no-continuity]` | tie a shot to its scene, its characters and its place; **`--conditioning`** is rule 12's decision — `free` sends no `@Video1`, needs no greybox and no greybox checks, and is priced on the no-reference row; `--trim-*` names the sub-range of the shot's clock the **cut** uses (one flag alone edits the range that is there, `--no-trim` clears it); `--continues-from/--entry/--exit` declare the hand-off into this shot, and `--exit` alone records what the *next* shot opens on |
| `beats <shot-dir> --set <file.json>` · `lines <shot-dir> --set '<json array>'` | replace the beat list — each beat may carry `detail`, the designed picture of those seconds, which becomes the prompt's timeline — or the shot's lines (`spoken` or `vo`, with the second each lands) |
| `anchor <shot-dir> [--at 0] [--id first] [--prompt "…"]` · `lineup <shot-dir>` | **optional — a picture for the creator, not a reference the take receives unless `--with-anchors`.** The final greybox's frame at `--at`, re-rendered in the film's look: composition, framing, positions and scale from that frame exactly, appearance from the sheets, idiom from the style reference. `lineup.png` stands each key frame beside the greybox second it came from. `anchor` is paid and gated on `bible` plus a final greybox; `lineup` is free. `board <shot-dir> --file …` is the legacy drawn frame: not part of the flow, and it reaches a take only through `--with-board` |
| `prompt-skeleton <shot-dir> [--write] [--with-anchors\|--with-board\|--with-concept\|--with-handoff]` | the whole prompt pack in the block order this shot's conditioning asks for, pre-filled with this shot's own indices, its beats whole, its lines and its set's written look, in the film's language. The `--with-…` flags must match the `generate` call that will run. `--write` puts it in `prompts.skeleton.md`, never in `prompts.md` — you copy the filled block across. Start every pack here |
| `sheet <shot-dir> [--lane …] [--at s,s] [--strip a,b]` · `compare <shot-dir> --a greybox --b reference\|take-01 [--at …] [--blend]` · `compare --handoff` | the pictures you judge from: key moments or every consecutive frame of a range; two lanes at the same seconds, stacked or blended; `--handoff` pairs the previous shot's out-frame with this take's in-frame |
| `check <shot-dir> --id … --status pass\|fail\|unverified [--target …] [--note …]` · `checklist <shot-dir>` | record one acceptance item against the current revision, or seed the missing ones as `unverified` |
| `generate <shot-dir> [--resolution 480p] [--fix "…"] [--user-approved] [--allow-failing "…"] [--no-handoff] [--estimate] [--audio] [--with-anchors\|--with-board\|--with-concept\|--with-handoff]` | price, then run Seedance with the greybox (unless the shot is `free`, which sends no video and starts its images at `@Image1`), the character sheets, the film's style key frame and the voice references attached. A continuing shot still waits for the shot it continues to have a selected take, and its out-frame is cut into `takes/handoff-in.png` for `compare --handoff` (`--no-handoff` overrides the wait and is recorded as `skipped`); the model sees that frame only with `--with-handoff`. A key frame, a legacy board or the set concept only with its own `--with-…` flag. `--estimate` lists what it would attach and stops. When it attaches images or audio it prints a `priceNote`: the table does not price those, so the recorded figure is the table's, **not a bill** — quote it that way |
| `vo <shot-dir> <line-id>` · `select <shot-dir> <take>` · `status <shot-dir>` | synthesise a voice-over line in the speaker's registered voice and record its file, seconds and cost; mark the take the shot delivers; print the shot's whole record and its `next` open step (the film's is `backlot.mjs status`) |

### Shared scripts (paid — check the gate first)

`generate_image.mjs "<prompt>" --output-dir … [--image-urls <ref>]…` makes
character sheets, the style key frame and any set concept; `--image-urls`
takes local paths and is the continuity mechanism. The other four are invoked
*for* you: `generate-tts.mjs` (read its header before `--voice`),
`generate-bgm.mjs`, `transcribe.mjs`, `seedance-video.mjs` (only via `generate`).

### Viewer commands

- `check-greybox` — work the acceptance list on the current greybox: make the
  sheets and strips it calls for, look at them, `check` every item, fix what
  fails within the two-revision rule, then report `pass`/`fail`/`unverified`.
- `generate-take` — confirm the shot is ready to spend (a current final render
  and no failing check, unless it is `free`), show the `--estimate` and the
  pack's `prompt` block, then `generate`. Their click is authority for one
  take at the draft resolution.

## References

| Topic | File |
|---|---|
| `idea.md`, screenplay format, the shot breakdown and its cuts, the two line kinds | `references/screenplay.md` |
| Character sheets, the film's style key frame, sets in words, the likeness filter, voices | `references/bible.md` |
| The shot plan, the beats and their `detail`, timing, entry/exit, continuity, **the conditioning decision** | `references/shot-plan.md` |
| The Blender kit, pawns, build order, the acceptance list, the optional key frame — and, for the camera, orbit, zoom, dolly zoom, crane, tempo, the collage | `references/greybox.md`, then `references/camera.md` |
| Recreating a reference video: reading it, estimating space, comparing | `references/recreate.md` |
| **The prompt: the template block by block, the timeline rules, worked examples** | `references/prompting.md` |
| Model capability, the references, cost, what `generate` checks, after the take | `references/video-generation.md` |
| Voice-over, the music brief, the reel and the final cut, delivery | `references/sound-and-cut.md` |
| Every `backlot.mjs` and `previz.mjs` command and its JSON | `references/scripts.md` |

<!-- pneuma:end -->
