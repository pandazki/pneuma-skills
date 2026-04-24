/**
 * Mode Build — compile a mode's viewer bundle for production distribution.
 *
 * Inlines all third-party dependencies so the published archive is self-contained.
 * React/React-DOM are marked external (provided by the host via vendor shims).
 */

import { join, resolve, dirname } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTERNAL_MODULES = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];

// `pneuma-skills/core/...` + `pneuma-skills/src/...` imports emitted by
// mode-maker's fork route get resolved back to this project's core/src
// directories at build time. The result is that the published bundle
// inlines the pneuma-skills sources it captured — the downstream archive
// is self-contained without carrying machine-specific import paths.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolvePneumaSkillsImport(specifier: string): string | null {
  if (!specifier.startsWith("pneuma-skills/")) return null;
  const rel = specifier.slice("pneuma-skills/".length);
  const candidate = join(PROJECT_ROOT, rel);
  if (existsSync(candidate)) return candidate;
  const dotIdx = candidate.lastIndexOf(".");
  if (dotIdx > candidate.lastIndexOf("/")) {
    const base = candidate.slice(0, dotIdx);
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
      if (existsSync(base + ext)) return base + ext;
    }
  }
  return null;
}

export interface ModeBuildResult {
  success: boolean;
  buildDir: string;
  errors: string[];
}

/**
 * Build a mode package for publish/distribution.
 *
 * 1. If package.json exists but node_modules is missing, runs `bun install`
 * 2. Deletes stale .build/ directory
 * 3. Runs Bun.build() to produce self-contained ESM bundles
 */
export async function buildModeForPublish(
  modeDir: string,
): Promise<ModeBuildResult> {
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

  // 4. Bundle with Bun.build — inlines all deps except React.
  //    The pneuma-skills plugin resolves `pneuma-skills/core/...` +
  //    `pneuma-skills/src/...` bare specifiers (emitted by the fork
  //    route) to this project's actual files.
  //    `throw: false` so Bun returns logs instead of throwing —
  //    otherwise the outer publish catch reports a useless "Bundle failed"
  //    with no detail about which import actually failed.
  const result = await Bun.build({
    entrypoints,
    outdir: buildDir,
    target: "browser",
    format: "esm",
    external: EXTERNAL_MODULES,
    throw: false,
    plugins: [
      {
        name: "pneuma-skills-resolver",
        setup(builder) {
          builder.onResolve({ filter: /^pneuma-skills\// }, (args) => {
            const resolved = resolvePneumaSkillsImport(args.path);
            if (resolved) return { path: resolved };
            return null;
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
