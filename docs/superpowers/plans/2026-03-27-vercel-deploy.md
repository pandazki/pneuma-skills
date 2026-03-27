# Vercel Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-mode Vercel deployment capability, starting with webcraft. Global auth (CLI + token), shared deploy API, per-mode packaging and UI.

**Architecture:** Three layers — global config (`~/.pneuma/vercel.json` + CLI detection), shared server API (`/api/vercel/*`), per-mode export page integration. Deploy binding stored in `.pneuma/deploy.json`. CLI prioritized over token; both transparent to callers via unified `deployToVercel()`.

**Tech Stack:** Bun server (Hono), Vercel REST API v13, Vercel CLI fallback, vanilla JS (export page toolbar)

**Spec:** `docs/superpowers/specs/2026-03-27-vercel-deploy-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `server/vercel.ts` | New: Vercel config CRUD, CLI detection, deploy (CLI + API), teams, deploy binding |
| `server/index.ts` | Vercel API routes (launcher: config; normal: status + deploy + binding + teams) |
| `server/routes/export.ts` | Webcraft export toolbar: deploy button, deploy form, deploy script |
| `src/components/Launcher.tsx` | VercelSection in settings panel |

---

### Task 1: Create server/vercel.ts — config and CLI detection

**Files:**
- Create: `server/vercel.ts`

- [ ] **Step 1: Create vercel.ts with config CRUD**

Create `server/vercel.ts` following the pattern from `server/share.ts`:

```typescript
// server/vercel.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
```

- [ ] **Step 2: Add CLI detection**

Append to `server/vercel.ts`:

```typescript
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
```

- [ ] **Step 3: Add unified status check**

Append to `server/vercel.ts`:

```typescript
// --- Unified Status ---

export interface VercelStatus {
  available: boolean;
  method: "cli" | "token" | null;
  user?: string;
}

export async function getVercelStatus(): Promise<VercelStatus> {
  // Priority: CLI → Token
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
        const data = await resp.json() as { user: { username: string } };
        return { available: true, method: "token", user: data.user.username };
      }
    } catch { /* fall through */ }
  }

  return { available: false, method: null };
}
```

- [ ] **Step 4: Verify file compiles**

Run: `bunx tsc --noEmit server/vercel.ts 2>&1 | head -20`
Expected: No errors (or only unrelated import warnings)

- [ ] **Step 5: Commit**

```bash
git add server/vercel.ts
git commit -m "feat(vercel): add config CRUD and CLI detection"
```

---

### Task 2: Add deploy and teams to server/vercel.ts

**Files:**
- Modify: `server/vercel.ts`

- [ ] **Step 1: Add deploy binding helpers**

Append to `server/vercel.ts`:

```typescript
// --- Deploy Binding ---

export interface DeployBinding {
  vercel?: {
    projectId: string;
    projectName: string;
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

export function saveDeployBinding(workspace: string, binding: DeployBinding): void {
  const dir = join(workspace, ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "deploy.json"), JSON.stringify(binding, null, 2));
}
```

- [ ] **Step 2: Add teams fetcher**

Append to `server/vercel.ts`:

```typescript
// --- Teams ---

interface VercelTeam {
  id: string;
  name: string;
  slug: string;
}

async function getAuthToken(): Promise<string | null> {
  const cli = await checkVercelCli();
  if (cli.loggedIn) {
    // CLI stores token in ~/.config/com.vercel.cli/auth.json or similar
    // Use `vercel teams ls` for CLI path
    return null; // CLI path uses CLI commands, not raw token
  }
  return getVercelConfig()?.token ?? null;
}

export async function getVercelTeams(): Promise<VercelTeam[]> {
  const config = getVercelConfig();
  if (!config?.token) return [];
  try {
    const resp = await fetch("https://api.vercel.com/v2/teams", {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { teams: VercelTeam[] };
    return data.teams ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Add deployToVercel — Token API path**

Append to `server/vercel.ts`:

```typescript
// --- Deploy ---

export interface DeployRequest {
  files: Array<{ path: string; content: string }>;
  projectName?: string;
  projectId?: string;
  teamId?: string | null;
  framework?: string | null;
}

export interface DeployResult {
  url: string;
  projectId: string;
  deploymentUrl: string;
}

async function deployViaApi(req: DeployRequest, token: string): Promise<DeployResult> {
  const qs = req.teamId ? `?teamId=${req.teamId}` : "";

  // If no projectId, we need to create/find the project first
  let projectId = req.projectId;

  if (!projectId && req.projectName) {
    // Try to find existing project by name
    const listResp = await fetch(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(req.projectName)}${qs}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (listResp.ok) {
      const proj = await listResp.json() as { id: string };
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
    const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Vercel API error: ${resp.status}`);
  }

  const data = await resp.json() as { id: string; url: string; alias?: string[]; projectId?: string };
  const prodUrl = data.alias?.[0] ? `https://${data.alias[0]}` : `https://${data.url}`;

  return {
    url: prodUrl,
    projectId: data.projectId ?? projectId ?? "",
    deploymentUrl: `https://${data.url}`,
  };
}
```

- [ ] **Step 4: Add deployToVercel — CLI path**

Append to `server/vercel.ts`:

Add `tmpdir` to the existing `"node:os"` import and `rmSync` to the existing `"node:fs"` import at the top of the file.

```typescript
async function deployViaCli(req: DeployRequest): Promise<DeployResult> {
  // Write files to temp directory
  const tmpDir = join(tmpdir(), `pneuma-vercel-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Write all files
    for (const file of req.files) {
      const filePath = join(tmpDir, file.path);
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, file.content);
    }

    // If we have a projectId, write .vercel/project.json to skip interactive setup
    if (req.projectId) {
      const vercelDir = join(tmpDir, ".vercel");
      mkdirSync(vercelDir, { recursive: true });
      writeFileSync(join(vercelDir, "project.json"), JSON.stringify({
        projectId: req.projectId,
        orgId: req.teamId ?? undefined,
      }));
    }

    // Run vercel deploy
    const args = ["vercel", "deploy", "--prod", "--yes"];
    if (req.projectName && !req.projectId) {
      args.push("--name", req.projectName);
    }

    const proc = Bun.spawn(args, {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, VERCEL_ORG_ID: req.teamId ?? "" },
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`vercel deploy failed: ${stderr || stdout}`);
    }

    // stdout contains the deployment URL
    const deploymentUrl = stdout.trim().split("\n").pop()?.trim() ?? "";
    if (!deploymentUrl.startsWith("http")) {
      throw new Error(`Unexpected vercel output: ${stdout}`);
    }

    // Extract project info from .vercel/project.json (created by CLI)
    let projectId = req.projectId ?? "";
    try {
      const projJson = JSON.parse(readFileSync(join(tmpDir, ".vercel", "project.json"), "utf-8"));
      projectId = projJson.projectId ?? projectId;
    } catch { /* ignore */ }

    return {
      url: deploymentUrl,
      projectId,
      deploymentUrl,
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Add unified deployToVercel entry point**

Append to `server/vercel.ts`:

```typescript
export async function deployToVercel(req: DeployRequest): Promise<DeployResult> {
  // Priority: CLI → Token
  const cli = await checkVercelCli();
  if (cli.loggedIn) {
    return deployViaCli(req);
  }

  const config = getVercelConfig();
  if (config?.token) {
    return deployViaApi(req, config.token);
  }

  throw new Error("Vercel not configured. Install Vercel CLI or add a token in Launcher settings.");
}
```

- [ ] **Step 6: Commit**

```bash
git add server/vercel.ts
git commit -m "feat(vercel): add deploy (CLI + API), teams, and binding helpers"
```

---

### Task 3: Add Vercel API routes to server/index.ts

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Add import**

At the top of `server/index.ts`, add the import alongside the existing `share.ts` import:

```typescript
import { getVercelConfig, saveVercelConfig, getVercelStatus, getVercelTeams, deployToVercel, getDeployBinding, saveDeployBinding } from "./vercel.ts";
```

- [ ] **Step 2: Add Vercel routes in launcher mode**

In `server/index.ts`, after the R2 config routes (after line ~674, before the API Keys section at line ~676), add:

```typescript
    // Vercel Configuration
    app.get("/api/vercel/status", async (c) => {
      const status = await getVercelStatus();
      return c.json(status);
    });

    app.get("/api/vercel/config", (c) => {
      const config = getVercelConfig();
      if (!config) return c.json({ configured: false });
      return c.json({
        configured: true,
        token: config.token.slice(0, 6) + "***",
        teamId: config.teamId ?? null,
      });
    });

    app.post("/api/vercel/config", async (c) => {
      try {
        const body = await c.req.json<{ token: string; teamId?: string | null }>();
        saveVercelConfig({ token: body.token, teamId: body.teamId ?? null });
        return c.json({ ok: true });
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    });

    app.get("/api/vercel/teams", async (c) => {
      const teams = await getVercelTeams();
      return c.json({ teams });
    });
```

- [ ] **Step 3: Add Vercel routes in normal mode**

In `server/index.ts`, after the R2/share routes in normal mode (after line ~1073), add:

```typescript
  // --- Vercel Deploy ---
  app.get("/api/vercel/status", async (c) => {
    const status = await getVercelStatus();
    return c.json(status);
  });

  app.get("/api/vercel/teams", async (c) => {
    const teams = await getVercelTeams();
    return c.json({ teams });
  });

  app.get("/api/vercel/binding", (c) => {
    const binding = getDeployBinding(workspace);
    return c.json(binding.vercel ?? null);
  });

  app.post("/api/vercel/deploy", async (c) => {
    try {
      const body = await c.req.json<{
        files: Array<{ path: string; content: string }>;
        projectName?: string;
        projectId?: string;
        teamId?: string | null;
        framework?: string | null;
      }>();
      const result = await deployToVercel(body);

      // Save binding
      const binding = getDeployBinding(workspace);
      binding.vercel = {
        projectId: result.projectId,
        projectName: body.projectName ?? "pneuma-deploy",
        teamId: body.teamId ?? null,
        url: result.url,
        lastDeployedAt: new Date().toISOString(),
      };
      saveDeployBinding(workspace, binding);

      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.delete("/api/vercel/binding", (c) => {
    const binding = getDeployBinding(workspace);
    delete binding.vercel;
    saveDeployBinding(workspace, binding);
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Verify server compiles**

Run: `bun run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat(vercel): add API routes for status, config, deploy, binding"
```

---

### Task 4: Add VercelSection to Launcher settings

**Files:**
- Modify: `src/components/Launcher.tsx`

- [ ] **Step 1: Create VercelSection component**

In `src/components/Launcher.tsx`, add the `VercelSection` component right after the `CloudStorageSection` component (after line ~2563):

```typescript
function VercelSection() {
  const [status, setStatus] = useState<"loading" | "configured" | "unconfigured" | "editing">("loading");
  const [vercelStatus, setVercelStatus] = useState<{ available: boolean; method: "cli" | "token" | null; user?: string } | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [form, setForm] = useState({ token: "", teamId: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${getApiBase()}/api/vercel/status`).then((r) => r.json()),
      fetch(`${getApiBase()}/api/vercel/config`).then((r) => r.json()),
    ]).then(([vs, cfg]) => {
      setVercelStatus(vs);
      if (cfg.configured) { setConfig(cfg); setStatus("configured"); }
      else if (vs.available && vs.method === "cli") { setStatus("configured"); }
      else setStatus("unconfigured");
    }).catch(() => setStatus("unconfigured"));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${getApiBase()}/api/vercel/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: form.token, teamId: form.teamId || null }),
      });
      const [vs, cfg] = await Promise.all([
        fetch(`${getApiBase()}/api/vercel/status`).then((r) => r.json()),
        fetch(`${getApiBase()}/api/vercel/config`).then((r) => r.json()),
      ]);
      setVercelStatus(vs);
      setConfig(cfg);
      setStatus("configured");
    } catch { }
    setSaving(false);
  };

  if (status === "loading") return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Vercel Deploy</h3>
        {status === "configured" && (
          <button onClick={() => { setForm({ token: "", teamId: "" }); setStatus("editing"); }}
            className="text-[10px] text-cc-muted/50 hover:text-cc-fg transition-colors cursor-pointer">Edit</button>
        )}
      </div>
      <p className="text-[10px] text-cc-muted/60 leading-relaxed">
        Deploy projects to Vercel. Uses Vercel CLI if installed, or configure a token below.
      </p>

      {/* CLI status indicator */}
      {vercelStatus && vercelStatus.method === "cli" && (
        <div className="p-3 rounded-lg border border-cc-border bg-cc-surface/30 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cc-success" />
            <span className="text-xs text-cc-fg">CLI connected as {vercelStatus.user}</span>
          </div>
        </div>
      )}

      {/* Token configured */}
      {status === "configured" && vercelStatus?.method === "token" && (
        <div className="p-3 rounded-lg border border-cc-border bg-cc-surface/30 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cc-success" />
            <span className="text-xs text-cc-fg">Token connected as {vercelStatus.user}</span>
          </div>
          {config?.teamId && <div className="text-[10px] text-cc-muted">Team: {config.teamId}</div>}
        </div>
      )}

      {/* Not available — show hint */}
      {status === "configured" && !vercelStatus?.available && (
        <div className="p-3 rounded-lg border border-cc-border bg-cc-surface/30">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            <span className="text-xs text-cc-fg">Token saved but could not verify</span>
          </div>
        </div>
      )}

      {(status === "unconfigured" || status === "editing") && (
        <div className="space-y-3">
          {status === "unconfigured" && !vercelStatus?.available && (
            <div className="text-[10px] text-cc-muted/60 leading-relaxed">
              Install <span className="text-cc-fg">Vercel CLI</span> (<code className="text-cc-primary">npm i -g vercel</code> then <code className="text-cc-primary">vercel login</code>), or create a token at <span className="text-cc-fg">vercel.com/account/tokens</span>.
            </div>
          )}
          <div className="space-y-2">
            {[
              { key: "token", placeholder: "Vercel Token", type: "password" },
              { key: "teamId", placeholder: "Team ID (optional, leave blank for personal)", type: "text" },
            ].map(({ key, placeholder, type }) => (
              <input
                key={key}
                placeholder={placeholder}
                type={type}
                value={(form as any)[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.token}
              className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer">
              {saving ? "Saving..." : "Save"}
            </button>
            {status === "editing" && (
              <button onClick={() => setStatus("configured")}
                className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add VercelSection to SettingsPanel render**

In `src/components/Launcher.tsx`, in the SettingsPanel sections div (around line 2592-2596), add `<VercelSection />`:

```typescript
        {/* Sections */}
        <div className="p-6 space-y-8">
          <BackendsSection />
          <ApiKeysSection />
          <CloudStorageSection />
          <VercelSection />
        </div>
```

- [ ] **Step 3: Verify frontend compiles**

Run: `bun run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/components/Launcher.tsx
git commit -m "feat(vercel): add VercelSection to launcher settings"
```

---

### Task 5: Add deploy button and form to webcraft export page

**Files:**
- Modify: `server/routes/export.ts`

- [ ] **Step 1: Add Vercel deploy button to webcraft toolbar**

In `server/routes/export.ts`, in the `buildWebcraftExportHtml` function, modify the toolbar HTML (around line 892-897). After the Screenshot PNG button and before `</div>`, add a Vercel deploy button:

Find the toolbar actions section:
```html
    <div class="export-toolbar-actions">
      <button class="btn-primary" onclick="downloadHtml()">Download HTML</button>
      <button class="btn-secondary" onclick="downloadZip()">Download ZIP</button>
      <div class="print-divider"></div>
      <button class="btn-secondary" onclick="captureScreenshot()">Screenshot PNG</button>
    </div>
```

Replace with:
```html
    <div class="export-toolbar-actions">
      <button class="btn-primary" onclick="downloadHtml()">Download HTML</button>
      <button class="btn-secondary" onclick="downloadZip()">Download ZIP</button>
      <div class="print-divider"></div>
      <button class="btn-secondary" onclick="captureScreenshot()">Screenshot PNG</button>
      <div class="print-divider"></div>
      <button class="btn-vercel" id="vercel-btn" onclick="openVercelDeploy()" disabled>
        <svg width="14" height="14" viewBox="0 0 76 65" fill="currentColor"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/></svg>
        Deploy
      </button>
    </div>
```

- [ ] **Step 2: Add deploy modal HTML**

In the same function, after the toolbar HTML template string but before it closes, add a modal for deploy configuration. Append this right before the closing of `toolbarHtml`:

After the `</div>` that closes `export-toolbar-wrapper`, add:

```html
<div id="vercel-modal" class="deploy-modal" style="display:none">
  <div class="deploy-modal-backdrop" onclick="closeVercelModal()"></div>
  <div class="deploy-modal-content">
    <h3>Deploy to Vercel</h3>
    <div id="vercel-status-msg"></div>
    <div id="vercel-form" style="display:none">
      <label>Project Name<input id="vercel-project-name" type="text" placeholder="my-project" /></label>
      <label>Team<select id="vercel-team"><option value="">Personal</option></select></label>
      <div class="deploy-actions">
        <button class="btn-primary" onclick="executeDeploy()">Deploy</button>
        <button class="btn-secondary" onclick="closeVercelModal()">Cancel</button>
      </div>
    </div>
    <div id="vercel-progress" style="display:none">
      <div class="deploy-spinner"></div>
      <span>Deploying...</span>
    </div>
    <div id="vercel-result" style="display:none">
      <div class="deploy-success">Deployed!</div>
      <input id="vercel-url" type="text" readonly onclick="this.select()" />
      <div class="deploy-actions">
        <button class="btn-secondary" onclick="window.open(document.getElementById('vercel-url').value)">Open</button>
        <button class="btn-secondary" onclick="closeVercelModal()">Close</button>
      </div>
    </div>
    <div id="vercel-error" style="display:none">
      <div class="deploy-error-msg"></div>
      <button class="btn-secondary" onclick="closeVercelModal()">Close</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add deploy modal CSS**

In the CSS section of `buildWebcraftExportHtml` (the `<style>` block), add styles for the deploy button and modal:

```css
.btn-vercel { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.08); color:#fff; transition:all 0.15s; }
.btn-vercel:hover:not(:disabled) { background:rgba(255,255,255,0.15); }
.btn-vercel:disabled { opacity:0.3; cursor:not-allowed; }
.deploy-modal { position:fixed; inset:0; z-index:1000; display:flex; align-items:center; justify-content:center; }
.deploy-modal-backdrop { position:absolute; inset:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); }
.deploy-modal-content { position:relative; background:#18181b; border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:24px; min-width:360px; max-width:420px; }
.deploy-modal-content h3 { margin:0 0 16px; font-size:15px; font-weight:600; color:#fff; }
.deploy-modal-content label { display:block; font-size:12px; color:#a1a1aa; margin-bottom:12px; }
.deploy-modal-content input, .deploy-modal-content select { display:block; width:100%; margin-top:4px; padding:8px 12px; font-size:13px; background:#09090b; border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; outline:none; box-sizing:border-box; }
.deploy-modal-content input:focus, .deploy-modal-content select:focus { border-color:rgba(249,115,22,0.5); }
.deploy-actions { display:flex; gap:8px; margin-top:16px; }
.deploy-spinner { display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,0.2); border-top-color:#f97316; border-radius:50%; animation:spin 0.6s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
.deploy-success { color:#22c55e; font-size:14px; font-weight:500; margin-bottom:8px; }
.deploy-error-msg { color:#ef4444; font-size:13px; margin-bottom:12px; }
#vercel-url { cursor:text; margin-bottom:4px; }
#vercel-status-msg { font-size:12px; color:#a1a1aa; margin-bottom:12px; }
```

- [ ] **Step 4: Add deploy JavaScript**

In the download script section of `buildWebcraftExportHtml` (after the existing `captureScreenshot` function), add the Vercel deploy logic:

```javascript
var _vercelBinding = null;
var _vercelStatus = null;

// Check Vercel status on load
(function(){
  fetch("/api/vercel/status").then(function(r){return r.json()}).then(function(s){
    _vercelStatus = s;
    var btn = document.getElementById("vercel-btn");
    if(s.available) {
      btn.disabled = false;
    }
    // Also check binding
    return fetch("/api/vercel/binding").then(function(r){return r.json()});
  }).then(function(b){
    if(b && b.projectId) {
      _vercelBinding = b;
      var btn = document.getElementById("vercel-btn");
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 76 65" fill="currentColor"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/></svg> Update';
    }
  }).catch(function(){});
})();

function openVercelDeploy(){
  var modal = document.getElementById("vercel-modal");
  modal.style.display = "flex";
  // Reset views
  ["vercel-form","vercel-progress","vercel-result","vercel-error"].forEach(function(id){
    document.getElementById(id).style.display="none";
  });

  if(_vercelBinding) {
    // Has binding — deploy directly
    document.getElementById("vercel-status-msg").textContent = "Updating " + _vercelBinding.projectName + "...";
    executeDeploy();
    return;
  }

  // First deploy — show form
  document.getElementById("vercel-status-msg").textContent = "";
  document.getElementById("vercel-form").style.display = "block";

  // Set default project name from title
  var nameInput = document.getElementById("vercel-project-name");
  if(!nameInput.value) {
    nameInput.value = document.title.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "pneuma-webcraft";
  }

  // Load teams
  if(_vercelStatus && _vercelStatus.method === "token") {
    fetch("/api/vercel/teams").then(function(r){return r.json()}).then(function(data){
      var sel = document.getElementById("vercel-team");
      (data.teams||[]).forEach(function(t){
        var opt = document.createElement("option");
        opt.value = t.id; opt.textContent = t.name;
        sel.appendChild(opt);
      });
    }).catch(function(){});
  }
}

function closeVercelModal(){
  document.getElementById("vercel-modal").style.display = "none";
}

function executeDeploy(){
  document.getElementById("vercel-form").style.display = "none";
  document.getElementById("vercel-progress").style.display = "flex";
  document.getElementById("vercel-status-msg").textContent = "";

  // Collect files — fetch all page HTMLs inlined
  var qs = new URLSearchParams(location.search);
  var contentSet = qs.get("contentSet") || "";

  fetch("/api/files?workspace=" + encodeURIComponent(contentSet)).then(function(r){return r.json()}).then(function(fileData){
    // Build files array from workspace
    var files = [];

    // Get each page HTML inlined
    var pages = document.querySelectorAll(".page-section");
    var promises = [];

    // Fetch the inlined version of each page
    var pageFiles = fileData.files || [];
    var htmlFiles = pageFiles.filter(function(f){ return f.endsWith(".html"); });

    // Fetch inlined HTML for each page via the download endpoint
    return Promise.all(htmlFiles.map(function(f){
      var dlQs = contentSet ? "?contentSet=" + encodeURIComponent(contentSet) + "&page=" + encodeURIComponent(f) : "?page=" + encodeURIComponent(f);
      return fetch("/export/webcraft/download" + dlQs).then(function(r){ return r.text(); }).then(function(html){
        var dir = contentSet || "pages";
        return { path: dir + "/" + f, content: html };
      });
    }));
  }).then(function(pageFileList){
    // Build aggregation index.html
    var indexHtml = buildAggregationPage(pageFileList);
    var files = [{ path: "index.html", content: indexHtml }].concat(pageFileList);

    var body = {
      files: files,
      framework: null,
    };

    if(_vercelBinding) {
      body.projectId = _vercelBinding.projectId;
      body.projectName = _vercelBinding.projectName;
      body.teamId = _vercelBinding.teamId;
    } else {
      body.projectName = document.getElementById("vercel-project-name").value;
      var teamSel = document.getElementById("vercel-team");
      body.teamId = teamSel.value || null;
    }

    return fetch("/api/vercel/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function(r){ return r.json(); });
  }).then(function(result){
    if(result.error) throw new Error(result.error);

    _vercelBinding = {
      projectId: result.projectId,
      projectName: document.getElementById("vercel-project-name")?.value || _vercelBinding?.projectName || "pneuma-deploy",
      url: result.url,
    };

    // Update button text
    var btn = document.getElementById("vercel-btn");
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 76 65" fill="currentColor"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/></svg> Update';

    document.getElementById("vercel-progress").style.display = "none";
    document.getElementById("vercel-result").style.display = "block";
    document.getElementById("vercel-url").value = result.url;
  }).catch(function(err){
    document.getElementById("vercel-progress").style.display = "none";
    document.getElementById("vercel-error").style.display = "block";
    document.querySelector(".deploy-error-msg").textContent = err.message;
  });
}

function buildAggregationPage(pageFiles){
  var cards = pageFiles.map(function(f){
    var name = f.path.split("/").pop().replace(/\.html$/i, "");
    var title = name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, " ");
    return '<a href="' + f.path + '" class="agg-card"><div class="agg-card-title">' + title + '</div></a>';
  }).join("\\n");

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + (document.title || "WebCraft") + '</title><style>'
    + 'body{margin:0;background:#09090b;color:#fff;font-family:system-ui,-apple-system,sans-serif;padding:40px;}'
    + '.agg-header{margin-bottom:32px;}'
    + '.agg-header h1{font-size:28px;font-weight:700;margin:0 0 8px;}'
    + '.agg-header p{color:#a1a1aa;font-size:14px;margin:0;}'
    + '.agg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;}'
    + '.agg-card{display:block;padding:24px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);text-decoration:none;color:#fff;transition:all 0.15s;}'
    + '.agg-card:hover{background:rgba(255,255,255,0.08);border-color:rgba(249,115,22,0.3);}'
    + '.agg-card-title{font-size:15px;font-weight:500;}'
    + '</style></head><body>'
    + '<div class="agg-header"><h1>' + (document.title || "WebCraft") + '</h1><p>' + pageFiles.length + ' page' + (pageFiles.length > 1 ? 's' : '') + '</p></div>'
    + '<div class="agg-grid">' + cards + '</div>'
    + '</body></html>';
}
```

- [ ] **Step 5: Verify build**

Run: `bun run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add server/routes/export.ts
git commit -m "feat(vercel): add deploy button and form to webcraft export page"
```

---

### Task 6: Manual integration test

**Files:** None (testing only)

- [ ] **Step 1: Start dev server with webcraft mode**

Run: `bun run dev webcraft --workspace /tmp/test-vercel-deploy --debug`
Expected: Server starts, browser opens

- [ ] **Step 2: Verify Vercel status endpoint**

In another terminal:
```bash
curl -s http://localhost:17007/api/vercel/status | jq .
```
Expected: `{ "available": false, "method": null }` (or `true` if Vercel CLI is installed)

- [ ] **Step 3: Verify Launcher settings**

Run: `bun run dev` (launcher mode)
Open Settings → should see "Vercel Deploy" section below Cloud Storage

- [ ] **Step 4: Verify webcraft export page**

Create a test workspace with a simple page, open `/export/webcraft`, verify:
- Deploy button appears in toolbar
- Button is disabled if Vercel not configured
- Button is enabled if Vercel CLI is detected

- [ ] **Step 5: Test full deploy flow (if Vercel CLI available)**

If `vercel` CLI is installed and logged in:
1. Open `/export/webcraft`
2. Click "Deploy" button
3. Fill project name in modal
4. Click Deploy
5. Verify deployment URL is returned
6. Click "Update" — should deploy without form

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(vercel): complete webcraft deploy integration"
```
