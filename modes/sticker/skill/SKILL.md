---
name: pneuma-sticker
description: >
  Pneuma Sticker Pack (sticker) workspace guidelines. Use for any task in this
  workspace: the rights question, redrawing a photo or image as the pack's
  character, choosing phrases and poses, generating and re-rolling animated
  sticker takes, looking at them on light and dark chat backgrounds, platform
  art and listing text, exporting and checking for WeChat, Telegram and LINE,
  and the no-key route (prompts out, files back in). Read before your first
  action in a new conversation.
---

# Pneuma Sticker Pack Skill

## Scene

You and the user are making a pack of animated chat stickers: one character,
usually eight stickers, each a phrase people really send, with its own pose,
motion and caption. GPT Image 2.6 draws every sticker as a finished looping
GIF from the character image; `sticker.mjs` records each file, measures it,
exports it per platform and checks it. A sticker is judged in a split second,
at thumbnail size, on somebody else's chat background, so a take counts only
after it has been looked at small, on a light and on a dark plate.

In front of the user: the **panel** (the character card, the pack's platforms
and spend, a grid of stickers playing on a chat plate with one status chip
each; selecting one opens the inspector with its frames and takes), a **chat**
preview, and a **submit** tab per platform with the exported files, the
listing text and the checklist. You write `pack.json`, run the scripts and
look at what came back. The user decides the character, the phrases, the
takes and the spend, and submits to the stores themselves.

## Viewer contract

The viewer renders `pack.json` and `project.json` as one pack. It writes the
user's decisions into `pack.json` — a field edit, a picked take, a picked
character or art — so re-read `pack.json` before you change it. It never
writes `project.json` and never generates; its buttons send you commands.

Every message carries a `<viewer-context mode="sticker">` block: the address
first, then the selected sticker's word, caption, action and take state.
"This one" and "here" mean that address.

### ViewerAddress vocabulary

| Key | Grain | Meaning |
|---|---|---|
| `sticker` | coarse | a sticker by id (`"s03"`) |
| `art` | coarse | an art kind: `portrait`, `head`, `banner`, `reward-guide`, `reward-thanks` |
| `character` | coarse | `true` — the character card: the anchor and its candidates |
| `take` | fine | with `sticker`: one take (`"s03-take-2"`) shown instead of the picked one |
| `frame` | fine | with `sticker`: a frame, 0-based — the numbers on the contact sheet and in `keepFrames` |
| `platform` | scope | `wechat`, `telegram` or `line`: that platform's export of the thing; alone, its submit tab |

Examples: `{ "sticker": "s05", "take": "s05-take-2" }` ·
`{ "sticker": "s06", "frame": 15 }` · `{ "art": "banner", "platform": "wechat" }`.

### Actions

- `navigate-to { address }` — put the viewer on what your sentence is about.
  A frame address freezes the stage on that frame. An unknown sticker, take,
  frame, art kind or platform is refused by name and nothing moves.
- `set-view { view, platform?, plate? }` — `view` is `panel`, `chat` or
  `submit`; `platform` picks the submit tab; `plate` is `light` (#EDEDED) or
  `dark` (#111111), the chat background every sticker plays on.
- `capture` (built in) — a screenshot of what the user sees. Set the view and
  the address first, so the picture is the thing you mean.

Add a `<viewer-locator label="…" address='{…}' />` card to a reply when the
user should jump to what you mention.

### Look before you call anything done

You cannot judge a GIF you have not opened. For every take, cheapest first:

1. **Numbers** — `sticker.mjs inspect <id> [--take <take>]`: frames, timing,
   bytes, alpha, loop seam ("the loop jumps" above 2× the median step),
   ground and size drift, empty frames, how full the first frame is.
2. **Every frame** — open the contact sheet it writes,
   `inspect/<take>-contact.png`: all frames on the light plate, then all on the
   dark one. Judge here: identity, the caption on every frame, the pose,
   anything clipped at an edge, props that vanish, the jump from the last
   frame to the first. Outlines and dark parts that read on light can vanish
   on dark.
3. **In place** — `set-view { "view": "panel", "plate": "dark" }`,
   `navigate-to { "sticker": … }`, `capture`: the sticker as the user meets
   it, among the others.

A capture is one moment of a playing GIF; judge frames from the contact
sheet. Then say what you saw, per sticker, before recommending a pick.

## Core rules

1. **Rights before anything else.** Ask whose character it is before you
   draw. Allowed: the user's own original character, their own pet, the user
   or a consenting adult drawn as an obvious cartoon, client material the
   client confirms they hold the rights to. Refuse celebrities, film, anime
   and game characters, fan art, characters derived from someone else's
   internet character, and anybody else's artwork; offer an original
   character instead. A child's likeness is for private family chats only:
   never prepare it for a store. Record the answer in `pack.json` →
   `rights: { basis, note, confirmedAt }`; the paid commands refuse without
   it and name the field.
2. **Quote before you spend, and say the wait.** Before `character`, `gen` or
   `gen --art`, run `quote` with the same flags and tell the user the price
   and how long it takes; after, report what it cost. GIF prices are
   estimates (fal reports no usage). A failed call whose billing is unknown
   may have been charged: say so before running it again.
3. **Two files, two writers.** `pack.json` is yours and the user's: write it
   with your file tools and keep it valid (`status` names a broken field).
   `project.json` — every file, its provenance, cost and measurements — is
   written only by `sticker.mjs`. Never edit it, and never drop a file into
   `character/`, `stickers/` or `art/` yourself: bring files in with
   `import`.
4. **The script owns every prompt.** It assembles each prompt from
   `pack.json`; you shape it only through the fields (`character.description`
   and `style`, a sticker's `action`, `caption`, `word`). `prompts` prints the
   exact text. A changed field makes the takes it feeds stale; the chip says
   why, and a re-roll applies it.
5. **Captions are drawn by the model; a wrong caption is a re-roll.** Read
   the caption on every frame of the contact sheet. A wrong, missing or
   malformed character, or any extra text, means `gen --only <id> --redo`.
   Never paint over a GIF or lay text on it.
6. **`keepFrames` trims a loop that jumps.** When the last frame does not
   flow into the first, set `stickers[].keepFrames` to the 0-based frames to
   keep (from the contact sheet) instead of re-rolling; export again after.
7. **Look before "done"** (above). Name the stickers and frames you judged.
8. **Green before "ready to submit".** A platform is ready when its
   `check` has no failing row and you have told the user what each warning
   means. Warnings marked `unconfirmed` are rules no official page states;
   they never turn green.
9. **Registration and submission are the user's.** You prepare the files,
   the zip and the listing text, and explain the steps
   (`references/platforms.md`). The user registers, signs in and submits
   under their own identity; you do not do it for them.
10. **Every file comes from `sticker.mjs`, inside the workspace.** Do not run
    the generators or ffmpeg yourself and do not write outside the
    workspace: a file the script did not record has no provenance, and the
    viewer cannot show it.

What this session can generate (the scripts also say so in `status`):

{{#stickersEnabled}}**fal key set:** sticker takes are drawn here.{{/stickersEnabled}}
{{#stickersDisabled}}**No fal key in this session:** sticker takes go through the no-key route; say so in your first reply.{{/stickersDisabled}}
{{#imagesEnabled}}**OpenRouter key set:** the character and the platform art are drawn here.{{/imagesEnabled}}
{{#imagesDisabled}}**No OpenRouter key in this session:** the character and the art go through the no-key route.{{/imagesDisabled}}

## Money and waiting

| Step | Price | Wait |
|---|---|---|
| a sticker take (512² × 16 frames, fal) | ≈ $0.10 estimate ($0.05–0.20) | 26–40 s; 8 takes run 4 at a time, ≈ 1.5 min |
| a character candidate or a piece of art (OpenRouter) | $0.04–0.06, reported after the call | 14–21 s |
| `quote`, `prompts`, `status`, `inspect`, `export`, `check`, `import` | free (local) | seconds; `export --platform all` for 8 stickers ≈ 25 s |

The seed pack cost ≈ $1.18: one character, nine takes (one re-roll), four
pieces of art (one re-roll).

## Workflow

Run commands from the workspace as `node "<SKILL_DIR>/scripts/sticker.mjs"
<command> …`, where `<SKILL_DIR>` is the directory holding this file. Add
`--json` when you parse the output; `<command> --help` prints its flags.
Resume from `status` (it ends with the next step), never from memory.

### The two routes

| | For chats | To submit |
|---|---|---|
| for | the user, their friends, a client's team | the WeChat, Telegram or LINE store |
| opening question | "Who or what is the sticker of, and who will use it?" | "Which platforms?" |
| defaults | 8 stickers, `platforms: ["wechat"]`, no reward art | 8 stickers (LINE takes 8, 16 or 24), every art the platforms need |
| cost and wait | ≈ $0.90 and a few minutes of generation | ≈ $1.20 and a few more minutes for the art |
| finish line | the GIFs playing on the panel, the 240² chat-ready GIFs in `exports/wechat/`, a share link if they want one | every chosen platform's checklist green, the zip ready, the listing text filled |

For chats, the art rows of the WeChat checklist stay open and no zip is
built: the zip waits for the cover, icon and banner, which only a store
needs. If the user wants to pass the whole set around as `exports/wechat.zip`,
make that art (≈ $0.17).

Both begin with the rights question and the character, and both look at
every take before a pick.

### 1. Rights and the character

1. Ask the opening question of the route and the rights question; write
   `pack.json` with `version: 1`, `rights`, `platforms`, the start of
   `listing` and an empty `stickers` list (`references/pack.md` has the
   fields). Every command reads it, so it comes first.
2. From a photo or image: `import --source --file <path>` records it as the
   user's upload; write `character.description` in English — the features
   that make it *this* character (shape, colors, markings, what it wears);
   keep the default style ("thick clean dark outlines, flat colors") unless
   the user wants another. `quote --character`, then `character --from
   character-source-<n>` (add `--count 2` for a choice). Without a picture,
   `character` designs from the description.
3. Open each candidate PNG, then put the panel on the dark plate
   (`set-view`), `navigate-to { "character": true }` and `capture`: a dark
   outline that reads on white can melt into a dark chat. Recommend one and set `character.anchor` when the user
   agrees (or they pick on the card).
   The anchor is the lock: once takes exist, a new anchor makes every take
   stale. Say so before changing it.

### 2. Phrases, poses, actions

Propose the stickers as a table — word, caption, emoji, one-line pose — using
`references/writing.md`: phrases people send every day, one distinct pose
each, captions of 2–4 characters. Write them into `stickers[]` with the
action in English body beats, show the table, and wait for a nod: changing
words is free now.

### 3. Generate and look

`quote`, say the price and the wait, then `gen` (every sticker without a take,
4 at a time; a failure does not stop the others). When they land, run the
look rhythm for each and report per sticker: what reads, what is wrong.
Recommend a take; the user picks on the panel or you set `stickers[].take`.
For a bad take, re-roll (`quote --only s05 --redo`, then `gen --only s05
--redo`); the old take stays. Twice the same failure: rewrite the action
first (`references/prompting.md`).

### 4. Art and listing (to submit)

`quote --art`, `gen --art` makes the art the chosen platforms need (portrait →
cover and Telegram thumbnail, head → icon and LINE tab, banner; reward art
only when `listing.wechat.rewardLine` is set). Open each, re-roll what misses
(`gen --art --only head --redo`), set `art.<kind>`. Fill each platform's
listing fields within the limits `check` prints.

### 5. Export, check, hand over

`export --platform <p|all>` derives every file from the picked takes and art
and writes `exports/<platform>.zip` plus the listing text; it skips what is
already current. `check` prints the same checklist the submit tab shows.
Fix each failing row at its cause (a pick, a field, `keepFrames`), export
again, check again. Then `set-view { "view": "submit", "platform": … }`,
`capture`, and walk the user through submitting
(`references/platforms.md`).

### No key: prompts out, files back in

`prompts` prints each sticker's exact prompt and the anchor to attach;
`prompts --character` and `prompts --art` do the same for the images. The
user makes the file elsewhere (ChatGPT with GPT Image 2.6 makes animated
GIFs) and you register it: `import --sticker <id> --file <gif>`, `import
--character --file <png>`, `import --art <kind> --file <png>`. Imported files
are looked at, picked, exported and checked like generated ones.

## Commands

A viewer button arrives as a message naming the command and the address. A
press is the go-ahead for that one step at its defaults: say the price line,
then run it. Anything beyond it (re-rolls of existing takes, more art) needs a
yes in chat.

| Command | What you do |
|---|---|
| `make-missing` ("Make the missing stickers") | `quote`, say price and wait, `gen` for every sticker with no take; then look at each landed take and recommend picks. |
| `export-check` ("Export and check") | For the platform on screen: `export --platform <p>`, `check --platform <p>`, read every row, fix the failures you can, explain the warnings, `capture` the submit tab. |

## References

| Topic | File |
|---|---|
| `pack.json` fields, the workspace layout, every `sticker.mjs` command, the status words | `references/pack.md` |
| Choosing phrases, one pose per sticker, writing actions, captions, what never goes in a sticker | `references/writing.md` |
| How each prompt is assembled, what a re-roll or an edit changes, the measured defaults | `references/prompting.md` |
| Each platform's rules and files, how the user submits, what review looks like | `references/platforms.md` |
