/**
 * The round avatar is cut from the figure found on a design sheet, not from
 * a fixed corner: the 2026-10-29 seed's 牛马 sheet put its front view where
 * the fixed crop (made for 光's layout) saw only pale page, so the avatar was
 * an empty circle. These sheets are drawn in pixels here — a page, a title
 * glyph, a panel outline and a turnaround row — so each rule the finder
 * relies on is exercised on its own.
 */

import { describe, expect, test } from "bun:test";

import { findFigure, squareAround } from "../viewer/avatar-crop.js";

const PAGE: [number, number, number] = [251, 250, 247];

function sheet(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([...PAGE, 255], i * 4);
  const fill = (x: number, y: number, bw: number, bh: number, rgb: [number, number, number]) => {
    for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) rgba.set([...rgb, 255], (yy * w + xx) * 4);
  };
  const outline = (x: number, y: number, bw: number, bh: number, rgb: [number, number, number]) => {
    fill(x, y, bw, 1, rgb);
    fill(x, y + bh - 1, bw, 1, rgb);
    fill(x, y, 1, bh, rgb);
    fill(x + bw - 1, y, 1, bh, rgb);
  };
  return { rgba, fill, outline };
}

const PALE_BLUE: [number, number, number] = [187, 190, 206];
const ORANGE: [number, number, number] = [249, 115, 22];

describe("finding the front view on a design sheet", () => {
  test("a pale figure on a near-white page is found — the leftmost of the turnaround — past the title and the panel outline", () => {
    const s = sheet(160, 160);
    s.fill(4, 3, 14, 7, [90, 90, 100]); // the title glyph "牛马": dark, but small
    s.outline(2, 14, 156, 42, [200, 200, 204]); // the turnaround's panel: big, but hollow
    s.fill(8, 18, 30, 32, PALE_BLUE); // front
    s.fill(60, 18, 28, 32, PALE_BLUE); // side
    s.fill(110, 18, 30, 32, PALE_BLUE); // back
    s.fill(8, 100, 140, 40, PALE_BLUE); // the action row, below the turnaround band
    expect(findFigure(s.rgba, 160, 160)).toEqual({ x: 8, y: 18, w: 30, h: 32 });
  });

  test("a large title glyph beside the front view does not win, and a front view smaller than the rest still does", () => {
    const s = sheet(160, 160);
    s.fill(3, 3, 12, 10, ORANGE); // "光", in the character's own colour
    s.fill(30, 8, 22, 28, ORANGE); // front, a little smaller
    s.fill(70, 8, 26, 30, ORANGE);
    s.fill(112, 8, 26, 30, ORANGE);
    expect(findFigure(s.rgba, 160, 160)).toEqual({ x: 30, y: 8, w: 22, h: 28 });
  });

  test("nothing that stands out from the page is no figure — the caller draws the initial", () => {
    const faint = sheet(120, 120);
    faint.fill(10, 10, 40, 40, [236, 235, 232]);
    expect(findFigure(faint.rgba, 120, 120)).toBeNull();
    const low = sheet(120, 120);
    low.fill(10, 80, 40, 30, ORANGE); // only below the top band
    expect(findFigure(low.rgba, 120, 120)).toBeNull();
  });

  test("the crop is a square around the figure, inside the sheet", () => {
    expect(squareAround({ x: 8, y: 18, w: 30, h: 32 }, 160, 160)).toEqual({ x: 23 - 32 * 1.24 / 2, y: 34 - 32 * 1.24 / 2, w: 32 * 1.24, h: 32 * 1.24 });
    const edge = squareAround({ x: 0, y: 0, w: 20, h: 10 }, 160, 90);
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
    expect(edge.w).toBeCloseTo(24.8, 6);
  });
});
