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
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import * as p from "@clack/prompts";
import { startServer } from "../server/index.js";
import { ClaudeCodeBackend } from "../backends/claude-code/index.js";
import { installSkill } from "../server/skill-installer.js";
import { startFileWatcher } from "../server/file-watcher.js";
import { loadModeManifest, listBuiltinModes, registerExternalMode } from "../core/mode-loader.js";
import type { ModeManifest } from "../core/types/mode-manifest.js";
import { applyTemplateParams } from "../server/skill-installer.js";
import { resolveMode as resolveModeSource, isExternalMode } from "../core/mode-resolver.js";
import type { ResolvedMode } from "../core/mode-resolver.js";
import { resolveBinary } from "../server/path-resolver.js";

const PROJECT_ROOT = resolve(dirname(import.meta.path), "..");

// ── Session persistence ──────────────────────────────────────────────────────

interface PersistedSession {
  sessionId: string;
  /** Agent's internal session ID (e.g. Claude Code's --resume ID) */
  agentSessionId?: string;
  mode: string;
  createdAt: number;
}

function loadSession(workspace: string): PersistedSession | null {
  const filePath = join(workspace, ".pneuma", "session.json");
  try {
    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    // Backward compat: rename cliSessionId → agentSessionId
    if (data.cliSessionId && !data.agentSessionId) {
      data.agentSessionId = data.cliSessionId;
      delete data.cliSessionId;
    }
    return data;
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

interface SessionRecord {
  id: string; // `${workspace}::${mode}`
  mode: string;
  displayName: string;
  workspace: string;
  lastAccessed: number;
}

const SESSIONS_REGISTRY = join(homedir(), ".pneuma", "sessions.json");

function loadSessionsRegistry(): SessionRecord[] {
  try {
    return JSON.parse(readFileSync(SESSIONS_REGISTRY, "utf-8"));
  } catch {
    return [];
  }
}

function saveSessionsRegistry(records: SessionRecord[]): void {
  const dir = dirname(SESSIONS_REGISTRY);
  mkdirSync(dir, { recursive: true });
  writeFileSync(SESSIONS_REGISTRY, JSON.stringify(records, null, 2));
}

function recordSession(mode: string, displayName: string, workspace: string): void {
  const id = `${workspace}::${mode}`;
  const records = loadSessionsRegistry();
  const existing = records.findIndex((r) => r.id === id);
  const entry: SessionRecord = { id, mode, displayName, workspace, lastAccessed: Date.now() };
  if (existing >= 0) {
    records[existing] = entry;
  } else {
    records.unshift(entry);
  }
  // Cap at 50 entries
  saveSessionsRegistry(records.slice(0, 50));
}

// ── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2); // skip bun + script path
  let mode = "";
  let workspace = process.cwd();
  let port = 0; // 0 = auto-detect based on mode
  let noOpen = false;
  let debug = false;
  let forceDev = false;
  let noPrompt = false;
  let skipSkill = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace" && i + 1 < args.length) {
      workspace = args[++i];
    } else if (arg === "--port" && i + 1 < args.length) {
      port = Number(args[++i]);
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--no-prompt") {
      noPrompt = true;
    } else if (arg === "--skip-skill") {
      skipSkill = true;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg === "--dev") {
      forceDev = true;
    } else if (!arg.startsWith("--")) {
      mode = arg;
    }
  }

  return { mode, workspace: resolve(workspace), port, noOpen, debug, forceDev, noPrompt, skipSkill };
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

function checkClaudeCode() {
  const resolved = resolveBinary("claude");
  if (!resolved) {
    p.cancel(
      "Claude Code CLI not found.\n" +
      "  Pneuma requires Claude Code to be installed and authenticated.\n" +
      "  Install it from: https://docs.anthropic.com/en/docs/claude-code"
    );
    process.exit(1);
  }
}

async function main() {
  // Read version from package.json
  const pkgPath = join(PROJECT_ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  p.intro(`pneuma-skills v${pkg.version}`);

  checkBunVersion();
  await checkForUpdate(pkg.version);

  // Snapshot subcommand — intercept before mode validation
  const rawArgs = process.argv.slice(2);
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

  const { mode, workspace, port, noOpen, debug, forceDev, noPrompt, skipSkill } = parseArgs(process.argv);

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

      const viteEnv: Record<string, string> = {
        ...process.env as Record<string, string>,
        VITE_API_PORT: String(actualPort),
      };

      const viteProc = Bun.spawn(
        ["bunx", "vite", "--port", String(VITE_PORT)],
        { cwd: PROJECT_ROOT, stdout: "pipe", stderr: "pipe", env: viteEnv },
      );

      let vitePortResolved = false;
      browserPort = await new Promise<number>((resolvePort) => {
        const timeout = setTimeout(() => {
          if (!vitePortResolved) { vitePortResolved = true; resolvePort(VITE_PORT); }
        }, 10_000);

        const pipeAndParse = async (stream: ReadableStream<Uint8Array>) => {
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split("\n")) {
              if (line.trim()) console.log(`[vite] ${line}`);
              if (!vitePortResolved) {
                const match = line.match(/Local:\s+https?:\/\/[^:]+:(\d+)/);
                if (match) {
                  vitePortResolved = true;
                  clearTimeout(timeout);
                  resolvePort(parseInt(match[1], 10));
                }
              }
            }
          }
        };
        if (viteProc.stdout && typeof viteProc.stdout !== "number") pipeAndParse(viteProc.stdout);
        if (viteProc.stderr && typeof viteProc.stderr !== "number") pipeAndParse(viteProc.stderr);
      });

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

  // Verify Claude Code CLI is available before proceeding
  checkClaudeCode();

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
  let skipSkillInstall = skipSkill; // --skip-skill from CLI (session resume without update)

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
    installSkill(workspace, manifest.skill, modeSourceDir, resolvedParams, manifest.viewerApi, effectiveApiPort);
    // Record installed skill version for update detection
    const skillVersionPath = join(workspace, ".pneuma", "skill-version.json");
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
    writeFileSync(skillVersionPath, JSON.stringify({ mode: modeName, version: manifest.version }));
  }

  // 1.5 Seed default content if workspace has no meaningful files
  if (manifest.init && manifest.init.contentCheckPattern) {
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
            if (hasParams) {
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
    const buildDir = join(resolved.path, ".build");
    const modeEntry = join(resolved.path, "pneuma-mode.ts");
    const manifestEntry = join(resolved.path, "manifest.ts");
    const entrypoints = [modeEntry, manifestEntry].filter((e) => existsSync(e));
    if (entrypoints.length > 0) {
      p.log.step("Compiling mode viewer for production...");
      const result = await Bun.build({
        entrypoints,
        outdir: buildDir,
        target: "browser",
        format: "esm",
        external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
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

  // 3. Start server
  //    Dev mode:  backend on 17007, Vite on 17996 (user-facing)
  //    Prod mode: backend on 17996 (serves everything)
  const serverPort = effectiveApiPort;
  const { server, wsBridge, port: actualPort, modeMakerCleanup } = startServer({
    port: serverPort,
    workspace,
    watchPatterns: manifest.viewer.watchPatterns,
    ...(isDev ? {} : { distDir }),
    ...(Object.keys(resolvedParams).length > 0 ? { initParams: resolvedParams } : {}),
    // Pass external mode info for the /api/mode-info endpoint
    ...(resolved.type !== "builtin"
      ? { externalMode: { name: resolved.name, path: resolved.path, type: resolved.type } }
      : {}),
    ...(modeBundleDir ? { modeBundleDir } : {}),
    projectRoot: PROJECT_ROOT,
    modeName,
  });

  // 4. Launch Agent backend (driven by manifest)
  const backend = new ClaudeCodeBackend(actualPort);

  // When the CLI reports its internal session_id, persist it
  wsBridge.onCLISessionIdReceived((sessionId, agentSessionId) => {
    backend.setAgentSessionId(sessionId, agentSessionId);
    // Persist to .pneuma/session.json
    const persisted = loadSession(workspace);
    if (persisted && persisted.sessionId === sessionId) {
      persisted.agentSessionId = agentSessionId;
      saveSession(workspace, persisted);
      console.log(`[pneuma] Saved agentSessionId for resume: ${agentSessionId}`);
    }
  });

  // Check for existing session to resume
  const existing = loadSession(workspace);
  let resuming = false;

  // Build env map from envMapping (init param values → env vars for agent process)
  const agentEnv: Record<string, string> = {};
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
    ...(Object.keys(agentEnv).length > 0 ? { env: agentEnv } : {}),
  });

  if (existing?.agentSessionId) {
    resuming = true;
    p.log.info(`Resuming session: ${existing.agentSessionId}`);
  }

  // Persist session info
  saveSession(workspace, {
    sessionId: session.sessionId,
    agentSessionId: existing?.agentSessionId,
    mode: modeName,
    createdAt: existing?.createdAt || Date.now(),
  });

  // Record to global sessions registry for launcher "Recent Sessions"
  recordSession(modeName, manifest.displayName, workspace);

  p.log.info(`Agent session: ${session.sessionId}`);

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
  const historyInterval = setInterval(() => {
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
        errorMsg = "Claude Code CLI not found. Please install it: https://docs.anthropic.com/claude-code";
      } else {
        errorMsg = `Claude Code exited unexpectedly (code ${exitCode}). Check CLI installation and subscription status.`;
      }
      wsBridge.broadcastToSession(exitedId, { type: "error", message: errorMsg });
    }

    // If resume fails (Agent exits quickly), clear agentSessionId from persistence
    if (exitedId === session.sessionId && resuming) {
      const info = backend.getSession(exitedId);
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

  // 6. Frontend serving
  let viteProc: ReturnType<typeof Bun.spawn> | null = null;
  let browserPort = actualPort;

  if (isDev) {
    // Dev mode: start Vite dev server
    const VITE_PORT = 17996;
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

    viteProc = Bun.spawn(
      ["bunx", "vite", "--port", String(VITE_PORT)],
      {
        cwd: PROJECT_ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: viteEnv,
      }
    );

    // Parse Vite stdout to detect the actual port (may differ if VITE_PORT is occupied)
    let vitePortResolved = false;
    const vitePortPromise = new Promise<number>((resolvePort) => {
      const timeout = setTimeout(() => {
        if (!vitePortResolved) {
          vitePortResolved = true;
          resolvePort(VITE_PORT);
        }
      }, 10_000);

      const pipeAndParse = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split("\n")) {
            if (line.trim()) console.log(`[vite] ${line}`);
            // Vite outputs: "  ➜  Local:   http://localhost:17996/"
            if (!vitePortResolved) {
              const match = line.match(/Local:\s+https?:\/\/[^:]+:(\d+)/);
              if (match) {
                vitePortResolved = true;
                clearTimeout(timeout);
                resolvePort(parseInt(match[1], 10));
              }
            }
          }
        }
      };
      if (viteProc!.stdout && typeof viteProc!.stdout !== "number") pipeAndParse(viteProc!.stdout);
      if (viteProc!.stderr && typeof viteProc!.stderr !== "number") pipeAndParse(viteProc!.stderr);
    });
    browserPort = await vitePortPromise;
  }

  // 7. Open browser (include mode in URL for frontend)
  const debugParam = debug ? "&debug=1" : "";
  const browserUrl = `http://localhost:${browserPort}?session=${session.sessionId}&mode=${modeName}${debugParam}`;
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
    clearInterval(historyInterval);
    // Final history save
    const history = wsBridge.getMessageHistory(session.sessionId);
    if (history.length > 0) {
      saveHistory(workspace, history);
    }
    modeMakerCleanup?.();
    viteProc?.kill();
    await backend.killAll();
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
