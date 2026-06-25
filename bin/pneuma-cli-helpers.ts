import { resolve } from "node:path";
import { getDefaultBackendType } from "../backends/index.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import { t } from "./i18n.js";

export interface PersistedSession {
  sessionId: string;
  agentSessionId?: string;
  mode: string;
  backendType: AgentBackendType;
  createdAt: number;
  editing?: boolean;
  /**
   * Refined session metadata — the agent rewrites these via the
   * `pneuma session refine` CLI when the conversation has produced enough
   * substance for a meaningful title / one-line summary. Both override the
   * UI fallbacks (`${mode} session` for the title, the first user-prompt
   * preview for the description). Absent on freshly created sessions.
   *
   * Precedence note: an explicit `sessionName` (from `--session-name` or a
   * future rename UI) still wins over `displayName` — user intent beats
   * agent inference.
   */
  displayName?: string;
  description?: string;
  refinedAt?: number;
  /**
   * Session-level internal flag — stamped on a borrow sub-session B so
   * `scanProjectSessions` filters B out of user-facing lists even though B
   * runs a normal (non-hidden) user mode. Set together with {@link borrow}
   * at B's first save; both must survive every later resume/launch overwrite
   * (see {@link preserveRefinedSessionMeta}).
   */
  internal?: boolean;
  /**
   * Borrow provenance — present on a borrow sub-session B spawned for a host
   * session A. `scanProjectSessions` keys on this (or `internal`) to keep B
   * out of Recent Sessions / ProjectPanel. The shape mirrors design §5:
   * `{ borrowId, hostSessionId, role: "borrow-target" }`. Absent on every
   * non-borrow session.
   */
  borrow?: BorrowProvenance;
}

/**
 * Borrow provenance stamped onto a borrow sub-session's `session.json`.
 * Mirrors the design §5 shape; immutable once written at B's session start.
 */
export interface BorrowProvenance {
  /** The borrow this session fulfills (= B's own session id). */
  borrowId: string;
  /** A — the host session that dispatched the borrow (when known). */
  hostSessionId?: string;
  /** Always `"borrow-target"` for B; reserved for future roles. */
  role: "borrow-target";
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
  /** Project root directory (resolved absolute) when --project is supplied; empty string otherwise. */
  project: string;
  /** Explicit session id override from --session-id; empty string when not provided. */
  sessionIdOverride: string;
  /**
   * Source session info — populated only when this child was spawned from
   * an existing session that wasn't a Smart Handoff (e.g. clicking a sibling
   * row in ProjectPanel). Drives the `<pneuma:env reason="switched" …/>`
   * dispatch on session start. Empty strings when not provided.
   */
  fromSessionId: string;
  fromMode: string;
  fromDisplayName: string;
  /**
   * Borrow id from `--borrow <id>` — populated only when this child was
   * spawned as a borrow target by the server's `launchPneumaChild` seam. Its
   * presence selects `<pneuma:env reason="borrow" />` and stamps the session's
   * `session.json` with `{ internal: true, borrow: {...} }`. Empty string when
   * not a borrow.
   */
  borrowId: string;
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
  return normalized as unknown as PersistedSession;
}

export function normalizeSessionRecord(data: Record<string, unknown>): SessionRecord {
  return {
    ...data,
    backendType: (data.backendType as AgentBackendType | undefined) || LEGACY_BACKFILL_BACKEND,
  } as SessionRecord;
}

/**
 * Carry the refined session meta (title / one-line summary / refine timestamp)
 * from a prior `session.json` into a freshly-built {@link PersistedSession}.
 *
 * Resume and launch callers of `saveSession` pass a minimal record
 * (`{ sessionId, mode, backendType, createdAt }`) with none of these fields,
 * so a plain overwrite drops what `pneuma session refine` wrote — reverting
 * the canonical `session.json` (which ProjectPanel reads directly) to the mode
 * default. The incoming record wins whenever it carries a field; only fields
 * it leaves `undefined` fall back to `prev`. Symmetric to `pickRefinedMeta`
 * on the registry side.
 *
 * Same trap, same fix for borrow provenance (`internal` + `borrow`): the
 * server stages the brief and `bin/pneuma.ts` stamps these on B's FIRST save,
 * but every subsequent resume passes a minimal record. Without preservation a
 * resumed borrow sub-session would silently un-mark itself and leak back into
 * user-facing session lists. They survive the same "incoming wins, else prev"
 * way the refined trio does.
 *
 * @param incoming — the record about to be written
 * @param prev — the parsed prior `session.json`, if any
 */
export function preserveRefinedSessionMeta(
  incoming: PersistedSession,
  prev: Partial<PersistedSession> | undefined,
): PersistedSession {
  if (!prev) return incoming;
  const out: PersistedSession = { ...incoming };
  if (out.displayName === undefined && prev.displayName !== undefined) {
    out.displayName = prev.displayName;
  }
  if (out.description === undefined && prev.description !== undefined) {
    out.description = prev.description;
  }
  if (out.refinedAt === undefined && prev.refinedAt !== undefined) {
    out.refinedAt = prev.refinedAt;
  }
  if (out.internal === undefined && prev.internal !== undefined) {
    out.internal = prev.internal;
  }
  if (out.borrow === undefined && prev.borrow !== undefined) {
    out.borrow = prev.borrow;
  }
  return out;
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
  let project = "";
  let sessionIdOverride = "";
  let fromSessionId = "";
  let fromMode = "";
  let fromDisplayName = "";
  let borrowId = "";

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
    } else if (arg === "--project" && i + 1 < args.length) {
      project = resolve(cwd, args[++i]);
    } else if (arg === "--session-id" && i + 1 < args.length) {
      sessionIdOverride = args[++i] ?? "";
    } else if (arg === "--from-session-id" && i + 1 < args.length) {
      fromSessionId = args[++i] ?? "";
    } else if (arg === "--from-mode" && i + 1 < args.length) {
      fromMode = args[++i] ?? "";
    } else if (arg === "--from-display-name" && i + 1 < args.length) {
      fromDisplayName = args[++i] ?? "";
    } else if (arg === "--borrow" && i + 1 < args.length) {
      borrowId = args[++i] ?? "";
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
    project,
    sessionIdOverride,
    fromSessionId,
    fromMode,
    fromDisplayName,
    borrowId,
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
      mismatchMessage: t("pneuma.backend_mismatch", { backend: existingSession.backendType }),
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
