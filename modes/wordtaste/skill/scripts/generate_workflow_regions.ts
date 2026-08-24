#!/usr/bin/env bun
/**
 * Regenerate the three embedded regions of `workflows/writing.workflow.js`
 * from their single sources of truth:
 *
 *   wordtaste:scaffolding  ← references/prompt-scaffolding.en.json
 *   wordtaste:plan-schema  ← references/plan-schema.json
 *   wordtaste:pure-region  ← lib/prompt-assembly.ts (type-stripped)
 *
 * Usage:
 *   bun generate_workflow_regions.ts           # rewrite the workflow in place
 *   bun generate_workflow_regions.ts --check   # exit 1 when the file is stale
 *
 * The workflow runtime is a pure coordinator with no filesystem, so it cannot
 * import the shared module at run time; this script is what removes the
 * hand-syncing instead. The pure region is transpiled with the repository's
 * pinned `typescript` package, so regeneration is deterministic across
 * machines that share the lockfile. A test runs `--check` so a drifted copy
 * fails CI instead of quietly writing two different articles.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const skillDir = join(import.meta.dir, "..");
const workflowPath = join(skillDir, "workflows", "writing.workflow.js");
const scaffoldPath = join(skillDir, "references", "prompt-scaffolding.en.json");
const schemaPath = join(skillDir, "references", "plan-schema.json");
const assemblyPath = join(import.meta.dir, "lib", "prompt-assembly.ts");

function region(source: string, name: string): { start: number; end: number } {
  const open = `// wordtaste:${name}:start\n`;
  const close = `// wordtaste:${name}:end`;
  const start = source.indexOf(open);
  const end = source.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error(`workflow region not found: ${name}`);
  return { start: start + open.length, end };
}

function splice(source: string, name: string, body: string): string {
  const { start, end } = region(source, name);
  return `${source.slice(0, start)}${body}${source.slice(end)}`;
}

function trimTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function generate(): string {
  let workflow = readFileSync(workflowPath, "utf8");

  // ── scaffolding: the JSON file, byte for byte, as an object literal ──
  const scaffoldText = trimTrailingNewline(readFileSync(scaffoldPath, "utf8"));
  workflow = splice(workflow, "scaffolding", `const SCAFFOLD = ${scaffoldText}\n`);

  // ── plan schema: the JSON file, byte for byte, as raw text ──
  const schemaText = trimTrailingNewline(readFileSync(schemaPath, "utf8"));
  if (schemaText.includes("`") || schemaText.includes("${")) {
    throw new Error("plan-schema.json cannot be embedded in a template literal");
  }
  workflow = splice(workflow, "plan-schema", `const PLAN_SCHEMA_TEXT = String.raw\`${schemaText}\`\n\n`);

  // ── pure region: the shared assembler, type-stripped ──
  const assembly = readFileSync(assemblyPath, "utf8");
  const pure = region(assembly, "pure-region");
  const snippet = assembly.slice(pure.start, pure.end);
  const transpiled = ts.transpileModule(snippet, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: false,
    },
  }).outputText;
  // Comments may say "import"; code may not. Check the comment-stripped text.
  const code = transpiled
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  if (/^\s*(?:import|export)\b/m.test(code) || /\bprocess\./.test(code)) {
    throw new Error("the transpiled pure region must stay dependency-free");
  }
  workflow = splice(workflow, "pure-region", transpiled);

  return workflow;
}

function main(): void {
  const generated = generate();
  if (process.argv.includes("--check")) {
    const current = readFileSync(workflowPath, "utf8");
    if (current !== generated) {
      process.stderr.write(
        "wordtaste: writing.workflow.js is stale — run `bun modes/wordtaste/skill/scripts/generate_workflow_regions.ts`\n",
      );
      process.exit(1);
    }
    return;
  }
  writeFileSync(workflowPath, generated);
}

if (import.meta.main) main();
