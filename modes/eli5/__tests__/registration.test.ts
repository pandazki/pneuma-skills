/**
 * The mode is actually registered — and the evolution agent knows what to
 * learn from it.
 *
 * Registration is four files read by three different processes, and each
 * one fails differently and quietly when it is missed (the shape of this
 * suite follows `modes/bansho/__tests__/registration.test.ts`, which paid
 * for the lesson):
 *
 *  - `core/mode-loader.ts` — miss it and the mode is "Unknown mode";
 *  - `server/index.ts::builtinNames` — miss it and `bun run dev eli5`
 *    still works, so nothing looks broken, but the launcher gallery never
 *    shows the mode;
 *  - the docs (`AGENTS.md` + both READMEs) — miss it and the mode exists
 *    but nobody reading the project can find it.
 *
 * `builtinNames` is a function-local array inside a route handler, so it
 * is pinned against the source text — the honest option, and the same
 * shape this repo already uses for source-level invariants.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { listBuiltinModes } from "../../../core/mode-loader.js";
import eli5Manifest from "../manifest.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");

const MODE_NAME = "eli5";

describe("registration 1/3 — the frontend dynamic-import registry", () => {
  test("`core/mode-loader.ts` knows the mode by name", () => {
    expect(listBuiltinModes()).toContain(MODE_NAME);
  });

  test("the manifest it resolves to is this mode's own", async () => {
    // Not a tautology: the loader entry is two hand-written import paths,
    // and a copy-paste pointing at the wrong mode would still list the
    // right name here.
    const { loadModeManifest } = await import("../../../core/mode-loader.js");
    const manifest = await loadModeManifest(MODE_NAME);
    expect(manifest.name).toBe(MODE_NAME);
    expect(manifest.skill?.installName).toBe(eli5Manifest.skill?.installName);
  });
});

describe("registration 2/3 — the launcher gallery registry", () => {
  const serverSource = read("server/index.ts");

  test("`server/index.ts` declares builtinNames as a flat literal array", () => {
    // If this ever stops matching, the assertion below is silently
    // checking nothing — so the shape is pinned before it is read.
    expect(serverSource).toMatch(/const builtinNames = \[[^\]]*\];/);
  });

  test("the mode is in it — the omission that leaves a gallery silently empty", () => {
    const literal = serverSource.match(/const builtinNames = \[([^\]]*)\];/)![1];
    const names = literal
      .split(",")
      .map((entry) => entry.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    expect(names).toContain(MODE_NAME);
  });

  test("the mode is not otherwise hardcoded into server or CLI logic", () => {
    // `server/` and `bin/` are ModeManifest-driven. The gallery registry
    // array is the one sanctioned mention of the name; anything else
    // quoting it is a branch on mode identity.
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
          if (line.includes("const builtinNames = [")) continue;
          offenders.push(`${rel}:${i + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the gallery will show it — the manifest is not hidden", () => {
    expect(eli5Manifest.hidden).toBeUndefined();
  });
});

describe("registration 3/3 — the docs", () => {
  test("`AGENTS.md` lists it on the Builtin Modes line", () => {
    const line = read("AGENTS.md")
      .split("\n")
      .find((l) => l.startsWith("**Builtin Modes:**"));
    expect(line).toBeDefined();
    expect(line).toContain(`\`${MODE_NAME}\``);
  });

  test("`CLAUDE.md` stays the one-line import — content there is the bug", () => {
    // The release contract: AGENTS.md is the single source of truth and
    // CLAUDE.md only imports it.
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
      const chunks = read(rel).split("```");
      const usage = chunks[chunks.findIndex((c) => c.includes("\nModes:\n"))];
      expect(usage).toBeDefined();
      const line = usage
        .split("\n")
        .find((l) => l.trimStart().startsWith(`${MODE_NAME} `));
      expect(line ?? `${rel}: not in CLI usage`).toContain(MODE_NAME);
    }
  });
});

describe("evolution directive", () => {
  const directive = eli5Manifest.evolution?.directive ?? "";

  test("declared at all — without it `pneuma evolve eli5` has no target", () => {
    expect(eli5Manifest.evolution).toBeDefined();
    expect(directive.trim().length).toBeGreaterThan(80);
  });

  test("it says what to LEARN about the user, not what to DO to a page", () => {
    // The learnables the design brief commissions: who they explain to,
    // which analogies they reach for, which language they write in, how
    // long/what register the pages run, and what topics recur.
    const text = directive.toLowerCase();
    expect(text).toContain("learn");
    for (const learnable of [
      "audience",
      "analog",
      "language",
      "register",
      "topic",
    ]) {
      expect({ learnable, present: text.includes(learnable) }).toEqual({
        learnable,
        present: true,
      });
    }
  });
});
