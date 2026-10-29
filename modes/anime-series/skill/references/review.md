# Checking: sheets, lineups, storyboards, clips

A check is something you looked at. Every verdict names the picture it came
from; what you did not open stays `unverified`, and the viewer draws it grey,
never green.

## Design sheets

`check-sheets --character <id>` (or `--group`, `--scene`) tiles every ready
candidate side by side into `refs/compare/char-<id>-compare-N.jpg` (`group-…`,
`scene-…`), numbered left to right, and prints the card's `look` beside the earlier verdicts. Open
it, then `navigate-to { "character": "<id>", "candidate": "<asset>" }` and
`capture` each candidate as the user sees it in the drawer.

Check each candidate for:

- **Turnaround agreement**: front, side and back show the same shape, the same
  accessories on the same side, the same proportions.
- **Anatomy**: no extra, missing or fused limbs. Count feet, horns, ears. A row
  of feet seen from the front can read as extra legs; that is a reject.
- **The written look**: every colour, accessory and marking the card names,
  nothing the card excludes. Sample colours by pixel (`characters.md`); a
  glowing body fools the eye.
- **The stranger test**: what would someone who never read the card call this
  creature? A sheet can pass every feature and still read as the wrong animal.
- **Layout**: the faceless silhouette has no face, no paragraph of notes or
  callout bubbles, the name in the corner. Small captions often come out as
  nonsense letters; leave them, since the clip prompt keeps all text out of
  the frame. The name label is different: a sheet that names the character
  wrongly gets redrawn.
- **Gags**: an unprompted detail worth keeping. Point it out.

Record each: `verdict --sheet <asset> --verdict ok|drift --note "…"`.
Recommend one and say why; the user picks it ("Use this one") or tells you to
(`pick --character <id> --sheet <asset>`).

## The lineup, before the first clip

`lineup` (default: every character with a picked sheet; `--character a,b` for
some) draws the picked sheets side by side at one scale on one image,
`refs/lineup-N.png` — about $0.05, and the same job Seedance's references must
do: hold several identities at once. Open it and check that every character
keeps its sheet's features, that they share the series' material, and that
the sizes match what the looks say (who is taller, who is wider). A wrong
lineup is fixed in the sheets or the looks, before any video spend. The seed
cast's lineups held identity, material and scale on the first try.

## The storyboard

Open the board PNG (`episodes/<id>/boards/<part>-<n>.png`) and check:

- **The grid**: exactly the shot count, on an **even** rows × columns grid. The
  strip and `redo-panel` cut the board into equal cells; uneven gutters show
  up as panels cut in half on the strip and a redrawn panel pasted over the
  wrong area.
- **Numbers**: each panel numbered in its top-left corner, in reading order.
- **Black-and-white pencil, no colour, no detailed background.** A coloured
  board gets copied into the clip, grid and all.
- **Each panel shows its shot**: the action and the result, the framing the
  camera word asks for, the characters recognisable by silhouette.

Then `navigate-to { "episode": "<id>", "shot": 1, "lane": "board" }` and
`capture` the desk to see the strip as the user does. One bad panel: redraw it
(`redo-panel`). A bad grid: a new board.

## The clip

`review-episode --episode <id>` samples the take in effect into
`episodes/<id>/review/<part>-<n>/`:

- `sheets.jpg`: the picked sheets of the episode's cast and groups, once, large;
- `shot-NN.jpg`: one row per shot, `--frames` (default 3) frames from inside
  that shot's span on the take's own clock, each labelled with its second.
  The upstream method samples every half second regardless of shots; a row
  per shot is one shot's verdicts and no frame straddles a cut, at the cost
  of density (about one frame a second at the default). For fast action pass
  `--frames 5` or more;
- `overview.jpg`: the sheets row with every shot row stacked under it.

It prints the clip's size, length and whether it has audio; the scene cuts it
detected against the shot boundaries the board planned (far fewer cuts than
boundaries means shots were merged or skipped); and, per shot, **who the
shot's words name** — the characters and groups you should expect to find.

Open the sheets and every row, and judge each shot × cast member and group:

| Look at | Typical drift |
|---|---|
| Silhouette and proportions | a round body stretched tall; the size relation between the leads flipped |
| Colour | a saturated body washed out by its own glow; a hue sliding toward a neighbour's |
| Accessories and markings | a horn, a badge, a band missing or moved to the other side |
| Limbs and features | limbs the card says it has none of; an extra eye; a mouth on a face that has none |
| Material and style | a toy-like character turned photoreal; the set turned into an architectural render |
| A group | members that stopped matching each other; the leader lost its size, colour or label |

and, for the shot rather than the character:

- the shot's action and result actually happen, in the stated direction;
- no storyboard grid, panel number or sketch pasted into the frame;
- no subtitles, captions or invented signs (beyond the card's `markings`);
- the place stays the same place;
- the joins hold: the shot picks up the motion where the previous shot left
  it, and the episode's `continuity` lines are kept (running direction, the
  carried object, no camera jump inside one tracking shot). Compare the last
  frame of one row with the first of the next. Joins have no verdict cells,
  so report a break in chat; it is a reason to re-shoot the span.

### A closer look: `frames`

A contact row shows three moments of a shot, 240 px high. When that is not
enough (a badge too small to read, spots that may or may not be there, a
pose that falls between two frames), do not guess and do not run ffmpeg
yourself. Ask `series.mjs`:

```bash
# six frames from inside shot 6, at the clip's own size
node "<SKILL_DIR>/scripts/series.mjs" frames --episode ep02 --shot 6
# the two moments you saw on the strip, left 40 % from 40 % down, enlarged
node "<SKILL_DIR>/scripts/series.mjs" frames --episode ep02 --shot 6 \
  --seconds 12.4,13.8 --crop 0,0.4,0.4,0.6
```

- The frames come from the clip the shot is **judged on**: the patch spliced
  over it, else the take in effect, exactly the clip the verdict will be
  recorded on (`--take` names another). `--seconds` are on that clip's own
  clock, as the strip labels them, and must fall inside the shot.
- `--count k` (default 6, at most 24) spreads frames over the shot the way the
  contact strip does; `--count 3` gives the strip's own seconds at full size.
- `--crop x,y,w,h` is a box in fractions of the frame. It is enlarged to fit
  the frame, at most 4×. Bigger pixels are not more detail: when a close-up
  is too blurred to tell, the cell stays `unverified`.
- Each run writes `episodes/<id>/review/<part>-frames-<n>/` and records every
  image as a free derive asset of the clip. Open them; the chat shows them to
  the user as well. The contact sheet of record is not touched.

Every picture you look at comes from `series.mjs` and stays inside the
workspace. A frame written to `/tmp` cannot be shown in the chat or the viewer
(the user sees a broken image) and has no provenance.

### Recording verdicts

```bash
node "<SKILL_DIR>/scripts/series.mjs" verdict --episode ep01 --shot 7 \
  --character guang --verdict drift --note "光的外壳从橙色变成了浅黄"
node "<SKILL_DIR>/scripts/series.mjs" verdict --episode ep01 --shot 4-6 \
  --group stickies --verdict ok --note "头目的大小、红色和「紧急」都在"
```

- `ok` — seen in this shot's frames, and it matches the sheet.
- `drift` — seen, and it does not match; the note says what is wrong
  (required).
- `absent` — not in this shot's frames. Where the shot's words name them, that
  is a **lost beat**: `status` lists it separately, and it is usually a reason
  to re-shoot the span (the model merged or skipped the panel). Where the
  words do not name them, it is simply correct.
- `unverified` — not judged (or the frames cannot show it: motion blur, too
  small). Before giving up, `frames` (more frames of that shot at full size,
  or a close-up); `review-episode --frames 5` resamples every shot.

`--character a,b` and `--group a,b` record the same verdict on several cells;
`--shot a-b` on several shots. Scenes have no cells; mention a broken set in
chat. `status --episode <id>` prints every cell shot by shot, with `*` where
the shot's words name that entity.

**Done means judged, not perfect.** The episode's stage stays `reviewed` — and
`final` says "built, not done" — until every shot × cast / group cell of the
cut in effect has a verdict. A drift is a verdict: an episode can be done with
a drift the user has not decided on, and it stays visible on the strip and the
wall. Say so when you report it finished.

### Known false alarms

A feature the bible says varies is not a drift: a flame tip "that sways with
motion" may point either way. A sheet detail the card never mentions is not a
requirement. Mid-motion squash and stretch on a fast shot is animation,
unless the frames on either side show the wrong design too.

## After a drift

`navigate-to { "episode": "<id>", "shot": <n>, "check": "<character id>" }` (a
group's key is `group:<id>`) opens the drift compare: the sheet beside that
shot's frames. `capture` it, say in one sentence what is wrong, and give the
two choices:

- **Re-shoot the span** — `patch-range` (at least 4 s, priced by the seconds
  sent). First consider whether the shot's words caused it (an ability written
  differently from the sheet's pose, two actions in one shot) and fix them.
  A patch splices cleanly only where the take cuts: check that
  `review-episode` found a cut at both ends of the span (`patch-range` warns
  when an end has none within 0.5 s). If an end falls inside one continuous
  shot, widen the span to the nearest cut or re-shoot the part.
- **Accept it** — the user's decision: "Accept it as it is" in the drift
  compare, or `pick --episode <id> --accept-drift --shot <n> --character <id>`
  (or `--group <id>`) on their word. It is recorded on the clip the shot is
  judged on and stays visible as accepted.

When the ending or a later beat depends on the change, re-shoot the part.

## After a patch

Once a patch is applied (the final splices it in), the shots it covers are
judged **on the patch**: the take's verdicts for those shots no longer count,
because the frames are different.

1. `review-episode --episode <id> --take <patch asset>` samples only the shots
   the patch splices back, on the patch's own clock.
2. `verdict --episode <id> --shot <n> --character …` on a patched shot records
   on the patch by itself (`--take <take>` to judge the take instead).
3. Watch the join through the viewer too: `navigate-to { "episode": "<id>",
   "time": <start> }`, `play` with `from` and `to`, `capture`. `final` moves
   each join to a scene cut it finds within 0.5 s of the planned boundary and
   prints the move; start watching there.

## The bible flag

An episode whose clip consumed a card field that has changed since is flagged
("shot under v1 — 光 changed: look"). Show the user which field changed and
which shots that character is in. The choices are the user's: re-shoot the
episode, or "Got it" (`pick --episode <id> --acknowledge`).
