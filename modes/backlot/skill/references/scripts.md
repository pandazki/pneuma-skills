# `backlot.mjs` and `previz.mjs`

```bash
node {SKILL_PATH}/scripts/backlot.mjs <subcommand> [args] [options]
node {SKILL_PATH}/scripts/previz.mjs  <subcommand> <dir> [options]
node {SKILL_PATH}/scripts/backlot.mjs --help          # the authoritative text
```

Two scripts own the machine state, and between them they own all of it.
`backlot.mjs` is the **film**: the project manifest, the approvals, the scene
list, the shot order, the bible records, the music record and the edit list.
`previz.mjs` is the **shot**: `shots/<id>/shot.json`, its beats, lines,
greybox revisions, key frames, acceptance record and takes. Neither writes the
other's files, and you write neither of theirs.

Every subcommand prints **one JSON object** on stdout and exits 0; a refusal
prints one `ERROR: …` line on stderr, exits non-zero and leaves the project
exactly as it was. Progress, and everything Blender or ffmpeg printed, goes to
stderr. Directories are absolute or relative to the current directory;
`<shot-dir>` is `<project>/shots/<id>`.

`{SKILL_PATH}` is this skill's absolute directory as named in the instructions
file. Shared scripts are installed into the same `scripts/` directory. Never
hardcode `.claude/skills`.

## `backlot.mjs` — the film

Every subcommand takes the project directory as its first argument.

| subcommand | use it to |
|---|---|
| `init <project> --title "…" --logline "…" [--seconds --fps --width --height]` | create `backlot.json` and `shots/`; its spec is the default for every new shot and for the cut. **`--logline` is required** — the whole film is built from it. Gates start closed |
| `status <project>` | the whole film: every stage with its status, cost and approval time; the gates; the scenes, the bible, the shots with their takes and lines; the sound and the last cut; the first open stage. Never writes |
| `approve <project> <stage> [--note "…"]` | record the creator's approval of a stage together with a hash of the files that define it; `--note` keeps what they said. Refuses an empty stage |
| `gates <project> open\|closed` | open every gate at once, or close them again. Only the creator's explicit "run it all through" justifies `open` |
| `gate <project> <command>` | ask whether a paid command may spend right now: exit 0 with the answer, or exit 1 with the reason and the stage that is waiting |
| `scene add\|set <project> --id sc1 --heading "…" [--number --summary]` | register or amend a scene, in the order the film plays them |
| `shot add <project> <id> --title "…" [--scene --characters --set --entry --seconds --fps --size]` | append the shot to the film's order and scaffold `shots/<id>/` through `previz.mjs`: `shot.json` with the acceptance list seeded, the prose templates and a `greybox/scene.py` that already renders |
| `character add\|set <project> <id> --name [--description --look]` | register a character, or amend one with `set` |
| `character look <project> <id> --file <png> --prompt "…" [--cost-usd --cost-basis] [--move]` | register a sheet you generated with `generate_image.mjs`, bump its revision, record its cost. Gated on `script` |
| `character voice <project> <id> --text "…" [--model --voice --style --language] [--cost-usd --cost-basis]` | synthesise and register the voice sample a take is conditioned on. Gated on `script` |
| `set add\|set\|look <project> <id> …` | the places (a "set" is a place), and their concept frames — same grammar as `character`, `set set` amends |
| `style <project> --keyframe <png> [--prompt "…"]` \| `--clear` | the film's **style reference**: one picture that says how this film is rendered — idiom, palette, light, finish — and nothing about what is in the frame. Copied to `style/keyframe.png` and recorded in `backlot.json.style`; `previz.mjs anchor` attaches it to every key frame as the LAST reference and names its job in the prompt. With no flags it prints the one that is registered. Free, ungated |
| `music <project> --prompt "…" [--seconds] [--cost-usd --cost-basis]` | generate the bed through `generate-bgm.mjs` into `sound/music.mp3` and record it with its measured length. Lyria has no duration parameter — `--seconds` is a hint in the prompt. Gated on `takes` |
| `cut <project> --reel\|--final [--music-db=-18] [--music-fade 2]` | assemble the film, honouring every shot's trim for both take and greybox sources, and write `cut/edl.json` last. `--reel` stands the greybox in for any shot without a selected take and labels those segments; `--final` refuses while any shot lacks one, and is gated on `sound`. A negative decibel needs the `=` spelling: `--music-db=-22` |
| `cost <project>` | every paid call the files record — sheets, voices, key frames, takes, voice-over, music — totalled by stage and by kind. A call with no recorded price is listed as unpriced, never as free |

**Prices are only recorded if you record them.** `--cost-usd` always needs
`--cost-basis table|reported|estimate`: `reported` is the vendor's own
`usage.cost`, `table` a published price, `estimate` your arithmetic. When the
shared script printed a figure — `generate_image.mjs` prints `usage` — pass it
as `reported` rather than letting the record go unpriced.

### Trim: the part of a shot the film shows

A shot's spec is what gets blocked, rendered and generated; its **trim** is
the sub-range the cut uses. Everything else — the greybox, the take, the
beats, a line's `at` — still runs on the shot's own clock; only the film sees
less of it.

This is how a collage works. Seedance will not return less than 4 s, so three
angles of one strike are three ≥ 4 s shots, each trimmed to the ~1.2 s the
film actually uses. `edl.json` carries each segment's `in` and `out`, and the
cut report lists the `trimmed` shots and any `droppedVo`.

**A re-trim re-opens the `boards` stage**: the trim is part of that stage's
hash, so changing it turns the stage `changed` and the creator re-approves the
shot list before the next paid step. That is the point — the shot list they
approved is the one the film plays.

## Stages, approvals and gates

`stage-state.mjs` is one algorithm imported by both scripts **and** by the
viewer's `domain.ts`, so the rail and the CLI can never disagree about a
stage's status.

Only approvals are stored (`backlot.json.approvals[stage] = { at, hash }`).
Everything else is derived from the **text** files that define a stage; media
never enters a hash, because a media file's identity is the `{ file,
revision }` record its JSON carries.

| stage | its content is |
|---|---|
| `idea` | `idea.md` |
| `script` | `screenplay.md` + the scene records |
| `bible` | every `character.json` and `set.json` (name, description, look, sheet/concept ref, voice) |
| `boards` | the shot order + each shot's `title, scene, characters, set, spec, beats` (their `detail` included), `board, trim, continuity`. The stage makes **no image** — `board` is null on every film shot under the current order, and the stage is still defined, hashed and approvable without one |
| `previz` | each shot's final greybox revision + its greybox check statuses + its key frames (`anchors`) |
| `takes` | each shot's selected take id + that take's check statuses |
| `sound` | `sound.json` + every line's file |
| `cut` | `edl.json` |

| status | meaning |
|---|---|
| `empty` | nothing defines the stage yet |
| `draft` | inputs exist, no approval recorded |
| `approved` | the recorded hash equals the current one |
| `changed` | approved once, but the inputs moved since — **not approved** |

An approval whose hash is missing or malformed counts as `changed`: the
creator approved *something*, and nobody can say it was this.

| paid command | needs this stage `approved` |
|---|---|
| `bible-image` (character/set look) | `script` |
| `voice` (a character's TTS sample) | `script` |
| `anchor` (a shot's key frame) | `bible` — plus a final greybox to render it from |
| `board` (**legacy**, a drawn frame) | `bible` |
| `generate` (a take) | `previz` |
| `vo` (a voice-over line) | `takes` |
| `music` | `takes` |
| `cut-final` | `sound` |

Anything not in that table — `render`, `check`, `sheet`, `compare`, `lineup`,
`prompt-skeleton`, `cut --reel` — needs no approval at all. `gates: "open"`
satisfies every gate.

`backlot.mjs` and `previz.mjs` check their own gates and refuse by name.
`generate_image.mjs` does not — it knows nothing about stages — so **you** are
the gate in front of it: run `backlot.mjs gate <project> bible-image` before
generating a sheet or a concept.

## `previz.mjs` — the shot

| subcommand | use it to |
|---|---|
| `doctor [--verbose]` | learn which stages exist here: Blender (path, version), ffmpeg, ffprobe, whether a fal key is reachable (never printed) |
| `meta <shot-dir> [--scene --characters --set] [--trim-in 0.4 --trim-out 1.6] [--no-trim] [--continues-from <shot>] [--entry "…"] [--exit "…"] [--no-continuity]` | where the shot sits in the film — the list `generate` and `anchor` read to attach the right sheets and voices. `""` clears an id; an id the bible does not carry yet is a warning, not a refusal. `--trim-in`/`--trim-out` name the sub-range of this shot's own clock the **cut** uses (`0 ≤ in < out ≤ the spec's seconds`); one flag alone edits the range that is there, and `--no-trim` clears it so the whole shot reaches the film again. `--continues-from` declares the hand-off (an **earlier** shot in `backlot.json.shots`), `--entry`/`--exit` are the first and last half second in words — an `--exit` alone is legitimate and is how the shot before a hand-off says what the next one opens on — and `--no-continuity` clears the block |
| `beats <shot-dir> --set <file.json\|->` | replace the beat list; every problem is reported at once (range, order, unknown or circular `causedBy`, an effect starting before its cause). Each beat may carry `detail` — the designed picture of those seconds, in English — which is what `prompt-skeleton` turns into the prompt's timeline |
| `lines <shot-dir> --set '<json array>'` | replace the shot's lines: `{ id, speaker, kind: "spoken"\|"vo", text, at }`. A line whose text is unchanged keeps its recording; a line whose text changed loses it and says so |
| `board <shot-dir> --file <png> --prompt "…" [--refs a.png,b.png] [--cost-usd --cost-basis]` | **LEGACY — not part of the flow.** Registers a drawn board on a film shot before the key frames existed; copies it to `board.png`, bumps its revision, records the prompt, refs and cost. Gated on `bible`. Boards drawn before the greybox contradicted each other and the greybox could not satisfy them (`shot-plan.md`), so the pictures come from `anchor` now, and a shot that has a key frame never sends its board to a take |
| `reference <shot-dir> <video> [--in --out] [--adopt-spec] [--count 9]` | probe, trim to `reference/source.mp4`, report cuts, write frames and `reference/sheet.png`; `--adopt-spec` takes the segment's fps, size and whole-frame duration as the spec |
| `render <shot-dir> [--preview] [--keep-frames] [--timeout s]` | run `scene.py` headless → PNG sequence → MP4 → full decode → ffprobe; also `scene.blend`, `scene.glb`, `scene.meta.json`, `sheet.png`; bumps the revision; **discards the encode and refuses** when frames, fps or size disagree with the spec, or when another render or an adopted spec moved the shot while Blender ran. `greybox/frames/` is deleted once the MP4 has passed |
| `anchor <shot-dir> [--at 0] [--id first] [--prompt "…" \| --prompt-file <f>] [--aspect-ratio 16:9] [--quality high] [--cost-usd --cost-basis]` | the **key frame**, and the storyboard: cuts the *final* greybox's frame at `--at` and hands it to `generate_image.mjs` as the composition, camera, positions and scale, together with this shot's character sheets and its set concept for appearance ONLY and the film's style reference (`backlot.mjs style`) LAST for the idiom, prompted from the beat `detail` at that second. Writes `anchors/<id>.png` and records `{ id, at, file, revision, prompt, refs, cost }`; re-running an id bumps its revision. `first` is the opening frame and becomes the take's `@Image1`; a second id (`key`, `last`) is another designed moment, and a `last` one gives the next shot a look-continuous picture to continue from. A legacy board is NOT attached — the composition comes from the greybox. Paid, priced from the vendor's own `usage.cost`; gated on `bible` plus a final greybox. Part of the `previz` stage's content |
| `lineup <shot-dir> [--at s] [--id first] [--out <path.png>]` | every key frame beside the greybox frame it was rendered from, side by side with the beats written underneath — the joint review before any video is bought. One greybox frame per key frame at that key frame's own second, unless `--at` names one moment for all of them; `--id` narrows it to one key frame; a legacy board is shown last and labelled. Whatever is missing is left out and named. Free |
| `sheet <shot-dir> [--lane greybox\|preview\|reference\|take-01] [--at s,s,…] [--strip from,to] [--count 6]` | the pictures you judge from: key moments, or every consecutive frame of a range. Tiles carry time and frame number when this ffmpeg has `drawtext`; the JSON says when it does not |
| `compare <shot-dir> --a greybox --b reference\|take-01 [--at …] [--blend]` · `compare <shot-dir> --handoff [--take take-02]` | two lanes at the same seconds, stacked, or averaged 50 % for silhouette matching. `--handoff` instead writes `takes/qa/<take>/handoff.png` — the previous shot's out-frame beside this take's in-frame — which is the evidence for `take-handoff` |
| `prompt-skeleton <shot-dir> [--write]` | the whole prompt pack, pre-filled from the record and in the block order `prompting.md` documents: the replacement sentence, 【素材映射】 with one scope-and-exclusion line per reference at the index `generate` will attach it, 【一句话成片】 with this shot's seconds and aspect, 【全局设定】 carrying the camera beat's designed sentence whole, 【时间戳分镜】 as a **contiguous** partition of the clip (no gaps, no overlaps, ≈1 segment per 1–1.5 s, each carrying its beat's `detail` in full, denser beats merged rather than shortened), the entry/exit frames, the spoken lines at their seconds, 声音 with `不要配乐`, the regeneration line and 【全局锁】 last. Chinese scaffolding for a film whose `screenplay.md`/`idea.md` is CJK, English otherwise; tags stay `@Video1/@Image1/@Audio1`. **No word budget.** The text comes back in the JSON's `skeleton` with `language`, `segments`, `maxSegments` and `merged`; `--write` puts it in **`prompts.skeleton.md`** and never touches `prompts.md` — copy the filled block in yourself. Free, and the way every pack starts |
| `check <shot-dir> --id <check> --status pass\|fail\|unverified [--target greybox\|take-01] [--range a,b] [--note "…"]` | record one acceptance item against the target's current revision; the old state moves to `history`; two failing revisions in a row → `stuck` |
| `checklist <shot-dir>` | seed missing standard checks as `unverified` (never touches a recorded one) |
| `generate <shot-dir> [--resolution 480p\|720p] [--seconds n] [--fix "…"] [--user-approved] [--allow-failing "…"] [--no-handoff] [--estimate] [--audio] [--timeout 1800]` | price, then run Seedance 2.5 reference-to-video with the references gathered from the shot's record (see `video-generation.md`) and the first fenced `prompt` block of `prompts.md`. Refuses while the film's `previz` stage is not approved, without a final greybox at the current revision, while a greybox check is failing (unless `--allow-failing "<reason>"`), a second take without `--fix`, a third or later without `--user-approved` as well, a prompt naming a reference index nothing was attached at, **a prompt that leaves an attached reference unassigned**, or — when the shot declares `continuity.from` — while the shot it continues has no selected take (`--no-handoff` generates without that frame and records `"skipped"` on the take). With a hand-off it cuts the previous take's frame at that shot's trim `out` into `takes/handoff-in.png` and attaches it as the last image reference, `role: "handoff"`. An assignment may use `=`, `:`, `：` or `is`. **Warned about, never refused:** a timeline line past the shot, running backwards, leaving a gap or overlapping the one before it; a segment naming two camera moves; a beat whose designed `detail` no timeline line carries any more; a missing 【全局锁】/【Locks】 block; an `@Video1` line with no exclusion; an unfilled `<TODO: …>`. `--estimate` prices the job, lists what would be attached, and stops. Otherwise the take is recorded `submitted` — with the prompt at `takes/<id>.prompt.txt` — before the request leaves, and ends `done` or `failed`. A shot with a spoken line is generated with audio and transcribed on arrival to `takes/<id>.transcript.json`; `take-lines` passes only if every line is in it. When images or audio are attached it prints a `priceNote`: the table prices the output and the video reference only, so the recorded figure is the table's and **not a bill** |
| `vo <shot-dir> <line-id> [--model --voice --style] [--cost-usd --cost-basis]` | synthesise ONE `vo` line through `generate-tts.mjs` into `sound/<line>.mp3` with the speaker's recorded voice; records file, measured length and cost. Refuses a line spoken on screen. Gated on `takes` |
| `select <shot-dir> <take>` | mark the take the shot delivers; refuses one that is not done or has a failing check |
| `status <shot-dir>` | the shot's whole record — spec, beats, lines, greybox, `anchors`, checks (with `unverified` counted apart from `fail`), `stuck`, takes, `costs` — and `next`, the first open step. Never writes. The film-level report is `backlot.mjs status` |

`status.next` walks: `reference` (recreate only) → `plan` → `greybox-preview`
→ `checks` → `final-render` → `anchor` → `prompt` → `take` → `take-checks` →
`select`. **There is no board step** — nothing between the plan and the
blocking asks for a drawing. `anchor` is a suggestion, not a gate: it is
raised once the greybox is accepted and it closes as soon as the shot has a
key frame *or* a take, because a shot may go straight to video on purpose.
It is a report, not a gate: read it when you resume a session or lose the
thread, and believe it over your memory of what you did. A failing check at
`checks` means fix the scene and render again; a failing check at
`take-checks` means one more take with a named `--fix`, or reporting the
deviation and delivering the greybox — `next.command` says which.

`render`, `reference` and `generate` all re-read `shot.json` after the long
external call and write back only their own fields, so a `check` recorded
while a take is in flight survives the take landing. `render` refuses instead
of writing when another render or an adopted spec moved the shot underneath
it; `generate` prints the take and writes `takes/<id>.orphan.json` if its
record disappeared while the job ran.

The pictures `sheet` and `compare` write land under the shot (`greybox/`,
`compare/`); read them with your image tool. They are the same pixels the
creator sees in the player — never describe a frame you have not opened.

## Shared scripts

Installed beside the two above. Each is a paid call to a vendor; each prints
JSON on stdout and progress on stderr; each reads its key from the
environment or the mode's `.env`, and never prints it.

| script | what it does | called by |
|---|---|---|
| `generate_image.mjs "<prompt>" [--image-urls <ref>]… [--aspect-ratio --quality --output-dir --filename-prefix]` | GPT-Image through OpenRouter. `--image-urls` takes local paths, data URIs or URLs, up to 16, and is how the bible holds continuity — and how a key frame is made image-to-image from a greybox frame | you, for sheets and concepts; `previz.mjs anchor` for key frames |
| `generate-tts.mjs --text … --output … [--model --voice --style --language --speed] --json` | two fal TTS vendors with different voice lists — **read its header**, do not guess a voice id. `--json` reports the measured `seconds` | `backlot.mjs character voice`, `previz.mjs vo` |
| `generate-bgm.mjs --prompt … --output … [--duration N]` | Lyria through OpenRouter, streamed to an MP3 | `backlot.mjs music` |
| `transcribe.mjs --input <media> [--language] --json` | Whisper on fal; the transcript that `take-lines` is checked against | `previz.mjs generate`, automatically, for a take with a spoken line |
| `seedance-video.mjs` | the video model, through fal's queue, with remote cancellation on interrupt | `previz.mjs generate` only |
| `fal-queue.mjs` | the fal transport the two fal scripts share | never directly |

## Blender

`render` finds Blender from `BLENDER_PATH`, then `PATH`, then the platform's
usual install locations, and runs it `--background --factory-startup` with the
kit directory on `sys.path`. A scene that throws prints its Python traceback on
stderr — fix the script and render again; nothing about the shot changed.
`scene.py` may `import bpy` freely. Do not start Blender yourself and do not ask
the creator to.

## Frames

Frames = seconds × fps, numbered `1…frames`. Second `t` is frame
`1 + round(t × fps)`, clamped to the last frame. The kit takes seconds;
`sheet --at` and `--strip` take seconds; the tiles show both.

## What no script decides

The scripts hold the record, the arithmetic and the refusals. They do not
decide whether a story works, whether a look is right, whether a take is good
enough, or whether the creator meant what you assumed. Those are yours, and
the eight stage gates exist so the creator gets to answer them before you
spend their money on the answer.
