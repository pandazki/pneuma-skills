// server/cloudflare-pages.ts
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";

// --- Config ---

interface CfPagesConfig {
  apiToken: string;
  accountId: string;
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

// --- CLI Detection ---

interface CliStatus {
  installed: boolean;
  loggedIn: boolean;
}

export async function checkWranglerCli(): Promise<CliStatus> {
  try {
    const which = Bun.spawn(["which", "wrangler"], { stdout: "pipe", stderr: "pipe" });
    if ((await which.exited) !== 0) return { installed: false, loggedIn: false };

    const whoami = Bun.spawn(["wrangler", "whoami"], { stdout: "pipe", stderr: "pipe" });
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
}

export async function getCfPagesStatus(): Promise<CfPagesStatus> {
  const cli = await checkWranglerCli();
  if (cli.loggedIn) return { available: true, method: "cli" };

  const config = getCfPagesConfig();
  if (config?.apiToken && config?.accountId) {
    try {
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/pages/projects?per_page=1`,
        { headers: { Authorization: `Bearer ${config.apiToken}` } },
      );
      if (resp.ok) return { available: true, method: "token" };
    } catch { /* fall through */ }
  }

  return { available: false, method: null };
}

// --- Deploy ---

export interface CfDeployRequest {
  files: Array<{ path: string; content: string }>;
  projectName?: string;
  contentSet?: string;
}

export interface CfDeployResult {
  url: string;
  productionUrl: string;
  dashboardUrl: string;
  projectName: string;
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
    const env = process.env as Record<string, string>;

    // Ensure project exists (wrangler < 4.78 doesn't auto-create)
    const checkProc = Bun.spawn(
      ["wrangler", "pages", "project", "create", name, "--production-branch", "main"],
      { stdout: "pipe", stderr: "pipe", env },
    );
    await checkProc.exited; // Ignore exit code — fails if project already exists

    const args = ["wrangler", "pages", "deploy", tmpDir, "--project-name", name, "--branch", "main"];

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
      const whoami = Bun.spawn(["wrangler", "whoami"], { stdout: "pipe", stderr: "pipe" });
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
    form.append(hash, new Blob([content]), hash);
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
  const cli = await checkWranglerCli();
  if (cli.loggedIn) {
    return deployViaCli(req);
  }

  const config = getCfPagesConfig();
  if (config?.apiToken && config?.accountId) {
    return deployViaApi(req, config);
  }

  throw new Error("Cloudflare not configured. Install Wrangler CLI or add API token in Launcher settings.");
}
