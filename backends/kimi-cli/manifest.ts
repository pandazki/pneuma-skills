import type { BackendModule } from "../../core/types/agent-backend.js";
import { resolveBinary } from "../../server/path-resolver.js";
import { KimiCliBackend } from "./index.js";
import { KimiBridge } from "../../server/ws-bridge-kimi.js";
import { defaultToolFileRef, type ToolFileRef } from "../tool-file-ref.js";

const INSTALL_HINT = `Install: uv tool install kimi-cli
Verify: kimi --version
Docs: https://moonshotai.github.io/kimi-cli/`;

function kimiToolFileRef(toolName: string, input: Record<string, unknown>): ToolFileRef | undefined {
  const claudeShaped = defaultToolFileRef(toolName, input);
  if (claudeShaped) return claudeShaped;
  // kimi exposes its own tool names; fall back to "does the input name a file?".
  const raw = input.path ?? input.file_path;
  if (typeof raw === "string" && raw.length > 0) return { path: raw, kind: "edit" };
  return undefined;
}

export const kimiCliModule: BackendModule = {
  type: "kimi-cli",
  label: "Kimi",
  description: "Moonshot AI Kimi Code CLI via stdio stream-json transport.",
  displayLabel: "kimi-cli",

  binary: "kimi",
  installHint: INSTALL_HINT,

  skillsDir: ".kimi/skills",
  instructionsFile: "AGENTS.md",

  capabilities: {
    streaming: true,
    resume: true,
    permissions: false,
    toolProgress: false,
    modelSwitch: true,
  },

  // Kimi emits its own model list dynamically — no static fallback needed.

  toolFileRef: kimiToolFileRef,

  createBackend() {
    // KimiCliBackend takes no constructor args (the `port` parameter from the
    // BackendModule signature applies to backends that need an HTTP transport
    // — kimi is pure stdio stream-json).
    return new KimiCliBackend();
  },

  /**
   * Build a `KimiBridge` for the session. Requires:
   *   - The KimiCliBackend already launched and registered an adapter for this
   *     sessionId. Kimi pre-allocates the kimi session UUID at spawn time
   *     (KimiCliLauncher uses `-r <uuid>`) so the adapter is wired up
   *     synchronously alongside the child process.
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

  checkRequirements() {
    const resolved = resolveBinary("kimi");
    if (!resolved) {
      return { ok: false, reason: `"kimi" CLI not found in PATH.\n${INSTALL_HINT}` };
    }
    return { ok: true, binaryPath: resolved };
  },
};
