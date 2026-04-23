/**
 * Mode Loader — resolve, install, and load Modes.
 *
 * Supports three sources:
 * - builtin: built-in modes, dynamically imported from the modes/ directory
 * - local: local filesystem path
 * - github: GitHub repository (cloned to local cache via mode-resolver)
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

/** Built-in mode registry — all use dynamic import */
const builtinModes: Record<string, ModeSource> = {
  doc: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/doc/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/doc/pneuma-mode.js").then((m) => m.default),
  },
  slide: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/slide/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/slide/pneuma-mode.js").then((m) => m.default),
  },
  draw: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/draw/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/draw/pneuma-mode.js").then((m) => m.default),
  },
  "mode-maker": {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/mode-maker/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/mode-maker/pneuma-mode.js").then((m) => m.default),
  },
  evolve: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/evolve/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/evolve/pneuma-mode.js").then((m) => m.default),
  },
  webcraft: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/webcraft/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/webcraft/pneuma-mode.js").then((m) => m.default),
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
  remotion: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/remotion/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/remotion/pneuma-mode.js").then((m) => m.default),
  },
  gridboard: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/gridboard/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/gridboard/pneuma-mode.js").then((m) => m.default),
  },
  diagram: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/diagram/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/diagram/pneuma-mode.js").then((m) => m.default),
  },
  "clipcraft-legacy": {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/clipcraft-legacy/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/clipcraft-legacy/pneuma-mode.js").then((m) => m.default),
  },
  clipcraft: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/clipcraft/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/clipcraft/pneuma-mode.js").then((m) => m.default),
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
        manifestLoader: () =>
          import(/* @vite-ignore */ `/mode-assets/manifest.js`).then(
            (m) => m.default,
          ),
        definitionLoader: () =>
          import(/* @vite-ignore */ `/mode-assets/pneuma-mode.js`).then(
            (m) => m.default,
          ),
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
