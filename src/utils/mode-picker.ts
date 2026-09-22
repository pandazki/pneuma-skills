/**
 * The project panel's mode picker list, assembled from `/api/registry`.
 *
 * Pure and separate from the component because the assembly has a contract
 * with the server that a type alone does not catch: the registry reports a
 * catalog mode's install state as `state`, while every surface that renders
 * it calls the field `installState`. Getting that mapping wrong costs
 * nothing at compile time and silently turns every catalog mode into "not
 * installed", which then offers a download for a mode already on disk.
 *
 * ProjectPanel itself cannot be imported under `bun:test` (it transitively
 * touches `window` at module load), so this is where the rule is testable.
 */

import type { ModeInstallState } from "../../core/types/mode-catalog.js";

export interface ModeInfo {
  name: string;
  displayName?: string;
  description?: string;
  icon?: string;
  /**
   * Origin — needed to derive the favorites composite key so an evolved
   * local fork doesn't share a star with its builtin parent. ProjectPanel
   * dedupes its picker by name (builtins win), so in practice we only
   * see one entry per name today, but the key has to be stable across
   * surfaces — Quick Start, gallery, and this picker all read the same
   * favorites file. Builtins omit `path`; local + library modes carry
   * the absolute mode dir.
   */
  source: "builtin" | "local" | "catalog";
  path?: string;
  /**
   * Catalog modes only — where this machine stands relative to the archive
   * this release pins. `undefined` for a mode whose source is already here.
   */
  installState?: ModeInstallState;
  /** Catalog modes only — install size, quoted before the download starts. */
  unpackedSize?: number;
}

/** The three buckets of `/api/registry` this picker reads. */
export interface RegistryPayload {
  builtins?: Array<{ name: string; displayName?: string; description?: string; icon?: string }>;
  catalog?: Array<{
    name: string;
    displayName?: string;
    description?: string;
    icon?: string;
    /** `/api/registry` calls it `state`; every renderer calls it `installState`. */
    state?: ModeInstallState;
    unpackedSize?: number;
  }>;
  local?: Array<{
    name: string;
    displayName?: string;
    description?: string;
    icon?: string;
    path?: string;
  }>;
}

/**
 * Merge the buckets into one picker list, deduped by name in bucket order.
 *
 * Builtins win over catalog, and both win over local copies that share a
 * name. Catalog modes sit with the builtins because to the user they are the
 * same first-party list — the only difference is that opening one for the
 * first time downloads it. In a repo checkout the catalog bucket is empty
 * and every mode arrives as a builtin.
 */
export function mergeRegistryModes(reg: RegistryPayload): ModeInfo[] {
  const seen = new Set<string>();
  const merged: ModeInfo[] = [];

  for (const m of reg.builtins ?? []) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    merged.push({
      name: m.name,
      displayName: m.displayName,
      description: m.description,
      icon: m.icon,
      source: "builtin",
    });
  }
  for (const m of reg.catalog ?? []) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    merged.push({
      name: m.name,
      displayName: m.displayName,
      description: m.description,
      icon: m.icon,
      source: "catalog",
      installState: m.state,
      unpackedSize: m.unpackedSize,
    });
  }
  for (const m of reg.local ?? []) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    merged.push({
      name: m.name,
      displayName: m.displayName,
      description: m.description,
      icon: m.icon,
      source: "local",
      path: m.path,
    });
  }
  return merged;
}

/** True when picking this mode has to download it first. */
export function needsDownload(mode: ModeInfo): boolean {
  return mode.source === "catalog" && mode.installState !== "installed";
}
