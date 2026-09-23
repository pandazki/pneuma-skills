/**
 * The export routes may not depend on a catalog mode's source at load time.
 *
 * `modes/distribution.json` splits modes in two: BUNDLED modes ship inside the
 * npm package, every other `modes/<name>/` is a CATALOG mode whose source is
 * absent from the package until it is downloaded to
 * `~/.pneuma/catalog/<name>/`. `server/routes/export.ts` used to hold
 *
 *     import { loadExplainer } from "../../modes/eli5/domain.js";
 *     import { buildPageSrcdoc } from "../../modes/eli5/viewer/player-logic.js";
 *
 * at module scope, and `eli5` is a catalog mode. In a released package those
 * files do not exist, so the import failed before a single route was
 * registered and the whole server refused to start — every mode down, not
 * just eli5. Reproduced by moving `modes/eli5/` out of the tree:
 *
 *     error: Cannot find module '../../modes/eli5/domain.js'
 *            from '.../server/routes/export.ts'
 *
 * Two things are pinned here, because either one alone can rot:
 *
 * 1. the general rule — nothing under `server/`, `bin/` or `core/` may carry
 *    a *runtime* import of a mode that is not bundled. This also guards the
 *    one such import that remains legal (`modes/remotion/...`): it is safe
 *    only for as long as remotion stays in `distribution.json`, and that
 *    coupling was invisible before this test existed.
 * 2. the replacement — `loadEli5Modules()` resolves the mode wherever it
 *    actually is and reports a plain, actionable error when it is nowhere,
 *    instead of crashing or exporting an empty page.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { bundledModeNames } from "../../core/mode-catalog.js";
import { loadEli5Modules } from "../routes/export.js";

const REPO_ROOT = join(import.meta.dir, "..", "..");
/** Everything that runs inside the released package's server process. */
const SCANNED_DIRS = ["server", "bin", "core"];

/** Mode name out of a module specifier — `.../modes/<name>/<something>`. */
function modeOfSpecifier(spec: string): string | null {
  return /(?:^|\/)modes\/([^/]+)\//.exec(spec)?.[1] ?? null;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      const child = join(abs, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(entry.name)) out.push(child);
    }
  };
  walk(join(REPO_ROOT, dir));
  return out;
}

/**
 * Every mode specifier that survives to runtime. `import type` / `export type`
 * is erased before the file runs, so a type-only reference to a mode that may
 * be absent is free — that is exactly what export.ts keeps for
 * `ExplainerManifest`. A static `import("…")` with a literal path is *not*
 * free: it hardcodes a location that a downloaded mode does not live at.
 */
function runtimeModeImports(file: string): Array<{ mode: string; statement: string }> {
  const text = readFileSync(file, "utf-8");
  const found: Array<{ mode: string; statement: string }> = [];

  // Anchored at a line start so a `from "modes/<mode>/seed/..."` inside a
  // comment or a prompt string is not mistaken for a dependency; the clause
  // may span lines but may not contain `;` or `"`, which keeps one statement
  // from swallowing the next.
  for (const m of text.matchAll(/^[ \t]*(import|export)\s+(type\s+)?([^;"]*?)\bfrom\s+"([^"]+)"/gm)) {
    const mode = modeOfSpecifier(m[4]);
    if (!mode || m[2]) continue;
    found.push({ mode, statement: m[0].replace(/\s+/g, " ") });
  }

  for (const m of text.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) {
    const mode = modeOfSpecifier(m[1]);
    if (!mode) continue;
    // `typeof import("…")` is an import-type query, not a call: it lives in a
    // type position and is erased with the rest of the types. export.ts uses
    // it to type the modules it loads by path.
    if (/\btypeof\s*$/.test(text.slice(0, m.index))) continue;
    found.push({ mode, statement: m[0] });
  }

  return found;
}

describe("server source never depends on a catalog mode at load time", () => {
  it("has no runtime import of a non-bundled mode under server/, bin/ or core/", () => {
    const bundled = new Set(bundledModeNames());
    expect(bundled.size).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of sourceFiles(dir)) {
        for (const { mode, statement } of runtimeModeImports(file)) {
          if (bundled.has(mode)) continue;
          offenders.push(`${relative(REPO_ROOT, file)}: ${statement}`);
        }
      }
    }

    // A catalog mode's source is not in the package, so this import crashes
    // the whole server at startup. Load it per request through
    // resolveCatalogMode() instead — see loadEli5Modules in routes/export.ts.
    expect(offenders).toEqual([]);
  });

  it("flags exactly the forms that survive to runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pneuma-import-scan-"));
    const file = join(dir, "sample.ts");
    await writeFile(
      file,
      [
        // Counted: plain value imports and re-exports of a mode's source.
        'import { loadExplainer } from "../../modes/eli5/domain.js";',
        'import {',
        '  buildPageSrcdoc,',
        '} from "../../modes/eli5/viewer/player-logic.js";',
        'export { pagePath } from "../../modes/eli5/viewer/player-logic.js";',
        'const late = await import("../../modes/eli5/domain.js");',
        // Not counted: erased at compile time, or not an import at all.
        'import type { ExplainerManifest } from "../../modes/eli5/domain.js";',
        'export type { AudienceEntry } from "../../modes/eli5/domain.js";',
        'interface M { fn: typeof import("../../modes/eli5/domain.js").loadExplainer }',
        '// Rewrite seedFiles paths from "modes/eli5/seed/..." to "seed/..."',
        'const help = `see the loader from "modes/eli5/domain.js" for details`;',
        // Not a mode specifier at all.
        'import data from "../../modes/distribution.json";',
      ].join("\n"),
    );
    try {
      expect(runtimeModeImports(file).map((h) => h.mode)).toEqual(["eli5", "eli5", "eli5", "eli5"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still sees the remotion import, so the scan is not vacuously green", () => {
    const hits = runtimeModeImports(join(REPO_ROOT, "server", "routes", "export.ts"));
    expect(hits.map((h) => h.mode)).toEqual(["remotion"]);
  });

  it("keeps eli5's types, and only its types, statically referenced", () => {
    const text = readFileSync(join(REPO_ROOT, "server", "routes", "export.ts"), "utf-8");
    expect(text).toContain('import type { AudienceEntry, ExplainerManifest } from "../../modes/eli5/domain.js"');
    expect(text).not.toContain('import { loadExplainer }');
    expect(text).not.toContain('import { buildPageSrcdoc }');
  });
});

describe("loadEli5Modules", () => {
  it("loads the mode's own parser and page builder from the resolved directory", async () => {
    const eli5 = await loadEli5Modules();
    expect(eli5).not.toHaveProperty("error");
    if ("error" in eli5) throw new Error(eli5.error);
    expect(typeof eli5.loadExplainer).toBe("function");
    expect(typeof eli5.buildPageSrcdoc).toBe("function");

    // Same loader the viewer uses, so export sees the viewer's ladder.
    const explainer = eli5.loadExplainer([
      {
        path: "manifest.json",
        content: JSON.stringify({
          title: "Tides",
          audiences: [{ id: "kid", label: "5", file: "pages/kid.html" }],
        }),
      },
    ]);
    expect(explainer?.byContentSet[""]?.audiences[0]?.id).toBe("kid");
    expect(eli5.buildPageSrcdoc("<p>hi</p>", { baseHref: "/content/", script: "", imageVersion: 0 })).toContain("<p>hi</p>");
  });

  it("reports a 503 naming the mode when it is installed nowhere", async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), "pneuma-no-eli5-root-"));
    const emptyHome = await mkdtemp(join(tmpdir(), "pneuma-no-eli5-home-"));
    try {
      const result = await loadEli5Modules({ projectRoot: emptyRoot, home: emptyHome });
      expect(result).toHaveProperty("error");
      if (!("error" in result)) throw new Error("expected the not-installed branch");
      expect(result.status).toBe(503);
      expect(result.error).toContain("eli5");
      // Actionable, not a bare stack trace: it says how to get the mode.
      expect(result.error).toMatch(/launcher|download/i);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
      await rm(emptyHome, { recursive: true, force: true });
    }
  });
});
