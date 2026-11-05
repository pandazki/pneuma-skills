#!/usr/bin/env node

/**
 * Vector (SVG) generation — GPT Image 2.6 on fal.ai.
 *
 * One prompt in, one hand-authored SVG document out. fal runs two passes:
 * the image model (Flare, or Sunburst as an upgrade) first renders a
 * reference picture — `--quality` applies to that picture — and an author
 * model then writes the SVG from it (real `<path>`/`<circle>`/`<g>` markup
 * with a title and description, not a traced bitmap).
 *
 * Usage:
 *   node generate_svg.mjs "<prompt>" [--model flare|sunburst] [--author gpt-5.4]
 *     [--quality low|medium|high|auto] [--image-size 1024x1024]
 *     [--background auto|transparent|opaque] [--palette "#RRGGBB,#RRGGBB"]
 *     [--output-dir .] [--filename-prefix vector]
 *
 * What fal accepts, measured 2026-11-05:
 *   - only `openai/gpt-image-2.6/{flare,sunburst}/text-to-image` with
 *     `output_format: "svg"`; the edit endpoints have no SVG, so a
 *     reference image cannot be vectorised — every SVG is a new drawing;
 *   - one image per request (`num_images` must be 1);
 *   - the body MUST carry `provider_options: { svg: { model: <author> } }`;
 *     without it fal answers 422 "Invalid request". Authors that worked:
 *     gpt-5.4 (~20 s), gpt-6.1-terra (~30 s), gpt-5.5 (~60 s);
 *     gpt-5.5-mini was rejected. fal's docs do not list the allowed set,
 *     so another id is sent as given, with a note.
 *   - Line icon sets came out excellent and a geometric mark acceptable;
 *     lettering did not ("KETTLE & PINE" came back as "IKFTTLARINF" drawn
 *     as paths). Set wordmarks in real type instead.
 *
 * After the download the file is verified to be an SVG document (root
 * element `<svg>`, closed) and inspected: element counts, embedded raster
 * (`<image>`, raster data URIs — then it is not a true vector), `<text>`
 * (font-dependent), colours used (and, with `--palette`, which are off it),
 * a full-canvas background rect, and active content (`<script>`, event
 * handlers, `<foreignObject>`). Those facts are in the JSON `report` and
 * every concern is a line in `report.warnings`.
 *
 * One request per run: a lost answer may still be a paid job, so nothing is
 * resent once fal has accepted it (`fal-queue.mjs` only resends a submit fal
 * refused before a job existed). The file is written atomically and a run
 * never overwrites an existing file — the target is checked before paying.
 *
 * stdout: one JSON object { backend, model, author, endpoint, requestId,
 * files, urls, report, cost, ... }. stderr: progress, warnings and one
 * `cost:` line. fal bills this endpoint by tokens and reports no usage, so
 * the line says `cost: unknown (…)` with the list price — never a guess.
 * Exit 1 on failure, 130 on interrupt (the fal job is cancelled remotely).
 *
 * Environment: FAL_KEY, from the environment or a `.env` discovered by
 * `fal-queue.mjs::loadFalKey`. Never printed, never an argv.
 */

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { downloadFalFile, loadFalKey, runFalJob } from "./fal-queue.mjs";

/** Image model → fal's synchronous text-to-image endpoint (the queue host is derived). */
export const SVG_ENDPOINTS = Object.freeze({
  flare: "https://fal.run/openai/gpt-image-2.6/flare/text-to-image",
  sunburst: "https://fal.run/openai/gpt-image-2.6/sunburst/text-to-image",
});
export const DEFAULT_SVG_MODEL = "flare";
export const DEFAULT_SVG_AUTHOR = "gpt-5.4";
/** Authors measured working on 2026-11-05, with their typical wall time. */
export const MEASURED_SVG_AUTHORS = Object.freeze({ "gpt-5.4": "~20 s", "gpt-6.1-terra": "~30 s", "gpt-5.5": "~60 s" });
/** fal's quality enum; for SVG it sets the reference picture the author draws from. */
export const SVG_QUALITIES = ["auto", "low", "medium", "high"];
/** Low measured excellent for a six-icon line set (2026-11-05) and is the cheapest reference. */
export const DEFAULT_SVG_QUALITY = "low";
export const SVG_BACKGROUNDS = ["auto", "transparent", "opaque"];
export const DEFAULT_SVG_SIZE = "1024x1024";
export const DEFAULT_SVG_PREFIX = "vector";
/** fal's published `prompt` limit (OpenAPI `maxLength`). */
export const MAX_PROMPT_LENGTH = 32000;

/**
 * fal's published size rule for these endpoints (llms.txt / OpenAPI, read
 * 2026-11-05): both edges multiples of 16, longest edge ≤ 3840, aspect ≤ 3:1,
 * total pixels within [655,360, 8,294,400].
 */
export const SVG_SIZE_LIMITS = Object.freeze({ multiple: 16, maxEdge: 3840, maxAspect: 3, minPixels: 655_360, maxPixels: 8_294_400 });

/**
 * fal's list price for GPT Image 2.6 on these endpoints, per 1M tokens
 * (llms.txt, read 2026-11-05). How the author model's pass is billed is not
 * published, and fal returns no usage, so a run's cost cannot be computed.
 */
export const SVG_LIST_PRICE = Object.freeze({
  imageOutputPer1M: 30, imageInputPer1M: 8, textInputPer1M: 5, textOutputPer1M: 10, checked: "2026-11-05",
});

/** `flare`, `sunburst`, `gpt-image-2.6-flare` or `openai/gpt-image-2.6-sunburst` → the short name. */
export function resolveSvgModel(model = DEFAULT_SVG_MODEL) {
  const short = String(model).replace(/^openai\//, "").replace(/^gpt-image-2\.6-/, "");
  if (!Object.hasOwn(SVG_ENDPOINTS, short)) {
    throw new Error(`Invalid --model. Choices: ${Object.keys(SVG_ENDPOINTS).join(", ")} (GPT Image 2.6; SVG exists only on fal's text-to-image endpoints)`);
  }
  return short;
}

/** `WxH` → { width, height }, refused unless fal's published limits allow it. */
export function parseSvgSize(size = DEFAULT_SVG_SIZE) {
  const match = /^(\d+)x(\d+)$/.exec(String(size).trim().toLowerCase());
  if (!match) throw new Error(`Invalid --image-size: expected WxH, e.g. ${DEFAULT_SVG_SIZE} (got: ${size})`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  const { multiple, maxEdge, maxAspect, minPixels, maxPixels } = SVG_SIZE_LIMITS;
  const problems = [];
  if (width % multiple || height % multiple) problems.push(`both edges must be multiples of ${multiple}`);
  if (Math.max(width, height) > maxEdge) problems.push(`the longest edge must be at most ${maxEdge}`);
  if (Math.min(width, height) === 0 || Math.max(width, height) / Math.min(width, height) > maxAspect) problems.push(`the aspect ratio must be at most ${maxAspect}:1`);
  const pixels = width * height;
  if (pixels < minPixels || pixels > maxPixels) problems.push(`total pixels must be between ${minPixels.toLocaleString("en-US")} and ${maxPixels.toLocaleString("en-US")} (got ${pixels.toLocaleString("en-US")})`);
  if (problems.length) throw new Error(`Invalid --image-size ${size}: ${problems.join("; ")}`);
  return { width, height };
}

/** `"#F57843, #254f42"` → ["#f57843", "#254f42"]; anything but #rgb/#rrggbb is refused. */
export function parsePalette(palette) {
  if (palette == null || palette === "") return null;
  const entries = (Array.isArray(palette) ? palette : String(palette).split(/[\s,]+/)).map((v) => String(v).trim()).filter(Boolean);
  if (!entries.length) return null;
  return entries.map((entry) => {
    const hex = normalizeColor(entry);
    if (!hex?.startsWith("#")) throw new Error(`Invalid --palette entry: ${entry} (expected #RGB or #RRGGBB)`);
    return hex;
  });
}

/**
 * The exact request fal is sent, or a thrown refusal naming the flag at
 * fault. Everything checkable is checked here, before a paid request.
 */
export function buildSvgRequest({
  prompt,
  model = DEFAULT_SVG_MODEL,
  author = DEFAULT_SVG_AUTHOR,
  quality = DEFAULT_SVG_QUALITY,
  imageSize = DEFAULT_SVG_SIZE,
  background,
} = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("A nonempty prompt is required");
  if (prompt.length > MAX_PROMPT_LENGTH) throw new Error(`The prompt is ${prompt.length} characters; fal accepts at most ${MAX_PROMPT_LENGTH}`);
  const short = resolveSvgModel(model);
  const authorId = String(author ?? "").trim();
  // A shape check only: fal publishes no list of author ids to validate against.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(authorId)) throw new Error(`Invalid --author: ${author} (expected a model id such as ${DEFAULT_SVG_AUTHOR})`);
  if (!SVG_QUALITIES.includes(quality)) throw new Error(`Invalid --quality. Choices: ${SVG_QUALITIES.join(", ")}`);
  if (background != null && !SVG_BACKGROUNDS.includes(background)) throw new Error(`Invalid --background. Choices: ${SVG_BACKGROUNDS.join(", ")}`);
  const size = parseSvgSize(imageSize);
  const body = {
    prompt,
    output_format: "svg",
    num_images: 1,
    image_size: size,
    quality,
    provider_options: { svg: { model: authorId } },
  };
  // Omitted unless asked for, like the OpenRouter scripts.
  if (background != null) body.background = background;
  return { url: SVG_ENDPOINTS[short], model: `openai/gpt-image-2.6-${short}`, author: authorId, body };
}

// ---------------------------------------------------------------------------
// Inspection — facts about the document, read with regular expressions.
// No parser dependency: the script must run from an installed skill with
// `node` and nothing else. The checks are conservative counts, not rendering.
// ---------------------------------------------------------------------------

const RASTER_SIGNATURES = [
  { name: "PNG", test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { name: "JPEG", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { name: "GIF", test: (b) => b.length >= 6 && b.toString("ascii", 0, 4) === "GIF8" },
  { name: "WebP", test: (b) => b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
];

const NON_COLORS = new Set(["none", "currentcolor", "transparent", "inherit", "initial", "unset", "context-fill", "context-stroke"]);
const NAMED_COLORS = { white: "#ffffff", black: "#000000" };
const COLOR_PROPERTY = "fill|stroke|stop-color|flood-color|lighting-color|color";

const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/**
 * One paint value → `#rrggbb` (alpha dropped), a lower-cased name for a
 * named colour other than white/black, or null for a value that paints no
 * colour of its own (`none`, `currentColor`, a `url(#gradient)` reference).
 */
export function normalizeColor(value) {
  const v = String(value).replace(/!important/i, "").trim().toLowerCase();
  if (!v || NON_COLORS.has(v) || v.startsWith("url(")) return null;
  if (/^#[0-9a-f]{3,4}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) return v.slice(0, 7);
  const rgb = /^rgba?\(([^)]*)\)$/.exec(v);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (parts.length === 3) {
      const channels = parts.map((p) => (p.endsWith("%") ? (parseFloat(p) * 255) / 100 : parseFloat(p)));
      if (channels.every(Number.isFinite)) return `#${channels.map(toHex).join("")}`;
    }
    return v;
  }
  return NAMED_COLORS[v] ?? v;
}

const decodeEntities = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&");

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return match ? (match[1] ?? match[2]) : undefined;
}

/**
 * The document's root `<svg …>` start tag, or a thrown error saying what
 * the bytes are instead. A complete document closes with `</svg>`; a
 * truncated download or a self-closed empty root is refused.
 */
export function svgRootTag(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === "string" ? input : input ?? []);
  if (!bytes.length) throw new Error("not an SVG document: the file is empty");
  const raster = RASTER_SIGNATURES.find((s) => s.test(bytes));
  if (raster) throw new Error(`not an SVG document: received ${raster.name} image bytes`);
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  const prolog = /^(?:\s+|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)*/i.exec(text)[0];
  const rest = text.slice(prolog.length);
  const root = /^<svg(?=[\s>/])[^>]*>/.exec(rest);
  if (!root) {
    const first = /^<\s*([A-Za-z][\w:.-]*)/.exec(rest);
    throw new Error(`not an SVG document: the root element is ${first ? `<${first[1]}>` : `not markup (${JSON.stringify(rest.slice(0, 40))})`}`);
  }
  if (!/<\/svg\s*>(?:\s|<!--[\s\S]*?-->)*$/.test(rest)) throw new Error("not a complete SVG document: the root <svg> is never closed (truncated or empty)");
  return root[0];
}

/**
 * Facts about an SVG a caller needs before trusting it as a vector asset.
 * Throws when the bytes are not a complete SVG document.
 *
 * @param {Buffer|string} input
 * @param {{ palette?: string[] | string | null }} [options] colours to compare against
 */
export function inspectSvg(input, { palette } = {}) {
  const rootTag = svgRootTag(input);
  const raw = Buffer.isBuffer(input) ? input.toString("utf8") : String(input);
  const text = raw.replace(/<!--[\s\S]*?-->/g, "");
  const paletteHexes = parsePalette(palette);

  const byTag = {};
  let total = 0;
  for (const match of text.matchAll(/<([A-Za-z][\w:.-]*)/g)) {
    byTag[match[1]] = (byTag[match[1]] ?? 0) + 1;
    total += 1;
  }

  const imageElements = byTag.image ?? 0;
  const rasterDataUris = (text.match(/data:image\/(?:png|jpe?g|webp|gif|avif|bmp)/gi) ?? []).length;
  const externalRefs = (text.match(/(?:\shref|\sxlink:href)\s*=\s*["']\s*https?:|url\(\s*["']?https?:/gi) ?? []).length;
  const textElements = byTag.text ?? 0;
  const fonts = new Set();
  for (const m of text.matchAll(/font-family\s*(?:=\s*(?:"([^"]*)"|'([^']*)')|:\s*([^;"}]+))/gi)) {
    fonts.add((m[1] ?? m[2] ?? m[3]).trim());
  }
  const scripts = byTag.script ?? 0;
  const foreignObjects = byTag.foreignObject ?? 0;
  const eventHandlers = (text.match(/<[^>]*?\son[a-z]+\s*=/gi) ?? []).length;

  // Paint: presentation attributes, `style="…"` declarations and <style> blocks.
  const colors = new Set();
  const addColor = (value) => {
    const color = normalizeColor(value);
    if (color) colors.add(color);
  };
  for (const m of text.matchAll(new RegExp(`\\s(?:${COLOR_PROPERTY})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "gi"))) addColor(m[1] ?? m[2]);
  const css = [
    ...[...text.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2]),
    ...[...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]),
  ].join(";");
  for (const m of css.matchAll(new RegExp(`(?:^|[;{\\s])(?:${COLOR_PROPERTY})\\s*:\\s*([^;}]+)`, "gi"))) addColor(m[1]);

  // A first drawn shape that is a rect covering the whole canvas paints the
  // file's own background: the asset is not transparent. Shapes inside
  // definitions (clip paths, masks, patterns, symbols) are never drawn as is.
  const viewBox = attribute(rootTag, "viewBox");
  const width = attribute(rootTag, "width");
  const height = attribute(rootTag, "height");
  const box = viewBox?.trim().split(/[\s,]+/).map(Number);
  let background = null;
  const drawn = text.replace(/<(defs|clipPath|mask|pattern|symbol|marker)\b[\s\S]*?<\/\1\s*>/g, "");
  const firstShape = /<(rect|path|circle|ellipse|polygon|polyline|line|use|image|text)\b[^>]*>/.exec(drawn);
  if (firstShape?.[1] === "rect") {
    const tag = firstShape[0];
    const at = (name) => attribute(tag, name);
    const origin = ["x", "y"].every((k) => !at(k) || Number.parseFloat(at(k)) === (box?.length === 4 ? box[k === "x" ? 0 : 1] : 0));
    const covers = (k, i) => at(k) === "100%" || (box?.length === 4 && Number.parseFloat(at(k)) >= box[i]) || (!box && at(k) === (k === "width" ? width : height));
    const fill = at("fill") ?? /fill\s*:\s*([^;]+)/.exec(at("style") ?? "")?.[1];
    if (origin && covers("width", 2) && covers("height", 3)) {
      // No fill of its own: it paints whatever a parent group sets (black by
      // default). A gradient or pattern fill paints too, reported by reference.
      const paint = fill?.trim();
      background = paint === undefined ? "inherited fill" : paint.startsWith("url(") ? paint : normalizeColor(paint);
    }
  }

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(text);
  const descMatch = /<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(text);
  const clip = (s) => (s ? decodeEntities(s.trim()).slice(0, 300) : null);

  const report = {
    bytes: Buffer.byteLength(raw),
    viewBox: viewBox ?? null,
    width: width ?? null,
    height: height ?? null,
    title: clip(titleMatch?.[1]),
    desc: clip(descMatch?.[1]),
    elements: { total, byTag },
    vector: { pure: imageElements === 0 && rasterDataUris === 0, imageElements, rasterDataUris, externalRefs },
    text: { elements: textElements, fonts: [...fonts] },
    colors: [...colors],
    background,
    activeContent: { scripts, eventHandlers, foreignObjects },
    warnings: [],
  };
  if (paletteHexes) report.offPalette = report.colors.filter((c) => !paletteHexes.includes(c));

  const w = report.warnings;
  if (!report.vector.pure) w.push(`embeds raster content (${imageElements} <image>, ${rasterDataUris} raster data URI) — not a true vector; it will not scale cleanly or recolour`);
  if (externalRefs) w.push(`references ${externalRefs} external URL(s) — not self-contained; an <img> will not load them`);
  if (textElements) w.push(`uses ${textElements} <text> element(s)${fonts.size ? ` (font-family: ${[...fonts].join(" | ")})` : ""} — lettering renders in whatever font the viewer has; set type in a real specimen or outline it`);
  if (scripts || eventHandlers || foreignObjects) w.push(`carries active content (${scripts} <script>, ${eventHandlers} event handler, ${foreignObjects} <foreignObject>) — strip it before distributing; never inline this file into a page`);
  if (background) w.push(`paints its own full-canvas background (${background}) — the asset is not transparent`);
  if (report.offPalette?.length) w.push(`uses colours outside the palette: ${report.offPalette.join(", ")}`);
  if (!viewBox) w.push("has no viewBox — it will not scale predictably");
  return report;
}

// ---------------------------------------------------------------------------
// Cost — said, never invented.
// ---------------------------------------------------------------------------

/** What this run cost, as far as can be said: fal reports no usage for it. */
export function svgCost({ author = DEFAULT_SVG_AUTHOR } = {}) {
  return {
    usd: null,
    estimate: true,
    basis: "unknown",
    note: `fal bills GPT Image 2.6 SVG by tokens — the reference picture plus the ${author} authoring pass — and reports no usage`,
    listPrice: { ...SVG_LIST_PRICE, unit: "USD per 1M tokens" },
  };
}

/** The one stderr line a `cost` object is said in. */
export function costLine(cost = svgCost()) {
  const p = cost.listPrice ?? SVG_LIST_PRICE;
  return `cost: unknown (${cost.note}; fal lists image output at $${p.imageOutputPer1M} per 1M tokens, image input $${p.imageInputPer1M}, text input $${p.textInputPer1M}, text output $${p.textOutputPer1M}; how the authoring pass is billed is not published; read ${p.checked})`;
}

const withRequestId = (error, requestId) => {
  if (requestId && error && typeof error === "object" && error.requestId === undefined) error.requestId = requestId;
  return error;
};

/**
 * Run one SVG generation and write `<outputDir>/<filenamePrefix>.svg`.
 *
 * Everything checkable — the request, the palette, the key, and whether the
 * target already exists — is checked before the request is sent. `fetchImpl`
 * reaches both fal's queue and the download, so a test never touches fal.
 */
export async function generateSvg(options, { fetchImpl = fetch, sleep } = {}) {
  const {
    apiKey, outputDir = ".", filenamePrefix = DEFAULT_SVG_PREFIX, palette, signal,
    deadlineMs = 10 * 60_000, onNote = (m) => console.error(m),
  } = options;
  const request = buildSvgRequest(options);
  const paletteHexes = parsePalette(palette);
  if (typeof filenamePrefix !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filenamePrefix)) {
    throw new Error(`Invalid --filename-prefix: ${filenamePrefix} (letters, digits, dot, dash, underscore; no path)`);
  }
  const path = resolve(outputDir, `${filenamePrefix.replace(/\.svg$/i, "")}.svg`);
  if (existsSync(path)) throw new Error(`${path} already exists — choose another --filename-prefix; a paid result never overwrites a file`);
  if (!apiKey) throw new Error("FAL_KEY not found. SVG generation runs on fal.ai: set FAL_KEY in the environment or the skill .env.");

  if (!Object.hasOwn(MEASURED_SVG_AUTHORS, request.author)) {
    onNote(`NOTE: author ${request.author} is not one of the measured ones (${Object.keys(MEASURED_SVG_AUTHORS).join(", ")}); fal may reject it (gpt-5.5-mini was rejected 2026-11-05).`);
  }
  const typical = MEASURED_SVG_AUTHORS[request.author] ?? "20–60 s";
  onNote(`[fal:${request.model} → svg by ${request.author}] one request, typically ${typical}...`);

  const job = await runFalJob({
    url: request.url,
    body: request.body,
    key: apiKey,
    signal,
    deadlineMs,
    label: "GPT Image 2.6 SVG",
    fetchImpl,
    ...(sleep ? { sleep } : {}),
    onRetry: ({ attempt, attempts, delayMs, reason }) => {
      onNote(`WARN: fal refused the submit before a job existed (${String(reason).slice(0, 160)}) — resending in ${delayMs / 1000}s (attempt ${attempt} of ${attempts})`);
    },
  });
  const requestId = job.requestId;
  const image = job.data?.images?.[0];
  if (!image?.url) {
    throw withRequestId(new Error(`fal returned no SVG URL: ${JSON.stringify(job.data ?? null).slice(0, 300)}`), requestId);
  }

  let bytes;
  try {
    bytes = await downloadFalFile(image.url, { signal, fetchImpl, ...(sleep ? { sleep } : {}), onNote });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw withRequestId(new Error(`the SVG was generated but its download failed (${error instanceof Error ? error.message : String(error)}) — fetch it from ${image.url}; do not resubmit`), requestId);
  }

  let report;
  try {
    report = inspectSvg(bytes, { palette: paletteHexes });
  } catch (error) {
    throw withRequestId(new Error(`fal's result is ${error instanceof Error ? error.message : String(error)} (content type ${image.content_type ?? "unreported"}; ${image.url}) — nothing was saved`), requestId);
  }

  mkdirSync(resolve(outputDir), { recursive: true });
  const staged = join(resolve(outputDir), `.${filenamePrefix}.${process.pid}.svg.tmp`);
  try {
    writeFileSync(staged, bytes, { flag: "wx" });
    renameSync(staged, path);
  } finally {
    rmSync(staged, { force: true });
  }
  onNote(`[fal] Saved: ${path}`);
  for (const warning of report.warnings) onNote(`WARN: ${warning}`);

  return {
    backend: "fal",
    model: request.model,
    author: request.author,
    endpoint: request.url,
    requestId: requestId ?? null,
    quality: request.body.quality,
    imageSize: `${request.body.image_size.width}x${request.body.image_size.height}`,
    ...(request.body.background ? { background: request.body.background } : {}),
    generatedAt: new Date().toISOString(),
    seconds: Math.round(job.apiMs / 100) / 10,
    files: [path],
    urls: [image.url],
    report,
    cost: svgCost({ author: request.author }),
  };
}

const HELP = `Usage: generate_svg.mjs <prompt> [options]

One vector (SVG) asset through GPT Image 2.6 on fal.ai. The image model
renders a reference picture, then an author model writes the SVG markup.

  --model <name>           flare (default) or sunburst (upgrade; slower)
  --author <id>            SVG author model (default: ${DEFAULT_SVG_AUTHOR})
                           Measured 2026-11-05: ${Object.entries(MEASURED_SVG_AUTHORS).map(([id, t]) => `${id} ${t}`).join(", ")};
                           gpt-5.5-mini was rejected. Other ids are sent as given.
  --quality <level>        ${SVG_QUALITIES.join(", ")} (default: ${DEFAULT_SVG_QUALITY}) — sets the
                           reference picture, not the vector's precision
  --image-size <WxH>       Reference canvas (default: ${DEFAULT_SVG_SIZE}); edges multiples of 16,
                           longest edge <= 3840, aspect <= 3:1, 655,360..8,294,400 pixels
  --background <mode>      ${SVG_BACKGROUNDS.join(", ")} (omitted unless passed)
  --palette <hex,...>      Compare the colours used against these (#RGB/#RRGGBB)
  --output-dir <path>      Output directory (default: .)
  --filename-prefix <name> File name without extension (default: ${DEFAULT_SVG_PREFIX}); an
                           existing file is never overwritten
  --help, -h               This text

Limits: one SVG per request; no reference images (it cannot vectorise an
existing raster — describe the drawing precisely); lettering is unreliable
(set wordmarks in real type). Each run is one paid request; nothing is
resent after fal accepts it.

Requires FAL_KEY (environment or .env). stdout is one JSON object: backend,
model, author, endpoint, requestId, files, urls, report (element counts,
vector/raster, <text>, colours, offPalette, background, warnings) and cost.
fal reports no usage for this endpoint, so stderr says "cost: unknown (...)"
with fal's list price.`;

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      model: { type: "string", default: DEFAULT_SVG_MODEL },
      author: { type: "string", default: DEFAULT_SVG_AUTHOR },
      quality: { type: "string", default: DEFAULT_SVG_QUALITY },
      "image-size": { type: "string", default: DEFAULT_SVG_SIZE },
      background: { type: "string" },
      palette: { type: "string" },
      "output-dir": { type: "string", default: "." },
      "filename-prefix": { type: "string", default: DEFAULT_SVG_PREFIX },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.error(HELP);
    return 0;
  }
  if (positionals.length !== 1) throw new Error("Usage: generate_svg.mjs <prompt> [options] (the prompt is the one positional argument)");

  const controller = new AbortController();
  const handlers = new Map();
  let interruptedBy = null;
  for (const name of ["SIGTERM", "SIGINT"]) {
    const handler = () => {
      if (interruptedBy) process.exit(130);
      interruptedBy = name;
      controller.abort(new DOMException(`received ${name}`, "AbortError"));
    };
    handlers.set(name, handler);
    process.on(name, handler);
  }

  const author = values.author;
  try {
    const result = await generateSvg({
      prompt: positionals[0],
      model: values.model,
      author,
      quality: values.quality,
      imageSize: values["image-size"],
      background: values.background,
      palette: values.palette,
      outputDir: values["output-dir"],
      filenamePrefix: values["filename-prefix"],
      apiKey: loadFalKey(),
      signal: controller.signal,
    });
    console.error(costLine(result.cost));
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    if (error?.requestId) console.error(costLine(svgCost({ author })));
    if (interruptedBy || error?.name === "AbortError") {
      console.error(`ERROR: ${interruptedBy ?? "interrupted"} — the fal.ai job was cancelled${error?.requestId ? ` (request ${error.requestId})` : ""}`);
      return 130;
    }
    if (error?.requestId) {
      error.message = `${error.message} (fal request ${error.requestId}: the job may already be billed — do not resubmit blindly)`;
    }
    throw error;
  } finally {
    for (const [name, handler] of handlers) process.off(name, handler);
  }
}

function isMain() {
  if (typeof import.meta.main === "boolean") return import.meta.main;
  const entry = process.argv[1] ? resolve(process.argv[1]) : null;
  return entry !== null && fileURLToPath(import.meta.url) === entry;
}

if (isMain()) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
