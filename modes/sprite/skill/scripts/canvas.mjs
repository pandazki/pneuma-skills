/**
 * canvas.mjs — the room a motion needs around the picture a clip is shot from.
 *
 * An image-to-video model keeps the input's framing: Seedance handed a
 * 416 × 506 frame returns 588 × 716 and refuses `--aspect-ratio` on i2v, so a
 * jump whose ears leave that frame, or an attack whose swing does, cannot be
 * fixed by the prompt. The room has to be in the still. `flatten --room`
 * pads the still into the canvas the motion needs before it is painted onto
 * the plate; this module is the geometry of that, and nothing else.
 *
 *   square  the still's own frame, squared off (in-place motion)
 *   tall    3:4, room ABOVE the still (a jump)
 *   wide    16:9, room above, in FRONT (the facing side) and behind (an attack,
 *           a wave, a cheer)
 *
 * The still is never scaled and never cut; it always stands on the canvas's
 * bottom edge.
 */

import { roundHalfEven } from "./drift.mjs";

export const ROOM_SHAPES = ["square", "tall", "wide"];

/**
 * Each shape's default room: tall is upstream's `jump` row, wide its `attack`
 * row. A gesture (wave, cheer) is wide with no headroom, 30 % lead and no
 * trail — `--headroom 0 --lead 0.3 --trail 0`.
 */
export const ROOM_DEFAULTS = {
  square: { ratio: 1, headroom: 0, lead: 0, trail: 0 },
  tall: { ratio: 3 / 4, headroom: 0.34, lead: 0, trail: 0 },
  wide: { ratio: 16 / 9, headroom: 0.35, lead: 0.28, trail: 0.2 },
};

/**
 * Where a `width × height` still goes on the canvas its motion needs.
 *
 * `headroom` is the empty share of the canvas HEIGHT above the still (tall and
 * wide); `lead` the empty share of the WIDTH in front of the subject and
 * `trail` behind it (wide), front being the side it faces. Every fraction is
 * in [0, 0.9) and lead + trail < 0.9. The canvas grows to keep its shape's
 * ratio without ever shrinking the still.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/canvas.py@fbd1a08:
 * `pad_canvas` (state fit) and the STATE_CANVAS / SHAPE_DEFAULTS rows. Changes:
 * geometry only — the key normalisation and corner checks stay with
 * `flatten`, which composites a transparent still onto a plate instead of
 * extending an opaque one; the state-name table is left to the skill.
 */
export function roomCanvas({ width, height }, { room, headroom, lead, trail, facing = "right" }) {
  if (!ROOM_SHAPES.includes(room)) throw new Error(`room: expected ${ROOM_SHAPES.join(", ")}, got '${room}'`);
  // Any other word used to place the subject as if it faced right.
  if (facing !== "left" && facing !== "right") throw new Error(`facing: expected left or right, got '${facing}'`);
  const profile = ROOM_DEFAULTS[room];
  const head = headroom ?? profile.headroom;
  const front = lead ?? profile.lead;
  const back = trail ?? profile.trail;
  for (const [name, value] of [["headroom", head], ["lead", front], ["trail", back]]) {
    if (!(value >= 0 && value < 0.9)) throw new Error(`--${name} must be in [0, 0.9), got ${value}`);
  }
  if (!(front + back < 0.9)) throw new Error(`--lead + --trail must stay below 0.9, got ${front + back}`);
  const w = width;
  const h = height;
  let canvasW;
  let canvasH;
  let x;
  if (room === "square") {
    const side = Math.max(w, h);
    canvasW = side;
    canvasH = side;
    x = Math.floor((side - w) / 2);
  } else if (room === "tall") {
    // The still becomes the bottom (1 − headroom) of a canvas at least as tall
    // as the ratio demands for its width — never narrower than the still.
    canvasH = Math.max(h, roundHalfEven(h / (1 - head)), roundHalfEven(w / profile.ratio));
    canvasW = Math.max(w, roundHalfEven(canvasH * profile.ratio));
    x = Math.floor((canvasW - w) / 2);
  } else {
    // `trail` of the width stays empty behind the subject; the rest of the
    // extra width goes in front.
    const requiredH = Math.max(h, roundHalfEven(h / (1 - head)));
    canvasW = Math.max(w, roundHalfEven(w / (1 - front - back)), roundHalfEven(requiredH * profile.ratio));
    canvasH = Math.max(h, roundHalfEven(canvasW / profile.ratio));
    const behind = Math.min(roundHalfEven(canvasW * back), canvasW - w);
    x = facing === "left" ? canvasW - w - behind : behind;
  }
  return {
    room,
    canvas: { width: canvasW, height: canvasH },
    offset: { x, y: canvasH - h },
    headroom: room === "square" ? 0 : head,
    lead: room === "wide" ? front : 0,
    trail: room === "wide" ? back : 0,
    facing,
  };
}
