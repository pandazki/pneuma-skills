import { realpathSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import type { CollaborationAssetFile } from "../../snapshot/collaboration-build.js";

const ASSET_LIMITS = { files: 512, fileBytes: 32 * 1024 * 1024, totalBytes: 128 * 1024 * 1024 };
const TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
};

/** All archive paths originate in generated public assets, never room resources. */
export function publicViewerAssetType(path: string): string | null {
  if (!/^(assets|viewer)\/[a-zA-Z0-9._/-]+$/.test(path)
    || path.split("/").some((part) => !part || part.startsWith("."))) return null;
  return TYPES[extname(path).toLowerCase()] ?? null;
}

/** Validate the complete output before the first external upload. */
export async function validatePublicViewerAssets(directory: string, manifest: unknown): Promise<(CollaborationAssetFile & { contentType: string })[]> {
  const files = manifest && typeof manifest === "object" ? (manifest as { files?: unknown }).files : null;
  if (!Array.isArray(files) || files.length === 0 || files.length > ASSET_LIMITS.files) throw new Error("Invalid viewer asset manifest");
  const seen = new Set<string>();
  let total = 0;
  const checked = files.map((file) => {
    const contentType = typeof file?.path === "string" ? publicViewerAssetType(file.path) : null;
    if (!contentType || seen.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > ASSET_LIMITS.fileBytes
      || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Only bounded generated public viewer assets can be archived");
    seen.add(file.path); total += file.size;
    if (total > ASSET_LIMITS.totalBytes) throw new Error("The viewer asset manifest exceeds the archive size limit");
    return { path: file.path as string, size: file.size as number, sha256: file.sha256 as string, contentType };
  });
  const root = realpathSync(directory);
  for (const file of checked) {
    const path = realpathSync(join(root, file.path));
    const contained = relative(root, path);
    if (contained === ".." || contained.startsWith("../") || contained.startsWith("..\\")) throw new Error("A viewer asset leaves its build directory");
    const built = Bun.file(path);
    if (built.size !== file.size) throw new Error(`Built asset differs from its manifest: ${file.path}`);
    const bytes = await built.bytes();
    if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`Built asset differs from its manifest: ${file.path}`);
  }
  return checked;
}

if (import.meta.main) {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
    bucket: { type: "string", default: "pneuma-collaboration-prototype" },
    "dry-run": { type: "boolean", default: false },
  } });
  const directory = join(import.meta.dir, "dist");
  const manifest = await Bun.file(join(directory, "viewer-manifest.json")).json();
  const files = await validatePublicViewerAssets(directory, manifest);
  for (const file of files) {
    console.log(`${values["dry-run"] ? "Would archive" : "Archiving"} ${file.path} (${file.size} bytes)`);
    if (values["dry-run"]) continue;
    const process = Bun.spawn([
      join(import.meta.dir, "node_modules/.bin/wrangler"), "r2", "object", "put",
      `${values.bucket}/public-viewer/${file.path}`, "--file", join(directory, file.path), "--remote",
      "--content-type", file.contentType, "--cache-control", "public, max-age=31536000, immutable",
    ], { cwd: import.meta.dir, stdout: "inherit", stderr: "inherit" });
    if (await process.exited !== 0) throw new Error(`Viewer asset archive failed: ${file.path}`);
  }
}
