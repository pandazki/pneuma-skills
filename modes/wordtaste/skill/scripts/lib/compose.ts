/**
 * Shared composition plumbing: scaffolding loading, atomic prompt writes, and
 * the writer-prompt composer that both `compose_leaf_prompt.ts` and the check
 * cycle's composed-repair path invoke.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  assembleLeafPrompt,
  assembleLeafSystem,
  hasLeafScaffolding,
  type LeafParts,
  type Scaffolding,
} from "./prompt-assembly.ts";
import { SamplerError, frameSection, samplePrimer } from "./sampling.ts";
import { primerLibs, primerSeed, realpathOrNull, scriptsDir } from "./session.ts";

/** A composer refusal. `message` is the exact one-line stderr contract. */
export class ComposeError extends Error {}

/**
 * The writer's standing charter, written beside every composed prompt. The
 * leaf router looks for this exact sibling name and sends it through the
 * strongest channel the route has; a prompt without one dispatches exactly as
 * it always did.
 */
export const SYSTEM_PART = "system.en.md";

export const scaffoldPath = join(scriptsDir, "..", "references", "prompt-scaffolding.en.json");
export const framePath = join(scriptsDir, "..", "references", "primer", "frame.md");

export function fileNonEmpty(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function readPart(path: string): string | undefined {
  return fileNonEmpty(path) ? readFileSync(path, "utf8") : undefined;
}

/** The parsed scaffolding file, or null when missing or unparsable. */
export function loadScaffolding(): Record<string, unknown> | null {
  if (!fileNonEmpty(scaffoldPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(scaffoldPath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Atomic write: a staged sibling replaces the target in one rename. */
export function writePromptFile(outFile: string, content: string): void {
  mkdirSync(dirname(outFile), { recursive: true });
  const outDir = realpathOrNull(dirname(outFile)) ?? dirname(outFile);
  const target = join(outDir, basename(outFile));
  const staged = `${target}.tmp.${process.pid}`;
  writeFileSync(staged, content);
  renameSync(staged, target);
}

const BLANK = /^[\t\v\f\r ]*$/;

/**
 * The reference passages for one parts directory: the sampler's framed block
 * with the exact framing lines removed and the blank edges trimmed — the same
 * mechanical strip the bash composer performed. Returns null when priming is
 * off, nothing was sampled, or the frame is unusable; a sampler refusal leaves
 * one neutral line in the private compose log and never fails the compose.
 */
export function samplePassages(sessionRoot: string, partsDir: string): string | null {
  if (process.env.WORDTASTE_PRIMER === "0") return null;
  if (!existsSync(framePath)) return null;

  let raw = "";
  try {
    raw = samplePrimer({
      seed: primerSeed(sessionRoot, basename(partsDir), 0),
      libs: primerLibs(sessionRoot),
    });
  } catch (error) {
    if (error instanceof SamplerError) {
      const logDir = join(sessionRoot, ".pneuma", "leaf-logs");
      mkdirSync(logDir, { recursive: true });
      appendFileSync(join(logDir, `compose-${process.pid}.log`), `wordtaste: primer — ${error.message}\n`);
      return null;
    }
    throw error;
  }
  if (raw.length === 0) return null;

  const frameText = readFileSync(framePath, "utf8");
  const before = frameSection(frameText, "before");
  const after = frameSection(frameText, "after");
  if (before === "" || after === "") return null;

  // Byte-exact whole-line removal, then the leading and trailing blank lines
  // the removed framing left behind.
  const remove = new Set([...before.split("\n"), ...after.split("\n")]);
  const lines = raw.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const filtered = lines.filter((line) => !remove.has(line));
  let first = 0;
  let last = filtered.length - 1;
  while (first <= last && BLANK.test(filtered[first]!)) first += 1;
  while (last >= first && BLANK.test(filtered[last]!)) last -= 1;
  if (last < first) return null;
  return `${filtered.slice(first, last + 1).join("\n")}\n`;
}

/**
 * Compose a writer/repair prompt from a parts directory. Two artifacts come
 * out: the task message at `outFile`, and the standing system charter as
 * `system.en.md` beside it — assembled from the same parts, so its treatment
 * rules cover exactly the blocks the task message carries. Throws ComposeError
 * with the exact one-line diagnosis on refusal; writes nothing until both are
 * assembled.
 */
export function composeLeafPromptFile(partsDirArg: string, outFile: string): void {
  if (!existsSync(partsDirArg) || !statSync(partsDirArg).isDirectory()) {
    throw new ComposeError(`wordtaste: compose — parts directory not found: ${partsDirArg}`);
  }
  const partsDir = realpathOrNull(partsDirArg) ?? partsDirArg;

  const scaffold = loadScaffolding();
  if (scaffold === null || !hasLeafScaffolding(scaffold)) {
    throw new ComposeError("wordtaste: compose — the English scaffolding file is missing or incomplete");
  }
  const S = scaffold as unknown as Scaffolding;

  for (const required of ["brief.en.md", "material.md"]) {
    if (!fileNonEmpty(join(partsDir, required))) {
      throw new ComposeError(`wordtaste: compose — required part is missing: ${required}`);
    }
  }

  const sessionRoot = process.env.PNEUMA_SESSION_DIR ?? ".";
  const passages = samplePassages(sessionRoot, partsDir);

  // The `entry` part is metadata, not prose: `compose_unit_parts.ts` writes it
  // from the stored workflow's entry field, and only the exact word `idea`
  // selects the creation charter. An absent or unrecognised part is the
  // rewrite default — byte-identical to every prompt composed before it
  // existed.
  const entryPart = readPart(join(partsDir, "entry"));
  const parts: LeafParts = {
    brief: readPart(join(partsDir, "brief.en.md"))!,
    material: readPart(join(partsDir, "material.md"))!,
    kernel: readPart(join(partsDir, "kernel.md")),
    current: readPart(join(partsDir, "current.md")),
    preceding: readPart(join(partsDir, "preceding.md")),
    issues: readPart(join(partsDir, "issues.md")),
    constraints: readPart(join(partsDir, "constraints.en.md")),
    referenceProse: passages ?? undefined,
    voiceStyle: readPart(join(partsDir, "voice_style.en.md")),
    voiceExamples: readPart(join(partsDir, "voice_examples.md")),
    entry: entryPart?.trim() === "idea" ? "idea" : undefined,
  };
  const prompt = assembleLeafPrompt(S, parts);
  const system = assembleLeafSystem(S, parts);

  // The charter first: a task message never exists without its charter beside
  // it, so a dispatcher that sees the prompt can rely on the sibling.
  writePromptFile(join(dirname(outFile), SYSTEM_PART), system);
  writePromptFile(outFile, prompt);
}
