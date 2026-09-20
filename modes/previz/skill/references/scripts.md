# `previz.mjs`

```bash
node {SKILL_PATH}/scripts/previz.mjs <subcommand> <dir> [options]
node {SKILL_PATH}/scripts/previz.mjs --help          # the authoritative text
```

One script owns the machine state. Every subcommand prints **one JSON object**
on stdout and exits 0; a refusal prints one `ERROR: …` line on stderr, exits
non-zero and leaves the shot exactly as it was. Progress, and everything
Blender or ffmpeg printed, goes to stderr. Directories are absolute or
relative to the current directory. `<shot-dir>` is `<project>/shots/<id>`.

| subcommand | use it to |
|---|---|
| `doctor` | learn which stages exist here: Blender (path, version), ffmpeg, ffprobe, whether a fal key is reachable (never printed) |
| `init <project> [--title --seconds --fps --size]` | create `previz.json`; its spec is the default for new shots |
| `shot <project> <id> --title … [--entry original\|recreate] [--seconds --fps --size]` | scaffold a shot: `shot.json` with the acceptance list seeded `unverified`, the prose templates, and a `greybox/scene.py` starter that already renders |
| `beats <shot-dir> --set <file.json\|->` | replace the beat list; every problem is reported at once (range, order, unknown or circular `causedBy`, an effect starting before its cause) |
| `reference <shot-dir> <video> [--in --out] [--adopt-spec] [--count 9]` | probe, trim to `reference/source.mp4`, report cuts, write frames and `reference/sheet.png`; `--adopt-spec` takes the segment's fps, size and whole-frame duration as the spec |
| `render <shot-dir> [--preview] [--keep-frames] [--timeout s]` | run `scene.py` headless → PNG sequence → MP4 → full decode → ffprobe; also `scene.blend`, `scene.glb`, `scene.meta.json`, `sheet.png`; bumps the revision; **discards the encode and refuses** when frames, fps or size disagree with the spec, or when another render or an adopted spec moved the shot while Blender ran. `greybox/frames/` is deleted once the MP4 has passed; `--keep-frames` keeps it, and a failed render always does |
| `sheet <shot-dir> [--lane greybox\|preview\|reference\|take-01] [--at s,s,…] [--strip from,to] [--count 6]` | the pictures you judge from: key moments, or every consecutive frame of a range. Tiles carry time and frame number when this ffmpeg has `drawtext`; the JSON says when it does not |
| `compare <shot-dir> --a greybox --b reference\|take-01 [--at …] [--blend]` | two lanes at the same seconds, stacked, or averaged 50 % for silhouette matching |
| `check <shot-dir> --id <check> --status pass\|fail\|unverified [--target greybox\|take-01] [--range a,b] [--note "…"]` | record one acceptance item against the target's current revision; the old state moves to `history`; two failing revisions in a row → `stuck` |
| `checklist <shot-dir>` | seed missing standard checks as `unverified` (never touches a recorded one) |
| `generate <shot-dir> [--resolution 480p\|720p] [--seconds n] [--fix "…"] [--user-approved] [--allow-failing "…"] [--estimate] [--audio]` | price, then run Seedance 2.5 reference-to-video with the **final** greybox as `[Video1]` and the first fenced `prompt` block of `prompts.md`. Refuses without a final render at the current revision, with a failing greybox check, a second take without `--fix`, a third without `--user-approved`. Records `submitted` first, ends `done` or `failed` |
| `select <shot-dir> <take>` | mark the take the shot delivers; refuses one that is not done or has a failing check |
| `status <project\|shot-dir>` | the whole record — spec, beats, greybox, checks (with `unverified` counted apart from `fail`), `stuck`, takes, `costs` — and `next`, the first open stage. Never writes |

`status.next` walks: `reference` (recreate only) → `plan` → `greybox-preview`
→ `checks` → `final-render` → `prompt` → `take` → `take-checks` → `select`.
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
`compare/`); read them with your image tool. They are the same pixels the user
sees in the player — never describe a frame you have not opened.

## Blender

`render` finds Blender from `BLENDER_PATH`, then `PATH`, then the platform's
usual install locations, and runs it `--background --factory-startup` with the
kit directory on `sys.path`. A scene that throws prints its Python traceback on
stderr — fix the script and render again; nothing about the shot changed.
`scene.py` may `import bpy` freely. Do not start Blender yourself and do not ask
the user to.

## Frames

Frames = seconds × fps, numbered `1…frames`. Second `t` is frame
`1 + round(t × fps)`, clamped to the last frame. The kit takes seconds;
`sheet --at` and `--strip` take seconds; the tiles show both.
