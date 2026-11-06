# Sticker mode — design brief and implementation spec

Status: decisions confirmed by the product owner on 2026-11-06 (table below).
This document is the spec every implementation task reads. Task sections are
anchored (`## TASK-n`) so implementers and reviewers read the same bar.

## Summary

`sticker` turns one photo or character image into a pack of animated chat
stickers: the same character in every sticker, each sticker a chat phrase with
its own motion and caption, exported and checked against each target
platform's submission rules (WeChat, Telegram, LINE).

GPT Image 2.6 does the drawing. One call per sticker returns a finished
animated GIF with the character reference attached and the caption drawn in
(fal `openai/gpt-image-2.6/<model>/edit`, shared `generate_gif.mjs`).
Deterministic scripts do everything after that: record, measure, export per
platform, check, package. The viewer is the sticker panel: every sticker
playing on a chat background, the takes to choose from, a chat preview, and
one submission view per platform with the real exported files and a live
checklist.

### Decisions (confirmed 2026-11-06)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope | Full: scripts, viewer, skill, real seed, Codex review, cold-start blind trial, hosted-player verification, showcase |
| D2 | Platforms | WeChat + Telegram + LINE export profiles and checks |
| D3 | Hosted player | Yes — a finished pack is shareable as a read-only link |
| D4 | Seed | The anime-series 牛马 mascot redrawn as a flat outlined sticker character, "打工牛马", 8 stickers |
| D5 | Attribution | No `inspiredBy`, no NOTICE: the owner judged the reference repo's ideas common; nothing is copied |

Product-owner direction: "核心还是依赖 gpt-image 2.6 的能力" — the mode is built
around what GPT Image 2.6 does natively; the rest follows Pneuma practice.

## Evidence (probes, 2026-11-06)

Full record: `~/pneuma-dev-scratch/2026-11-06/sticker-probes/FINDINGS.md`
(contact sheets on light and dark plates in `out/`).

- 6 of 6 fal GIF edits succeeded, 26–28 s wall each, frame count as asked,
  `loop=0`, 1-bit alpha with **zero semi-transparent pixels** → no white
  fringe on a dark chat background.
- Model-drawn captions: 5 GIFs / 64 frames / two phrases (收到, 不想上班):
  **0 typos**, stable placement. Captions are drawn by the model; there is no
  font overlay pipeline.
- Identity held in every frame of every run, for both the soft 3D 牛马 and the
  flat outlined redraw. Thick outlines read better at 240 px.
- 240²×16 came back WeChat-ready (277 KB). 480²×12 came back 467–610 KB.
- OpenRouter transparent stills carry a haze: 10.8% semi-transparent pixels
  on the flat reference. Any transparent still used as a deliverable (cover,
  icon, LINE main/tab) needs an alpha cleanup step.
- ffmpeg 8 locally: VP9 + alpha WebM from a 480 GIF = 82 KB at 512²
  (`alpha_mode=1`). APNG 320×270 = 896 KB as RGBA, 263 KB after
  `palettegen/paletteuse` at 128 colours → LINE needs a size-fit loop, like
  WeChat's 500 KB fit.
- fal reports no usage for GIF requests; cost is an estimate, never invented.

## Identity

- name: `sticker` (catalog mode, public)
- displayName: `{ en: "Sticker Pack", "zh-CN": "表情包", ja: "スタンプ" }`
- description (en): "Turn one photo or character into a pack of animated chat
  stickers — the same character in every one, captioned, exported and checked
  for WeChat, Telegram and LINE."
- icon: lucide-style line icon — a square sticker with a peeled corner and a
  small smile; single stroke paths, `currentColor`.

## Domain

The user makes a **pack**: one locked character, N stickers (each a chat
phrase with a caption and a motion), a few pieces of supporting art, and per
platform listing text. The agent handles the rights question, designs the
character, proposes phrases and motions, generates, looks at the results,
re-rolls, exports and checks. The person picks the character, the phrases and
the takes, and submits to the platforms themselves (registration and
submission are always the user's own, under their real identity).

### User routes (skill workflow, not features)

| Route | Opening question | Defaults | Finish line |
|---|---|---|---|
| **For chats** — for me / friends / a client | "Who or what is the sticker of, and who will use it?" | 8 stickers, WeChat profile, no reward art | GIFs on the panel + `exports/<platform>.zip` + share link |
| **To submit** — WeChat / Telegram / LINE store | "Which platforms?" | 8 stickers (LINE: 8/16/24), all platform art | every chosen platform's checklist green, zip ready, listing text filled |

Both start with the rights gate and the character lock. Cost and wait are said
before every paid step (quote first).

### Rights gate (policy + script gate)

Allowed: the user's own original character; their own pet; the user, or a
consenting adult, drawn as an obvious cartoon; client material the client
confirms they hold the rights to. Refused: celebrities, film / anime / game
characters, fan art and derivative internet characters, someone else's
artwork. A minor's likeness is never prepared for public submission (private
family use only). `pack.json.rights` must be recorded before any paid call;
`sticker.mjs` refuses generation without it and names the field.

## Invariants and state ownership

| State | Owner / writers | Notes |
|---|---|---|
| `pack.json` — pack text and decisions (listing, rights, platforms, character description + picked anchor, stickers' word / caption / action / emoji / picked take / keepFrames, picked art) | agent (Edit) and viewer (`Source.write`) | the only file the viewer writes |
| `project.json` — craft project: every media file as an asset, provenance, cost, `sticker` sidecar | `sticker.mjs` only (through `craft-project-io.mjs`) | never hand-edited, never written by the viewer |
| media files under `character/`, `stickers/`, `art/`, `exports/` | `sticker.mjs` only | a generated file is never overwritten; a new take is a new file |

1. **One prompt authority.** The prompt for a sticker take is assembled by one
   pure function from `pack.json` (character description, style, word,
   caption, action, motion settings). The script sends it and records it in
   the edge; the viewer runs the same function to tell whether a take is
   **stale** (recorded prompt ≠ current prompt, or `fromAssetId` ≠ the
   current anchor). No status is ever hand-maintained.
2. **Paid calls follow the craft lifecycle**: reserved before the request
   leaves, landed or failed after; a failure records billing `none` only when
   the request provably never left the machine. Costs are `estimate` for fal
   GIFs (fal returns no usage) and `reported` where OpenRouter reports.
3. **Exports are derived, deterministic, idempotent.** An export is a pure
   function of (picked take, keepFrames, platform profile). Re-running export
   with the same inputs produces the same files and does not create duplicate
   assets. A picked-take change makes that sticker's exports stale until the
   next export.
4. **Checks are pure and shared.** Platform rules live as data in one pure
   module. Measurements (bytes, frames, duration, loop count, dimensions,
   alpha, similarity hashes, loop seam) are recorded by the script when it
   lands or exports a file; the check evaluates rules over `pack.json` +
   recorded measurements. `sticker.mjs check` and the viewer's checklist run
   the same function and therefore agree.
5. **Order is identity-free.** Sticker ids (`s01`…) are stable; export
   numbering follows array order in `pack.json`.
6. **Rights before spend** (above).

Reuse: craft project layer (`craft-project.mjs`, `craft-project-io.mjs`),
`generate_gif.mjs`, `generate_image.mjs`, `fal-queue.mjs`; anime-series is the
structural precedent (text file + craft project → one aggregate; rules in a
pure `*-state.mjs` the scripts and `domain.ts` both import). Sprite's
`gif-frames.mjs` rule (frames from packets, never from `r_frame_rate`) and
`alpha-clean.mjs` are candidates to lift into `modes/_shared/scripts/` if they
fit unchanged — move, don't copy.

No new framework abstraction is introduced.

## Workspace layout

```
pack.json                         the pack (text + decisions)
project.json                      craft project, sidecar key "sticker"
character/source-<n>.<ext>        user photos / images (upload, human)
character/anchor-<n>.png          character candidates (generate | upload)
stickers/<id>/take-<n>.gif        512² master takes (generate | upload)
art/<kind>-<n>.png                portrait | head | banner | reward-guide | reward-thanks
exports/<platform>/…              derived deliverables, platform naming
exports/<platform>.zip            upload-ready archive
exports/<platform>/listing.md     copy-paste listing text (WeChat: 上架文案.md)
```

### `pack.json` (sketch — TASK-1 finalises and validates it)

```jsonc
{
  "version": 1,
  "rights": { "basis": "original", "note": "…", "confirmedAt": "2026-11-06" },
  //   basis: original | own-pet | self | consenting-adult | client
  "platforms": ["wechat", "telegram", "line"],
  "character": {
    "description": "round pale blue-grey ox calf, cream horns, …",  // identity features, English
    "style": "thick clean dark outlines, flat colors",
    "anchor": "character-2"                                        // picked asset id
  },
  "motion": { "frames": 16, "frameMs": 120, "size": 512 },
  "listing": {
    "wechat":   { "name": "打工牛马", "intro": "…", "copyright": "…", "rewardLine": "…" },
    "telegram": { "title": "…", "shortName": "…" },
    "line":     { "title": "…", "description": "…", "copyright": "…" }
  },
  "stickers": [
    { "id": "s01", "word": "收到", "caption": "收到", "emoji": "👌",
      "action": "nods twice and raises one front hoof in a firm salute, then back to the start pose",
      "take": "s01-take-2", "keepFrames": null }
  ],
  "art": { "portrait": "art-portrait-1", "head": "art-head-1", "banner": "art-banner-1" }
}
```

`word` is WeChat's 含义词, `emoji` is Telegram's required emoji. An empty
`caption` means no text in the sticker. Listing fields exist only for the
chosen platforms.

### `project.json` (craft, sidecar `sticker`)

Asset ids: `character-source-<n>`, `character-<n>`, `<sid>-take-<n>`,
`art-<kind>-<n>`, `<platform>-<sid>`, `<platform>-<deliverable>`. Takes
`generate` from the anchor (model, prompt, cost recorded); exports `derive`
from the take or art (`params.op: "export"`, `params.platform`); uploads are
`upload` by `human`. The sidecar holds the measurements the checks need and
anything else only scripts write; TASK-1 defines it. Selections are not in the
sidecar — they are human decisions and live in `pack.json`.

## Generation

| Step | Tool | Defaults | Measured |
|---|---|---|---|
| character from photo / image | `generate_image.mjs` (OpenRouter) Flare edit, transparent PNG | style "thick clean outlines, flat colors" unless the user chooses | 9.6 s; identity held |
| sticker take | `generate_gif.mjs` (fal) edit, anchor attached | 512²×16 frames × 120 ms, medium, transparent, Flare | 26–28 s per GIF, ≈$0.05–0.20 estimated |
| portrait / head art | OpenRouter Flare, transparent → alpha cleanup | | haze 10.8% before cleanup |
| banner / reward art | OpenRouter Flare, opaque, no text | | |

The 512²×16 default (needed for Telegram's 512 edge) is confirmed on the seed
run's 8 stickers before it ships; if it fails there, the brief is revised with
the samples. The prompt carries: exact identity, same size and ground line in
every frame, margin, exaggerated readable expression, solid shapes (no motion
blur / dust / semi-transparency), seamless loop, the action, and either the
caption clause (exact text, thick white outline, no other text) or "no text".

No-key path: `sticker.mjs prompts` prints each prompt and where to save the
result; the user makes the GIF in ChatGPT and `sticker.mjs import` records it
as a human upload.

## Platform profiles

Read from the official pages on 2026-11-06 (WeChat: the guide page's own JS
bundle, build `26052800`; Telegram: core.telegram.org/stickers,
…/webm-vp9-encoding, …/import-stickers, Bot API 10.3; LINE:
creator.line.me/en/guideline/animationsticker/ and …/sticker/). Profile data
lives in the pure module with a `checked: "2026-11-06"` stamp and the source
URL; a value with no official source is marked `unconfirmed` and the checklist
shows it as a warning, never a pass.

**WeChat** (sticker.weixin.qq.com 制作规范 + 赞赏功能规范)

| Item | Rule |
|---|---|
| stickers | 8–24; GIF 240×240, ≤500 KB, must loop; a set is all animated or all static |
| cover 表情封面图 | PNG 240×240 ≤500 KB, **transparent**, no white outline, no square frame |
| icon 聊天页图标 | PNG 50×50 ≤100 KB, **transparent** |
| banner 详情页横幅 | JPG/PNG 750×400 ≤500 KB, opaque, not white, no text |
| reward guide 赞赏引导图 | GIF/PNG 750×560 ≤500 KB, opaque (only when reward is on) |
| reward thanks 赞赏致谢图 | GIF/PNG 750×750 ≤500 KB, opaque (only when reward is on) |
| text | name ≤8 汉字 no punctuation (≤5 shows best); intro ≤80; 含义词 ≤4, unique in set; copyright ≤10; reward line 5–15 |
| unresolved | 赞赏缩略图 is required by the reward section but never specified → warning |

The platform crops and compresses oversize files itself; the exporter meets
the limits so nothing is altered after the user checks it.

**Telegram** (video stickers; GIF is not accepted)

| Item | Rule |
|---|---|
| sticker | WEBM VP9 with alpha; one side exactly 512, other ≤512; ≤3 s; ≤30 fps (encoding guide: constant 30 fps); ≤256 KB; no audio; looped |
| set thumbnail | static PNG/WEBP exactly 100×100 ≤128 KB (or WEBM ≤32 KB); optional, first sticker otherwise |
| per sticker | 1–20 emoji (we export one: `emoji`) |
| set | 1–50 stickers at creation, ≤120 total; created by the user in the app / @Stickers bot |

The exporter resamples to a constant 30 fps by time, so the master's frame
delay does not have to divide 1000/30.

**LINE** (animation stickers)

| Item | Rule |
|---|---|
| count | 8, 16 or 24 |
| sticker | APNG (`.png`), transparent, within 320×270 with width or height ≥270; non-animated margins removed |
| frames / time | 5–20 frames; a loop ≤4 s; 1–4 loops with total ≤4 s (16 × 120 ms → at most 2 loops); not every frame identical |
| bytes | ≤1 MB per image; ZIP ≤60 MB |
| main image | APNG 240×240, 1 per set; tab image PNG 96×74 (no play symbol) |
| first frame | shown as the still in the store → must be a good pose |
| text | title 40, creator 50, description 160, copyright 50 (Asian characters count 2) |
| unconfirmed | ZIP naming `01.png…`, `main.png`, `tab.png` (third-party guides only) → warning |

Exporter recipe (per profile): GIF frames from packets → optional
`keepFrames` trim → scale with lanczos → alpha threshold → encode (GIF:
global palette + transparency; WebM: VP9 `yuva420p`; APNG: palettegen /
paletteuse with reserved transparency) → size-fit loop (colours, then frame
decimation) until under the limit → measure → record.

## Scripts — `skill/scripts/`

- `sticker-state.mjs` (pure, browser-safe, imported by `domain.ts`): pack
  validation, prompt assembly, take / export staleness, per-sticker status,
  platform profiles, checks, next-step summary.
- `sticker.mjs` CLI (node):
  `status`, `quote`, `character`, `gen [--only s01,s03] [--art] [--redo]`,
  `prompts`, `import`, `inspect <sid> [--take]` (frame contact sheet on light
  and dark plates + loop seam / motion numbers, for the agent to look at),
  `export --platform <p|all>`, `check [--platform]`. Every command prints a
  human line and supports `--json`. Paid commands print a cost line and
  refuse without `rights`.

Concurrency for `gen`: bounded (default 4). A failed sticker does not stop
the others; a rerun fills only what is missing. Nothing retries a call that
may have been billed.

## Viewer

Three views over one aggregate source, Ethereal Tech chrome with real chat
plates inside the content area (light `#EDEDED`, dark `#111111`):

1. **Panel** (default) — character card (anchor, style, rights badge) and pack
   meta (platforms, cost) beside a 4-column sticker grid. Each card plays its
   picked take on the plate with word · caption and one status chip
   (empty / generating / failed / takes to pick / stale / ready). Selecting a
   sticker opens the inspector: 2× playback, frame strip (each frame
   pointable), takes row (pick writes `pack.json`), editable word / caption /
   emoji / action (writes `pack.json`; a changed caption shows "stale — re-roll
   to apply").
2. **Chat** — a phone-width chat thread sending the stickers in order, light /
   dark plate: how the pack feels in use. This is also the share-link landing
   feel.
3. **Submit** — one tab per chosen platform: the checklist (pass / warn /
   fail rows from the shared checks), the exported files at native size on the
   platform's plate, and listing fields with character counters.

Read-only (`editing === false`, hosted player): no field editing, no take
picking, no commands; everything else plays.

### ViewerAddress

`{ sticker?: "s01", frame?: number, take?: "s01-take-2", art?: ArtKind, character?: true, platform?: Platform }`
— coarse: `sticker` | `art` | `character`; fine: `frame`, `take`; scope:
`platform` (which export is meant).

### Actions (agent-invocable)

| id | category | params | purpose |
|---|---|---|---|
| `navigate-to` | navigate | `{ address }` | focus a sticker / frame / take / art / character |
| `set-view` | ui | `{ view: "panel" \| "chat" \| "submit", platform?, plate?: "light" \| "dark" }` | show what to look at before `capture` |

`capture` is built in. The skill teaches the rhythm: generate → `inspect`
(contact sheet) → `navigate-to` + `capture` on the dark plate → decide.

### Commands (user → agent)

"Make the missing stickers", "Export and check" (active platform). Hidden
when not editing.

## Manifest

- `sources.pack`: `aggregate-file` over `pack.json` + `project.json`;
  `load` / `save` in `domain.ts`; `save` writes `pack.json` only.
- `viewer.watchPatterns`: `["pack.json", "project.json"]` — media is read via
  `/content/<uri>?r=<createdAt>`, never through the watcher.
- `workspace`: `type: "single"` (one pack per workspace), no TopBar item list.
- `init.params`: `falApiKey` (stickers), `openrouterApiKey` (character + art),
  both optional and `sensitive`; `deriveParams` exposes enabled / disabled
  flags the skill and viewer read. `envMapping`: `FAL_KEY`,
  `OPENROUTER_API_KEY`.
- `sharedScripts`: the transitive whitelist (craft-project, craft-project-io,
  fal-queue, generate_gif, generate_image, + anything lifted).
- `greeting`: name the character and the next step if a pack exists; else ask
  whose sticker it is and who will use it; say which keys are missing and what
  still works.
- `evolution.directive`: Learn how this user makes sticker packs — the
  character styles they keep (outline weight, palette, proportions), their
  caption voice and recurring phrases, how big they like motions, which
  platforms they ship to, pack size, what they re-roll and why, and what they
  spend per pack. Evidence: `pack.json`, the craft project's takes, picks and
  costs, session history. Write them back as this skill's defaults; explicit
  instructions still win.

## Seed

`modes/sticker/seed/niuma/` — "打工牛马": the flat outlined 牛马 (character
derived from the anime-series sheet, recorded with provenance), 8 stickers
of everyday work-chat phrases, all three platform exports and checks, made by
the mode's own scripts and shipped as they came out (no retouching; re-rolls
kept as takes). Expected spend ≈ $1–2.

## Cloud surfaces

- Hosted player: **yes**. The viewer renders from `pack.json` +
  `project.json` (both in the player's text allowlist) and `/content/*` media;
  no `/api/*` at render time. Obligations: `src/player/player-modes.ts` import,
  `scripts/smoke-sticker.ts` (copy the sprite / kami harness), a real package
  of the seed exercised read-only in a browser with a clean console, and only
  then the `WEB_PLAYER_SUPPORTED_MODES` entry.
- Artifact deploy: none (the output is files to submit, not a site).

## Registration and distribution

`core/mode-loader.ts` entry; catalog mode (not in `modes/distribution.json`
`bundled`); README.md + README.zh.md catalog rows; showcase via the
`showcase` skill step 3 (hero + 3 highlights).

### Art kinds → deliverables

| Art kind | Made by | Becomes |
|---|---|---|
| `portrait` (front half-body, transparent) | OpenRouter + alpha cleanup | WeChat cover 240², Telegram thumbnail 100² |
| `head` (head only, transparent, bold) | OpenRouter + alpha cleanup | WeChat icon 50², LINE tab 96×74 |
| `banner` (scene, opaque, no text) | OpenRouter | WeChat banner 750×400 |
| `reward-guide`, `reward-thanks` (opaque, no text) | OpenRouter | WeChat reward art (only when `rewardLine` is set) |
| LINE main | derived from a sticker take (`pack.art.lineMain`, default the first sticker) | APNG 240² |

## Tasks

- **TASK-0** (orchestrator): this brief, probes, platform verification. Done.
- **TASK-1** scripts + pure module + tests.
- **TASK-2** manifest, `domain.ts`, `pneuma-mode.ts`, viewer, registration —
  after TASK-1 merges.
- **TASK-3** skill (`SKILL.md` + references), seed run (paid), showcase.json —
  after TASK-1, parallel with TASK-2.
- Review (Codex) ∥ verify (typecheck, tests, player smoke) → amend.
- Cold-start blind trial (isolated HOME, own port and browser) → fixes.
- Showcase images, README rows, hosted-player whitelist.

## TASK-1 — scripts, pure module, tests

Directory: `modes/sticker/skill/scripts/` (+ `.d.mts` sidecars, as the
anime-series scripts have) and `modes/sticker/__tests__/`. Write the minimum
`modes/sticker/manifest.ts` needed for `sharedScripts` and tests to resolve
(identity, skill block, `sharedScripts`, `envMapping`); TASK-2 completes it.

Acceptance:
1. `sticker-state.mjs` is pure (no `node:` imports; importable by
   `domain.ts`) and owns: `pack.json` parsing with named errors; prompt
   assembly (sticker, character, each art kind); per-sticker status
   (`empty | generating | failed | pick | ready | stale`) with the reason for
   `stale`; per-platform export staleness; the platform profiles as data
   (source URL, `checked`, `unconfirmed` flags); `checkPack(pack, project,
   platform)` → rows `{ id, label, level: "pass" | "warn" | "fail", detail,
   address? }`; a next-step summary for `status` and the greeting.
2. `sticker.mjs` implements `status`, `quote`, `character`, `gen`, `prompts`,
   `import`, `inspect`, `export`, `check` with `--json`, through the craft
   lifecycle (`craft-project-io.mjs`, `runRegistered`), the shared generators
   as libraries, and `fal-queue.mjs`'s billing evidence. Refuses paid steps
   without `rights`; prints a cost line for every paid call; bounded `gen`
   concurrency; never overwrites a file; reruns fill only what is missing.
3. Exporters meet every profile rule above by construction (size-fit loops,
   LINE margin crop + loop count, Telegram constant 30 fps, transparent vs
   opaque art) and record the measurements the checks read. Exports are
   idempotent (same inputs → same files, no duplicate assets).
4. Tests: unit tests for the pure module (validation, prompts, staleness,
   every check rule incl. unconfirmed → warn); CLI tests with mock generators
   (no network), following `modes/anime-series/__tests__/scripts-mock-generators.mjs`;
   ffmpeg exporter tests behind `PNEUMA_TEST_MEDIA=sticker` that decode every
   exported file and assert the profile limits (dimensions, bytes, frames,
   duration, loops, alpha). Fixture GIFs stay small (synthesise with ffmpeg or
   keep one ≤300 KB probe GIF).
5. One real paid end-to-end smoke (one sticker take + its three exports +
   checks) on a scratch workspace, budget ≤ $1, evidence saved under
   `~/pneuma-dev-scratch/2026-11-06/sticker-t1/`. Report the actual GIF size
   and timing at the 512²×16 default.
6. `bun run typecheck`, `bun test modes/sticker`, and the media tier pass.
