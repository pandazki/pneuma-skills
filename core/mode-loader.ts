/**
 * Mode Loader — resolve and load Modes.
 *
 * Two registries:
 * - builtin: the bundled modes (`modes/distribution.json`), statically
 *   imported from `modes/` so they ship inside the app bundle
 * - external: everything registered at runtime by absolute path — local
 *   paths, GitHub clones, and CATALOG modes, which a release downloads to
 *   `~/.pneuma/catalog/<name>/` and a repo checkout serves from
 *   `modes/<name>/` source (see `core/mode-catalog.ts`)
 *
 * This module stays free of `node:fs` on purpose: the browser imports it.
 * Path decisions belong to `core/mode-catalog.ts` / `core/mode-resolver.ts`,
 * which hand the result here through `registerExternalMode`.
 *
 * Core flow: resolveMode → ensureInstalled → loadFromSource
 */

import type { ModeManifest } from "./types/mode-manifest.js";
import type { ModeDefinition } from "./types/mode-definition.js";

/**
 * Mode source type:
 * - "builtin" — built-in mode, dynamically imported from the modes/ directory
 * - "external" — external mode, dynamically imported from an absolute path (local path or github clone)
 */
type ModeSource =
  | {
      type: "builtin";
      manifestLoader: () => Promise<ModeManifest>;
      definitionLoader: () => Promise<ModeDefinition>;
    }
  | {
      type: "external";
      name: string;
      path: string;
      manifestLoader: () => Promise<ModeManifest>;
      definitionLoader: () => Promise<ModeDefinition>;
    };

/**
 * Built-in mode registry — the BUNDLED set from `modes/distribution.json`,
 * and nothing else.
 *
 * The static `import()` specifiers are what make a mode part of the app
 * bundle: Vite follows every one of them, so a mode listed here ships its
 * viewer inside `dist/`. Catalog modes are deliberately absent — they are
 * registered through `registerExternalMode()` from the mode directory the
 * catalog resolved (in-tree source in a repo checkout, `~/.pneuma/catalog/`
 * in a release), which is the same code path in dev and in production.
 *
 * Keep this list equal to `distribution.json`'s `bundled` minus `_shared`
 * (a shared asset directory, not a mode). `core/__tests__/mode-loader.test.ts`
 * fails if the two drift.
 */
const builtinModes: Record<string, ModeSource> = {
  cosmos: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/cosmos/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/cosmos/pneuma-mode.js").then((m) => m.default),
  },
  diagram: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/diagram/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/diagram/pneuma-mode.js").then((m) => m.default),
  },
  evolve: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/evolve/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/evolve/pneuma-mode.js").then((m) => m.default),
  },
  illustrate: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/illustrate/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/illustrate/pneuma-mode.js").then((m) => m.default),
  },
  kami: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/kami/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/kami/pneuma-mode.js").then((m) => m.default),
  },
  "project-evolve": {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/project-evolve/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/project-evolve/pneuma-mode.js").then((m) => m.default),
  },
  "project-onboard": {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/project-onboard/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/project-onboard/pneuma-mode.js").then((m) => m.default),
  },
  "project-tidy": {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/project-tidy/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/project-tidy/pneuma-mode.js").then((m) => m.default),
  },
  remotion: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/remotion/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/remotion/pneuma-mode.js").then((m) => m.default),
  },
  slide: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/slide/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/slide/pneuma-mode.js").then((m) => m.default),
  },
  webcraft: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/webcraft/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/webcraft/pneuma-mode.js").then((m) => m.default),
  },
};

/** External mode registry — registered by the CLI at startup via registerExternalMode */
const externalModes: Record<string, ModeSource> = {};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a Mode's full definition (manifest + viewer).
 * Used by the frontend — requires PreviewComponent.
 */
export async function loadMode(name: string): Promise<ModeDefinition> {
  const source = resolveMode(name);
  await ensureInstalled(source);
  return loadDefinition(source);
}

/**
 * Load only the Mode's manifest (without React components).
 * Used by the backend — only needs config information.
 */
export async function loadModeManifest(name: string): Promise<ModeManifest> {
  const source = resolveMode(name);
  await ensureInstalled(source);
  return source.manifestLoader();
}

/**
 * List all registered mode names (including builtin and registered external).
 */
export function listModes(): string[] {
  return [...Object.keys(builtinModes), ...Object.keys(externalModes)];
}

/**
 * List built-in mode names.
 */
export function listBuiltinModes(): string[] {
  return Object.keys(builtinModes);
}

/**
 * Register an external mode (called by the CLI at startup).
 *
 * Backend context (Bun): uses import() with absolute path.
 * Frontend context (browser/Vite): uses /@fs/ URL.
 *
 * @param name — Mode name (for registration and lookup)
 * @param absPath — Absolute path to the Mode package
 */
export function registerExternalMode(name: string, absPath: string): void {
  const isBrowser = typeof window !== "undefined";

  if (isBrowser) {
    const isDev = import.meta.env?.DEV;

    if (isDev) {
      // Dev mode: use Vite's /@fs/ URL scheme
      externalModes[name] = {
        type: "external",
        name,
        path: absPath,
        manifestLoader: () =>
          import(/* @vite-ignore */ `/@fs${absPath}/manifest.ts`).then(
            (m) => m.default,
          ),
        definitionLoader: () =>
          import(/* @vite-ignore */ `/@fs${absPath}/pneuma-mode.ts`).then(
            (m) => m.default,
          ),
      };
    } else {
      // Production: use pre-compiled bundle served at /mode-assets/
      externalModes[name] = {
        type: "external",
        name,
        path: absPath,
        manifestLoader: () => {
          // Runtime virtual module served by the dev/prod server; not resolvable by tsc.
          const virtual = "/mode-assets/manifest.js";
          return import(/* @vite-ignore */ virtual).then((m) => m.default);
        },
        definitionLoader: () => {
          const virtual = "/mode-assets/pneuma-mode.js";
          return import(/* @vite-ignore */ virtual).then((m) => m.default);
        },
      };
    }
  } else {
    // Backend (Bun): use direct absolute path import
    externalModes[name] = {
      type: "external",
      name,
      path: absPath,
      manifestLoader: () =>
        import(/* @vite-ignore */ absPath + "/manifest.ts").then((m) => m.default),
      definitionLoader: () =>
        import(/* @vite-ignore */ absPath + "/pneuma-mode.ts").then((m) => m.default),
    };
  }
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** Resolve mode source (checks builtin and external registries) */
function resolveMode(name: string): ModeSource {
  // Check external modes first (allows overriding builtin names)
  const external = externalModes[name];
  if (external) return external;

  const builtin = builtinModes[name];
  if (builtin) return builtin;

  const available = listModes();
  throw new Error(
    `Unknown mode: "${name}". Available: ${available.join(", ")}`,
  );
}

/** Ensure mode is installed (builtin skips directly, external already handled by mode-resolver) */
async function ensureInstalled(_source: ModeSource): Promise<void> {
  // Both builtin and external modes are already resolved to local paths
  return;
}

/** Load full ModeDefinition from an installed source */
async function loadDefinition(source: ModeSource): Promise<ModeDefinition> {
  return source.definitionLoader();
}
