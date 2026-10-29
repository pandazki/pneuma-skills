# The copy-paste route: Jimeng / Dreamina

Without an OpenRouter key (images) or a fal key (video), the user can make the
same pictures and clips in the Jimeng canvas (Dreamina outside China) from the
prompts the scripts assemble, and you register each file they bring back.
After `--upload` everything works as usual: the wall, the strip, the stamps,
`review-episode`, `final`. The two routes mix freely — sheets here, clips in
Jimeng, or the reverse.

Jimeng spend is not recorded: an upload has no price. Say so when you quote
what the season cost.

## How the canvas works

Every image on a Jimeng canvas is a node. Selecting nodes before generating
attaches them as references, numbered in the order they were selected. Each
copy-ready prompt starts with a bracketed instruction line for the user —
which nodes to select and in what order, the ratio, the length, how many to
make, and the `series.mjs … --upload` command that registers the result — then
a cut line; everything below the cut line is pasted as is.

The instruction line and the cut line are in the bible's language, like the
prompt itself. For a Chinese bible they read like this:

```
【即梦画布｜视频生成｜Seedance 2.5 全能参考｜框选节点：@图1 光设定图、@图2 …、@图5 故事板｜16:9｜8 秒｜先 480p，满意再超清｜补拍第 A 段镜头 5–6】
———————— 以下整段复制 ————————
```

Relay them to the user as written; do not translate them back.

## Sheets

```bash
node "<SKILL_DIR>/scripts/series.mjs" prompts --sheets --target jimeng --write          # every card
node "<SKILL_DIR>/scripts/series.mjs" prompts --sheets --character guang --target jimeng
```

`--write` saves one text file per card in `prompts/sheet-<kind>-<id>.txt`. The
user generates four at the given ratio, keeps the best, and downloads it.
Scene prompts ask them to select the picked character sheet nodes as style
references. Register the file:

```bash
node "<SKILL_DIR>/scripts/series.mjs" make-sheets --character guang --upload <file> [--pick]
```

The first sheet uploaded for a card with no sheet is picked automatically;
`--pick` picks a later one. Then `check-sheets` as usual. Tell the user to keep
every sheet node on the canvas: they select them again for every episode.

**The lineup** works the same way: `lineup --dry-run` prints its prompt and the
sheets to select; register the image with `lineup --upload <file>`.

## Storyboard and clip

```bash
node "<SKILL_DIR>/scripts/series.mjs" prompts --episode ep01 --target jimeng --write
```

writes `episodes/ep01/prompts/jimeng-storyboard-a.txt` and
`jimeng-video-a.txt` (one pair per part; also the fal variants
`storyboard-a.txt`, `video-a.txt`).

- **Storyboard**: select the episode's sheet nodes, image generation, paste,
  make four, keep the one with the right panel count, numbering and actions.
  Generate it at the ratio the line gives, which is the series ratio: the
  strip crops each equal cell to the clip's frame and a redrawn panel is
  drawn at that ratio, so a board at another ratio loses the edges of its
  panels. Register with `shoot-board --episode ep01 --part A --upload <file>`.
- **Clip**: select the nodes in the order the instruction line lists (cast
  sheets, group and scene sheets, the storyboard last), video generation,
  Seedance 2.5 with omni-reference, the listed duration, **480p**. Paste.
  Register with `shoot-video --episode ep01 --part A --upload <file>`, then
  route 5.
- `--part` is required with `--upload` on a 60 s episode: each part has its
  own storyboard and its own clip.

In Jimeng the references are written `@图1 … @图N`; in the fal variant
`@Image1 … @ImageN`. The order is the same: cast in episode order, groups with
a sheet, the scene sheet, the storyboard always last.

**The Jimeng canvas takes at most 9 references** — the upstream method's
figure, from third-party reports; check the canvas's current limit (the
warning does not block). `prompts` warns when a part needs more. Drop a
group's sheet so it is described in text (`pick --group <id> --sheet none`,
with the user's agreement — it is a bible edit and the user re-locks), or cut
supporting cast. Do not combine several supporting sheets into one image to
save slots: the review rows, the check cells and the lineup compare each
character or group with its own sheet, so a reference holds one identity.

**An uploaded sheet or board must be 0.4–2.5 wide to 1 high.** The canvas
refuses wider images (a four-view turnaround laid out in one row), and
`--upload` warns. Lay a sheet out again in rows; draw a board again at the
series ratio.

## One panel, one span

- **A panel**: `prompts --episode ep01 --shot 6 --target jimeng [--write]`
  prints the single-panel prompt with its instruction line; `--write` saves
  `episodes/ep01/prompts/jimeng-panel-a-6.txt`. The line lists the nodes in
  order: the current storyboard first (image 1, the style the panel must
  match), then the sheets. Select them in that order — the prompt calls the
  board image 1 and the first sheet image 2, so any other order misnumbers
  every reference. Make four, keep the one that matches its neighbours, and
  register it with `redo-panel --episode ep01 --shot 6 --upload <file>`,
  which composites it into a new storyboard and prints its file
  (`episodes/ep01/boards/a-<n>.png`). Have the user drag that file onto the
  canvas: the clip must select the new storyboard node, not the old one.
- **A span**: `prompts --episode ep01 --shots 5-6 --target jimeng [--write]`
  prints the re-shoot's Jimeng prompt with its instruction line — the nodes in
  order, the seconds to render (at least 4; a short span borrows its
  neighbours) — and records nothing. Like `patch-range`, it warns when an end
  of the span is not on a cut the take has (the splice would show as a jump;
  SKILL.md route 7). `--write` saves
  `episodes/ep01/prompts/jimeng-patch-a-5-6.txt`. Register the clip with
  `patch-range --episode ep01 --shots 5-6 --upload <file>`; the final is
  rebuilt and the patched shots are judged on the patch.

## Higher resolution

Jimeng can upscale a clip the user already likes, which keeps the picture.
Register the upscaled file as a new take (`shoot-video … --upload`) and pick it
(`pick --episode ep01 --part A --take <asset>`, or "Use" in the takes list).
Inside this workspace there is no upscale: a 720p generation is a new take.

## Where the files come from

A file the user attaches in chat lands in `.pneuma/uploads/`; a file they
downloaded elsewhere, they give you the path. `--upload` copies it to its slot
(`refs/`, `episodes/<id>/boards/`, `takes/`, `panels/`, `patches/`) and records
it as an upload by the user; never copy files into those folders yourself.
