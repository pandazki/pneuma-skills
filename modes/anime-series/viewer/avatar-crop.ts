/**
 * The round avatar of a character is cut from its design sheet. Sheets are
 * drawn by a model, so where the front view sits is not fixed: 光's sheet
 * puts a big orange title glyph top-left and the front view beside it,
 * 牛马's puts the title above a row of boxed views, and a pale figure on a
 * near-white page turns a fixed crop into an empty circle. So the crop is
 * FOUND: the sheet is read small, the ink that differs from the page is
 * grouped into blobs, and the front view is the leftmost of the large solid
 * blobs in the sheet's top band (a turnaround reads front · side · back,
 * left to right). Title glyphs are too small, panel outlines too hollow.
 * When nothing qualifies the caller draws an initial on the palette instead.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FigureOptions {
  /** How far down the sheet the turnaround row may reach, as a fraction of its height. */
  band?: number;
  /** Least per-channel distance from the page colour that counts as ink, 0–255. */
  threshold?: number;
}

/** The page colour: the most common colour (quantized) along the image's edge. */
function pageColour(rgba: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n += 1;
    c.r += r;
    c.g += g;
    c.b += b;
    counts.set(key, c);
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    add(0, y);
    add(w - 1, y);
  }
  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return best.n ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
}

/**
 * The front view's box on a sheet read as RGBA pixels (`w` × `h`), or null
 * when no blob in the top band is large and solid enough to be a figure.
 */
export function findFigure(rgba: Uint8ClampedArray, w: number, h: number, options: FigureOptions = {}): Box | null {
  const band = Math.max(1, Math.round(h * (options.band ?? 0.45)));
  const threshold = options.threshold ?? 40;
  const [pr, pg, pb] = pageColour(rgba, w, h);

  const ink = new Uint8Array(w * band);
  for (let y = 0; y < band; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(rgba[i] - pr), Math.abs(rgba[i + 1] - pg), Math.abs(rgba[i + 2] - pb));
      if (rgba[i + 3] > 128 && d >= threshold) ink[y * w + x] = 1;
    }
  }

  // 4-connected blobs, flood-filled with an explicit stack.
  const label = new Int32Array(w * band);
  const blobs: Array<Box & { area: number }> = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || label[start]) continue;
    const id = blobs.length + 1;
    let x0 = w;
    let y0 = band;
    let x1 = -1;
    let y1 = -1;
    let area = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const at = stack.pop()!;
      const x = at % w;
      const y = (at - x) / w;
      area += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const next = [x > 0 ? at - 1 : -1, x < w - 1 ? at + 1 : -1, y > 0 ? at - w : -1, y < band - 1 ? at + w : -1];
      for (const n of next) {
        if (n >= 0 && ink[n] && !label[n]) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
    blobs.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }

  // A figure covers a real share of the sheet and fills its own box; a
  // title glyph is small, a panel outline or a divider is hollow.
  const minArea = w * h * 0.004;
  const figures = blobs.filter((b) => b.area >= minArea && b.area / (b.w * b.h) >= 0.3 && b.w < w * 0.6);
  if (figures.length === 0) return null;
  const largest = Math.max(...figures.map((b) => b.area));
  const front = figures.filter((b) => b.area >= largest * 0.45).sort((a, b) => a.x - b.x)[0];
  return { x: front.x, y: front.y, w: front.w, h: front.h };
}

/** A square around `box` with a margin, kept inside a `w` × `h` image. */
export function squareAround(box: Box, w: number, h: number, margin = 0.12): Box {
  const side = Math.min(Math.max(box.w, box.h) * (1 + margin * 2), w, h);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.min(Math.max(0, cx - side / 2), w - side);
  const y = Math.min(Math.max(0, cy - side / 2), h - side);
  return { x, y, w: side, h: side };
}

const READ_SIZE = 160;
const OUT_SIZE = 96;
const crops = new Map<string, Promise<string | null>>();

/**
 * The avatar for a sheet URL: a small PNG data URL of the found front view,
 * or null (no figure, or the image could not be read). Each URL is read
 * once per page; the URL carries the asset's `createdAt`, so a redrawn
 * sheet is a new URL.
 */
export function figureCrop(url: string): Promise<string | null> {
  const known = crops.get(url);
  if (known) return known;
  const made = new Promise<string | null>((resolve) => {
    if (typeof Image === "undefined" || typeof document === "undefined") return resolve(null);
    const img = new Image();
    // `/content` answers CORS, so the pixels can be read back.
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const scale = READ_SIZE / Math.max(img.naturalWidth, img.naturalHeight);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const read = document.createElement("canvas");
        read.width = w;
        read.height = h;
        const rc = read.getContext("2d", { willReadFrequently: true });
        if (!rc) return resolve(null);
        rc.drawImage(img, 0, 0, w, h);
        const box = findFigure(rc.getImageData(0, 0, w, h).data, w, h);
        if (!box) return resolve(null);
        const sq = squareAround(box, w, h);
        const out = document.createElement("canvas");
        out.width = OUT_SIZE;
        out.height = OUT_SIZE;
        const oc = out.getContext("2d");
        if (!oc) return resolve(null);
        oc.drawImage(img, sq.x / scale, sq.y / scale, sq.w / scale, sq.h / scale, 0, 0, OUT_SIZE, OUT_SIZE);
        resolve(out.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.src = url;
  });
  crops.set(url, made);
  return made;
}
