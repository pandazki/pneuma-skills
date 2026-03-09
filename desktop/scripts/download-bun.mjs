#!/usr/bin/env node
/**
 * Download Bun binary for a target platform/arch.
 * Used during electron-builder packaging to bundle the correct Bun binary.
 *
 * Usage:
 *   node scripts/download-bun.mjs --platform darwin --arch arm64
 *   node scripts/download-bun.mjs --platform win32 --arch x64
 *   node scripts/download-bun.mjs --platform linux --arch x64
 *
 * Or auto-detect current platform:
 *   node scripts/download-bun.mjs
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const BUN_VERSION = "1.3.10";

// Parse args
const args = process.argv.slice(2);
let platform = process.platform;
let arch = process.arch;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--platform") platform = args[++i];
  if (args[i] === "--arch") arch = args[++i];
}

// Normalize platform names
const platformMap = {
  darwin: "darwin",
  mac: "darwin",
  win32: "windows",
  win: "windows",
  linux: "linux",
};

const archMap = {
  arm64: "aarch64",
  x64: "x64",
};

const bunPlatform = platformMap[platform];
const bunArch = archMap[arch];

if (!bunPlatform || !bunArch) {
  console.error(`Unsupported platform/arch: ${platform}/${arch}`);
  process.exit(1);
}

// electron-builder uses different platform names
const electronPlatform = {
  darwin: "darwin",
  windows: "win32",
  linux: "linux",
}[bunPlatform];

const targetDir = resolve(
  import.meta.dirname,
  "..",
  "resources",
  `bun-${electronPlatform}-${arch}`
);

// Skip if already downloaded
const bunBinaryName = bunPlatform === "windows" ? "bun.exe" : "bun";
const targetBinary = join(targetDir, bunBinaryName);

if (existsSync(targetBinary)) {
  console.log(`✓ Bun binary already exists at ${targetBinary}`);
  process.exit(0);
}

// Determine download URL
// Bun release naming: bun-{platform}-{arch}.zip
const archiveName =
  bunPlatform === "windows"
    ? `bun-windows-${bunArch}.zip`
    : `bun-${bunPlatform}-${bunArch}.zip`;

const downloadUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${archiveName}`;

console.log(`Downloading Bun v${BUN_VERSION} for ${bunPlatform}-${bunArch}...`);
console.log(`  URL: ${downloadUrl}`);

const tmpDir = join(tmpdir(), `bun-download-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });
mkdirSync(targetDir, { recursive: true });

try {
  const archivePath = join(tmpDir, archiveName);

  // Download
  execSync(`curl -fSL -o "${archivePath}" "${downloadUrl}"`, {
    stdio: "inherit",
  });

  // Extract
  if (archiveName.endsWith(".zip")) {
    execSync(`unzip -o "${archivePath}" -d "${tmpDir}"`, { stdio: "inherit" });
  }

  // Find the bun binary in extracted contents
  // Bun archives contain a directory like bun-darwin-aarch64/bun
  const extractedDir = join(
    tmpDir,
    `bun-${bunPlatform}-${bunArch}`
  );
  const extractedBinary = join(extractedDir, bunBinaryName);

  if (!existsSync(extractedBinary)) {
    throw new Error(`Binary not found at ${extractedBinary}`);
  }

  // Move to target
  renameSync(extractedBinary, targetBinary);

  // Make executable (Unix)
  if (bunPlatform !== "windows") {
    chmodSync(targetBinary, 0o755);
  }

  console.log(`✓ Bun binary installed to ${targetBinary}`);
} catch (err) {
  console.error(`✗ Failed to download Bun:`, err.message);
  process.exit(1);
} finally {
  // Cleanup
  try {
    execSync(`rm -rf "${tmpDir}"`);
  } catch {}
}
