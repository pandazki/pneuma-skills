import { resolve } from "node:path";
import { getDefaultBackendType } from "../backends/index.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";

export interface PersistedSession {
  sessionId: string;
  agentSessionId?: string;
  mode: string;
  backendType: AgentBackendType;
  createdAt: number;
  editing?: boolean;
}

export interface SessionRecord {
  id: string;
  mode: string;
  displayName: string;
  sessionName?: string;
  workspace: string;
  backendType: AgentBackendType;
  lastAccessed: number;
  editing?: boolean;
}

export interface ParsedCliArgs {
  mode: string;
  workspace: string;
  port: number;
  backendType: AgentBackendType;
  showHelp: boolean;
  showVersion: boolean;
  noOpen: boolean;
  debug: boolean;
  forceDev: boolean;
  noPrompt: boolean;
  skipSkill: boolean;
  replayPackage: string;
  replaySource: string; // Source workspace path for existing session replay
  sessionName: string;
  viewing: boolean;
}

/**
 * Backfill value for legacy session records that pre-date the
 * `backendType` field. Those records were written when claude-code was
 * the only backend, so they semantically belong to claude-code regardless
 * of what new sessions default to today. Tracked separately from
 * `getDefaultBackendType()` (which now favors codex) so a legacy resume
 * keeps targeting the agent it was actually launched with.
 */
const LEGACY_BACKFILL_BACKEND: AgentBackendType = "claude-code";

export function normalizePersistedSession(data: Record<string, unknown>): PersistedSession {
  const normalized = { ...data } as Record<string, unknown>;
  if (normalized.cliSessionId && !normalized.agentSessionId) {
    normalized.agentSessionId = normalized.cliSessionId;
    delete normalized.cliSessionId;
  }
  if (!normalized.backendType) {
    normalized.backendType = LEGACY_BACKFILL_BACKEND;
  }
  return normalized as PersistedSession;
}

export function normalizeSessionRecord(data: Record<string, unknown>): SessionRecord {
  return {
    ...data,
    backendType: (data.backendType as AgentBackendType | undefined) || LEGACY_BACKFILL_BACKEND,
  } as SessionRecord;
}

export function parseCliArgs(argv: string[], cwd = process.cwd()): ParsedCliArgs {
  const args = argv.slice(2);
  let mode = "";
  let workspace = cwd;
  let port = 0;
  let backendType: AgentBackendType = getDefaultBackendType();
  let showHelp = false;
  let showVersion = false;
  let noOpen = false;
  let debug = false;
  let forceDev = false;
  let noPrompt = false;
  let skipSkill = false;
  let replayPackage = "";
  let replaySource = "";
  let sessionName = "";
  let viewing = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace" && i + 1 < args.length) {
      workspace = args[++i];
    } else if (arg === "--port" && i + 1 < args.length) {
      port = Number(args[++i]);
    } else if (arg === "--backend" && i + 1 < args.length) {
      backendType = args[++i] as AgentBackendType;
    } else if (arg === "--help" || arg === "-h") {
      showHelp = true;
    } else if (arg === "--version" || arg === "-v") {
      showVersion = true;
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--no-prompt") {
      noPrompt = true;
    } else if (arg === "--skip-skill") {
      skipSkill = true;
    } else if (arg === "--viewing") {
      viewing = true;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg === "--dev") {
      forceDev = true;
    } else if (arg === "--replay" && i + 1 < args.length) {
      replayPackage = args[++i];
    } else if (arg === "--replay-source" && i + 1 < args.length) {
      replaySource = resolve(cwd, args[++i]);
    } else if (arg === "--session-name" && i + 1 < args.length) {
      sessionName = args[++i];
    } else if (!arg.startsWith("--")) {
      mode = arg;
    }
  }

  return {
    mode,
    workspace: resolve(cwd, workspace),
    port,
    backendType,
    showHelp,
    showVersion,
    noOpen,
    debug,
    forceDev,
    noPrompt,
    skipSkill,
    replayPackage,
    replaySource,
    sessionName,
    viewing,
  };
}

export function resolveWorkspaceBackendType(
  requestedBackendType: AgentBackendType,
  existingSession: Pick<PersistedSession, "backendType"> | null,
): { backendType: AgentBackendType; mismatchMessage?: string } {
  if (!existingSession?.backendType) {
    return { backendType: requestedBackendType };
  }

  if (existingSession.backendType !== requestedBackendType) {
    return {
      backendType: existingSession.backendType,
      mismatchMessage:
        `Workspace is already bound to backend "${existingSession.backendType}". ` +
        `Launch with --backend ${existingSession.backendType} or remove .pneuma/session.json to start fresh.`,
    };
  }

  return { backendType: existingSession.backendType };
}

/**
 * Spawn Vite dev server and resolve the actual port from its stdout.
 * Returns { proc, port } where port is the actual port Vite bound to.
 */
export async function startViteDev(opts: {
  projectRoot: string;
  port: number;
  env: Record<string, string>;
}): Promise<{ proc: ReturnType<typeof Bun.spawn>; port: number }> {
  const proc = Bun.spawn(
    ["bunx", "vite", "--port", String(opts.port)],
    { cwd: opts.projectRoot, stdout: "pipe", stderr: "pipe", env: opts.env },
  );

  let resolved = false;
  const port = await new Promise<number>((resolvePort) => {
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; resolvePort(opts.port); }
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
          if (!resolved) {
            const match = line.match(/Local:\s+https?:\/\/[^:]+:(\d+)/);
            if (match) {
              resolved = true;
              clearTimeout(timeout);
              resolvePort(parseInt(match[1], 10));
            }
          }
        }
      }
    };
    if (proc.stdout && typeof proc.stdout !== "number") pipeAndParse(proc.stdout);
    if (proc.stderr && typeof proc.stderr !== "number") pipeAndParse(proc.stderr);
  });

  return { proc, port };
}
