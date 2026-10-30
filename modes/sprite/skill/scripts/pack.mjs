/**
 * pack.mjs — the facing sheet and the pack clip: what an 8-direction (or
 * 4-direction) character asks the image and video models for, and the grid
 * geometry both share.
 *
 * Pure: no files, no ffmpeg, no clock. `sprite-project.mjs` records the
 * text (`facing-prompt`, `pack-prompt`); `sprite-sheet.mjs pack-split` and
 * `split-facings` cut by the same layout.
 *
 * Why one picture and one clip. Drawn one direction at a time, a character
 * drifts between facings — each anchor and each clip is a separate roll of
 * the dice — and eight clips cost eight times one. Measured on 2026-10-30
 * (Pip, the 0.6.0 spike): GPT Image 2.5 drew all eight facings on one 3×3
 * sheet on-model, the satchel on the right hip in every view, and ONE
 * Seedance 2.5 clip of that sheet walked all eight in place, none turning,
 * none leaving its cell, for $0.83 at 480p (≈213 px a cell) or $1.87 at
 * 720p (≈320 px). The same layout is AutoSprite's 8-direction pack (its API
 * returns the facings in exactly this row-major order).
 */

import { DIRECTIONS, VIEW_TEXT, sideClause } from "./sheet-prompt.mjs";

/** The version of the text below; any change to a sentence bumps it. */
export const PACK_PROMPT_BUILDER = "pack-prompt/1";

/**
 * The layouts a facing sheet is drawn on, row-major, `null` an empty cell.
 *
 * `8`: the compass on a 3×3 grid with the centre empty — every facing sits
 * in the cell it points toward from the centre, so a model reads the layout
 * off the picture itself. `4`: the four facings of a top-down game on 2×2.
 */
export const FACING_LAYOUTS = {
  8: {
    rows: 3,
    cols: 3,
    cells: ["back-left", "back", "back-right", "left", null, "right", "front-left", "front", "front-right"],
  },
  4: {
    rows: 2,
    cols: 2,
    cells: ["front", "back", "left", "right"],
  },
};

/** A layout by its name (`"8"`, `"4"`) or a recorded `{ rows, cols, cells }`. */
export function facingLayout(value) {
  if (value && typeof value === "object") return checkLayout(value);
  const layout = FACING_LAYOUTS[String(value)];
  if (!layout) throw new Error(`--layout: expected ${Object.keys(FACING_LAYOUTS).join(" or ")}, got '${value}'`);
  return { rows: layout.rows, cols: layout.cols, cells: [...layout.cells] };
}

function checkLayout(layout) {
  const { rows, cols, cells } = layout;
  if (!(Number.isInteger(rows) && rows > 0 && Number.isInteger(cols) && cols > 0)) {
    throw new Error("a layout needs whole rows and cols");
  }
  if (!Array.isArray(cells) || cells.length !== rows * cols) {
    throw new Error(`a ${cols}x${rows} layout lists ${rows * cols} cells`);
  }
  const seen = new Set();
  for (const cell of cells) {
    if (cell === null) continue;
    if (!DIRECTIONS.includes(cell)) throw new Error(`unknown direction '${cell}' in the layout`);
    if (seen.has(cell)) throw new Error(`the layout names ${cell} twice`);
    seen.add(cell);
  }
  if (!seen.size) throw new Error("the layout names no direction");
  return { rows, cols, cells: [...cells] };
}

/**
 * The pixel rectangle of every cell of a `width`×`height` picture on a grid.
 * Whole pixels, even widths and heights (H.264 refuses odd ones), and every
 * cell the same size — the last column or row loses the remainder.
 */
export function cellRects(width, height, rows, cols) {
  if (!(width > 0 && height > 0)) throw new Error("cellRects needs the picture's size");
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  const w = even(width / cols);
  const h = even(height / rows);
  const rects = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      rects.push({ row, col, x: Math.floor((col * width) / cols), y: Math.floor((row * height) / rows), w, h });
    }
  }
  return rects;
}

/** The facing words the sheet uses for each cell. */
const FACING_WORDS = {
  front: "faces straight toward the viewer (front view)",
  back: "faces straight away from the viewer (back view, walking north up the screen, no face visible)",
  left: "faces the left edge of the picture (left profile)",
  right: "faces the right edge of the picture (right profile)",
  "front-left": "is a front three-quarter view facing down and to the left",
  "front-right": "is a front three-quarter view facing down and to the right",
  "back-left": "is a back three-quarter view facing up and to the left",
  "back-right": "is a back three-quarter view facing up and to the right",
};

const POSITION_WORDS = (rows, cols, row, col) => {
  const r = rows === 1 ? "" : row === 0 ? "top" : row === rows - 1 ? "bottom" : "middle";
  const c = cols === 1 ? "" : col === 0 ? "left" : col === cols - 1 ? "right" : "middle";
  if (r && c) return r === "middle" && c === "middle" ? "centre" : `${r}-${c}`;
  return r || c;
};

const closed = (text) => {
  const t = String(text ?? "").trim();
  return /[.!?]["')\]]?$/.test(t) ? t : `${t}.`;
};

/**
 * The prompt for a facing sheet: one picture of the character once per
 * direction, laid out as `layout`, on the white plate. The references are
 * attached (turnaround first): the sheet owns facing only.
 */
export function facingSheetPrompt({ character, layout: given = "8" }) {
  const layout = facingLayout(given);
  const style = typeof character?.style === "string" ? character.style.trim() : "";
  if (!style) throw new Error("the character has no style sentence — record it first (set-character --style \"…\")");
  const description = typeof character.description === "string" ? character.description.trim() : "";
  const { rows, cols, cells } = layout;
  const count = cells.filter(Boolean).length;
  const empty = cells.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
  const text = [closed(style)];
  text.push(`FACING SHEET for a game sprite: the character in the attached references, matching them exactly, drawn ${count} times — once per facing — on a strict ${cols} by ${rows} grid of equal square cells, read left to right, top to bottom.`);
  if (description) text.push(closed(description));
  if (empty.length) {
    const where = empty.map((i) => POSITION_WORDS(rows, cols, Math.floor(i / cols), i % cols)).join(" and ");
    text.push(`The ${where} cell${empty.length > 1 ? "s are" : " is"} completely empty white.`);
  }
  text.push("Every copy is the same calm standing pose, the same size, with its feet on the same height inside its own cell, and fits fully inside its cell with clear empty margin on every side; nothing crosses a cell boundary.");
  if (VIEW_TEXT[character.view]) text.push(VIEW_TEXT[character.view]);
  else text.push("Every copy is seen from the same camera.");
  const facings = [];
  cells.forEach((d, i) => {
    if (!d) return;
    facings.push(`the ${POSITION_WORDS(rows, cols, Math.floor(i / cols), i % cols)} copy ${FACING_WORDS[d]}`);
  });
  // The 3×3 compass reads its facings off the grid itself; any other layout
  // is just told which copy faces where.
  const compass = rows === 3 && cols === 3 && cells[4] === null;
  text.push(compass
    ? `Each copy faces the direction pointing from the centre of the grid toward its own cell: ${facings.join("; ")}.`
    : `The copies face: ${facings.join("; ")}.`);
  const asymmetric = typeof character.asymmetric === "string" ? character.asymmetric.trim() : "";
  if (asymmetric) {
    text.push(`These details are side-specific and stay on the same side of the body in every copy: ${closed(asymmetric)}`);
    for (const d of cells) {
      if (!d) continue;
      const sides = sideClause(d);
      if (sides) text.push(`For the ${d} copy: ${sides}`);
    }
  }
  text.push("The references own the identity — face, hair, markings, palette, outline weight, proportions, outfit and props stay exactly as they show; this sheet changes the facing only.");
  text.push("No grid lines drawn. A flat solid pure white background, no gradient, no floor, no ground shadow, no text, no labels, no arrows.");
  return { prompt: text.join(" "), layout, builder: PACK_PROMPT_BUILDER };
}

/**
 * What every cell does in a pack clip, per state — the sentence after
 * "All N copies …". Written for a grid of copies performing in sync; the
 * single-clip sentences (`references/video-preview.md`) are the source.
 */
const PACK_STATE_TEXT = {
  idle: "stand still in a relaxed idle at the same time, in sync: slow, gentle breathing that softly rises and falls in the chest and shoulders, a slight settle of the arms, hair and loose cloth, and one natural blink; the feet never lift, step, shuffle or slide",
  walk: "walk in place at the same time, in sync, like walk cycles on treadmills: a steady walking cycle with clear repeating foot contacts and an even left-right rhythm, arms swinging gently",
  run: "run in place at the same time, in sync, like run cycles on treadmills: a fast bounding running cycle with clear repeating foot contacts, arms pumping",
  attack: "perform one melee attack at the same time, in sync, with what each already holds: a windup, one clean strike in the direction it faces, a held impact pose, then a recovery to the exact starting stance; every grip stays exactly as drawn",
  jump: "perform one clean vertical jump in place at the same time, in sync: a short crouch, spring straight up, land softly on the same spot, and return to the exact starting stance",
  hurt: "react to being hit at the same time, in sync: the body jolts back away from the blow, then recovers to the starting stance",
  death: "collapse at the same time, in sync: stagger, lose balance and fall to the ground inside its own cell, ending lying still",
  cast: "cast a spell at the same time, in sync: gather, raise the arms or the held focus, release forward in the direction it faces, recover",
  loop: "come alive with a subtle looping idle animation, each in its own natural way — a gentle float up and down, a soft shimmer of light gliding across the surface, a small wobble or flicker — without changing shape, colour or size",
};

/** The states a pack clip has a sentence for; anything else needs `--action`. */
export const PACK_STATES = Object.keys(PACK_STATE_TEXT);

/** The states whose clip pins its last frame to its first (first-last). */
export const PINNED_PACK_STATES = ["idle", "attack", "hurt", "cast"];

/**
 * The pack clip's prompt: one image-to-video clip of the facing sheet laid
 * on chroma green, every copy performing the state in sync without turning
 * or leaving its cell. `action` replaces the state sentence (a custom
 * state, or the user's own words).
 */
export function packClipPrompt({ character, pack, action = null }) {
  const cells = (pack?.cells ?? []).filter(Boolean);
  if (!cells.length) throw new Error("the pack has no cells");
  const state = pack.state;
  const doing = typeof action === "string" && action.trim()
    ? action.trim().replace(/[.]+$/, "")
    : PACK_STATE_TEXT[state];
  if (!doing) {
    throw new Error(`--action: '${state}' has no built-in sentence (${PACK_STATES.join(", ")}) — say what every copy does`);
  }
  const items = cells.some((c) => c.item);
  const n = cells.length;
  const { rows, cols } = pack;
  const empty = pack.cells.some((c) => c === null);
  const text = [];
  text.push(items
    ? `2D game asset animation. The image is a ${cols} by ${rows} grid of ${n} game items, one per cell.`
    : `2D game sprite animation. The image is a ${cols} by ${rows} grid of ${n} copies of the same character, one per cell, each facing its own direction${empty ? "; the empty cell stays empty" : ""}.`);
  if (VIEW_TEXT[character?.view] && !items) text.push(VIEW_TEXT[character.view]);
  text.push(`All ${n} ${items ? "items" : "copies"} ${doing}.`);
  if (!items) {
    text.push("Every copy keeps facing exactly the direction it faces in the first frame for the whole clip — no copy turns, rotates or changes direction — and stays in its own cell at the same spot and the same size, never moving across the screen and never crossing into a neighbouring cell.");
    // Measured (0.6.0, Pip's run): a fast state turned all four diagonal
    // copies into side profiles in two takes out of three; the walk and the
    // idle kept them. Said outright, the corners are the ones that slip.
    if (cells.some((c) => c.direction && c.direction.includes("-"))) {
      text.push("The diagonal copies are three-quarter views and stay three-quarter views for the whole clip: each one keeps moving toward its own corner of the picture and never turns into a side profile, a front view or a back view.");
    }
  } else {
    text.push("Every item stays centred in its own cell at the same size for the whole clip and never crosses into a neighbouring cell; nothing new appears.");
  }
  text.push("Camera completely locked: no pan, no tilt, no zoom, no parallax, no reframing, no cut. Keep the design, colors and proportions exactly as in the image. Crisp, clean frames with no motion blur.");
  text.push("The background stays a flat solid pure chroma-key green fill for the whole clip, evenly lit, no gradient: no floor, no ground line, no shadows, no reflection, no particles, no effects, and no green light spilling onto the subjects.");
  if (PINNED_PACK_STATES.includes(state) || items) {
    text.push("The last frame returns to the exact picture of the first frame.");
  }
  return { prompt: text.join(" "), builder: PACK_PROMPT_BUILDER, pinned: PINNED_PACK_STATES.includes(state) || items };
}

/** A cell's motion id: `<state>-<direction>`, or the item's own loop id. */
export function packCellMotionId(state, cell) {
  return cell.item ? `${cell.item}-${state}` : `${state}-${cell.direction}`;
}

/**
 * An item sheet's layout: `count` items on a grid of rows of at most
 * `maxCols`, as square as it gets — 10 items are 5×2, 6 are 3×2, 4 are 2×2.
 */
export function itemGrid(count, maxCols = 5) {
  if (!(Number.isInteger(count) && count > 0)) throw new Error("--items: name at least one item");
  if (count > 25) throw new Error(`--items: at most 25 items on one sheet, got ${count} — split them over two sheets`);
  // The fewest empty cells, then the squarest grid at least as wide as tall.
  let best = null;
  for (let cols = 1; cols <= Math.min(maxCols, count); cols++) {
    const rows = Math.ceil(count / cols);
    if (cols < rows) continue;
    const empty = rows * cols - count;
    const shape = cols / rows;
    if (!best || empty < best.empty || (empty === best.empty && shape < best.shape)) best = { rows, cols, empty, shape };
  }
  // More items than a square of `maxCols` holds: as wide as allowed.
  if (!best) return { rows: Math.ceil(count / maxCols), cols: maxCols };
  return { rows: best.rows, cols: best.cols };
}

/** A slug for an item's name: `"Health Potion"` → `"health-potion"`. */
export function itemId(name) {
  const slug = String(name).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`--items: '${name}' has no letters or digits to name it by`);
  return slug;
}

/**
 * The prompt for an item sheet: every item of a props set drawn once, one
 * per cell, in ONE visual language — same camera, light, outline and scale.
 * Asking for the whole set on one picture is what keeps them consistent
 * (the reference repos and AutoSprite's assets both do; one call per item
 * drifts in light and scale). The plate is white; the cut-out comes after.
 */
export function itemSheetPrompt({ character, items, cols, rows }) {
  const style = typeof character?.style === "string" ? character.style.trim() : "";
  if (!style) throw new Error("the set has no style sentence — record it first (set-character --style \"…\")");
  const names = items.map((i) => (typeof i === "string" ? i : i.label));
  const text = [closed(style)];
  text.push(`GAME ITEM SHEET: ${names.length} different game items drawn in one consistent visual language, on a strict ${cols} by ${rows} grid of equal square cells, read left to right, top to bottom, one item per cell${names.length < rows * cols ? `, the last ${rows * cols - names.length} cell${rows * cols - names.length > 1 ? "s" : ""} left empty` : ""}.`);
  text.push(`The items, in order: ${names.map((n, i) => `${i + 1}. ${n}`).join("; ")}.`);
  const description = typeof character.description === "string" ? character.description.trim() : "";
  if (description) text.push(closed(description));
  text.push("Every item is a single object seen from the same three-quarter angle, with the same light from the upper left, the same outline weight and the same level of detail, centred in its cell at a similar visual size, filling about 65 percent of the cell, with clear empty margin on every side; nothing crosses a cell boundary and no item touches another.");
  text.push("Inventory-icon readability: strong silhouette, clear shapes, rich but limited palette.");
  text.push("No grid lines drawn. A flat solid pure white background, no gradient, no floor, no cast shadow, no text, no labels, no numbers, no frames or slots behind the items.");
  return { prompt: text.join(" "), builder: PACK_PROMPT_BUILDER };
}
