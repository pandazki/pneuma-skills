# Pitfalls

What has gone wrong before, why, and what fixes it. The first column is what
you or the user will see.

## Sheets

| Symptom | Cause | Fix |
|---|---|---|
| A body full of stars, a wig-length mane, a colour gone pastel | an unbounded additive adjective, amplified | bound it: very faint, short, only to…, bluish (`characters.md`) |
| A glowing character comes back a shade off its colour | the bright core washes the body out; the eye adapts | a material sentence in `look`, then sample pixels |
| Every feature matches the card, yet it reads as another animal | cues that individually pass add up to the wrong species | the stranger test; add cues only the intended animal has |
| Extra legs, extra arms | the card never said what is absent | name the absence: "no arms; exactly four feet" |
| An ability pose drawn as an effect (a streak, a glow) | the pose was a noun | describe body geometry in `poses` |
| One pose split into several | a list comma inside the pose | parentheses inside a pose; one `--pose` per pose |
| A paragraph of notes or a callout on the sheet | the model explains its design | already forbidden by the prompt; redraw if it persists |
| A scene sheet looks like a photo or an archviz render | drawn from text alone | pick the cast sheets first; `make-sheets --scene` attaches them |
| A mug or lamp with a face in the scene | props anthropomorphised in a world of living objects | "no props with faces" in the scene `look` |
| A new character darker and more opaque than the "same material" lead | another character's sheet attached as a reference | say the material in words; references are for scene style only |
| The Jimeng canvas will not take a sheet; `--upload` warns about its aspect | the image is more than 2.5 times as wide as it is high (or as high as it is wide) — a four-view turnaround in one row, for example | lay it out again in rows (two rows of two) and upload that; references stay within 0.4–2.5 |

## Storyboards

| Symptom | Cause | Fix |
|---|---|---|
| The clip contains the grid, panel numbers or sketch lines | a coloured or detailed board; the model copies it | keep the board black-and-white pencil (the prompt asks); a coloured board is a redo |
| Strip cells show half panels; a redrawn panel lands on the wrong area | the model drew uneven gutters; the strip and `redo-panel` divide equally | a new board |
| Wrong panel count or numbering | too many shots for a tidy grid, or a dense shot | 6 or 9 shots; a `sketch` with one readable moment |

## Clips

| Symptom | Cause | Fix |
|---|---|---|
| A slideshow of stills | shots under 2 s (nine shots in 15 s) | about 3 s a shot; 15 s = 6 shots (`shots.md`) |
| Looks like several unrelated places | the episode moves location | one scene per episode |
| Characters run left, then right; the camera jumps inside a chase | the method's continuity lines were removed (`--continuity ""`, or replaced without repeating them) | keep the two defaults and add the episode's own (`shots.md`) |
| Two leads merge, swap sizes or trade colours in the clip | the references were never tested together | `lineup` before the first clip; fix the sheets or looks it shows wrong |
| Fewer cuts than panels; the gag panel replaced by something easier | the model merged or skipped panels | the gag shot's `desc` most concrete; re-shoot that span |
| Subtitles or invented signs | text in a `desc`, or a sign in the scene `look` | describe things without words; only `markings` may show text |
| A lead's identity drifts mid-episode | the sheet attached is not the one the user picked, or the look moved between versions | `status` (sheet in effect, bible flag); re-shoot the span |
| The clip is near-silent | `--no-audio`, or `sfx` left empty | two or three cues per shot |
| A 720p take differs from the approved 480p one | a higher resolution is a new generation here | say so before; upscale in Jimeng if they want the same picture (`jimeng.md`) |
| A prompt mixes English scaffolding with Chinese looks | the bible's text is mixed and the language was guessed wrong | `set-series --lang zh` (or `en`); `prompts` prints the language it used |

## Checks

| Symptom | Cause | Fix |
|---|---|---|
| The rail stays at "Shot"; `final` says "built, not done" | cells of the cut are still `unverified` | judge every shot × cast / group cell (`status --episode <id>` lists them) |
| `status` lists a lost beat | a character is `absent` from a shot whose words name them | usually a merged or skipped panel: re-shoot the span with more concrete words |
| A contact row is too small to tell whether a detail is there | three frames per shot, 240 px high | `frames --shot <n>` (full size), `--crop` for a close-up; never ffmpeg by hand |
| A picture shows as a broken image in the chat (HTTP 403) | it was written outside the workspace (ffmpeg by hand into `/tmp`) | make it with `series.mjs` (`frames` for frames and close-ups); the chat and the viewer only serve workspace files |
| A drift badge stays after a re-shoot | the patched shots are judged on the patch, which has no verdicts yet | `review-episode --take <patch>`, then `verdict` on those shots |

## Money and state

| Symptom | Cause | Fix |
|---|---|---|
| A failed clip still appears in the spend | billing `unknown`: the request may have run | say it may be billed; `retry --asset` asks fal about the recorded request before anything is re-rendered |
| A clip timed out (`--deadline-s`) and fal finished it later | the local wait ended first; the request id was recorded | `retry --asset <id>` lands it without a new render; `--resubmit` only with the user's yes |
| A failed image retried and billed again | `retry --asset` re-sends anything that has no fal request to ask about | quote the price and get a yes before retrying an image |
| `final` makes no new file | the takes and patches are the same as the latest final's | expected; `--force` only when that final's file is missing or damaged |
| `init` or `set-series` refuses the ratio | Seedance renders only 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | pick one of those (9:16 for vertical) |
| Unsure of a flag | — | `series.mjs <command> --help` prints that command alone |
| Spend the viewer does not show | a paid script run outside `series.mjs`, or a Jimeng upload | only `series.mjs` spends; uploads carry no price |
| A file in `refs/` or `episodes/` that the viewer ignores | copied in by hand | `--upload` through the matching command |
| `project.json` unreadable in the viewer | edited by hand | never edit it; `validate` names the problem |
| The flag "shot under v1" on an episode | a card it consumed changed and was re-locked | the user re-shoots or acknowledges (`review.md`) |
| A patch rejected: "shot with 9 shots and the part now has 10" | the shot count changed after the take | re-shoot the part |
