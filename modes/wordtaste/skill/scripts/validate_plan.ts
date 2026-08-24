#!/usr/bin/env bun
/**
 * Verbatim guard for a planner's plan.
 *
 * Usage:
 *   bun validate_plan.ts <plan.json> <human-input>...
 *
 * Run it from the content set — the directory that holds `workflow.json`,
 * `materials/` and `draft.md` — because `units[].spans[].file` names a
 * material file relative to that directory.
 *
 * The plan is the one place where a model's Chinese could reach the article
 * without a human having written it. This guard makes that impossible to do
 * by accident: every Chinese-bearing field must be a literal quote from the
 * human input files, and everything the planner says in its own words must be
 * English, in `notes_en`. `open_question` is exempt: it is shown to the user
 * and never composed into a prompt.
 *
 * Checks, in order: shape, verbatim, English `notes_en`, spans (and each
 * `must_keep` sentence inside its own unit's spans).
 *
 * Output: nothing on success. One neutral line on stderr otherwise — never
 * the offending text.
 *
 * Exit codes:
 *   0  — valid
 *   2  — usage error, or the plan is invalid
 */

import { readFileSync } from "node:fs";
import { fileNonEmpty } from "./lib/compose.ts";
import { collapseSpace, normalizeQuote, sliceSpan, textLines } from "./lib/prompt-assembly.ts";

function fail(message: string): never {
  process.stderr.write(`wordtaste: plan — ${message}\n`);
  process.exit(2);
}

function schemaFail(field: string): never {
  fail(`${field} does not match the schema`);
}

function verbatimFail(field: string): never {
  fail(`${field} is not a verbatim quote from the material`);
}

type Raw = Record<string, unknown>;

const NON_SPACE = /[^ \t\n\r\v\f]/;

function nonBlankString(value: unknown): value is string {
  return typeof value === "string" && NON_SPACE.test(value);
}

/** `tr -s ' \t\r\n' ' '` — runs of those four collapse to one space, no trim. */
function squeeze(text: string): string {
  return text.replace(/[ \t\r\n]+/g, " ");
}

function lineExistsAfter(lines: string[], want: string, after: string): boolean {
  let armed = after === "";
  for (const line of lines) {
    if (!armed) {
      if (line === after) armed = true;
      continue;
    }
    if (line === want) return true;
  }
  return false;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2 || !args[0] || !args[1]) {
    fail("usage: validate_plan.ts <plan.json> <human-input>...");
  }
  const planFile = args[0]!;
  const inputs = args.slice(1);

  if (!fileNonEmpty(planFile)) fail("plan file is missing or empty");
  for (const input of inputs) {
    if (!fileNonEmpty(input)) fail("human input file is missing or empty");
  }

  // ── 1. shape ──
  let planRaw: unknown;
  try {
    planRaw = JSON.parse(readFileSync(planFile, "utf8"));
  } catch {
    schemaFail("plan");
  }
  if (typeof planRaw !== "object" || planRaw === null || Array.isArray(planRaw)) schemaFail("plan");
  const plan = planRaw as Raw;

  if (plan.version !== 1) schemaFail("version");
  if (!nonBlankString(plan.title)) schemaFail("title");
  if (!Array.isArray(plan.claims) || plan.claims.length < 1) schemaFail("claims");
  for (const claim of plan.claims as unknown[]) {
    const c = claim as Raw;
    if (
      typeof claim !== "object" || claim === null ||
      !nonBlankString(c.text) || !nonBlankString(c.source)
    ) {
      schemaFail("claims[].text");
    }
  }
  if (!Array.isArray(plan.units) || plan.units.length < 1) schemaFail("units");
  const units = plan.units as Raw[];
  for (const unit of units) {
    if (typeof unit.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(unit.id)) {
      schemaFail("units[].id");
    }
  }
  if (new Set(units.map((unit) => unit.id)).size !== units.length) schemaFail("units[].id");
  for (const unit of units) {
    if (!["background", "problem", "reasoning", "conclusion", "close"].includes(unit.role as string)) {
      schemaFail("units[].role");
    }
  }
  for (const unit of units) {
    if (!["dense", "loose", "mixed"].includes(unit.pace as string)) schemaFail("units[].pace");
  }
  for (const unit of units) {
    if (!["stop", "open"].includes(unit.ends as string)) schemaFail("units[].ends");
  }
  for (const unit of units) {
    const target = unit.target_chars;
    if (
      typeof target !== "number" || Math.floor(target) !== target ||
      target < 300 || target > 2000
    ) {
      schemaFail("units[].target_chars");
    }
  }
  for (const unit of units) {
    if (!Array.isArray(unit.spans)) schemaFail("units[].spans");
    for (const span of unit.spans as unknown[]) {
      const s = span as Raw;
      if (
        typeof span !== "object" || span === null ||
        !nonBlankString(s.file) || !nonBlankString(s.from) || typeof s.to !== "string"
      ) {
        schemaFail("units[].spans");
      }
    }
  }
  for (const unit of units) {
    if (
      !Array.isArray(unit.must_keep) ||
      !(unit.must_keep as unknown[]).every((keep) => nonBlankString(keep))
    ) {
      schemaFail("units[].must_keep");
    }
  }
  for (const unit of units) {
    if (typeof unit.notes_en !== "string") schemaFail("units[].notes_en");
  }
  if (plan.open_question !== undefined && plan.open_question !== null && typeof plan.open_question !== "string") {
    schemaFail("open_question");
  }

  // ── 2. verbatim ──
  // Both sides collapse runs of ASCII whitespace, so a quote may cross a line
  // break. The full-width space is left exactly as it is — verbatim means
  // verbatim, and a full-width comma is not a half-width one.
  const material = squeeze(inputs.map((input) => readFileSync(input, "utf8")).join(""));
  const quoteIsVerbatim = (needle: string): boolean =>
    needle.length > 0 && material.includes(needle);

  const checkQuotes = (values: string[], field: string): void => {
    for (const value of values) {
      const needle = normalizeQuote(value);
      if (needle.length === 0) continue;
      if (!quoteIsVerbatim(needle)) verbatimFail(field);
    }
  };
  checkQuotes([plan.title as string], "title");
  checkQuotes((plan.claims as Raw[]).map((claim) => claim.text as string), "claims[].text");
  checkQuotes(units.flatMap((unit) => unit.must_keep as string[]), "units[].must_keep[]");

  // ── 3. notes_en is English ──
  // U+3000–U+9FFF, the UTF-8 lead bytes E3–E9 the bash guard matched. An em
  // dash or a curly quote is ordinary English typography and stays allowed.
  for (const unit of units) {
    if (/[　-鿿]/.test(unit.notes_en as string)) schemaFail("units[].notes_en");
  }

  // ── 4. spans, and must_keep inside its own span ──
  for (const unit of units) {
    let spanText = "";
    for (const span of unit.spans as Array<{ file: string; from: string; to: string }>) {
      // A span names a material file inside the content set; anything absolute
      // or path-shaped is refused rather than resolved.
      if (span.file.startsWith("/") || span.file.includes("..") || !fileNonEmpty(span.file)) {
        schemaFail("units[].spans[].file");
      }
      const lines = textLines(readFileSync(span.file, "utf8"));
      if (!lineExistsAfter(lines, span.from, "")) schemaFail("units[].spans[].from");
      if (span.to !== "" && !lineExistsAfter(lines, span.to, span.from)) {
        schemaFail("units[].spans[].to");
      }
      const sliced = sliceSpan(lines, span.from, span.to);
      if (sliced.length > 0) spanText += `${sliced.join("\n")}\n`;
    }
    const spanNorm = squeeze(spanText);
    for (const keep of unit.must_keep as string[]) {
      const needle = normalizeQuote(keep);
      if (needle.length === 0) continue;
      if (!spanNorm.includes(needle)) verbatimFail("units[].must_keep[]");
    }
  }

  void collapseSpace;
  process.exit(0);
}

if (import.meta.main) main();
