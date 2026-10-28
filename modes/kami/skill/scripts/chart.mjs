#!/usr/bin/env node
/**
 * chart.mjs — deterministic data charts: a JSON spec in, a kami-palette SVG out.
 *
 * Hand-placing bar heights and arc endpoints is where silent wrong numbers come
 * from, so the geometry is computed here and nowhere else. Every chart carries
 * its own spec in `data-kami-spec`; `--check` regenerates each chart from that
 * spec and fails when the drawn SVG no longer matches it, which catches a
 * hand-edited label as surely as a stale bar.
 *
 * Spec (one chart per file):
 *
 *   {"type": "bar",   "categories": ["2022", "2023"],
 *                     "series": [{"name": "Revenue", "values": [44, 60]}]}
 *   {"type": "line",  same shape as bar}
 *   {"type": "hbar",  "items": [{"label": "A", "value": 31}, ...], "focus": 0}
 *   {"type": "donut", "items": [{"label": "A", "value": 32}, ...],
 *                     "center_label": "Share"}
 *   {"type": "candlestick",
 *                     "points": [{"label": "D1", "open": 120, "high": 128,
 *                                 "low": 116, "close": 126}, ...]}
 *   {"type": "waterfall",
 *                     "items": [{"label": "Start", "value": 120, "total": true},
 *                               {"label": "A", "value": 30},
 *                               {"label": "End", "total": true}]}
 *
 * Optional on every type: "size" ("full" | "compact"), "unit" (axis caption),
 * "prefix" / "suffix" (value labels), "decimals", "source" (footnote), "lang"
 * ("cn", "en", "ko"; inferred from the labels when absent), "title"
 * (accessible name only, never drawn; the figure caption carries the takeaway).
 *
 * Usage:
 *   node chart.mjs spec.json [-o chart.svg]
 *   node chart.mjs --check page.html [more.html chart.svg ...]
 *
 * Ported from tw93/kami (MIT) skills/kami/scripts/chart.py@210f3bc: the six
 * builders, the 1/2/2.5/5 axis rounding, the largest-remainder donut shares,
 * the spec validation and the drift gate, with their constants. The output is
 * byte-identical to upstream's for the same spec — the five chart demos in
 * `_shared/assets/diagrams/` are upstream's generated files and pass `--check`
 * here. Changes: Node built-ins only (no Python); Python's float repr and
 * round-half-even are reproduced where upstream's text depends on them; the
 * East Asian Width test is a range table instead of `unicodedata`.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PARCHMENT = "#f5f4ed";
const NEAR_BLACK = "#141413";
const CHARCOAL = "#4d4c48";
const OLIVE = "#504e49";
const STONE = "#6b6a64";
const LIGHT_STONE = "#b8b7b0";
const MIST = "#d4d3cd";
const BRAND = "#1B365D";
const BRAND_TINT = "#EEF2F7";
const GRID = "#e8e7e1";

const SERIES = [BRAND, OLIVE, STONE, LIGHT_STONE, MIST, BRAND_TINT];

const FONT_CN =
  "'TsangerJinKai02', 'Source Han Serif SC', 'Source Han Serif CN', " +
  "'Noto Serif CJK SC', 'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', " +
  "Charter, Georgia, serif";
const FONT_KO =
  "'Source Han Serif K', 'Source Han Serif KR', 'Noto Serif KR', " +
  "'Nanum Myeongjo', 'AppleMyungjo', Charter, Georgia, serif";
const FONT_EN = "Charter, Georgia, Palatino, 'Times New Roman', serif";

const WORDS = {
  en: { up: "Up (close above open)", down: "Down (close below open)",
        increase: "Increase", decrease: "Decrease", total: "Total" },
  cn: { up: "上涨", down: "下跌", increase: "增加", decrease: "减少", total: "合计" },
  ko: { up: "상승", down: "하락", increase: "증가", decrease: "감소", total: "합계" },
};

const LIMITS = {
  bar: [8, 3], line: [12, 3], hbar: [12, 1],
  donut: [6, 1], candlestick: [30, 1], waterfall: [8, 1],
};

// One layout for every chart, sized for a document column: a 680-unit-wide
// chart set across a ~170mm column lands near 0.7 scale, so 12-unit labels
// print at about 8.5pt, just under body text.
const TOP = 24, BASE = 224;   // plot area y range
const PLOT_H = BASE - TOP;
const LABEL_Y = BASE + 22;    // category labels under the axis
const LEGEND_Y = BASE + 44;   // hairline above the legend row
const FS_TICK = 11, FS_LABEL = 12, FS_VALUE = 12, FS_LEGEND = 12, FS_NOTE = 11;

export class ChartError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChartError";
  }
}

// ------------------------------------------------------- python parity
//
// Upstream writes numbers through Python's formatting, and the drift gate
// compares text, so these reproduce it exactly rather than approximately.

/** Python `f"{x:.{d}f}"`: correctly rounded, ties to even on the exact binary value. */
function pyFixed(x, d) {
  const neg = x < 0 || Object.is(x, -0);
  // toFixed(100) is the exact decimal expansion for every magnitude a chart uses.
  const exact = Math.abs(x).toFixed(100);
  const dot = exact.indexOf(".");
  let digits = exact.slice(0, dot) + exact.slice(dot + 1, dot + 1 + d);
  const rest = exact.slice(dot + 1 + d);
  const first = rest.charCodeAt(0) - 48;
  const tail = /[1-9]/.test(rest.slice(1));
  const last = digits.charCodeAt(digits.length - 1) - 48;
  if (first > 5 || (first === 5 && (tail || last % 2 === 1))) digits = increment(digits);
  const int = digits.slice(0, digits.length - d) || "0";
  const body = d > 0 ? `${int}.${digits.slice(digits.length - d)}` : int;
  return (neg ? "-" : "") + body.replace(/^0+(?=\d)/, "");
}

function increment(digits) {
  const out = digits.split("");
  let i = out.length - 1;
  while (i >= 0) {
    if (out[i] === "9") { out[i] = "0"; i -= 1; continue; }
    out[i] = String.fromCharCode(out[i].charCodeAt(0) + 1);
    return out.join("");
  }
  return "1" + out.join("");
}

/** Python `round(x)` to an int: ties to even. */
function pyRound(x) {
  return Number(pyFixed(x, 0));
}

/** Python `repr(float)` for a chart-sized float: `41.0`, not `41`. */
function pyFloat(x) {
  return Number.isInteger(x) ? `${x}.0` : String(x);
}

/** Python `json.dumps(sort_keys=True, ensure_ascii=False, separators=(",", ":"))`. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ------------------------------------------------------------- helpers

function width(spec, base) {
  // "size": "compact" narrows the canvas, not the type, for a chart shown
  // small (a half-column slide, two charts side by side): drawn at the same
  // physical width, its labels come out about 1.5 times larger.
  const size = "size" in spec ? spec.size : "full";
  if (size !== "full" && size !== "compact") throw new ChartError('size must be "full" or "compact"');
  return size === "compact" ? pyRound(base * 0.65) : base;
}

function height(legend, spec) {
  // Plot, labels, optional legend row, optional source line.
  const h = legend ? LEGEND_Y + 32 : LABEL_Y + 16;
  return h + (hasText(spec.source) ? 22 : 0);
}

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function num(value, where) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ChartError(`${where}: expected a number, got ${JSON.stringify(value) ?? String(value)}`);
  }
  return value;
}

/** Coordinate text: one decimal, trailing zero dropped. */
function c(v) {
  let s = pyFixed(v, 1);
  if (s.endsWith(".0")) s = s.slice(0, -2);
  return s === "-0" ? "0" : s;
}

function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function unesc(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, ent) => {
    const e = ent.toLowerCase();
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

// East Asian Width W and F: the ranges a document label can realistically
// carry (CJK, kana, Hangul, full-width forms, wide emoji).
const WIDE = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4], [0x17000, 0x18cff], [0x1b000, 0x1b2ff],
  [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f251],
  [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff],
  [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];

function wide(ch) {
  const cp = ch.codePointAt(0);
  return WIDE.some(([lo, hi]) => cp >= lo && cp <= hi);
}

export function textWidth(text, size) {
  let w = 0;
  for (const ch of String(text)) w += wide(ch) ? size : size * 0.56;
  return w;
}

function lang(spec, labels) {
  const l = spec.lang;
  if (l === "en" || l === "cn" || l === "ko") return l;
  if (typeof l === "string" && l.toLowerCase().startsWith("zh")) return "cn";
  const joined = labels.join("");
  if (/[가-힯ᄀ-ᇿ]/.test(joined)) return "ko";
  for (const ch of joined) if (wide(ch)) return "cn";
  return "en";
}

function font(l) {
  return l === "cn" ? FONT_CN : l === "ko" ? FONT_KO : FONT_EN;
}

function decimals(spec, values) {
  if (Number.isInteger(spec.decimals)) return Math.max(0, Math.min(4, spec.decimals));
  let best = 0;
  for (const v of values) {
    // Python repr switches to exponent form outside [1e-4, 1e16); upstream skips those.
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-4 || a >= 1e16)) continue;
    const text = String(v);
    const dot = text.indexOf(".");
    if (dot >= 0) best = Math.max(best, text.slice(dot + 1).replace(/0+$/, "").length);
  }
  return Math.min(best, 2);
}

export function fmt(value, dec, prefix = "", suffix = "", sign = false) {
  const fixed = pyFixed(Math.abs(value), dec);
  const [int, frac] = fixed.split(".");
  const body = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac !== undefined ? `.${frac}` : "");
  const neg = value < 0 && Number(fixed) !== 0;
  const lead = neg ? "-" : sign && value > 0 ? "+" : "";
  return `${lead}${prefix}${body}${suffix}`;
}

/** Round [lo, hi] out to a 4-8 tick axis with a 1/2/2.5/5 step. */
export function niceScale(lo, hi, includeZero) {
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi === lo) hi = lo + (Math.abs(lo) || 1);
  const raw = (hi - lo) / 6;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw - 1e-12);
  const loN = Math.floor(lo / step + 1e-9) * step;
  const hiN = Math.ceil(hi / step - 1e-9) * step;
  return [loN, hiN, step];
}

class Svg {
  constructor(spec, kind, w, h, fontFamily) {
    this.spec = spec;
    this.kind = kind;
    this.width = w;
    this.height = h;
    this.font = fontFamily;
    this.parts = [];
  }

  add(line) {
    this.parts.push(line);
  }

  text(x, y, value, { size = FS_LABEL, fill = NEAR_BLACK, anchor = "start", weight = null, extra = "" } = {}) {
    let attrs = `x="${c(x)}" y="${c(y)}" fill="${fill}" font-size="${size}" font-family="${this.font}"`;
    if (anchor !== "start") attrs += ` text-anchor="${anchor}"`;
    if (weight) attrs += ` font-weight="${weight}"`;
    if (extra) attrs += ` ${extra}`;
    this.add(`<text ${attrs}>${esc(value)}</text>`);
  }

  render() {
    const title = this.spec.title;
    const label = typeof title === "string" && title ? ` aria-label="${esc(title)}"` : "";
    const head =
      `<svg viewBox="0 0 ${this.width} ${this.height}" xmlns="http://www.w3.org/2000/svg" ` +
      `role="img"${label} data-kami-chart="${this.kind}" data-kami-spec="${esc(canonicalJson(this.spec))}">`;
    const body = [`<rect width="100%" height="100%" fill="${PARCHMENT}"/>`, ...this.parts];
    return `${head}\n${body.map((p) => `  ${p}`).join("\n")}\n</svg>\n`;
  }
}

/** Tick labels carry the precision of the step, not of the data (0-20 by 5, not 0.0-20.0). */
function stepDecimals(step) {
  for (let dec = 0; dec < 5; dec += 1) {
    const scaled = step * 10 ** dec;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return dec;
  }
  return 4;
}

/** Left edge of the plot: tick labels start at the chart's own left edge. */
function plotLeft(lo, hi, step, unit) {
  const dec = stepDecimals(step);
  const count = pyRound((hi - lo) / step) + 1;
  let widest = 0;
  for (let i = 0; i < count; i += 1) widest = Math.max(widest, textWidth(fmt(lo + i * step, dec), FS_TICK));
  return (unit ? 22 : 0) + widest + 10;
}

function axis(svg, x0, x1, lo, hi, step, ymap, unit) {
  const dec = stepDecimals(step);
  const ticks = pyRound((hi - lo) / step);
  for (let i = 0; i <= ticks; i += 1) {
    const v = lo + i * step;
    const y = ymap(v);
    svg.add(`<line x1="${c(x0)}" y1="${c(y)}" x2="${c(x1)}" y2="${c(y)}" stroke="${GRID}" stroke-width="0.8"/>`);
    svg.text(x0 - 8, y + 4, fmt(v, dec), { size: FS_TICK, fill: STONE, anchor: "end" });
  }
  if (unit) {
    const mid = (TOP + BASE) / 2;
    svg.text(8, mid, unit, { size: FS_NOTE, fill: STONE, anchor: "middle", extra: `transform="rotate(-90 8 ${c(mid)})"` });
  }
}

/** entries: [swatch(x, y) markup builder, label]. */
function legend(svg, x0, x1, y, entries) {
  svg.add(`<line x1="${c(x0)}" y1="${c(y)}" x2="${c(x1)}" y2="${c(y)}" stroke="${GRID}" stroke-width="0.8"/>`);
  let x = x0;
  for (const [swatch, label] of entries) {
    svg.add(swatch(c(x), c(y + 13)));
    const tx = x + 18;
    svg.text(tx, y + 24, label, { size: FS_LEGEND, fill: OLIVE });
    x = tx + textWidth(label, FS_LEGEND) + 32;
  }
}

/** The source line sits on the last row height() reserved for it. */
function source(svg, spec, x) {
  if (hasText(spec.source)) svg.text(x, svg.height - 6, spec.source.trim(), { size: FS_NOTE, fill: STONE });
}

function square(color) {
  const stroke = color === BRAND_TINT ? ` stroke="${GRID}" stroke-width="0.8"` : "";
  return (x, y) => `<rect x="${x}" y="${y}" width="12" height="12" fill="${color}"${stroke} rx="2"/>`;
}

function common(spec) {
  const prefix = "prefix" in spec ? spec.prefix : "";
  const suffix = "suffix" in spec ? spec.suffix : "";
  if (typeof prefix !== "string" || typeof suffix !== "string") throw new ChartError("prefix and suffix must be strings");
  return [prefix, suffix];
}

function limit(kind, count, series = 1) {
  const [maxItems, maxSeries] = LIMITS[kind];
  if (count === 0) throw new ChartError(`${kind}: no data`);
  if (count > maxItems) {
    const hint = kind === "donut" ? " (use hbar for 7+ shares)" : "";
    throw new ChartError(`${kind}: ${count} items, at most ${maxItems}${hint}`);
  }
  if (series > maxSeries) throw new ChartError(`${kind}: ${series} series, at most ${maxSeries}`);
}

function label(item, where) {
  if (typeof item !== "string" || !item.trim()) throw new ChartError(`${where}: label must be a non-empty string`);
  return item;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function linearMap(lo, hi) {
  return (v) => BASE - ((v - lo) / (hi - lo)) * PLOT_H;
}

// ---------------------------------------------------------- bar / line

function seriesSpec(spec, kind) {
  const cats = spec.categories;
  const series = spec.series;
  if (!Array.isArray(cats) || !Array.isArray(series) || series.length === 0) {
    throw new ChartError(`${kind}: needs 'categories' and a non-empty 'series' list`);
  }
  const labels = cats.map((cat, i) => label(cat, `categories[${i}]`));
  const out = series.map((s, si) => {
    if (!isObject(s) || !Array.isArray(s.values)) throw new ChartError(`series[${si}]: needs 'values'`);
    const vals = s.values.map((v, i) => num(v, `series[${si}].values[${i}]`));
    if (vals.length !== labels.length) {
      throw new ChartError(`series[${si}]: ${vals.length} values for ${labels.length} categories`);
    }
    const name = "name" in s ? s.name : "";
    return [typeof name === "string" ? name : String(name), vals];
  });
  limit(kind, labels.length, out.length);
  return [labels, out];
}

function bar(spec) {
  const [cats, series] = seriesSpec(spec, "bar");
  const [prefix, suffix] = common(spec);
  const allv = series.flatMap(([, vals]) => vals);
  const dec = decimals(spec, allv);
  const [lo, hi, step] = niceScale(Math.min(...allv), Math.max(...allv), true);
  const hasLegend = series.length > 1;
  const l = lang(spec, [...cats, ...series.map(([n]) => n)]);
  const svg = new Svg(spec, "bar", width(spec, 680), height(hasLegend, spec), font(l));
  const x0 = plotLeft(lo, hi, step, spec.unit);
  const x1 = svg.width - 4;
  const ymap = linearMap(lo, hi);

  axis(svg, x0, x1, lo, hi, step, ymap, spec.unit);
  const zero = ymap(0);
  svg.add(`<line x1="${pyFloat(x0)}" y1="${c(zero)}" x2="${x1}" y2="${c(zero)}" stroke="${NEAR_BLACK}" stroke-width="0.8"/>`);
  const n = cats.length, s = series.length;
  const gw = (x1 - x0) / n;
  // One series gets a bar about half its slot; grouped bars stay narrow so
  // the gap between groups still reads as the category break.
  const bw = s === 1 ? Math.min(56, gw * 0.5) : Math.min(32, (gw * 0.7 - 8 * (s - 1)) / s);
  const total = s * bw + 8 * (s - 1);
  cats.forEach((cat, i) => {
    const cx = x0 + gw * (i + 0.5);
    series.forEach(([, vals], si) => {
      const v = vals[i];
      const bx = cx - total / 2 + si * (bw + 8);
      const [top, bottom] = v >= 0 ? [ymap(v), zero] : [zero, ymap(v)];
      svg.add(`<rect x="${c(bx)}" y="${c(top)}" width="${c(bw)}" height="${c(bottom - top)}" fill="${SERIES[si]}" rx="2"/>`);
      const ly = v >= 0 ? top - 4 : bottom + 12;
      svg.text(bx + bw / 2, ly, fmt(v, dec, prefix, suffix), { size: FS_VALUE, anchor: "middle", weight: si === 0 ? "500" : null });
    });
    svg.text(cx, LABEL_Y, cat, { size: FS_LABEL, anchor: "middle" });
  });
  if (hasLegend) legend(svg, x0, x1, LEGEND_Y, series.map(([name], i) => [square(SERIES[i]), name]));
  source(svg, spec, 0);
  return svg;
}

const LINE_STYLES = [
  ["2", "", true], ["1.5", ' stroke-dasharray="5 3"', false], ["1.5", ' stroke-dasharray="2 3"', false],
];

function line(spec) {
  const [cats, series] = seriesSpec(spec, "line");
  const [prefix, suffix] = common(spec);
  const allv = series.flatMap(([, vals]) => vals);
  const dec = decimals(spec, allv);
  const zeroWanted = "zero" in spec ? Boolean(spec.zero) : true;
  const [lo, hi, step] = niceScale(Math.min(...allv), Math.max(...allv), Math.min(...allv) >= 0 && zeroWanted);
  const hasLegend = series.length > 1;
  const l = lang(spec, [...cats, ...series.map(([n]) => n)]);
  const svg = new Svg(spec, "line", width(spec, 680), height(hasLegend, spec), font(l));
  const endW = Math.max(...series.map(([, vals]) => textWidth(fmt(vals[vals.length - 1], dec, prefix, suffix), FS_VALUE)));
  const x0 = plotLeft(lo, hi, step, spec.unit);
  const x1 = svg.width - endW - 12;
  const ymap = linearMap(lo, hi);

  const n = cats.length;
  const xs = n === 1 ? [(x0 + x1) / 2] : cats.map((_, i) => x0 + (i * (x1 - x0)) / (n - 1));
  axis(svg, x0, x1, lo, hi, step, ymap, spec.unit);
  for (const x of xs.slice(1, -1)) {
    svg.add(`<line x1="${c(x)}" y1="${TOP}" x2="${c(x)}" y2="${BASE}" stroke="${GRID}" stroke-width="0.5" stroke-dasharray="3 4"/>`);
  }
  svg.add(`<line x1="${pyFloat(x0)}" y1="${BASE}" x2="${pyFloat(x1)}" y2="${BASE}" stroke="${NEAR_BLACK}" stroke-width="0.8"/>`);
  const ends = [];
  series.forEach(([, vals], si) => {
    const [strokeW, dash, filled] = LINE_STYLES[si];
    const color = SERIES[si];
    const pts = xs.map((x, i) => `${c(x)},${c(ymap(vals[i]))}`).join(" ");
    svg.add(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${strokeW}"${dash} stroke-linejoin="round" stroke-linecap="round"/>`);
    xs.forEach((x, i) => {
      const y = ymap(vals[i]);
      if (filled) {
        const r = i === n - 1 ? "5.5" : "4";
        svg.add(`<circle cx="${c(x)}" cy="${c(y)}" r="${r}" fill="${color}" stroke="${PARCHMENT}" stroke-width="1.5"/>`);
      } else {
        svg.add(`<circle cx="${c(x)}" cy="${c(y)}" r="3.5" fill="${PARCHMENT}" stroke="${color}" stroke-width="1.5"/>`);
      }
    });
    ends.push([ymap(vals[vals.length - 1]) + 4, si, vals[vals.length - 1]]);
  });
  ends.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (let i = 1; i < ends.length; i += 1) ends[i][0] = Math.max(ends[i][0], ends[i - 1][0] + 12); // keep end labels 12px apart
  for (const [y, si, v] of ends) {
    svg.text(xs[xs.length - 1] + 8, y, fmt(v, dec, prefix, suffix), { size: FS_VALUE, fill: SERIES[si], weight: si === 0 ? "500" : null });
  }
  xs.forEach((x, i) => svg.text(x, LABEL_Y, cats[i], { size: FS_LABEL, anchor: "middle" }));
  if (hasLegend) legendLines(svg, x0, x1, LEGEND_Y, series.map(([name]) => name));
  source(svg, spec, 0);
  return svg;
}

function legendLines(svg, x0, x1, y, names) {
  svg.add(`<line x1="${c(x0)}" y1="${c(y)}" x2="${c(x1)}" y2="${c(y)}" stroke="${GRID}" stroke-width="0.8"/>`);
  let x = x0;
  const cy = y + 18;
  names.forEach((name, si) => {
    const [strokeW, dash, filled] = LINE_STYLES[si];
    const color = SERIES[si];
    svg.add(`<line x1="${c(x)}" y1="${c(cy)}" x2="${c(x + 24)}" y2="${c(cy)}" stroke="${color}" stroke-width="${strokeW}"${dash} stroke-linecap="round"/>`);
    if (filled) svg.add(`<circle cx="${c(x + 12)}" cy="${c(cy)}" r="3.5" fill="${color}"/>`);
    else svg.add(`<circle cx="${c(x + 12)}" cy="${c(cy)}" r="3" fill="${PARCHMENT}" stroke="${color}" stroke-width="1.5"/>`);
    svg.text(x + 32, cy + 4, name, { size: FS_LEGEND, fill: OLIVE });
    x = x + 32 + textWidth(name, FS_LEGEND) + 32;
  });
}

// ---------------------------------------------------------------- hbar

function items(spec, kind) {
  if (!Array.isArray(spec.items)) throw new ChartError(`${kind}: needs an 'items' list`);
  const out = spec.items.map((it, i) => {
    if (!isObject(it)) throw new ChartError(`items[${i}]: expected an object`);
    return [label(it.label, `items[${i}]`), num(it.value, `items[${i}].value`)];
  });
  limit(kind, out.length);
  return out;
}

function hbar(spec) {
  const rows = items(spec, "hbar");
  const [prefix, suffix] = common(spec);
  if (rows.some(([, v]) => v < 0)) throw new ChartError("hbar: values must be zero or positive");
  const dec = decimals(spec, rows.map(([, v]) => v));
  const focus = "focus" in spec ? spec.focus : 0;
  if (focus !== null && (!Number.isInteger(focus) || focus < 0 || focus >= rows.length)) {
    throw new ChartError("hbar: focus must be an item index or null");
  }
  const l = lang(spec, rows.map(([lab]) => lab));
  const unit = typeof spec.unit === "string" && spec.unit ? spec.unit : null;
  const row = 30, barH = 18;
  const top = unit ? 34 : 10;
  const h = top + rows.length * row + 6 + (hasText(spec.source) ? 26 : 0);
  const svg = new Svg(spec, "hbar", width(spec, 680), h, font(l));
  const labelW = Math.min(200, Math.max(...rows.map(([lab]) => textWidth(lab, FS_LABEL))));
  const x0 = labelW + 14;
  const vmax = Math.max(...rows.map(([, v]) => v)) || 1;
  const labels = rows.map(([, v]) => fmt(v, dec, prefix, suffix));
  const span = svg.width - 20 - x0 - Math.max(...labels.map((t) => textWidth(t, FS_VALUE))) - 10;
  if (unit) svg.text(x0, top - 14, unit, { size: FS_NOTE, fill: STONE });
  rows.forEach(([lab, v], i) => {
    const y = top + i * row;
    const w = (v / vmax) * span;
    const color = i === focus ? BRAND : LIGHT_STONE;
    svg.text(x0 - 14, y + 14, lab, { size: FS_LABEL, anchor: "end" });
    svg.add(`<rect x="${c(x0)}" y="${c(y + 1)}" width="${c(w)}" height="${barH}" fill="${color}" rx="2"/>`);
    svg.text(x0 + w + 8, y + 14, labels[i], { size: FS_VALUE, weight: i === focus ? "500" : null });
  });
  svg.add(`<line x1="${c(x0)}" y1="${top - 3}" x2="${c(x0)}" y2="${c(top + rows.length * row - 7)}" stroke="${NEAR_BLACK}" stroke-width="0.8"/>`);
  source(svg, spec, 0);
  return svg;
}

// --------------------------------------------------------------- donut

/** Percentages that sum to exactly 100 at the shown precision (largest remainder). */
function shares(values, dec) {
  const total = values.reduce((a, b) => a + b, 0);
  const scale = 10 ** dec;
  const raw = values.map((v) => (v / total) * 100 * scale);
  const floors = raw.map((r) => Math.floor(r));
  const short = pyRound(100 * scale) - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((_, i) => i).sort((a, b) => raw[b] - floors[b] - (raw[a] - floors[a]));
  for (const i of order.slice(0, Math.max(0, short))) floors[i] += 1;
  return floors.map((f) => f / scale);
}

function arcPoint(cx, cy, r, deg) {
  const rad = deg * (Math.PI / 180);
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function donut(spec) {
  // Ring on the left, legend beside it at reading size, one composition.
  const rows = items(spec, "donut");
  if (rows.some(([, v]) => v <= 0)) throw new ChartError("donut: every value must be positive");
  const dec = Number.isInteger(spec.decimals) ? spec.decimals : 0;
  const pcts = shares(rows.map(([, v]) => v), dec);
  const l = lang(spec, [...rows.map(([lab]) => lab), String(spec.center_label ?? "")]);
  const cx = 114, cy = 128, R = 112, r = 68;
  const pct = pcts.map((s) => fmt(s, dec, "", "%"));
  const pctW = Math.max(...pct.map((p) => textWidth(p, 14)));
  const lx = cx + R + 44;
  const need = lx + 22 + pctW + 14 + Math.max(...rows.map(([lab]) => textWidth(lab, FS_LABEL))) + 8;
  const w = Math.max(width(spec, 680), pyRound(need));
  const svg = new Svg(spec, "donut", w, 260 + (hasText(spec.source) ? 26 : 0), font(l));
  const total = rows.reduce((a, [, v]) => a + v, 0);
  let angle = -90;
  rows.forEach(([, v], i) => {
    const span = (v / total) * 360;
    const color = SERIES[i];
    const stroke = color === BRAND_TINT ? ` stroke="${GRID}" stroke-width="0.8"` : "";
    if (span >= 359.999) {
      const d =
        `M ${c(cx)} ${c(cy - R)} A ${R} ${R} 0 1 1 ${c(cx)} ${c(cy + R)} ` +
        `A ${R} ${R} 0 1 1 ${c(cx)} ${c(cy - R)} M ${c(cx)} ${c(cy - r)} ` +
        `A ${r} ${r} 0 1 0 ${c(cx)} ${c(cy + r)} A ${r} ${r} 0 1 0 ${c(cx)} ${c(cy - r)} Z`;
      svg.add(`<path d="${d}" fill="${color}" fill-rule="evenodd"${stroke}/>`);
    } else {
      const end = angle + span;
      const large = span > 180 ? 1 : 0;
      const [ox1, oy1] = arcPoint(cx, cy, R, angle);
      const [ox2, oy2] = arcPoint(cx, cy, R, end);
      const [ix2, iy2] = arcPoint(cx, cy, r, end);
      const [ix1, iy1] = arcPoint(cx, cy, r, angle);
      const d =
        `M ${c(ox1)} ${c(oy1)} A ${R} ${R} 0 ${large} 1 ${c(ox2)} ${c(oy2)} ` +
        `L ${c(ix2)} ${c(iy2)} A ${r} ${r} 0 ${large} 0 ${c(ix1)} ${c(iy1)} Z`;
      svg.add(`<path d="${d}" fill="${color}"${stroke}/>`);
    }
    angle += span;
  });
  svg.add(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${PARCHMENT}" stroke-width="1.5"/>`);
  svg.add(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PARCHMENT}" stroke-width="1.5"/>`);
  const center = spec.center_label;
  const hasCenter = typeof center === "string" && center !== "";
  svg.text(cx, cy + (hasCenter ? -2 : 10), pct[0], { size: 30, fill: BRAND, anchor: "middle", weight: "500" });
  if (hasCenter) svg.text(cx, cy + 20, center, { size: FS_NOTE, fill: STONE, anchor: "middle" });
  const rowh = 32;
  const y0 = cy - (rows.length * rowh) / 2;
  rows.forEach(([lab], i) => {
    const y = y0 + i * rowh;
    svg.add(square(SERIES[i])(c(lx), c(y + 10)));
    svg.text(lx + 22, y + 21, pct[i], { size: 14, fill: i === 0 ? BRAND : NEAR_BLACK, weight: i === 0 ? "500" : null });
    svg.text(lx + 22 + pctW + 14, y + 21, lab, { size: FS_LABEL, fill: OLIVE });
  });
  source(svg, spec, 0);
  return svg;
}

// --------------------------------------------------------- candlestick

function pyG(v) {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
}

function candlestick(spec) {
  if (!Array.isArray(spec.points)) throw new ChartError("candlestick: needs a 'points' list");
  const rows = spec.points.map((p, i) => {
    if (!isObject(p)) throw new ChartError(`points[${i}]: expected an object`);
    const [o, h, lo, cl] = ["open", "high", "low", "close"].map((k) => num(p[k], `points[${i}].${k}`));
    if (h < Math.max(o, cl) || lo > Math.min(o, cl)) {
      throw new ChartError(`points[${i}]: high ${pyG(h)} / low ${pyG(lo)} do not contain open ${pyG(o)} and close ${pyG(cl)}`);
    }
    return [label(p.label, `points[${i}]`), o, h, lo, cl];
  });
  limit("candlestick", rows.length);
  common(spec);
  const [lo, hi, step] = niceScale(Math.min(...rows.map((row) => row[3])), Math.max(...rows.map((row) => row[2])), false);
  const l = lang(spec, rows.map((row) => row[0]));
  const words = WORDS[l];
  const svg = new Svg(spec, "candlestick", width(spec, 760), height(true, spec), font(l));
  const x0 = plotLeft(lo, hi, step, spec.unit);
  const x1 = svg.width - 4;
  const ymap = linearMap(lo, hi);

  axis(svg, x0, x1, lo, hi, step, ymap, spec.unit);
  const n = rows.length;
  const stepx = (x1 - x0) / n;
  const bw = Math.min(16, stepx * 0.5);
  const every = Math.max(1, Math.ceil(n / 5));
  rows.forEach(([lab, o, h, lw, cl], i) => {
    const cx = x0 + stepx * (i + 0.5);
    const color = cl >= o ? BRAND : STONE;
    svg.add(`<line x1="${c(cx)}" y1="${c(ymap(h))}" x2="${c(cx)}" y2="${c(ymap(lw))}" stroke="${color}" stroke-width="1.2"/>`);
    const top = ymap(Math.max(o, cl)), bottom = ymap(Math.min(o, cl));
    svg.add(`<rect x="${c(cx - bw / 2)}" y="${c(top)}" width="${c(bw)}" height="${c(Math.max(1, bottom - top))}" fill="${color}" rx="1"/>`);
    if (i % every === 0 || (i === n - 1 && (n - 1) % every >= every / 2)) {
      svg.text(cx, LABEL_Y, lab, { size: FS_TICK, fill: STONE, anchor: "middle" });
    }
  });
  legend(svg, x0, x1, LEGEND_Y, [[square(BRAND), words.up], [square(STONE), words.down]]);
  source(svg, spec, 0);
  return svg;
}

// ----------------------------------------------------------- waterfall

function waterfall(spec) {
  if (!Array.isArray(spec.items)) throw new ChartError("waterfall: needs an 'items' list");
  limit("waterfall", spec.items.length);
  const [prefix, suffix] = common(spec);
  const rows = []; // [label, kind, value shown, level before, level after]
  let level = 0;
  spec.items.forEach((it, i) => {
    if (!isObject(it)) throw new ChartError(`items[${i}]: expected an object`);
    const lab = label(it.label, `items[${i}]`);
    if (it.total) {
      if ("value" in it) {
        const v = num(it.value, `items[${i}].value`);
        if (i > 0 && Math.abs(v - level) > 1e-9 * Math.max(1, Math.abs(level))) {
          throw new ChartError(`items[${i}] '${lab}': total ${pyG(v)} does not equal the running sum ${pyG(level)}`);
        }
        level = v;
      } else if (i === 0) {
        throw new ChartError("items[0]: an opening total needs a value");
      }
      rows.push([lab, "total", level, 0, level]);
    } else {
      const d = num(it.value, `items[${i}].value`);
      rows.push([lab, "delta", d, level, level + d]);
      level += d;
    }
  });
  const dec = decimals(spec, rows.map((row) => row[2]));
  const levels = rows.flatMap((row) => [row[3], row[4]]);
  const [lo, hi, step] = niceScale(Math.min(...levels), Math.max(...levels), true);
  const l = lang(spec, rows.map((row) => row[0]));
  const words = WORDS[l];
  const svg = new Svg(spec, "waterfall", width(spec, 720), height(true, spec), font(l));
  const x0 = plotLeft(lo, hi, step, spec.unit);
  const x1 = svg.width - 4;
  const ymap = linearMap(lo, hi);

  axis(svg, x0, x1, lo, hi, step, ymap, spec.unit);
  const n = rows.length;
  const stepx = (x1 - x0) / n;
  const bw = Math.min(64, stepx * 0.75);
  let prevEdge = null;
  rows.forEach(([lab, kind, v, before, after], i) => {
    const cx = x0 + stepx * (i + 0.5);
    const bx = cx - bw / 2;
    if (prevEdge !== null) {
      const y = ymap(kind === "delta" ? before : after);
      svg.add(`<line x1="${c(prevEdge)}" y1="${c(y)}" x2="${c(bx)}" y2="${c(y)}" stroke="${LIGHT_STONE}" stroke-width="0.8" stroke-dasharray="3 2"/>`);
    }
    const [a, b] = kind === "total" ? [0, after] : [before, after];
    const top = ymap(Math.max(a, b)), bottom = ymap(Math.min(a, b));
    const color = kind === "total" ? CHARCOAL : v >= 0 ? BRAND : STONE;
    svg.add(`<rect x="${c(bx)}" y="${c(top)}" width="${c(bw)}" height="${c(Math.max(1, bottom - top))}" fill="${color}" rx="2"/>`);
    const text = fmt(v, dec, prefix, suffix, kind === "delta");
    const ly = kind === "delta" && v < 0 ? bottom + 14 : top - 8;
    svg.text(cx, ly, text, { size: FS_VALUE, anchor: "middle", weight: "500" });
    svg.text(cx, LABEL_Y, lab, { size: FS_LABEL, anchor: "middle" });
    prevEdge = bx + bw;
  });
  legend(svg, x0, x1, LEGEND_Y, [
    [square(BRAND), words.increase], [square(STONE), words.decrease], [square(CHARCOAL), words.total],
  ]);
  source(svg, spec, 0);
  return svg;
}

const BUILDERS = { bar, line, hbar, donut, candlestick, waterfall };

export function renderChart(spec) {
  if (!isObject(spec)) throw new ChartError("spec must be a JSON object");
  const kind = spec.type;
  if (typeof kind !== "string" || !Object.hasOwn(BUILDERS, kind)) {
    throw new ChartError(`type must be one of ${Object.keys(BUILDERS).join(", ")}; got ${JSON.stringify(kind) ?? "nothing"}`);
  }
  return BUILDERS[kind](spec).render();
}

// ---------------------------------------------------------------- gate

const CHART_RE = /<svg\b[^>]*\bdata-kami-chart="[^"]*"[^>]*>[\s\S]*?<\/svg>/gi;
const SPEC_RE = /\bdata-kami-spec="([^"]*)"/;
const KIND_RE = /\bdata-kami-chart="([^"]*)"/;

/** Drawn content only: embedding may restyle the root tag, never the marks. */
function inner(svg) {
  return svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>")).replace(/>\s+</g, "><").trim();
}

export function findCharts(text) {
  return text.match(CHART_RE) ?? [];
}

/** null when the drawn chart matches its embedded spec, else the reason. */
export function compareChart(svg) {
  const m = SPEC_RE.exec(svg.slice(0, svg.indexOf(">") + 1));
  if (!m) return "no data-kami-spec on the chart root";
  let expected;
  try {
    expected = renderChart(JSON.parse(unesc(m[1])));
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof ChartError) return `embedded spec is invalid: ${err.message}`;
    throw err;
  }
  const want = inner(expected), got = inner(svg);
  if (want === got) return null;
  const wantParts = want.split("><"), gotParts = got.split("><");
  for (let i = 0; i < Math.min(wantParts.length, gotParts.length); i += 1) {
    const a = wantParts[i], b = gotParts[i];
    if (a !== b) {
      let at = 0;
      while (at < Math.min(a.length, b.length) && a[at] === b[at]) at += 1;
      const lo = Math.max(0, at - 24);
      return `drawn mark ${i} differs from the spec: expected ...${a.slice(lo, at + 24)}..., found ...${b.slice(lo, at + 24)}...`;
    }
  }
  return `${Math.abs(wantParts.length - gotParts.length)} mark(s) added or removed after generation`;
}

/** Check every generated chart in the given files; returns the exit code. */
export function checkCharts(files, log = console.log) {
  if (files.length === 0) {
    log("ERROR: usage: --check file.html|file.svg ...");
    return 2;
  }
  let failures = 0;
  for (const name of files) {
    if (!existsSync(name) || !statSync(name).isFile()) {
      log(`ERROR: ${name}: file not found`);
      return 2;
    }
    const charts = findCharts(readFileSync(name, "utf8"));
    if (charts.length === 0) {
      log(`OK: ${name}: no generated charts`);
      continue;
    }
    charts.forEach((svg, i) => {
      const kind = KIND_RE.exec(svg)[1];
      const reason = compareChart(svg);
      if (reason) {
        failures += 1;
        log(`ERROR: ${name}: chart ${i + 1} (${kind}): ${reason}; fix the spec and regenerate, never edit the SVG by hand`);
      } else {
        log(`OK: ${name}: chart ${i + 1} (${kind}) matches its data`);
      }
    });
  }
  return failures ? 1 : 0;
}

export function main(argv, log = console.log, write = (s) => process.stdout.write(s)) {
  const args = [...argv];
  if (args[0] === "--check") return checkCharts(args.slice(1), log);
  let out = null;
  const at = args.indexOf("-o");
  if (at >= 0) {
    if (at + 1 >= args.length) {
      log("ERROR: -o needs a path");
      return 2;
    }
    out = args[at + 1];
    args.splice(at, 2);
  }
  if (args.length !== 1 || args[0].startsWith("-")) {
    log("ERROR: usage: chart.mjs spec.json [-o chart.svg] | chart.mjs --check file.html ...");
    return 2;
  }
  let spec, svg;
  try {
    if (!existsSync(args[0])) {
      log(`ERROR: ${args[0]}: file not found`);
      return 2;
    }
    spec = JSON.parse(readFileSync(args[0], "utf8"));
    svg = renderChart(spec);
  } catch (err) {
    if (err instanceof SyntaxError) {
      log(`ERROR: ${args[0]}: invalid JSON: ${err.message}`);
      return 2;
    }
    if (err instanceof ChartError) {
      log(`ERROR: ${err.message}`);
      return 2;
    }
    throw err;
  }
  if (out) {
    writeFileSync(out, svg, "utf8");
    log(`OK: wrote ${out} (${spec.type})`);
  } else {
    write(svg);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
