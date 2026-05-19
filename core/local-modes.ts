/**
 * Enumerate locally-launchable modes — builtins shipped in the pneuma
 * package, user-installed externals in `~/.pneuma/modes/`, and modes
 * activated inside libraries under `~/.pneuma/libraries/<id>/`.
 *
 * Used by the `/handoff-pneuma` slash command's mode picker via the
 * `pneuma mode list --local --json` CLI. The launcher's `/api/registry`
 * route covers the same ground with extra UI-only fields (showcase,
 * compat, etc.); this helper is the boring filesystem-only subset that
 * lives outside any running pneuma session.
 *
 * Hidden modes (manifest `hidden: true`) are filtered out — the slash
 * command should never offer `evolve` / `project-onboard` etc.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { listBuiltinModes } from "./mode-loader.js";
import { parseManifestTs } from "./utils/manifest-parser.js";
import { listLibraries, getLibraryModePath } from "./library-registry.js";

export type LocalModeSource = "builtin" | "local" | "library";

export interface LocalModeEntry {
  /** Mode identifier — what the CLI accepts as `pneuma <name>`. */
  name: string;
  /** Human-readable label, falls back to `name`. */
  displayName: string;
  /** Optional one-line description from the manifest. */
  description?: string;
  /** Where the mode lives — builtin (in-package), local (~/.pneuma/modes), library. */
  source: LocalModeSource;
  /** Absolute install path (omitted for builtins). */
  path?: string;
  /** Library origin, when `source === "library"`. */
  library?: { id: string; name: string };
}

/**
 * Resolve the project root containing `modes/<name>/manifest.ts` for
 * builtins. Passing this in lets test/CLI callers point at a fixture tree
 * without depending on `import.meta.url` resolution from this file.
 */
export interface EnumerateOpts {
  /** Absolute path to the pneuma-skills package root (parent of `modes/`). */
  projectRoot: string;
  /** Locale for localized displayName/description fields. Defaults to `"en"`. */
  locale?: string;
  /** Home override (mainly for tests). Defaults to `os.homedir()`. */
  home?: string;
}

export function enumerateLocalModes(opts: EnumerateOpts): LocalModeEntry[] {
  const { projectRoot } = opts;
  const locale = opts.locale ?? "en";
  const home = opts.home ?? homedir();
  const out: LocalModeEntry[] = [];

  // 1. Builtins — read manifest.ts directly so we don't pay the cost of
  //    dynamic import + module init just to surface a display name.
  for (const name of listBuiltinModes()) {
    const manifestPath = join(projectRoot, "modes", name, "manifest.ts");
    let parsed: ReturnType<typeof parseManifestTs> = {};
    try {
      parsed = parseManifestTs(readFileSync(manifestPath, "utf-8"), locale);
    } catch {
      // tolerate: an unreadable builtin manifest is a packaging bug, but
      // the rest of the list should still surface.
    }
    if (parsed.hidden === true) continue;
    out.push({
      name,
      displayName: parsed.displayName || name,
      ...(parsed.description ? { description: parsed.description } : {}),
      source: "builtin",
    });
  }

  // 2. Local installs under ~/.pneuma/modes/. Mirrors the registry-route
  //    scanner so users see the same modes here as in the launcher.
  const modesDir = join(home, ".pneuma", "modes");
  if (existsSync(modesDir)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(modesDir);
    } catch {
      // unreadable dir → treat as empty
    }
    for (const entry of entries) {
      const entryPath = join(modesDir, entry);
      let isDir = false;
      try {
        isDir = statSync(entryPath).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      const manifestFile = ["manifest.ts", "manifest.js"].find((f) =>
        existsSync(join(entryPath, f)),
      );
      if (!manifestFile) continue;
      try {
        const parsed = parseManifestTs(
          readFileSync(join(entryPath, manifestFile), "utf-8"),
          locale,
        );
        if (parsed.hidden === true) continue;
        out.push({
          name: parsed.name || entry,
          displayName: parsed.displayName || entry,
          ...(parsed.description ? { description: parsed.description } : {}),
          source: "local",
          path: entryPath,
        });
      } catch {
        // skip malformed manifest
      }
    }
  }

  // 3. Library-activated modes. Same shape, plus a `library` tag so the
  //    slash command can show e.g. "alpha (from foo/bar)".
  try {
    for (const lib of listLibraries()) {
      for (const m of lib.modes) {
        if (!m.activated) continue;
        const abs = getLibraryModePath(lib.id, m.name);
        if (!abs) continue;
        let parsed: ReturnType<typeof parseManifestTs> = {};
        try {
          const manifestPath = ["manifest.ts", "manifest.js"]
            .map((f) => join(abs, f))
            .find((p) => existsSync(p));
          if (manifestPath) {
            parsed = parseManifestTs(readFileSync(manifestPath, "utf-8"), locale);
          }
        } catch {
          // tolerate; fall back to sidecar-recorded name
        }
        if (parsed.hidden === true) continue;
        out.push({
          name: parsed.name || m.name,
          displayName: parsed.displayName || m.name,
          ...(parsed.description ? { description: parsed.description } : {}),
          source: "library",
          path: abs,
          library: { id: lib.id, name: lib.name },
        });
      }
    }
  } catch {
    // a broken library subsystem shouldn't blank out builtins.
  }

  return out;
}
