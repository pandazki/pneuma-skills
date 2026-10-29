# NOTICE

This mode reproduces a method described by an upstream project and ports its
scripts. This file pins what we took, what we adapted, what we added and what
we dropped, and tracks the upstream version so future updates can be
diff-merged.

## Upstream

- **Name**: AI 动画单元剧 · AI Anime Series (10291124jcjc-dotcom/ai-anime-series),
  by 硅基废话 (X: @DDJCXX)
- **URL**: https://github.com/10291124jcjc-dotcom/ai-anime-series
- **License**: dual —
  - `scripts/` — MIT (text below)
  - everything else (`docs/`, `examples/`, `templates/`, `assets/`, `SKILL.md`,
    `README.md`) — Creative Commons Attribution-NonCommercial 4.0
    International (CC BY-NC 4.0),
    https://creativecommons.org/licenses/by-nc/4.0/legalcode
- **Version pinned**: commit `b750b5a8f8c7a8d5bc8ed47de22f6e84fa99fe6b`
  (2026-10-28, "README：首页放 30 秒成片")
- **Synced at**: 2026-10-29
- **Vendored**: nothing. No upstream file is copied into this repository.

Upstream is a Claude skill plus five Python scripts for a recurring-cast,
dialogue-free animated comedy series made storyboard-first on the Jimeng /
Dreamina canvas: one design sheet per character, one black-and-white sketch
grid per episode, and a Seedance omni-reference prompt timed to the second.
What it contributes is the **method**: the look written down once, sheets as
identity references, a storyboard that only fixes composition, prompts
assembled by a program, every clip sampled back.

## Two licences, two kinds of borrowing

**`scripts/` (MIT) — logic and wording ported.** The prompt assembly, timing
checks, grid arithmetic, clip sampling and joining were ported from Python to
Node ES modules (Node built-ins and ffmpeg, no Pillow). Where this mode sends
the same instruction to a model, its Chinese scaffolding sentences reuse the
upstream script's wording verbatim. Every ported file names the source in its
header, and `skill/scripts/LICENSE-ai-anime-series.txt` carries the MIT
notice beside them, so it travels with the scripts into every workspace the
skill is installed in. The notice is also reproduced below.

| This mode's file | Ports |
|---|---|
| `skill/scripts/prompts.mjs` | `make_prompts.py`: reference order, sheet / board / panel / video / re-shoot prompts, the Jimeng instruction and cut lines |
| `skill/scripts/prompt-locales.mjs` (`zh`) | `make_prompts.py`: its Chinese sentences, verbatim where the same instruction is sent |
| `skill/scripts/series-state.mjs` (timing, grids) | `make_prompts.py`: `check_parts`, `GRIDS`, `grid_of` |
| `skill/scripts/grid.mjs` | `grid.py split`: equal-division cell arithmetic |
| `skill/scripts/media.mjs` | `grid.py`, `review_clip.py`, `compile.py`: scene cuts, segment normalising, concat, replace, title cards, CJK fonts |
| `skill/scripts/series.mjs` | all five scripts' jobs as CLI verbs, `setup_check.py` included |

**`docs/`, `SKILL.md`, `README.md`, `templates/`, `examples/` (CC BY-NC 4.0)
— method only.** The method these files describe (rules for designing a cast,
the beat structure of an episode, timing and grid sizes, the order of
references, how to write a shot and its sound, the canvas workflow, the
pitfalls) is re-expressed in this mode's own words and with its own examples,
drawn from its own seed series. No text, characters, images or examples from
these files are copied into the skill, its scripts or the tests. The default
continuity lines `add-episode` writes are this mode's wording of the method's
rule, not the template's lines. The upstream example series (汤圆和油条) is
not shipped.

**The seed.** This mode's seed (光和牛马) is an original cast and story. Its
episode deliberately exercises the method's rules — an ability grown from the
body used twice, a group antagonist with a standout leader, an ending held on
a contrast. It was made through this mode's scripts: the sheets, storyboard
and clip it ships came from the exact text in `seed/guang-niuma/bible.json`
and `episodes/ep01/episode.json`, which `project.json` records as the prompts
sent. A few short phrases in that text derive from upstream's CC BY-NC
template and example. They are kept as written because they are the recorded
prompt of the shipped media; they are credited here (硅基废话, ai-anime-series,
commit `b750b5a8`, CC BY-NC 4.0) and are not offered under this repository's
MIT licence:

- `bible.json` `style`: its closing clause (the comedy genre and its two
  exclusions) — the closing clause of the template's `style`, with 默剧 and
  恐怖 added;
- `episodes/ep01/episode.json` `continuity`: the first line — the template's
  first continuity line, verbatim — and the second — the example's running
  direction line, with "镜头 3 到镜头 7" added;
- three short production cues: in `sheetStyle`, the run of soft shadows,
  plain white background and HD (the template's `sheet_style` without "8k");
  shot 4's flapping-and-tense-drum sound (the example's, with paper for
  wings); shot 9's closing trombone (the example's ending cue).

Nothing else in the seed is taken from upstream. Its other continuity lines,
its looks, shots, sounds, sheets, storyboards and clips are this mode's own.

## What we borrowed

| Pneuma file | Upstream source | Note |
|---|---|---|
| `skill/scripts/prompts.mjs` | `scripts/make_prompts.py` (MIT) | Port of the assembly: reference order (cast → groups with a sheet → scene sheet → storyboard last), grid by shot count, one timed entry and one sound line per panel, the storyboard-is-reference-only opener, continuity, "no dialogue", "no text" last; the sheet, board, single-panel, re-shoot (patch) and video prompts and their Jimeng instruction line + cut line. Additions are named in the file. |
| `skill/scripts/prompt-locales.mjs` (`zh`) | `scripts/make_prompts.py` (MIT) | The Chinese scaffolding reuses the script's sentences verbatim wherever the same instruction is sent: board and panel headers, video opener, character and group lines, style / 没有台词 / place, the 连贯要求 label, 镜头 / 音效 lines, the closing no-text line, the sheet, board and video canvas lines, the cut line, the grid names, the default expressions and poses. The `en` table is our translation; the sentences upstream does not have (named in the file's header) are ours. |
| `skill/scripts/series-state.mjs` (timing) | `make_prompts.py` `check_parts`, `GRIDS`, `grid_of` (MIT) | Every shot ≥ 2 s, a part ≤ 30 s, shots summing to duration ÷ parts, a warning past 5 s and for counts that make no tidy grid; the grid table with its near-square fallback. |
| `skill/scripts/grid.mjs` | `scripts/grid.py` `split` (MIT) | Equal-division cell arithmetic for a storyboard grid. |
| `skill/scripts/media.mjs` | `scripts/grid.py`, `review_clip.py`, `compile.py` (MIT) | Scene-cut detection at ffmpeg scene score 0.3; normalise every segment to the first one's size, stereo AAC, silence for silent clips, then a concat-demuxer join; replace [a, b) of a take with a patch; a 1.5 s black title card; CJK-first font list. Pillow steps re-done as ffmpeg filters. |
| `skill/scripts/series.mjs` | the five scripts (MIT) | The CLI verbs that carry their jobs: `prompts` (incl. `--shot n` for one panel and `--shots a-b` for a re-shoot), `review-episode`, `final`, `compile-season`, `init` (with the ffmpeg check), `add-episode`. |
| `skill/SKILL.md`, `skill/references/*.md` | `SKILL.md`, `README.md`, `docs/01–05` (CC BY-NC 4.0) | Method only, in our own words and examples (see above). |

## What we adapted

- **Generation**: upstream's "the user generates everything on the Jimeng
  canvas" → OpenRouter images and fal Seedance 2.5 called by `series.mjs`,
  each call recorded before it is sent and landed or failed after (the craft
  project file). The Jimeng / Dreamina canvas stays as the no-key copy-paste
  route: the same assembled prompts, with the canvas instruction line, and
  every returned file registered with `--upload`.
- **Files**: `series.json` / `episode.json` / a `ref` filename in `refs/` →
  `bible.json` / `episodes/<id>/episode.json` plus `project.json`, with sheets,
  boards and clips as asset ids that carry provenance and cost. The viewer
  writes the user's decisions into the two text files; only the scripts write
  `project.json`.
- **The record of what was shot**: `log.md` → each episode's `log`, gathered
  by `ideas-context` and the season overview. There is no second copy.
- **Candidates**: "make 4, keep 1" stays on the canvas; through the paid API
  it is two sheet candidates and one board per press, more on the user's yes.
- **Resolution**: "480p first, then upscale" → 480p first; there is no
  upscale endpoint here, so 720p is a new generation and is said to be one. A
  Jimeng upscale is registered as a new take.
- **The reference limit**: a hard error at 9 → Seedance's 30 for generation;
  the canvas's 9 (upstream's third-party figure) is a warning on the
  copy-paste variant, answered by describing a group in text or cutting
  supporting cast.
- **Clip review**: a frame every 0.5 s in rows of eight → a row of frames
  inside each shot on the take's own clock, with the episode's sheets on top,
  so every shot × character or group is a recorded verdict (`ok | drift |
  absent | unverified`) and no frame straddles a cut. Density drops to about
  one frame a second at the default; `--frames 5` or more restores it. Fewer
  scene cuts than panels still means merged panels, and the joins between
  shots are still checked by eye.
- **Fixing a panel**: split → replace → re-grid → the redrawn panel is
  composited into its equal-division cell, with the current board attached as
  its style reference (image 1). On the canvas the panel's instruction line
  therefore lists the board node first, then the sheets, and the new board
  goes back on the canvas, as upstream's "drag it back" step. A wrong panel
  count is a new board.
- **Re-shooting a span**: "under 4 s, take a neighbour and cut it later" plus
  `compile.py replace` → the span is widened automatically, only a–b is
  spliced back, and splice points snap to the clips' own cuts. Upstream's
  condition that both ends be hard cuts is checked: `patch-range` (and the
  span's Jimeng prompt) warns when an end has no cut in the take within 0.5 s.
- **Joining**: `compile.py concat` for the two halves of a 60 s episode →
  `final` (parts plus patches); for a season → `compile-season` with title
  cards. Segments keep the first clip's frame rate (Seedance renders 24)
  instead of 30 fps, so no clip is resampled to a rate none of them has.
- **Sheets**: a faceless silhouette, no explanatory text, poses separated so
  one pose stays one; group poses come from the card with an optional leader
  panel; scene sheets use the scene's own time and are drawn after the cast,
  whose sheets go along as style-only references.
- **Wide images**: `grid.py rewrap` → a check. Sheets and boards this mode
  draws are inside the 0.4–2.5 reference range by construction; an uploaded
  one outside it is registered with a warning that names the fix (lay a sheet
  out in rows, redraw a board at the series ratio). It is a warning, not a
  refusal, because the limit is the canvas's and Seedance's is only reported
  to be the same.
- **Language**: "speak Chinese to the user" → the user's language; the
  prompt scaffolding follows the bible's language (`set-series --lang`).
- **Setup**: `setup_check.py` (Python, ffmpeg, Pillow; folders; templates) →
  `init` and `add-episode`; Node built-ins and ffmpeg only. `init` and
  `status` say whether ffmpeg and ffprobe are installed, with the install
  command, before any paid step.
- **Rules for the user**: original characters only, formats borrowed but never
  designs, shots or footage, and a published episode labelled AI-generated —
  kept, in this mode's words, in the skill's core rules.

## What we added

Bible locks and versions with per-field flags on the episodes that consumed a
changed field; the lineup probe; recorded verdicts, lost beats and accepted
drifts; `markings` and scene `rules`; the craft project file
(`modes/_shared/scripts/craft-project*.mjs`) with billing-unknown failures and
retry landing; and the viewer — cast wall, episode desk with the shot strip,
season rail, binge — with its address vocabulary and actions.

## What we dropped

- **The example series** (汤圆和油条: sheets, storyboard, prompts, episode,
  log, demo video) — CC BY-NC content; the mode ships its own seed.
- **The template's wording** (`templates/series.json`, `templates/episode.json`)
  — CC BY-NC text; `init` starts with an empty style and `add-episode` writes
  continuity lines in this mode's own words.
- **Combining supporting characters' sheets into one image** (`grid.py grid`)
  to stay under the canvas's reference limit — every reference stays one
  identity, because the review rows, the check cells and the lineup compare
  against one sheet per character or group.
- **"1:1 also fine" for the storyboard** — the strip crops each equal cell to
  the series' frame and a redrawn panel is drawn at the series ratio, so a
  board of another ratio would lose the edges of its panels.
- **`JIMENG_MAX_REFS`** — the canvas limit is a warning here, so it needs no
  override.
- **`grid.py rewrap`** — replaced by the upload check above; nothing this
  mode draws needs re-laying out.
- **Python, Pillow, Chinese file names** (`设定_XX.txt`, `1_故事板.txt`) and
  **git-clone installation** — replaced by the mode's Node scripts, English
  file slugs and Pneuma's installer.
- **Reviewing an arbitrary clip path** — every clip is registered first.
- **"Your own licensed music"** — Seedance generates the soundtrack from each
  shot's `sfx` and there is no import path; the rule against commercial songs
  stays.

## License excerpts

`scripts/` of the upstream repository (also in
`skill/scripts/LICENSE-ai-anime-series.txt`):

```
MIT License

Copyright (c) 2026 硅基废话 (10291124jcjc-dotcom)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Everything else upstream: Copyright (c) 2026 硅基废话 (10291124jcjc-dotcom),
licensed CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/legalcode).
This mode copies none of that material into its skill, scripts or tests and
credits it as the source of the method; the seed's few derived phrases are
listed above.
