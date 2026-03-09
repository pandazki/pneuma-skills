#!/usr/bin/env node
/**
 * prepare-deps.mjs — Create a pruned node_modules with only production
 * dependencies for bundling into the Electron app.
 *
 * electron-builder bundles this as extraResources so the Bun server
 * process has the packages it needs at runtime without shipping
 * devDependencies (React, Vite, CodeMirror, Excalidraw, etc.).
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const projectRoot = resolve(desktopDir, "..");

// Read root package.json for production deps
const rootPkg = JSON.parse(
  await import("node:fs").then((fs) =>
    fs.readFileSync(resolve(projectRoot, "package.json"), "utf-8")
  )
);

const outputDir = resolve(desktopDir, "pneuma-node-modules");

// Sync version from root package.json into desktop package.json
const desktopPkgPath = resolve(desktopDir, "package.json");
const desktopPkg = JSON.parse(
  await import("node:fs").then((fs) =>
    fs.readFileSync(desktopPkgPath, "utf-8")
  )
);
if (desktopPkg.version !== rootPkg.version) {
  desktopPkg.version = rootPkg.version;
  writeFileSync(desktopPkgPath, JSON.stringify(desktopPkg, null, 2) + "\n");
  console.log(`Synced desktop version to ${rootPkg.version}`);
}

console.log("Preparing production dependencies...");
console.log("Production deps:", Object.keys(rootPkg.dependencies || {}).join(", "));

// Clean previous output
if (existsSync(outputDir)) {
  rmSync(outputDir, { recursive: true, force: true });
}

// Create a temp directory with only production deps
const tmpDir = resolve(desktopDir, ".tmp-prod-deps");
if (existsSync(tmpDir)) {
  rmSync(tmpDir, { recursive: true, force: true });
}
mkdirSync(tmpDir, { recursive: true });

// Write a minimal package.json with only production deps
writeFileSync(
  resolve(tmpDir, "package.json"),
  JSON.stringify(
    {
      name: "pneuma-prod-deps",
      version: "1.0.0",
      dependencies: rootPkg.dependencies,
    },
    null,
    2
  )
);

// Install only production deps
try {
  execSync("bun install", {
    cwd: tmpDir,
    stdio: "inherit",
  });
} catch (e) {
  console.error("Failed to install production dependencies:", e.message);
  process.exit(1);
}

// Move node_modules to output location
cpSync(resolve(tmpDir, "node_modules"), outputDir, { recursive: true });

// Clean up temp dir
rmSync(tmpDir, { recursive: true, force: true });

// Count packages
const entries = await import("node:fs").then((fs) =>
  fs.readdirSync(outputDir).filter((f) => !f.startsWith("."))
);
let count = 0;
for (const entry of entries) {
  if (entry.startsWith("@")) {
    const scoped = await import("node:fs").then((fs) =>
      fs.readdirSync(resolve(outputDir, entry))
    );
    count += scoped.length;
  } else {
    count++;
  }
}

console.log(`\nDone! ${count} packages in ${outputDir}`);
