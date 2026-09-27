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
 * `row_prompt` (:753-826): a code-built prompt where the caller owns the
 * action and code owns identity, layout and guards. The anchor-lock lines
 * ("This row owns motion only…", "Prefer a subtler animation over any change
 * that mutates the character identity") are adapted from a one-row strip on a
 * chroma key to our grid sheet on a white plate. Where the two disagree our
 * grammar wins: white plate, not chroma; one paragraph in grammar order, not
 * a sectioned spec; no "authoritative spec" preamble.
 */

/** The version of the text below. Any change to a sentence bumps it: a
 *  recorded `promptParts.builder` has to keep meaning the words it produced. */
export const SHEET_PROMPT_BUILDER = "sheet-prompt/1";

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

/** The motion families with guards of their own; anything else is generic. */
export const SHEET_STATES = ["idle", "walk", "run", "jump", "attack", "wave"];

/**
 * Frame counts measured to read best, per state. idle: E1 (2026-09-27,
 * Lumi) — 8 frames as 4 columns × 2 rows read best in both takes; 4×4 showed
 * row-boundary or wrap pops, 2×2 held each pose 0.6 s.
 */
export const RECOMMENDED_FRAMES = { idle: 8 };

/** Whether `sheet-prompt` attaches the layout guide when neither --guide nor
 *  --no-guide is given. Set from E2; see `references/prompting.md`. */
export const GUIDE_DEFAULT = false;

const DIRECTIONS = ["front", "back", "left", "right"];

/** Words in a motion's id or label that name its state. First token wins,
 *  id before label. `--state` overrides. */
const STATE_WORDS = {
  idle: ["idle", "breathe", "breathing", "breath"],
  walk: ["walk", "walking", "stroll", "march", "marching"],
  run: ["run", "running", "sprint", "sprinting", "dash", "jog", "jogging"],
  jump: ["jump", "jumping", "hop", "hopping", "leap", "leaping"],
  attack: ["attack", "attacking", "slash", "strike", "swing", "punch", "kick", "stab", "thrust", "smash"],
  wave: ["wave", "waving", "greet", "greeting", "hello"],
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

/** The cell the image model draws: the character's cell times the largest
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
export function sheetGuards({ character, motion, state, anchor = false, guide = false }) {
  const guards = [];
  const height = character?.pixel?.logicalHeight;
  if (whole(height)) guards.push(`pixel:${height}`);
  if (guide) guards.push("guide");
  if (motion.direction) {
    if (!DIRECTIONS.includes(motion.direction)) throw new Error(`unknown direction '${motion.direction}'`);
    guards.push(`direction:${motion.direction}`);
    if (anchor) guards.push(`anchor:${motion.direction}`);
  }
  if (typeof character?.asymmetric === "string" && character.asymmetric.trim()) guards.push("asymmetric");
  guards.push(`state:${state}`);
  if (motion.grid.rows > 1) guards.push("row-continuity");
  guards.push(motion.loop ? "loop-close" : "one-shot-end");
  return guards;
}

/** Read a guard list back into what the text needs, refusing an id this
 *  builder version does not know — it could not have written it. */
function readGuards(guards) {
  const read = { pixel: null, guide: false, direction: null, anchor: null, asymmetric: false, state: null, rowContinuity: false, ending: null };
  for (const id of guards) {
    let m;
    if ((m = /^pixel:(\d+)$/.exec(id)) && Number(m[1]) > 0) read.pixel = Number(m[1]);
    else if (id === "guide") read.guide = true;
    else if ((m = /^direction:(\w+)$/.exec(id)) && DIRECTIONS.includes(m[1])) read.direction = m[1];
    else if ((m = /^anchor:(\w+)$/.exec(id)) && DIRECTIONS.includes(m[1])) read.anchor = m[1];
    else if (id === "asymmetric") read.asymmetric = true;
    else if ((m = /^state:(\w+)$/.exec(id)) && (SHEET_STATES.includes(m[1]) || m[1] === "generic")) read.state = m[1];
    else if (id === "row-continuity") read.rowContinuity = true;
    else if (id === "loop-close" || id === "one-shot-end") read.ending = id;
    else throw new Error(`${SHEET_PROMPT_BUILDER} does not know the clause '${id}'`);
  }
  if (!read.state) throw new Error("the guards name no state (state:<name>)");
  if (!read.ending) throw new Error("the guards name no ending (loop-close or one-shot-end)");
  if (read.anchor && read.anchor !== read.direction) throw new Error(`anchor:${read.anchor} without direction:${read.anchor}`);
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
  back: "Every cell faces away from the viewer (back view, no visible face); lock the whole sheet to that facing and do not drift into a three-quarter or side view.",
  right: "Every cell is a pure side profile facing camera-right; lock the whole sheet to that facing and do not drift into a front or three-quarter view.",
  left: "Every cell is a pure side profile facing camera-left; lock the whole sheet to that facing and do not drift into a front or three-quarter view.",
};

/**
 * One guard per state. Ported (text) from aldegad/sprite-gen (Apache-2.0)
 * sprite_gen/gen/prepare.py@fbd1a08 `STATE_REQUIREMENTS` (:71-136) — walk /
 * run / frontwalk / wave / jump — and `video/batch.py` `HOLD_TEXT` (the
 * attack grip lines) and `MOTION_TEXT` idle (the planted-feet line). Changes:
 * idle and attack have no upstream row requirement and are written from our
 * idle recipe and upstream's default attack action; "in place" is added to
 * walk and run because a sheet cell does not travel; jump says "one jump"
 * and asks for headroom inside the safe area.
 */
function stateText(state, direction) {
  const frontal = direction === "front" || direction === "back"
    ? ` Seen from the ${direction}, the gait reads through alternating leg, arm, shoulder and body-height changes: make the contact and passing poses visibly different without changing the identity.`
    : "";
  switch (state) {
    case "idle":
      return "This is an idle: the feet, or whatever the character rests on, stay planted on the same baseline in every cell and never lift, step, shuffle or slide — no walking, no marching in place, no turning, no change of facing. The eyes close in one cell at most.";
    case "walk":
      return `This is a walk in place: the character walks on the spot and does not travel across the cell. Show it through body, arm, leg, hair and prop movement, with distinct gait poses — support passing from foot to foot and the feet trading forward reach — rather than repeated standing or bobbing. No speed lines, dust clouds, floor shadows or motion trails.${frontal}`;
    case "run":
      return `This is a run in place: the character runs on the spot with a bounding rhythm and does not travel across the cell. Show it through body, arm, leg, hair and prop movement, with distinct gait poses — clear repeating ground contacts and the feet trading forward reach — rather than repeated standing or bobbing. No speed lines, dust clouds, floor shadows or motion trails.${frontal}`;
    case "jump":
      return "This is one jump, not repeated hops, shown through pose and vertical body position only: anticipation, lift, airborne peak, descent, settle. Draw the character small enough that the airborne peak stays inside the safe area of its own cell. No ground shadows, contact shadows, landing marks, dust, smears or motion marks under the character.";
    case "attack":
      return "This is an attack made with the body and what it already holds: windup, strike, follow-through, recovery. Every grip stays as the references show — one hand stays one hand, both hands stay both hands, nothing is let go or switched to the other hand — and a hand the attack does not use keeps what it holds where it is. The weapon or prop stays inside the safe area of its own cell in every phase. No slash arcs, speed lines, impact flashes, sparks or trails.";
    case "wave":
      return "This is a gesture made with the arm alone — arm down, arm raised, hand tilted, arm returning; the feet stay planted unless the action asks for a step. No wave marks, motion arcs, lines, sparkles or symbols around the hand.";
    default:
      return "Carry the action in the body — pose, weight and contacts — one readable phase after the next.";
  }
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
  text.push(`Each cell holds the whole character exactly once, centred in the cell, with ${margin} — anything the character holds or wears that moves included — and nothing crosses into a neighbouring cell.`);
  if (g.guide) {
    text.push(`The last attached image is the layout guide for this sheet: its dark boxes are the ${n} cells, the blue boxes inside them the safe area every frame stays within, and the thin vertical lines the cell centres. Follow its cell count, spacing, centring and padding, and do not draw it: no boxes, guide lines, centre marks, guide colours or grey background anywhere in the output.`);
  }
  // 3. The subject, its facing, and identity over motion.
  text.push("The same character in every cell, matching the attached references exactly.");
  if (description) text.push(closed(description));
  text.push("Keep white and pale details inside the character — highlights, eye whites, pale hair or clothing — fully opaque; only the background is white.");
  if (g.direction) text.push(FACING_LOCK[g.direction]);
  else if (character.facing === "left" || character.facing === "right") text.push(`The character faces ${character.facing}.`);
  if (g.anchor) {
    text.push(`The attached ${g.anchor}-facing anchor is authoritative for that facing: match its view in every cell, while the other references carry the identity.`);
  }
  text.push("Fixed camera: consistent body proportions, drawing scale and camera distance in every cell, and ground contacts share one baseline while the character stands on the ground.");
  text.push("The references own the identity — face, hair shape, markings, palette, outline weight, proportions, outfit and props stay exactly as they show, and whatever is worn or held on one side stays on that side. This sheet owns motion only: spend the variation on pose, limb contacts, body height, torso lean, head bob, and hair and cloth follow-through. Prefer a subtler animation over any change that alters the character's identity.");
  if (g.asymmetric) {
    const sentence = typeof character.asymmetric === "string" ? character.asymmetric.trim() : "";
    if (!sentence) throw new Error("the asymmetric clause needs character.asymmetric");
    text.push(`These details are side-specific and never flip or change sides in any cell: ${closed(sentence)}`);
  }
  // 4. The motion: the agent's plan, then what the state and the grid demand.
  text.push(`The motion (${plural(n, "frame")}, ${g.ending === "loop-close" ? "looping" : "played once"}): ${closed(action)}`);
  text.push(stateText(g.state, g.direction));
  if (g.rowContinuity) {
    text.push("The motion runs straight on across row ends: the first cell of each row continues from the last cell of the row above by the same small step as the cells within a row.");
  }
  text.push(g.ending === "loop-close"
    ? `Cell ${n} leads smoothly into cell 1 on the next beat, with compatible movement direction and without an extra hold.`
    : `Cell ${n} is the pose the motion ends on.`);
  text.push("Show it through pose, expression and silhouette, never through effects: nothing detached from the character — no floating sparkles, symbols, smoke, dust, motion arcs, speed lines, afterimages, smears, glows or impact bursts.");
  // 5. The white plate and the negatives the cut-out needs.
  text.push("A flat solid pure white background filling every cell, no gradient. No grid lines, no cell borders, no numbers, no text, no floor, no drop shadow, no ground shadow, no motion blur.");
  return text.join(" ");
}

/**
 * Build a sheet prompt for a motion: choose the guards, record the parts,
 * render the text. `refs` is the sidecar's ref list — an anchor facing the
 * motion's direction is attached and named; anchors facing elsewhere are not.
 */
export function buildSheetPrompt({ character, motion, refs = [], action, state, guide = false }) {
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
    guards: sheetGuards({ character, motion, state: chosen, anchor: Boolean(anchorRef), guide }),
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
  // order it was registered — anchors facing another way left out — and the
  // guide last. The order is not in the text, so it is not in the parts.
  const attach = [
    ...(anchorRef ? [anchorRef.id] : []),
    ...refs.filter((r) => r.role !== "anchor").map((r) => r.id),
  ];
  return { prompt, parts, state: chosen, geometry, attach };
}
