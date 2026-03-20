#!/usr/bin/env bun
/**
 * Pneuma Skills CLI entry point.
 *
 * Usage:
 *   pneuma <mode> --workspace /path/to/project [--port 17996] [--no-open]
 *
 * Driven by ModeManifest + AgentBackend — no hardcoded mode knowledge.
 */

import { resolve, dirname, join, basename } from "node:path";
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import * as p from "@clack/prompts";
import { startServer } from "../server/index.js";
import { createBackend, getDefaultBackendType } from "../backends/index.js";
import { installSkill } from "../server/skill-installer.js";
import { startFileWatcher } from "../server/file-watcher.js";
import { initShadowGit } from "../server/shadow-git.js";
import { loadModeManifest, listBuiltinModes, registerExternalMode } from "../core/mode-loader.js";
import type { ModeManifest } from "../core/types/mode-manifest.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import { applyTemplateParams } from "../server/skill-installer.js";
import { resolveMode as resolveModeSource, isExternalMode } from "../core/mode-resolver.js";
import type { ResolvedMode } from "../core/mode-resolver.js";
import { resolveBinary } from "../server/path-resolver.js";
import {
  normalizePersistedSession,
  normalizeSessionRecord,
  parseCliArgs,
  resolveWorkspaceBackendType,
  startViteDev,
  type PersistedSession,
  type SessionRecord,
} from "./pneuma-cli-helpers.js";

const PROJECT_ROOT = resolve(dirname(import.meta.path), "..");

// ── Session persistence ──────────────────────────────────────────────────────

function loadSession(workspace: string): PersistedSession | null {
  const filePath = join(workspace, ".pneuma", "session.json");
  try {
    const content = readFileSync(filePath, "utf-8");
    return normalizePersistedSession(JSON.parse(content));
  } catch {
    return null;
  }
}

function saveSession(workspace: string, session: PersistedSession): void {
  const dir = join(workspace, ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), JSON.stringify(session, null, 2));
}

function loadHistory(workspace: string): unknown[] {
  try {
    const content = readFileSync(join(workspace, ".pneuma", "history.json"), "utf-8");
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveHistory(workspace: string, history: unknown[]): void {
  const dir = join(workspace, ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "history.json"), JSON.stringify(history));
}

// ── Session registry (global, for launcher "Recent Sessions") ───────────────

const SESSIONS_REGISTRY = join(homedir(), ".pneuma", "sessions.json");

function loadSessionsRegistry(): SessionRecord[] {
  try {
    const records = JSON.parse(readFileSync(SESSIONS_REGISTRY, "utf-8"));
    return Array.isArray(records)
      ? records.map((record) => normalizeSessionRecord(record))
      : [];
  } catch {
    return [];
  }
}

function saveSessionsRegistry(records: SessionRecord[]): void {
  const dir = dirname(SESSIONS_REGISTRY);
  mkdirSync(dir, { recursive: true });
  writeFileSync(SESSIONS_REGISTRY, JSON.stringify(records, null, 2));
}

function recordSession(
  mode: string,
  displayName: string,
  workspace: string,
  backendType: AgentBackendType,
): void {
  const id = `${workspace}::${mode}`;
  const records = loadSessionsRegistry();
  const existing = records.findIndex((r) => r.id === id);
  const entry: SessionRecord = { id, mode, displayName, workspace, backendType, lastAccessed: Date.now() };
  if (existing >= 0) {
    records[existing] = entry;
  } else {
    records.unshift(entry);
  }
  // Cap at 50 entries
  saveSessionsRegistry(records.slice(0, 50));
}

// ── Init params persistence ──────────────────────────────────────────────────

function loadConfig(workspace: string): Record<string, number | string> | null {
  const filePath = join(workspace, ".pneuma", "config.json");
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function saveConfig(workspace: string, config: Record<string, number | string>): void {
  const dir = join(workspace, ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2));
}

async function promptInitParams(
  manifest: ModeManifest,
  defaultOverrides?: Record<string, string>,
): Promise<Record<string, number | string>> {
  const params: Record<string, number | string> = {};
  const initParams = manifest.init?.params;
  if (!initParams || initParams.length === 0) return params;

  p.log.step("Configuring mode parameters...");
  for (const param of initParams) {
    const effectiveDefault = defaultOverrides?.[param.name] ?? String(param.defaultValue);
    const suffix = param.description ? ` (${param.description})` : "";
    const answer = await p.text({
      message: `${param.label}${suffix}`,
      placeholder: effectiveDefault,
      defaultValue: effectiveDefault,
    });
    if (p.isCancel(answer)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    if (answer === "" || answer === String(param.defaultValue)) {
      params[param.name] = param.defaultValue;
    } else if (param.type === "number") {
      const num = Number(answer);
      params[param.name] = isNaN(num) ? param.defaultValue : num;
    } else {
      params[param.name] = answer;
    }
  }
  return params;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function checkBunVersion() {
  const MIN_BUN = "1.3.5"; // Required for Bun.spawn terminal (PTY) support
  const current = typeof Bun !== "undefined" ? Bun.version : null;
  if (!current) {
    p.log.warn("Not running under Bun. Pneuma requires Bun >= " + MIN_BUN);
    return;
  }
  const [curMajor, curMinor, curPatch] = current.split(".").map(Number);
  const [minMajor, minMinor, minPatch] = MIN_BUN.split(".").map(Number);
  const ok =
    curMajor > minMajor ||
    (curMajor === minMajor && curMinor > minMinor) ||
    (curMajor === minMajor && curMinor === minMinor && curPatch >= minPatch);
  if (!ok) {
    p.log.warn(
      `Bun ${current} detected, but >= ${MIN_BUN} is required. Terminal features may not work. Run \`bun upgrade\` to update.`
    );
  }
}

async function checkForUpdate(currentVersion: string) {
  if (process.env.PNEUMA_SKIP_UPDATE) return;
  // Skip interactive update prompt in non-interactive mode (e.g. Electron desktop)
  if (process.argv.includes("--no-prompt")) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://registry.npmjs.org/pneuma-skills/latest", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return;

    const { version: latest } = (await res.json()) as { version: string };
    const [curMaj, curMin, curPat] = currentVersion.split(".").map(Number);
    const [latMaj, latMin, latPat] = latest.split(".").map(Number);

    // Only prompt when the remote version is strictly newer
    const isNewer =
      latMaj > curMaj ||
      (latMaj === curMaj && latMin > curMin) ||
      (latMaj === curMaj && latMin === curMin && latPat > curPat);
    if (!isNewer) return;

    p.log.warn(`Update available: ${currentVersion} → ${latest}`);
    const shouldUpdate = await p.confirm({
      message: "Update to latest version?",
    });
    if (p.isCancel(shouldUpdate) || !shouldUpdate) return;

    p.log.step(`Updating to pneuma-skills@${latest}...`);
    const originalArgs = process.argv.slice(2);
    const child = Bun.spawn(["bunx", `pneuma-skills@${latest}`, ...originalArgs], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    await child.exited;
    process.exit(child.exitCode ?? 0);
  } catch {
    // Network error / timeout → silently skip
  }
}

function checkBackendRequirements(backendType: AgentBackendType) {
  if (backendType === "claude-code") {
    const resolved = resolveBinary("claude");
    if (!resolved) {
      p.cancel(
        "Claude Code CLI not found.\n" +
        "  Pneuma requires Claude Code to be installed and authenticated.\n" +
        "  Install: curl -fsSL https://claude.ai/install.sh | bash\n" +
        "  Quickstart: https://code.claude.com/docs/en/quickstart"
      );
      process.exit(1);
    }
    return;
  }

  if (backendType === "codex") {
    const resolved = resolveBinary("codex");
    if (!resolved) {
      p.cancel(
        "Codex CLI not found.\n" +
        "  Pneuma requires Codex to be installed and authenticated.\n" +
        "  Install: npm install -g @openai/codex"
      );
      process.exit(1);
    }
    return;
  }

  p.cancel(`Backend "${backendType}" is not implemented yet.`);
  process.exit(1);
}

async function handleEvolveCommand(args: string[]) {
  let workspace = process.cwd();
  let modeName = "";
  let subAction = ""; // "apply", "rollback", "show", or "" (propose)
  let backendType: AgentBackendType = getDefaultBackendType();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace" && i + 1 < args.length) {
      workspace = resolve(args[++i]);
    } else if (arg === "--mode" && i + 1 < args.length) {
      modeName = args[++i];
    } else if (arg === "--backend" && i + 1 < args.length) {
      backendType = args[++i] as AgentBackendType;
    } else if (["apply", "rollback", "show", "list"].includes(arg)) {
      subAction = arg;
    }
  }

  workspace = resolve(workspace);

  const {
    loadProposal, loadLatestProposal, listProposals,
    applyProposal, rollbackProposal, formatProposalForDisplay,
  } = await import("../server/evolution-proposal.js");

  if (subAction === "list") {
    const proposals = listProposals(workspace);
    if (proposals.length === 0) {
      p.log.info("No evolution proposals found.");
    } else {
      p.log.info(`${proposals.length} proposal(s):`);
      for (const prop of proposals) {
        const changesCount = prop.changes.length;
        p.log.message(`  ${prop.id}  [${prop.status}]  ${prop.mode}  ${changesCount} change(s)  ${prop.createdAt}`);
      }
    }
    return;
  }

  if (subAction === "show") {
    const proposal = loadLatestProposal(workspace);
    if (!proposal) {
      p.log.error("No proposals found. Run `pneuma evolve` first.");
      process.exit(1);
    }
    console.log(formatProposalForDisplay(proposal));
    return;
  }

  if (subAction === "apply") {
    const proposal = loadLatestProposal(workspace);
    if (!proposal) {
      p.log.error("No proposals found. Run `pneuma evolve` first.");
      process.exit(1);
    }
    if (proposal.status !== "pending") {
      p.log.error(`Proposal ${proposal.id} is already ${proposal.status}.`);
      process.exit(1);
    }

    console.log(formatProposalForDisplay(proposal));
    console.log("");

    const confirm = await p.confirm({ message: "Apply this proposal?" });
    if (p.isCancel(confirm) || !confirm) {
      p.log.info("Cancelled.");
      return;
    }

    const result = applyProposal(workspace, proposal.id);
    if (result.success) {
      p.log.success(`Applied ${result.appliedFiles.length} file(s). Use \`pneuma evolve rollback\` to revert.`);
      for (const f of result.appliedFiles) {
        p.log.step(`  ✓ ${f}`);
      }
    } else {
      p.log.error(`Apply failed: ${result.error}`);
    }
    return;
  }

  if (subAction === "rollback") {
    const proposals = listProposals(workspace);
    const applied = proposals.find(p => p.status === "applied");
    if (!applied) {
      p.log.error("No applied proposals to rollback.");
      process.exit(1);
    }

    const confirm = await p.confirm({ message: `Rollback proposal ${applied.id}?` });
    if (p.isCancel(confirm) || !confirm) {
      p.log.info("Cancelled.");
      return;
    }

    const result = rollbackProposal(workspace, applied.id);
    if (result.success) {
      p.log.success(`Rolled back ${result.restoredFiles.length} file(s).`);
      for (const f of result.restoredFiles) {
        p.log.step(`  ✓ ${f}`);
      }
    } else {
      p.log.error(`Rollback failed: ${result.error}`);
    }
    return;
  }

  // Default: launch evolution agent as a standard pneuma session
  let port = 0;
  let noOpen = false;
  let noPrompt = false;
  let debug = false;
  let forceDev = false;

  // Re-parse flags from the evolve subcommand args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && i + 1 < args.length) {
      port = Number(args[++i]);
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--no-prompt") {
      noPrompt = true;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg === "--dev") {
      forceDev = true;
    }
  }

  // Resolve target mode from --mode flag or existing session
  if (!modeName) {
    const session = loadSession(workspace);
    if (session?.mode) {
      modeName = session.mode;
      backendType = session.backendType;
    } else {
      // Check if targetMode was passed via config (from Launcher)
      const configPath = join(workspace, ".pneuma", "config.json");
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        if (config.targetMode) modeName = config.targetMode;
      } catch {}
    }
    if (!modeName) {
      p.cancel("No mode specified and no .pneuma/session.json found.\nUse: pneuma evolve --mode <mode> --workspace <path>");
      process.exit(1);
    }
  }

  checkBackendRequirements(backendType);

  // Evolution mode only supports Claude Code backend
  const evolveManifestCheck = await loadModeManifest("evolve");
  if (evolveManifestCheck.supportedBackends && !evolveManifestCheck.supportedBackends.includes(backendType)) {
    p.cancel(
      `Evolve mode only supports backends: ${evolveManifestCheck.supportedBackends.join(", ")}. ` +
      `Selected backend "${backendType}" is not compatible.`
    );
    process.exit(1);
  }

  // 1. Resolve target mode and build evolution data
  let resolved: ResolvedMode;
  try {
    resolved = await resolveModeSource(modeName, PROJECT_ROOT);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.cancel(`Failed to resolve mode "${modeName}": ${msg}`);
    process.exit(1);
  }

  if (resolved.type !== "builtin") {
    registerExternalMode(resolved.name, resolved.path);
  }

  let manifest: ModeManifest;
  try {
    manifest = await loadModeManifest(resolved.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.cancel(`Failed to load mode "${resolved.name}": ${msg}`);
    process.exit(1);
  }

  p.log.step(`Evolving skill for ${manifest.displayName} mode...`);
  p.log.info(`Workspace: ${workspace}`);

  // 2. Build evolution prompt + metadata, save metadata as initParams
  const { buildEvolutionPrompt, buildEvolutionMetadata } = await import("../server/evolution-agent.js");
  const evolutionPrompt = buildEvolutionPrompt({ workspace, manifest });
  const metadata = buildEvolutionMetadata({ workspace, manifest });

  // Save metadata to .pneuma/config.json so the viewer dashboard can read it
  const pneumaDir = join(workspace, ".pneuma");
  mkdirSync(pneumaDir, { recursive: true });
  writeFileSync(join(pneumaDir, "config.json"), JSON.stringify(metadata, null, 2));

  // 3a. Install target mode's skill (so agent can read the current skill to augment)
  const targetModeSourceDir = resolved.type === "builtin"
    ? join(PROJECT_ROOT, "modes", resolved.name)
    : resolved.path;
  installSkill(workspace, manifest.skill, targetModeSourceDir);

  // 3b. Install evolve skill (so agent has dashboard context in SKILL.md)
  const evolveManifest = await loadModeManifest("evolve");
  const evolveModeSourceDir = join(PROJECT_ROOT, "modes", "evolve");
  installSkill(workspace, evolveManifest.skill, evolveModeSourceDir, {}, evolveManifest.viewerApi);

  // 4. Determine dev vs production mode
  const distDir = resolve(PROJECT_ROOT, "dist");
  const isDev = forceDev || !existsSync(join(distDir, "index.html"));
  const effectivePort = port || (isDev ? 17007 : 17996);

  // 5. Start server with evolution routes
  const { server, wsBridge, port: actualPort } = startServer({
    port: effectivePort,
    workspace,
    watchPatterns: [],
    ...(isDev ? {} : { distDir }),
    modeName: "evolve",
    projectRoot: PROJECT_ROOT,
    debug,
    forceDev: isDev,
    initParams: metadata as unknown as Record<string, string | number>,
  });

  // 6. Launch agent via the selected backend (fresh session, bypassPermissions)
  const backend = createBackend(backendType, actualPort);
  const session = backend.launch({
    cwd: workspace,
    permissionMode: "bypassPermissions",
  });

  p.log.info(`Agent session: ${session.sessionId}`);
  wsBridge.getOrCreateSession(session.sessionId, backendType);

  // Wire Codex adapter if applicable
  if (backendType === "codex") {
    const { CodexBackend } = await import("../backends/codex/index.js");
    if (backend instanceof CodexBackend) {
      const existingAdapter = backend.getAdapter(session.sessionId);
      if (existingAdapter) {
        wsBridge.attachCodexAdapter(session.sessionId, existingAdapter);
      }
      backend.onAdapterCreated((sid, adapter) => {
        if (sid === session.sessionId) {
          wsBridge.attachCodexAdapter(sid, adapter);
        }
      });
    }
  }

  // 7. Inject evolution prompt as greeting (dynamic, not from manifest)
  wsBridge.injectGreeting(session.sessionId, evolutionPrompt);
  console.log("[pneuma] Sent evolution prompt to agent");

  // 8. Start Vite (dev) or serve dist (prod), open browser
  let viteProc: ReturnType<typeof Bun.spawn> | null = null;
  let browserPort = actualPort;

  if (isDev) {
    const VITE_PORT = 17996;
    p.log.step(`Starting Vite dev server on port ${VITE_PORT}...`);
    const viteResult = await startViteDev({
      projectRoot: PROJECT_ROOT,
      port: VITE_PORT,
      env: { ...process.env as Record<string, string>, VITE_API_PORT: String(actualPort) },
    });
    viteProc = viteResult.proc;
    browserPort = viteResult.port;
  }

  // 9. Open browser with evolution mode dashboard
  const debugParam = debug ? "&debug=1" : "";
  const browserUrl = `http://localhost:${browserPort}?session=${session.sessionId}&mode=evolve${debugParam}`;
  console.log(`[pneuma] ready ${browserUrl}`);

  if (!noOpen) {
    p.log.success(`Ready → ${browserUrl}`);
    try {
      if (process.platform === "win32") {
        Bun.spawn(["cmd", "/c", "start", "", browserUrl], { stdout: "ignore", stderr: "ignore" });
      } else {
        const opener = process.platform === "darwin" ? "open" : "xdg-open";
        Bun.spawn([opener, browserUrl], { stdout: "ignore", stderr: "ignore" });
      }
    } catch {
      p.log.warn(`Could not open browser. Visit: ${browserUrl}`);
    }
  }

  // 10. Graceful shutdown
  const shutdown = async () => {
    viteProc?.kill();
    await backend.killAll();
    server.stop(true);
    p.outro("Goodbye!");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  const pkgPath = join(PROJECT_ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const parsedArgs = parseCliArgs(process.argv);

  if (parsedArgs.showVersion) {
    console.log(`pneuma-skills v${pkg.version}`);
    return;
  }

  if (parsedArgs.showHelp) {
    console.log(`pneuma-skills [mode] [options]

Modes:
  (no argument)                Open the Launcher (marketplace UI)
  webcraft                     Web design with Impeccable.style
  slide                        HTML presentations
  doc                          Markdown with live preview
  draw                         Excalidraw canvas
  illustrate                   AI illustration studio
  mode-maker                   Create custom modes with AI
  evolve                       Launch the Evolution Agent
  /path/to/mode                Load from a local directory
  github:user/repo             Load from GitHub
  https://...tar.gz            Load from URL

Options:
  --workspace <path>           Target workspace directory (default: cwd)
  --port <number>              Preferred server port
  --backend <type>             Agent backend to launch (default: claude-code)
  --no-open                    Don't auto-open the browser
  --no-prompt                  Non-interactive mode
  --skip-skill                 Skip skill installation
  --debug                      Enable debug mode
  --dev                        Force dev mode (Vite)
  --help, -h                   Show this help
  --version, -v                Show version`);
    return;
  }

  p.intro(`pneuma-skills v${pkg.version}`);

  checkBunVersion();
  await checkForUpdate(pkg.version);

  // History subcommand — export / open
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "history") {
    if (rawArgs[1] === "export") {
      let histWorkspace = process.cwd();
      let output: string | undefined;
      let title: string | undefined;
      for (let i = 2; i < rawArgs.length; i++) {
        if (rawArgs[i] === "--workspace" && i + 1 < rawArgs.length) histWorkspace = resolve(rawArgs[++i]);
        else if (rawArgs[i] === "--output" && i + 1 < rawArgs.length) output = resolve(rawArgs[++i]);
        else if (rawArgs[i] === "--title" && i + 1 < rawArgs.length) title = rawArgs[++i];
      }
      const { exportHistory } = await import("../server/history-export.js");
      const result = await exportHistory(histWorkspace, { output, title });
      console.log(`Exported ${result.messageCount} messages, ${result.checkpointCount} checkpoints`);
      console.log(`Output: ${result.outputPath}`);
      return;
    }
    if (rawArgs[1] === "share") {
      let histWorkspace = process.cwd();
      let title: string | undefined;
      for (let i = 2; i < rawArgs.length; i++) {
        if (rawArgs[i] === "--workspace" && i + 1 < rawArgs.length) histWorkspace = resolve(rawArgs[++i]);
        else if (rawArgs[i] === "--title" && i + 1 < rawArgs.length) title = rawArgs[++i];
      }
      const { pushHistory } = await import("../snapshot/history-share.js");
      await pushHistory(histWorkspace, title);
      return;
    }
    if (rawArgs[1] === "open") {
      const target = rawArgs[2];
      if (!target) {
        console.error("Usage: pneuma history open <path-or-url>");
        process.exit(1);
      }
      let filePath: string;
      if (target.startsWith("http://") || target.startsWith("https://")) {
        const { pullHistory } = await import("../snapshot/history-share.js");
        filePath = await pullHistory(target);
      } else {
        filePath = resolve(target);
      }
      console.log(`\nReplay package ready: ${filePath}`);
      console.log(`\nTo replay in a running session:`);
      console.log(`  POST /api/replay/load with {"path": "${filePath}"}`);
      return;
    }
  }

  // Snapshot subcommand — intercept before mode validation
  if (rawArgs[0] === "snapshot") {
    const { runSnapshot } = await import("../snapshot/index.js");
    await runSnapshot(rawArgs.slice(1));
    return;
  }

  // Mode subcommand — publish, list
  if (rawArgs[0] === "mode") {
    if (rawArgs[1] === "publish") {
      let workspace = process.cwd();
      let force = false;
      for (let i = 2; i < rawArgs.length; i++) {
        if (rawArgs[i] === "--workspace" && i + 1 < rawArgs.length) {
          workspace = resolve(rawArgs[++i]);
        } else if (rawArgs[i] === "--force") {
          force = true;
        }
      }
      const { publishMode } = await import("../snapshot/mode-publish.js");
      await publishMode(workspace, { force });
      return;
    }
    if (rawArgs[1] === "list") {
      const { getCredentials, listModes } = await import("../snapshot/r2.js");
      const creds = await getCredentials();
      const modes = await listModes(creds);
      // Filter to only latest.json entries for a clean listing
      const latestEntries = modes.filter((m) => m.key.endsWith("/latest.json"));
      if (latestEntries.length === 0) {
        console.log("[mode] No published modes found.");
      } else {
        console.log(`[mode] ${latestEntries.length} published mode(s):\n`);
        for (const entry of latestEntries) {
          const name = entry.key.replace("modes/", "").replace("/latest.json", "");
          const date = new Date(entry.lastModified).toLocaleString();
          console.log(`  ${name}`);
          console.log(`    Updated: ${date}\n`);
        }
      }
      return;
    }
    if (rawArgs[1] === "add") {
      const specifier = rawArgs[2];
      if (!specifier) {
        p.cancel("Usage: pneuma mode add <url|github:user/repo>");
        process.exit(1);
      }
      try {
        const resolved = await resolveModeSource(specifier, PROJECT_ROOT);
        if (resolved.type === "builtin") {
          p.log.info(`"${resolved.name}" is a built-in mode — no need to add.`);
        } else {
          p.log.success(`Mode "${resolved.name}" added at ${resolved.path}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        p.cancel(`Failed to add mode: ${msg}`);
        process.exit(1);
      }
      return;
    }
    // Unknown mode subcommand — fall through to normal mode resolution
  }

  // Evolve subcommand — AI-native skill evolution
  // Find "evolve" in rawArgs (may be preceded by flags like --dev)
  const evolveIdx = rawArgs.findIndex(a => a === "evolve");
  if (evolveIdx !== -1) {
    // Pass all args except "evolve" itself to the handler
    const evolveArgs = [...rawArgs.slice(0, evolveIdx), ...rawArgs.slice(evolveIdx + 1)];
    await handleEvolveCommand(evolveArgs);
    return;
  }

  const { mode, port, backendType, noOpen, debug, forceDev, noPrompt, skipSkill, replaySource } = parsedArgs;
  let { workspace, replayPackage } = parsedArgs;

  // Launcher mode — no mode arg → start marketplace UI
  if (!mode) {
    const { homedir } = await import("node:os");
    const launcherPort = port || 17996;
    const distDir = resolve(PROJECT_ROOT, "dist");
    const isDev = forceDev || !existsSync(join(distDir, "index.html"));
    const { server, port: actualPort, childProcesses } = startServer({
      port: isDev ? 17007 : launcherPort,
      workspace: homedir(),
      watchPatterns: [],
      ...(isDev ? {} : { distDir }),
      launcherMode: true,
      projectRoot: PROJECT_ROOT,
      debug,
      forceDev: isDev,
    });

    const killChildProcesses = () => {
      if (!childProcesses) return;
      for (const { proc } of childProcesses.values()) {
        try { proc.kill(); } catch {}
      }
      childProcesses.clear();
    };

    let browserPort = actualPort;
    if (isDev) {
      const VITE_PORT = 17996;
      p.log.step(`Starting Vite dev server on port ${VITE_PORT}...`);
      const viteResult = await startViteDev({
        projectRoot: PROJECT_ROOT,
        port: VITE_PORT,
        env: { ...process.env as Record<string, string>, VITE_API_PORT: String(actualPort) },
      });
      const viteProc = viteResult.proc;
      browserPort = viteResult.port;

      process.on("SIGINT", () => { killChildProcesses(); viteProc.kill(); server.stop(true); process.exit(0); });
      process.on("SIGTERM", () => { killChildProcesses(); viteProc.kill(); server.stop(true); process.exit(0); });
    } else {
      process.on("SIGINT", () => { killChildProcesses(); server.stop(true); process.exit(0); });
      process.on("SIGTERM", () => { killChildProcesses(); server.stop(true); process.exit(0); });
    }

    const url = `http://localhost:${browserPort}`;
    if (!noOpen) {
      try {
        if (process.platform === "win32") {
          Bun.spawn(["cmd", "/c", "start", "", url], { stdout: "ignore", stderr: "ignore" });
        } else {
          const opener = process.platform === "darwin" ? "open" : "xdg-open";
          Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
        }
      } catch { }
    }
    p.log.success(`Marketplace → ${url}`);
    return;
  }

  // Resolve mode source (builtin, local path, or github clone)
  let resolved: ResolvedMode;
  try {
    resolved = await resolveModeSource(mode, PROJECT_ROOT);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.cancel(`Failed to resolve mode "${mode}": ${msg}`);
    process.exit(1);
  }

  // For external modes, register them in the mode-loader before loading
  if (resolved.type !== "builtin") {
    registerExternalMode(resolved.name, resolved.path);
    p.log.info(`External mode "${resolved.name}" loaded from ${resolved.path}`);
  }

  // Load mode manifest (no React deps — backend safe)
  // Use resolved.name for lookup since external modes are registered under that name
  const modeName = resolved.name;
  let manifest: ModeManifest;
  try {
    manifest = await loadModeManifest(modeName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.cancel(`Failed to load mode "${modeName}": ${msg}`);
    process.exit(1);
  }

  // Verify the selected backend is available before proceeding
  checkBackendRequirements(backendType);

  // Check if the mode supports the selected backend
  if (manifest.supportedBackends && manifest.supportedBackends.length > 0) {
    if (!manifest.supportedBackends.includes(backendType)) {
      p.cancel(
        `Mode "${modeName}" only supports backends: ${manifest.supportedBackends.join(", ")}. ` +
        `Selected backend "${backendType}" is not compatible.`
      );
      process.exit(1);
    }
  }

  if (!existsSync(workspace)) {
    if (noPrompt) {
      mkdirSync(workspace, { recursive: true });
      p.log.success(`Created workspace: ${workspace}`);
    } else {
      const shouldCreate = await p.confirm({
        message: `Workspace does not exist: ${workspace}\n  Create it?`,
      });
      if (p.isCancel(shouldCreate) || !shouldCreate) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      mkdirSync(workspace, { recursive: true });
      p.log.success(`Created workspace: ${workspace}`);
    }
  }

  p.log.info(`Mode: ${manifest.displayName} (${modeName})`);
  p.log.info(`Workspace: ${workspace}`);

  // 0.5 Resolve init params (interactive on first run, then cached)
  let resolvedParams: Record<string, number | string> = {};
  if (manifest.init?.params && manifest.init.params.length > 0) {
    const cached = loadConfig(workspace);
    if (cached) {
      resolvedParams = cached;
      p.log.step("Loaded init params from .pneuma/config.json");
    } else if (noPrompt) {
      // No-prompt mode (launched from marketplace) — use defaults
      for (const param of manifest.init!.params!) {
        resolvedParams[param.name] = param.defaultValue;
      }
      saveConfig(workspace, resolvedParams);
      p.log.step("Using default init params (no-prompt mode)");
    } else {
      // Derive smart defaults from workspace directory name
      const wsBasename = basename(workspace);
      const defaultOverrides: Record<string, string> = {};
      if (wsBasename && wsBasename !== "." && wsBasename !== "/") {
        defaultOverrides.modeName = wsBasename;
        defaultOverrides.displayName = wsBasename
          .split(/[-_]/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
      }
      resolvedParams = await promptInitParams(manifest, defaultOverrides);
      saveConfig(workspace, resolvedParams);
      p.log.step("Saved init params to .pneuma/config.json");
    }
    // Compute derived params (e.g. imageGenEnabled from API keys)
    if (manifest.init.deriveParams) {
      resolvedParams = manifest.init.deriveParams(resolvedParams);
    }
  }

  // 1. Install skill + inject CLAUDE.md (driven by manifest)
  // Use resolved path for external modes, PROJECT_ROOT/modes/{name} for builtin
  const modeSourceDir = resolved.path;
  const skillTarget = join(workspace, ".claude", "skills", manifest.skill.installName);
  let skipSkillInstall = skipSkill || !!replayPackage; // Skip for replay — installed on Continue Work

  // Compute the effective API port (same logic as server startup in step 3)
  // Dev mode: backend on 17007, Prod mode: backend on 17996
  const distDir = resolve(PROJECT_ROOT, "dist");
  const isDev = forceDev || !existsSync(join(distDir, "index.html"));
  const effectiveApiPort = port || (isDev ? 17007 : 17996);

  if (!skipSkillInstall && existsSync(skillTarget)) {
    if (noPrompt) {
      // Auto-replace when launched from marketplace
    } else {
      const shouldReplace = await p.confirm({
        message: "Skill already exists. Replace with latest?",
      });
      if (p.isCancel(shouldReplace)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      if (!shouldReplace) {
        skipSkillInstall = true;
      }
    }
  }

  if (!skipSkillInstall) {
    // Validate skill dependencies before install
    if (manifest.skill.skillDependencies?.length) {
      const missing: string[] = [];
      for (const dep of manifest.skill.skillDependencies) {
        if (!dep.sourceDir) {
          missing.push(`${dep.name}: missing sourceDir`);
        } else if (!existsSync(join(modeSourceDir, dep.sourceDir))) {
          missing.push(`${dep.name}: ${dep.sourceDir} not found`);
        }
      }
      if (missing.length > 0) {
        p.log.error("Skill dependencies incomplete:");
        for (const m of missing) p.log.warn(`  ${m}`);
        p.log.info("Skill files must be bundled in the mode package before running.");
        p.cancel("Fix the mode package and try again.");
        process.exit(1);
      }
    }

    p.log.step("Installing skill and preparing environment...");
    installSkill(workspace, manifest.skill, modeSourceDir, resolvedParams, manifest.viewerApi, backendType);
    // Record installed skill version for update detection
    const skillVersionPath = join(workspace, ".pneuma", "skill-version.json");
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
    writeFileSync(skillVersionPath, JSON.stringify({ mode: modeName, version: manifest.version }));
  }

  // Initialize shadow git for checkpoint tracking (skip for replay — done on Continue Work)
  if (!replayPackage) {
    await initShadowGit(workspace);
  }

  // 1.5 Seed default content if workspace has no meaningful files (skip for replay)
  if (!replayPackage && manifest.init && manifest.init.contentCheckPattern) {
    const checkPattern = manifest.init.contentCheckPattern;
    const contentFiles = Array.from(
      new Bun.Glob(checkPattern).scanSync({ cwd: workspace, absolute: false })
    ).filter((f) => f !== "CLAUDE.md" && !f.startsWith(".claude/"));

    const hasContent = contentFiles.some((f) => {
      try {
        return readFileSync(join(workspace, f), "utf-8").trim().length > 0;
      } catch { return false; }
    });

    if (!hasContent && manifest.init.seedFiles) {
      const hasParams = Object.keys(resolvedParams).length > 0;
      // For builtin modes, seed paths are relative to PROJECT_ROOT
      // For external modes, seed paths are relative to the mode package directory
      const seedBase = resolved.type === "builtin" ? PROJECT_ROOT : resolved.path;
      for (const [src, dst] of Object.entries(manifest.init.seedFiles)) {
        const resolvedSrc = hasParams ? applyTemplateParams(src, resolvedParams) : src;
        const srcPath = join(seedBase, resolvedSrc);
        if (!existsSync(srcPath)) continue;

        // Directory-based seeding: if source ends with /, copy all files recursively
        if (resolvedSrc.endsWith("/") && statSync(srcPath).isDirectory()) {
          const glob = new Bun.Glob("**/*");
          for (const relFile of glob.scanSync({ cwd: srcPath, absolute: false })) {
            const fileSrc = join(srcPath, relFile);
            if (statSync(fileSrc).isDirectory()) continue;
            const fileDst = join(workspace, dst, relFile);
            mkdirSync(dirname(fileDst), { recursive: true });
            const isBinary = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp[34]|wav|ogg|zip|gz|tar|pdf)$/i.test(relFile);
            if (hasParams && !isBinary) {
              let content = readFileSync(fileSrc, "utf-8");
              content = applyTemplateParams(content, resolvedParams);
              writeFileSync(fileDst, content, "utf-8");
            } else {
              copyFileSync(fileSrc, fileDst);
            }
          }
          p.log.step(`Seeded workspace with ${dst}`);
        } else {
          const dstPath = join(workspace, dst);
          mkdirSync(dirname(dstPath), { recursive: true });
          if (hasParams) {
            // Read, apply template params, then write
            let content = readFileSync(srcPath, "utf-8");
            content = applyTemplateParams(content, resolvedParams);
            writeFileSync(dstPath, content, "utf-8");
          } else {
            copyFileSync(srcPath, dstPath);
          }
          p.log.step(`Seeded workspace with ${dst}`);
        }
      }

      // Auto-install deps if package.json was seeded
      if (existsSync(join(workspace, "package.json"))) {
        p.log.step("Installing dependencies...");
        const proc = Bun.spawn(["bun", "install"], {
          cwd: workspace,
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
      }
    }
  }

  // 2. Detect dev vs production mode (distDir, isDev computed earlier for port)
  if (isDev) {
    p.log.info("Development mode (serving via Vite)");
  } else {
    p.log.info("Production mode (serving built assets)");
  }

  // 2.5 Pre-compile external mode viewer for production serving
  let modeBundleDir: string | undefined;
  if (!isDev && resolved.type !== "builtin") {
    const existingBuild = join(resolved.path, ".build", "pneuma-mode.js");
    if (existsSync(existingBuild)) {
      // Use pre-built bundle from publish (third-party deps already inlined)
      modeBundleDir = join(resolved.path, ".build");
      p.log.step("Using pre-built mode viewer bundle");
    } else {
      // Build from source (local development, unpublished modes)
      const buildDir = join(resolved.path, ".build");
      const modeEntry = join(resolved.path, "pneuma-mode.ts");
      const manifestEntry = join(resolved.path, "manifest.ts");
      const entrypoints = [modeEntry, manifestEntry].filter((e) => existsSync(e));
      if (entrypoints.length > 0) {
        p.log.step("Compiling mode viewer for production...");
        // Resolve symlinks (macOS /tmp → /private/tmp) so importer paths match
        const realModePath = realpathSync(resolved.path);
        const result = await Bun.build({
          entrypoints,
          outdir: buildDir,
          target: "browser",
          format: "esm",
          external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
          throw: false,
          plugins: [{
            name: "pneuma-mode-resolve",
            setup(build) {
              // Redirect imports from external mode files to pneuma project root
              const externals = new Set(["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"]);
              build.onResolve({ filter: /.+/ }, (args) => {
                if (!args.importer || (!args.importer.startsWith(realModePath) && !args.importer.startsWith(resolved.path))) return;
                if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
                  // Let Bun handle external modules (don't resolve them to file paths)
                  if (externals.has(args.path)) return;
                  // Bare specifier — resolve from project's or mode's node_modules
                  try {
                    return { path: require.resolve(args.path, { paths: [resolved.path, join(PROJECT_ROOT, "node_modules")] }) };
                  } catch { /* let Bun handle it */ }
                  return;
                }
                const abs = resolve(dirname(args.importer), args.path);
                // Redirect imports that reference pneuma project internals (core/, src/)
                for (const prefix of ["/core/", "/src/"]) {
                  const idx = abs.indexOf(prefix);
                  if (idx !== -1 && !abs.startsWith(PROJECT_ROOT)) {
                    return { path: PROJECT_ROOT + abs.slice(idx) };
                  }
                }
              });
            },
          }],
        });
        if (result.success) {
          modeBundleDir = buildDir;
          p.log.step("Mode viewer compiled successfully");
        } else {
          p.log.warn("Mode viewer compilation failed — viewer may not load");
          for (const log of result.logs) {
            p.log.warn(`  ${log.message}`);
          }
        }
      }
    }
  }

  // 2.8 Handle --replay-source: export from existing workspace, set replayPackage
  if (replaySource && !replayPackage) {
    p.log.step(`Exporting replay data from: ${replaySource}`);
    const { exportHistory } = await import("../server/history-export.js");
    try {
      const result = await exportHistory(replaySource, { title: `Replay of ${modeName}` });
      replayPackage = result.outputPath;
      p.log.info(`Exported replay package: ${replayPackage}`);
    } catch (err: any) {
      p.log.warn(`Failed to export replay from source: ${err.message}. Continuing without replay.`);
    }
  }

  // 3. Start server
  //    Dev mode:  backend on 17007, Vite on 17996 (user-facing)
  //    Prod mode: backend on 17996 (serves everything)
  const serverPort = effectiveApiPort;
  const { server, wsBridge, port: actualPort, modeMakerCleanup, onReplayContinue } = startServer({
    port: serverPort,
    workspace,
    watchPatterns: manifest.viewer.watchPatterns,
    ...(replayPackage ? { replayPackagePath: replayPackage, replayMode: true } : {}),
    ...(isDev ? {} : { distDir }),
    ...(Object.keys(resolvedParams).length > 0 ? { initParams: resolvedParams } : {}),
    // Pass external mode info for the /api/mode-info endpoint
    ...(resolved.type !== "builtin"
      ? { externalMode: { name: resolved.name, path: resolved.path, type: resolved.type } }
      : {}),
    ...(modeBundleDir ? { modeBundleDir } : {}),
    projectRoot: PROJECT_ROOT,
    modeName,
    layout: manifest.layout,
    window: manifest.window,
  });

  // 4. Launch Agent backend or set up replay mode
  let sessionId: string;
  let backend: ReturnType<typeof createBackend> | null = null;
  let historyInterval: ReturnType<typeof setInterval> | null = null;

  if (replayPackage) {
    // Replay mode — no agent, no greeting, no file watcher
    // But real workspace + real session for Continue Work transition
    sessionId = crypto.randomUUID();
    wsBridge.getOrCreateSession(sessionId, backendType);

    // Persist session
    saveSession(workspace, {
      sessionId,
      mode: modeName,
      backendType,
      createdAt: Date.now(),
    });

    // Register Continue Work callback — launches agent when user clicks Continue
    onReplayContinue!(async () => {
      console.log(`[pneuma] Continue Work triggered. sessionId=${sessionId}, workspace=${workspace}`);

      // Restore API keys from global storage into workspace config
      if (manifest.skill.envMapping) {
        const { getApiKeys } = await import("../server/share.js");
        const globalKeys = getApiKeys();
        for (const [envVar, paramName] of Object.entries(manifest.skill.envMapping)) {
          if (globalKeys[envVar] && !resolvedParams[paramName]) {
            resolvedParams[paramName] = globalKeys[envVar];
          }
        }
        // Re-derive params (e.g. imageGenEnabled)
        if (manifest.init?.deriveParams) {
          resolvedParams = manifest.init.deriveParams(resolvedParams);
        }
        // Save config with restored keys
        saveConfig(workspace, resolvedParams);
      }

      p.log.step("Continue Work: installing skill...");
      installSkill(workspace, manifest.skill, modeSourceDir, resolvedParams, manifest.viewerApi, backendType);

      // Record installed skill version
      const skillVersionPath = join(workspace, ".pneuma", "skill-version.json");
      writeFileSync(skillVersionPath, JSON.stringify({ mode: modeName, version: manifest.version }));

      // Initialize shadow-git for new session (prepareWorkspaceForContinue already does this)
      // Launch agent backend
      backend = createBackend(backendType, actualPort);
      const agentEnv: Record<string, string> = {
        PNEUMA_API: `http://localhost:${actualPort}`,
      };
      if (manifest.skill.envMapping) {
        for (const [envVar, paramName] of Object.entries(manifest.skill.envMapping)) {
          const value = resolvedParams[paramName];
          if (value !== undefined && String(value).trim() !== "") {
            agentEnv[envVar] = String(value);
          }
        }
      }
      // Reuse the replay session ID so the browser WS stays connected
      const agentSession = backend.launch({
        cwd: workspace,
        sessionId: sessionId,
        permissionMode: manifest.agent?.permissionMode,
        env: agentEnv,
      });
      console.log(`[pneuma] Agent launched: ${agentSession.sessionId}`);

      // The WS session already exists from replay; just update backend type
      wsBridge.getOrCreateSession(sessionId, backendType);

      // Wire CLI session ID persistence
      wsBridge.onCLISessionIdReceived((sid, agentSessionId) => {
        backend!.setAgentSessionId(sid, agentSessionId);
        const persisted = loadSession(workspace);
        if (persisted && persisted.sessionId === sid) {
          persisted.agentSessionId = agentSessionId;
          saveSession(workspace, persisted);
        }
      });

      // Wire Codex adapter if needed
      if (backendType === "codex") {
        const { CodexBackend } = await import("../backends/codex/index.js");
        if (backend instanceof CodexBackend) {
          const existingAdapter = backend.getAdapter(sessionId);
          if (existingAdapter) wsBridge.attachCodexAdapter(sessionId, existingAdapter);
          backend.onAdapterCreated((sid, adapter) => {
            if (sid === sessionId) wsBridge.attachCodexAdapter(sid, adapter);
          });
        }
      }

      // Persist session (keep same sessionId)
      saveSession(workspace, {
        sessionId,
        mode: modeName,
        backendType,
        createdAt: Date.now(),
      });
      recordSession(modeName, manifest.displayName, workspace, backendType);

      // Start file watcher
      startFileWatcher(workspace, manifest.viewer, (files) => {
        wsBridge.broadcastToSession(sessionId, { type: "content_update", files });
      });

      // Start history persistence
      historyInterval = setInterval(() => {
        const history = wsBridge.getMessageHistory(sessionId);
        if (history.length > 0) saveHistory(workspace, history);
      }, 5_000);

      // Send greeting for continued session
      if (manifest.agent?.greeting) {
        wsBridge.injectGreeting(sessionId, manifest.agent.greeting);
      }

      p.log.success("Continue Work: agent launched, session active");
    });

    p.log.info(`Replay mode: ${replayPackage}`);
  } else {
    // Normal mode — launch agent backend (selected at startup, fixed for the session lifetime)
    const existing = loadSession(workspace);
    const backendSelection = resolveWorkspaceBackendType(backendType, existing);
    if (backendSelection.mismatchMessage) {
      p.cancel(backendSelection.mismatchMessage);
      process.exit(1);
    }
    const sessionBackendType = backendSelection.backendType;

    backend = createBackend(sessionBackendType, actualPort);

    // When the CLI reports its internal session_id, persist it
    wsBridge.onCLISessionIdReceived((sid, agentSessionId) => {
      backend!.setAgentSessionId(sid, agentSessionId);
      // Persist to .pneuma/session.json
      const persisted = loadSession(workspace);
      if (persisted && persisted.sessionId === sid) {
        persisted.agentSessionId = agentSessionId;
        saveSession(workspace, persisted);
        console.log(`[pneuma] Saved agentSessionId for resume: ${agentSessionId}`);
      }
    });

    let resuming = false;

    // Build env map from envMapping (init param values → env vars for agent process)
    const agentEnv: Record<string, string> = {
      PNEUMA_API: `http://localhost:${actualPort}`,
    };
    if (manifest.skill.envMapping) {
      for (const [envVar, paramName] of Object.entries(manifest.skill.envMapping)) {
        const value = resolvedParams[paramName];
        if (value !== undefined && String(value).trim() !== "") {
          agentEnv[envVar] = String(value);
        }
      }
    }

    const permissionMode = manifest.agent?.permissionMode;
    const session = backend.launch({
      cwd: workspace,
      permissionMode,
      // Reuse sessionId for stable WS routing
      ...(existing?.agentSessionId ? {
        sessionId: existing.sessionId,
        resumeSessionId: existing.agentSessionId,
      } : {}),
      env: agentEnv,
    });

    sessionId = session.sessionId;

    if (existing?.agentSessionId) {
      resuming = true;
      p.log.info(`Resuming session: ${existing.agentSessionId}`);
    }

    // Persist session info
    saveSession(workspace, {
      sessionId: session.sessionId,
      agentSessionId: existing?.agentSessionId,
      mode: modeName,
      backendType: sessionBackendType,
      createdAt: existing?.createdAt || Date.now(),
    });

    // Record to global sessions registry for launcher "Recent Sessions"
    recordSession(modeName, manifest.displayName, workspace, sessionBackendType);

    p.log.info(`Agent session: ${session.sessionId}`);
    wsBridge.getOrCreateSession(session.sessionId, sessionBackendType);

    // For Codex backend, wire the CodexAdapter into the WsBridge
    if (sessionBackendType === "codex") {
      const { CodexBackend } = await import("../backends/codex/index.js");
      if (backend instanceof CodexBackend) {
        // The adapter may already be created (launch is sync, but init is async)
        const existingAdapter = backend.getAdapter(session.sessionId);
        if (existingAdapter) {
          wsBridge.attachCodexAdapter(session.sessionId, existingAdapter);
        }
        // Also listen for future adapter creation (e.g. relaunch)
        backend.onAdapterCreated((sid, adapter) => {
          if (sid === session.sessionId) {
            wsBridge.attachCodexAdapter(sid, adapter);
          }
        });
      }
    }

    // Auto-greeting for fresh sessions (driven by manifest)
    if (!resuming && manifest.agent?.greeting) {
      wsBridge.injectGreeting(session.sessionId, manifest.agent.greeting);
      console.log("[pneuma] Sent auto-greeting for fresh session");
    }

    // Load persisted message history into WsBridge
    const savedHistory = loadHistory(workspace);
    if (savedHistory.length > 0) {
      wsBridge.loadMessageHistory(session.sessionId, savedHistory as any);
      console.log(`[pneuma] Restored ${savedHistory.length} messages from history`);
    }

    // Periodically persist message history (debounced — every 5s)
    historyInterval = setInterval(() => {
      const history = wsBridge.getMessageHistory(session.sessionId);
      if (history.length > 0) {
        saveHistory(workspace, history);
      }
    }, 5_000);

    // Handle Agent exit: surface errors + clear stale resume state
    backend.onSessionExited((exitedId, exitCode) => {
      // Broadcast Agent errors to browser
      if (exitCode !== 0 && exitCode !== 143 /* SIGTERM = normal shutdown */) {
        let errorMsg: string;
        if (exitCode === 127) {
          errorMsg = sessionBackendType === "claude-code"
            ? "Claude Code CLI not found. Please install it: https://docs.anthropic.com/claude-code"
            : sessionBackendType === "codex"
            ? "Codex CLI not found. Please install it: npm install -g @openai/codex"
            : `Backend "${sessionBackendType}" CLI not found.`;
        } else {
          errorMsg = sessionBackendType === "claude-code"
            ? `Claude Code exited unexpectedly (code ${exitCode}). Check CLI installation and subscription status.`
            : sessionBackendType === "codex"
            ? `Codex exited unexpectedly (code ${exitCode}). Check CLI installation and login status.`
            : `${sessionBackendType} exited unexpectedly (code ${exitCode}).`;
        }
        wsBridge.broadcastToSession(exitedId, { type: "error", message: errorMsg });
      }

      // If resume fails (Agent exits quickly), clear agentSessionId from persistence
      if (exitedId === session.sessionId && resuming) {
        const info = backend!.getSession(exitedId);
        if (info && !info.agentSessionId) {
          const persisted = loadSession(workspace);
          if (persisted) {
            persisted.agentSessionId = undefined;
            saveSession(workspace, persisted);
            console.log("[pneuma] Resume failed, cleared agentSessionId. Restart for fresh session.");
          }
        }
      }
    });

    // 5. Start file watcher (driven by manifest)
    startFileWatcher(workspace, manifest.viewer, (files) => {
      wsBridge.broadcastToSession(session.sessionId, {
        type: "content_update",
        files,
      });
    });
  }

  // 6. Frontend serving
  let viteProc: ReturnType<typeof Bun.spawn> | null = null;
  let browserPort = actualPort;

  if (isDev) {
    // Dev mode: start Vite dev server
    // PNEUMA_VITE_PORT allows play instances to use a dedicated Vite port
    const VITE_PORT = parseInt(process.env.PNEUMA_VITE_PORT || "17996", 10);
    p.log.step(`Starting Vite dev server on port ${VITE_PORT}...`);

    // Pass config to Vite via env vars
    const viteEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      // Tell frontend which port the backend API server is on
      VITE_API_PORT: String(actualPort),
    };
    if (resolved.type !== "builtin") {
      viteEnv.PNEUMA_EXTERNAL_MODE_PATH = resolved.path;
      viteEnv.PNEUMA_EXTERNAL_MODE_NAME = resolved.name;
    }
    if (modeName === "mode-maker") {
      viteEnv.VITE_MODE_MAKER_WORKSPACE = workspace;
    }

    const viteResult = await startViteDev({
      projectRoot: PROJECT_ROOT,
      port: VITE_PORT,
      env: viteEnv,
    });
    viteProc = viteResult.proc;
    browserPort = viteResult.port;
  }

  // 7. Open browser (include mode in URL for frontend)
  const debugParam = debug ? "&debug=1" : "";
  const replayParam = replayPackage ? `&replay=${encodeURIComponent(replayPackage)}` : "";
  const browserUrl = `http://localhost:${browserPort}?session=${sessionId}&mode=${modeName}${debugParam}${replayParam}`;
  // Always print ready message (used by mode-maker play to detect startup)
  console.log(`[pneuma] ready ${browserUrl}`);

  if (!noOpen) {
    p.log.success(`Ready → ${browserUrl}`);
    try {
      if (process.platform === "win32") {
        Bun.spawn(["cmd", "/c", "start", "", browserUrl], { stdout: "ignore", stderr: "ignore" });
      } else {
        const opener = process.platform === "darwin" ? "open" : "xdg-open";
        Bun.spawn([opener, browserUrl], { stdout: "ignore", stderr: "ignore" });
      }
    } catch {
      p.log.warn(`Could not open browser. Visit: ${browserUrl}`);
    }
  }

  // Graceful shutdown
  const shutdown = async () => {
    if (historyInterval) clearInterval(historyInterval);
    // Final history save (only for normal mode)
    if (!replayPackage) {
      const history = wsBridge.getMessageHistory(sessionId);
      if (history.length > 0) {
        saveHistory(workspace, history);
      }
    }
    modeMakerCleanup?.();
    viteProc?.kill();
    if (backend) await backend.killAll();
    server.stop(true);
    p.outro("Goodbye!");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  p.cancel(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
