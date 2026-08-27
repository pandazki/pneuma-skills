#!/usr/bin/env bun
/**
 * Build one unit's parts directory out of the stored plan.
 *
 * Usage:
 *   bun compose_unit_parts.ts <workflow.json> <unit-id> <parts-dir>
 *
 * Reads `layout.plan` — the plan `project_plan.ts` stored — and writes the
 * parts `compose_leaf_prompt.ts` consumes: an English `brief.en.md` from the
 * fixed scaffolding template; `material.md` sliced out of the named material
 * files by code — never retyped, never summarised; `kernel.md` with the
 * unit's must_keep sentences; `preceding.md` when a draft exists;
 * `constraints.en.md` (title on the first unit, no repeat after); and the
 * voice parts sampled out of `<content-set>/taste/` when it has grown.
 *
 * When the stored workflow says `entry: "idea"`, one more part is written: a
 * metadata file named `entry` holding the word `idea`. The prompt composer
 * reads it and selects the creation charter — material binding, development
 * expected, no unsupported facts — instead of the rewrite charter. Any other
 * entry leaves no part behind, and the composed bytes are exactly what they
 * were before the part existed.
 *
 * Material paths inside the plan are relative to the content set, which is
 * the directory holding workflow.json.
 *
 * Output: nothing on success.
 *
 * Exit codes:
 *   0  — composed
 *   2  — usage error, no stored plan, unknown unit id, or an unreadable span
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileNonEmpty, loadScaffolding } from "./lib/compose.ts";
import {
  assembleUnitBrief,
  assembleUnitConstraints,
  assembleUnitKernel,
  hasUnitScaffolding,
  sliceSpan,
  stripAssetBlocks,
  textLines,
  type PlanUnit,
  type Scaffolding,
} from "./lib/prompt-assembly.ts";
import { SamplerError, sampleVoice } from "./lib/sampling.ts";
import { primerSeed, realpathOrNull } from "./lib/session.ts";
import { storedPlanUnits } from "./compose_check_brief.ts";

function fail(message: string): never {
  process.stderr.write(`wordtaste: unit parts — ${message}\n`);
  process.exit(2);
}

function main(): void {
  const [workflowFile, unitId, partsDirArg] = process.argv.slice(2);
  if (process.argv.length - 2 !== 3 || !workflowFile || !unitId || !partsDirArg) {
    fail("usage: compose_unit_parts.ts <workflow.json> <unit-id> <parts-dir>");
  }

  if (!fileNonEmpty(workflowFile)) fail("workflow.json is missing or invalid");
  const workflowText = readFileSync(workflowFile, "utf8");
  let workflow: Record<string, unknown>;
  try {
    workflow = JSON.parse(workflowText) as Record<string, unknown>;
  } catch {
    fail("workflow.json is missing or invalid");
  }
  const units = storedPlanUnits(workflowText);
  if (units === null) fail("workflow.json carries no plan");
  const unit = units.find((candidate) => candidate.id === unitId);
  if (!unit) fail("no unit with that id");

  const scaffold = loadScaffolding();
  if (scaffold === null || !hasUnitScaffolding(scaffold)) {
    fail("the English scaffolding file is missing or incomplete");
  }
  const S = scaffold as unknown as Scaffolding;

  const contentSet = realpathOrNull(dirname(workflowFile)) ?? dirname(workflowFile);
  mkdirSync(partsDirArg, { recursive: true });
  const partsDir = realpathOrNull(partsDirArg) ?? partsDirArg;

  // ── brief.en.md ──
  const layout = workflow.layout as Record<string, unknown>;
  const plan = layout.plan as Record<string, unknown>;
  const title = String(plan.title ?? "null");
  writeFileSync(join(partsDir, "brief.en.md"), assembleUnitBrief(S, unit as PlanUnit, title));

  // ── material.md ──
  // One slicing rule, shared with validate_plan.ts through lib/prompt-assembly.
  let material = "";
  for (let spanIndex = 0; spanIndex < unit.spans.length; spanIndex += 1) {
    const span = unit.spans[spanIndex]!;
    // A span names a material file inside the content set; anything absolute
    // or path-shaped is refused rather than resolved.
    if (
      span.file.startsWith("/") ||
      span.file.includes("..") ||
      !fileNonEmpty(join(contentSet, span.file))
    ) {
      fail("a span names an unreadable material file");
    }
    if (spanIndex > 0) material += "\n";
    const lines = sliceSpan(textLines(readFileSync(join(contentSet, span.file), "utf8")), span.from, span.to);
    if (lines.length > 0) material += `${lines.join("\n")}\n`;
  }
  if (material.length === 0) {
    writeFileSync(join(partsDir, "material.md"), material);
    fail("the unit's spans produced no material");
  }
  writeFileSync(join(partsDir, "material.md"), material);

  // ── kernel.md ──
  const kernel = assembleUnitKernel(unit as PlanUnit);
  if (kernel.length > 0) writeFileSync(join(partsDir, "kernel.md"), kernel);
  else rmSync(join(partsDir, "kernel.md"), { force: true });

  // ── entry ──
  // The stored workflow's entry, carried to the prompt composer as a metadata
  // part. Only the exact value "idea" writes one; everything else removes a
  // stale part, so a workflow that changed entry cannot leave the old charter
  // behind.
  if (workflow.entry === "idea") writeFileSync(join(partsDir, "entry"), "idea\n");
  else rmSync(join(partsDir, "entry"), { force: true });

  // ── preceding.md ──
  // The content set's own draft when workflow.json lives in one; the session
  // draft otherwise. An empty draft leaves no part behind.
  let draftFile = join(contentSet, "draft.md");
  if (!fileNonEmpty(draftFile) && process.env.PNEUMA_SESSION_DIR) {
    draftFile = join(process.env.PNEUMA_SESSION_DIR, "draft.md");
  }
  // Asset blocks come out on the way: `<preceding_prose>` is the last thing a
  // writer reads, and a block of keys and values in that position is a
  // register to imitate. See `stripAssetBlocks`.
  if (fileNonEmpty(draftFile)) {
    const preceding = stripAssetBlocks(readFileSync(draftFile, "utf8")).trim();
    if (preceding.length > 0) writeFileSync(join(partsDir, "preceding.md"), `${preceding}\n`);
    else rmSync(join(partsDir, "preceding.md"), { force: true });
  } else rmSync(join(partsDir, "preceding.md"), { force: true });

  // ── constraints.en.md ──
  const firstId = units[0]!.id;
  writeFileSync(
    join(partsDir, "constraints.en.md"),
    assembleUnitConstraints(S, unitId === firstId, unit.opens_section === true),
  );

  // ── voice_style.en.md / voice_examples.md ──
  // Same seed rule as the primer, so a resumed unit reads the same examples it
  // read the first time, and two units of one essay do not read the same ones.
  // Optional in every direction; a sampler failure leaves one neutral line in
  // a private log — a writer's prompt is not a place to report a missing
  // directory.
  const sessionRoot = process.env.PNEUMA_SESSION_DIR ?? ".";
  try {
    sampleVoice(join(contentSet, "taste"), partsDir, primerSeed(sessionRoot, basename(partsDir), 0));
  } catch (error) {
    if (error instanceof SamplerError || error instanceof Error) {
      const logDir = join(sessionRoot, ".pneuma", "leaf-logs");
      mkdirSync(logDir, { recursive: true });
      appendFileSync(
        join(logDir, `voice-${process.pid}.log`),
        `wordtaste: voice — ${error.message}\n`,
      );
    } else {
      throw error;
    }
  }
}

// Silence the unused-import linters for helpers used only in type positions.
void existsSync;
void statSync;

if (import.meta.main) main();
