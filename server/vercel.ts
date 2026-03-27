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

export interface DeployBinding {
  vercel?: {
    projectId: string;
    projectName: string;
    orgId?: string | null;
    teamId?: string | null;
    url: string;
    lastDeployedAt: string;
  };
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
  };
  const prodUrl = data.alias?.[0]
    ? `https://${data.alias[0]}`
    : `https://${data.url}`;

  return {
    url: prodUrl,
    projectId: data.projectId ?? projectId ?? "",
    orgId: data.ownerId ?? req.teamId ?? "",
    deploymentUrl: `https://${data.url}`,
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

    // First deploy: preview first (--prod on first deploy fails with "Project Settings are invalid")
    // Subsequent deploys: direct --prod
    const isFirstDeploy = !req.projectId;
    const args = ["vercel", "deploy", "--yes"];
    if (!isFirstDeploy) args.push("--prod");

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (req.teamId) env.VERCEL_ORG_ID = req.teamId;

    const proc = Bun.spawn(args, {
      cwd: tmpDir,
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
      throw new Error(`vercel deploy failed: ${stderr || stdout}`);
    }

    let deploymentUrl = stdout.trim().split("\n").pop()?.trim() ?? "";
    if (!deploymentUrl.startsWith("http")) {
      throw new Error(`Unexpected vercel output: ${stdout}`);
    }

    // For first deploy: promote to production
    if (isFirstDeploy) {
      const promoteProc = Bun.spawn(["vercel", "--prod", "--yes"], {
        cwd: tmpDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const promoteOut = await new Response(promoteProc.stdout).text();
      const promoteExit = await promoteProc.exited;
      if (promoteExit === 0 && promoteOut.trim().startsWith("http")) {
        deploymentUrl = promoteOut.trim().split("\n").pop()?.trim() ?? deploymentUrl;
      }
    }

    let projectId = req.projectId ?? "";
    let orgId = req.orgId ?? "";
    try {
      const projJson = JSON.parse(
        readFileSync(join(tmpDir, ".vercel", "project.json"), "utf-8"),
      );
      projectId = projJson.projectId ?? projectId;
      orgId = projJson.orgId ?? orgId;
    } catch {
      /* ignore */
    }

    return {
      url: deploymentUrl,
      projectId,
      orgId,
      deploymentUrl,
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
