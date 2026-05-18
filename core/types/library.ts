/**
 * Mode Library — distribute multiple modes through a single source.
 *
 * Today a `github:user/repo` specifier resolves to a single mode (one
 * `manifest.ts` at the repo root). A library lets one repo host N modes:
 * `pneuma mode add github:user/repo` clones once into
 * `~/.pneuma/libraries/<id>/`, and each contained mode is independently
 * activated / deactivated / updated.
 *
 * Two shapes are surfaced here:
 *
 * 1. **LibraryManifest** — the optional `pneuma.library.json` at the repo
 *    root. Authors use it to name the library + restrict / re-label which
 *    subdirs ship as modes. If absent, the resolver auto-scans immediate
 *    subdirs for `manifest.ts`.
 *
 * 2. **InstalledLibrary** — the `.library.json` sidecar Pneuma writes to
 *    `~/.pneuma/libraries/<id>/`. Records the source URL/ref, last-synced
 *    git sha, and per-mode activation + installed-version state so the
 *    launcher can show "N updates available" and update on demand.
 */

// ── Repo side: `pneuma.library.json` ────────────────────────────────────────

/** One entry in the repo-side library index. */
export interface LibraryModeEntry {
  /** Path to the mode directory, relative to the repo root. */
  path: string;
  /**
   * Optional override for the mode's installed name. Defaults to the
   * directory basename, which then defaults to the mode's manifest name.
   */
  name?: string;
}

/**
 * The `pneuma.library.json` file at the root of a multi-mode repo. Fully
 * optional — when absent, the resolver auto-scans immediate subdirs.
 */
export interface LibraryManifest {
  /** Schema version. Currently always 1. */
  version: 1;
  /** Library slug. Defaults to `<user>-<repo>` for github sources. */
  name: string;
  /** Human-readable display name shown in the launcher. */
  displayName?: string;
  /** Optional one-line description for the launcher card. */
  description?: string;
  /** Optional author handle (display only). */
  author?: string;
  /**
   * Pneuma runtime version range targeted by the library as a whole
   * (semver range, e.g. `"^3.8.0"`). Acts as fallback when a mode in the
   * library doesn't declare its own `pneumaVersion`. Optional — when
   * absent and no per-mode value either, the launcher treats compat as
   * "unknown" (renders the mode normally, no warning).
   */
  pneumaVersion?: string;
  /** Explicit list of modes to ship. Absence falls back to auto-scan. */
  modes?: LibraryModeEntry[];
}

// ── Local side: `.library.json` sidecar ─────────────────────────────────────

/** Discriminated union of where a library was installed from. */
export type LibrarySource =
  | {
      type: "github";
      /** Original specifier, e.g. `github:user/repo#branch` */
      url: string;
      /** Resolved git ref (branch / tag). Default "main". */
      ref: string;
    }
  | {
      type: "url";
      /** Tar.gz URL */
      url: string;
    }
  | {
      type: "local";
      /** Absolute path the library was linked from (rarely useful) */
      path: string;
    };

/** Per-mode state inside an installed library. */
export interface InstalledLibraryMode {
  /** Installed mode name (display + filesystem). */
  name: string;
  /** Relative path inside the library dir to the mode package. */
  path: string;
  /**
   * Manifest version observed on last sync. Used to detect updates
   * available since `installedVersion` was last accepted.
   */
  manifestVersion: string;
  /**
   * Pneuma runtime range declared in the mode's `manifest.ts.pneumaVersion`,
   * observed on last sync. Cached here so the launcher can render compat
   * state without re-parsing every manifest. Falls back to the parent
   * library's `pneumaVersion` (also cached on the InstalledLibrary).
   * Undefined when neither was declared.
   */
  pneumaVersion?: string;
  /**
   * Whether this mode is visible in the launcher / loadable via
   * `pneuma <name>`. Deactivated modes remain on disk so re-activation
   * is a zero-cost local flip.
   */
  activated: boolean;
  /**
   * Last manifest version the user explicitly accepted (mirrors the
   * existing skill-update dismiss flow). Equal to `manifestVersion`
   * after install/update; lags when an update is available but
   * unaccepted. `null` until first install.
   */
  installedVersion: string | null;
}

/** The `.library.json` sidecar Pneuma maintains. */
export interface InstalledLibrary {
  /** Schema version. Currently always 1. */
  version: 1;
  /** Stable library id. For github sources: `<user>-<repo>`. */
  id: string;
  /** Library slug from the repo manifest (or derived). */
  name: string;
  /** Optional display name (mirrors `LibraryManifest.displayName`). */
  displayName?: string;
  /** Optional description (mirrors `LibraryManifest.description`). */
  description?: string;
  /** Optional author handle (mirrors `LibraryManifest.author`). */
  author?: string;
  /**
   * Library-level Pneuma runtime range (mirrors `LibraryManifest.pneumaVersion`).
   * Used as fallback when a contained mode doesn't declare its own.
   */
  pneumaVersion?: string;
  /** Where this library was linked from. */
  source: LibrarySource;
  /**
   * Git sha (or content hash for non-git sources) observed on last sync.
   * Used to short-circuit "no-op" syncs and to feed the launcher's
   * "X updates available" surface.
   */
  sha: string | null;
  /** Unix ms timestamp of the last successful sync. */
  lastSync: number;
  /** Per-mode state. Order matches launcher display order. */
  modes: InstalledLibraryMode[];
}
