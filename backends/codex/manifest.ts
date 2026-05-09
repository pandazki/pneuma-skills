import type { BackendModule } from "../../core/types/agent-backend.js";
import { resolveBinary } from "../../server/path-resolver.js";
import { CodexBackend } from "./index.js";
import { CodexBridge } from "../../server/ws-bridge-codex.js";

const INSTALL_HINT = `Install: npm install -g @openai/codex
Verify: codex --version
Docs: https://github.com/openai/codex`;

export const codexModule: BackendModule = {
  type: "codex",
  label: "Codex",
  description: "OpenAI Codex CLI via app-server JSON-RPC over stdio.",
  displayLabel: "codex",

  binary: "codex",
  installHint: INSTALL_HINT,

  skillsDir: ".agents/skills",
  instructionsFile: "AGENTS.md",

  capabilities: {
    streaming: true,
    resume: true,
    permissions: true,
    toolProgress: false,
    modelSwitch: true,
  },

  // Codex emits its own model list via `available_models` over the wire — no
  // static fallback needed.

  createBackend() {
    // CodexBackend takes no constructor args (the `port` parameter from the
    // BackendModule signature applies to backends that need an HTTP transport
    // — codex is pure stdio JSON-RPC).
    return new CodexBackend();
  },

  /**
   * Build a `CodexBridge` for the session. Requires:
   *   - The CodexBackend already launched and registered an adapter for this
   *     sessionId (via `launch()` → `CodexCliLauncher` → adapter map).
   *   - Bridge deps that expose `getOrCreateSession` so we can obtain the
   *     per-session bookkeeping record without expanding the BackendModule
   *     `createBridgeBackend` signature.
   */
  createBridgeBackend(deps, backend, sessionId) {
    if (!(backend instanceof CodexBackend)) {
      throw new Error("codex.createBridgeBackend: expected CodexBackend instance");
    }
    const adapter = backend.getAdapter(sessionId);
    if (!adapter) {
      throw new Error(`codex.createBridgeBackend: no adapter for session ${sessionId}`);
    }
    if (!deps.getOrCreateSession) {
      throw new Error(
        "codex.createBridgeBackend: deps.getOrCreateSession is required to construct CodexBridge",
      );
    }
    const session = deps.getOrCreateSession(sessionId, "codex");
    return new CodexBridge(sessionId, session, adapter, deps);
  },

  checkRequirements() {
    const resolved = resolveBinary("codex");
    if (!resolved) {
      return { ok: false, reason: `"codex" CLI not found in PATH.\n${INSTALL_HINT}` };
    }
    return { ok: true, binaryPath: resolved };
  },
};
