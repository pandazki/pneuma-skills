/**
 * R2 credential management and S3 client wrapper using Bun.S3Client.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import * as readline from "node:readline";
import type { R2Credentials } from "./types.js";

const CREDENTIALS_PATH = join(homedir(), ".pneuma", "r2.json");

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Load R2 credentials from ~/.pneuma/r2.json.
 * Returns null if not found.
 */
export function loadCredentials(): R2Credentials | null {
  try {
    const content = readFileSync(CREDENTIALS_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save R2 credentials to ~/.pneuma/r2.json.
 */
export function saveCredentials(creds: R2Credentials): void {
  const dir = join(homedir(), ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
  console.log(`[snapshot] Credentials saved to ${CREDENTIALS_PATH}`);
}

/**
 * Prompt the user for R2 credentials interactively.
 */
export async function promptCredentials(): Promise<R2Credentials> {
  console.log("[snapshot] R2 credentials not found. Please provide them:");
  const accountId = await ask("  Account ID: ");
  const accessKeyId = await ask("  Access Key ID: ");
  const secretAccessKey = await ask("  Secret Access Key: ");
  const bucket = await ask("  Bucket name [pneuma-playground]: ");
  const publicUrl = await ask("  Public URL (e.g. https://pub-xxx.r2.dev): ");

  const creds: R2Credentials = {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket: bucket || "pneuma-playground",
    publicUrl: publicUrl.replace(/\/$/, ""), // strip trailing slash
  };

  saveCredentials(creds);
  return creds;
}

/**
 * Load credentials or prompt if not found.
 */
export async function getCredentials(): Promise<R2Credentials> {
  const existing = loadCredentials();
  if (existing) return existing;
  return promptCredentials();
}

/**
 * Upload a file to R2 using Bun.S3Client.
 * Returns the public URL of the uploaded object.
 */
export async function uploadToR2(
  filePath: string,
  key: string,
  creds: R2Credentials,
): Promise<string> {
  const endpoint = `https://${creds.accountId}.r2.cloudflarestorage.com`;

  const client = new Bun.S3Client({
    endpoint,
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    bucket: creds.bucket,
  });

  const file = Bun.file(filePath);
  const body = await file.arrayBuffer();

  const s3File = client.file(key);
  await s3File.write(body, { type: "application/gzip" });

  return `${creds.publicUrl}/${key}`;
}

/**
 * List snapshot objects in R2.
 * Returns an array of { key, size, lastModified }.
 */
export async function listSnapshots(
  creds: R2Credentials,
): Promise<Array<{ key: string; size: number; lastModified: string }>> {
  // Use S3 ListObjectsV2 via fetch since Bun.S3Client doesn't expose list
  const endpoint = `https://${creds.accountId}.r2.cloudflarestorage.com`;

  // Sign a simple GET request for listing
  // We'll use the S3 REST API with query auth
  const url = `${endpoint}/${creds.bucket}?list-type=2&prefix=snapshots/`;

  // Use AWS Signature V4 — leverage Bun's built-in fetch with S3
  // Since Bun.S3Client doesn't have list, we do a manual S3 list via signed request
  const { S3Client: BunS3 } = await import("bun");

  // Alternative: use a raw HTTP request with AWS4 signing
  // For simplicity, parse the bucket contents using Bun.S3Client's presign or direct API
  // Actually, let's just use the @aws-sdk pattern with fetch + AWS4 signing

  // Simpler approach: spawn aws CLI or use a minimal signing implementation
  // For now, use a lightweight approach with Bun's native capabilities

  const response = await signedS3Request("GET", `/${creds.bucket}?list-type=2&prefix=snapshots/`, creds);
  const text = await response.text();

  // Parse XML response
  const results: Array<{ key: string; size: number; lastModified: string }> = [];
  const contentRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;
  while ((match = contentRegex.exec(text)) !== null) {
    const block = match[1];
    const key = block.match(/<Key>(.*?)<\/Key>/)?.[1] ?? "";
    const size = parseInt(block.match(/<Size>(.*?)<\/Size>/)?.[1] ?? "0", 10);
    const lastModified = block.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? "";
    results.push({ key, size, lastModified });
  }

  return results;
}

/**
 * Minimal AWS Signature V4 signed request for S3-compatible APIs.
 */
async function signedS3Request(
  method: string,
  path: string,
  creds: R2Credentials,
): Promise<Response> {
  const endpoint = `https://${creds.accountId}.r2.cloudflarestorage.com`;
  const url = `${endpoint}${path}`;

  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const region = "auto";
  const service = "s3";

  const host = `${creds.accountId}.r2.cloudflarestorage.com`;

  // Parse path and query
  const [canonicalPath, queryString] = path.split("?");
  const canonicalQueryString = (queryString ?? "")
    .split("&")
    .filter(Boolean)
    .sort()
    .join("&");

  const payloadHash = Bun.CryptoHasher.hash("sha256", "").toString("hex");

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    Bun.CryptoHasher.hash("sha256", canonicalRequest).toString("hex"),
  ].join("\n");

  // Derive signing key
  const hmac = (key: Uint8Array | string, data: string): Uint8Array => {
    const hasher = new Bun.CryptoHasher("sha256", typeof key === "string" ? new TextEncoder().encode(key) : key);
    hasher.update(data);
    return new Uint8Array(hasher.digest());
  };

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");

  const signatureHasher = new Bun.CryptoHasher("sha256", kSigning);
  signatureHasher.update(stringToSign);
  const signature = Buffer.from(signatureHasher.digest()).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method,
    headers: {
      Host: host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorization,
    },
  });
}
