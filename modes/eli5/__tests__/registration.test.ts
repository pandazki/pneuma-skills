/**
 * The mode is actually registered — and the evolution agent knows what to
 * learn from it.
 *
 * Registration has three surfaces read by different consumers, and each
 * one fails differently and quietly when it is missed (the shape of this
 * suite follows `modes/bansho/__tests__/registration.test.ts`, which paid
 * for the lesson):
 *
 *  - the mode's source, found by `core/mode-catalog.ts` and handed to the
 *    loader by `registerExternalMode` — miss it and the mode is "Unknown
 *    mode" (a CATALOG mode is not in the builtin registry by design);
 *  - the launcher gallery registry in `server/index.ts`, derived from
 *    `modes/distribution.json` plus the on-disk mode directories — put the
 *    mode somewhere that derivation does not look and `bun run dev eli5`
 *    still works, so nothing looks broken, but the gallery never shows it;
 *  - the mode catalogs in both READMEs — miss it and the mode exists
 *    but nobody reading the project can find it.
 *
 * So they are pinned here rather than trusted. The gallery derivation
 * lives inside a route handler, so it is pinned against the source text —
 * the honest option, and the same shape this repo already uses for
 * source-level invariants.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { listBuiltinModes } from "../../../core/mode-loader.js";
import { isCatalogMode, resolveCatalogMode } from "../../../core/mode-catalog.js";
import eli5Manifest from "../manifest.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");

const MODE_NAME = "eli5";
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
    expect(manifest.skill?.installName).toBe(eli5Manifest.skill?.installName);
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

  // One file is allowed to name the mode, and the allowance is as narrow as
  // the debt it records. `server/routes/export.ts` has carried this mode's
  // whole export surface since it shipped — the `/export/eli5*` routes, the
  // manifest schema, the ladder page builders — the name simply used to hide
  // inside path strings. Making the mode a CATALOG mode is what forces the
  // file to say it out loud: its source is no longer in the package, so the
  // routes resolve it at request time and a static import would kill the
  // released server at boot. Moving that export surface into the mode is the
  // real fix and is its own piece of work; until then the file may spend
  // exactly one line on it.
  const NAMED_BY = "server/routes/export.ts";
  const ALLOWED_LINE = `const ELI5_MODE = "${MODE_NAME}";`;

  test("only the export routes name the mode, and only once", () => {
    const lines = read(NAMED_BY).split("\n");
    const hits = lines.filter((l) => l.includes(`"${MODE_NAME}"`));
    // Exactly one, and it is the declaration — not a branch on identity that
    // happened to grow next to it.
    expect(hits.map((l) => l.trim())).toEqual([ALLOWED_LINE]);
  });

  test("nothing else in server or CLI logic is hardcoded to the mode", () => {
    // `server/` and `bin/` are ModeManifest-driven, and the gallery derives
    // its list from disk: outside the one line above, any line quoting the
    // name is a branch on mode identity.
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
          if (rel === NAMED_BY && line.trim() === ALLOWED_LINE) continue;
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
