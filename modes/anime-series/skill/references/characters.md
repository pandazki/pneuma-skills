# Designing the cast

The cast is the part of a series that carries over: each episode's story is
used once, the characters return every time. The bible card is also what
every prompt quotes, so a card is a design brief for a model as much as a
character for a viewer.

## What a series cast needs

| Quality | Why | How to test it |
|---|---|---|
| **Silhouettes that differ at a glance** — round vs long, tall vs short, wide vs thin | A video model merges two similar bodies into one; a viewer at phone size tells them apart by outline | Picture both as black shapes at thumbnail size. Can you name each? |
| **One main colour each, accessories in a contrasting one** | Colour is the second identity cue after shape and the first thing to drift | No two leads share a main hue |
| **One signature ability that grows out of the body** | The gags come from it. The seed's flame turns into light: a torch beam, an arch to cross on, a shower of sparks that slips through a gap. Its ox carries anything: it flattens and takes ten times its height on its back | Can you list five different uses in ordinary places? If not, pick another trait |
| **A one-line personality** | The same ability used by a coward and by a show-off is two different jokes | One sentence, two traits that pull against each other |
| **A short name** (two or three syllables; food and objects work well) | It goes on every sheet and in every prompt; a short name reads in a caption | Say it aloud |
| **A recurring opposition** | A group of identical antagonists (a flock, a swarm, a stack of notes) is one **group** card; one member may stand out — bigger, another colour — as its `leader` | The group reads as one design in five poses |

Keep an episode's cast to three or four. Every cast member is one more
reference image and one more column of checks.

Original characters only: no real people, no existing anime, mascots, brand
characters or another creator's cast. Learn formats from others, never
designs, shots or footage: an uploaded sheet or board is the user's own work.

## Writing `look`

`look` is quoted verbatim into every storyboard and clip prompt. Write it once,
in the user's language, in this order: what it is and its overall shape;
size relative to the other leads; colours (with the material that carries
them); the face; accessories and markings; what it does **not** have.

**Lessons from drawing the seed cast** (30 sheet images, six rounds):

- **Name what is absent.** "No arms; exactly four short round feet under the
  body" gave no arms in nine candidates out of nine. A feature left unspoken is
  a feature the model may add.
- **Bound every additive adjective.** "A few faint sparkles inside" became a
  galaxy; "mane falling down the back" became a wig; "light grey-blue" drifted
  to lavender. Bound them: *very faint*, *short*, *only reaching the upper
  back*, *bluish*. 用「很淡」「短短的」「只到…」「偏蓝的」 rather than bare adjectives.
- **A brand colour on a glowing body needs a material sentence.** A hex code
  alone let the bright core wash an orange body to amber. Saying the shell is
  a saturated orange, that only a small core is brighter, and that the whole
  must not fade to pale yellow moved it back. Judge colour by sampling pixels,
  not by eye: the eye adapts to glow.

  ```bash
  # mean colour of a 16×16 patch at x=512, y=300 of a sheet
  ffmpeg -v error -i refs/char-guang-sheet-2.webp -vf "crop=16:16:512:300,scale=1:1" \
    -f rawvideo -pix_fmt rgb24 - | od -An -tu1
  ```

- **Write down what the model reliably draws, instead of fighting it.** A
  lanyard on a neckless body came back as a band around the body every time,
  so the look says a band. A flame tip that pointed the same way in every
  turnaround view became "the tip sways with motion", which also stops a drift
  check from failing on it. A tail the model added unasked in four of four
  candidates, and the user liked, went into the look so it stays.
- **Ask what a stranger would call it.** A seed design passed a
  feature-by-feature check against its look and was still rejected by the user
  as the wrong animal: cues that were each harmless (a wide flat body, small
  eyes, a bristly mane, short horns) added up to another species. The fix was
  cues only the intended animal has, plus an explicit "not a <the animal it
  was mistaken for>, no <that animal's tell>" in the look; one later
  candidate still slid back through a single colour choice. Run this test on
  every sheet of a stylised animal. The current design is in `bible.json`.
- **Shared material travels as words.** "The same translucent jelly material
  as 光" gave the intended see-through spirit; attaching 光's sheet as a
  reference made the new character darker and more opaque. Use another
  character's sheet as a reference for a *scene's* style only.

## Ability, personality, expressions, poses

- `ability` and `personality` never reach a model; they are for you and the
  user when writing episodes. Edits to them mark the card as edited but do not
  flag finished episodes.
- `expressions` and `poses` feed the sheet prompt (defaults are used when
  empty). Put one or two **ability poses** in `poses`, so the sheet draws them
  before any clip needs them.
- **Write an ability pose as body geometry, not as a noun.** "Turns into a
  light bridge" came out as a comet streak; "the body stretches into an arch
  of light, both ends on the ground, the face at the top of the arch" came out
  as an arch in seven candidates of seven. Use the same wording later in shot
  descriptions.
- One pose per list item (one `--pose` flag each). Inside a pose, use
  parentheses for detail, not commas or 、 — the sheet prompt separates poses
  with semicolons, and an enumeration comma inside one pose split it into
  several.

## Markings, palette, groups, scenes

- `markings` is text that belongs to a character or group and must stay in
  frame (a label printed on the villain). The clip prompt's closing "no text in
  frame" line names it as the one exception. `set-character` / `set-group
  --markings "…"` sets it; `--markings ""` removes it.
- `palette` is for the wall only and never reaches a model. Sample it from the
  picked sheet so it records what the sheet shows; it is not a design input
  (`--palette <css>` or `--palette 外壳=#fc8028`, one flag per colour).
- A **group** card has `look`, an optional `leader` (drawn as its own large
  panel on the group sheet) and `poses`; its sheet is 16:9. A group without a
  sheet is described in text in every prompt (`set-group --leader "…"
  --pose …`).
- A **scene** card has `look` and `time` (`set-scene --time "…"`; an episode
  without its own `time` uses the scene's). Write the furniture, the
  light and the mood, and say what is *not* there: in a world of living
  objects, a mug or lamp with a face is a false character for the video model
  (two scene candidates grew face mugs until the look said "no props with
  faces"). Leave out clock numbers, signs and labels.
- Draw scenes **after** the cast sheets are picked. `make-sheets --scene`
  attaches the picked character sheets as style-only references. Four
  text-only office scenes came out as architectural renders; with the cast
  sheets attached, three of three came out in the cast's toy world with no
  character leaking in.

## The style card

- `style` goes into every clip prompt and every scene sheet. Describe the whole
  world — characters and sets — as one idiom, and say what it is not ("not an
  architectural render, not a photo"; "no realistic humans, no horror").
- `sheetStyle` goes into every character and group sheet: the render idiom,
  a plain white background, and "every view keeps the same shape, proportions
  and accessories".
- Materials carry style when the characters have no fur, cloth or limbs to do
  it. A rounded, low-detail world (soft toy, jelly, clay) gives a video model
  fewer surfaces to drift on than fur or painterly 2D.
- `ratio` must be one Seedance renders: 16:9, 9:16, 4:3, 3:4, 1:1 or 21:9
  (`init` and `set-series` refuse any other). Set it before the first sheet:
  boards and scene sheets are drawn at it.
- `lang` (`set-series --lang en|zh|auto`) is the language of the prompt
  scaffolding. `auto`, the default, follows the bible's own text; pin it only
  when the text is mixed and the scripts guess wrong (`prompts` prints the
  language it used). It is not covered by locks.
- `dialogue` is false by default; `episodes.md` says why and what to do
  before turning it on.

## Sheets

- `make-sheets --character <id>` draws two candidates (`--count`) at 1:1,
  `--quality high`. **Model:** Flare is the default; for character and group
  sheets offer `--model sunburst`. In the seed rounds both cost about $0.055 an
  image, and Sunburst drew cleaner labelled grids, stronger expressions and
  amplified stray adjectives less. Say which you used.
- The sheet prompt asks for a turnaround (front, side, back), the expressions,
  the poses and a faceless silhouette, the name in the corner, and no other
  explanatory text (one candidate grew a paragraph of notes before that line
  was added).
- `make-sheets --missing` draws every character without a picked sheet.
  `--pick` (with `--count 1`) picks the result directly — only when the user
  said so.
- What to check is in `review.md`. A sheet also shows gags: an unprompted
  detail the user likes (a little soul escaping a deflated body) can be
  promoted into `poses` or `ability`.
- **Before the first clip, a lineup.** `lineup` draws the picked character
  sheets side by side at one scale (Sunburst with references, ≈ $0.05). It is
  the cheapest test of what the clip has to do: hold several identities, one
  material and the size relation at once. In the seed rounds both lineups
  held all three; that is the pass to have before $6 of video. `review.md`
  says what to look at.

## Locks and versions

- **Lock** appends a version to `bible.json` `locks[]` with a hash of every
  field. The user presses Lock on the wall, or you run `series.mjs lock` when
  they ask. Nothing changed since the last lock means no new version.
- A card is `unlocked` (never covered by a lock), `locked`, or `edited` (with
  the fields that changed). Re-picking a sheet is an edit.
- An episode records the bible it was shot under. It is **flagged** only when
  something its clip actually consumed changed: the style's `style`, `ratio` or
  `dialogue`; a cast member's or group's `name`, `look`, `markings`, `leader` or
  `sheet`; its scene's `name`, `look`, `time` or `sheet`. Rewording a
  personality flags nothing; changing one lead's look flags only the episodes
  that lead is in.
- A flag blocks nothing. The user re-shoots the episode or presses "Got it"
  (`pick --episode <id> --acknowledge`), which quiets it at the current version.
- `status` lists a picked sheet that predates the card's current text
  ("sheet predates: look") — the sheet no longer shows what the card says;
  offer new candidates.
