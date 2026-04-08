// server/vercel.ts
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { resolveBinary, getEnrichedPath } from "./path-resolver.ts";

// --- Vercel Token Config ---

interface VercelTokenConfig {
  token: string;
  teamId?: string | null;
}

const VERCEL_CONFIG_PATH = join(homedir(), ".pneuma", "vercel.json");

export function getVercelConfig(): VercelTokenConfig | null {
  try {
    return JSON.parse(readFileSync(VERCEL_CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveVercelConfig(config: VercelTokenConfig): void {
  const dir = join(homedir(), ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(VERCEL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

// --- CLI Detection ---

interface CliStatus {
  installed: boolean;
  loggedIn: boolean;
  user?: string;
}

export async function checkVercelCli(): Promise<CliStatus> {
  try {
    const vercelPath = resolveBinary("vercel");
    if (!vercelPath) return { installed: false, loggedIn: false };

    const home = process.env.HOME || homedir();
    const env = { ...process.env, PATH: getEnrichedPath(), HOME: home } as Record<string, string>;
    console.log(`[vercel] checkCli: binary=${vercelPath}`);
    const whoami = Bun.spawn([vercelPath, "whoami"], { stdout: "pipe", stderr: "pipe", env });
    const [stdout, stderr] = await Promise.all([
      new Response(whoami.stdout).text(),
      new Response(whoami.stderr).text(),
    ]);
    const whoamiExit = await whoami.exited;
    console.log(`[vercel] whoami exit=${whoamiExit} user=${stdout.trim()}`);
    if (whoamiExit !== 0) return { installed: true, loggedIn: false };

    return { installed: true, loggedIn: true, user: stdout.trim() };
  } catch (e) {
    console.error(`[vercel] checkCli error:`, e);
    return { installed: false, loggedIn: false };
  }
}

// --- Unified Status ---

export interface VercelStatus {
  available: boolean;
  method: "cli" | "token" | null;
  user?: string;
}

export async function getVercelStatus(): Promise<VercelStatus> {
  // Priority: CLI -> Token
  const cli = await checkVercelCli();
  if (cli.loggedIn) {
    return { available: true, method: "cli", user: cli.user };
  }

  const config = getVercelConfig();
  if (config?.token) {
    try {
      const resp = await fetch("https://api.vercel.com/v2/user", {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (resp.ok) {
        const data = (await resp.json()) as { user: { username: string } };
        return { available: true, method: "token", user: data.user.username };
      }
    } catch {
      /* fall through */
    }
  }

  return { available: false, method: null };
}

// --- Deploy Binding ---

export interface VercelProjectBinding {
  projectId: string;
  projectName: string;
  orgId?: string | null;
  teamId?: string | null;
  url: string;
  lastDeployedAt: string;
}

export interface CfPagesBinding {
  projectName: string;
  productionUrl: string;
  dashboardUrl: string;
  lastDeployedAt: string;
}

export interface DeployBinding {
  vercel?: Record<string, VercelProjectBinding>;
  cfPages?: Record<string, CfPagesBinding>;
}

export function getDeployBinding(workspace: string): DeployBinding {
  const p = join(workspace, ".pneuma", "deploy.json");
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

export function saveDeployBinding(
  workspace: string,
  binding: DeployBinding,
): void {
  const dir = join(workspace, ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "deploy.json"), JSON.stringify(binding, null, 2));
}

// --- Teams ---

interface VercelTeam {
  id: string;
  name: string;
  slug: string;
}

export async function getVercelTeams(): Promise<VercelTeam[]> {
  const config = getVercelConfig();
  if (!config?.token) return [];
  try {
    const resp = await fetch("https://api.vercel.com/v2/teams", {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { teams: VercelTeam[] };
    return data.teams ?? [];
  } catch {
    return [];
  }
}

// --- Deploy ---

export interface DeployRequest {
  files: Array<{ path: string; content: string }>;
  projectName?: string;
  projectId?: string;
  orgId?: string | null;
  teamId?: string | null;
  framework?: string | null;
}

export interface DeployResult {
  url: string;
  projectId: string;
  orgId: string;
  deploymentUrl: string;
  dashboardUrl: string;
}

async function deployViaApi(
  req: DeployRequest,
  token: string,
): Promise<DeployResult> {
  const qs = req.teamId ? `?teamId=${req.teamId}` : "";

  let projectId = req.projectId;

  if (!projectId && req.projectName) {
    const listResp = await fetch(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(req.projectName)}${qs}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (listResp.ok) {
      const proj = (await listResp.json()) as { id: string };
      projectId = proj.id;
    }
  }

  const body: Record<string, unknown> = {
    name: req.projectName ?? "pneuma-deploy",
    files: req.files.map((f) => ({
      file: f.path,
      data: f.content,
    })),
    projectSettings: {
      framework: req.framework ?? null,
    },
    target: "production",
  };

  if (projectId) {
    body.project = projectId;
  }

  const resp = await fetch(`https://api.vercel.com/v13/deployments${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      err.error?.message ?? `Vercel API error: ${resp.status}`,
    );
  }

  const data = (await resp.json()) as {
    id: string;
    url: string;
    alias?: string[];
    projectId?: string;
    ownerId?: string;
    inspectorUrl?: string;
  };
  const prodUrl = data.alias?.[0]
    ? `https://${data.alias[0]}`
    : `https://${data.url}`;

  // inspectorUrl = https://vercel.com/{scope}/{project}/{deployId}
  // project dashboard = drop the last segment
  const inspectorUrl = data.inspectorUrl ?? "";
  const dashboardUrl = inspectorUrl
    ? inspectorUrl.split("/").slice(0, -1).join("/")
    : "";

  return {
    url: prodUrl,
    projectId: data.projectId ?? projectId ?? "",
    orgId: data.ownerId ?? req.teamId ?? "",
    deploymentUrl: `https://${data.url}`,
    dashboardUrl,
  };
}

async function deployViaCli(req: DeployRequest): Promise<DeployResult> {
  const tmpDir = join(tmpdir(), `pneuma-vercel-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    for (const file of req.files) {
      const filePath = join(tmpDir, file.path);
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, file.content);
    }

    if (req.projectId) {
      const vercelDir = join(tmpDir, ".vercel");
      mkdirSync(vercelDir, { recursive: true });
      const projConfig: Record<string, string> = { projectId: req.projectId };
      if (req.orgId) projConfig.orgId = req.orgId;
      else if (req.teamId) projConfig.orgId = req.teamId;
      writeFileSync(join(vercelDir, "project.json"), JSON.stringify(projConfig));
    }

    const isFirstDeploy = !req.projectId;
    const home = process.env.HOME || homedir();
    const env: Record<string, string> = { ...process.env as Record<string, string>, PATH: getEnrichedPath(), HOME: home };
    if (req.teamId) env.VERCEL_ORG_ID = req.teamId;

    // Helper to run vercel CLI and get output
    async function runVercel(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      const p = Bun.spawn(args, { cwd: tmpDir, stdout: "pipe", stderr: "pipe", env });
      const [stdout, stderr] = await Promise.all([
        new Response(p.stdout).text(),
        new Response(p.stderr).text(),
      ]);
      return { stdout, stderr, exitCode: await p.exited };
    }

    // Resolve binary path for Electron/desktop compatibility
    const vercelBin = resolveBinary("vercel") ?? "vercel";

    // Step 1: Deploy
    // First deploy: preview first (--prod on first deploy fails with "Project Settings are invalid")
    // Then promote to production in a second step.
    const deployArgs = [vercelBin, "deploy", "--yes"];
    if (!isFirstDeploy) deployArgs.push("--prod");
    if (req.projectName) deployArgs.push("--name", req.projectName);

    const deploy = await runVercel(deployArgs);
    if (deploy.exitCode !== 0) {
      throw new Error(`vercel deploy failed: ${deploy.stderr || deploy.stdout}`);
    }

    // Parse deploy output — newer Vercel CLI outputs JSON, older outputs plain URL
    let deploymentUrl = "";
    let jsonResult: { deployment?: { url?: string; inspectorUrl?: string }; } | null = null;
    const rawOut = deploy.stdout.trim();
    try {
      jsonResult = JSON.parse(rawOut);
      deploymentUrl = jsonResult?.deployment?.url ?? "";
      if (deploymentUrl && !deploymentUrl.startsWith("http")) deploymentUrl = `https://${deploymentUrl}`;
    } catch {
      // Legacy plain-text output: last line is the URL
      deploymentUrl = rawOut.split("\n").pop()?.trim() ?? "";
    }
    if (!deploymentUrl || !deploymentUrl.startsWith("http")) {
      throw new Error(`Unexpected vercel output: ${deploy.stdout}`);
    }

    // Step 2: For first deploy, promote to production
    if (isFirstDeploy) {
      const promote = await runVercel([vercelBin, "deploy", "--prod", "--yes"]);
      if (promote.exitCode === 0) {
        try {
          const promoteJson = JSON.parse(promote.stdout.trim());
          const u = promoteJson?.deployment?.url ?? "";
          if (u) deploymentUrl = u.startsWith("http") ? u : `https://${u}`;
        } catch {
          const promoteUrl = promote.stdout.trim().split("\n").pop()?.trim() ?? "";
          if (promoteUrl.startsWith("http")) deploymentUrl = promoteUrl;
        }
      }
    }

    // Step 3: Read project.json for IDs
    let projectId = req.projectId ?? "";
    let orgId = req.orgId ?? "";
    try {
      const projJson = JSON.parse(
        readFileSync(join(tmpDir, ".vercel", "project.json"), "utf-8"),
      );
      projectId = projJson.projectId ?? projectId;
      orgId = projJson.orgId ?? orgId;
    } catch { /* ignore */ }

    // Step 4: Get production alias + dashboard URL
    let prodUrl = deploymentUrl;
    let dashboardUrl = "";

    // Try to extract from JSON result first (newer CLI)
    if (jsonResult?.deployment?.inspectorUrl) {
      const inspectorUrl = jsonResult.deployment.inspectorUrl;
      dashboardUrl = inspectorUrl.split("/").slice(0, -1).join("/");
    }

    // Fall back to `vercel inspect` for aliases and dashboard URL
    const inspect = await runVercel([vercelBin, "inspect", deploymentUrl]);
    const inspectText = inspect.stdout + "\n" + inspect.stderr;

    // Parse aliases — shortest .vercel.app URL is the production alias
    const allUrls = inspectText.match(/https?:\/\/[\w.-]+\.vercel\.app/g) ?? [];
    if (allUrls.length > 0) {
      const sorted = [...new Set(allUrls)].sort((a, b) => a.length - b.length);
      prodUrl = sorted[0];
    }

    // Parse scope + project name for dashboard URL (if not already set from JSON)
    if (!dashboardUrl) {
      const scopeMatch = inspectText.match(/in\s+([\w-]+)\s*$/m);
      const nameMatch = inspectText.match(/name\s+([\w-]+)/);
      if (scopeMatch && nameMatch) {
        dashboardUrl = `https://vercel.com/${scopeMatch[1]}/${nameMatch[1]}`;
      }
    }

    return {
      url: prodUrl,
      projectId,
      orgId,
      deploymentUrl,
      dashboardUrl,
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function deployToVercel(
  req: DeployRequest,
): Promise<DeployResult> {
  const cli = await checkVercelCli();
  if (cli.loggedIn) {
    return deployViaCli(req);
  }

  const config = getVercelConfig();
  if (config?.token) {
    return deployViaApi(req, config.token);
  }

  throw new Error(
    "Vercel not configured. Install Vercel CLI or add a token in Launcher settings.",
  );
}
