/**
 * Host ABI — the contract between a mode viewer bundle compiled outside the
 * package and the host that loads it.
 *
 * Two failure shapes are pinned here:
 *  - a bundle inlining a host singleton (its own store / i18next / React),
 *    which looks fine until state has to cross the boundary;
 *  - the externals list and the vendor shims drifting apart, which fails at
 *    module-eval time in the browser with an unresolved bare specifier or a
 *    missing named export.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join, dirname, resolve } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  HOST_ABI_EXTERNALS,
  HOST_ABI_VENDOR_URLS,
  HOST_ABI_VENDOR_SHIMS,
  HOST_STORE_EXTERNAL_SPECIFIER,
  hostAbiImportMap,
  resolveHostAbiExternal,
  buildModeViewer,
} from "../mode-build.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A string that only exists inside the host store's module graph
 * (src/store/index.ts → agent-surface-persistence.ts). Finding it in a mode
 * bundle means the bundle carries its own copy of the store.
 */
const HOST_STORE_MARKER = "pneuma:agent-surface:";

describe("host ABI declaration", () => {
  test("every external specifier is served by a vendor shim", () => {
    for (const specifier of HOST_ABI_EXTERNALS) {
      const url = HOST_ABI_VENDOR_URLS[specifier];
      expect(url, `no vendor URL for external "${specifier}"`).toBeString();
      expect(
        HOST_ABI_VENDOR_SHIMS[url],
        `no shim source served at "${url}" (external "${specifier}")`,
      ).toBeString();
    }
  });

  test("every vendor shim is reachable from an external specifier", () => {
    const served = new Set(Object.values(HOST_ABI_VENDOR_URLS));
    for (const url of Object.keys(HOST_ABI_VENDOR_SHIMS)) {
      expect(served.has(url), `shim "${url}" is not in the importmap`).toBe(true);
    }
  });

  test("the injected importmap is exactly the externals list", () => {
    expect(Object.keys(hostAbiImportMap().imports).sort()).toEqual(
      [...HOST_ABI_EXTERNALS].sort(),
    );
  });

  test("covers the modules a mode may not bring its own copy of", () => {
    for (const specifier of [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "i18next",
      "react-i18next",
      HOST_STORE_EXTERNAL_SPECIFIER,
    ]) {
      expect(HOST_ABI_EXTERNALS).toContain(specifier);
    }
  });
});

describe("resolveHostAbiExternal", () => {
  test("passes bare ABI specifiers through", () => {
    expect(resolveHostAbiExternal("react")).toBe("react");
    expect(resolveHostAbiExternal("react-i18next")).toBe("react-i18next");
    expect(resolveHostAbiExternal(HOST_STORE_EXTERNAL_SPECIFIER)).toBe(
      HOST_STORE_EXTERNAL_SPECIFIER,
    );
  });

  test("catches the relative form of the host store, however it resolves", () => {
    // What `../../../src/store.js` in a mode resolves to. The file on disk is
    // store.ts, and host files inlined into a bundle reach the same module
    // through the store/index.ts it re-exports.
    for (const rel of ["src/store.js", "src/store.ts", "src/store/index.ts", "src/store/index.js"]) {
      expect(resolveHostAbiExternal(join(PROJECT_ROOT, rel))).toBe(
        HOST_STORE_EXTERNAL_SPECIFIER,
      );
    }
  });

  test("leaves other host files and mode files alone", () => {
    expect(resolveHostAbiExternal(join(PROJECT_ROOT, "src/hooks/useSource.ts"))).toBeNull();
    expect(resolveHostAbiExternal(join(PROJECT_ROOT, "src/store-helpers.ts"))).toBeNull();
    expect(resolveHostAbiExternal("/tmp/some-mode/viewer/store.ts")).toBeNull();
    expect(resolveHostAbiExternal("react-markdown")).toBeNull();
  });
});

describe("vendor shims", () => {
  const originalWindow = (globalThis as any).window;

  afterAll(() => {
    (globalThis as any).window = originalWindow;
  });

  /**
   * Evaluate a shim the way the browser does: as an ES module, against a
   * stubbed `window`. `variant` only keeps the module registry from handing
   * back a cached evaluation of identical source.
   */
  async function evalShim(url: string, hostGlobals: Record<string, unknown>, variant = "") {
    (globalThis as any).window = hostGlobals;
    const source = `${HOST_ABI_VENDOR_SHIMS[url]}\n//${variant}`;
    const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
    return await import(dataUrl);
  }

  test("/vendor/react-i18n.js re-exports the host's whole react-i18next surface", async () => {
    const reactI18next = await import("react-i18next");
    const shim = await evalShim("/vendor/react-i18n.js", {
      __PNEUMA_I18N__: { i18next: {}, reactI18next },
    });
    for (const name of Object.keys(reactI18next)) {
      if (name === "default") continue;
      expect(shim[name], `shim is missing react-i18next export "${name}"`).toBe(
        (reactI18next as any)[name],
      );
    }
    // The two names modes actually import today.
    expect(shim.useTranslation).toBe(reactI18next.useTranslation);
    expect(shim.Trans).toBe(reactI18next.Trans);
  });

  test("/vendor/i18n.js forwards to the host instance and covers i18next's exports", async () => {
    const realI18next = await import("i18next");
    const calls: string[] = [];
    const fakeInstance = {
      t: (key: string) => `translated:${key}`,
      changeLanguage: (lng: string) => { calls.push(lng); return Promise.resolve(); },
    };
    const shim = await evalShim("/vendor/i18n.js", {
      __PNEUMA_I18N__: { i18next: fakeInstance, reactI18next: {} },
    });
    expect(shim.default).toBe(fakeInstance);
    expect(shim.t("hello")).toBe("translated:hello");
    await shim.changeLanguage("zh-CN");
    expect(calls).toEqual(["zh-CN"]);
    for (const name of Object.keys(realI18next)) {
      if (name === "default") continue;
      expect(typeof shim[name], `shim is missing i18next export "${name}"`).toBe("function");
    }
  });

  test("/vendor/pneuma-store.js re-exports the host store and fails loudly without it", async () => {
    const useStore = () => undefined;
    const shim = await evalShim("/vendor/pneuma-store.js", { __PNEUMA_STORE__: useStore });
    expect(shim.useStore).toBe(useStore);
    expect(shim.default).toBe(useStore);
    // A host that never exposed its store must fail at module eval, not hand
    // the mode an undefined hook.
    await expect(evalShim("/vendor/pneuma-store.js", {}, "no-store")).rejects.toThrow(
      /__PNEUMA_STORE__ not set/,
    );
  });
});

describe("buildModeViewer (mode outside the package)", () => {
  let modeDir = "";
  let bundle = "";
  let buildResult: Awaited<ReturnType<typeof buildModeViewer>>;

  beforeAll(async () => {
    // A mode compiled from outside the repository, laid out like a
    // first-party mode: `<modeDir>/viewer/*` reaching the host with the
    // relative `../../../src/...` imports every catalog mode uses.
    const root = mkdtempSync(join(tmpdir(), "pneuma-abi-mode-"));
    modeDir = join(root, "fixture");
    mkdirSync(join(modeDir, "viewer"), { recursive: true });

    writeFileSync(
      join(modeDir, "manifest.ts"),
      `import { resolveLocalized } from "../../../core/types/mode-manifest.js";

const manifest = {
  name: "abi-fixture",
  version: "1.0.0",
  displayName: { en: "ABI Fixture" },
  description: { en: "Fixture mode for the host ABI test" },
};

export const displayName = resolveLocalized(manifest.displayName, "en");
export default manifest;
`,
    );

    writeFileSync(
      join(modeDir, "pneuma-mode.ts"),
      `import manifest from "./manifest.js";
import FixturePreview from "./viewer/FixturePreview.js";

export default { manifest, viewer: { PreviewComponent: FixturePreview } };
`,
    );

    writeFileSync(
      join(modeDir, "viewer", "FixturePreview.tsx"),
      `import { useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { unified } from "unified";
import { useStore } from "../../../src/store.js";
import ScaffoldConfirm from "../../../src/components/ScaffoldConfirm.js";

// The mode's own zustand store — a mode may have local state; only the
// HOST's store must stay external.
const useLocalStore = create<{ n: number }>(() => ({ n: 0 }));

// A dependency with bare imports of its own — those have to survive into the
// bundle too (see the note on linkHostDependencies in mode-build.ts).
export const processor = unified();

export default function FixturePreview() {
  const { t } = useTranslation();
  const activeFile = useStore((s: any) => s.activeFile);
  const local = useLocalStore((s) => s.n);
  const [open, setOpen] = useState(false);
  return (
    <div onClick={() => setOpen(true)}>
      {t("common.loading")} {activeFile} {local}
      {open ? <ScaffoldConfirm clearPatterns={[]} files={[]} onConfirm={() => {}} onCancel={() => {}} /> : null}
    </div>
  );
}
`,
    );

    buildResult = await buildModeViewer(modeDir);
    if (buildResult.success) {
      bundle = readFileSync(join(buildResult.buildDir, "pneuma-mode.js"), "utf-8");
    }
  });

  afterAll(() => {
    if (modeDir) rmSync(dirname(modeDir), { recursive: true, force: true });
  });

  test("builds both entrypoints", () => {
    expect(buildResult.errors).toEqual([]);
    expect(buildResult.success).toBe(true);
    expect(existsSync(join(buildResult.buildDir, "pneuma-mode.js"))).toBe(true);
    expect(existsSync(join(buildResult.buildDir, "manifest.js"))).toBe(true);
  });

  test("does not inline a second copy of the host store", () => {
    // Guard: the marker must still identify the host store's module graph.
    const storeSource = readFileSync(
      join(PROJECT_ROOT, "src/store/agent-surface-persistence.ts"),
      "utf-8",
    );
    expect(storeSource).toContain(HOST_STORE_MARKER);
    expect(bundle).not.toContain(HOST_STORE_MARKER);
  });

  test("imports the host singletons as vendor specifiers", () => {
    expect(bundle).toContain(`from "${HOST_STORE_EXTERNAL_SPECIFIER}"`);
    expect(bundle).toContain(`from "react"`);
    // react-i18next arrives through an inlined HOST component
    // (src/components/ScaffoldConfirm.tsx) as well as the mode's own import —
    // both must reach the host instance.
    expect(bundle).toContain(`from "react-i18next"`);
    expect(bundle).toContain("ScaffoldConfirm");
  });

  test("still inlines the mode's own dependencies", () => {
    // zustand resolved from the project's node_modules (the mode has none)
    // and is bundled, because it is the mode's state, not the host's.
    expect(bundle).not.toContain(`from "zustand"`);
    expect(bundle).toContain("useLocalStore");
  });

  test("inlines a dependency's own dependencies, not just its entry", () => {
    // A Bun 1.4.0 onResolve handler that answers a bare specifier with null
    // drops the import instead of falling through: the bundle then builds
    // clean with `unified is not defined` in it. Pin that the transitive
    // graph is really there, by definition and not only by reference.
    expect(bundle).toContain("unified()");
    // `trough` and `bail` are unified's own bare imports — one level deeper
    // than anything the mode names itself.
    expect(bundle).toMatch(/function trough\(/);
    expect(bundle).toMatch(/function bail\(/);
  });

  test("writes nothing into the mode but .build/", () => {
    // The mode directory is what the release step archives, so a build must
    // not leave resolution scaffolding (a linked node_modules, a lockfile)
    // next to the sources.
    expect(readdirSync(modeDir).sort()).toEqual([".build", "manifest.ts", "pneuma-mode.ts", "viewer"]);
  });
});
