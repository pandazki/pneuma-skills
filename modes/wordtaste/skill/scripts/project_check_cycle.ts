#!/usr/bin/env bun
/**
 * Project a sanitized check-cycle result into canonical WordTaste files.
 *
 * Usage:
 *   bun project_check_cycle.ts unit <result-file> <workflow-file> <candidate-file> <unit-id>
 *   bun project_check_cycle.ts whole <result-file> <workflow-file> <candidate-file>
 *
 * The command emits nothing. Raw reports remain private; workflow.json
 * receives only stable, plain-language state.
 */

import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileNonEmpty } from "./lib/compose.ts";
import { realpathOrNull } from "./lib/session.ts";

function fail(message: string): never {
  process.stderr.write(`wordtaste: check projection — ${message}\n`);
  process.exit(2);
}

type Raw = Record<string, unknown>;

const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function absolutePath(path: string): string {
  const dir = realpathOrNull(dirname(path)) ?? dirname(path);
  return join(dir, basename(path));
}

function asObject(value: unknown): Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : {};
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 4) fail("invalid invocation");
  const [mode, resultArg, workflowFile, candidateArg] = args as [string, string, string, string];
  const unitId = args[4] ?? "";

  const sessionRoot = realpathOrNull(process.env.PNEUMA_SESSION_DIR ?? ".") ?? ".";
  const draftFile = join(sessionRoot, "draft.md");
  const privateDirArg = process.env.WORDTASTE_PRIVATE_DIR ?? join(sessionRoot, ".pneuma", "private");
  const privateDir = realpathOrNull(privateDirArg) ?? privateDirArg;

  if (!fileNonEmpty(resultArg) || !fileNonEmpty(workflowFile) || !fileNonEmpty(candidateArg)) {
    fail("required private input is missing");
  }
  if (mode !== "unit" && mode !== "whole") fail("mode must be unit or whole");
  if (mode === "unit" && !SCOPE_PATTERN.test(unitId)) fail("invalid unit id");

  const candidateFile = absolutePath(candidateArg);
  const resultFile = absolutePath(resultArg);
  if (!candidateFile.startsWith(`${privateDir}/`) || !resultFile.startsWith(`${privateDir}/`)) {
    fail("candidate and result must stay private");
  }

  let result: Raw;
  let workflow: Raw;
  try {
    result = JSON.parse(readFileSync(resultFile, "utf8")) as Raw;
    workflow = JSON.parse(readFileSync(workflowFile, "utf8")) as Raw;
  } catch {
    fail("invalid private result");
  }
  const outcome = typeof result.outcome === "string" ? result.outcome : "";
  const scope = typeof result.scope === "string" ? result.scope : "";
  const originalFile = typeof result.original === "string" ? result.original : "";
  if (!SCOPE_PATTERN.test(scope)) fail("invalid private result");

  let next: Raw;
  switch (outcome) {
    case "accepted": {
      if (mode === "whole") {
        copyFileSync(candidateFile, draftFile);
        next = {
          ...workflow,
          stage: "final",
          review: { ...asObject(workflow.review), summary: "全文检查完成。", issues: [] },
          progress: { ...asObject(workflow.progress), note: "正文已完成，等待阅读确认。" },
          layout: {
            ...asObject(workflow.layout),
            openQuestion: "请阅读正文；若有一句仍显得不真，可以直接选中它。",
          },
        };
      } else {
        if (fileNonEmpty(draftFile)) {
          const joined = `${readFileSync(draftFile, "utf8")}\n\n${readFileSync(candidateFile, "utf8")}`;
          writeFileSync(draftFile, joined);
        } else {
          copyFileSync(candidateFile, draftFile);
        }
        const progress = asObject(workflow.progress);
        const completed = Array.isArray(progress.completedUnits)
          ? (progress.completedUnits as string[])
          : [];
        next = {
          ...workflow,
          progress: {
            ...progress,
            currentUnit: "",
            completedUnits: [...new Set([...completed, unitId])].sort(),
            note: "当前单元检查完成。",
          },
        };
      }
      break;
    }
    case "blocked": {
      next = {
        ...workflow,
        stage: "review",
        review: {
          ...asObject(workflow.review),
          summary: "中心判断、事实或限定仍未稳定，当前版本暂不进入终稿。",
          issues: ["需要重新确认意义是否完整保留。"],
        },
        progress: { ...asObject(workflow.progress), note: "有限修复后仍有意义问题。" },
      };
      break;
    }
    case "needs-review": {
      if (!fileNonEmpty(originalFile)) fail("original candidate is missing");
      const choiceDir = join(sessionRoot, "candidates", scope);
      mkdirSync(choiceDir, { recursive: true });
      copyFileSync(originalFile, join(choiceDir, "A.md"));
      copyFileSync(candidateFile, join(choiceDir, "B.md"));
      next = {
        ...workflow,
        stage: "choice",
        candidates: [
          { label: "A", file: `candidates/${scope}/A.md` },
          { label: "B", file: `candidates/${scope}/B.md` },
        ],
        layout: {
          ...asObject(workflow.layout),
          openQuestion: "两版各有取舍，请按阅读感受选择。",
        },
        progress: { ...asObject(workflow.progress), note: "有限修复后仍有主观取舍，等待选择。" },
      };
      break;
    }
    default:
      fail("invalid private result");
  }

  const staged = `${workflowFile}.tmp.${process.pid}`;
  try {
    writeFileSync(staged, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(staged, workflowFile);
  } finally {
    rmSync(staged, { force: true });
  }
  process.exit(0);
}

if (import.meta.main) main();
