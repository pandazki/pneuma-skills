/**
 * T9 — the mode is actually registered, and the evolution agent knows what
 * to learn from it.
 *
 * Registration has three surfaces consumed by different
 * processes, and every one of them fails DIFFERENTLY and QUIETLY when it is
 * missed (`.claude/skills/create-mode/SKILL.md` Step 3):
 *
 *  - the mode's source, found by `core/mode-catalog.ts` and handed to the
 *    loader by `registerExternalMode` — miss it and the mode is "Unknown
 *    mode" (a CATALOG mode is not in the builtin registry by design);
 *  - the launcher gallery registry in `server/index.ts`, derived from
 *    `modes/distribution.json` plus the on-disk mode directories — put the
 *    mode somewhere that derivation does not look and `bun run dev bansho`
 *    still works, so nothing looks broken, but the gallery never shows it;
 *  - the mode catalogs in both READMEs — miss it and the mode exists
 *    but is undiscoverable by anyone reading the project.
 *
 * So they are pinned here rather than trusted. The gallery derivation
 * lives inside a route handler, so it is pinned against the source text —
 * the honest option, and the same shape this repo already uses for
 * source-level invariants.
 *
 * One deliberate deviation from the T9 spec, recorded here because a future
 * reader will otherwise "fix" it: the spec (and create-mode Step 3c) says
 * to write the Builtin Modes line into `CLAUDE.md` and keep the two files
 * byte-identical. That text predates the `@AGENTS.md` import convention.
 * `AGENTS.md` is now the single source of truth and its own header plus the
 * release checklist forbid putting ANY content in `CLAUDE.md`. The test
 * below pins the invariant that actually holds today.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { listBuiltinModes } from "../../../core/mode-loader.js";
import { isCatalogMode, resolveCatalogMode } from "../../../core/mode-catalog.js";
import banshoManifest from "../manifest.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");

const MODE_NAME = "bansho";
const LITERAL_LIST = new RegExp("const builtinNames = " + "\\[\\s*\"");

describe("registration 1/3 — the frontend dynamic-import registry", () => {
  // This is a CATALOG mode (`modes/distribution.json`): the npm package does
  // not ship it, so it is deliberately NOT in the builtin registry — that
  // registry is what Vite follows into `dist/`, and a viewer bundled without
  // its source is dead weight. It loads through `registerExternalMode` from
  // whatever directory the catalog resolved: `modes/<name>/` here in the
  // repo, `~/.pneuma/catalog/<name>/` after a release downloads it. Same
  // code path both times, which is why the repo exercises the shipped shape.
  test("`core/mode-catalog.ts` resolves the mode, and it is not a builtin", () => {
    expect(listBuiltinModes()).not.toContain(MODE_NAME);
    expect(isCatalogMode(MODE_NAME)).toBe(true);
    const resolved = resolveCatalogMode(MODE_NAME);
    expect(resolved?.source).toBe("in-tree");
    expect(resolved?.modeDir).toBe(join(REPO_ROOT, "modes", MODE_NAME));
  });

  test("the manifest it resolves to is this mode's own", async () => {
    // Not a tautology: registration hands the loader a directory, and a
    // path pointing at the wrong mode would still carry the right name.
    const { registerExternalMode, loadModeManifest } = await import(
      "../../../core/mode-loader.js"
    );
    registerExternalMode(MODE_NAME, resolveCatalogMode(MODE_NAME)!.modeDir);
    const manifest = await loadModeManifest(MODE_NAME);
    expect(manifest.name).toBe(MODE_NAME);
    expect(manifest.skill?.installName).toBe(banshoManifest.skill?.installName);
  });
});

describe("registration 2/3 — the launcher gallery registry", () => {
  const serverSource = read("server/index.ts");

  test("the launcher derives its gallery from disk, not from a name list", () => {
    // Before the mode-distribution split this route carried a literal
    // `builtinNames` array and a new mode had to be added to it by hand. It
    // now reads `modes/distribution.json` plus the on-disk mode directories,
    // so the omission this suite used to guard cannot happen — and a
    // reintroduced literal would bring it back.
    expect(serverSource).not.toMatch(LITERAL_LIST);
    expect(serverSource).toContain("distribution.json");
  });

  test("the mode is where that derivation looks for it", () => {
    const bundled = (
      JSON.parse(read("modes/distribution.json")) as { bundled: string[] }
    ).bundled;
    expect(existsSync(join(REPO_ROOT, "modes", MODE_NAME, "manifest.ts"))).toBe(true);
    if (bundled.includes(MODE_NAME)) return; // ships inside the package
    // A catalog mode is published from its own directory and reaches the
    // launcher through `modes/catalog.json`; its card needs the showcase
    // images that stay in the package.
    expect(existsSync(join(REPO_ROOT, "modes", MODE_NAME, "showcase"))).toBe(true);
  });

  test("the mode is not otherwise hardcoded into server or CLI logic", () => {
    // G-boundary: `server/` and `bin/` are ModeManifest-driven, and since
    // the gallery derives its list from disk there is no sanctioned mention
    // left: any line quoting the name is a branch on mode identity.
    //
    // The scan is for the QUOTED literal, not the bare word: a comment that
    // mentions bansho as an example is prose, while `=== "bansho"` is the
    // hardcode this guards against.
    const quoted = `"${MODE_NAME}"`;
    const offenders: string[] = [];
    for (const dir of ["server", "bin"]) {
      const files = readdirSync(join(REPO_ROOT, dir), {
        recursive: true,
        encoding: "utf-8",
      });
      for (const file of files) {
        if (!file.endsWith(".ts") || file.includes("__tests__")) continue;
        const rel = `${dir}/${file}`;
        for (const [i, line] of read(rel).split("\n").entries()) {
          if (!line.includes(quoted)) continue;
          offenders.push(`${rel}:${i + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the gallery will show it — the manifest is not hidden", () => {
    expect(banshoManifest.hidden).toBeUndefined();
  });
});

describe("registration 3/3 — the docs", () => {
  test("`CLAUDE.md` stays the one-line import — content there is the bug", () => {
    // The release contract: AGENTS.md is the single source of truth and
    // CLAUDE.md imports it. See this file's header for why the T9 spec's
    // "byte-identical" wording is not what gets implemented.
    expect(read("CLAUDE.md")).toBe("@AGENTS.md\n");
  });

  test("both READMEs carry a Built-in Modes row, not just the English one", () => {
    // The project has shipped a zh README two months behind before; there
    // is no automation guarding it, so this is the guard.
    for (const rel of ["README.md", "README.zh.md"]) {
      const row = read(rel)
        .split("\n")
        .find((l) => l.startsWith(`| **${MODE_NAME}**`));
      expect(row ?? `${rel}: no row`).toContain(`| **${MODE_NAME}**`);
      // A row whose description is a placeholder is not a row.
      expect((row ?? "").length).toBeGreaterThan(80);
    }
  });

  test("the zh row is written in Chinese, not the English row pasted over", () => {
    const row = read("README.zh.md")
      .split("\n")
      .find((l) => l.startsWith(`| **${MODE_NAME}**`))!;
    const han = row.match(/[一-鿿]/g) ?? [];
    expect(han.length).toBeGreaterThan(20);
  });

  test("both CLI usage blocks list it among the modes", () => {
    for (const rel of ["README.md", "README.zh.md"]) {
      const usage = read(rel).split("```")[
        read(rel).split("```").findIndex((chunk) => chunk.includes("\nModes:\n"))
      ];
      expect(usage).toBeDefined();
      const line = usage
        .split("\n")
        .find((l) => l.trimStart().startsWith(`${MODE_NAME} `));
      expect(line ?? `${rel}: not in CLI usage`).toContain(MODE_NAME);
    }
  });
});

describe("evolution directive", () => {
  const directive = banshoManifest.evolution?.directive ?? "";

  test("declared at all — without it `pneuma evolve bansho` has no target", () => {
    expect(banshoManifest.evolution).toBeDefined();
    expect(directive.trim().length).toBeGreaterThan(80);
  });

  test("it says what to LEARN about the user, not what to DO to the board", () => {
    // The five learnables T9 commissions: pacing, what gets emphasized,
    // conclusion-first vs build-up, how much chart/formula, and bilingual
    // wording habits.
    const text = directive.toLowerCase();
    expect(text).toContain("learn");
    for (const learnable of ["pac", "emphas", "conclusion", "chart", "formula"]) {
      expect({ learnable, present: text.includes(learnable) }).toEqual({
        learnable,
        present: true,
      });
    }
    expect(text).toMatch(/chinese|english|bilingual|language/);
  });

  test("it is English, like every other manifest string in this repo", () => {
    expect(directive).not.toMatch(/[一-鿿]/);
  });

  // Word purity over the directive — the evolution agent reads it and then
  // writes skill text the main agent reads — is one gate for the whole mode
  // now: `word-purity.test.ts`, over `vocabulary.ts::agentSurfaces()`.
});
