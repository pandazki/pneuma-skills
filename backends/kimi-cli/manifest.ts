import { spawnSync } from "node:child_process";
import type { BackendModule } from "../../core/types/agent-backend.js";
import { resolveBinary } from "../../server/path-resolver.js";
import { KimiCliBackend } from "./index.js";
import { KimiBridge } from "../../server/ws-bridge-kimi.js";
import { defaultToolFileRef, KIND_BY_NAME, type ToolFileRef } from "../tool-file-ref.js";

const INSTALL_HINT = `Install / upgrade: kimi upgrade (or see the docs for a fresh install)
Verify: kimi acp --help
Docs: https://moonshotai.github.io/kimi-code/`;

/**
 * The `acp`-subcommand probe spawns the CLI (~400ms for the Node SEA binary),
 * and `/api/backends` calls `checkRequirements()` per request — cache the
 * probe per resolved binary path with a short TTL so the launcher stays
 * snappy while still noticing an install/upgrade within a minute.
 */
const ACP_PROBE_TTL_MS = 60_000;
const acpProbeCache = new Map<string, { ok: boolean; at: number }>();

function probeAcpSubcommand(binaryPath: string): boolean {
  const cached = acpProbeCache.get(binaryPath);
  if (cached && Date.now() - cached.at < ACP_PROBE_TTL_MS) return cached.ok;
  const probe = spawnSync(binaryPath, ["acp", "--help"], {
    timeout: 15_000,
    encoding: "utf-8",
  });
  const ok = !probe.error && probe.status === 0;
  acpProbeCache.set(binaryPath, { ok, at: Date.now() });
  return ok;
}

/**
 * Kimi Code's builtin tools use Claude-style names ("Read", "Write", "Edit",
 * "Bash", "Glob", …) but address files via `path` (verified rawInput shapes:
 * Write `{path, content}`, Read `{path}`, Bash `{command}`, Glob `{pattern}`).
 * Try the Claude-shaped default first (`file_path`), then fall back to
 * `path`, deriving the kind from the tool name where known.
 */
function kimiToolFileRef(toolName: string, input: Record<string, unknown>): ToolFileRef | undefined {
  const claudeShaped = defaultToolFileRef(toolName, input);
  if (claudeShaped) return claudeShaped;
  const raw = input.path ?? input.file_path;
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return { path: raw, kind: KIND_BY_NAME[toolName] ?? "edit" };
}

export const kimiCliModule: BackendModule = {
  type: "kimi-cli",
  label: "Kimi",
  description: "Moonshot AI Kimi Code CLI via ACP (Agent Client Protocol) JSON-RPC over stdio.",
  displayLabel: "kimi-cli",

  binary: "kimi",
  installHint: INSTALL_HINT,

  // Kimi Code discovers project skills in `.kimi-code/skills/` and
  // `.agents/skills/` (the legacy kimi-cli `.kimi/skills/` is NOT read).
  skillsDir: ".kimi-code/skills",
  instructionsFile: "AGENTS.md",

  // Keep in sync with `KimiCliBackend.capabilities` in `index.ts` — the two
  // declarations have no single source.
  capabilities: {
    streaming: true,
    resume: true,
    permissions: true,
    toolProgress: true,
    modelSwitch: true,
  },

  // Kimi emits its own model list dynamically (session/new `configOptions`)
  // — no static fallback needed.

  toolFileRef: kimiToolFileRef,

  createBackend() {
    // KimiCliBackend takes no constructor args (the `port` parameter from the
    // BackendModule signature applies to backends that need an HTTP transport
    // — kimi is pure stdio JSON-RPC).
    return new KimiCliBackend();
  },

  /**
   * Build a `KimiBridge` for the session. Requires:
   *   - The KimiCliBackend already launched and registered an adapter for
   *     this sessionId (the adapter is wired up synchronously alongside the
   *     child process; its ACP handshake runs asynchronously and the bridge
   *     learns the agent session id via `onSessionId` replay-on-subscribe).
   *   - Bridge deps that expose `getOrCreateSession` so we can obtain the
   *     per-session bookkeeping record without expanding the BackendModule
   *     `createBridgeBackend` signature.
   */
  createBridgeBackend(deps, backend, sessionId) {
    if (!(backend instanceof KimiCliBackend)) {
      throw new Error("kimi.createBridgeBackend: expected KimiCliBackend instance");
    }
    const adapter = backend.getAdapter(sessionId);
    if (!adapter) {
      throw new Error(`kimi.createBridgeBackend: no adapter for session ${sessionId}`);
    }
    if (!deps.getOrCreateSession) {
      throw new Error(
        "kimi.createBridgeBackend: deps.getOrCreateSession is required to construct KimiBridge",
      );
    }
    const session = deps.getOrCreateSession(sessionId, "kimi-cli");
    return new KimiBridge(sessionId, session, adapter, deps);
  },

  /**
   * Binary presence alone is NOT sufficient: the `kimi` name was reused
   * across a product swap (Python kimi-cli v1.x → Kimi Code, whose version
   * numbering restarted at 0.x — so semver comparison is actively wrong).
   * Probe for the `acp` subcommand instead; only Kimi Code has it.
   */
  checkRequirements() {
    const resolved = resolveBinary("kimi");
    if (!resolved) {
      return { ok: false, reason: `"kimi" CLI not found in PATH.\n${INSTALL_HINT}` };
    }
    if (!probeAcpSubcommand(resolved)) {
      return {
        ok: false,
        reason:
          `"kimi" was found at ${resolved} but has no "acp" subcommand — this looks like the `
          + `legacy kimi-cli, which predates Kimi Code and is no longer supported.\n${INSTALL_HINT}`,
      };
    }
    return { ok: true, binaryPath: resolved };
  },
};
