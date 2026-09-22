/**
 * Mode Catalog — the contract between a released core and the modes it does
 * not ship.
 *
 * A *bundled* mode lives in the package (`modes/<name>/`, listed in
 * `modes/distribution.json`). A *catalog* mode leaves only its
 * `showcase/` images in the package plus one `ModeCatalogEntry` in the
 * generated `modes/catalog.json`, and is downloaded from the CDN the first
 * time it is used.
 *
 * Lockstep, and why: a catalog mode travels as a prebuilt viewer bundle that
 * inlines `core/` and `src/` helpers and depends on the host's shared React,
 * Zustand store and i18next instance, plus Tailwind utilities compiled into
 * the host's CSS. A bundle is therefore only valid on the core release that
 * built it. Every core release rebuilds and republishes every catalog mode,
 * and `modes/catalog.json` pins each archive by URL and SHA-256, so a running
 * core only ever loads bundles made from its own source.
 *
 * Design: docs/proposals/2026-09-22-mode-distribution.md
 */

import type { LocalizedString } from "./mode-manifest.js";

/** Bumped when the catalog or archive layout changes in a way readers must notice. */
export const MODE_CATALOG_FORMAT = 1;

/** Generated file inside the package, next to the mode directories. */
export const MODE_CATALOG_FILE = "catalog.json";

/** Written last inside an install directory; its presence means the install completed. */
export const MODE_INSTALL_RECORD = ".pneuma-install.json";

/** Stamp carried at the root of a published archive. */
export const MODE_PACKAGE_STAMP = "pneuma-package.json";

/** Where an archive lives and how to know it arrived intact. */
export interface ModeArchiveRef {
  /** Immutable CDN URL: `<base>/official/v<coreVersion>/<name>-<modeVersion>.tar.gz`. */
  url: string;
  /** Archive size in bytes — checked before and after the download. */
  size: number;
  /** SHA-256 of the archive bytes, lowercase hex. */
  sha256: string;
}

/**
 * One catalog mode as the launcher and the CLI see it before anything is
 * downloaded. `displayName`, `description` and `icon` are copied from the
 * mode's manifest at pack time — they are the "introduction" the card shows
 * next to the `showcase/` images that stayed in the package.
 */
export interface ModeCatalogEntry {
  name: string;
  /** The mode's own manifest version. */
  version: string;
  displayName: LocalizedString;
  description?: LocalizedString;
  /** Inline SVG from the manifest, for the card and the mode picker. */
  icon?: string;
  archive: ModeArchiveRef;
  /** Bytes on disk after extraction — what the card quotes as the install size. */
  unpackedSize: number;
}

/** The generated `modes/catalog.json`. Entry order is the launcher's order. */
export interface ModeCatalog {
  formatVersion: number;
  /** The pneuma-skills release that built every archive listed here. */
  coreVersion: string;
  generatedAt: string;
  modes: ModeCatalogEntry[];
}

/**
 * `.pneuma-install.json` inside an install directory. `sha256` is the archive
 * it came from, which is how a stale install (built for another core release)
 * is detected without trusting timestamps.
 */
export interface ModeInstallRecord {
  name: string;
  version: string;
  coreVersion: string;
  sha256: string;
  installedAt: string;
}

/** `pneuma-package.json` at the root of an archive. */
export interface ModePackageStamp {
  formatVersion: number;
  name: string;
  version: string;
  coreVersion: string;
  builtAt: string;
}

/** What a caller needs to know about a catalog mode's local state. */
export type ModeInstallState =
  /** Nothing on disk. */
  | "not-installed"
  /** Installed from the archive this core release pins. */
  | "installed"
  /** Installed, but from a different archive — a core upgrade happened. */
  | "stale";
