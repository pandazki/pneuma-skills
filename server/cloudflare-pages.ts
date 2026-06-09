// server/cloudflare-pages.ts
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { resolveBinary, getEnrichedPath } from "./path-resolver.ts";

// --- Config ---

interface CfPagesConfig {
  apiToken: string;
  accountId: string;
  /** User-maintained base domains (e.g. "deepaste.ai"). At deploy time the
   *  user picks one and we attach `<project>.<domain>` to the Pages project
   *  via the CF API (wrangler can't manage custom domains). Empty → only the
   *  default `*.pages.dev` is offered. */
  customDomains?: string[];
}

const CF_CONFIG_PATH = join(homedir(), ".pneuma", "cloudflare-pages.json");

export function getCfPagesConfig(): CfPagesConfig | null {
  try {
    return JSON.parse(readFileSync(CF_CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveCfPagesConfig(config: CfPagesConfig): void {
  const dir = join(homedir(), ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(CF_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Normalize the free-text "Custom Domains" setting (one base domain per line
 * or comma-separated) into a clean, de-duped list of bare base domains. Strips
 * protocol, leading dots, trailing paths, and whitespace; lowercases; drops
 * blanks and the implicit `pages.dev` default.
 */
export function parseCustomDomains(raw: string): string[] {
  return Array.from(new Set(
    (raw ?? "")
      .split(/[\n,]/)
      .map((d) =>
        d.trim()
          .replace(/^https?:\/\//, "")
          .replace(/^\.+/, "")
          .replace(/\/.*$/, "")
          .toLowerCase(),
      )
      .filter((d) => d && d !== "pages.dev"),
  ));
}

// --- CLI Detection ---

interface CliStatus {
  installed: boolean;
  loggedIn: boolean;
}

export async function checkWranglerCli(): Promise<CliStatus> {
  try {
    const wranglerPath = resolveBinary("wrangler");
    if (!wranglerPath) return { installed: false, loggedIn: false };

    const env = { ...process.env, PATH: getEnrichedPath(), HOME: process.env.HOME || homedir() } as Record<string, string>;
    const whoami = Bun.spawn([wranglerPath, "whoami"], { stdout: "pipe", stderr: "pipe", env });
    const out = await new Response(whoami.stdout).text();
    const exit = await whoami.exited;
    // wrangler whoami prints account info if logged in
    return { installed: true, loggedIn: exit === 0 && !out.includes("not authenticated") };
  } catch {
    return { installed: false, loggedIn: false };
  }
}

// --- Unified Status ---

export interface CfPagesStatus {
  available: boolean;
  method: "cli" | "token" | null;
  /** Whether a usable API token + account id is configured. Custom-domain
   *  attachment needs the API (wrangler can't), so the deploy dialog only
   *  offers custom domains when this is true — even if the deploy itself
   *  goes through the wrangler CLI. */
  apiConfigured: boolean;
  /** Base domains the user configured; offered as deploy targets when
   *  `apiConfigured`. Always excludes the implicit default `pages.dev`. */
  customDomains: string[];
}

export async function getCfPagesStatus(): Promise<CfPagesStatus> {
  const config = getCfPagesConfig();
  const apiConfigured = !!(config?.apiToken && config?.accountId);
  const customDomains = apiConfigured ? (config?.customDomains ?? []) : [];

  const cli = await checkWranglerCli();
  if (cli.loggedIn) return { available: true, method: "cli", apiConfigured, customDomains };

  if (apiConfigured) {
    try {
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${config!.accountId}/pages/projects?per_page=1`,
        { headers: { Authorization: `Bearer ${config!.apiToken}` } },
      );
      if (resp.ok) return { available: true, method: "token", apiConfigured, customDomains };
    } catch { /* fall through */ }
  }

  return { available: false, method: null, apiConfigured, customDomains };
}

// --- Deploy ---

export interface CfDeployRequest {
  files: Array<{ path: string; content: string }>;
  projectName?: string;
  contentSet?: string;
  /** Base domain the user picked (e.g. "deepaste.ai"); we attach
   *  `<projectName>.<customDomain>` to the project. Omit / "" → pages.dev. */
  customDomain?: string;
}

export interface CfDeployResult {
  url: string;
  productionUrl: string;
  dashboardUrl: string;
  projectName: string;
  /** Echoes the base domain that was actually attached, when one was. */
  customDomain?: string;
  /** Set when a custom domain was requested but couldn't be attached; the
   *  deploy still succeeded and is served at pages.dev. */
  domainWarning?: string;
}

const CF_API = "https://api.cloudflare.com/client/v4";

/**
 * Find the Cloudflare zone that owns `hostname` among the zones this token can
 * see. Returns the most specific match (`{ id, name }`) or null when none of
 * the account's zones is a suffix of the hostname — which is exactly the
 * signal that the custom domain can't be auto-provisioned (its zone isn't in
 * this account), so the caller falls back to pages.dev with a warning.
 */
async function findZoneForHostname(
  config: CfPagesConfig,
  hostname: string,
): Promise<{ id: string; name: string } | null> {
  try {
    const resp = await fetch(`${CF_API}/zones?per_page=50`, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json().catch(() => ({}))) as { result?: Array<{ id: string; name: string }> };
    const zones = data.result ?? [];
    // Prefer the longest (most specific) zone name that the hostname sits under.
    const matches = zones
      .filter((z) => hostname === z.name || hostname.endsWith("." + z.name))
      .sort((a, b) => b.name.length - a.name.length);
    return matches[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Attach `<hostname>` as a custom domain on a Pages project. An already-attached
 * domain counts as success.
 */
async function attachProjectDomain(
  config: CfPagesConfig,
  project: string,
  hostname: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const resp = await fetch(
      `${CF_API}/accounts/${config.accountId}/pages/projects/${project}/domains`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: hostname }),
      },
    );
    if (resp.ok) return { ok: true };
    const err = (await resp.json().catch(() => ({}))) as { errors?: Array<{ message?: string }> };
    const msg = err.errors?.[0]?.message ?? `HTTP ${resp.status}`;
    if (/already|exists|duplicate/i.test(msg)) return { ok: true };
    return { ok: false, message: msg };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "request failed" };
  }
}

/**
 * Ensure a proxied `CNAME hostname → <project>.pages.dev` record exists in the
 * zone. The Pages "add domain" API does NOT create this record (the dashboard
 * does it behind the scenes), so without it the custom domain stays `pending`
 * forever and never resolves. An existing record (same target) is success.
 */
async function ensureCnameRecord(
  config: CfPagesConfig,
  zoneId: string,
  hostname: string,
  target: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const resp = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "CNAME", name: hostname, content: target, proxied: true }),
    });
    if (resp.ok) return { ok: true };
    const err = (await resp.json().catch(() => ({}))) as { errors?: Array<{ code?: number; message?: string }> };
    const first = err.errors?.[0];
    const msg = first?.message ?? `HTTP ${resp.status}`;
    // 81053/81057 = record already exists. Treat any "already exists" as success
    // (Pages reuses the existing record; we don't clobber a user's own setup).
    if (first?.code === 81053 || first?.code === 81057 || /already exists|identical record/i.test(msg)) {
      return { ok: true };
    }
    return { ok: false, message: msg };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "request failed" };
  }
}

/**
 * Wire `<hostname>` up as a working custom domain on the Pages project: attach
 * it to the project AND create the CNAME that makes it resolve. Both API-only
 * (wrangler has no domain commands). Returns ok only when both steps succeed;
 * SSL provisioning then completes asynchronously on CF's side (a minute or two).
 */
async function attachCustomDomain(
  config: CfPagesConfig,
  project: string,
  hostname: string,
): Promise<{ ok: boolean; message?: string }> {
  const zone = await findZoneForHostname(config, hostname);
  if (!zone) {
    return { ok: false, message: `no Cloudflare zone for ${hostname} in this account` };
  }
  const attached = await attachProjectDomain(config, project, hostname);
  if (!attached.ok) return attached;
  return ensureCnameRecord(config, zone.id, hostname, `${project}.pages.dev`);
}

async function deployViaCli(req: CfDeployRequest): Promise<CfDeployResult> {
  const tmpDir = join(tmpdir(), `pneuma-cf-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    for (const file of req.files) {
      const filePath = join(tmpDir, file.path);
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, file.content);
    }

    const name = req.projectName ?? "pneuma-deploy";
    const env = { ...process.env, PATH: getEnrichedPath(), HOME: process.env.HOME || homedir() } as Record<string, string>;

    // Resolve binary path for Electron/desktop compatibility
    const wranglerBin = resolveBinary("wrangler") ?? "wrangler";

    // Ensure project exists (wrangler < 4.78 doesn't auto-create)
    const checkProc = Bun.spawn(
      [wranglerBin, "pages", "project", "create", name, "--production-branch", "main"],
      { stdout: "pipe", stderr: "pipe", env },
    );
    await checkProc.exited; // Ignore exit code — fails if project already exists

    const args = [wranglerBin, "pages", "deploy", tmpDir, "--project-name", name, "--branch", "main"];

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const cleanErr = (stderr || stdout).replace(/\x1b\[[0-9;]*m/g, "").trim();
      throw new Error(`wrangler deploy failed: ${cleanErr}`);
    }

    // Parse deployment URL from output: "https://xxx.project.pages.dev"
    const output = stdout + "\n" + stderr;
    const urlMatch = output.match(/https:\/\/[\w.-]+\.pages\.dev/);
    const deploymentUrl = urlMatch ? urlMatch[0] : "";
    const productionUrl = `https://${name}.pages.dev`;

    // Get account ID for dashboard URL
    let dashboardUrl = "";
    const config = getCfPagesConfig();
    if (config?.accountId) {
      dashboardUrl = `https://dash.cloudflare.com/${config.accountId}/pages/view/${name}`;
    } else {
      // Try to get from wrangler whoami
      const whoami = Bun.spawn([wranglerBin, "whoami"], { stdout: "pipe", stderr: "pipe", env });
      const whoamiOut = await new Response(whoami.stdout).text();
      await whoami.exited;
      const idMatch = whoamiOut.match(/([0-9a-f]{32})/);
      if (idMatch) {
        dashboardUrl = `https://dash.cloudflare.com/${idMatch[1]}/pages/view/${name}`;
      }
    }

    return { url: deploymentUrl || productionUrl, productionUrl, dashboardUrl, projectName: name };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function deployViaApi(req: CfDeployRequest, config: CfPagesConfig): Promise<CfDeployResult> {
  const name = req.projectName ?? "pneuma-deploy";
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/pages/projects`;
  const headers = { Authorization: `Bearer ${config.apiToken}` };

  // Ensure project exists (409 if already exists, that's fine)
  await fetch(baseUrl, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name, production_branch: "main" }),
  });

  // Build manifest + file blobs keyed by SHA-256 hash
  const manifest: Record<string, string> = {};
  const fileBlobs = new Map<string, Uint8Array>();

  for (const file of req.files) {
    const content = new TextEncoder().encode(file.content);
    const hash = createHash("sha256").update(content).digest("hex");
    const filePath = "/" + file.path.replace(/^\//, "");
    manifest[filePath] = hash;
    if (!fileBlobs.has(hash)) {
      fileBlobs.set(hash, content);
    }
  }

  // Multipart form: manifest + files
  const form = new FormData();
  form.append("manifest", JSON.stringify(manifest));
  form.append("branch", "main");
  for (const [hash, content] of fileBlobs) {
    form.append(hash, new Blob([content as BlobPart]), hash);
  }

  const resp = await fetch(`${baseUrl}/${name}/deployments`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { errors?: Array<{ message?: string }> };
    const msg = err.errors?.[0]?.message ?? `Cloudflare API error: ${resp.status}`;
    throw new Error(msg);
  }

  const data = await resp.json() as {
    result: {
      id: string;
      url: string;
      aliases?: string[];
      environment: string;
      project_name: string;
    };
  };

  const productionUrl = `https://${name}.pages.dev`;
  const dashboardUrl = `https://dash.cloudflare.com/${config.accountId}/pages/view/${name}`;

  return {
    url: data.result.aliases?.[0] ?? data.result.url ?? productionUrl,
    productionUrl,
    dashboardUrl,
    projectName: name,
  };
}

export async function deployCfPages(req: CfDeployRequest): Promise<CfDeployResult> {
  const config = getCfPagesConfig();
  const apiConfigured = !!(config?.apiToken && config?.accountId);

  const cli = await checkWranglerCli();
  let result: CfDeployResult;
  if (cli.loggedIn) {
    result = await deployViaCli(req);
  } else if (apiConfigured) {
    result = await deployViaApi(req, config!);
  } else {
    throw new Error("Cloudflare not configured. Install Wrangler CLI or add API token in Launcher settings.");
  }

  // Custom-domain attach is a separate, API-only step layered on top of either
  // deploy path. It needs API creds regardless of how the files were uploaded.
  const base = req.customDomain?.replace(/^\.+/, "").trim();
  if (base) {
    if (!apiConfigured) {
      return { ...result, domainWarning: `Custom domain ${base} needs a Cloudflare API token + account id; deployed to pages.dev instead.` };
    }
    const hostname = `${result.projectName}.${base}`;
    const attach = await attachCustomDomain(config!, result.projectName, hostname);
    if (attach.ok) {
      const productionUrl = `https://${hostname}`;
      return { ...result, url: productionUrl, productionUrl, customDomain: base };
    }
    return { ...result, domainWarning: `Couldn't attach ${hostname}: ${attach.message}. Served at pages.dev for now.` };
  }

  return result;
}
