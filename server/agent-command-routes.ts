/**
 * Agent Command + External-Handoff + CLI Helpers routes.
 *
 * Launcher-scope only — mounted once from `server/index.ts` inside the
 * launcher-mode block. Per-session servers do not get these routes.
 *
 * Endpoints:
 *
 *   GET  /api/agent-commands              status for every backend + global flags
 *   POST /api/agent-commands/:backend/install   install or re-stamp
 *   POST /api/agent-commands/:backend/uninstall
 *   POST /api/agent-commands/dismiss-prompt     mark the first-run banner dismissed
 *   POST /api/agent-commands/auto-update        toggle the auto-update flag
 *   POST /api/handoffs/external                 stage + spawn for Electron URL scheme
 *   GET  /api/cli/status                        is `pneuma-skills` on PATH? version?
 *   POST /api/cli/symlink                       create user-level symlink
 *
 * Soft error contract mirrors `library-routes.ts`: 4xx for input
 * validation, 5xx for unexpected errors. Mutating endpoints return the
 * refreshed state so the UI can update without a follow-up GET.
 */

import { existsSync, mkdirSync, readlinkSync, unlinkSync, symlinkSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import type { Hono } from "hono";

import {
  getAllStatus,
  install,
  uninstall,
  loadBundledTemplate,
  readState,
  setPromptDismissed,
  setAutoUpdate,
  runAutoUpdate,
  type AgentCommandBackend,
} from "../core/agent-command-installer.js";
import { runHandoffFromExternal } from "../bin/handoff-from-external-cli.js";

export interface AgentCommandRoutesDeps {
  /** Current pneuma version (from package.json). */
  pneumaVersion: string;
  /** Absolute path to the pneuma-skills package root. */
  projectRoot: string;
}

const VALID_BACKENDS: AgentCommandBackend[] = ["claude-code", "codex"];

function isBackend(value: string | undefined): value is AgentCommandBackend {
  return value === "claude-code" || value === "codex";
}

export function registerAgentCommandRoutes(app: Hono, deps: AgentCommandRoutesDeps): void {
  // ── /api/agent-commands ────────────────────────────────────────────────
  app.get("/api/agent-commands", (c) => {
    try {
      const state = readState();
      const items = getAllStatus(deps.pneumaVersion);
      return c.json({
        pneumaVersion: deps.pneumaVersion,
        promptDismissed: state.promptDismissed,
        autoUpdate: state.autoUpdate,
        items,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/agent-commands/:backend/install", async (c) => {
    const backend = c.req.param("backend");
    if (!isBackend(backend)) {
      return c.json({ error: `unknown backend "${backend}"; expected one of ${VALID_BACKENDS.join(", ")}` }, 400);
    }
    const body = await c.req.json<{ force?: boolean }>().catch(() => ({} as { force?: boolean }));
    try {
      const template = loadBundledTemplate();
      const result = install({
        backend,
        pneumaVersion: deps.pneumaVersion,
        template,
        force: body.force === true,
      });
      if (!result.ok) {
        return c.json(result, result.reason === "conflict" ? 409 : 500);
      }
      // Echo refreshed state so UI can update without a follow-up GET.
      const state = readState();
      const items = getAllStatus(deps.pneumaVersion);
      return c.json({ result, state: { promptDismissed: state.promptDismissed, autoUpdate: state.autoUpdate, items } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/agent-commands/:backend/uninstall", async (c) => {
    const backend = c.req.param("backend");
    if (!isBackend(backend)) {
      return c.json({ error: `unknown backend "${backend}"` }, 400);
    }
    const body = await c.req.json<{ force?: boolean }>().catch(() => ({} as { force?: boolean }));
    try {
      const result = uninstall(backend, { force: body.force === true });
      if (!result.ok) {
        return c.json(result, result.reason === "conflict" ? 409 : 500);
      }
      const state = readState();
      const items = getAllStatus(deps.pneumaVersion);
      return c.json({ result, state: { promptDismissed: state.promptDismissed, autoUpdate: state.autoUpdate, items } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/agent-commands/dismiss-prompt", async (c) => {
    try {
      const next = setPromptDismissed(true);
      return c.json({ promptDismissed: next.promptDismissed });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.post("/api/agent-commands/auto-update", async (c) => {
    const body = await c.req.json<{ enabled?: boolean }>().catch(() => ({} as { enabled?: boolean }));
    if (typeof body.enabled !== "boolean") {
      return c.json({ error: "enabled must be a boolean" }, 400);
    }
    try {
      const next = setAutoUpdate(body.enabled);
      return c.json({ autoUpdate: next.autoUpdate });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // ── /api/handoffs/external ─────────────────────────────────────────────
  // Mirrors the `pneuma handoff-from-external` CLI behaviour. The Electron
  // URL scheme handler (`pneuma://handoff?...`) POSTs to this; it does
  // not require a running source pneuma session (unlike the intra-pneuma
  // `/api/handoffs/emit`). Returns the spawned session's URL.
  app.post("/api/handoffs/external", async (c) => {
    const body = await c.req.json<{
      intent?: string;
      mode?: string;
      cwd?: string;
      initProject?: boolean;
      sourceAgent?: string;
      displayName?: string;
      dryRun?: boolean;
    }>().catch(() => ({} as any));

    if (typeof body.intent !== "string" || body.intent.trim().length === 0) {
      return c.json({ error: "intent is required (non-empty string)" }, 400);
    }
    if (typeof body.mode !== "string" || body.mode.trim().length === 0) {
      return c.json({ error: "mode is required" }, 400);
    }

    const cliArgs: string[] = [
      "--intent", body.intent,
      "--mode", body.mode,
      "--json",
    ];
    if (body.cwd) cliArgs.push("--cwd", body.cwd);
    if (body.initProject === false) cliArgs.push("--quick");
    else cliArgs.push("--init-project");
    if (body.sourceAgent) cliArgs.push("--source-agent", body.sourceAgent);
    if (body.displayName) cliArgs.push("--display-name", body.displayName);
    if (body.dryRun) cliArgs.push("--dry-run");

    // Capture stdout/stderr — runHandoffFromExternal emits a single JSON
    // line as its body, and stderr only on error. We resolve to the parsed
    // JSON when the exit code is 0.
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let exitCode: number;
    try {
      exitCode = await runHandoffFromExternal(
        cliArgs,
        { projectRoot: deps.projectRoot },
        {
          stdout: (line) => stdoutLines.push(line),
          stderr: (line) => stderrLines.push(line),
        },
      );
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }

    if (exitCode !== 0) {
      return c.json({ error: stderrLines.join("\n") || `exit ${exitCode}` }, 400);
    }
    try {
      const parsed = JSON.parse(stdoutLines.join("\n"));
      return c.json(parsed);
    } catch (err) {
      return c.json({ error: "internal: failed to parse handoff result", raw: stdoutLines.join("\n") }, 500);
    }
  });

  // ── /api/cli ───────────────────────────────────────────────────────────
  // CLI presence + version detection, plus a one-click symlink helper for
  // desktop users who installed the Electron app but never ran
  // `bun add -g pneuma-skills`. The Electron bundle carries an internal
  // pneuma-skills checkout; the desktop process plumbs its absolute path
  // in via `process.env.PNEUMA_CLI_ENTRY` so the launcher knows where
  // to symlink from. In a dev/CLI invocation that env var is missing —
  // we fall back to `process.argv[1]`.
  app.get("/api/cli/status", async (c) => {
    const info = await detectCli();
    return c.json(info);
  });

  app.post("/api/cli/symlink", async (c) => {
    const body = await c.req.json<{ target?: string }>().catch(() => ({} as { target?: string }));
    try {
      const result = createCliSymlink(body.target);
      const info = await detectCli();
      return c.json({ result, status: info });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}

// ── CLI detection ──────────────────────────────────────────────────────────

interface CliStatus {
  bundledEntry: string;
  detectedOnPath: boolean;
  pathBinary?: string;
  pathBinaryVersion?: string;
  defaultSymlinkPath: string;
  defaultSymlinkExists: boolean;
  defaultSymlinkPointsAtBundle: boolean;
  pathContainsDefault: boolean;
  shellRcHint?: string;
}

function getBundledEntry(): string {
  return (
    process.env.PNEUMA_CLI_ENTRY
    ?? (process.argv[1] ? resolvePath(process.argv[1]) : "")
  );
}

function defaultSymlinkPath(): string {
  return join(homedir(), ".local", "bin", "pneuma-skills");
}

async function detectCli(): Promise<CliStatus> {
  const bundledEntry = getBundledEntry();
  const symPath = defaultSymlinkPath();
  const status: CliStatus = {
    bundledEntry,
    detectedOnPath: false,
    defaultSymlinkPath: symPath,
    defaultSymlinkExists: false,
    defaultSymlinkPointsAtBundle: false,
    pathContainsDefault: false,
  };

  // 1. Probe `pneuma-skills` and `pneuma` on PATH.
  for (const cmd of ["pneuma-skills", "pneuma"]) {
    const which = await whichBinary(cmd);
    if (which) {
      status.detectedOnPath = true;
      status.pathBinary = which;
      const version = await readBinaryVersion(which);
      if (version) status.pathBinaryVersion = version;
      break;
    }
  }

  // 2. Inspect the default user symlink path.
  if (existsSync(symPath)) {
    status.defaultSymlinkExists = true;
    try {
      const target = readlinkSync(symPath);
      const targetAbs = resolvePath(dirname(symPath), target);
      status.defaultSymlinkPointsAtBundle =
        bundledEntry.length > 0 && resolvePath(bundledEntry) === targetAbs;
    } catch {
      // not a symlink (regular file); leave defaultSymlinkPointsAtBundle false
    }
  }

  // 3. PATH inclusion check + hint.
  const pathDir = dirname(symPath);
  const pathEntries = (process.env.PATH ?? "").split(":").map((p) => p.trim()).filter(Boolean);
  status.pathContainsDefault = pathEntries.includes(pathDir);
  if (!status.pathContainsDefault) {
    status.shellRcHint = buildShellRcHint(pathDir);
  }

  return status;
}

async function whichBinary(cmd: string): Promise<string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const out = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf-8" });
    if (out.status !== 0) return undefined;
    const first = (out.stdout ?? "").split(/\r?\n/).find((l) => l.trim().length > 0);
    return first ? first.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function readBinaryVersion(path: string): Promise<string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const out = spawnSync(path, ["--version"], { encoding: "utf-8", timeout: 5000 });
    if (out.status !== 0) return undefined;
    const text = (out.stdout ?? "").trim();
    const match = text.match(/\b(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)\b/);
    return match ? match[1] : text;
  } catch {
    return undefined;
  }
}

function buildShellRcHint(pathDir: string): string {
  const shell = process.env.SHELL ?? "";
  if (/fish$/.test(shell)) {
    return `# Add to ~/.config/fish/config.fish\nfish_add_path ${pathDir}`;
  }
  if (/zsh$/.test(shell)) {
    return `# Add to ~/.zshrc\nexport PATH="${pathDir}:$PATH"`;
  }
  if (/bash$/.test(shell)) {
    return `# Add to ~/.bashrc or ~/.bash_profile\nexport PATH="${pathDir}:$PATH"`;
  }
  return `# Add to your shell rc\nexport PATH="${pathDir}:$PATH"`;
}

// ── CLI symlink helper ─────────────────────────────────────────────────────

interface SymlinkResult {
  ok: boolean;
  path: string;
  target: string;
  replaced: boolean;
  message?: string;
}

function createCliSymlink(override?: string): SymlinkResult {
  const bundledEntry = getBundledEntry();
  if (!bundledEntry || !existsSync(bundledEntry)) {
    return {
      ok: false,
      path: "",
      target: bundledEntry,
      replaced: false,
      message: `bundled CLI entry not found (${bundledEntry || "unset"}); symlink skipped`,
    };
  }
  const linkPath = override ? resolvePath(override) : defaultSymlinkPath();
  mkdirSync(dirname(linkPath), { recursive: true });

  let replaced = false;
  if (existsSync(linkPath)) {
    try {
      const s = statSync(linkPath, { throwIfNoEntry: false });
      if (s) {
        // Regular file with the same name: refuse so we don't clobber a
        // user-managed binary. Symlinks we own: replace.
        if (s.isSymbolicLink() || s.isFile()) {
          unlinkSync(linkPath);
          replaced = true;
        }
      }
    } catch (err) {
      return {
        ok: false,
        path: linkPath,
        target: bundledEntry,
        replaced: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
  try {
    symlinkSync(bundledEntry, linkPath);
  } catch (err) {
    return {
      ok: false,
      path: linkPath,
      target: bundledEntry,
      replaced,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, path: linkPath, target: bundledEntry, replaced };
}

// ── Auto-update on launcher boot ──────────────────────────────────────────

export function bootstrapAutoUpdate(deps: AgentCommandRoutesDeps): void {
  try {
    const template = loadBundledTemplate();
    const result = runAutoUpdate(deps.pneumaVersion, template);
    if (result.updated.length > 0) {
      console.log(
        `[agent-commands] auto-updated ${result.updated.join(", ")} to ${deps.pneumaVersion}`,
      );
    }
  } catch (err) {
    console.warn(
      `[agent-commands] auto-update failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
