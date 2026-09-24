/**
 * The catalog bundle carries the Rive runtime's WebAssembly, and the bundle
 * finds it.
 *
 * The Export tab's Rive preview must work offline and in the desktop app, so
 * the runtime's `.wasm` ships with the mode instead of coming from unpkg. The
 * catalog bundle is built by `snapshot/mode-build.ts` (Bun.build): the viewer
 * imports the file for its URL, the `file` loader emits it into `.build/`
 * beside `pneuma-mode.js`, and the code resolves the emitted name against
 * `import.meta.url` — which, served at `/mode-assets/pneuma-mode.js`, is
 * `/mode-assets/rive-<hash>.wasm`. Any link of that chain can break silently
 * (a bundler that inlines instead of emitting, a name that is not relative to
 * the bundle), and the symptom is a preview panel saying the player could not
 * start. This builds the real viewer the way a downloaded catalog mode is
 * built — outside the repository, with no node_modules of its own — and
 * follows the chain to the file. The server half (the route serves it as
 * application/wasm) is pinned in `server/__tests__/workspace-containment`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildModeViewer } from "../../../snapshot/mode-build.js";

const MODE_DIR = join(import.meta.dir, "..");
const require = createRequire(import.meta.url);
const RUNTIME_WASM = join(dirname(require.resolve("@rive-app/canvas/package.json")), "rive.wasm");

describe("the catalog bundle ships the Rive runtime's WebAssembly", () => {
  let root = "";
  let result: Awaited<ReturnType<typeof buildModeViewer>>;
  let bundle = "";

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "pneuma-sprite-bundle-"));
    const modeDir = join(root, "sprite");
    // What a catalog archive carries, less the seeds: the viewer imports one
    // pure module from the skill (`rive-plan.mjs`, the plan the Export tab
    // quotes), so the skill has to be there for the build to find it.
    for (const entry of ["manifest.ts", "pneuma-mode.ts", "domain.ts", "viewer", "skill"]) {
      cpSync(join(MODE_DIR, entry), join(modeDir, entry), { recursive: true });
    }
    result = await buildModeViewer(modeDir);
    if (result.success) bundle = readFileSync(join(result.buildDir, "pneuma-mode.js"), "utf-8");
  }, 120_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test("the build succeeds", () => {
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  test("the .wasm is emitted beside the bundle, byte for byte the runtime's own", () => {
    const emitted = readdirSync(result.buildDir).filter((name) => name.endsWith(".wasm"));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatch(/^rive-[\w-]+\.wasm$/);
    expect(readFileSync(join(result.buildDir, emitted[0])).equals(readFileSync(RUNTIME_WASM))).toBe(true);
  });

  test("the bundle names it relative to itself, so /mode-assets/ resolves it", () => {
    const [emitted] = readdirSync(result.buildDir).filter((name) => name.endsWith(".wasm"));
    const named = bundle.match(/["'](\.\/rive-[\w-]+\.wasm)["']/);
    expect(named?.[1]).toBe(`./${emitted}`);
    // What `new URL(named, import.meta.url)` gives in the browser.
    const served = new URL(named![1], "http://localhost:17996/mode-assets/pneuma-mode.js");
    expect(served.pathname).toBe(`/mode-assets/${emitted}`);
    expect(existsSync(join(result.buildDir, served.pathname.slice("/mode-assets/".length)))).toBe(true);
    expect(bundle).toContain("import.meta.url");
  });

  test("the runtime is told to use it, with the CDN fallback switched off", () => {
    expect(bundle).toMatch(/setWasmUrl\(new URL\(/);
    expect(bundle).toContain("setWasmFallbackUrl(null)");
    // The runtime itself is inlined: the host ABI does not provide it.
    expect(bundle).not.toMatch(/from\s*["']@rive-app\/canvas["']/);
  });
});
