/**
 * Mode Build — compile a mode's viewer bundle for production distribution.
 *
 * Inlines all third-party dependencies so the published archive is self-contained.
 * React/React-DOM are marked external (provided by the host via vendor shims).
 */

import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

const EXTERNAL_MODULES = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];

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

  // 4. Bundle with Bun.build — inlines all deps except React
  const result = await Bun.build({
    entrypoints,
    outdir: buildDir,
    target: "browser",
    format: "esm",
    external: EXTERNAL_MODULES,
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
