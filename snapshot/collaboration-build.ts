import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build as viteBuild } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { bundledModeNames, inTreeModeDir, listCatalogModeNames } from "../core/mode-catalog.js";
import type { ModeManifest } from "../core/types/mode-manifest.js";
import type { ModePublicationAdapter } from "../core/types/collaboration-publication.js";
import type { CollaborationViewerAsset, CollaborationViewerCatalog } from "../core/types/collaboration-session.js";
import { buildModeViewer, HOST_ABI_VENDOR_SHIMS, hostAbiImportMap } from "./mode-build.js";

export interface CollaborationAssetFile { path: string; size: number; sha256: string }
export interface CollaborationAssetManifest extends CollaborationViewerCatalog {
  entry: string;
  styles: string[];
  runtime: string[];
  files: CollaborationAssetFile[];
  /** Compatibility for the isolated lab, supplied explicitly by its wrapper. */
  modeVersion?: string;
  frameScriptUrl?: string;
}
export interface CollaborationBuildOptions {
  projectRoot?: string;
  directory?: string;
  /** Repo-relative public shell entry; it must never import private Session state. */
  entry?: string;
  legacyFrame?: { mode: string; version: string; script: string };
}
const PROJECT_ROOT = resolve(import.meta.dir, "..");
const safeSegment = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(value);
const hash = (value: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const comparePaths = (a: { path: string }, b: { path: string }) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

async function inventory(directory: string): Promise<CollaborationAssetFile[]> {
  const paths = Array.from(new Bun.Glob("**/*").scanSync({ cwd: directory, onlyFiles: true })).sort();
  return Promise.all(paths.map(async (path) => { const bytes = await Bun.file(join(directory, path)).bytes(); return { path, size: bytes.byteLength, sha256: hash(bytes) }; }));
}

async function loadSource<T>(path: string): Promise<T> {
  const digest = hash(await Bun.file(path).bytes());
  return (await import(`${path}?build=${digest}`)).default as T;
}

function publicationModule(modeDir: string, module: string): string {
  if (!module || module.startsWith("/") || module.includes("\\") || module.split("/").some((part) => !part || part.startsWith("."))) throw new Error("Invalid mode publication module path");
  const root = realpathSync(modeDir);
  const path = realpathSync(join(modeDir, module));
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Mode publication module leaves its package");
  return path;
}

/** Shared LAN/cloud assembly. Mode semantics come only from manifest declarations. */
export async function buildCollaborationAssets(options: CollaborationBuildOptions = {}): Promise<{ directory: string; catalog: CollaborationViewerCatalog; manifest: CollaborationAssetManifest }> {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const directory = resolve(options.directory ?? join(projectRoot, "dist", "collaboration"));
  if (directory === projectRoot || directory === dirname(directory)) throw new Error("Invalid collaboration output directory");
  const coreVersion = (await Bun.file(join(projectRoot, "package.json")).json()).version as string;
  if (!safeSegment(coreVersion)) throw new Error("Invalid core version for public assets");
  mkdirSync(dirname(directory), { recursive: true });
  const staging = mkdtempSync(join(dirname(directory), ".collaboration-build-"));
  const publicStage = mkdtempSync(join(tmpdir(), "collaboration-fonts-"));
  let backup: string | null = null;
  try {
    const fontSource = join(projectRoot, "public", "fonts");
    const fontFiles = existsSync(fontSource) ? await inventory(fontSource) : [];
    const fontRoot = `/assets/fonts-v${coreVersion}/${hash(JSON.stringify(fontFiles))}`;
    if (fontFiles.length) cpSync(fontSource, join(publicStage, "fonts"), { recursive: true });
    const output = await viteBuild({
      configFile: false, root: projectRoot, publicDir: publicStage, logLevel: "error",
      plugins: [react(), tailwindcss()],
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      esbuild: { jsx: "automatic" },
      experimental: { renderBuiltUrl(filename, context) {
        if (context.type === "public" && filename.startsWith("fonts/")) return `${fontRoot}/${filename.slice(6)}`;
        return { relative: false };
      } },
      build: { outDir: staging, emptyOutDir: true, target: "es2022", minify: "esbuild",
        rollupOptions: { input: { collaboration: resolve(projectRoot, options.entry ?? "src/collaboration/main.tsx") },
          output: { entryFileNames: `assets/app-v${coreVersion}/[name]-[hash].js`, chunkFileNames: `assets/runtime-v${coreVersion}/[name]-[hash].js`, assetFileNames: `assets/app-v${coreVersion}/[name]-[hash][extname]` } } },
    });
    if (Array.isArray(output) || !("output" in output)) throw new Error("Unexpected collaboration shell build result");
    const entry = output.output.find((asset) => asset.type === "chunk" && asset.isEntry);
    if (!entry) throw new Error("The public shell has no entry asset");
    if (fontFiles.length) {
      cpSync(fontSource, join(staging, fontRoot.slice(1)), { recursive: true });
      rmSync(join(staging, "fonts"), { recursive: true, force: true });
    }

    const shims = Object.entries(HOST_ABI_VENDOR_SHIMS).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const hostRoot = `/assets/host-v${coreVersion}/${hash(JSON.stringify(shims.map(([path, source]) => ({ path, sha256: hash(source) }))))}`;
    const importMap = hostAbiImportMap();
    for (const [path, source] of shims) await Bun.write(join(staging, hostRoot.slice(1), path.slice("/vendor/".length)), source);
    for (const [specifier, url] of Object.entries(importMap.imports)) importMap.imports[specifier] = `${hostRoot}/${url.slice("/vendor/".length)}`;

    const modes: CollaborationViewerAsset[] = [];
    const names = Array.from(new Set([...bundledModeNames({ projectRoot }), ...listCatalogModeNames({ projectRoot })])).sort();
    for (const name of names) {
      const modeDir = inTreeModeDir(name, { projectRoot });
      if (!modeDir) continue;
      const manifest = await loadSource<ModeManifest>(join(modeDir, "manifest.ts"));
      const declaration = manifest.viewerApi?.collaboration;
      if (!declaration) continue;
      if (!safeSegment(manifest.name) || !safeSegment(manifest.version)) throw new Error(`Invalid mode asset identity: ${name}`);
      const publication = await loadSource<ModePublicationAdapter>(publicationModule(modeDir, declaration.publication.module));
      if (publication.schema !== declaration.publication.schema || typeof publication.project !== "function") throw new Error(`Invalid publication adapter for ${manifest.name}`);
      if (publication.frameScript !== undefined && typeof publication.frameScript !== "string") throw new Error(`Invalid page instrumentation for ${manifest.name}`);
      const built = await buildModeViewer(modeDir, { projectRoot });
      if (!built.success) throw new Error(`${manifest.name} viewer build failed: ${built.errors.join("; ")}`);
      const compiled = (await inventory(built.buildDir)).filter((file) => file.path !== "source-stamp.json" && !file.path.startsWith("."));
      if (!compiled.some((file) => file.path === "pneuma-mode.js")) throw new Error(`${manifest.name} has no compiled viewer entry`);
      const artifact = [...compiled, ...(publication.frameScript ? [{ path: "page-runtime.js", size: new TextEncoder().encode(publication.frameScript).byteLength, sha256: hash(publication.frameScript) }] : [])].sort(comparePaths);
      if (new Set(artifact.map((file) => file.path)).size !== artifact.length) throw new Error(`${manifest.name} page runtime conflicts with a compiled viewer asset`);
      const viewerHash = hash(JSON.stringify(artifact));
      const assetRoot = `/viewer/${manifest.name}/v${manifest.version}/${viewerHash}`;
      for (const file of compiled) await Bun.write(join(staging, assetRoot.slice(1), file.path), Bun.file(join(built.buildDir, file.path)));
      if (publication.frameScript) await Bun.write(join(staging, assetRoot.slice(1), "page-runtime.js"), publication.frameScript);
      modes.push({ mode: manifest.name, coreVersion, modeVersion: manifest.version, viewerHash,
        publicationSchema: declaration.publication.schema, entry: `${assetRoot}/pneuma-mode.js`,
        styles: compiled.filter((file) => file.path.endsWith(".css")).map((file) => `${assetRoot}/${file.path}`),
        ...(publication.frameScript ? { frameScriptUrl: `${assetRoot}/page-runtime.js` } : {}) });
    }

    const styles = output.output.filter((file) => file.fileName.endsWith(".css")).map((file) => `/${file.fileName}`);
    const runtime = output.output.filter((file) => file.type === "chunk" && !file.isEntry).map((file) => `/${file.fileName}`);
    const manifest: CollaborationAssetManifest = { coreVersion, modes, entry: `/${entry.fileName}`, styles, runtime, files: [] };
    if (options.legacyFrame) {
      const legacy = options.legacyFrame;
      if (!safeSegment(legacy.mode) || !safeSegment(legacy.version)) throw new Error("Invalid legacy frame identity");
      manifest.modeVersion = legacy.version;
      manifest.frameScriptUrl = `/viewer/${legacy.mode}/v${legacy.version}/${hash(legacy.script)}/frame.js`;
      await Bun.write(join(staging, manifest.frameScriptUrl.slice(1)), legacy.script);
    }
    manifest.files = await inventory(staging);
    await Bun.write(join(staging, "viewer-manifest.json"), JSON.stringify(manifest, null, 2));
    const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Pneuma · Shared workspace</title><script type="importmap">${JSON.stringify(importMap)}</script>${styles.map((path) => `<link rel="stylesheet" href="${path}">`).join("")}${runtime.map((path) => `<link rel="modulepreload" href="${path}">`).join("")}</head><body><div id="root"></div><script type="module" src="${manifest.entry}"></script></body></html>`;
    await Bun.write(join(staging, "index.html"), html);
    await Bun.write(join(staging, "_headers"), "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/viewer/*\n  Cache-Control: public, max-age=31536000, immutable\n/\n  Cache-Control: no-cache\n/viewer-manifest.json\n  Cache-Control: no-cache\n");
    if (existsSync(directory)) { backup = `${staging}-previous`; renameSync(directory, backup); }
    try { renameSync(staging, directory); }
    catch (error) { if (backup) renameSync(backup, directory); backup = null; throw error; }
    if (backup) rmSync(backup, { recursive: true, force: true });
    return { directory, catalog: { coreVersion, modes }, manifest };
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(publicStage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const result = await buildCollaborationAssets();
  console.log(`Built collaboration assets in ${result.directory} (${result.catalog.modes.length} supported modes)`);
}
