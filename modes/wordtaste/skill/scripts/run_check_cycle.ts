#!/usr/bin/env bun
/**
 * Private check → repair → recheck loop.
 *
 * Usage:
 *   bun run_check_cycle.ts <candidate-file> <check-brief-file> <scope> <result-file>
 *                          [<writer-parts-dir>]
 *
 * The caller creates only the candidate and a stable check brief. This script
 * appends candidate/report contents to private prompts internally, so neither
 * raw prompts nor judge output enters a visible terminal command. It emits
 * nothing on success and writes only a sanitized outcome to <result-file>.
 *
 * The optional fifth argument is the parts directory the unit was written
 * from (`compose_unit_parts.ts`'s output). Given one, a repair is composed by
 * the shared composer out of a clone of those parts plus the text under
 * repair and the problems to fix, so the repairer reads the writer's framing
 * instead of the judge's brief — and, because the composer writes the
 * standing charter beside the prompt, the repair dispatch carries the same
 * system/user split every composed writer prompt gets. Without the argument
 * the older concatenated repair prompt is used unchanged.
 */

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { ComposeError, composeLeafPromptFile, fileNonEmpty, loadScaffolding } from "./lib/compose.ts";
import { MAX_REPAIR_CYCLES, routeLeaf } from "./lib/leaf.ts";
import {
  assembleCheckPrompt,
  assembleRepairIssues,
  assembleRepairPrompt,
  hasCycleScaffolding,
  type CheckIssue,
  type CheckReport,
  type Scaffolding,
} from "./lib/prompt-assembly.ts";
import { realpathOrNull } from "./lib/session.ts";

function fail(message: string): never {
  process.stderr.write(`wordtaste: check cycle — ${message}\n`);
  process.exit(2);
}

const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function absolutePath(path: string): string {
  const dir = realpathOrNull(dirname(path)) ?? dirname(path);
  return join(dir, basename(path));
}

function parseReport(reportFile: string): CheckReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(reportFile, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const report = parsed as Record<string, unknown>;
  if (typeof report.pass !== "boolean" || typeof report.kernelOk !== "boolean") return null;
  if (!Array.isArray(report.issues)) return null;
  for (const issue of report.issues as unknown[]) {
    if (typeof issue !== "object" || issue === null) return null;
    const shaped = issue as Record<string, unknown>;
    if (shaped.kind !== "meaning" && shaped.kind !== "style") return null;
    if (typeof shaped.quote !== "string" || typeof shaped.problem !== "string") return null;
  }
  return report as unknown as CheckReport;
}

// A report is accepted when the meaning survived: kernelOk and no "meaning"
// issue. Style findings are advisory — counted into the result and never the
// start of a repair. A checker's taste in sentences is not the reader's.
function reportPasses(report: CheckReport): boolean {
  return report.kernelOk && report.issues.every((issue: CheckIssue) => issue.kind !== "meaning");
}

function advisoryCount(report: CheckReport): number {
  return report.issues.filter((issue: CheckIssue) => issue.kind === "style").length;
}

function terminalOutcome(report: CheckReport): "blocked" | "needs-review" {
  return !report.kernelOk || report.issues.some((issue: CheckIssue) => issue.kind === "meaning")
    ? "blocked"
    : "needs-review";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 4 || args.length > 5) {
    fail("usage: <candidate> <brief> <scope> <result> [<parts-dir>]");
  }
  const [candidateArg, briefArg, scope, resultArg] = args as [string, string, string, string];
  let partsDir = args[4] ?? "";

  if (!SCOPE_PATTERN.test(scope)) fail("invalid stable scope");
  for (const required of [candidateArg, briefArg]) {
    if (!fileNonEmpty(required)) fail("required private input is missing");
  }

  const candidateFile = absolutePath(candidateArg);
  const briefFile = absolutePath(briefArg);
  mkdirSync(dirname(resultArg), { recursive: true });
  const resultFile = absolutePath(resultArg);
  const sessionRoot = realpathOrNull(process.env.PNEUMA_SESSION_DIR ?? ".") ?? ".";
  const privateDirArg = process.env.WORDTASTE_PRIVATE_DIR ?? join(sessionRoot, ".pneuma", "private");
  mkdirSync(privateDirArg, { recursive: true });
  const privateDir = realpathOrNull(privateDirArg) ?? privateDirArg;

  const isPrivate = (path: string): boolean => path.startsWith(`${privateDir}/`);
  if (!isPrivate(candidateFile) || !isPrivate(briefFile) || !isPrivate(resultFile)) {
    fail("candidate, brief, and result must stay private");
  }

  // The parts directory is checked before the first leaf runs, not at the
  // moment a repair needs it: a caller that named the wrong directory should
  // hear about it before spending a check.
  if (partsDir !== "") {
    if (!existsSync(partsDir) || !statSync(partsDir).isDirectory()) {
      fail("the writer parts directory does not exist");
    }
    partsDir = realpathOrNull(partsDir) ?? partsDir;
    if (!isPrivate(partsDir)) fail("the writer parts directory must stay private");
  }

  const scaffoldRaw = loadScaffolding();
  if (scaffoldRaw === null || !hasCycleScaffolding(scaffoldRaw)) {
    fail("the English scaffolding file is missing or incomplete");
  }
  const S = scaffoldRaw as unknown as Scaffolding;

  const originalFile = join(privateDir, `${scope}.original.md`);
  copyFileSync(candidateFile, originalFile);

  const writeResult = (outcome: string, repairs: number, advisory = 0): void => {
    const staged = `${resultFile}.tmp.${process.pid}`;
    const shaped = {
      outcome,
      scope,
      repairs,
      advisory,
      original: originalFile,
      candidate: candidateFile,
    };
    writeFileSync(staged, `${JSON.stringify(shaped, null, 2)}\n`);
    renameSync(staged, resultFile);
  };

  const composedRepairDir = (cycle: number): string =>
    join(privateDir, `${scope}.repair-parts-${cycle}`);

  /**
   * The composed repair: the writer's own parts, cloned, plus the two that
   * make it a repair. Nothing here is written in Chinese by this script — the
   * text under repair is the candidate, and the problem list is the checker's
   * own words, never restated.
   */
  const buildComposedRepairPrompt = (report: CheckReport, cycle: number, errorsFile: string): boolean => {
    const work = composedRepairDir(cycle);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    // `entry` rides along so a creation unit's repair keeps the creation
    // charter — a repair is the same writing job under the same rules.
    for (const name of ["brief.en.md", "material.md", "kernel.md", "preceding.md", "constraints.en.md", "entry"]) {
      if (fileNonEmpty(join(partsDir, name))) copyFileSync(join(partsDir, name), join(work, name));
    }
    copyFileSync(candidateFile, join(work, "current.md"));
    const issues = assembleRepairIssues(report);
    writeFileSync(join(work, "issues.md"), issues.length > 0 ? `${issues}\n` : "");

    // The repaired text keeps the title it already opens with, so the first
    // unit's "open with the title" line would ask for it a second time.
    const constraints = join(work, "constraints.en.md");
    if (fileNonEmpty(constraints) && typeof S.unit_constraint_first === "string" && S.unit_constraint_first.length > 0) {
      const titleLine = `- ${S.unit_constraint_first}`;
      const kept = readFileSync(constraints, "utf8")
        .split("\n")
        .filter((line) => line !== titleLine);
      while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
      if (kept.length === 0) rmSync(constraints, { force: true });
      else writeFileSync(constraints, `${kept.join("\n")}\n`);
    }

    // The prompt is composed inside the parts directory and dispatched from
    // there, so `brief.en.md` stays beside it — that sibling is where the
    // router looks when it checks that an English brief is English.
    try {
      composeLeafPromptFile(work, join(work, "prompt.md"));
      return true;
    } catch (error) {
      if (error instanceof ComposeError) {
        appendFileSync(errorsFile, `${error.message}\n`);
        return false;
      }
      throw error;
    }
  };

  const dispatch = async (
    role: "checker" | "repair",
    promptFile: string,
    outputFile: string,
    errorsFile: string,
    repairScope = "",
  ): Promise<number> => {
    const outcome = await routeLeaf(role, promptFile, repairScope);
    if (outcome.messages.length > 0) {
      appendFileSync(errorsFile, `${outcome.messages.join("\n")}\n`);
    }
    writeFileSync(outputFile, outcome.output);
    return outcome.status;
  };

  let repairs = 0;
  let previousReport = "";

  for (;;) {
    const cycle = repairs + 1;
    const checkPrompt = join(privateDir, `${scope}.check-${cycle}.md`);
    const checkReportFile = join(privateDir, `${scope}.report-${cycle}.json`);
    const checkError = join(privateDir, `${scope}.check-${cycle}.stderr`);
    writeFileSync(
      checkPrompt,
      assembleCheckPrompt(
        S,
        readFileSync(briefFile, "utf8"),
        readFileSync(candidateFile, "utf8"),
        previousReport.length > 0 ? previousReport : undefined,
      ),
    );

    const checkStatus = await dispatch("checker", checkPrompt, checkReportFile, checkError);
    if (checkStatus !== 0) {
      writeResult("blocked", repairs);
      process.exit(0);
    }
    const report = parseReport(checkReportFile);
    if (report === null) {
      writeResult("blocked", repairs);
      process.exit(0);
    }
    if (reportPasses(report)) {
      writeResult("accepted", repairs, advisoryCount(report));
      process.exit(0);
    }
    if (repairs >= MAX_REPAIR_CYCLES) {
      writeResult(terminalOutcome(report), repairs);
      process.exit(0);
    }

    const repairedFile = join(privateDir, `${scope}.repaired-${cycle}.md`);
    const repairError = join(privateDir, `${scope}.repair-${cycle}.stderr`);
    writeFileSync(repairError, "");
    let repairPrompt: string;
    if (partsDir !== "") {
      repairPrompt = join(composedRepairDir(cycle), "prompt.md");
      if (!buildComposedRepairPrompt(report, cycle, repairError)) {
        // A prompt that could not be composed is not silently replaced by the
        // older one: the run ends at the same terminal the checker named.
        writeResult(terminalOutcome(report), repairs);
        process.exit(0);
      }
    } else {
      repairPrompt = join(privateDir, `${scope}.repair-${cycle}.md`);
      writeFileSync(
        repairPrompt,
        assembleRepairPrompt(
          S,
          readFileSync(briefFile, "utf8"),
          readFileSync(candidateFile, "utf8"),
          readFileSync(checkReportFile, "utf8"),
        ),
      );
    }
    repairs += 1;

    const repairStatus = await dispatch("repair", repairPrompt, repairedFile, repairError, scope);
    if (repairStatus !== 0) {
      writeResult(terminalOutcome(report), repairs);
      process.exit(0);
    }
    if (!fileNonEmpty(repairedFile)) {
      writeResult("blocked", repairs);
      process.exit(0);
    }

    copyFileSync(repairedFile, candidateFile);
    rmSync(repairedFile, { force: true });
    previousReport = readFileSync(checkReportFile, "utf8");
  }
}

if (import.meta.main) await main();
