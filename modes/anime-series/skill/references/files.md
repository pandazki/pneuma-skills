# Files

## Layout

```
bible.json                        the cast, the place, the style, the locks
project.json                      craft project: every generated file + the `series` sidecar
refs/                             design sheets (char-<id>-sheet-N.png …), lineups (lineup-N.png)
refs/compare/                     check-sheets compare images
prompts/                          sheet prompts written by `prompts --sheets --write`
episodes/<id>/episode.json        title, timing, shots, log, picks
episodes/<id>/boards/             storyboards, <part>-<n>.png
episodes/<id>/panels/             single redrawn panels, <part>-<shot>-<n>.png
episodes/<id>/takes/              clips, <part>-<n>.mp4
episodes/<id>/patches/            re-shot spans, <part>-<a>-<b>-<n>.mp4
episodes/<id>/review/<part>-<n>/  contact sheets: sheets.jpg, shot-NN.jpg, overview.jpg
episodes/<id>/review/<part>-frames-<n>/
                                  closer looks (series.mjs frames): shot-NN-<s>s.jpg, …-closeup.jpg
episodes/<id>/prompts/            prompts written by `prompts --episode --write`:
                                  storyboard-<part>.txt, video-<part>.txt, jimeng-storyboard-<part>.txt,
                                  jimeng-video-<part>.txt; with --shots a-b: patch-<part>-<a>-<b>.txt,
                                  jimeng-patch-<part>-<a>-<b>.txt
episodes/<id>/final-<n>.mp4       the finished episode
season/season-<n>.mp4             compile-season output
```

The viewer reads only the three JSON files as text; media is served from disk
by its recorded path. A file in these folders that `project.json` does not
record is invisible to the viewer and to every script.

## Who writes what

| File | Written by | Your rule |
|---|---|---|
| `bible.json` | you, the user (wall edits, pick, lock), `series.mjs` helpers | Re-read before editing; prefer the helpers; `validate` after a hand edit |
| `episode.json` | you, the user (shot text, dragged seconds, picks, accept, acknowledge), `series.mjs` helpers | Same; change seconds with `set-shot --dur`, which keeps the part's total |
| `project.json` | `series.mjs` only | Read it if you need to; never write it |

`series.mjs` re-reads a text file right before writing it and refuses to write
one that would break the rules, naming the field.

## bible.json

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `ratio` | `"16:9"` … | storyboards and clips; one of 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 (what Seedance renders; others are refused) |
| `dialogue` | boolean | false adds "no dialogue" to clip prompts |
| `lang` | `"en"` \| `"zh"`, optional | the language of the prompt scaffolding; absent = detected from the bible's text (`set-series --lang auto`). Not covered by locks |
| `style` | string | every clip prompt and scene sheet |
| `sheetStyle` | string | every character and group sheet |
| `characters[]` | `{ id, name, look, ability?, personality?, markings?, palette?, expressions?, poses?, aliases?, notNames?, sheet }` | `ability`, `personality`, `palette`, `aliases`, `notNames` never reach a model |
| `groups[]` | `{ id, name, look, leader?, markings?, palette?, poses?, aliases?, notNames?, sheet }` | a group without a sheet is text in prompts |
| `scenes[]` | `{ id, name, look, time?, rules?, sheet }` | `time` is the default time of day; `rules` the set's short constraints, carried by the scene sheet, boards, panels and clips |
| `locks[]` | `{ version, at, hashes, fields }` | appended by Lock; never edit by hand |

Ids match `^[a-z0-9][a-z0-9-]{0,31}$` and are unique per list. `palette` is a
list of CSS colours or an object of label → colour (`--palette 外壳=#fc8028`).
`sheet` is the picked sheet's asset id or null; it must be a ready candidate
of that card. `aliases` and `notNames` only steer "who the shot's words name":
the name or an alias anywhere in the text names the card (Latin names as whole
words), except inside a `notNames` word; a group with a `leader` is also named
by "leader" / 头目. A field added to the bible after a lock counts as unchanged
while it is empty.

## episodes/<id>/episode.json

The id is the directory name (`ep01`, `ep02` … — `^ep[0-9]{2,3}$`); the file
does not repeat it.

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `duration` | number | seconds; 15, 30 or 60 by convention |
| `cast` | character ids | in reference order; only who appears |
| `groups` | group ids | each gets check cells like a cast member |
| `scene` | scene id or null | |
| `time` | string | time of day; empty uses the scene's |
| `continuity` | strings | one line each, added to the clip prompt; `add-episode` writes the method's two lines unless told otherwise |
| `parts` | `[{ id: "A", shots: [{ dur, desc, sfx?, sketch? }] }]` | ids A, B, … in order |
| `log` | `{ location?, goal?, abilities?[], ending? }` or null | written by `series.mjs log` |
| `picks` | see below | decisions |

`picks`:

- `storyboard: { A: <asset> }`, `take: { A: <asset> }` — the board or take in
  use per part. Absent means the newest ready one is in effect (the viewer and
  `status` say "newest, not picked").
- `acceptedDrift: [{ take, shot, character }]` — drifts the user kept. `take`
  is the clip the shot is judged on (the take, or the patch spliced over that
  shot); `character` is a character id or `group:<id>`.
- `acknowledgedBibleVersion` — quiets the bible flag while it is at least the
  latest lock.

## project.json

A `pneuma-craft/project/v1` file (format: the repository's
`docs/reference/craft-project-file.md`). `assets[]` holds every generated or
uploaded file with its status (`pending`, `generating`, `ready`, `failed`);
`provenance[]` holds one edge per asset: the operation (`generate`, `upload`,
`derive`, `composite`), its inputs, model, prompt, request id and cost (`{ usd,
basis: reported | estimate | table }`), or the failure and whether it was
billed (`billing: none | unknown`). There is no ledger; spend is read from the
edges.

The `series` sidecar is the mode's machine state (types:
`scripts/series-state.d.mts`):

```
series.sheets["character:<id>" | "group:<id>" | "scene:<id>"]
                                  { candidates: [{ asset, basis, check? }], compares: [] }
series.lineups[]                  { asset, characters, sheets }              lineup probes
series.episodes["<id>"]           { parts: { A: …, B: … }, prompts: { A: … }, finals: [] }
  parts.A.boards[]                { asset, basis, shots, refs, from? }       storyboards
  parts.A.panels[]                { shot, asset, board, result }             redrawn panels
  parts.A.takes[]                 { asset, board, refs, basis, shots, durs, setup, resolution, seconds }
  parts.A.patches[]               { asset, take, shots, covered, durs, span, offset, length,
                                    seconds, requestSeconds, board, refs, basis, shotHashes, applied }
  parts.A.reviews[]               { asset, take, sheets, strips[], cuts[] }  contact sheets; `take` is
                                                                             the take or patch sampled
  parts.A.checks[clip][shot][cell]  { verdict, note, frame, at }
  prompts.A                       the assembled prompts the viewer shows (saved only when they change)
  finals[]                        { asset, takes, patches, parts, splices }
    splices[]                     { part, shots, at, patch, planned: { take, patch }, snapped: { take, patch } }
series.compilations[]             { asset, episodes, titles }
```

- `checks` is keyed by the **clip** the frames came from — a take, or a patch
  for the shots it splices — then the shot number, then the **cell**: a
  character id, or `group:<id>`. Verdicts are `ok`, `drift`, `absent`,
  `unverified`; `frame` is the contact-strip asset the verdict was made from.
- `durs` on a take is the shot durations it was shot with (its own clock); on
  a patch, the durations of the shots it covers. Review and splicing use them,
  so a later drag of seconds does not misplace the frames.
- A splice's `planned` windows are the shot boundaries on each clip's own
  clock; `snapped` is where it was cut: each interior point moved to a scene
  cut detected within 0.5 s (the latest review's `cuts`, else a fresh
  detection), or left where it was.
- A shot an applied patch covers is current when the patch's `shotHashes`
  match the shot list, whatever the take recorded.
- `basis` records the bible version and the hashes of exactly the fields a file
  consumed — that is how a flag knows which field moved. `shots` and `setup`
  hash what a board or take consumed from the shot list.

## Asset ids

| Asset | Id |
|---|---|
| sheet / compare | `char-<id>-sheet-N`, `group-<id>-sheet-N`, `scene-<id>-sheet-N` / `char-<id>-compare-N` … |
| lineup | `lineup-N` |
| storyboard | `<ep>-<part>-board-N` (e.g. `ep01-a-board-2`) |
| redrawn panel | `<ep>-<part>-panel-<shot>-N` |
| take | `<ep>-<part>-take-N` |
| patch | `<ep>-<part>-patch-<a>-<b>-N` |
| contact sheet | `<ep>-<part>-review-N`; its sheets row `…-review-N-sheets`; per shot `…-review-N-shot-K` |
| frames (closer look) | `<ep>-<part>-frames-N-K` — run N, image K; a derive of the clip, `params: { op: "frame", shot, time, take, crop? }`, not in the sidecar |
| final / season | `<ep>-final-N` / `season-N` |

Numbers are never reused, failed ones included.

## Derived state (never stored)

Episode stage, as the rail shows it:

| Stage | Means | Rail (en / zh) |
|---|---|---|
| `draft` | no shots yet | To write / 待写 |
| `planned` | shots written; a part has no ready storyboard | Your call / 等你点头 |
| `boarded` | every part has a storyboard; a part has no take | Boarded / 故事板好了 |
| `shot` | every part has a take; a take has no contact sheet | Shot · unchecked / 已拍 · 未查 |
| `reviewed` | contact sheets exist, and either no final from the takes in effect or a cell of the cut still `unverified` | Shot / 已拍 |
| `done` | a ready final built from the takes in effect, and every shot × cast / group cell of that cut has a verdict | Finished / 成片 |

`status` reports a `reviewed` episode that has its final as "final built, not
done" with the count of unverified cells. While something generates, the rail
shows the busy form (Boarding, Shooting, Checking …). Lock states, bible
flags, stale shots, the take in effect, which clip each shot is judged on and
the check cells are computed by `series-state.mjs`, the same module the viewer
uses, so `status` and the viewer never disagree.
