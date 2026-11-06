# The pack: files, fields, commands

## Workspace

```
pack.json                      the pack: text and decisions (you, the user, the viewer)
project.json                   the craft project: every file, provenance, cost, measurements (sticker.mjs only)
character/source-<n>.<ext>     the user's photo or image (import --source)
character/anchor-<n>.png       character candidates
stickers/<id>/take-<n>.gif     512² master takes, never overwritten
art/<kind>-<n>.png             portrait | head | banner | reward-guide | reward-thanks
exports/<platform>/…           derived files under the platform's names
exports/<platform>.zip         the upload archive
exports/<platform>/listing.md  copy-paste listing text (WeChat: 上架文案.md)
inspect/<take>-contact.png     contact sheets for you to open (not part of the pack)
```

## `pack.json`

```jsonc
{
  "version": 1,
  "rights": { "basis": "original", "note": "who it is and how that was confirmed", "confirmedAt": "2026-11-06" },
  "platforms": ["wechat", "telegram", "line"],
  "character": {
    "description": "identity features in English: shape, colors, markings, what it wears",
    "style": "thick clean dark outlines, flat colors",
    "anchor": "character-1"
  },
  "motion": { "frames": 16, "frameMs": 120, "size": 512 },
  "listing": {
    "wechat":   { "name": "…", "intro": "…", "copyright": "…", "rewardLine": "…" },
    "telegram": { "title": "…", "shortName": "…" },
    "line":     { "title": "…", "creator": "…", "description": "…", "copyright": "…" }
  },
  "stickers": [
    { "id": "s01", "word": "收到", "caption": "收到", "emoji": "🫡",
      "action": "stands up straight, gives one firm nod, raises its right front hoof in a crisp salute, then lowers it",
      "take": "s01-take-1", "keepFrames": null }
  ],
  "art": { "portrait": "art-portrait-1", "head": "art-head-2", "banner": "art-banner-1", "lineMain": "s01" }
}
```

| Field | Notes |
|---|---|
| `rights.basis` | `original`, `own-pet`, `self`, `consenting-adult` or `client`. Paid commands refuse until `rights` is set |
| `platforms` | the stores this pack is for; decides the art, exports and checklists |
| `character.description` | goes into every prompt; identity only, no per-sticker direction |
| `character.style` | defaults to `thick clean dark outlines, flat colors` |
| `character.anchor` | the picked character asset; every take is drawn from it |
| `motion` | 16 frames × 120 ms at 512² by default; 512 is Telegram's edge. Changing it makes every take stale |
| `listing.<platform>` | only for chosen platforms; limits in `platforms.md` and in `check` |
| `stickers[].id` | `s01`, `s02`…, stable; a new sticker takes the next free id |
| `stickers[]` order | the export numbering (`01.gif`…); reorder the array to reorder the pack |
| `word` | WeChat's 含义词: ≤ 4 characters, unique in the set |
| `caption` | drawn into the sticker exactly; `""` means no text |
| `emoji` | exactly one emoji (Telegram) |
| `action` | English body beats (`writing.md`) |
| `take` | the picked take id, `<id>-take-<n>` |
| `keepFrames` | `null`, or the 0-based frames to keep (at least 2, increasing) |
| `art.<kind>` | the picked art asset; `art.lineMain` names the sticker LINE's main image comes from (default: the first) |

Removing a sticker removes its entry; its takes stay in `project.json`.

## `project.json`

Written only by `sticker.mjs`; never edit it. Asset ids: `character-source-<n>`,
`character-<n>`, `<sid>-take-<n>`, `art-<kind>-<n>`, `<platform>-<sid>`,
`<platform>-<deliverable>`. Generated files record their model, prompt and
cost; imported ones are uploads by the user.

## Commands

All take `--dir <workspace>` (default: the current directory) and `--json`.

| Command | Paid | What it does |
|---|---|---|
| `status` | no | rights, keys, ffmpeg, the anchor, each sticker's status, art, exports, checks, spend, the next step |
| `quote [--only s01,s03] [--redo]` · `quote --art [--only kinds] [--redo]` · `quote --character [--count n]` | no | what the paid command would send and cost, and the wait |
| `character [--from <image or character-source-n>] [--count n] [--model flare\|sunburst]` | yes | character candidates, transparent PNG |
| `gen [--only s01,s03] [--redo] [--concurrency 4]` | yes | a take for each sticker without one; `--redo` adds a new take to each named sticker |
| `gen --art [--only kinds] [--redo]` | yes | the art the chosen platforms need |
| `prompts [--only …]` · `prompts --art` · `prompts --character` | no | the exact prompts, for the no-key route |
| `import --sticker <id> --file <gif>` · `--art <kind>` · `--character` · `--source` | no | register a file the user brought |
| `inspect <id> [--take <take>]` | no | numbers and `inspect/<take>-contact.png` |
| `export [--platform wechat\|telegram\|line\|all]` | no | every platform file, the listing text and the zip; current files are left alone |
| `check [--platform …]` | no | the checklist; exits 1 when a row fails |

`--dry-run` on `character` and `gen` prints the request without sending it.

## Status words

A sticker is **empty** (no take), **generating** (a take in flight),
**failed** (every take failed), **pick** (a ready take, none picked),
**ready** (the picked take matches `pack.json`) or **stale** (the picked take
was drawn from other words, motion or anchor; the reason is given).

An export is **current**, **stale** (made from other inputs), **missing**
(never exported) or **blocked** (its take or art is not picked yet). The zip
is built only when every required file is current.
