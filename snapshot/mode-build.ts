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
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
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
// in the browser (`SyntaxError: ... does not provide an export named 'x'`),
// so each shim re-exports the full surface of the module it stands in for —
// enumerated from the real package, not guessed.

const REACT_SHIM = `const R = window.__PNEUMA_REACT__;
export default R;
export const { useState, useEffect, useCallback, useMemo, useRef, useContext, createContext, forwardRef, memo, Fragment, createElement, cloneElement, Children, isValidElement, Component, PureComponent, Suspense, lazy, startTransition, useTransition, useDeferredValue, useId, useSyncExternalStore, useImperativeHandle, useLayoutEffect, useDebugValue, useReducer } = R;`;

// react-dom exports forwarded to published mode bundles. Keep in sync
// with what react-dom actually exports — missing an export here causes
// a runtime SyntaxError when a bundle imports it (since this shim is
// an ES module, any named import that isn't re-exported fails hard).
// unstable_batchedUpdates in particular is still pulled in by @dnd-kit
// and a few other deps; React 18+ auto-batches so a fallback identity
// shim is safe if the runtime ever stops providing it.
const REACT_DOM_SHIM = `const RD = window.__PNEUMA_REACT_DOM__;
export default RD;
export const { createPortal, flushSync, createRoot, hydrateRoot, version } = RD;
export const unstable_batchedUpdates = RD.unstable_batchedUpdates || ((fn, ...args) => fn(...args));`;

const JSX_RUNTIME_SHIM = `const J = window.__PNEUMA_JSX_RUNTIME__;
export const { jsx, jsxs, Fragment } = J;`;

// Bun.build uses jsx-dev-runtime (jsxDEV) due to a Bun v1.3+ regression.
// jsxDEV(type, props, key, isStatic, source, self) is signature-compatible
// with jsx(type, props, key) — extra dev args are simply ignored.
const JSX_DEV_RUNTIME_SHIM = `const J = window.__PNEUMA_JSX_RUNTIME__;
export const jsxDEV = J.jsx;
export const Fragment = J.Fragment;`;

// Host store shim — re-exports `useStore` from the HOST's single Zustand
// instance. Without this, Bun.build inlines the entire src/store.ts
// tree into every published mode bundle, and the mode ends up with its
// own parallel store that never talks to the host. The visible symptom
// is anything that crosses the mode/host boundary (activeContentSet,
// activeFile, selection) silently failing because writes go to the
// mode's bundled copy while the host reads from its own.
const PNEUMA_STORE_SHIM = `const S = window.__PNEUMA_STORE__;
if (!S) throw new Error("__PNEUMA_STORE__ not set — pneuma-skills host didn't expose useStore before loading the mode bundle");
export const useStore = S;
export default S;`;

// i18next — the host's *initialised* default instance. The named exports of
// the real package are bound to that same default instance, so they are
// forwarded as calls rather than destructured (an unbound `changeLanguage`
// would lose `this`).
const I18NEXT_SHIM = `const I = window.__PNEUMA_I18N__;
if (!I) throw new Error("__PNEUMA_I18N__ not set — pneuma-skills host didn't expose its i18next instance before loading the mode bundle");
const i18n = I.i18next;
export default i18n;
export const t = (...a) => i18n.t(...a);
export const changeLanguage = (...a) => i18n.changeLanguage(...a);
export const createInstance = (...a) => i18n.createInstance(...a);
export const dir = (...a) => i18n.dir(...a);
export const exists = (...a) => i18n.exists(...a);
export const getFixedT = (...a) => i18n.getFixedT(...a);
export const hasLoadedNamespace = (...a) => i18n.hasLoadedNamespace(...a);
export const init = (...a) => i18n.init(...a);
export const keyFromSelector = (...a) => i18n.keyFromSelector(...a);
export const loadLanguages = (...a) => i18n.loadLanguages(...a);
export const loadNamespaces = (...a) => i18n.loadNamespaces(...a);
export const loadResources = (...a) => i18n.loadResources(...a);
export const reloadResources = (...a) => i18n.reloadResources(...a);
export const setDefaultNamespace = (...a) => i18n.setDefaultNamespace(...a);
export const use = (...a) => i18n.use(...a);`;

// react-i18next — the host's module namespace, whose `initReactI18next` has
// already bound the instance above. Components and hooks carry no `this`, so
// destructuring the namespace is safe.
const REACT_I18NEXT_SHIM = `const I = window.__PNEUMA_I18N__;
if (!I || !I.reactI18next) throw new Error("__PNEUMA_I18N__.reactI18next not set — pneuma-skills host didn't expose react-i18next before loading the mode bundle");
const R = I.reactI18next;
export default R;
export const { I18nContext, I18nextProvider, IcuTrans, IcuTransWithoutContext, Trans, TransWithoutContext, Translation, composeInitialProps, date, getDefaults, getI18n, getInitialProps, initReactI18next, nodesToString, number, plural, select, selectOrdinal, setDefaults, setI18n, time, useSSR, useTranslation, withSSR, withTranslation } = R;`;

/** Vendor shim URL → ES module source. The server serves exactly these. */
export const HOST_ABI_VENDOR_SHIMS: Readonly<Record<string, string>> = {
  "/vendor/react.js": REACT_SHIM,
  "/vendor/react-dom.js": REACT_DOM_SHIM,
  "/vendor/react-jsx-runtime.js": JSX_RUNTIME_SHIM,
  "/vendor/react-jsx-dev-runtime.js": JSX_DEV_RUNTIME_SHIM,
  "/vendor/pneuma-store.js": PNEUMA_STORE_SHIM,
  "/vendor/i18n.js": I18NEXT_SHIM,
  "/vendor/react-i18n.js": REACT_I18NEXT_SHIM,
};

/** The importmap body the host injects so a bundle's bare specifiers resolve. */
export function hostAbiImportMap(): { imports: Record<string, string> } {
  return { imports: { ...HOST_ABI_VENDOR_URLS } };
}

// The checkout a mode is compiled against: its `src/` and `core/` are the
// sources a bundle inlines (everything but the host ABI), so the archive is
// self-contained and carries no machine-specific import paths.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

  return { success: true, buildDir, errors: [] };
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
