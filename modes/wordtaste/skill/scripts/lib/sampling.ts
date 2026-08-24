/**
 * Deterministic sampling: the seeded generator, paragraph windows, the author
 * lottery of the primer sampler, and the voice sampler.
 *
 * Ports the bash-era `primer_env.sh` (the PRNG), `primer_sample.sh`, and `voice_sample.sh`
 * with identical arithmetic and identical draw order, so a seed that selected
 * one window in the bash era selects the same bytes here. The fixtures under
 * `__tests__/fixtures/` pin that equivalence.
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { byteCompare, realpathOrNull, scriptsDir } from "./session.ts";

/** A sampler-level refusal: one neutral message, exit 2 at the entry point. */
export class SamplerError extends Error {}

// ── POSIX cksum ─────────────────────────────────────────────────────────────
// CRC-32/CKSUM: polynomial 0x04C11DB7, MSB-first, init 0, the input length
// appended as minimal LSB-first bytes, final complement. This is what `cksum`
// computed for `wt_rand_init`, pinned by `fixtures/cksum-pins.json`.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = (i << 24) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) {
      c = ((c & 0x80000000) !== 0 ? (c << 1) ^ 0x04c11db7 : c << 1) >>> 0;
    }
    table[i] = c;
  }
  return table;
})();

export function cksum(input: string): number {
  const bytes = Buffer.from(input, "utf8");
  let crc = 0;
  for (const byte of bytes) {
    crc = (((crc << 8) >>> 0) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  }
  let length = bytes.length;
  while (length > 0) {
    crc = (((crc << 8) >>> 0) ^ CRC_TABLE[((crc >>> 24) ^ (length & 0xff)) & 0xff]!) >>> 0;
    length >>>= 8;
  }
  return (~crc) >>> 0;
}

// ── the seeded generator ────────────────────────────────────────────────────
// `cksum` of the seed feeds a linear congruential generator. The multiply
// exceeds 2^53, so it runs in BigInt; everything else stays in Number.

export interface SeededRandom {
  below(n: number): number;
}

export function createRandom(seed: string): SeededRandom {
  let state = cksum(seed) % 2147483647;
  if (state <= 0) state = 1;
  return {
    below(n: number): number {
      state = Number((BigInt(state) * 1103515245n + 12345n) % 2147483648n);
      return state % n;
    },
  };
}

// ── character counting ──────────────────────────────────────────────────────
// The bash side removed exactly space/tab/newline/CR and counted codepoints
// with `wc -m` in a UTF-8 locale. `[...s]` iterates codepoints identically.

export function countChars(text: string): number {
  return [...text.replace(/[ \t\n\r]/g, "")].length;
}

// ── paragraph splitting ─────────────────────────────────────────────────────
// Frontmatter-aware, blank-line-delimited, mirroring the awk splitter: line 1
// equal to `---` opens frontmatter that runs to the next `---`; a body line of
// only C-locale whitespace closes the open paragraph.

const BLANK = /^[\t\v\f\r ]*$/;

export function splitParagraphs(text: string): string[][] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const paragraphs: string[][] = [];
  let current: string[] | null = null;
  let frontmatter = false;
  let body = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (i === 0) {
      if (line === "---") {
        frontmatter = true;
        continue;
      }
      body = true;
    }
    if (frontmatter) {
      if (line === "---") {
        frontmatter = false;
        body = true;
      }
      continue;
    }
    if (!body) continue;
    if (BLANK.test(line)) {
      if (current !== null) {
        paragraphs.push(current);
        current = null;
      }
    } else {
      if (current === null) current = [];
      current.push(line);
    }
  }
  if (current !== null) paragraphs.push(current);
  return paragraphs;
}

// ── paragraph-aligned window ────────────────────────────────────────────────

export interface Window {
  /** The window text as the bash renderer wrote it: each paragraph's lines
   * newline-terminated, one blank line between paragraphs. */
  text: string;
  chars: number;
}

/**
 * One window out of a piece. Consumes the generator only when the piece can
 * reach `min` — the same conditional draw the bash sampler made, which is what
 * keeps the whole draw sequence aligned with the recorded fixtures.
 */
export function buildWindow(
  pieceText: string,
  minChars: number,
  maxChars: number,
  rand: SeededRandom,
): Window | null {
  const paragraphs = splitParagraphs(pieceText);
  const total = paragraphs.length;
  if (total === 0) return null;

  const pchars: number[] = [];
  let pieceChars = 0;
  for (const paragraph of paragraphs) {
    const count = countChars(paragraph.join("\n"));
    pchars.push(count);
    pieceChars += count;
  }
  if (pieceChars <= 0) return null;

  let start = 0;
  let last = total - 1;
  let acc = pieceChars;

  if (pieceChars >= minChars) {
    // Only start where the remaining tail can still reach the minimum.
    let maxStart = 0;
    let suffix = 0;
    for (let i = last; i >= 0; i -= 1) {
      suffix += pchars[i]!;
      if (suffix >= minChars) {
        maxStart = i;
        break;
      }
    }
    start = rand.below(maxStart + 1);
    last = start;
    acc = pchars[start]!;
    // A paragraph longer than the maximum stands alone: a window never cuts
    // inside one of the author's paragraphs.
    if (acc <= maxChars) {
      while (acc < minChars && last + 1 < total) {
        const candidate = acc + pchars[last + 1]!;
        if (candidate > maxChars) break;
        last += 1;
        acc = candidate;
      }
    }
  }

  const rendered = paragraphs
    .slice(start, last + 1)
    .map((paragraph) => `${paragraph.join("\n")}\n`)
    .join("\n");
  return { text: rendered, chars: acc };
}

// ── frame sections ──────────────────────────────────────────────────────────
// The framing text the writer reads around the passages: the fenced block of
// one `## <name>` section, copied verbatim.

export function frameSection(frameText: string, want: string): string {
  const out: string[] = [];
  let sec = "";
  let captured = false;
  let inFence = false;
  for (const line of frameText.split("\n")) {
    if (/^## /.test(line)) {
      const fields = line.split(/[ \t]+/);
      sec = fields[1] ?? "";
      captured = false;
      inFence = false;
      continue;
    }
    if (sec === want && !captured && /^```/.test(line)) {
      if (inFence) {
        captured = true;
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }
    if (sec === want && inFence) out.push(line);
  }
  return out.join("\n");
}

// ── the primer sampler ──────────────────────────────────────────────────────

export interface PrimerOptions {
  seed: string;
  libs?: string;
  count?: number;
  min?: number;
  max?: number;
  total?: number;
  voiceDir?: string;
  frameFile?: string;
}

const bundledDir = join(scriptsDir, "..", "references", "primer");

function listMarkdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(dir, entry.name))
    .sort(byteCompare);
}

/** `<file, author>` pairs for one library, or nothing when it is unusable. */
function collectLibrary(dir: string, bundledReal: string | null): Array<{ file: string; author: string }> {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const real = realpathOrNull(dir);
  if (real === null) return [];
  // A user library must declare itself with a library.json. The bundled
  // public-domain directory is the one exception; it ships as part of the mode.
  if (real !== bundledReal && !existsSync(join(real, "library.json"))) return [];

  const entries: Array<{ file: string; author: string }> = [];
  for (const file of listMarkdownFiles(real)) {
    const lines = readFileSync(file, "utf8").split("\n");
    // Line 1 opens frontmatter only when it is `---`; without frontmatter the
    // piece carries no author and is unusable, exactly as the awk pass had it.
    if (lines[0] !== "---") continue;
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (line === "---") break;
      if (line.startsWith("author:")) {
        const value = line.replace(/^author:[ ]*/, "").replace(/[ \r]+$/, "");
        if (value !== "") entries.push({ file, author: value });
        break;
      }
    }
  }
  return entries;
}

/**
 * The rendered primer block: framing, windows separated by lone `※` lines,
 * an optional voice window, framing again. Returns "" when no enabled library
 * has a usable piece — priming is optional and never fatal.
 */
export function samplePrimer(options: PrimerOptions): string {
  const count = options.count ?? 3;
  const minChars = options.min ?? 350;
  const maxChars = options.max ?? 900;
  const totalChars = options.total ?? 2000;
  const frameFile = options.frameFile && options.frameFile.length > 0 ? options.frameFile : join(bundledDir, "frame.md");
  const libsArg = options.libs && options.libs.length > 0 ? options.libs : bundledDir;

  if (!existsSync(frameFile) || !statSync(frameFile).isFile()) {
    throw new SamplerError("frame file not found");
  }
  const frameText = readFileSync(frameFile, "utf8");
  const beforeText = frameSection(frameText, "before");
  const afterText = frameSection(frameText, "after");
  const voiceText = frameSection(frameText, "voice");
  if (beforeText === "" || afterText === "") {
    throw new SamplerError("frame file has no before/after block");
  }

  const rand = createRandom(options.seed);
  const bundledReal = realpathOrNull(bundledDir);

  const index: Array<{ file: string; author: string }> = [];
  for (const libDir of libsArg.split(":")) {
    index.push(...collectLibrary(libDir, bundledReal));
  }
  if (index.length === 0) return "";

  // ── author lottery ──
  const authors = [...new Set(index.map((entry) => entry.author))].sort(byteCompare);
  const authorTotal = authors.length;
  if (authorTotal === 0) return "";
  const picks = Math.min(count, authorTotal);
  for (let i = 0; i < picks; i += 1) {
    const swap = i + rand.below(authorTotal - i);
    const hold = authors[i]!;
    authors[i] = authors[swap]!;
    authors[swap] = hold;
  }

  // ── one window per chosen author, inside the total budget ──
  let used = 0;
  const kept: string[] = [];
  for (let a = 0; a < picks; a += 1) {
    const author = authors[a]!;
    const authorFiles = index
      .filter((entry) => entry.author === author)
      .map((entry) => entry.file)
      .sort(byteCompare);
    if (authorFiles.length === 0) continue;
    const chosen = authorFiles[rand.below(authorFiles.length)]!;
    const window = buildWindow(readFileSync(chosen, "utf8"), minChars, maxChars, rand);
    if (window === null) continue;
    if (used + window.chars > totalChars) break;
    used += window.chars;
    kept.push(window.text);
  }
  if (kept.length === 0) return "";

  // ── the user's own voice, when the content set carries one ──
  let voiceWindow: Window | null = null;
  if (
    options.voiceDir &&
    existsSync(options.voiceDir) &&
    statSync(options.voiceDir).isDirectory() &&
    voiceText !== ""
  ) {
    const voiceFiles = listMarkdownFiles(realpathOrNull(options.voiceDir) ?? options.voiceDir);
    if (voiceFiles.length > 0) {
      const choice = voiceFiles[rand.below(voiceFiles.length)]!;
      const window = buildWindow(readFileSync(choice, "utf8"), minChars, maxChars, rand);
      if (window !== null && used + window.chars <= totalChars) voiceWindow = window;
    }
  }

  // ── render ──
  let out = `${beforeText}\n\n`;
  for (let k = 0; k < kept.length; k += 1) {
    if (k > 0) out += "※\n\n";
    out += `${kept[k]}\n`;
  }
  if (voiceWindow !== null) {
    out += `※\n\n${voiceText}\n\n`;
    out += `${voiceWindow.text}\n`;
  }
  out += `${afterText}\n`;
  return out;
}

// ── the voice sampler ───────────────────────────────────────────────────────

/** Strip HTML comments, including ones that span lines; trim; drop empties. */
export function stripComments(text: string): string[] {
  const out: string[] = [];
  let inComment = false;
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const rawLine of lines) {
    let line = rawLine;
    let kept = "";
    for (;;) {
      if (inComment) {
        const close = line.indexOf("-->");
        if (close < 0) {
          line = "";
          break;
        }
        line = line.slice(close + 3);
        inComment = false;
      }
      const open = line.indexOf("<!--");
      if (open < 0) {
        kept += line;
        break;
      }
      kept += line.slice(0, open);
      line = line.slice(open + 4);
      inComment = true;
    }
    kept = kept.replace(/^[ \t]+/, "").replace(/[ \t\r]+$/, "");
    if (kept !== "") out.push(kept);
  }
  return out;
}

// Caps. The block sits last in the writer's prompt, so it stays small enough
// to sharpen the prose rather than crowd out the material.
const MAX_DIRECTIVES = 10;
const MAX_SWAPS = 2;
const WINDOW_MIN = 300;
const WINDOW_MAX = 600;
const EXAMPLES_BUDGET = 900;

/**
 * Write `voice_style.en.md` / `voice_examples.md` into `outDir` out of a taste
 * directory. Everything degrades to silence; both parts are removed on entry
 * so a re-run after the user emptied `taste/` leaves nothing stale behind.
 */
export function sampleVoice(tasteDir: string, outDir: string, seed: string): void {
  const rand = createRandom(seed);
  const outReal = realpathOrNull(outDir) ?? outDir;
  const styleOut = join(outReal, "voice_style.en.md");
  const examplesOut = join(outReal, "voice_examples.md");
  rmSync(styleOut, { force: true });
  rmSync(examplesOut, { force: true });

  if (!existsSync(tasteDir) || !statSync(tasteDir).isDirectory()) return;
  const taste = realpathOrNull(tasteDir) ?? tasteDir;

  // ── the directives ──
  const styleSrc = join(taste, "style.en.md");
  if (existsSync(styleSrc) && statSync(styleSrc).size > 0) {
    const lines = stripComments(readFileSync(styleSrc, "utf8")).slice(0, MAX_DIRECTIVES);
    if (lines.length > 0) writeFileSync(styleOut, `${lines.join("\n")}\n`);
  }

  // ── the user's own hand edits ──
  // One JSON object per line; a truncated or hand-mangled line is skipped. A
  // pair is usable only when both sides are a single non-empty line.
  const pairs: string[] = [];
  const swapsSrc = join(taste, "examples", "swaps.jsonl");
  if (existsSync(swapsSrc) && statSync(swapsSrc).size > 0) {
    for (const line of readFileSync(swapsSrc, "utf8").split("\n")) {
      if (line.length === 0) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const before = parsed.before;
        const after = parsed.after;
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          typeof before === "string" &&
          typeof after === "string" &&
          before.length > 0 &&
          after.length > 0 &&
          !before.includes("\n") &&
          !after.includes("\n")
        ) {
          pairs.push(`- ${before}\n+ ${after}\n`);
        }
      } catch {
        // Junk lines are dropped, never fatal.
      }
    }
  }

  // ── a window out of an accepted piece ──
  // Drawn before the swap lottery, matching the bash sampler's generator order.
  let window: Window | null = null;
  const positiveDir = join(taste, "examples", "positive");
  if (existsSync(positiveDir) && statSync(positiveDir).isDirectory()) {
    const positiveFiles = listMarkdownFiles(positiveDir);
    if (positiveFiles.length > 0) {
      const choice = positiveFiles[rand.below(positiveFiles.length)]!;
      window = buildWindow(readFileSync(choice, "utf8"), WINDOW_MIN, WINDOW_MAX, rand);
    }
  }

  // ── assemble the examples inside one budget ──
  const picks: number[] = [];
  if (pairs.length > 0) {
    const order = pairs.map((_, i) => i);
    const take = Math.min(MAX_SWAPS, pairs.length);
    for (let i = 0; i < take; i += 1) {
      const swap = i + rand.below(pairs.length - i);
      const hold = order[i]!;
      order[i] = order[swap]!;
      order[swap] = hold;
      picks.push(order[i]!);
    }
  }

  let staged = "";
  let used = 0;
  let wrote = false;
  for (const index of picks) {
    const pair = pairs[index]!;
    const pairChars = countChars(pair);
    if (used + pairChars > EXAMPLES_BUDGET) continue;
    if (wrote) staged += "\n";
    staged += pair;
    used += pairChars;
    wrote = true;
  }
  if (window !== null && used + window.chars <= EXAMPLES_BUDGET) {
    if (wrote) staged += "\n";
    staged += window.text;
    wrote = true;
  }

  if (wrote && staged.length > 0) writeFileSync(examplesOut, staged);
}
