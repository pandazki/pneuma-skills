/**
 * Mode Build — the single way a mode viewer is compiled for production, and
 * the declaration of the host ABI those bundles are compiled against.
 *
 * Every production bundle (mode-maker publish, the launch-time pre-compile in
 * `bin/pneuma.ts`, and the release pack step) goes through `buildModeViewer`.
 * Third-party dependencies are inlined so the archive is self-contained; the
 * modules listed in `HOST_ABI_EXTERNALS` stay external and are supplied at
 * runtime by the host through the `/vendor/*.js` shims below.
 *
 * Why one list: two build configurations that disagree about the ABI produce
 * bundles that *look* fine and then quietly run a second React, a second
 * Zustand store or a second i18next instance. The externals, the vendor URLs
 * the importmap resolves them to, and the shim sources the server serves are
 * all derived from the tables in this file so they cannot drift apart.
 */

import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Specifier a bundle emits for the host's Zustand store. Mode-maker's fork
 * route rewrites escaping imports into this `pneuma-skills/...` form; a mode
 * that reaches the store by relative path (`../../../src/store.js`, which is
 * how every first-party mode writes it) is rewritten to it at build time.
 */
export const HOST_STORE_EXTERNAL_SPECIFIER = "pneuma-skills/src/store.js";

/** Bundler namespace holding the generated host-store stub (see the plugin). */
const HOST_ABI_NAMESPACE = "pneuma-host-abi";

/**
 * The host ABI: bare specifier → URL of the shim that provides it at runtime.
 * This map is the importmap the server injects into `index.html` for a session
 * that serves an external mode bundle, so the browser resolves the bare
 * specifiers a bundle emits to the host's own singletons.
 *
 * - react / react-dom / both JSX runtimes: one React per page, or hooks throw.
 * - the host store: inlining it gives the mode a parallel Zustand instance, so
 *   everything crossing the boundary (activeContentSet, activeFile, selection)
 *   silently stops flowing.
 * - i18next / react-i18next: `src/components/ScaffoldConfirm.tsx` (imported by
 *   several mode viewers) and `modes/cosmos` call `useTranslation`/`Trans`.
 *   An inlined react-i18next has no initialised instance behind it, so every
 *   translated string renders as its raw key.
 */
export const HOST_ABI_VENDOR_URLS: Readonly<Record<string, string>> = {
  react: "/vendor/react.js",
  "react-dom": "/vendor/react-dom.js",
  "react/jsx-runtime": "/vendor/react-jsx-runtime.js",
  "react/jsx-dev-runtime": "/vendor/react-jsx-dev-runtime.js",
  i18next: "/vendor/i18n.js",
  "react-i18next": "/vendor/react-i18n.js",
  [HOST_STORE_EXTERNAL_SPECIFIER]: "/vendor/pneuma-store.js",
  // Modes written before the `.js` convention settled emit the `.ts` form.
  "pneuma-skills/src/store.ts": "/vendor/pneuma-store.js",
};

/** Bare specifiers `Bun.build` must leave alone. */
export const HOST_ABI_EXTERNALS: readonly string[] = Object.keys(HOST_ABI_VENDOR_URLS);

// ── Vendor shims ────────────────────────────────────────────────────────
// ES modules served by the session server at the URLs above. They re-export
// the host singletons from `window.__PNEUMA_*`, which `src/main.tsx` sets
// before the mode bundle is imported.
//
// A named import that a shim does not export fails hard at module-eval time
// in the browser (`SyntaxError: ... does not provide an export named 'x'`)
// and the mode never mounts. So the React family of shims does not list its
// names by hand: each one re-exports the export surface of the very package
// the host's singleton comes from, read off that package when the shim is
// first served. A hand-kept list is how 3.52.x shipped a React shim without
// `version` or `useInsertionEffect`, and Draw and ClipCraft stuck on
// "Loading…".

// The checkout a mode is compiled against: its `src/` and `core/` are the
// sources a bundle inlines (everything but the host ABI), so the archive is
// self-contained and carries no machine-specific import paths. It is also
// where the host's React resolves from, so the shims enumerate that copy.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const hostRequire = createRequire(join(PROJECT_ROOT, "package.json"));

/** A name `export const { name } = X` can bind. */
const BINDABLE_EXPORT = /^[A-Za-z_$][\w$]*$/;

/**
 * Named exports of the given host packages, as the host exposes them.
 *
 * `default` and `__esModule` are interop plumbing, not names a bundle can
 * import by name. A key that is not a bindable identifier cannot be written
 * as a named export here and is left out — `mode-host-abi.test.ts` fails if
 * any real key is ever dropped this way.
 */
function hostExportNames(...specifiers: string[]): string[] {
  const names = new Set<string>();
  for (const specifier of specifiers) {
    for (const key of Object.keys(hostRequire(specifier) as object)) {
      if (key === "default" || key === "__esModule") continue;
      if (BINDABLE_EXPORT.test(key)) names.add(key);
    }
  }
  return [...names].sort();
}

/** What a shim exports, and the module source that exports it. */
interface VendorShim {
  /** Named exports, excluding `default`. */
  readonly names: readonly string[];
  readonly hasDefault: boolean;
  readonly source: string;
}

function destructureExports(names: readonly string[], from: string): string {
  return names.length ? `export const { ${names.join(", ")} } = ${from};` : "";
}

// `src/main.tsx` exposes `import * as React from "react"`: the namespace,
// whose keys are the package's exports.
function reactShim(): VendorShim {
  const names = hostExportNames("react");
  return {
    names,
    hasDefault: true,
    source: `const R = window.__PNEUMA_REACT__;
export default R;
${destructureExports(names, "R")}`,
  };
}

// `src/main.tsx` exposes `{ ...ReactDOM, createRoot, hydrateRoot }` — the
// `react-dom` namespace with the `react-dom/client` entry points merged in —
// so this shim covers both packages' surfaces.
//
// `unstable_batchedUpdates` is still imported by @dnd-kit and a few other
// dependencies. React 18+ batches on its own, so an identity fallback keeps
// those bundles linking if a React release ever stops exporting it.
function reactDomShim(): VendorShim {
  const COMPAT = "unstable_batchedUpdates";
  const names = hostExportNames("react-dom", "react-dom/client").filter((n) => n !== COMPAT);
  return {
    names: [...names, COMPAT].sort(),
    hasDefault: true,
    source: `const RD = window.__PNEUMA_REACT_DOM__;
export default RD;
${destructureExports(names, "RD")}
export const ${COMPAT} = RD.${COMPAT} || ((fn, ...args) => fn(...args));`,
  };
}

// `src/main.tsx` exposes `import * as JsxRuntime from "react/jsx-runtime"`.
function jsxRuntimeShim(): VendorShim {
  const names = hostExportNames("react/jsx-runtime");
  return {
    names,
    hasDefault: false,
    source: `const J = window.__PNEUMA_JSX_RUNTIME__;
${destructureExports(names, "J")}`,
  };
}

// Bun.build uses jsx-dev-runtime (jsxDEV) due to a Bun v1.3+ regression.
// The host exposes no dev runtime, only the production one: jsxDEV(type,
// props, key, isStatic, source, self) is signature-compatible with
// jsx(type, props, key) — the extra dev arguments are simply ignored. Every
// other name of the dev runtime is taken from the production one.
function jsxDevRuntimeShim(): VendorShim {
  const names = hostExportNames("react/jsx-dev-runtime");
  const shared = names.filter((n) => n !== "jsxDEV");
  return {
    names,
    hasDefault: false,
    source: `const J = window.__PNEUMA_JSX_RUNTIME__;
${names.includes("jsxDEV") ? "export const jsxDEV = J.jsx;" : ""}
${destructureExports(shared, "J")}`,
  };
}

// Host store shim — re-exports `useStore` from the HOST's single Zustand
// instance. Without this, Bun.build inlines the entire src/store.ts
// tree into every published mode bundle, and the mode ends up with its
// own parallel store that never talks to the host. The visible symptom
// is anything that crosses the mode/host boundary (activeContentSet,
// activeFile, selection) silently failing because writes go to the
// mode's bundled copy while the host reads from its own.
function pneumaStoreShim(): VendorShim {
  return {
    names: ["useStore"],
    hasDefault: true,
    source: `const S = window.__PNEUMA_STORE__;
if (!S) throw new Error("__PNEUMA_STORE__ not set — pneuma-skills host didn't expose useStore before loading the mode bundle");
export const useStore = S;
export default S;`,
  };
}

// i18next — the host's *initialised* default instance. The named exports of
// the real package are bound to that same default instance, so they are
// forwarded as calls rather than destructured (an unbound `changeLanguage`
// would lose `this`). Which names are instance methods is a judgement about
// i18next's semantics, so this list stays explicit; the ABI test fails when
// the real package exports a name it does not cover.
const I18NEXT_FORWARDED = [
  "t", "changeLanguage", "createInstance", "dir", "exists", "getFixedT",
  "hasLoadedNamespace", "init", "keyFromSelector", "loadLanguages",
  "loadNamespaces", "loadResources", "reloadResources", "setDefaultNamespace",
  "use",
] as const;

function i18nextShim(): VendorShim {
  return {
    names: [...I18NEXT_FORWARDED].sort(),
    hasDefault: true,
    source: `const I = window.__PNEUMA_I18N__;
if (!I) throw new Error("__PNEUMA_I18N__ not set — pneuma-skills host didn't expose its i18next instance before loading the mode bundle");
const i18n = I.i18next;
export default i18n;
${I18NEXT_FORWARDED.map((n) => `export const ${n} = (...a) => i18n.${n}(...a);`).join("\n")}`,
  };
}

// react-i18next — the host's module namespace, whose `initReactI18next` has
// already bound the instance above. Components and hooks carry no `this`, so
// destructuring the namespace is safe.
function reactI18nextShim(): VendorShim {
  const names = hostExportNames("react-i18next");
  return {
    names,
    hasDefault: true,
    source: `const I = window.__PNEUMA_I18N__;
if (!I || !I.reactI18next) throw new Error("__PNEUMA_I18N__.reactI18next not set — pneuma-skills host didn't expose react-i18next before loading the mode bundle");
const R = I.reactI18next;
export default R;
${destructureExports(names, "R")}`,
  };
}

const VENDOR_SHIM_FACTORIES: Readonly<Record<string, () => VendorShim>> = {
  "/vendor/react.js": reactShim,
  "/vendor/react-dom.js": reactDomShim,
  "/vendor/react-jsx-runtime.js": jsxRuntimeShim,
  "/vendor/react-jsx-dev-runtime.js": jsxDevRuntimeShim,
  "/vendor/pneuma-store.js": pneumaStoreShim,
  "/vendor/i18n.js": i18nextShim,
  "/vendor/react-i18n.js": reactI18nextShim,
};

const vendorShimCache = new Map<string, VendorShim>();

/**
 * The shim served at a vendor URL. Built on first use: enumerating the host
 * packages loads them (react-dom/client and react-i18next dominate, ~15–30 ms
 * together), which a session that serves no external mode never needs.
 */
function vendorShim(url: string): VendorShim {
  let shim = vendorShimCache.get(url);
  if (!shim) {
    const factory = VENDOR_SHIM_FACTORIES[url];
    if (!factory) throw new Error(`no host-ABI vendor shim is served at "${url}"`);
    shim = factory();
    vendorShimCache.set(url, shim);
  }
  return shim;
}

/**
 * Vendor shim URL → ES module source. The server serves exactly these.
 * Each entry is an enumerable getter, so reading the table is how a shim is
 * first built (see `vendorShim`).
 */
export const HOST_ABI_VENDOR_SHIMS: Readonly<Record<string, string>> = Object.freeze(
  Object.defineProperties(
    {} as Record<string, string>,
    Object.fromEntries(
      Object.keys(VENDOR_SHIM_FACTORIES).map((url) => [
        url,
        { enumerable: true, get: () => vendorShim(url).source },
      ]),
    ),
  ),
);

/**
 * Names a bundle may import from a host-ABI specifier — `"default"` included
 * when the shim has a default export. Null for a specifier outside the ABI.
 */
export function hostAbiExportNames(specifier: string): ReadonlySet<string> | null {
  const url = HOST_ABI_VENDOR_URLS[specifier];
  if (!url) return null;
  const shim = vendorShim(url);
  return new Set(shim.hasDefault ? [...shim.names, "default"] : shim.names);
}

// ── Bundle ↔ ABI link check ─────────────────────────────────────────────

/** An import in a built bundle that the host ABI cannot satisfy. */
export interface UnresolvedHostAbiImport {
  file: string;
  specifier: string;
  /** The imported name, or a description of an import form not understood. */
  name: string;
}

const SPECIFIER_ALTERNATION = () =>
  HOST_ABI_EXTERNALS.map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");

/**
 * The imported names of an import/export clause, or null when the clause is
 * a form this check does not understand.
 */
function clauseImportedNames(keyword: string, clause: string): string[] | null {
  const names: string[] = [];
  let rest = clause.trim();
  if (rest === "*" || /^\*\s+as\s+[\w$]+$/.test(rest)) return names; // namespace
  if (keyword === "import") {
    const lead = /^([A-Za-z_$][\w$]*)\s*(,\s*|$)/.exec(rest);
    if (lead) {
      names.push("default");
      rest = rest.slice(lead[0].length).trim();
      if (!rest) return names;
      if (/^\*\s+as\s+[\w$]+$/.test(rest)) return names;
    }
  }
  const braces = /^\{([^}]*)\}$/.exec(rest);
  if (!braces) return null;
  for (const part of braces[1].split(",")) {
    const item = part.trim();
    if (!item) continue;
    const m = /^(?:type\s+)?([A-Za-z_$][\w$]*|"[^"]*")(?:\s+as\s+[A-Za-z_$][\w$]*)?$/.exec(item);
    if (!m) return null;
    names.push(m[1].replace(/^"|"$/g, ""));
  }
  return names;
}

/**
 * Check a built bundle's imports of host-ABI specifiers against the names the
 * shims export. The browser links a bundle against the shims and throws on
 * any missing name before a line of the mode runs; Bun.build does not — an
 * external import is never checked — so this is the only place the mismatch
 * can be caught before a user sees a mode that never loads.
 *
 * Bun emits every import of an external module as one statement at the start
 * of a line (`import { a, b as c } from "react";`), which is what this scans
 * for. A form it cannot read is reported rather than let through, and so is
 * a `require()` of an ABI module: it has no importmap to resolve against.
 */
export function findUnresolvedHostAbiImports(
  source: string,
  file = "<bundle>",
): UnresolvedHostAbiImport[] {
  const unresolved: UnresolvedHostAbiImport[] = [];
  const specs = SPECIFIER_ALTERNATION();
  const statement = new RegExp(
    `^[ \\t]*(import|export)\\s*([^;"'\`]*?)\\s*from\\s*["'](${specs})["']`,
    "gm",
  );
  for (const match of source.matchAll(statement)) {
    const [, keyword, clause, specifier] = match;
    const exported = hostAbiExportNames(specifier)!;
    const names = clauseImportedNames(keyword, clause);
    if (!names) {
      unresolved.push({ file, specifier, name: `unrecognised ${keyword} clause "${clause.trim()}"` });
      continue;
    }
    for (const name of names) {
      if (!exported.has(name)) unresolved.push({ file, specifier, name });
    }
  }
  // Bun's CJS interop helper — how a CommonJS dependency's `require("react")`
  // comes out when react is external. It throws in the browser.
  const required = new RegExp(`\\b__require\\(\\s*["'](${specs})["']\\s*\\)`, "g");
  for (const match of source.matchAll(required)) {
    unresolved.push({ file, specifier: match[1], name: "require() of a host-ABI module" });
  }
  return unresolved;
}

/** The importmap body the host injects so a bundle's bare specifiers resolve. */
export function hostAbiImportMap(): { imports: Record<string, string> } {
  return { imports: { ...HOST_ABI_VENDOR_URLS } };
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

/** Resolve a project-relative path to the file that actually exists on disk. */
function resolveProjectFile(candidate: string): string | null {
  if (existsSync(candidate)) return candidate;
  const dotIdx = candidate.lastIndexOf(".");
  if (dotIdx > candidate.lastIndexOf("/")) {
    const base = candidate.slice(0, dotIdx);
    for (const ext of SOURCE_EXTENSIONS) {
      if (existsSync(base + ext)) return base + ext;
    }
  }
  for (const ext of SOURCE_EXTENSIONS) {
    if (existsSync(join(candidate, "index" + ext))) return join(candidate, "index" + ext);
  }
  return null;
}

/**
 * Package names the mode's own files import, used to build a *narrow*
 * `onResolve` filter for the host-dependency fallback.
 *
 * The filter has to be narrow because of a Bun 1.4.0 trap: an `onResolve`
 * handler that answers a **bare** specifier with `null` does not fall through
 * to the default resolver — the import is dropped and the build still
 * succeeds, leaving an undefined reference in the bundle (react-markdown came
 * out at 74 KB with `unified is not defined` inside). Returning null is only
 * safe for path-like specifiers. So the plugin may only be shown specifiers
 * it answers itself: the ones the mode names, and nothing a dependency of a
 * dependency asks for.
 *
 * A specifier this scan misses degrades to Bun's own resolution — an
 * unresolved-import build error, not a silently broken bundle.
 */
function collectModeBareImports(modeDir: string): Set<string> {
  const packages = new Set<string>();
  const sources = new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs}");
  for (const rel of sources.scanSync({ cwd: modeDir, absolute: false })) {
    if (rel.startsWith("node_modules/") || rel.startsWith(".build/")) continue;
    let text: string;
    try {
      text = readFileSync(join(modeDir, rel), "utf-8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (/^[./]/.test(specifier)) continue; // path-like
      if (specifier.startsWith("node:") || specifier.startsWith("bun:")) continue;
      if (specifier.startsWith("pneuma-skills/")) continue;
      if (HOST_ABI_EXTERNALS.includes(specifier)) continue;
      const segments = specifier.split("/");
      packages.add(specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0]);
    }
  }
  return packages;
}

/** Match exactly `<name>` or `<name>/<subpath>` for the given packages. */
function packageFilter(packages: Set<string>): RegExp | null {
  if (packages.size === 0) return null;
  const alternatives = [...packages]
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`^(${alternatives})(/|$)`);
}

/** Resolve symlinks when the path exists; otherwise keep it as given. */
function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Directory containment, without matching a sibling that shares a prefix. */
function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : root + "/");
}

function stripExtension(path: string): string {
  const dotIdx = path.lastIndexOf(".");
  return dotIdx > path.lastIndexOf("/") ? path.slice(0, dotIdx) : path;
}

/**
 * Modules of the host that must never be inlined, addressed by project path.
 * `src/store.ts` is the public barrel; `src/store/index.ts` is what it
 * re-exports, and a host file inlined into a mode bundle may import either.
 * Both expose exactly `useStore` at runtime, which the store shim provides.
 */
const HOST_STORE_MODULES = ["src/store", "src/store/index"];

/**
 * Map an import to the host-ABI specifier that must appear in the bundle, or
 * null when the import is the mode's own business.
 *
 * Accepts both forms the same module arrives as: the bare specifier
 * (`react`, `pneuma-skills/src/store.js`) and an absolute path produced by
 * resolving a relative import (`<projectRoot>/src/store.js` — how every
 * first-party mode reaches the store).
 */
export function resolveHostAbiExternal(
  specifierOrPath: string,
  projectRoot: string = PROJECT_ROOT,
): string | null {
  if (HOST_ABI_EXTERNALS.includes(specifierOrPath)) return specifierOrPath;
  if (specifierOrPath.startsWith("/")) {
    const withoutExt = stripExtension(specifierOrPath);
    for (const rel of HOST_STORE_MODULES) {
      if (withoutExt === join(projectRoot, rel)) return HOST_STORE_EXTERNAL_SPECIFIER;
    }
  }
  return null;
}

export interface ModeBuildOptions {
  /**
   * Root of the pneuma-skills checkout whose `src/`/`core/` a mode outside the
   * tree is compiled against. Defaults to this file's project root.
   */
  projectRoot?: string;
}

export interface ModeBuildResult {
  success: boolean;
  buildDir: string;
  errors: string[];
}

/**
 * Build a mode's viewer bundle into `<modeDir>/.build/`.
 *
 * 1. If package.json exists but node_modules is missing, runs `bun install`
 * 2. Deletes stale .build/ directory
 * 3. Runs Bun.build() to produce ESM bundles with the host ABI external
 */
export async function buildModeViewer(
  modeDir: string,
  options: ModeBuildOptions = {},
): Promise<ModeBuildResult> {
  // Bun reports every importer path with symlinks resolved, so the paths the
  // resolver compares against have to be resolved too (macOS /tmp →
  // /private/tmp is the common case).
  const projectRoot = realpathOr(options.projectRoot ?? PROJECT_ROOT);
  const buildDir = join(modeDir, ".build");
  const errors: string[] = [];

  // 1. Auto-install deps if package.json exists but node_modules is missing
  const pkgJsonPath = join(modeDir, "package.json");
  if (existsSync(pkgJsonPath) && !existsSync(join(modeDir, "node_modules"))) {
    const proc = Bun.spawn(["bun", "install"], {
      cwd: modeDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return {
        success: false,
        buildDir,
        errors: [`bun install failed (exit ${exitCode}): ${stderr}`],
      };
    }
  }

  // 2. Clean stale build artifacts
  if (existsSync(buildDir)) {
    rmSync(buildDir, { recursive: true, force: true });
  }

  // 3. Collect entrypoints
  const modeEntry = join(modeDir, "pneuma-mode.ts");
  const manifestEntry = join(modeDir, "manifest.ts");
  const entrypoints = [modeEntry, manifestEntry].filter((e) => existsSync(e));

  if (entrypoints.length === 0) {
    return {
      success: false,
      buildDir,
      errors: ["No entrypoints found (need pneuma-mode.ts or manifest.ts)"],
    };
  }

  // The mode root is compared against importer paths, so it needs to be
  // absolute — callers pass relative paths ("modes/doc") — and to carry both
  // spellings, the caller's and the symlink-resolved one.
  const absModeDir = resolve(modeDir);
  const realModeDir = realpathOr(absModeDir);
  const modeRoots = realModeDir === absModeDir ? [absModeDir] : [absModeDir, realModeDir];
  const isModeFile = (path: string): boolean =>
    modeRoots.some((root) => isInside(path, root));

  // The stub's own path must differ from the specifier it re-exports, or Bun
  // resolves that import back to the stub itself ("Detected cycle while
  // resolving import").
  const hostStoreStub = { path: "host-store", namespace: HOST_ABI_NAMESPACE };

  // A mode inside the project tree, or one carrying its own node_modules,
  // resolves its dependencies on its own. One that lives elsewhere with no
  // node_modules (a first-party mode copied out of the tree, a fork workspace)
  // gets them from the project it was built against.
  const hostDependencies =
    modeRoots.some((root) => isInside(root, projectRoot)) ||
    existsSync(join(absModeDir, "node_modules"))
      ? null
      : packageFilter(collectModeBareImports(absModeDir));

  // 4. Bundle with Bun.build — inlines every dependency except the host ABI.
  //    `throw: false` so Bun returns logs instead of throwing — otherwise the
  //    outer publish catch reports a useless "Bundle failed" with no detail
  //    about which import actually failed.
  const result = await Bun.build({
    entrypoints,
    outdir: buildDir,
    target: "browser",
    format: "esm",
    external: [...HOST_ABI_EXTERNALS],
    throw: false,
    // Substitute Vite-specific `import.meta.env.*` accesses with static
    // values at build time. Viewer code branches on these to pick between
    // a dev-time API origin (`http://host:<vite-api-port>`) and a prod
    // same-origin relative path. In a published bundle served from the
    // host's /mode-assets/ route, same-origin is correct — so DEV=false
    // and we force the "production" branches. Without this substitution,
    // `import.meta.env` is undefined at runtime and `.DEV` throws
    // TypeError before the viewer even mounts.
    define: {
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
      "import.meta.env.MODE": '"production"',
      // VITE_API_PORT and VITE_MODE_MAKER_WORKSPACE are only read inside
      // the DEV branch (which is now dead-code-eliminated), but tree-
      // shakers that look at statically-known properties may still want
      // them defined. undefined is fine — the || fallback handles it.
      "import.meta.env.VITE_API_PORT": "undefined",
      "import.meta.env.VITE_MODE_MAKER_WORKSPACE": "undefined",
    },
    plugins: [
      {
        name: "pneuma-host-abi",
        setup(builder) {
          // Bun keeps the *original* specifier for an external import, so a
          // relative `../../../src/store.js` cannot simply be flagged
          // external — the browser would then fetch a path that does not
          // exist. Every spelling of the host store is routed to one stub
          // module instead, and the stub imports the bare specifier the
          // importmap resolves to /vendor/pneuma-store.js.
          builder.onLoad({ filter: /.*/, namespace: HOST_ABI_NAMESPACE }, () => ({
            contents: `export { useStore } from "${HOST_STORE_EXTERNAL_SPECIFIER}";\nexport { default } from "${HOST_STORE_EXTERNAL_SPECIFIER}";`,
            loader: "js" as const,
          }));

          // `pneuma-skills/...` bare specifiers — the portable form
          // mode-maker's fork route rewrites escaping imports into. Always
          // answered: a bare specifier this plugin leaves to Bun would be
          // dropped (see collectModeBareImports), so an unresolvable one is
          // returned as the path it should have been, for Bun to report.
          builder.onResolve({ filter: /^pneuma-skills\// }, (args) => {
            // The store's own bare specifier — what the stub above imports.
            // Resolving it back to a file would make the stub import itself
            // ("Detected cycle while resolving import").
            if (HOST_ABI_EXTERNALS.includes(args.path)) {
              return { path: args.path, external: true };
            }
            const target = join(projectRoot, args.path.slice("pneuma-skills/".length));
            if (resolveHostAbiExternal(target, projectRoot)) return hostStoreStub;
            return { path: resolveProjectFile(target) ?? target };
          });

          // Third-party dependencies the mode names but cannot resolve on
          // its own, answered from the project it is built against. The
          // filter covers only those package names — anything wider would
          // also catch a dependency's own imports, which this plugin must
          // not answer (see collectModeBareImports).
          if (hostDependencies) {
            builder.onResolve({ filter: hostDependencies }, (args) => {
              try {
                const resolved = Bun.resolveSync(args.path, projectRoot);
                if (resolved.startsWith("/")) return { path: resolved };
              } catch { /* fall through to the reportable path below */ }
              // Never null for a bare specifier: Bun would drop the import.
              // A path that does not exist is reported as a build error.
              return { path: join(projectRoot, "node_modules", args.path) };
            });
          }

          // Path-like imports. A mode living outside the tree still reaches
          // the host by relative path (every first-party mode writes
          // `../../../src/store.js`), which resolves to a path that does not
          // exist once the mode is moved — redirect the `/core/` or `/src/`
          // segment to the project root. Returning null here is safe: for
          // path-like specifiers Bun does fall through to its own resolver.
          builder.onResolve({ filter: /^(\.{1,2}\/|\/)/ }, (args) => {
            if (!args.importer) return null;
            let abs = resolve(dirname(args.importer), args.path);
            let redirected = false;
            // Only a file of the mode can be reaching into the host, and only
            // an import that leaves the mode can be that reach. Both halves
            // matter: without the first, a dependency's own `./src/...`
            // import is rewritten into the project root ("File not found
            // <project>/src/zoom.js"); without the second, a mode installed
            // under a path containing `/src/` loses its own files the same
            // way.
            if (isModeFile(args.importer) && !isInside(abs, projectRoot) && !isModeFile(abs)) {
              for (const prefix of ["/core/", "/src/"]) {
                const idx = abs.indexOf(prefix);
                if (idx !== -1) {
                  abs = projectRoot + abs.slice(idx);
                  redirected = true;
                  break;
                }
              }
            }
            // The store is ABI whoever imports it — including a host file
            // that was inlined into this bundle.
            if (resolveHostAbiExternal(abs, projectRoot)) return hostStoreStub;
            if (!redirected) return null;
            return { path: resolveProjectFile(abs) ?? abs };
          });
        },
      },
    ],
  });

  if (!result.success) {
    for (const log of result.logs) {
      errors.push(log.message);
    }
    return { success: false, buildDir, errors };
  }

  // 5. Link the bundle against the host ABI. A name the shims do not export
  //    builds fine and then fails in the browser before the mode mounts, so
  //    it is a build error here — for every caller, the release pack step
  //    included.
  for (const output of result.outputs) {
    if (!output.path.endsWith(".js")) continue;
    const rel = output.path.startsWith(buildDir) ? output.path.slice(buildDir.length + 1) : output.path;
    for (const miss of findUnresolvedHostAbiImports(await output.text(), rel)) {
      errors.push(
        `${miss.file}: import of "${miss.name}" from "${miss.specifier}" is not provided by the host ABI shim ${HOST_ABI_VENDOR_URLS[miss.specifier]}`,
      );
    }
  }
  if (errors.length) return { success: false, buildDir, errors };

  writeModeSourceStamp(modeDir);
  return { success: true, buildDir, errors: [] };
}

/** What a build records about the sources it was made from. */
const SOURCE_STAMP_FILE = "source-stamp.json";
/** Files a viewer bundle can be built from. Seeds, showcase images, tests and
 *  dependencies are not the viewer's sources; skill scripts can be (a viewer
 *  may import a script's pure module), so they count. */
const STAMP_SOURCES = new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs,cjs,css,json}");
const STAMP_EXCLUDED = ["node_modules/", ".build/", "seed/", "showcase/", "__tests__/"];

/**
 * A content hash of a mode's viewer sources — path and bytes of every file a
 * bundle can be built from, in path order. Content, not modification times:
 * an archive extracted on another machine hashes the same as the tree it was
 * packed from.
 */
export function modeSourceStamp(modeDir: string): string {
  const hash = createHash("sha256");
  const files = [...STAMP_SOURCES.scanSync({ cwd: modeDir, absolute: false })]
    .map((rel) => rel.split("\\").join("/"))
    .filter((rel) => !STAMP_EXCLUDED.some((prefix) => rel.startsWith(prefix)))
    .sort();
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(join(modeDir, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Record in `<modeDir>/.build/` which sources the bundle there was built from. */
export function writeModeSourceStamp(modeDir: string): void {
  writeFileSync(
    join(modeDir, ".build", SOURCE_STAMP_FILE),
    `${JSON.stringify({ version: 1, sources: modeSourceStamp(modeDir) })}\n`,
  );
}

export type PrebuiltViewerReason = "current" | "stale" | "published" | "unstamped-in-tree" | "missing";

/**
 * Whether `<modeDir>/.build/pneuma-mode.js` may be served as it is.
 *
 * `buildModeViewer` writes the same directory a published archive ships, so
 * a bundle there is either the publish step's or an earlier local compile's.
 * It is reused when its stamp matches the sources beside it (`current`), or
 * — with no stamp at all — when the mode lives outside the project tree,
 * where only an installed archive could have put it (`published`; archives
 * packed before stamps existed carry none, and cannot be rebuilt without the
 * dependencies they inlined). A stamp that no longer matches (`stale`), or an
 * unstamped bundle inside the checkout (`unstamped-in-tree`, a compile from
 * before stamps), is built again from source.
 */
export function prebuiltViewer(
  modeDir: string,
  options: { projectRoot?: string } = {},
): { reuse: boolean; reason: PrebuiltViewerReason } {
  const buildDir = join(modeDir, ".build");
  if (!existsSync(join(buildDir, "pneuma-mode.js"))) return { reuse: false, reason: "missing" };
  const stampPath = join(buildDir, SOURCE_STAMP_FILE);
  if (existsSync(stampPath)) {
    let recorded: unknown = null;
    try {
      recorded = JSON.parse(readFileSync(stampPath, "utf-8"))?.sources;
    } catch {
      recorded = null;
    }
    return recorded === modeSourceStamp(modeDir)
      ? { reuse: true, reason: "current" }
      : { reuse: false, reason: "stale" };
  }
  const inTree = isInside(realpathOr(resolve(modeDir)), realpathOr(resolve(options.projectRoot ?? PROJECT_ROOT)));
  return inTree ? { reuse: false, reason: "unstamped-in-tree" } : { reuse: true, reason: "published" };
}

/**
 * Remove .build/ directory from a mode workspace.
 */
export function cleanModeBuild(modeDir: string): void {
  const buildDir = join(modeDir, ".build");
  if (existsSync(buildDir)) {
    rmSync(buildDir, { recursive: true, force: true });
  }
}
