// server/share.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
}

const R2_CONFIG_PATH = join(homedir(), ".pneuma", "r2.json");

export function getR2Config(): R2Config | null {
  try {
    return JSON.parse(readFileSync(R2_CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveR2Config(config: R2Config): void {
  const dir = join(homedir(), ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(R2_CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function isR2Configured(): boolean {
  return getR2Config() !== null;
}

// --- API Keys (stored at ~/.pneuma/api-keys.json, values obfuscated) ---

const API_KEYS_PATH = join(homedir(), ".pneuma", "api-keys.json");

// Simple obfuscation — not cryptographic security, but prevents casual exposure
// Uses a machine-stable key derived from homedir path
function getObfuscationKey(): number {
  const seed = homedir();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function obfuscate(value: string): string {
  const key = getObfuscationKey();
  const encoded = Buffer.from(value, "utf-8");
  for (let i = 0; i < encoded.length; i++) {
    encoded[i] = encoded[i] ^ ((key >> (i % 4) * 8) & 0xff);
  }
  return encoded.toString("base64");
}

function deobfuscate(value: string): string {
  const key = getObfuscationKey();
  const decoded = Buffer.from(value, "base64");
  for (let i = 0; i < decoded.length; i++) {
    decoded[i] = decoded[i] ^ ((key >> (i % 4) * 8) & 0xff);
  }
  return decoded.toString("utf-8");
}

export function getApiKeys(): Record<string, string> {
  try {
    const data = JSON.parse(readFileSync(API_KEYS_PATH, "utf-8"));
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(data)) {
      try {
        result[name] = deobfuscate(value as string);
      } catch {
        result[name] = value as string; // fallback for unobfuscated legacy values
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function saveApiKeys(keys: Record<string, string>): void {
  const dir = join(homedir(), ".pneuma");
  mkdirSync(dir, { recursive: true });
  const obfuscated: Record<string, string> = {};
  for (const [name, value] of Object.entries(keys)) {
    obfuscated[name] = obfuscate(value);
  }
  writeFileSync(API_KEYS_PATH, JSON.stringify(obfuscated, null, 2));
}

async function uploadToR2(filePath: string, key: string, config: R2Config): Promise<string> {
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  const client = new Bun.S3Client({
    endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
  });
  const file = Bun.file(filePath);
  const body = await file.arrayBuffer();
  const s3File = client.file(key);
  await s3File.write(body, { type: "application/gzip" });
  return `${config.publicUrl}/${key}`;
}

/** Share Result — just workspace files, no history */
export async function shareResult(workspace: string, title?: string): Promise<{ url: string }> {
  const config = getR2Config();
  if (!config) throw new Error("R2 not configured. Please configure R2 credentials first.");

  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const name = basename(workspace);
  const archiveName = `result-${name}-${timestamp}.tar.gz`;
  const archivePath = join(tmpdir(), archiveName);

  // Create tar.gz of workspace files (excluding .pneuma, node_modules, .git, etc.)
  const excludes = [".pneuma", "node_modules", ".git", ".claude", ".agents", "dist", ".DS_Store", ".env"];
  const excludeFlags = excludes.flatMap((e) => ["--exclude", e]);
  await Bun.spawn(
    ["tar", "czf", archivePath, "-C", workspace, ...excludeFlags, "."],
    { stdout: "ignore", stderr: "ignore" },
  ).exited;

  // Read session metadata for mode info
  let mode = "unknown";
  try {
    const session = JSON.parse(readFileSync(join(workspace, ".pneuma", "session.json"), "utf-8"));
    mode = session.mode;
  } catch {}

  const key = `shares/${archiveName}`;
  const url = await uploadToR2(archivePath, key, config);

  // Upload metadata alongside
  const metaKey = `shares/${archiveName.replace(".tar.gz", ".meta.json")}`;
  const metaContent = JSON.stringify({
    type: "result",
    title: title ?? `${mode} result`,
    mode,
    workspace: name,
    createdAt: new Date().toISOString(),
    archiveUrl: url,
  });
  const s3Endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  const client = new Bun.S3Client({
    endpoint: s3Endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
  });
  await client.file(metaKey).write(metaContent, { type: "application/json" });

  // Cleanup
  try { const { unlinkSync } = await import("node:fs"); unlinkSync(archivePath); } catch {}

  return { url };
}

/** Share Process — history + checkpoints + git bundle */
export async function shareProcess(workspace: string, title?: string): Promise<{ url: string }> {
  const config = getR2Config();
  if (!config) throw new Error("R2 not configured. Please configure R2 credentials first.");

  // Use existing export + upload
  const { exportHistory } = await import("./history-export.js");

  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const name = basename(workspace);
  const archiveName = `process-${name}-${timestamp}.tar.gz`;
  const exportPath = join(tmpdir(), archiveName);

  await exportHistory(workspace, { output: exportPath, title });

  const key = `shares/${archiveName}`;
  const url = await uploadToR2(exportPath, key, config);

  // Upload metadata
  let mode = "unknown";
  try {
    const session = JSON.parse(readFileSync(join(workspace, ".pneuma", "session.json"), "utf-8"));
    mode = session.mode;
  } catch {}

  const metaKey = `shares/${archiveName.replace(".tar.gz", ".meta.json")}`;
  const metaContent = JSON.stringify({
    type: "process",
    title: title ?? `${mode} process`,
    mode,
    workspace: name,
    createdAt: new Date().toISOString(),
    archiveUrl: url,
  });
  const s3Endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  const client = new Bun.S3Client({
    endpoint: s3Endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
  });
  await client.file(metaKey).write(metaContent, { type: "application/json" });

  // Cleanup
  try { const { unlinkSync } = await import("node:fs"); unlinkSync(exportPath); } catch {}

  return { url };
}

/** Download a shared package from URL */
export async function downloadShare(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const archiveName = basename(new URL(url).pathname) || "share.tar.gz";
  const downloadPath = join(tmpdir(), archiveName);
  const data = await response.arrayBuffer();
  await Bun.write(downloadPath, data);
  return downloadPath;
}
