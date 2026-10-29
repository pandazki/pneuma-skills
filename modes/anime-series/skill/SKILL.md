---
name: pneuma-anime-series
description: >
  Pneuma Toon Series (anime-series) workspace guidelines. Use for ANY task in
  this workspace: designing a fixed cast and locking their design sheets,
  writing the bible, pitching the next episode from one sentence, writing and
  timing a shot list, drawing the storyboard, generating an episode clip with
  Seedance, sampling a clip and checking every character against the sheets,
  redrawing one panel, re-shooting a span, finishing an episode, exporting the
  season, and the copy-paste route when no API key is set. Defines the three
  files and who writes each, the series.mjs commands that own every prompt and
  every paid call, the viewer address vocabulary, and what may be called
  checked. Consult before your first action in a new conversation.
---

# Pneuma Toon Series Skill

## Scene

You and the user are making a short animated series: a fixed cast, one gag per
episode, 15, 30 or 60 seconds each. The hard part is episode ten, where the
leads must still be the same leads. The method: the look is written once in
the **bible**, design sheets are the identity references, the storyboard is a
black-and-white sketch that only fixes composition, every prompt is assembled
by a script from the bible and the episode, and every clip is sampled shot by
shot and compared with the sheets.

In front of the user: the **cast wall** (a card per character, group, scene and
the style, each with its sheet and lock state), the **episode desk** (the
screen, the **shot strip** — storyboard, shot list and timeline in one, each
cell as wide as its seconds — and the selected shot's words, stamps and
checks) and the **season rail** above. You write the cast and the episodes, run
the scripts that draw and shoot, and look at what came back. The user decides
which sheet, when to lock, whether a drift stays and what to spend.

## Viewer contract

The viewer renders `bible.json`, every `episodes/<id>/episode.json` and
`project.json` as one series. It writes the user's **decisions** straight into
the two text files — card text, a picked sheet, a lock, a shot's words,
seconds dragged between shots, the take in use, an accepted drift, an
acknowledged bible change — so re-read a file before you change it. It never
writes `project.json` and never generates; its buttons send you commands.

Every message carries a `<viewer-context mode="anime-series">` block: bible
version and spend, each card's lock state, the episode on screen with its
stage, checks and stale shots, the selection, the playhead, the marked span
and an `Address:` line. "This shot" and "here" mean that address.

### ViewerAddress vocabulary

Coarse keys go to another place; fine keys move within it. `contentSet` is
unused: one workspace is one series.

| Key | Grain | Meaning |
|---|---|---|
| `season` | coarse | `"overview"` — the season table: what each episode used, spend, appearances |
| `character` · `group` · `scene` | coarse | a bible card by id (`"guang"`, `"stickies"`, `"office-night"`) |
| `bible` | coarse | `"style"` — the style card (`style`, `sheetStyle`, ratio, dialogue) |
| `candidate` | fine | with a card key: one sheet candidate (asset id), opened in the pick drawer |
| `episode` | coarse | the desk for that episode (`"ep01"`) |
| `part` | fine | `"A"`, `"B"` — only on a 60 s episode (two 30 s parts) |
| `shot` | fine | 1-based shot number within the part |
| `lane` | fine | `"board"` (the panel) or `"clip"` (the video); clip by default once one exists |
| `check` | fine | with `shot`: a cast member's id or `group:<id>` — the drift compare (sheet beside that shot's frames) |
| `time` | fine | seconds on the episode clock; selects the shot under it |
| `range` | fine | `[from, to]` seconds on the episode clock — the span the user shift-clicked |
| `take` | fine | a take or patch asset id to show instead of the one in effect |

Examples: `{ "character": "guang", "candidate": "char-guang-sheet-1" }` ·
`{ "episode": "ep01", "shot": 7, "check": "guang" }` ·
`{ "episode": "ep01", "range": [19, 26] }`.

### Actions

- `navigate-to { address }` — put the viewer where your sentence is. It
  pauses, so a following `capture` gets that frame. An unknown episode, part,
  shot, card, candidate or take is refused by name and nothing moves; the
  reply's `data` says where the viewer is.
- `get-view-state` — `{ level, episode, part, shot, lane, take, playhead,
  markedRange, selected, candidatesOpen, flags: { bibleStale, drift[],
  unverified[] } }`. Call it before acting on "this" or "here".
- `play { episode?, from?, to? }` / `pause` — play the clip in effect over a
  span, e.g. a patched span after it lands. Refused when there is no clip.
- `capture` (built in) — a screenshot of what the user sees. Put `episode` or a
  card key in its address: a coarse key makes capture navigate first, while
  `{ "shot": 3 }` alone shoots whatever is on screen.

Add a `<viewer-locator label="…" address='{…}' />` card to a reply when the
user should jump to what you mention.

### Look through the viewer; never imagine the output

You cannot describe a picture you have not opened. Three senses, cheapest
first:

1. **Look** — the context block and `get-view-state`: where the user is, what
   is stale, which checks are open.
2. **Diagnose** — what the scripts write for you to read: `series.mjs status`,
   the `check-sheets` compare image, the storyboard PNG, the `review-episode`
   contact sheets (decoded frames beside the sheets) and, when a row is too
   small to judge, `frames` (one shot's frames at full size, or a close-up).
   Open each image.
3. **Verify** — `navigate-to` + `capture`: the strip, a card, the drift
   compare, as the user sees them. Judge identity from contact sheets and
   `frames`, which are real frames; if a capture's video area is blank, that
   is the capture — say so rather than judge from it.

## Core rules

1. **The bible is the one authority.** A character's appearance lives in its
   `look`, written once and carried by every storyboard and clip prompt. To
   change how someone looks, change the bible and let the user re-lock. A look
   fixed in one episode's wording is gone in the next.
2. **Prompts are assembled by `series.mjs`, never written by hand.** Shape them
   through fields only — `look`, `style`, `sheetStyle`, `markings`, a shot's
   `desc` / `sketch` / `sfx`, the episode's `time` and `continuity`. `prompts`
   shows exactly what will be sent, and the viewer's Prompts panel shows the
   same text. A hand-written prompt loses the reference order and the line that
   stops the model pasting the storyboard into the clip.
3. **Three files, three kinds of writer.** `bible.json` and `episode.json` are
   text that you, the user and the viewer edit; prefer the `series.mjs`
   helpers (they validate and refuse broken timing) and run `validate` after a
   hand edit. `project.json` — every generated file with its provenance and
   cost, plus the `series` sidecar — is written only by `series.mjs`. Never
   edit it, and never drop a file into `refs/` or `episodes/` without
   registering it (`--upload`).
4. **Every paid call goes through `series.mjs`.** It records the call before
   the request leaves and lands or fails it after, which is what the viewer,
   the stamps and the spend read. `generate_image.mjs` and
   `seedance-video.mjs` sit beside it; do not run them yourself — that spend
   is invisible and its file has no provenance. The scripts retry transient
   errors; call once.
5. **Every picture you make comes from `series.mjs`, inside the workspace.**
   Compare images, contact sheets, extra frames and close-ups included: when
   a contact sheet is not enough to judge, `frames` takes more frames of one
   shot or a closer look (route 5). Do not run ffmpeg yourself and do not
   write to `/tmp` or anywhere else outside the workspace. The chat and the
   viewer can only show files inside the workspace (the user sees a broken
   image for anything else), and a file `series.mjs` did not record has no
   provenance. A probe that writes no file, such as sampling a pixel's colour
   (`references/characters.md`), is fine.
6. **Estimate before spending, report after.** Before each paid step or batch,
   one line: what it costs and how long it takes (`estimate`, or `--dry-run`).
   After it, what it cost. "Unpriced" is not free; a failed or cancelled
   request may still be billed (`billing unknown`).
7. **480p first.** Every take is 480p until the user is happy with it. There is
   no upscale here: `--resolution 720p` is a new generation at about 2.25× the
   price that will not reproduce the approved take. Say so before they ask.
8. **Never claim a check you did not look at.** A verdict comes from frames you
   opened; the rest stays `unverified`, which the viewer never draws green.
   "The leads hold up" names the shots and characters you judged.
9. **Sheets before shots, cast before scenes.** A clip needs a picked, ready
   sheet for every cast member (the script refuses otherwise). Scene sheets
   are drawn after the cast sheets are picked, which go along as style
   references; text-only scene sheets came out photoreal.
10. **The user decides the sheet, the lock and the drift.** Recommend; they
    pick ("Use this one"), lock ("Lock vN") and accept ("Accept it as it is")
    — or you run the `series.mjs` equivalent when they say so in chat.
11. **Original characters only.** No real people, and no existing anime,
    mascot or other creator's character, "in the style of" included. Borrow
    formats (a duo, a recurring villain swarm), never designs, shots or
    footage. No commercial music. When the user publishes, the episode is
    labelled AI-generated.
12. **Speak the user's language; keep the series in it.** Looks, shot text,
    sounds and verdict notes are in the user's language. The scripts write
    their scaffolding — prompts, Jimeng canvas lines, default continuity — in
    the bible's language, so a Chinese bible gives a Chinese prompt end to
    end (`set-series --lang en|zh` pins it; `auto` follows the text).

The two lines below are how you know which keys this session has; do not
look for keys in the environment or in `.pneuma/`.

{{#imagesEnabled}}**OpenRouter key set:** sheets, storyboards, panels and lineups are drawn here.{{/imagesEnabled}}
{{#imagesDisabled}}**No OpenRouter key in this session.** Sheets, storyboards and panel redraws go through route 9; say so in your first reply.{{/imagesDisabled}}
{{#videoEnabled}}**fal key set:** clips and re-shoots are rendered here.{{/videoEnabled}}
{{#videoDisabled}}**No fal key in this session.** Clips and re-shoots go through route 9; the bible, sheets, storyboards, checks and finals still work here.{{/videoDisabled}}

## Money and waiting

| Step | Price | Wait |
|---|---|---|
| a design sheet (1:1, high), Flare or Sunburst | ≈ $0.055 each; two per request by default | ≈ 30 s |
| a storyboard grid or one redrawn panel (Sunburst once sheets are attached) | ≈ $0.04–0.06 | ≈ 30 s |
| a lineup probe (picked sheets side by side) | ≈ $0.05 | ≈ 30 s |
| a clip at 480p (Seedance 2.5) | ≈ $0.21 a second: 15 s ≈ $3.1, 30 s ≈ $6.2, 60 s ≈ $12.3 | minutes; the script waits up to 30 min |
| a re-shot span | the same rate, at least 4 s (≈ $0.82) | as above |
| a clip at 720p | ≈ $0.46 a second (30 s ≈ $13.9) | longer |
| check-sheets, review-episode, frames, final, compile-season, prompts, estimate | free (local, ffmpeg) | seconds |

OpenRouter reports an image's price after the call. `estimate` prices each
image for the model the command would use — the median of this project's
reported calls of that model, else the seed rounds' table price (labelled
`table`); a quality the table does not cover is "unpriced", never free. Video
prices are fal's published formula — an estimate, not an invoice.

## Workflow

Run commands from the workspace as `node "<SKILL_DIR>/scripts/series.mjs"
<command> …`, where `<SKILL_DIR>` is the directory holding this file; do not
`cd` into it. `series.mjs <command> --help` prints one command's flags; add
`--json` when you parse output. Resume from `series.mjs status`, never from
memory.

### 1. First series: the cast, the sheets, the lock

1. Ask who the leads are — a sentence or two each — or offer three pairs. Read
   `references/characters.md`: silhouettes that differ at a glance, one main
   colour each, **one signature ability grown from the body**, a one-line
   personality, a short name; a villain swarm is one group card.
2. Write the bible: `init --title … --ratio 16:9` in an empty workspace (a
   ratio Seedance cannot render is refused). `init` also says whether ffmpeg
   and ffprobe are installed; if they are missing, tell the user before any
   paid step, with the install line it prints — checking sheets, redrawing a
   panel, reviewing a clip and finishing all need them. Then `set-series
   --style … --sheet-style …`, `set-character` (with `--markings` for text
   the character wears), `set-group` (`--leader`, `--pose`), `set-scene`
   (`--time`, `--rules` for what the set must never show, such as a clock
   face with numbers). Show each card in two lines; they edit on the wall.
3. Sheets, characters first: `estimate --sheets --character <id>`, then
   `make-sheets --character <id>` (two candidates). Flare is the default; for
   character sheets offer `--model sunburst` — same price, and the seed cast
   got cleaner labelled grids and stronger expressions from it. Then groups,
   then scenes.
4. Check: `check-sheets --character <id>`, open the compare image,
   `navigate-to { character, candidate }` and `capture` each, judge it against
   the card (`references/review.md`), and record `verdict --sheet <asset>
   --verdict ok|drift --note "…"`. Recommend one and say why.
5. When every card has its sheet, the user locks v1. Re-picking a sheet or
   editing a look later shows the card as edited until the next lock.
6. Before the first clip, `lineup` (one image, ≈ $0.05): the picked sheets
   drawn side by side at one scale. Open it — same material, every sheet's
   features, the sizes the looks give. A wrong lineup is fixed in the sheets
   or the looks, before any video spend.

### 2. A new episode from one sentence

1. `ideas-context`: places, goals, abilities and endings already used. Read
   the `episode.json` of any episode it lists as not logged.
2. Pitch: with a theme, one idea; without, three. Each is **place + goal +
   ability used + ending** in one line (`references/episodes.md`). Default
   30 s; 15 s holds one gag; 60 s is two 30 s parts.
3. Write the shot table in chat — shot, seconds, picture, sound — with the
   structure in `references/episodes.md` and the craft in
   `references/shots.md`. Wait for a nod: changing the story is free now.
4. `add-episode --title … --duration 30 --cast a,b [--groups g] --scene s
   [--time …] --shots-file -` with the shots as JSON on stdin (a 60 s episode:
   a list of two lists). It writes two default continuity lines; passing
   `--continuity` replaces them, so repeat them when you add the episode's own
   (`references/shots.md`). It refuses broken timing; read its warnings, then
   `navigate-to { "episode": … }`.
5. Stop. Quote the storyboard and 480p clip estimate and wait for "Shoot the
   storyboard" or a go-ahead in chat.

### 3. The storyboard

`shoot-board --episode <id>` draws one black-and-white grid per part with the
sheets attached (Sunburst by default once references are attached). Open the
PNG and check it (`references/review.md`): the panel count on an **even**
rows × columns grid, numbers in the corners, pencil without colour, each panel
showing its shot. Then `navigate-to { episode, shot: 1, lane: "board" }` and
`capture`: the strip and `redo-panel` cut the grid into equal cells, so uneven
gutters show up as half panels. One wrong panel is route 6; a wrong grid is a
new board.

### 4. The video

Before spending: the board in effect is right, every cast member has a picked
sheet, and any bible flag on the episode has been shown to the user. Quote
`estimate --what video`, then `shoot-video --episode <id>` (480p, one take per
part, every sheet attached and the storyboard last). It waits for fal, usually
a few minutes: run it in the background if your harness can and let the
harness keep its output (do not redirect it to a file); meanwhile `status`
shows the take in flight. When it lands, go straight to route 5: an unchecked
clip is not done. Then `final --episode <id>` (it joins parts and splices
patches; with nothing changed it makes no new file; the episode is done only
once every shot × cast / group cell has a verdict), `log` the place, goal,
abilities used and ending, and `play` it for them.

### 5. Review and drift

`review-episode --episode <id>` samples the take in effect: the cast and
group sheets once on top, then a row of three frames from inside each shot, an
overview, the scene cuts found against the planned boundaries, and who each
shot's words name. Open every row.

When a row is too small to judge a detail, or what you need falls between its
frames, look closer with `frames --episode <id> --shot <n>`: six frames from
inside that shot at the clip's own size (`--seconds 12.4,13.8` for moments you
saw on the strip), plus `--crop x,y,w,h` (fractions of the frame) for a
close-up. They come from the clip the shot is judged on and land in
`episodes/<id>/review/`, where you can open them and the user sees them in the
chat. Free, so use it rather than guess.

For each shot × cast member and group record `verdict --episode <id> --shot
<n|a-b> --character <id>[,…] | --group <id> --verdict ok|drift|absent --note
"…"`: `drift` says what is wrong, in the user's language; `absent` means not
in that shot's frames — where the words name them, `status` lists it as a lost
beat. A cell you did not open stays `unverified`, and the episode stays short
of done. Then `navigate-to { episode, shot, check: <id> }`, `capture` the
drift compare, and offer the two choices: re-shoot (route 7) or accept.
Looks-for and false alarms: `references/review.md`.

### 6. Fix one panel

The user points at a shot. Offer one or two rewrites, then `set-shot
--episode <id> --shot <n> --desc … [--sketch …]` (or they edit on the strip).
`redo-panel --episode <id> --shot <n>` draws that panel, with the current
board attached as its style reference, and composites it into a new board that
replaces the picked one. Open it and capture the strip. With
a clip already made, the shot shows "changed since the clip" until it is
re-shot or the user keeps the old take.

### 7. Re-shoot a span

`estimate --episode <id> --shots a-b`, then `patch-range --episode <id>
--shots a-b`. A span under 4 s borrows its neighbours and only a–b is spliced
back. A patch splices cleanly only where the take cuts: check that
`review-episode` found a cut at both ends of a–b (`patch-range` warns when an
end has none within 0.5 s). If an end falls inside one continuous shot, widen
a–b to the nearest cut or re-shoot the part. The new final is built when the
patch lands. The patched shots are now judged on the patch, not the take:
`review-episode --episode <id> --take <patch>` samples them, and `verdict
--shot <n>` on a patched shot records on the patch by itself. Watch the span through the viewer too (`navigate-to {
episode, time }`, `play` from/to, `capture`). When the change moves later
beats (a new ending), re-shoot the part instead.

### 8. Finish the episode and the season

The rail shows "Finished" once a final is built from the takes in effect and
every cell of the cut it shows has a verdict; until then `status` says "final
built, not done" with the count of unverified checks.
`compile-season --titles [--title-format "{n}. {title}"]` joins every finished
episode in order, with 1.5 s title cards. The user watches it in Binge (a rail
button; no address). When you hand over a final or a season file, remind the
user to label it AI-generated when they post it.

### 9. No key: the copy-paste route (Jimeng / Dreamina)

The user pastes the same prompts into the Jimeng canvas and brings the files
back; you register each with `--upload`, so the wall, stamps and checks work as
usual. `prompts --sheets --target jimeng --write` and `prompts --episode <id>
--target jimeng --write` write copy-ready text with the canvas steps on top
(`--shot <n>` for one panel's redraw, `--shots a-b` for a re-shoot);
register with `make-sheets`, `shoot-board`, `shoot-video`, `redo-panel` or
`patch-range` plus `--upload <file>` (and `--part` on a 60 s episode). Canvas
steps, the 9-reference limit, panels and re-shoots: `references/jimeng.md`.

## Commands

A viewer button arrives as a message: `The user pressed "<label>" … command:
<id>`, then `episode:`, `part:`, `shot:`, `shots: a–b`, `take:` or the card and
its candidates, and the `address:`. A press is the go-ahead for that one step
at its defaults (two sheets, one board, one 480p take, one patch): say the
price line, then run it. Anything beyond the defaults needs a yes in chat.

| Command | What you do |
|---|---|
| `new-episode` | Route 2; ask for the sentence if there is none. |
| `make-sheets` | Two more candidates for that card (`make-sheets --<kind> <id>`), then route 1 step 4. |
| `check-sheets` | Route 1 step 4 for that card: compare image, captures, a verdict per candidate, a recommendation. |
| `shoot-board` | Route 3 for the episode (and part) on the desk. |
| `shoot-video` | Routes 4 and 5. If the message carries a bible flag, say what changed and confirm the re-shoot. |
| `redo-panel` | Route 6 for the shot named; if its words did not change, ask what is wrong first. |
| `patch-range` | Route 7 for the shots named; if their words did not change, ask what the re-shoot should fix. |
| `review-episode` | Route 5 for the take named. |
| `compile-season` | Route 8, then report the file and the episodes in it. |
| `retry` | `retry` lists failures with reason and billing. For a clip with a recorded fal request, `retry --asset <id>` asks fal about that request first (free; a clip that finished late is recovered, not bought twice), and only `--resubmit` renders again. Any other failure is re-sent as recorded, which is a new paid call. Before anything is re-sent, say whether the failed one may already be billed and get a yes. |

Every command, flag and refusal: `references/commands.md`.

## References

| Topic | File |
|---|---|
| Designing the cast: silhouettes, abilities, writing `look`, sheets, scenes, style, locks | `references/characters.md` |
| Episode ideas, story structure, dialogue, 60 s parts, the log | `references/episodes.md` |
| Writing shots: timing, grids, `desc` / `sketch` / `sfx`, camera words, continuity | `references/shots.md` |
| Checking sheets, storyboards and clips; drift, false alarms, patch or accept | `references/review.md` |
| The copy-paste route through the Jimeng / Dreamina canvas | `references/jimeng.md` |
| `bible.json`, `episode.json`, the `series` sidecar, file layout, asset ids | `references/files.md` |
| Every `series.mjs` command and flag | `references/commands.md` |
| What has gone wrong before, and where the fix lives | `references/pitfalls.md` |
