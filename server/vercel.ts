// server/vercel.ts
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

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
    const which = Bun.spawn(["which", "vercel"], { stdout: "pipe", stderr: "pipe" });
    const whichExit = await which.exited;
    if (whichExit !== 0) return { installed: false, loggedIn: false };

    const whoami = Bun.spawn(["vercel", "whoami"], { stdout: "pipe", stderr: "pipe" });
    const whoamiExit = await whoami.exited;
    if (whoamiExit !== 0) return { installed: true, loggedIn: false };

    const user = (await new Response(whoami.stdout).text()).trim();
    return { installed: true, loggedIn: true, user };
  } catch {
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

export interface DeployBinding {
  vercel?: Record<string, VercelProjectBinding>;
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
    const env: Record<string, string> = { ...process.env as Record<string, string> };
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

    // Step 1: Deploy
    // First deploy: preview first (--prod on first deploy fails with "Project Settings are invalid")
    // Then promote to production in a second step.
    const deployArgs = ["vercel", "deploy", "--yes"];
    if (!isFirstDeploy) deployArgs.push("--prod");
    if (req.projectName) deployArgs.push("--name", req.projectName);

    const deploy = await runVercel(deployArgs);
    if (deploy.exitCode !== 0) {
      throw new Error(`vercel deploy failed: ${deploy.stderr || deploy.stdout}`);
    }

    let deploymentUrl = deploy.stdout.trim().split("\n").pop()?.trim() ?? "";
    if (!deploymentUrl.startsWith("http")) {
      throw new Error(`Unexpected vercel output: ${deploy.stdout}`);
    }

    // Step 2: For first deploy, promote to production
    if (isFirstDeploy) {
      const promote = await runVercel(["vercel", "deploy", "--prod", "--yes"]);
      if (promote.exitCode === 0) {
        const promoteUrl = promote.stdout.trim().split("\n").pop()?.trim() ?? "";
        if (promoteUrl.startsWith("http")) {
          deploymentUrl = promoteUrl;
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

    // Step 4: Get production alias + dashboard URL via `vercel inspect`
    let prodUrl = deploymentUrl;
    let dashboardUrl = "";
    const inspect = await runVercel(["vercel", "inspect", deploymentUrl]);
    const inspectText = inspect.stdout + "\n" + inspect.stderr;

    // Parse aliases — shortest .vercel.app URL is the production alias
    const allUrls = inspectText.match(/https?:\/\/[\w.-]+\.vercel\.app/g) ?? [];
    if (allUrls.length > 0) {
      const sorted = [...new Set(allUrls)].sort((a, b) => a.length - b.length);
      prodUrl = sorted[0];
    }

    // Parse scope from "Fetching deployment ... in {scope}" line
    const scopeMatch = inspectText.match(/in\s+([\w-]+)\s*$/m);
    // Parse project name from "name\t{name}" line
    const nameMatch = inspectText.match(/name\s+([\w-]+)/);
    if (scopeMatch && nameMatch) {
      dashboardUrl = `https://vercel.com/${scopeMatch[1]}/${nameMatch[1]}`;
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
