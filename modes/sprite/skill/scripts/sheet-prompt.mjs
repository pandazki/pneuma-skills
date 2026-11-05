/**
 * sheet-prompt.mjs — what a sprite sheet asks the image model for: the prompt
 * text, assembled in code from the character, the motion and the agent's
 * action, and the layout guide image that can travel with it.
 *
 * Pure: no files, no ffmpeg, no clock. `sprite-project.mjs sheet-prompt`
 * records the text and its parts; `sprite-sheet.mjs guide` rasterises the
 * guide. Both take their geometry from here, so the safe margin the prompt
 * states is the margin the guide draws — one number, one authority.
 *
 * The agent supplies the ACTION (the phase plan, by cell); code supplies
 * everything that is the same for every sheet of this character: the style
 * anchor, the grid, the cell framing, identity, the per-state guards, the
 * facing, the asymmetry lock, the loop closure and the white plate. The
 * clause order is `references/prompting.md`'s five-part grammar.
 *
 * Inspired by aldegad/sprite-gen (Apache-2.0) sprite_gen/gen/prepare.py@fbd1a08
 * `row_prompt` (:753-826): caller-owned action with code-owned layout and
 * continuity. Subject applicability is inspired by `video/body_plan.py`
 * @4f5ccd55c7cf06685a41f954acc1e476b7772ece; unlike its taxonomy, our
 * description and action supply the structure and materials directly.
 */

/** Text changes bump the builder; stored requests retain their original text.
 * /3 makes state, identity and material clauses subject-neutral. */
export const SHEET_PROMPT_BUILDER = "sheet-prompt/3";

/**
 * Safe margin as a share of the cell, floored per axis.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/gen/prepare.py@fbd1a08
 * `DEFAULT_SAFE_MARGIN_RATIO` (0.094: 256 → 24 px, 512 → 48 px). Changes: it
 * replaces our fixed "at least 16 px", which was written for 256 px cells and
 * shrinks to 3 % of a 512 px cell.
 */
export const DEFAULT_SAFE_MARGIN_RATIO = 0.094;

/** The longest side a generated cell is scaled up to (by a whole factor):
 *  a 256 px character cell is drawn at 512, the size the canonical 2048
 *  sheet already gives it. */
export const GENERATION_CELL_MAX = 512;

/** Frame counts that fill a grid exactly without a sheet wider than 3:1 or a
 *  row longer than four cells. */
export const SHEET_FRAME_COUNTS = [2, 3, 4, 6, 8, 9, 12, 16];

/** The motion families with guards of its own; anything else is generic. */
export const SHEET_STATES = ["idle", "walk", "run", "jump", "attack", "wave", "hurt", "death", "cast", "guard", "victory"];

/**
 * Frame counts measured to read best, per state. idle: E1 (2026-09-27,
 * Lumi) — 8 frames as 4 columns × 2 rows read best in both takes; 4×4 showed
 * row-boundary or wrap pops, 2×2 held each pose 0.6 s.
 */
export const RECOMMENDED_FRAMES = { idle: 8 };

/** Whether `sheet-prompt` attaches the layout guide when neither --guide nor
 *  --no-guide is given. Set from E2; see `references/prompting.md`. */
export const GUIDE_DEFAULT = false;

/** Every facing a motion or an anchor can have: the four of a top-down or
 *  side game, then the four diagonals an 8-direction (isometric) game adds.
 *  In compass terms, as an isometric game names them: front = S, back = N,
 *  left = W, right = E, front-left = SW, front-right = SE, back-left = NW,
 *  back-right = NE. `domain.ts`'s DIRECTIONS is the same tuple. */
export const DIRECTIONS = ["front", "back", "left", "right", "front-left", "front-right", "back-left", "back-right"];
/** The side view a mirror of each side view would be — the diagonals too:
 *  a front-left three-quarter view flipped is a front-right one. */
export const OPPOSITE = {
  left: "right", right: "left",
  "front-left": "front-right", "front-right": "front-left",
  "back-left": "back-right", "back-right": "back-left",
};

/** The camera a character is drawn from, when recorded (`character.view`). */
export const CHARACTER_VIEWS = ["side", "topdown", "isometric"];

/** The sentence every built prompt states for a recorded camera. Absent
 *  view, no sentence — exactly the text a 0.5.x character gets. */
export const VIEW_TEXT = {
  side: "Side-on game camera at the subject level, as in a 2D side-scroller.",
  topdown: "Top-down RPG camera, looking down at the subject from a high three-quarter angle, the way a classic top-down RPG shows its sprites.",
  isometric: "Isometric game camera: the subject is seen from an elevated three-quarter angle, looking down at about 30 degrees, as in a classic isometric RPG; the ground plane runs along the isometric diagonals.",
};

/**
 * Where the subject's OWN right and left side are in a picture facing each
 * way — the geometry a side-specific detail (a basket on the right arm, a
 * hairpin on the left) has to be placed by. Computed, not reasoned about:
 * the 2026-09-27 four-direction blind trial wrote "facing left, her right
 * side faces the viewer" into its own prompts — the opposite — and both side
 * walks carried the basket on the wrong side. Facing left (a pure profile
 * toward the left of the picture) the character has turned to its own right,
 * so its left side is the one toward the viewer; facing right, its right
 * side is. Every sheet prompt of an asymmetric character carries the
 * sentence for its facing, and `sprite-project.mjs sheet-prompt --json`
 * prints the whole table (`sides`) for the prompts written by hand — the
 * direction anchors.
 */
export const SIDE_GEOMETRY = {
  front: "Seen from the front, the subject's own right side is on the left of the picture and its own left side is on the right of the picture.",
  back: "Seen from behind, the subject's own right side is on the right of the picture and its own left side is on the left of the picture.",
  left: "Facing left, toward the left of the picture, the subject's own right side is the far side — turned away from the viewer and partly hidden behind the subject — and its own left side is the near side, toward the viewer.",
  right: "Facing right, toward the right of the picture, the subject's own right side is the near side, toward the viewer, and its own left side is the far side — turned away from the viewer and partly hidden behind the subject.",
  "front-left": "Facing down and to the left, a front three-quarter view, the subject's own left side is the near side, toward the viewer and on the right of the picture, and its own right side is the far side, on the left of the picture and partly hidden behind the subject.",
  "front-right": "Facing down and to the right, a front three-quarter view, the subject's own right side is the near side, toward the viewer and on the left of the picture, and its own left side is the far side, on the right of the picture and partly hidden behind the subject.",
  "back-left": "Facing up and to the left, a back three-quarter view turned away from the viewer, the subject's own left side is the near side, toward the viewer and on the left of the picture, and its own right side is the far side, on the right of the picture and partly hidden behind the subject.",
  "back-right": "Facing up and to the right, a back three-quarter view turned away from the viewer, the subject's own right side is the near side, toward the viewer and on the right of the picture, and its own left side is the far side, on the left of the picture and partly hidden behind the subject.",
};

/** The side-geometry sentence for a facing, and what it asks of every
 *  side-specific detail; null for a facing it has no sentence for. */
export function sideClause(direction) {
  const geometry = SIDE_GEOMETRY[direction];
  return geometry ? `${geometry} Place every side-specific detail by the subject's own right and left, as they fall in this view.` : null;
}

/** Words in a motion's id or label that name its state. First token wins,
 *  id before label. `--state` overrides. */
const STATE_WORDS = {
  idle: ["idle", "breathe", "breathing", "breath"],
  walk: ["walk", "walking", "stroll", "march", "marching"],
  run: ["run", "running", "sprint", "sprinting", "dash", "jog", "jogging"],
  jump: ["jump", "jumping", "hop", "hopping", "leap", "leaping"],
  attack: ["attack", "attacking", "slash", "strike", "swing", "punch", "kick", "stab", "thrust", "smash"],
  wave: ["wave", "waving", "greet", "greeting", "hello"],
  hurt: ["hurt", "hit", "damage", "damaged", "flinch", "stagger", "knockback"],
  death: ["death", "die", "dying", "dead", "defeat", "ko", "faint"],
  cast: ["cast", "casting", "spell", "magic", "summon", "channel"],
  guard: ["guard", "block", "blocking", "parry", "defend", "shield"],
  victory: ["victory", "win", "cheer", "celebrate", "celebration", "taunt"],
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const whole = (value) => Number.isInteger(value) && value > 0;

/** The grid a frame count is drawn on: rows of at most four cells, 4 frames
 *  as 2×2 (a 4:1 strip is past what the image model accepts). */
export function sheetGrid(frames) {
  if (!SHEET_FRAME_COUNTS.includes(frames)) {
    throw new Error(`--frames: a sheet holds ${SHEET_FRAME_COUNTS.join(", ")} frames, got ${frames} — more frames come from a clip`);
  }
  if (frames <= 3) return { rows: 1, cols: frames };
  if (frames === 4) return { rows: 2, cols: 2 };
  if (frames === 6) return { rows: 2, cols: 3 };
  if (frames === 9) return { rows: 3, cols: 3 };
  return { rows: frames / 4, cols: 4 };
}

/** The cell the image model draws: the subject's cell times the largest
 *  whole factor that keeps its longer side at most GENERATION_CELL_MAX. A
 *  whole factor keeps pixel art on an integer scale. */
export function generationCell(cell) {
  if (!cell || !whole(cell.width) || !whole(cell.height)) {
    throw new Error("the character has no cell size (character.cell)");
  }
  const k = Math.max(1, Math.floor(GENERATION_CELL_MAX / Math.max(cell.width, cell.height)));
  return { width: cell.width * k, height: cell.height * k };
}

export function safeMarginFor(cell, ratio = DEFAULT_SAFE_MARGIN_RATIO) {
  if (!(Number.isFinite(ratio) && ratio >= 0 && ratio < 0.5)) {
    throw new Error(`--margin: a share of the cell from 0 to below 0.5, got ${ratio}`);
  }
  return { x: Math.floor(cell.width * ratio), y: Math.floor(cell.height * ratio) };
}

/**
 * The layout guide's geometry: `rows` × `cols` cells of `cell` px, each with
 * its safe area inset by `safeMargin`. The picture is exactly the sheet's
 * size, so the model is shown the same pixels it is asked to fill.
 */
export function guideGeometry({ rows, cols, cell, safeMargin, margin = DEFAULT_SAFE_MARGIN_RATIO }) {
  if (!whole(rows) || !whole(cols)) throw new Error(`--rows/--cols: whole numbers of cells, got ${rows}x${cols}`);
  if (!cell || !whole(cell.width) || !whole(cell.height)) throw new Error("--cell: expected WxH in whole pixels");
  const inset = safeMargin ?? safeMarginFor(cell, margin);
  if (!(Number.isInteger(inset.x) && Number.isInteger(inset.y) && inset.x >= 0 && inset.y >= 0)
    || inset.x * 2 >= cell.width || inset.y * 2 >= cell.height) {
    throw new Error(`the safe margin ${inset.x}x${inset.y} does not fit inside a ${cell.width}x${cell.height} cell`);
  }
  return {
    rows, cols,
    cell: { width: cell.width, height: cell.height },
    safeMargin: { x: inset.x, y: inset.y },
    width: cols * cell.width,
    height: rows * cell.height,
  };
}

/** The sheet a motion asks for: its grid, the generation cell and margin,
 *  and the image size the call has to pin (`--image-size`). */
export function sheetGeometry(grid, characterCell) {
  const cell = generationCell(characterCell);
  const g = guideGeometry({ rows: grid.rows, cols: grid.cols, cell });
  return { ...g, imageSize: `${g.width}x${g.height}` };
}

const GUIDE_BACKGROUND = [0xf6, 0xf6, 0xf6];
const GUIDE_SLOT = [0x33, 0x33, 0x33];
const GUIDE_SAFE = [0x2f, 0x80, 0xed];
const GUIDE_CENTRE = [0xb8, 0xc8, 0xe8];

/**
 * The layout guide as RGBA pixels: a light grey canvas, a dark 3 px box on
 * each cell's edge, a blue 2 px box on its safe area and a thin vertical
 * centre line through the safe area.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/gen/prepare.py@fbd1a08
 * `draw_guide` (:728-750): same colours, widths and inset boxes (PIL draws a
 * box's outline inward from its edge). Changes: a grid of rows instead of one
 * strip, the centre line kept inside its own cell, RGBA out.
 */
export function guideRaster(geometry) {
  const { width, height, rows, cols, cell, safeMargin } = geometry;
  const data = new Uint8Array(width * height * 4);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, GUIDE_BACKGROUND);
  const box = (x0, y0, x1, y1, colour, lineWidth) => {
    for (let k = 0; k < lineWidth; k++) {
      const [a, b, c, d] = [x0 + k, y0 + k, x1 - k, y1 - k];
      if (a > c || b > d) return;
      for (let x = a; x <= c; x++) { put(x, b, colour); put(x, d, colour); }
      for (let y = b; y <= d; y++) { put(a, y, colour); put(c, y, colour); }
    }
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const left = col * cell.width;
      const top = row * cell.height;
      const right = left + cell.width - 1;
      const bottom = top + cell.height - 1;
      box(left, top, right, bottom, GUIDE_SLOT, 3);
      box(left + safeMargin.x, top + safeMargin.y, right - safeMargin.x, bottom - safeMargin.y, GUIDE_SAFE, 2);
      const cx = left + Math.floor(cell.width / 2);
      for (let y = top + safeMargin.y; y <= Math.min(bottom, top + cell.height - safeMargin.y); y++) put(cx, y, GUIDE_CENTRE);
    }
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** The state a motion's id or label names, or "generic". */
export function stateOf(motion) {
  const tokens = [motion?.id, motion?.label]
    .filter((s) => typeof s === "string")
    .flatMap((s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  for (const token of tokens) {
    for (const state of SHEET_STATES) {
      if (STATE_WORDS[state].includes(token)) return state;
    }
  }
  return "generic";
}

/**
 * The clause ids a sheet prompt carries, in the order `promptParts.guards`
 * records them. Only the conditional clauses have ids: everything said in
 * every sheet prompt is pinned by the builder version instead.
 */
export function sheetGuards({ character, motion, state, anchor = false, guide = false, rhythm = null }) {
  const guards = [];
  const height = character?.pixel?.logicalHeight;
  if (whole(height)) guards.push(`pixel:${height}`);
  if (guide) guards.push("guide");
  if (motion.direction) {
    if (!DIRECTIONS.includes(motion.direction)) throw new Error(`unknown direction '${motion.direction}'`);
    guards.push(`direction:${motion.direction}`);
    if (anchor) guards.push(`anchor:${motion.direction}`);
  }
  const asymmetric = typeof character?.asymmetric === "string" && character.asymmetric.trim() !== "";
  if (asymmetric) guards.push("asymmetric");
  if (rhythm) {
    // The finished other side of an asymmetric side view, attached for its
    // timing alone. It exists because that side could not be mirrored.
    if (!asymmetric || OPPOSITE[motion.direction] !== rhythm) {
      throw new Error(`a rhythm sheet facing ${rhythm} goes only with an asymmetric character's ${OPPOSITE[rhythm] ?? "side"}-facing motion`);
    }
    guards.push(`rhythm:${rhythm}`);
  }
  guards.push(`state:${state}`);
  if (motion.grid.rows > 1) guards.push("row-continuity");
  guards.push(motion.loop ? "loop-close" : "one-shot-end");
  return guards;
}

/** Read a guard list back into what the text needs, refusing an id this
 *  builder version does not know — it could not have written it. */
function readGuards(guards) {
  const read = { pixel: null, guide: false, direction: null, anchor: null, asymmetric: false, rhythm: null, state: null, rowContinuity: false, ending: null };
  for (const id of guards) {
    let m;
    if ((m = /^pixel:(\d+)$/.exec(id)) && Number(m[1]) > 0) read.pixel = Number(m[1]);
    else if (id === "guide") read.guide = true;
    else if ((m = /^direction:([\w-]+)$/.exec(id)) && DIRECTIONS.includes(m[1])) read.direction = m[1];
    else if ((m = /^anchor:([\w-]+)$/.exec(id)) && DIRECTIONS.includes(m[1])) read.anchor = m[1];
    else if (id === "asymmetric") read.asymmetric = true;
    else if ((m = /^rhythm:([\w-]+)$/.exec(id)) && OPPOSITE[m[1]]) read.rhythm = m[1];
    else if ((m = /^state:(\w+)$/.exec(id)) && (SHEET_STATES.includes(m[1]) || m[1] === "generic")) read.state = m[1];
    else if (id === "row-continuity") read.rowContinuity = true;
    else if (id === "loop-close" || id === "one-shot-end") read.ending = id;
    else throw new Error(`${SHEET_PROMPT_BUILDER} does not know the clause '${id}'`);
  }
  if (!read.state) throw new Error("the guards name no state (state:<name>)");
  if (!read.ending) throw new Error("the guards name no ending (loop-close or one-shot-end)");
  if (read.anchor && read.anchor !== read.direction) throw new Error(`anchor:${read.anchor} without direction:${read.anchor}`);
  if (read.rhythm && (!read.asymmetric || read.direction !== OPPOSITE[read.rhythm])) {
    throw new Error(`rhythm:${read.rhythm} needs asymmetric and direction:${OPPOSITE[read.rhythm]}`);
  }
  return read;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** A sentence as given, closed with a full stop when it has no end mark, so
 *  the next clause does not run on from it. The words are not touched. */
const closed = (text) => {
  const t = text.trim();
  return /[.!?]["')\]]?$/.test(t) ? t : `${t}.`;
};

const FACING_LOCK = {
  front: "Every cell faces the viewer (front view); lock the whole sheet to that facing and do not drift into a three-quarter or side view.",
  back: "Every cell faces away from the viewer (back view); lock the whole sheet to that facing and do not drift into a three-quarter or side view.",
  right: "Every cell is a pure side profile facing camera-right; lock the whole sheet to that facing and do not drift into a front or three-quarter view.",
  left: "Every cell is a pure side profile facing camera-left; lock the whole sheet to that facing and do not drift into a front or three-quarter view.",
  "front-left": "Every cell is a front three-quarter view facing down and to the camera-left; lock the whole sheet to that facing and do not drift into a front, side or back view.",
  "front-right": "Every cell is a front three-quarter view facing down and to the camera-right; lock the whole sheet to that facing and do not drift into a front, side or back view.",
  "back-left": "Every cell is a back three-quarter view facing up and to the camera-left, turned away from the viewer; lock the whole sheet to that facing and do not drift into a back, side or front view.",
  "back-right": "Every cell is a back three-quarter view facing up and to the camera-right, turned away from the viewer; lock the whole sheet to that facing and do not drift into a back, side or front view.",
};

/** An explicit action owns the phases; the inferred state adds no anatomy. */
function stateText(state) {
  return `${state === "generic" ? "Animate the requested action" : `This is ${state === "idle" || state === "attack" ? "an" : "a"} ${state} motion`}: follow the explicit action and the described subject structure, using only features the subject actually has. The action determines the phases, deformation, materials and effects; do not add anatomy or movements from the state name.`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The prompt text for recorded parts. Deterministic: the same character,
 * motion grid and parts give the same string, byte for byte. The geometry
 * is the recorded guide's when there is one, else the motion's grid on the
 * character's generation cell.
 */
export function renderSheetPrompt({ character, motion }, parts) {
  if (!parts || parts.builder !== SHEET_PROMPT_BUILDER) {
    throw new Error(`this builder is ${SHEET_PROMPT_BUILDER}; it cannot render parts built by ${parts?.builder ?? "nothing"}`);
  }
  const style = typeof character?.style === "string" ? character.style.trim() : "";
  if (!style) throw new Error("the character has no style sentence — record it first (set-character --style \"…\")");
  const action = typeof parts.action === "string" ? parts.action.trim() : "";
  if (!action) throw new Error("--action: the motion plan is required — the phases by cell, in your words");
  const g = readGuards(parts.guards);
  if (g.guide && !parts.guide) throw new Error("the guide clause needs the guide's geometry (parts.guide)");
  const geo = parts.guide
    ? guideGeometry({ rows: parts.guide.rows, cols: parts.guide.cols, cell: parts.guide.cell, safeMargin: parts.guide.safeMargin })
    : sheetGeometry(motion.grid, character.cell);
  const n = geo.rows * geo.cols;
  const { cell, safeMargin: m } = geo;
  const description = typeof character.description === "string" ? character.description.trim() : "";

  const text = [];
  // 1. The style anchor, verbatim, then what pixel art adds to it.
  text.push(closed(style));
  if (g.pixel) {
    text.push(`Pixel art, ${g.pixel} logical pixels tall: every logical pixel is a crisp square block of one flat colour, with the same block size in every cell and the same pixel density as the references; hard pixel edges, no anti-aliasing, no gradients, no dithering.`);
  }
  // 2. The grid, and how a frame sits in its cell.
  text.push(`A single ${geo.width}x${geo.height} image laid out as a strict ${geo.cols}x${geo.rows} grid of ${n} equal ${cell.width}x${cell.height} cells, ${plural(geo.cols, "column")} and ${plural(geo.rows, "row")}, read left to right, top to bottom.`);
  const margin = m.x === m.y
    ? `at least ${m.x} px of empty background on every side`
    : `at least ${m.x} px of empty background left and right and ${m.y} px above and below`;
  text.push(`Each cell holds the whole subject exactly once, centred in the cell, with ${margin} — all requested motion and effects included — and nothing crosses into a neighbouring cell.`);
  if (g.guide) {
    text.push(`The last attached image is the layout guide for this sheet: its dark boxes are the ${n} cells, the blue boxes inside them the safe area every frame stays within, and the thin vertical lines the cell centres. Follow its cell count, spacing, centring and padding, and do not draw it: no boxes, guide lines, centre marks, guide colours or grey background anywhere in the output.`);
  }
  // 3. The subject, its facing, and identity over motion.
  text.push("The same subject in every cell, matching the attached references exactly.");
  if (description) text.push(closed(description));
  text.push("Preserve the described materials, including intentional translucency, emission and pale details; the white plate is only the background.");
  if (g.direction) text.push(FACING_LOCK[g.direction]);
  else if (character.facing === "left" || character.facing === "right") text.push(`The subject faces ${character.facing}.`);
  if (g.anchor) {
    text.push(`The attached ${g.anchor}-facing anchor is authoritative for that facing: match its view in every cell, while the other references carry the identity.`);
  }
  if (VIEW_TEXT[character.view]) text.push(VIEW_TEXT[character.view]);
  text.push("Fixed camera: consistent reference scale and camera distance in every cell, and any ground contacts specified by the action share one baseline.");
  text.push("The references and description own the subject's identity and structure. Preserve its defining details and side-specific features while allowing the changes of shape, colour, size and opacity requested by the action. Do not invent features absent from the subject.");
  if (g.asymmetric) {
    const sentence = typeof character.asymmetric === "string" ? character.asymmetric.trim() : "";
    if (!sentence) throw new Error("the asymmetric clause needs character.asymmetric");
    text.push(`These details are side-specific and never flip or change sides in any cell: ${closed(sentence)}`);
    // Where "right" and "left" land in this view, spelled out: the facing
    // the prompt states is the one the sentence is for.
    const facing = g.direction ?? (character.facing === "left" || character.facing === "right" ? character.facing : null);
    const sides = facing ? sideClause(facing) : null;
    if (sides) text.push(sides);
  }
  // 4. The motion: the agent's plan, then what the state and the grid demand.
  text.push(`The motion (${plural(n, "frame")}, ${g.ending === "loop-close" ? "looping" : "played once"}): ${closed(action)}`);
  if (g.rhythm) {
    // The attach order is references, this sheet, then the guide: the guide
    // keeps "last", which its own clause has always said.
    text.push(`The ${g.guide ? "second-to-last attached image, just before the layout guide," : "last attached image"} is the finished ${g.rhythm}-facing sheet of this same motion, for rhythm only: match its phase timing and reference scale cell for cell, and take nothing else from it — not its facing, and not the side any detail is on.`);
  }
  text.push(stateText(g.state));
  if (g.rowContinuity) {
    text.push("The motion runs straight on across row ends: the first cell of each row continues from the last cell of the row above by the same small step as the cells within a row.");
  }
  text.push(g.ending === "loop-close"
    ? `Cell ${n} leads smoothly into cell 1 on the next beat, with compatible movement direction and without an extra hold.`
    : `Cell ${n} is the pose the motion ends on.`);
  text.push("Include the effects and material changes requested by the action as part of the subject, within the same safe area; add no unrelated decoration.");
  // 5. The white plate and the negatives the cut-out needs.
  text.push("A flat solid pure white background filling every cell, no gradient. No grid lines, no cell borders, no numbers, no text, no floor, no drop shadow, no ground shadow, no motion blur.");
  return text.join(" ");
}

/**
 * Build a sheet prompt for a motion: choose the guards, record the parts,
 * render the text. `refs` is the sidecar's ref list — an anchor facing the
 * motion's direction is attached and named; anchors facing elsewhere are not.
 * `rhythm` is the direction of a finished sheet of this motion's other side
 * that the caller will attach after the references (an asymmetric
 * character's second side); the caller finds it, because this module sees
 * no other motion.
 */
export function buildSheetPrompt({ character, motion, refs = [], action, state, guide = false, rhythm = null }) {
  const chosen = state ?? stateOf(motion);
  if (!(SHEET_STATES.includes(chosen) || chosen === "generic")) {
    throw new Error(`--state: expected ${[...SHEET_STATES, "generic"].join(", ")}, got '${chosen}'`);
  }
  const anchorRef = motion.direction
    ? refs.find((r) => r.role === "anchor" && r.direction === motion.direction) ?? null
    : null;
  const geometry = sheetGeometry(motion.grid, character?.cell);
  const parts = {
    builder: SHEET_PROMPT_BUILDER,
    action: typeof action === "string" ? action.trim() : "",
    guards: sheetGuards({ character, motion, state: chosen, anchor: Boolean(anchorRef), guide, rhythm }),
    ...(guide ? {
      guide: {
        rows: geometry.rows, cols: geometry.cols,
        cell: { ...geometry.cell }, safeMargin: { ...geometry.safeMargin },
      },
    } : {}),
  };
  const prompt = renderSheetPrompt({ character, motion }, parts);
  // What the text says is attached, in the order the direction-anchor
  // recipe was measured with (prompting.md, "Direction anchors", E7): the
  // anchor for this direction first, then every other reference in the
  // order it was registered — anchors facing another way left out. The
  // caller appends the rhythm sheet and then the guide, in that order: the
  // text names both by their place from the end. The reference order is
  // not in the text, so it is not in the parts.
  const attach = [
    ...(anchorRef ? [anchorRef.id] : []),
    ...refs.filter((r) => r.role !== "anchor").map((r) => r.id),
  ];
  return { prompt, parts, state: chosen, geometry, attach };
}

// ---------------------------------------------------------------------------
// The GIF prompt — the same character, one animated GIF instead of a sheet
// ---------------------------------------------------------------------------

/** The version of the GIF text below; bumps with any change to a sentence. */
export const GIF_PROMPT_BUILDER = "gif-prompt/2";

/** The frame counts a GIF motion is drawn at — 8, 12 and 16 were measured
 *  (2026-11-05); fal accepts up to 64, but nothing past 16 has been looked at. */
export const GIF_FRAME_RANGE = Object.freeze({ min: 2, max: 16 });

/**
 * A sheet sentence said of a GIF. The state guards and facing locks were
 * written, and measured, for cells of a sheet; the GIF prompt says the same
 * things of frames of one animation, through this one fixed mapping, so
 * there is one text per guard. A sentence that still names a cell, a sheet
 * or a grid afterwards is a guard this mapping does not cover yet: refused,
 * not sent.
 */
const GIF_WORDING = [
  ["inside the safe area of its own cell", "inside the frame with a clear margin"],
  ["inside its own cell", "inside the frame"],
  ["inside the safe area", "inside the frame with a clear margin"],
  ["across the cell", "across the frame"],
  ["in every cell", "in every frame"],
  ["in one cell at most", "in one frame at most"],
  ["Every cell", "Every frame"],
  ["the whole sheet", "the whole animation"],
];

export function gifWording(sentence) {
  let text = sentence;
  for (const [from, to] of GIF_WORDING) text = text.split(from).join(to);
  const left = /\b(cells?|sheets?|grids?)\b/i.exec(text);
  if (left) throw new Error(`${GIF_PROMPT_BUILDER}: the sentence still speaks of a ${left[1].toLowerCase()} — add its wording to GIF_WORDING: ${text}`);
  return text;
}

/** The clause ids a GIF prompt carries, in the order its parts record them. */
export function gifGuards({ character, motion, state, frames, anchor = false }) {
  if (!Number.isInteger(frames) || frames < GIF_FRAME_RANGE.min || frames > GIF_FRAME_RANGE.max) {
    throw new Error(`--frames: a GIF motion is drawn at ${GIF_FRAME_RANGE.min} to ${GIF_FRAME_RANGE.max} frames (got ${frames})`);
  }
  const guards = [`frames:${frames}`];
  if (motion.direction) {
    if (!DIRECTIONS.includes(motion.direction)) throw new Error(`unknown direction '${motion.direction}'`);
    guards.push(`direction:${motion.direction}`);
    if (anchor) guards.push(`anchor:${motion.direction}`);
  }
  if (typeof character?.asymmetric === "string" && character.asymmetric.trim() !== "") guards.push("asymmetric");
  guards.push(`state:${state}`);
  guards.push(motion.loop ? "loop-close" : "one-shot-end");
  return guards;
}

function readGifGuards(guards) {
  const read = { frames: null, direction: null, anchor: null, asymmetric: false, state: null, ending: null };
  for (const id of guards) {
    let m;
    if ((m = /^frames:(\d+)$/.exec(id)) && Number(m[1]) >= GIF_FRAME_RANGE.min && Number(m[1]) <= GIF_FRAME_RANGE.max) read.frames = Number(m[1]);
    else if ((m = /^direction:([\w-]+)$/.exec(id)) && DIRECTIONS.includes(m[1])) read.direction = m[1];
    else if ((m = /^anchor:([\w-]+)$/.exec(id)) && DIRECTIONS.includes(m[1])) read.anchor = m[1];
    else if (id === "asymmetric") read.asymmetric = true;
    else if ((m = /^state:(\w+)$/.exec(id)) && (SHEET_STATES.includes(m[1]) || m[1] === "generic")) read.state = m[1];
    else if (id === "loop-close" || id === "one-shot-end") read.ending = id;
    else throw new Error(`${GIF_PROMPT_BUILDER} does not know the clause '${id}'`);
  }
  if (!read.frames) throw new Error("the guards name no frame count (frames:<n>)");
  if (!read.state) throw new Error("the guards name no state (state:<name>)");
  if (!read.ending) throw new Error("the guards name no ending (loop-close or one-shot-end)");
  if (read.anchor && read.anchor !== read.direction) throw new Error(`anchor:${read.anchor} without direction:${read.anchor}`);
  return read;
}

/**
 * The GIF prompt text for recorded parts — the sheet prompt's grammar (style
 * anchor verbatim, subject and identity, motion, background) with frames of
 * one animation where the sheet has cells of a grid, and a transparent
 * background where the sheet has a white plate: a GIF is asked for with
 * `background: transparent` and its 1-bit alpha is used as it comes.
 * Deterministic: the same character, motion and parts give the same string.
 */
export function renderGifPrompt({ character, motion }, parts) {
  if (!parts || parts.builder !== GIF_PROMPT_BUILDER) {
    throw new Error(`this builder is ${GIF_PROMPT_BUILDER}; it cannot render parts built by ${parts?.builder ?? "nothing"}`);
  }
  const style = typeof character?.style === "string" ? character.style.trim() : "";
  if (!style) throw new Error("the character has no style sentence — record it first (set-character --style \"…\")");
  if (whole(character?.pixel?.logicalHeight)) {
    throw new Error("a pixel-art character's frames are snapped onto its pixel lattice and quantised to its pinned palette, which from-gif does not do — draw its motions as sheets (run --pixel)");
  }
  const action = typeof parts.action === "string" ? parts.action.trim() : "";
  if (!action) throw new Error("--action: the motion plan is required — the phases by frame, in your words");
  const g = readGifGuards(parts.guards);
  const n = g.frames;
  const description = typeof character.description === "string" ? character.description.trim() : "";

  const text = [];
  // 1. The style anchor, verbatim.
  text.push(closed(style));
  // 2. What the file is, and how the character sits in every frame.
  text.push(`One animated GIF of ${n} frames on one fixed canvas: the whole subject exactly once in every frame, at a consistent reference scale, allowing the size changes requested by the action, with a clear margin of empty background on every side — all requested motion and effects included — and nothing cut off by the edge of the frame.`);
  // 3. The subject, its facing, and identity over motion.
  text.push("The same subject in every frame, matching the attached references exactly.");
  if (description) text.push(closed(description));
  text.push("Preserve the described materials, including intentional translucency, emission and pale details; transparency outside the subject is the background.");
  if (g.direction) text.push(gifWording(FACING_LOCK[g.direction]));
  else if (character.facing === "left" || character.facing === "right") text.push(`The subject faces ${character.facing}.`);
  if (g.anchor) {
    text.push(`The attached ${g.anchor}-facing anchor is authoritative for that facing: match its view in every frame, while the other references carry the identity.`);
  }
  if (VIEW_TEXT[character.view]) text.push(VIEW_TEXT[character.view]);
  text.push("Fixed camera: consistent reference scale and camera distance in every frame, and any ground contacts specified by the action share one baseline.");
  text.push("The references and description own the subject's identity and structure. Preserve its defining details and side-specific features while allowing the changes of shape, colour, size and opacity requested by the action. Do not invent features absent from the subject.");
  if (g.asymmetric) {
    const sentence = typeof character.asymmetric === "string" ? character.asymmetric.trim() : "";
    if (!sentence) throw new Error("the asymmetric clause needs character.asymmetric");
    text.push(`These details are side-specific and never flip or change sides in any frame: ${closed(sentence)}`);
    const facing = g.direction ?? (character.facing === "left" || character.facing === "right" ? character.facing : null);
    const sides = facing ? sideClause(facing) : null;
    if (sides) text.push(sides);
  }
  // 4. The motion: the agent's plan, then what the state demands.
  text.push(`The motion (${plural(n, "frame")}, ${g.ending === "loop-close" ? "looping" : "played once"}): ${closed(action)}`);
  text.push(gifWording(stateText(g.state)));
  text.push(g.ending === "loop-close"
    ? `Frame ${n} leads smoothly into frame 1 on the next beat, with compatible movement direction and without an extra hold: it is the pose just before frame 1, not a copy of it.`
    : `Frame ${n} is the pose the motion ends on.`);
  text.push("Include the effects and material changes requested by the action as part of the subject, within the same safe area; add no unrelated decoration.");
  // 5. The background.
  text.push("A fully transparent background in every frame. No floor, no ground line, no drop shadow, no ground shadow, no scenery, no text, no motion blur.");
  return text.join(" ");
}

/**
 * Build a GIF prompt for a motion: choose the guards, record the parts,
 * render the text. The references are attached in the order a sheet attaches
 * them (`buildSheetPrompt`): this direction's anchor first, then every other
 * reference as registered.
 */
export function buildGifPrompt({ character, motion, refs = [], action, state, frames }) {
  const chosen = state ?? stateOf(motion);
  if (!(SHEET_STATES.includes(chosen) || chosen === "generic")) {
    throw new Error(`--state: expected ${[...SHEET_STATES, "generic"].join(", ")}, got '${chosen}'`);
  }
  const anchorRef = motion.direction
    ? refs.find((r) => r.role === "anchor" && r.direction === motion.direction) ?? null
    : null;
  const parts = {
    builder: GIF_PROMPT_BUILDER,
    action: typeof action === "string" ? action.trim() : "",
    guards: gifGuards({ character, motion, state: chosen, frames, anchor: Boolean(anchorRef) }),
  };
  const prompt = renderGifPrompt({ character, motion }, parts);
  const attach = [
    ...(anchorRef ? [anchorRef.id] : []),
    ...refs.filter((r) => r.role !== "anchor").map((r) => r.id),
  ];
  return { prompt, parts, state: chosen, frames, attach };
}
