# Sprite mode → game asset pipeline (0.6.0)

Status: implemented in sprite 0.6.0 (2026-10-30); engine exports deferred (TODO below). Owner decision record and design for widening
the sprite mode from "one character, its motions" into the asset pipeline a
small game needs. The acceptance bar set by the user: the mode's launcher
showcase stands next to autosprite.io's homepage showcase, built from assets the
mode really made.

Research behind it (reference repos, AutoSprite/PixelLab docs, fal catalog):
`/Users/miraFriend/work/pneuma/sprite-pipeline-feature-audit.md` (outside the
repo, Chinese).

## Decisions already taken by the user

- Engine-specific exports (Unity, Godot, GameMaker, Paper2D, RPG Maker,
  editable `.aseprite`) are deterministic and well understood — **deferred** and
  done together at the end (see TODO below). Nothing in this round depends on
  them.
- Product shape follows Pneuma's top-level philosophy: the agent is the
  animator, programs own repeatable mechanics, the viewer is the live stage.
  No "one click, no agent" product.
- Props, items and their animations live **in the sprite mode** (its scope
  widens); no new mode.
- No frame-editing tool for people. A person selects a frame and sends the
  agent a change request; the agent edits.
- 8-direction generation by "one clip, a 3×3 grid of facings" was worth a paid
  spike (done, below) and is the main route.

## Target feature set (the nine showcase sections)

| # | Feature | Mechanism here |
|---|---|---|
| 1 | One image / prompt → idle, walk, run (a move set) | `plan-moveset` books a whole set with defaults and one price; states hurt, death, cast, guard, victory, dash join the sheet/clip sentence tables |
| 2 | Custom animation from storyboard keyframes + references | `storyboard` on a motion: timed beats, generated or uploaded keyframes, one Seedance reference clip that names them `@Image1…` |
| 3 | 8-direction isometric movement | **direction packs**: one 8-facing anchor sheet (3×3, centre empty), one clip of the whole sheet, split into eight directional motions cut on one shared window |
| 4 | Props / items / pickups in one visual language | **prop sets**: a content set whose sidecar holds `items[]` — a generated item sheet, cut by ink into items; animated items are one clip of the whole sheet split per cell, like a pack |
| 5 | Character editing — outfits, skins | **variants**: a new content set `variantOf` another; references edited from the original's, same style sentence and cell |
| 6 | Animation editing — same movement, new look | **restyle**: a motion made from another motion's clip (`@Video1`) and a new look (`@Image1`) |
| 7 | Motion control library — motion from a video onto any character | **motion transfer**: Kling v3 Motion Control / Wan 2.2 Animate on fal, from a library clip or the user's video, onto the character on chroma green, then the normal clip pipeline |
| 8 | Image → rigged 3D model + animations | **model**: Meshy 7.1 image-to-3D with rigging, then Meshy multi-animation (≤10 library clips per call); a 3D tab plays them |
| 9 | Cutscenes | **cutscene motions**: `kind: "cutscene"`, a Seedance reference clip with the character's references, played in the Video tab |

## Spike results (2026-10-30, all real calls)

**8 directions in one clip.** Character "Pip" (chibi alchemist): turnaround
($0.108), then an 8-facing anchor sheet — 3×3, centre empty, the turnaround
attached, an isometric camera described in words ($0.121). Every facing came
back on-model (hat, satchel strap, potion belt, striped stockings) with the
satchel on the correct hip in each view. The sheet was cut out (BiRefNet,
$0.0005), laid on #00ff00 and shot as one Seedance 2.5 image-to-video clip with
a "all eight copies walk in place in sync, none turns" sentence:

| | 480p (640²) | 720p (960²) |
|---|---|---|
| cost | $0.83 | $1.87 |
| per-direction cell | ≈ 213 px | ≈ 320 px |
| every facing held for 4 s | yes | yes |
| copies stayed in their cells | yes | yes |

A single cell cropped out of the 720p clip ran through the unchanged
`from-video` chain into a clean, keyed walk. One finding: `contact`'s cycle
reader returned *no cycle* on the raw cell — the figure drifts a few pixels
inside its cell, and the lag profile rises monotonically. On the same frames
after alignment the profile has one clean dip at 23 frames (0.96 s).
**The pack's cycle is read on registered (aligned) thumbnails**, and one
window is shared by all eight cells so the directions stay in phase.

**Motion transfer.** A Seedance text-to-video "realistic performer, whole
body, locked camera, plain studio" clip (5 s, 480p, $1.04) drove Kling v3
Motion Control Standard ($0.60, 4.8 s, 287 s) through a chibi girl, an anime
swordsman and a druid on chroma green, every beat kept. Wan 2.2 Animate Move
followed the beats but pulled the chibi toward realistic proportions and took
598 s — `kling-mc` is the default.

**Restyle.** Whole-grid restyles do not keep the grid: Seedance's reference
endpoint (`@Video1` the pack clip) turned every copy to face front and filled
the empty centre; Kling O1's video edit returned the reference picture as a
still. Driving the new look with ONE cell's clip through Kling Motion
Control kept the original's steps frame for frame ($0.47). Restyles go cell
by cell.

**3D.** Meshy 7.1 image-to-3D with rigging from Pip's front anchor: textured,
rigged, walk and run included ($0.80, ≈ 4 min); Meshy multi-animation added
eight library clips in one call ($0.08).

**Run does not hold eight facings.** Six 720p run takes (≈ $11) failed:
one re-laid the grid into repeated columns (rows identical), one collapsed it
to three columns, four turned the diagonals into side profiles — still so
with a "diagonals stay three-quarter" sentence and the plate pinned as first
and last frame (0.33). `pack-split` therefore compares every pair of cells
with their anchors before cutting (good walk/idle takes ≥ 0.83, the failed
run takes 0.17–0.55), refuses a mixed-up take, and `register-pack` refuses
one without `--force`. The showcase ships walk and idle in eight directions;
run is offered as 4 directions or single-facing clips. Open question: a
slower "jog" sentence, or a 2-row 4-diagonal-only sheet.

## Data model additions (`project.json` sprite sidecar)

All optional; a 0.5.x file loads and rewrites byte for byte.

```ts
type Direction = "front" | "back" | "left" | "right"
               | "front-left" | "front-right" | "back-left" | "back-right";
// compass in an isometric game: front=S, back=N, left=W, right=E,
// front-left=SW, front-right=SE, back-left=NW, back-right=NE.

interface SpriteCharacter {
  …
  view?: "side" | "topdown" | "isometric";   // the camera every prompt states
  variantOf?: { contentSet: string; note: string };   // feature 5
}

interface SpriteSidecar {
  …
  set?: "character" | "props";   // absent = character
  items?: PropItem[];            // props sets only
  model?: CharacterModel;        // feature 8
}

interface Motion {
  …
  kind?: "loop" | "transition" | "pack" | "cutscene";
  pack?: {                       // kind "pack": one clip of a facing grid
    rows: number; cols: number;
    cells: Array<{ direction: Direction; motion: string } | null>;  // row-major
    state: string;               // "walk" — each cell's motion is <state>-<direction>
  };
  packOf?: string;               // a directional motion cut out of a pack
  storyboard?: Storyboard;       // feature 2
  restyleOf?: { contentSet?: string; motion: string };   // feature 6
  transfer?: { library?: string; video: string; model: string };  // feature 7
}
```

Video models gain `kling-mc` (motion control), `wan-animate` and the mode
`motion-transfer` / `v2v`; derived clips gain `op: "crop"` (a pack cell) and may
name a parent clip on another motion (`<motion>/<videoId>`).

## TODO (deferred by decision)

- [ ] Engine exports, all at once: Godot 4 SpriteFrames `.tres` + `.tscn`,
  Unity (Editor importer script + optional `.meta`/`.anim`), Unreal Paper2D
  `.paper2dsprites`, GameMaker `_stripN`, RPG Maker MV/MZ `$` sheets (needs the
  4-direction walk), editable `.aseprite`, atlas trim + multi-page. Reference
  implementations: video-to-spritesheet (`engines.py`, the Unity importer),
  agent-sprite-forge (`export_engine.py`), voidless-mcp (`voidless-godot.mjs`).
