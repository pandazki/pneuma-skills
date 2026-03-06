/**
 * Mode Publish — archive and upload a mode package to R2.
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseManifestTs } from "../core/utils/manifest-parser.js";
import { createModeArchive } from "./archive.js";
import { buildModeForPublish, cleanModeBuild } from "./mode-build.js";
import { getCredentials, uploadToR2, uploadJsonToR2, checkR2KeyExists, updateRegistryIndex } from "./r2.js";

/** Valid mode name: lowercase letters, digits, hyphens; must start with a letter. */
const MODE_NAME_RE = /^[a-z][a-z0-9-]*$/;

/** Basic semver: major.minor.patch (no pre-release tags). */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/** R2 key for a mode archive. */
export function getModeArchiveKey(name: string, version: string): string {
  return `modes/${name}/${version}.tar.gz`;
}

/** R2 key for a mode's latest.json metadata. */
export function getModeLatestKey(name: string): string {
  return `modes/${name}/latest.json`;
}

/**
 * Read manifest.ts from a workspace and validate required fields.
 * Returns parsed manifest fields or throws with a descriptive error.
 */
export function readAndValidateManifest(workspace: string): {
  name: string;
  version: string;
  displayName: string;
  description?: string;
} {
  const manifestPath = join(workspace, "manifest.ts");
  if (!existsSync(manifestPath)) {
    throw new Error("manifest.ts not found in workspace. Is this a mode package?");
  }

  const content = readFileSync(manifestPath, "utf-8");
  const parsed = parseManifestTs(content);

  if (!parsed.name) {
    throw new Error("manifest.ts missing required field: name");
  }
  if (!parsed.version) {
    throw new Error("manifest.ts missing required field: version");
  }
  if (!parsed.displayName) {
    throw new Error("manifest.ts missing required field: displayName");
  }

  if (!MODE_NAME_RE.test(parsed.name)) {
    throw new Error(
      `Invalid mode name "${parsed.name}". Must match /^[a-z][a-z0-9-]*$/ (lowercase, start with letter).`,
    );
  }

  if (!SEMVER_RE.test(parsed.version)) {
    throw new Error(
      `Invalid version "${parsed.version}". Must be semver (e.g. 1.0.0). Pre-release tags not supported.`,
    );
  }

  return {
    name: parsed.name,
    version: parsed.version,
    displayName: parsed.displayName,
    description: parsed.description,
  };
}

export interface PublishOptions {
  force?: boolean;
}

/**
 * Publish a mode package to R2.
 */
export async function publishMode(workspace: string, options?: PublishOptions): Promise<void> {
  // 1. Read and validate manifest
  const manifest = readAndValidateManifest(workspace);
  console.log(`[mode-publish] Mode: ${manifest.displayName} (${manifest.name}@${manifest.version})`);

  // 2. Validate required files
  const pneumaModePath = join(workspace, "pneuma-mode.ts");
  if (!existsSync(pneumaModePath)) {
    throw new Error("pneuma-mode.ts not found. A valid mode package requires this file.");
  }

  // 3. Warn about missing recommended dirs
  const viewerDir = join(workspace, "viewer");
  const skillDir = join(workspace, "skill");
  if (!existsSync(viewerDir)) {
    console.warn("[mode-publish] Warning: viewer/ directory not found (recommended)");
  }
  if (!existsSync(skillDir)) {
    console.warn("[mode-publish] Warning: skill/ directory not found (recommended)");
  }

  // 4. Get R2 credentials
  const creds = await getCredentials();

  // 5. Check if version already exists
  const archiveKey = getModeArchiveKey(manifest.name, manifest.version);
  const exists = await checkR2KeyExists(archiveKey, creds);
  if (exists && !options?.force) {
    throw new Error(
      `Version ${manifest.version} already published for "${manifest.name}". ` +
      `Use --force to overwrite, or bump the version in manifest.ts.`,
    );
  }

  // 6. Pre-build viewer bundle (inlines third-party deps)
  console.log("[mode-publish] Building viewer bundle...");
  const buildResult = await buildModeForPublish(workspace);
  if (!buildResult.success) {
    throw new Error(
      `Viewer build failed:\n${buildResult.errors.join("\n")}`,
    );
  }
  console.log("[mode-publish] Viewer bundle compiled successfully");

  // 7. Create archive (includes .build/ with inlined deps)
  const archiveName = `${manifest.name}-${manifest.version}.tar.gz`;
  const archivePath = join(tmpdir(), archiveName);

  console.log("[mode-publish] Creating archive...");
  await createModeArchive(workspace, archivePath);

  // Clean .build/ from workspace after archive captures it
  cleanModeBuild(workspace);

  const file = Bun.file(archivePath);
  const sizeMB = (file.size / 1024 / 1024).toFixed(2);
  console.log(`[mode-publish] Archive size: ${sizeMB} MB`);

  // 8. Upload archive
  console.log("[mode-publish] Uploading archive...");
  const publicUrl = await uploadToR2(archivePath, archiveKey, creds);

  // 9. Upload latest.json
  const latestKey = getModeLatestKey(manifest.name);
  const latestData = {
    name: manifest.name,
    version: manifest.version,
    displayName: manifest.displayName,
    description: manifest.description,
    publishedAt: new Date().toISOString(),
  };
  await uploadJsonToR2(latestData, latestKey, creds);

  // 9.5. Update registry index
  await updateRegistryIndex(creds, {
    name: manifest.name,
    displayName: manifest.displayName,
    description: manifest.description,
    version: manifest.version,
    publishedAt: latestData.publishedAt,
    archiveUrl: publicUrl,
  });

  // 10. Cleanup temp file
  const { unlinkSync } = await import("node:fs");
  try { unlinkSync(archivePath); } catch {}

  // 11. Print result
  console.log(`\n[mode-publish] Published ${manifest.name}@${manifest.version}!`);
  console.log(`[mode-publish] URL: ${publicUrl}`);
  console.log(`\n  Run with:\n    bunx pneuma-skills ${publicUrl} --workspace ~/pneuma-projects/${manifest.name}-workspace`);
}
