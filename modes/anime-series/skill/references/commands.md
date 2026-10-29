# series.mjs commands

Run as `node "<SKILL_DIR>/scripts/series.mjs" <command> [flags]` from the
workspace. `--help` is the authoritative flag list (`series.mjs <command>
--help` prints one command's); this file says what each command is for, what
it writes and when it refuses.

Common flags: `--dir <workspace>` (default: the current directory), `--json`
(one object on stdout; notes and warnings go to stderr), `--at <epoch ms>`
(pins timestamps), `--dry-run` on every paid command (prints the exact request
with each attached file named, plus the price; sends and records nothing).

A refused command prints one `ERROR:` line naming the rule and exits 1 with
nothing written. A paid call that fails is still recorded, as `failed` with its
reason and whether it may have been billed; the command exits non-zero.

## Setup and the bible

| Command | Use it to |
|---|---|
| `init [--title] [--ratio 16:9]` | create `bible.json`, `project.json`, `refs/`, `episodes/` in an empty workspace; keeps files that exist and refuses another mode's `project.json`. A ratio Seedance 2.5 cannot render is refused (allowed: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16). Says whether ffmpeg and ffprobe are on PATH (with the install command when not) and whether ffmpeg has drawtext |
| `set-series [--title] [--ratio] [--dialogue true\|false] [--style] [--sheet-style] [--lang en\|zh\|auto]` | the style card. `--lang` pins the language the prompt scaffolding is written in; `auto` (the default) follows the bible's own text |
| `set-character --id <id> [--name --look --ability --personality --markings] [--palette <css>\|<label>=<css>]… [--expression <e>]… [--pose <p>]… [--alias <name>]… [--not-name <word>]…` | add or amend a character; repeated flags replace the whole list; `--markings ""` removes it. `--alias` adds another name the shot text uses for it; `--not-name` lists words that contain its name without meaning it (光 already excludes 灯光, 蓝光 and the like). Prints the card's lock state afterwards |
| `set-group --id <id> [--name --look --leader --markings] [--palette <css>\|<label>=<css>]… [--pose <p>]… [--alias <name>]… [--not-name <word>]…` · `set-scene --id <id> [--name --look --time --rules]` | add or amend a group or a scene. A group with a `leader` is also named by "leader" / 头目. `--rules` is the set's short constraints ("the clock face has no numbers"); they reach the scene sheet, every board and panel and the clip, with any clause of the look that states one ("no …", 没有…). A flag that does not belong to the card is refused |
| `lock` | append the next version to `locks[]` — only when the user asks. "Nothing changed since vN" makes no new lock |
| `pick --character\|--group\|--scene <id> --sheet <asset\|none>` | use a ready candidate as the card's sheet (the user's choice); `none` clears it |
| `pick --episode <id> [--part P] --storyboard <asset>` · `--take <asset>` | use a ready board or take for that part instead of the newest |
| `pick --episode <id> [--part P] --accept-drift --shot <n> --character <id>[,…] \| --group <id> [--take <take\|patch>]` | keep a recorded drift (the user's decision) on the clip the shot is judged on — the patch spliced over it, else the take; refused unless the cell is a drift |
| `pick --episode <id> --acknowledge` | quiet the episode's bible flag at the current version (the user's decision) |

## Episodes

| Command | Use it to |
|---|---|
| `add-episode [--episode epNN] --title <t> [--duration 30] [--cast a,b] [--groups g] [--scene s] [--time <t>] [--continuity <line>]… [--shots-file <file\|->] [--force]` | write a new episode; without shots it is a draft. Without `--continuity` it gets two default lines in the bible's language (each shot picks up the last one's motion; one running direction); `--continuity ""` writes none. Refuses broken timing, unknown ids and an existing episode (unless `--force`) |
| `set-episode --episode <id> [same flags]` | change the setup or replace the shot list |
| `set-shot --episode <id> [--part P] --shot <n> [--desc] [--sfx] [--sketch] [--dur <s> [--from both\|next\|prev]]` | change one shot; `--dur` moves the difference to its neighbours; `--sketch ""` removes the sketch |
| `log --episode <id> [--goal] [--used <ability>]… [--ending] [--location]` | record what a finished episode used |
| `ideas-context` | places, goals, abilities and endings already used, and which episodes are not logged |

`--shots-file` takes a list of shots (one part), a list of lists (one per
part) or `{ "parts": [{ "shots": [...] }] }`; each shot is `{ dur, desc, sfx?,
sketch? }`.

## Prompts, money, state

| Command | Use it to |
|---|---|
| `prompts --episode <id> [--part P] [--target seedance\|jimeng\|all] [--write]` | show the storyboard and clip prompts exactly as they will be sent, the reference list (`@Image1 光, … @Image5 storyboard`), the grid and the seconds. Records the assembled prompts in the sidecar (only when they changed) so the viewer shows the same text; `--write` also saves copy-ready files under `episodes/<id>/prompts/` |
| `prompts --episode <id> [--part P] --shots a-b [--target seedance\|jimeng\|all] [--write]` | a re-shoot's prompts (Seedance and the Jimeng form); records nothing; warns, as `patch-range` does, when an end of the span is not on a cut the take has; `--write` saves `patch-<part>-<a>-<b>.txt` and `jimeng-patch-…` |
| `prompts --episode <id> [--part P] --shot <n> [--target seedance\|jimeng\|all] [--write]` | one panel's redraw prompt and its Jimeng form, whose canvas line lists the nodes in the prompt's numbering — the board in effect first (named by its file), then the sheets — and the `redo-panel --upload` command. Needs a ready board; records nothing; `--write` saves `panel-<part>-<n>.txt` and `jimeng-panel-…` |
| `prompts --sheets [--character\|--group\|--scene <id>] [--target jimeng] [--write]` | the sheet prompts, or their Jimeng form; `--write` saves `prompts/sheet-<kind>-<id>.txt` |
| `estimate --episode <id> [--part P] [--what all\|board\|panel\|video] [--shots a-b] [--resolution 480p] [--model flare\|sunburst] [--quality high]` | price a storyboard, a redrawn panel, a clip or a re-shoot span, with the model the paid command would use; the total is labelled an estimate, and reads "unpriced" rather than "$0" when nothing has a price |
| `estimate --sheets [--character …] [--count 2] [--model …]` · `estimate --lineup [--character a,b]` | price sheets or a lineup |
| `status [--episode <id>]` | the whole series: whether ffmpeg/ffprobe are installed, bible version and edits, each card's lock, sheet and candidates, each episode's stage, board and take in effect, stale shots, bible flags, checks (ok, drift, absent, unverified) and lost beats, patches, what is generating, failures, spend. With `--episode`, that episode shot by shot: its seconds, words, staleness and every cast / group cell (`*` where the words name them, `[asset]` where a patch is judged) |
| `validate` | check both text files and that every asset id the sidecar or bible names exists; exits 1 with each problem |

Image estimates are the median of the reported prices of earlier calls of the
same model in this project; with none yet, the seed rounds' price for a
high-quality image (basis `table`, ≈ $0.055); any other quality without a
reported price says "unpriced" (never free).

## Making (paid unless `--upload`)

| Command | Use it to |
|---|---|
| `make-sheets --character\|--group\|--scene <id> [--count 2] [--model flare\|sunburst] [--quality high] [--aspect 1:1] [--pick]` | draw sheet candidates (characters 1:1, groups 16:9, scenes at the series ratio). A scene attaches the picked character sheets as style references and warns when there are none. `--pick` needs `--count 1` |
| `make-sheets --missing` | candidates for every character without a sheet |
| `make-sheets --<kind> <id> --upload <file> [--pick]` | register a sheet made elsewhere; the first one for a card without a sheet is picked. Warns when the image is outside 0.4–2.5 wide to 1 high, the range a reference must stay in (the Jimeng canvas refuses it) |
| `check-sheets --character\|--group\|--scene <id> [--font <file>]` | free: the numbered side-by-side compare image of the ready candidates, the card's look and the earlier verdicts |
| `lineup [--character a,b,…] [--model] [--quality high] [--aspect 16:9] \| --upload <file>` | one image of two or more picked sheets side by side at one scale (default: every character with a picked sheet; Sunburst, ≈ $0.05) — the cheap check that identities and the size relation hold together, before a clip. Registered as `lineup-N`, recorded in `series.lineups` |
| `shoot-board --episode <id> [--part P] [--count 1] [--model] [--quality]` | one storyboard per part with the sheets attached (Sunburst by default when references are attached). Warns about cast drawn from text only |
| `shoot-board --episode <id> --part P --upload <file>` | register a board made elsewhere; warns like `make-sheets --upload` about the aspect |
| `redo-panel --episode <id> [--part P] --shot <n> [--model] [--quality] \| --upload <file>` | draw one panel alone (Sunburst by default, like the board) with the current board attached as image 1, its style reference (pencil line, framing scale, how the number is marked), and composite it into a new board in the panel's equal-division cell; replaces the picked board. Needs ffmpeg and a ready board. With `--upload` it also says to drag the new board file onto the Jimeng canvas, since the clip there selects the board node |
| `shoot-video --episode <id> [--part P] [--resolution 480p] [--seed n] [--no-audio] [--deadline-s 1800]` | one Seedance 2.5 reference-to-video take per part: cast sheets, group and scene sheets, the board last. Refuses without a ready board or with a cast member who has no picked sheet. `--deadline-s` is how long to wait for fal; past it the job is cancelled and recorded with billing unknown and its request id. The dry run shows the queue URL the request goes to |
| `shoot-video --episode <id> --part P --upload <file>` | register a clip made elsewhere |
| `patch-range --episode <id> [--part P] --shots a-b [--take <asset>] [--resolution] [--deadline-s] \| --upload <file>` | re-shoot shots a–b of the take in effect (at least 4 s are requested; a shorter span borrows following shots, or preceding ones at the end, and only a–b is spliced). Measures the cut on the take's own clock and warns when the shot list now gives the span a different length, and when an end of a–b has no cut in the take within 0.5 s (cuts from its latest contact sheet, else detected), where the splice would show as a jump; refuses when the shot count changed. Builds the new final when the patch lands |
| `retry` | list failed generations with reason and billing |
| `retry --asset <id> [--resubmit] [--deadline-s 1800] [--dry-run]` | for a clip with a recorded fal request, ask fal about that request first and land the result if it finished (no new spend; the cost reading counts it once). `--resubmit` sends the recorded request again as a new paid call and warns that the first may already be billed. Other failures are re-sent as recorded, with the same warning when their billing is unknown. `--force` only for an asset stuck in `pending`/`generating` that you know is not running |

Every paid command records the asset as generating before the request leaves,
then lands or fails it; the viewer shows it in flight meanwhile. Ctrl-C
records the call as failed with billing unknown — cancelling a remote render
does not make it free.

## Checking and finishing (local, ffmpeg)

| Command | Use it to |
|---|---|
| `review-episode --episode <id> [--part P] [--take <take\|patch>] [--frames 3] [--font <file>]` | the cast and group sheets once on top, then one row of frames per shot (`shot-NN.jpg`, frames only), the overview, detected scene cuts vs planned boundaries, size, length, audio, and who each shot's words name. With a patch: only the shots it splices back, on the patch's own clock |
| `frames --episode <id> [--part P] --shot <n> [--count 6 \| --seconds <s>[,<s>…]] [--crop x,y,w,h] [--take <take\|patch>]` | a closer look when a contact row is not enough: frames from inside one shot at the clip's own size (`--count`, default 6, at most 24, spread as the strip spreads them; or `--seconds` on that clip's own clock, inside the shot), or a close-up (`--crop`: a box in fractions of the frame, enlarged to fit the frame, at most 4×). From the clip the shot is judged on — the patch spliced over it, else the take in effect — unless `--take` names another. Writes `episodes/<id>/review/<part>-frames-<n>/` and records each image as a free derive asset; touches no contact sheet, verdict or splice. Refuses, writing nothing, a second outside the shot, a box outside the frame and a patch that does not splice the shot |
| `verdict --sheet <asset> --verdict ok\|drift\|unverified [--note]` | judge a sheet candidate |
| `verdict --episode <id> [--part P] [--take <take\|patch>] --shot <n\|a-b> --character <id>[,…] \| --group <id>[,…] --verdict ok\|drift\|absent\|unverified [--note]` | judge cells (a range records the same verdict on each shot); `drift` needs a note. A shot spliced from an applied patch is judged on the patch unless `--take` names the take. Warns when no contact sheet of that clip exists |
| `final --episode <id> [--force]` | join the parts' takes in effect and splice each part's applied patches (newest first; an older patch overlapping a newer one is dropped with a warning). Each join moves to a scene cut detected within 0.5 s of the planned boundary (on the take and on the patch) and the move is printed; the splice records both points. Running it again with nothing changed makes no new file (`--force` rebuilds). It says whether the episode is done: every shot × cast / group cell of the cut has a verdict |
| `compile-season [--episodes ep01,ep02] [--titles] [--title-format "{n}. {title}"] [--font <file>]` | join the latest final of every finished episode in order, with 1.5 s title cards (`{n}`, `{id}`, `{title}`). Warns when a final is older than the takes in effect, and when no CJK-capable font is found for the titles |

## Generation and keys

Images go to OpenRouter (GPT Image 2.5: `flare` is the general default,
`sunburst` the precision model), video to fal (Seedance 2.5 reference-to-
video). Keys come from `OPENROUTER_API_KEY` and `FAL_KEY` in the environment
or the session's `.env`; never print them. A missing key fails before anything
is sent and names the copy-paste route (`jimeng.md`).
