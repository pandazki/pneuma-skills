# Kimi CLI Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `kimi-cli` (Moonshot AI's Kimi Code CLI, https://github.com/MoonshotAI/kimi-cli) as Pneuma's third agent backend so users can pick it from the launcher backend picker the same way they pick Claude Code or Codex.

**Architecture:** Spawn `kimi --print --input-format stream-json --output-format stream-json -y --work-dir <cwd> [-r <agentSessionId>] [-m <model>]` as a long-lived child process via `node:child_process` (same gotcha as Codex re: `Bun.spawn` closing streams prematurely). The kimi process stays alive across turns as long as stdin remains open (verified empirically: two NDJSON user messages on stdin → two NDJSON assistant messages on stdout, in order, single PID). A `KimiAdapter` parses stdout NDJSON, translates kimi's OpenAI-shape messages (`{role,content,tool_calls?}`, `{role:"tool",content,tool_call_id}`) into Pneuma's normalized session-state shape that the bridge already broadcasts to browsers. Skill installation is reused as-is — kimi auto-discovers `.claude/skills/` per its own multi-source discovery (`Skills are cross-tool shared capability extensions (compatible with Kimi CLI, Claude, Codex, and others)` — kimi-cli docs); `instructionsFile()` already returns `CLAUDE.md` for any non-Codex backend.

**Tech Stack:** TypeScript strict ESNext modules, `node:child_process`, `bun:test`. No new runtime deps.

**Out of scope for this plan:**
- ACP transport (Path B). The `kimi acp` JSON-RPC server is a cleaner long-term integration but is a separate project; this plan only delivers the stdio stream-json bridge.
- Token-level streaming. Kimi flushes whole assistant messages per step boundary (verified in `kimi_cli/ui/print/visualize.py:JsonPrinter`); Codex is the same and ships `streaming:true` for "events arrive incrementally," so we mirror that label.
- `--add-dir` / multi-root workspaces. Pneuma's `AgentLaunchOptions` doesn't expose extra dirs today; out of scope.

---

## Reference: Empirically Validated Behavior

These were validated in `/tmp/kimi-probe/` against `kimi-cli v1.41.0`. The plan's design depends on them; if any fails after a kimi-cli upgrade, revisit before continuing.

| Behavior | Verified |
|---|---|
| stdout = clean NDJSON; stderr = trailing `kimi -r <uuid>` only | ✅ |
| Tool call shape: `{role:"assistant",content,tool_calls:[{type:"function",id,function:{name,arguments}}]}` | ✅ |
| Tool result shape: `{role:"tool",tool_call_id,content:[{type:"text",text:"..."},...]}` | ✅ |
| `-r <uuid>` resumes context | ✅ |
| `.claude/skills/` auto-discovered | ✅ |
| Multi-turn within single process while stdin open | ✅ |
| Process exits with code 0 when stdin closes | ✅ |

## Reference: Pneuma backend integration touchpoints

(All paths/lines as of `aceef35` / `feat/kimi-backend` branch state.)

| File | Where | Why |
|---|---|---|
| `core/types/agent-backend.ts:13` | `AgentBackendType` union | Add `"kimi-cli"` |
| `backends/index.ts:11-24` | `BACKEND_DESCRIPTORS` | Add descriptor with `implemented:true` |
| `backends/index.ts:26-41` | `BACKEND_CAPABILITIES` | Declare capability flags |
| `backends/index.ts:60-63` | `BACKEND_BINARIES` | Map `"kimi-cli"` → `"kimi"` |
| `backends/index.ts:94-101` | `createBackend()` factory | Add case |
| `bin/pneuma.ts:470-500` | `checkBackendRequirements()` | Add binary-presence check + install hint |
| `bin/pneuma.ts:805-818` | adapter wire (`handleStartCommand`) | Mirror codex branch |
| `bin/pneuma.ts:2068-2077` | adapter wire (resume path) | Mirror codex branch |
| `bin/pneuma.ts:2274, 2310, 2435` | other launch entry points | Audit and mirror as needed |
| `server/ws-bridge.ts:66, 81-113, 117, 129, 161, 210, 290-293, 429, 954-968` | adapter map + branching | Add parallel `kimiAdapters` Map and branch checks |
| `server/skill-installer.ts:16-17, 42-43` | `skillsDir()`/`instructionsFile()` | **No change** — falls through to Claude defaults, which kimi auto-discovers |

---

## File Structure (new)

```
backends/kimi-cli/
├── index.ts                    # KimiCliBackend (implements AgentBackend)
├── cli-launcher.ts             # KimiCliLauncher — spawns process, owns stdio, manages lifecycle
├── kimi-adapter.ts             # KimiAdapter — parses stdout NDJSON, translates, exposes callbacks
├── protocol.ts                 # Message type defs + pure translation functions
└── __tests__/
    ├── protocol.test.ts        # Translation unit tests
    └── cli-launcher.test.ts    # Spawn smoke test (skipped if `kimi` not on PATH)
```

Each module's responsibility:
- `protocol.ts` — pure data: types + `kimiToPneuma()` / `pneumaToKimi()` translators. No IO. Maximally testable.
- `cli-launcher.ts` — process management only: spawn, kill, exit handling. Knows nothing about kimi messages; just owns the streams.
- `kimi-adapter.ts` — reads streams, parses, translates, fires callbacks. Bridge between kimi wire format and Pneuma's normalized session events.
- `index.ts` — thin `AgentBackend` adapter that wraps the launcher and exposes `getAdapter()` / `onAdapterCreated()` for `ws-bridge.ts` to wire up.

---

## Task 1: Type union + capability matrix scaffolding

**Files:**
- Modify: `core/types/agent-backend.ts:13`
- Modify: `backends/index.ts:11-101`
- Test: `backends/__tests__/index.test.ts` (create if absent)

- [ ] **Step 1.1: Write the failing test**

```typescript
// backends/__tests__/index.test.ts
import { describe, expect, it } from "bun:test";
import {
  getBackendDescriptors,
  getBackendCapabilities,
  detectBackendAvailability,
} from "../index.js";

describe("kimi-cli backend registration", () => {
  it("appears in BACKEND_DESCRIPTORS as implemented", () => {
    const desc = getBackendDescriptors().find((d) => d.type === "kimi-cli");
    expect(desc).toBeDefined();
    expect(desc!.implemented).toBe(true);
    expect(desc!.label).toBe("Kimi");
  });

  it("declares capabilities", () => {
    const caps = getBackendCapabilities("kimi-cli");
    expect(caps).toEqual({
      streaming: true,
      resume: true,
      permissions: false,
      toolProgress: false,
      modelSwitch: true,
    });
  });

  it("declares its binary as 'kimi'", () => {
    const probes = detectBackendAvailability();
    const kimi = probes.find((p) => p.type === "kimi-cli");
    expect(kimi).toBeDefined();
    // We don't assert .available because PATH varies across CI
    if (!kimi!.available) {
      expect(kimi!.reason).toContain("kimi");
    }
  });
});
```

- [ ] **Step 1.2: Run the test, expect failure**

```bash
bun test backends/__tests__/index.test.ts
```

Expected: TypeScript error on `"kimi-cli"` not assignable to `AgentBackendType`, plus runtime failures on the other assertions.

- [ ] **Step 1.3: Extend the type union**

Edit `core/types/agent-backend.ts:13`:

```typescript
export type AgentBackendType = "claude-code" | "codex" | "kimi-cli";
```

- [ ] **Step 1.4: Register descriptor + capabilities + binary**

Edit `backends/index.ts`. Append to `BACKEND_DESCRIPTORS`:

```typescript
  {
    type: "kimi-cli",
    label: "Kimi",
    description: "Moonshot AI Kimi Code CLI via stdio stream-json transport.",
    implemented: true,
  },
```

Add to `BACKEND_CAPABILITIES`:

```typescript
  "kimi-cli": {
    streaming: true,
    resume: true,
    permissions: false,
    toolProgress: false,
    modelSwitch: true,
  },
```

Add to `BACKEND_BINARIES`:

```typescript
  "kimi-cli": "kimi",
```

`createBackend()` will be filled in Task 7 — for now leave it failing the exhaustiveness check (TypeScript will flag it) so we know to come back. Add a placeholder to make the file compile and the registration tests pass:

```typescript
export function createBackend(type: AgentBackendType, port: number): AgentBackend {
  switch (type) {
    case "claude-code":
      return new ClaudeCodeBackend(port);
    case "codex":
      return new CodexBackend();
    case "kimi-cli":
      throw new Error("KimiCliBackend not yet wired (Task 7 of plan 2026-05-08-kimi-backend)");
  }
}
```

- [ ] **Step 1.5: Run the test, expect pass**

```bash
bun test backends/__tests__/index.test.ts
```

Expected: 3 passes.

- [ ] **Step 1.6: Type-check**

```bash
bun run tsc --noEmit
```

Expected: clean. (If exhaustiveness checks trip elsewhere — e.g. in `bin/pneuma.ts:470-500` `checkBackendRequirements` — note them; they'll be addressed in Task 9.)

- [ ] **Step 1.7: Commit**

```bash
git add core/types/agent-backend.ts backends/index.ts backends/__tests__/index.test.ts
git commit -m "feat(kimi): register kimi-cli in backend type union + capabilities"
```

---

## Task 2: Protocol module — types + pure translation

**Files:**
- Create: `backends/kimi-cli/protocol.ts`
- Create: `backends/kimi-cli/__tests__/protocol.test.ts`

- [ ] **Step 2.1: Write the failing test**

```typescript
// backends/kimi-cli/__tests__/protocol.test.ts
import { describe, expect, it } from "bun:test";
import {
  parseKimiLine,
  kimiToPneumaMessages,
  pneumaUserToKimi,
  type KimiAssistantMessage,
  type KimiToolMessage,
} from "../protocol.js";

describe("parseKimiLine", () => {
  it("parses an assistant text-only message", () => {
    const msg = parseKimiLine('{"role":"assistant","content":" OK"}');
    expect(msg).toEqual({ role: "assistant", content: " OK" });
  });

  it("parses an assistant message with tool_calls", () => {
    const raw = `{"role":"assistant","content":" ","tool_calls":[{"type":"function","id":"functions.Shell:0","function":{"name":"Shell","arguments":"{\\"command\\":\\"ls\\"}"}}]}`;
    const msg = parseKimiLine(raw) as KimiAssistantMessage;
    expect(msg.tool_calls?.[0].id).toBe("functions.Shell:0");
    expect(msg.tool_calls?.[0].function.name).toBe("Shell");
  });

  it("parses a tool result with multi-part content", () => {
    const raw = `{"role":"tool","content":[{"type":"text","text":"<system>ok</system>"},{"type":"text","text":"hello\\n"}],"tool_call_id":"functions.Shell:0"}`;
    const msg = parseKimiLine(raw) as KimiToolMessage;
    expect(msg.role).toBe("tool");
    expect(Array.isArray(msg.content)).toBe(true);
    expect(msg.tool_call_id).toBe("functions.Shell:0");
  });

  it("returns null for blank or unparseable lines", () => {
    expect(parseKimiLine("")).toBeNull();
    expect(parseKimiLine("not-json")).toBeNull();
    expect(parseKimiLine("{}" /* missing role */)).toBeNull();
  });
});

describe("kimiToPneumaMessages", () => {
  it("translates an assistant text message into a single text content block", () => {
    const out = kimiToPneumaMessages({ role: "assistant", content: "Hello" });
    expect(out).toEqual([
      {
        type: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    ]);
  });

  it("translates an assistant message with tool_calls into separate tool_use blocks", () => {
    const kimi: KimiAssistantMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          type: "function",
          id: "functions.Shell:0",
          function: { name: "Shell", arguments: '{"command":"ls"}' },
        },
      ],
    };
    const out = kimiToPneumaMessages(kimi);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual([
      { type: "tool_use", id: "functions.Shell:0", name: "Shell", input: { command: "ls" } },
    ]);
  });

  it("translates a tool result by collapsing text parts and exposing tool_call_id", () => {
    const kimi: KimiToolMessage = {
      role: "tool",
      tool_call_id: "functions.Shell:0",
      content: [
        { type: "text", text: "<system>ok</system>" },
        { type: "text", text: "hello\n" },
      ],
    };
    const out = kimiToPneumaMessages(kimi);
    expect(out).toEqual([
      {
        type: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "functions.Shell:0",
            content: "<system>ok</system>\nhello\n",
          },
        ],
      },
    ]);
  });

  it("tolerates malformed tool-call arguments by stringifying them", () => {
    const kimi: KimiAssistantMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          type: "function",
          id: "x",
          function: { name: "X", arguments: "not-json" },
        },
      ],
    };
    const out = kimiToPneumaMessages(kimi);
    expect(out[0].content[0]).toMatchObject({
      type: "tool_use",
      id: "x",
      name: "X",
      input: { _raw: "not-json" },
    });
  });
});

describe("pneumaUserToKimi", () => {
  it("wraps a string into a kimi user message", () => {
    expect(pneumaUserToKimi("hi")).toEqual({ role: "user", content: "hi" });
  });
});
```

- [ ] **Step 2.2: Run the test, expect failure (module not found)**

```bash
bun test backends/kimi-cli/__tests__/protocol.test.ts
```

Expected: import error on `../protocol.js`.

- [ ] **Step 2.3: Implement protocol module**

Create `backends/kimi-cli/protocol.ts`:

```typescript
/**
 * Kimi CLI protocol — message shapes (OpenAI Chat Completions style) emitted on
 * stdout when running `kimi --print --output-format stream-json`, plus pure
 * translation functions to/from Pneuma's normalized message shape.
 *
 * Shapes verified empirically against kimi-cli v1.41.0 in `/tmp/kimi-probe/`.
 * No IO in this module — keep it pure so it can be unit-tested without a
 * running kimi process.
 */

export interface KimiUserMessage {
  role: "user";
  content: string;
}

export interface KimiToolCall {
  type: "function";
  id: string;
  function: { name: string; arguments: string };
}

export interface KimiAssistantMessage {
  role: "assistant";
  content: string;
  tool_calls?: KimiToolCall[];
}

export interface KimiToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string | Array<{ type: "text"; text: string }>;
}

export type KimiMessage = KimiUserMessage | KimiAssistantMessage | KimiToolMessage;

// ── Pneuma-side normalized shapes (subset; matches what ws-bridge broadcasts) ─

export interface PneumaTextBlock {
  type: "text";
  text: string;
}
export interface PneumaToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface PneumaToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type PneumaContentBlock =
  | PneumaTextBlock
  | PneumaToolUseBlock
  | PneumaToolResultBlock;

export interface PneumaAssistantMessage {
  type: "assistant";
  content: PneumaContentBlock[];
}
export interface PneumaUserMessage {
  type: "user";
  content: PneumaContentBlock[];
}

export type PneumaMessage = PneumaAssistantMessage | PneumaUserMessage;

// ── Parsing ──────────────────────────────────────────────────────────────────

export function parseKimiLine(raw: string): KimiMessage | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const role = (parsed as { role?: unknown }).role;
  if (role !== "user" && role !== "assistant" && role !== "tool") return null;
  return parsed as KimiMessage;
}

// ── kimi → Pneuma ────────────────────────────────────────────────────────────

export function kimiToPneumaMessages(msg: KimiMessage): PneumaMessage[] {
  if (msg.role === "user") {
    return [{ type: "user", content: [{ type: "text", text: msg.content }] }];
  }

  if (msg.role === "assistant") {
    const blocks: PneumaContentBlock[] = [];
    const text = (msg.content ?? "").trim();
    if (text.length > 0 && !msg.tool_calls?.length) {
      blocks.push({ type: "text", text: msg.content });
    } else if (text.length > 0 && msg.tool_calls?.length) {
      // Some assistant turns ship narration alongside a tool call.
      blocks.push({ type: "text", text: msg.content });
    }
    for (const call of msg.tool_calls ?? []) {
      let input: Record<string, unknown>;
      try {
        const parsed = JSON.parse(call.function.arguments);
        input = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { _raw: call.function.arguments };
      } catch {
        input = { _raw: call.function.arguments };
      }
      blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input });
    }
    if (blocks.length === 0) return [];
    return [{ type: "assistant", content: blocks }];
  }

  // role === "tool"
  const text = typeof msg.content === "string"
    ? msg.content
    : msg.content.map((p) => p.text).join("\n");
  return [
    {
      type: "user",
      content: [
        { type: "tool_result", tool_use_id: msg.tool_call_id, content: text },
      ],
    },
  ];
}

// ── Pneuma → kimi ────────────────────────────────────────────────────────────

export function pneumaUserToKimi(content: string): KimiUserMessage {
  return { role: "user", content };
}
```

- [ ] **Step 2.4: Run the test, expect pass**

```bash
bun test backends/kimi-cli/__tests__/protocol.test.ts
```

Expected: all green.

- [ ] **Step 2.5: Commit**

```bash
git add backends/kimi-cli/protocol.ts backends/kimi-cli/__tests__/protocol.test.ts
git commit -m "feat(kimi): protocol types + pure kimi↔pneuma translators"
```

---

## Task 3: CLI launcher — process spawn + lifecycle

**Files:**
- Create: `backends/kimi-cli/cli-launcher.ts`

This task only manages the OS-level process: argv assembly, spawn, kill, exit tracking. It exposes `stdin` / `stdout` / `stderr` streams to the adapter (Task 5). No NDJSON parsing here.

- [ ] **Step 3.1: Implement KimiCliLauncher**

Create `backends/kimi-cli/cli-launcher.ts`:

```typescript
/**
 * Kimi CLI launcher — spawns the kimi process with stream-json IO and tracks
 * lifecycle. Mirrors the structure of CodexCliLauncher (backends/codex/cli-launcher.ts)
 * but for a simpler stdio NDJSON protocol.
 *
 * The kimi process is long-lived: stays alive across turns as long as stdin
 * remains open. Each user turn = one NDJSON line on stdin. Verified against
 * kimi-cli v1.41.0.
 */

import { randomUUID } from "node:crypto";
import { delimiter, resolve } from "node:path";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { resolveBinary, getEnrichedPath } from "../../server/path-resolver.js";
import { KimiAdapter } from "./kimi-adapter.js";

export interface KimiSessionInfo {
  sessionId: string;
  pid?: number;
  state: "starting" | "connected" | "running" | "exited";
  exitCode?: number | null;
  model?: string;
  cwd: string;
  createdAt: number;
  /** Kimi session UUID, captured from stderr; used for `-r` resume. */
  kimiSessionId?: string;
}

export interface KimiLaunchOptions {
  cwd?: string;
  model?: string;
  kimiBinary?: string;
  env?: Record<string, string>;
  /** Pneuma-side session ID (preserved if provided). */
  sessionId?: string;
  /** Kimi session ID for resume (passed as `-r <id>`). */
  resumeKimiSessionId?: string;
}

export class KimiCliLauncher {
  private sessions = new Map<string, KimiSessionInfo>();
  private nodeProcesses = new Map<string, ChildProcess>();
  private adapters = new Map<string, KimiAdapter>();
  private exitHandlers: ((sessionId: string, exitCode: number | null) => void)[] = [];
  private adapterCreatedHandlers: ((sessionId: string, adapter: KimiAdapter) => void)[] = [];

  onSessionExited(cb: (sessionId: string, exitCode: number | null) => void): void {
    this.exitHandlers.push(cb);
  }

  onAdapterCreated(cb: (sessionId: string, adapter: KimiAdapter) => void): void {
    this.adapterCreatedHandlers.push(cb);
  }

  launch(options: KimiLaunchOptions = {}): KimiSessionInfo {
    const sessionId = options.sessionId || randomUUID();
    const cwd = options.cwd || process.cwd();
    const info: KimiSessionInfo = {
      sessionId,
      state: "starting",
      model: options.model,
      cwd,
      createdAt: Date.now(),
      kimiSessionId: options.resumeKimiSessionId,
    };
    this.sessions.set(sessionId, info);
    this.spawnKimi(sessionId, info, options);
    return info;
  }

  private spawnKimi(sessionId: string, info: KimiSessionInfo, options: KimiLaunchOptions): void {
    let binary = options.kimiBinary || "kimi";
    const resolved = resolveBinary(binary);
    if (resolved) {
      binary = resolved;
    } else {
      console.error(`[kimi-launcher] Binary "${binary}" not found in PATH`);
      info.state = "exited";
      info.exitCode = 127;
      return;
    }

    const args: string[] = [
      "--print",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "-y",
      "--work-dir", info.cwd,
    ];
    if (options.model) args.push("--model", options.model);
    if (options.resumeKimiSessionId) args.push("-r", options.resumeKimiSessionId);

    const binaryDir = resolve(binary, "..");
    const enrichedPath = getEnrichedPath();
    const spawnPath = [binaryDir, ...enrichedPath.split(delimiter)].filter(Boolean).join(delimiter);

    const spawnEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDECODE: undefined, // matches codex/claude convention — prevents nested-invocation confusion
      ...options.env,
      PATH: spawnPath,
    };
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(spawnEnv)) {
      if (v !== undefined) cleanEnv[k] = v;
    }

    console.log(`[kimi-launcher] Spawning session ${sessionId}: ${binary} ${args.join(" ")}`);

    const nodeProc = nodeSpawn(binary, args, {
      cwd: info.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"], // stderr piped (we parse it for session ID)
    });

    info.pid = nodeProc.pid;
    this.nodeProcesses.set(sessionId, nodeProc);

    const adapter = new KimiAdapter({
      sessionId,
      stdin: nodeProc.stdin!,
      stdout: nodeProc.stdout!,
      stderr: nodeProc.stderr!,
      killProcess: async () => {
        nodeProc.kill("SIGTERM");
        await new Promise<void>((res) => {
          const timer = setTimeout(() => { nodeProc.kill("SIGKILL"); res(); }, 5000);
          nodeProc.once("exit", () => { clearTimeout(timer); res(); });
        });
      },
    });
    this.adapters.set(sessionId, adapter);

    adapter.onSessionId((kimiSessionId) => {
      info.kimiSessionId = kimiSessionId;
      info.state = "connected";
    });

    adapter.onDisconnect(() => {
      info.state = "exited";
      this.adapters.delete(sessionId);
    });

    for (const handler of this.adapterCreatedHandlers) {
      try { handler(sessionId, adapter); } catch {}
    }

    nodeProc.once("exit", (exitCode) => {
      const session = this.sessions.get(sessionId);
      const uptime = session ? Math.round((Date.now() - session.createdAt) / 1000) : 0;
      console.error(`[kimi-launcher] Session ${sessionId} exited (code=${exitCode}, uptime=${uptime}s)`);
      if (session) {
        session.state = "exited";
        session.exitCode = exitCode;
      }
      this.nodeProcesses.delete(sessionId);
      this.adapters.delete(sessionId);
      for (const handler of this.exitHandlers) {
        try { handler(sessionId, exitCode); } catch {}
      }
    });
  }

  markConnected(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state === "starting") session.state = "connected";
  }

  setKimiSessionId(sessionId: string, kimiSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.kimiSessionId = kimiSessionId;
  }

  getSession(sessionId: string): KimiSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getAdapter(sessionId: string): KimiAdapter | undefined {
    return this.adapters.get(sessionId);
  }

  isAlive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && session.state !== "exited";
  }

  async kill(sessionId: string): Promise<boolean> {
    const adapter = this.adapters.get(sessionId);
    if (adapter) await adapter.disconnect();
    const proc = this.nodeProcesses.get(sessionId);
    if (!proc) return false;
    proc.kill("SIGTERM");
    await new Promise<void>((res) => {
      const timer = setTimeout(() => { proc.kill("SIGKILL"); res(); }, 5000);
      proc.once("exit", () => { clearTimeout(timer); res(); });
    });
    const session = this.sessions.get(sessionId);
    if (session) { session.state = "exited"; session.exitCode = -1; }
    this.nodeProcesses.delete(sessionId);
    return true;
  }

  async killAll(): Promise<void> {
    const ids = [...this.nodeProcesses.keys()];
    await Promise.all(ids.map((id) => this.kill(id)));
  }
}
```

- [ ] **Step 3.2: Compile-check (KimiAdapter doesn't exist yet — expected fail)**

```bash
bun run tsc --noEmit
```

Expected: error on `import { KimiAdapter } from "./kimi-adapter.js"`. That's fine — Task 5 creates it. Move on.

- [ ] **Step 3.3: Commit (intermediate; will compile after Task 5)**

```bash
git add backends/kimi-cli/cli-launcher.ts
git commit -m "feat(kimi): cli launcher (process spawn + lifecycle, awaiting adapter)"
```

---

## Task 4: KimiAdapter — stream parsing + callbacks

**Files:**
- Create: `backends/kimi-cli/kimi-adapter.ts`
- Test: extend `backends/kimi-cli/__tests__/protocol.test.ts` with adapter tests OR create `__tests__/kimi-adapter.test.ts`

The adapter owns stdout/stdin/stderr streams, parses NDJSON, translates messages, and fires typed callbacks. It does NOT broadcast to browsers — that's the bridge's job (Task 8).

- [ ] **Step 4.1: Write the failing test**

Create `backends/kimi-cli/__tests__/kimi-adapter.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { Readable, Writable } from "node:stream";
import { KimiAdapter } from "../kimi-adapter.js";

function makeAdapter() {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdinWrites: string[] = [];

  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      stdinWrites.push(chunk.toString("utf-8"));
      cb();
    },
  });

  const adapter = new KimiAdapter({
    sessionId: "test-session",
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stderr as any,
    killProcess: async () => {},
  });

  return { adapter, stdout, stderr, stdin, stdinWrites };
}

describe("KimiAdapter", () => {
  it("emits onMessage for each parsed kimi NDJSON line", async () => {
    const { adapter, stdout } = makeAdapter();
    const received: any[] = [];
    adapter.onMessage((m) => received.push(m));
    stdout.push('{"role":"assistant","content":"hello"}\n');
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: "assistant",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("buffers a partial NDJSON line until newline arrives", async () => {
    const { adapter, stdout } = makeAdapter();
    const received: any[] = [];
    adapter.onMessage((m) => received.push(m));
    stdout.push('{"role":"assistant",');
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(0);
    stdout.push('"content":"ok"}\n');
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
  });

  it("captures kimi session ID from stderr", async () => {
    const { adapter, stderr } = makeAdapter();
    let captured: string | undefined;
    adapter.onSessionId((sid) => { captured = sid; });
    stderr.push("\nTo resume this session: kimi -r abcd1234-e5f6-7890-abcd-1234567890ab\n");
    await new Promise((r) => setImmediate(r));
    expect(captured).toBe("abcd1234-e5f6-7890-abcd-1234567890ab");
  });

  it("sendUserMessage writes a single NDJSON line to stdin", () => {
    const { adapter, stdinWrites } = makeAdapter();
    adapter.sendUserMessage("hi there");
    expect(stdinWrites).toEqual([
      JSON.stringify({ role: "user", content: "hi there" }) + "\n",
    ]);
  });
});
```

- [ ] **Step 4.2: Run the test, expect failure**

```bash
bun test backends/kimi-cli/__tests__/kimi-adapter.test.ts
```

Expected: import error.

- [ ] **Step 4.3: Implement KimiAdapter**

Create `backends/kimi-cli/kimi-adapter.ts`:

```typescript
/**
 * KimiAdapter — owns stdout/stdin/stderr of a spawned `kimi --print` process.
 *
 * Responsibilities:
 *   1. Buffer + parse stdout NDJSON, translate via `kimiToPneumaMessages`,
 *      fire `onMessage` for each emitted Pneuma message.
 *   2. Watch stderr for `kimi -r <uuid>` and fire `onSessionId` on first match
 *      and on every subsequent change. (Kimi prints the resume hint at end of
 *      each step; we keep the latest.)
 *   3. Accept Pneuma-side user messages via `sendUserMessage(content)`, encode
 *      as `{role:"user",content}` NDJSON, write to stdin without closing it.
 *   4. On `disconnect()` or stdout-close, fire `onDisconnect`.
 *
 * No browser/bridge knowledge here — the bridge wires these callbacks itself.
 */

import type { Readable, Writable } from "node:stream";
import {
  kimiToPneumaMessages,
  parseKimiLine,
  pneumaUserToKimi,
  type PneumaMessage,
} from "./protocol.js";

export interface KimiAdapterOptions {
  sessionId: string;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  killProcess: () => Promise<void>;
}

const SESSION_ID_RE = /kimi -r ([0-9a-f-]{36})/;

export class KimiAdapter {
  readonly sessionId: string;
  private stdin: Writable;
  private killProcess: () => Promise<void>;

  private messageHandlers: ((msg: PneumaMessage) => void)[] = [];
  private sessionIdHandlers: ((kimiSessionId: string) => void)[] = [];
  private disconnectHandlers: (() => void)[] = [];

  private stdoutBuf = "";
  private stderrBuf = "";
  private lastEmittedSessionId: string | undefined;
  private disconnected = false;

  constructor(opts: KimiAdapterOptions) {
    this.sessionId = opts.sessionId;
    this.stdin = opts.stdin;
    this.killProcess = opts.killProcess;

    opts.stdout.on("data", (chunk: Buffer | string) => this.onStdout(chunk.toString("utf-8")));
    opts.stdout.on("close", () => this.fireDisconnect());
    opts.stderr.on("data", (chunk: Buffer | string) => this.onStderr(chunk.toString("utf-8")));
  }

  onMessage(cb: (msg: PneumaMessage) => void): void {
    this.messageHandlers.push(cb);
  }
  onSessionId(cb: (kimiSessionId: string) => void): void {
    this.sessionIdHandlers.push(cb);
  }
  onDisconnect(cb: () => void): void {
    this.disconnectHandlers.push(cb);
  }

  sendUserMessage(content: string): void {
    if (this.disconnected) return;
    const line = JSON.stringify(pneumaUserToKimi(content)) + "\n";
    this.stdin.write(line);
  }

  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.disconnected = true;
    try { this.stdin.end(); } catch {}
    await this.killProcess();
    this.fireDisconnect();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    let idx: number;
    while ((idx = this.stdoutBuf.indexOf("\n")) !== -1) {
      const line = this.stdoutBuf.slice(0, idx);
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    const kimi = parseKimiLine(line);
    if (!kimi) return;
    for (const pneuma of kimiToPneumaMessages(kimi)) {
      for (const handler of this.messageHandlers) {
        try { handler(pneuma); } catch (err) {
          console.error(`[kimi-adapter ${this.sessionId}] message handler error:`, err);
        }
      }
    }
  }

  private onStderr(chunk: string): void {
    this.stderrBuf += chunk;
    // We don't gate on newlines for stderr — kimi may print the resume hint
    // without trailing newline before exit. Just scan the whole accumulated
    // buffer on each chunk.
    const match = this.stderrBuf.match(SESSION_ID_RE);
    if (match && match[1] !== this.lastEmittedSessionId) {
      this.lastEmittedSessionId = match[1];
      for (const handler of this.sessionIdHandlers) {
        try { handler(match[1]); } catch (err) {
          console.error(`[kimi-adapter ${this.sessionId}] sessionId handler error:`, err);
        }
      }
      // Forward stderr verbatim to console for diagnostics.
    }
    if (chunk) {
      process.stderr.write(`[kimi ${this.sessionId}] ${chunk}`);
    }
  }

  private fireDisconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const handler of this.disconnectHandlers) {
      try { handler(); } catch {}
    }
  }
}
```

- [ ] **Step 4.4: Run the test, expect pass**

```bash
bun test backends/kimi-cli/__tests__/kimi-adapter.test.ts
```

Expected: 4 passes.

- [ ] **Step 4.5: Type-check the new modules together**

```bash
bun run tsc --noEmit
```

Expected: clean for backends/kimi-cli/*.ts. (CreateBackend factory still throws — handled in Task 7.)

- [ ] **Step 4.6: Commit**

```bash
git add backends/kimi-cli/kimi-adapter.ts backends/kimi-cli/__tests__/kimi-adapter.test.ts
git commit -m "feat(kimi): stdio adapter — parse NDJSON, capture session id, write user turns"
```

---

## Task 5: KimiCliBackend — implements AgentBackend

**Files:**
- Create: `backends/kimi-cli/index.ts`

- [ ] **Step 5.1: Implement KimiCliBackend**

Create `backends/kimi-cli/index.ts` (mirroring `backends/codex/index.ts` line-for-line where possible):

```typescript
/**
 * KimiCliBackend — AgentBackend for Moonshot AI's Kimi CLI.
 *
 * Wraps KimiCliLauncher; uses stdio NDJSON (kimi --print --input-format stream-json
 * --output-format stream-json). Pattern mirrors CodexBackend in backends/codex/index.ts.
 */

import type {
  AgentBackend,
  AgentSessionInfo,
  AgentLaunchOptions,
  AgentCapabilities,
} from "../../core/types/agent-backend.js";
import { KimiCliLauncher } from "./cli-launcher.js";
import type { KimiSessionInfo, KimiLaunchOptions } from "./cli-launcher.js";
import type { KimiAdapter } from "./kimi-adapter.js";

export class KimiCliBackend implements AgentBackend {
  readonly name = "kimi-cli" as const;

  readonly capabilities: AgentCapabilities = {
    streaming: true,
    resume: true,
    permissions: false,
    toolProgress: false,
    modelSwitch: true,
  };

  private launcher: KimiCliLauncher;

  constructor() {
    this.launcher = new KimiCliLauncher();
  }

  launch(options: AgentLaunchOptions): AgentSessionInfo {
    const launchOpts: KimiLaunchOptions = {
      cwd: options.cwd,
      model: options.model,
      sessionId: options.sessionId,
      resumeKimiSessionId: options.resumeSessionId,
      env: options.env,
    };
    const info = this.launcher.launch(launchOpts);
    return this.toAgentSessionInfo(info);
  }

  getSession(sessionId: string): AgentSessionInfo | undefined {
    const info = this.launcher.getSession(sessionId);
    return info ? this.toAgentSessionInfo(info) : undefined;
  }

  isAlive(sessionId: string): boolean {
    return this.launcher.isAlive(sessionId);
  }

  markConnected(sessionId: string): void {
    this.launcher.markConnected(sessionId);
  }

  setAgentSessionId(sessionId: string, agentSessionId: string): void {
    this.launcher.setKimiSessionId(sessionId, agentSessionId);
  }

  async kill(sessionId: string): Promise<boolean> {
    return this.launcher.kill(sessionId);
  }

  async killAll(): Promise<void> {
    return this.launcher.killAll();
  }

  onSessionExited(cb: (sessionId: string, exitCode: number | null) => void): void {
    this.launcher.onSessionExited(cb);
  }

  /** Bridge integration hooks (mirrors CodexBackend.onAdapterCreated / getAdapter). */
  onAdapterCreated(cb: (sessionId: string, adapter: KimiAdapter) => void): void {
    this.launcher.onAdapterCreated(cb);
  }

  getAdapter(sessionId: string): KimiAdapter | undefined {
    return this.launcher.getAdapter(sessionId);
  }

  private toAgentSessionInfo(info: KimiSessionInfo): AgentSessionInfo {
    return {
      sessionId: info.sessionId,
      agentSessionId: info.kimiSessionId,
      pid: info.pid,
      state: info.state,
      exitCode: info.exitCode,
      cwd: info.cwd,
      createdAt: info.createdAt,
    };
  }
}
```

- [ ] **Step 5.2: Type-check**

```bash
bun run tsc --noEmit
```

Expected: clean for `backends/kimi-cli/`. Factory in `backends/index.ts` still throws — Task 7.

- [ ] **Step 5.3: Commit**

```bash
git add backends/kimi-cli/index.ts
git commit -m "feat(kimi): KimiCliBackend implementing AgentBackend"
```

---

## Task 6: WsBridge integration — `attachKimiAdapter`

**Files:**
- Modify: `server/ws-bridge.ts`
- Create: `server/ws-bridge-kimi.ts` (parallel to `ws-bridge-codex.ts`)

The bridge already has `codexAdapters: Map<string, CodexAdapter>` plus branching at multiple call sites. We mirror that for kimi rather than abstracting both behind a common interface (YAGNI — generalize when we add a 4th backend).

- [ ] **Step 6.1: Read the codex bridge module**

```bash
sed -n '1,50p' server/ws-bridge-codex.ts
```

Goal: understand what handlers `attachCodexAdapterHandlers` wires up. Replicate the **subset** that applies to kimi (no permission flow, no tool_progress).

- [ ] **Step 6.2: Create ws-bridge-kimi.ts**

Create `server/ws-bridge-kimi.ts`:

```typescript
/**
 * Bridges a KimiAdapter to a Pneuma session: the adapter emits Pneuma-shape
 * messages (already translated from kimi NDJSON), this module relays them to
 * connected browsers as standard message broadcasts and persists them to
 * session history the same way the Claude path does.
 *
 * Mirror of ws-bridge-codex.ts, scoped to the smaller capability surface.
 */

import type { KimiAdapter } from "../backends/kimi-cli/kimi-adapter.js";
import type { Session } from "./session-types.js";
import type { PneumaMessage } from "../backends/kimi-cli/protocol.js";

export interface KimiBridgeDeps {
  broadcastToBrowsers: (session: Session, msg: unknown) => void;
  workspace: string;
}

export function attachKimiAdapterHandlers(
  sessionId: string,
  session: Session,
  adapter: KimiAdapter,
  deps: KimiBridgeDeps,
): void {
  adapter.onMessage((pneuma: PneumaMessage) => {
    // Wrap as the same envelope the Claude path uses; the frontend already
    // knows how to render `assistant` / `user` (with tool_use / tool_result).
    deps.broadcastToBrowsers(session, {
      type: pneuma.type,
      message: { role: pneuma.type, content: pneuma.content },
    });
    // Mark idle when an assistant message lands without trailing tool_use.
    const lastBlock = pneuma.content[pneuma.content.length - 1];
    if (pneuma.type === "assistant" && lastBlock && lastBlock.type !== "tool_use") {
      session.cliIdle = true;
      deps.broadcastToBrowsers(session, { type: "session_update", session: { ...session.state, cli_busy: false } });
    } else if (pneuma.type === "assistant") {
      session.cliIdle = false;
    }
  });

  adapter.onDisconnect(() => {
    deps.broadcastToBrowsers(session, { type: "cli_disconnected" });
  });
}
```

- [ ] **Step 6.3: Add kimi map + attach method to WsBridge**

Edit `server/ws-bridge.ts`. Near the top imports, add:

```typescript
import type { KimiAdapter } from "../backends/kimi-cli/kimi-adapter.js";
import { attachKimiAdapterHandlers } from "./ws-bridge-kimi.js";
```

Inside the `WsBridge` class fields (next to `codexAdapters`):

```typescript
  private kimiAdapters = new Map<string, KimiAdapter>();
```

Add the attach method right below `attachCodexAdapter`:

```typescript
  attachKimiAdapter(sessionId: string, adapter: KimiAdapter): void {
    const session = this.getOrCreateSession(sessionId, "kimi-cli");
    this.kimiAdapters.set(sessionId, adapter);

    attachKimiAdapterHandlers(sessionId, session, adapter, {
      broadcastToBrowsers: (s, msg) => this.broadcastToBrowsers(s, msg),
      workspace: this.workspace,
    });

    adapter.onSessionId((kimiSessionId) => {
      if (this.onCLISessionId) this.onCLISessionId(sessionId, kimiSessionId);
    });

    this.broadcastToBrowsers(session, { type: "cli_connected" });

    if (session.pendingMessages.length > 0) {
      console.log(`[ws-bridge] Flushing ${session.pendingMessages.length} queued message(s) via Kimi adapter for session ${sessionId}`);
      const queued = session.pendingMessages.splice(0);
      for (const ndjson of queued) {
        try {
          const msg = JSON.parse(ndjson);
          if (msg.type === "user_message" && typeof msg.content === "string") {
            adapter.sendUserMessage(msg.content);
          }
        } catch (err) {
          console.error(`[ws-bridge] Failed to parse/send queued message for session ${sessionId}:`, err);
        }
      }
    }
  }

  isKimiSession(sessionId: string): boolean {
    return this.kimiAdapters.has(sessionId);
  }
```

- [ ] **Step 6.4: Branch in routing methods**

For each `this.codexAdapters.get(sessionId)` / `this.codexAdapters.has(sessionId)` site in `server/ws-bridge.ts`, add a parallel kimi check. Specifically (line numbers from current `feat/kimi-backend` HEAD; verify with grep before editing):

In `injectGreeting` (~line 129):

```typescript
    const kimiAdapter = this.kimiAdapters.get(sessionId);
    if (kimiAdapter) {
      kimiAdapter.sendUserMessage(content);
      return;
    }
```

In `dispatchSyntheticUserMessage` (~line 161 — same pattern, dispatches synthetic user messages):

```typescript
    const kimiAdapter = this.kimiAdapters.get(session.id);
    if (kimiAdapter) {
      kimiAdapter.sendUserMessage(content);
      return;
    }
```

In `getActiveSessionId` (~line 210):

```typescript
      if (session.cliSocket || this.codexAdapters.has(id) || this.kimiAdapters.has(id)) return id;
```

In session-cleanup (~line 290):

```typescript
    const kimiAdapter = this.kimiAdapters.get(sessionId);
    if (kimiAdapter) {
      this.kimiAdapters.delete(sessionId);
    }
```

In the "no transport" guard at ~line 429:

```typescript
    if (!session.cliSocket && !this.codexAdapters.has(sessionId) && !this.kimiAdapters.has(sessionId)) {
      // queue
    }
```

In `handleBrowserUserMessage` at ~line 954 (where codex is routed):

```typescript
    const kimiAdapter = this.kimiAdapters.get(session.id);
    if (kimiAdapter) {
      kimiAdapter.sendUserMessage(msg.content);
      return;
    }
```

Use `grep -n "codexAdapters" server/ws-bridge.ts` to confirm you've covered each occurrence; every site that gets/has a codex adapter should also handle the kimi case.

- [ ] **Step 6.5: Type-check**

```bash
bun run tsc --noEmit
```

Expected: clean.

- [ ] **Step 6.6: Sanity test the bridge**

Add a minimal integration test exercising the wiring — `server/__tests__/ws-bridge-kimi.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { Readable, Writable } from "node:stream";
import { WsBridge } from "../ws-bridge.js";
import { KimiAdapter } from "../../backends/kimi-cli/kimi-adapter.js";

describe("WsBridge.attachKimiAdapter", () => {
  it("routes user messages to the kimi adapter", () => {
    const stdoutFake = new Readable({ read() {} });
    const stderrFake = new Readable({ read() {} });
    const stdinWrites: string[] = [];
    const stdinFake = new Writable({
      write(c, _e, cb) { stdinWrites.push(c.toString("utf-8")); cb(); },
    });

    const adapter = new KimiAdapter({
      sessionId: "s1",
      stdin: stdinFake as any,
      stdout: stdoutFake as any,
      stderr: stderrFake as any,
      killProcess: async () => {},
    });

    const bridge = new WsBridge({ workspace: "/tmp/ws-bridge-test" });
    bridge.attachKimiAdapter("s1", adapter);
    expect(bridge.isKimiSession("s1")).toBe(true);

    bridge.injectGreeting("s1", "hello");
    expect(stdinWrites.some((w) => w.includes("hello"))).toBe(true);
  });
});
```

If `WsBridge`'s constructor signature differs (it's `new WsBridge({ workspace })` per current code; verify with `grep "class WsBridge\|constructor(" server/ws-bridge.ts`), adjust accordingly.

- [ ] **Step 6.7: Run the bridge test**

```bash
bun test server/__tests__/ws-bridge-kimi.test.ts
```

Expected: pass.

- [ ] **Step 6.8: Commit**

```bash
git add server/ws-bridge.ts server/ws-bridge-kimi.ts server/__tests__/ws-bridge-kimi.test.ts
git commit -m "feat(kimi): WsBridge.attachKimiAdapter + routing branches"
```

---

## Task 7: Wire factory + remove placeholder

**Files:**
- Modify: `backends/index.ts:94-101`

- [ ] **Step 7.1: Replace the placeholder**

In `backends/index.ts`, change `createBackend()`:

```typescript
import { KimiCliBackend } from "./kimi-cli/index.js";

// ...

export function createBackend(type: AgentBackendType, port: number): AgentBackend {
  switch (type) {
    case "claude-code":
      return new ClaudeCodeBackend(port);
    case "codex":
      return new CodexBackend();
    case "kimi-cli":
      return new KimiCliBackend();
  }
}
```

- [ ] **Step 7.2: Run all backend tests**

```bash
bun test backends/
```

Expected: all green.

- [ ] **Step 7.3: Commit**

```bash
git add backends/index.ts
git commit -m "feat(kimi): wire KimiCliBackend into createBackend factory"
```

---

## Task 8: CLI integration — `bin/pneuma.ts`

**Files:**
- Modify: `bin/pneuma.ts:470-500` (`checkBackendRequirements`)
- Modify: `bin/pneuma.ts:805-818` and the other 3+ adapter-wire branches (each `if (backendType === "codex") { ... }` site)

- [ ] **Step 8.1: Add binary check**

In `bin/pneuma.ts:checkBackendRequirements()`, add a kimi-cli case **before** the final fallthrough:

```typescript
  if (backendType === "kimi-cli") {
    const resolved = resolveBinary("kimi");
    if (!resolved) {
      p.cancel(
        "Kimi CLI not found.\n" +
        "  Pneuma requires Kimi CLI to be installed and authenticated.\n" +
        "  Install: uv tool install kimi-cli\n" +
        "  Then run: kimi login\n" +
        "  Docs: https://moonshotai.github.io/kimi-cli/"
      );
      process.exit(1);
    }
    return;
  }
```

- [ ] **Step 8.2: Wire adapter at every spawn site**

Find every `if (backendType === "codex")` in `bin/pneuma.ts`:

```bash
grep -n 'backendType === "codex"' bin/pneuma.ts
```

At each of those sites (currently lines ~485, ~805, ~2068; the 485 case is `checkBackendRequirements` and is independent), add a kimi-cli equivalent right after. Pattern:

```typescript
  if (backendType === "kimi-cli") {
    const { KimiCliBackend } = await import("../backends/kimi-cli/index.js");
    if (backend instanceof KimiCliBackend) {
      const existingAdapter = backend.getAdapter(session.sessionId); // or sessionId — match the surrounding scope
      if (existingAdapter) {
        wsBridge.attachKimiAdapter(session.sessionId, existingAdapter);
      }
      backend.onAdapterCreated((sid, adapter) => {
        if (sid === session.sessionId) {
          wsBridge.attachKimiAdapter(sid, adapter);
        }
      });
    }
  }
```

(Variable names — `session.sessionId` vs `sessionId` — depend on local scope; use what the codex branch right above uses.)

- [ ] **Step 8.3: Confirm no other backend-type switch needs updating**

```bash
grep -n 'backendType ===\|backend.name ===\|"claude-code"\|"codex"' bin/pneuma.ts | grep -v "//"
```

Audit each match. Any that branches between claude-code and codex needs to consider kimi-cli's behavior:
- Resume identity check (`bin/pneuma-cli-helpers.ts:177-195`) — should already work generically (compares strings), no change.
- Skill installer's `instructionsFile()` already returns `CLAUDE.md` for non-codex — no change.
- Any UI-string switches — leave alone if data-driven from BACKEND_DESCRIPTORS.

- [ ] **Step 8.4: Type-check**

```bash
bun run tsc --noEmit
```

Expected: clean.

- [ ] **Step 8.5: Commit**

```bash
git add bin/pneuma.ts
git commit -m "feat(kimi): wire kimi-cli into bin/pneuma launch + adapter attach paths"
```

---

## Task 9: Frontend backend awareness (launcher + per-feature gates)

**Files:**
- Modify: `src/components/Launcher.tsx:16` — local `BackendType` union
- Modify: `src/components/Launcher.tsx:27-35` — `FALLBACK_BACKENDS`
- Modify: `src/components/Launcher.tsx:350-365` — `backendLabel()` + `BackendLogo` (add kimi icon)
- Modify: `src/components/Launcher.tsx:3320` — hardcoded fallback `"claude-code"` (review for correctness, no change required if existing logic is just a default)
- Modify: `src/components/ContextPanel.tsx:28,38` — change `!== "codex"` to `=== "claude-code"` (semantic correctness — those rows are Claude-only)
- Modify: `src/components/ChatPanel.tsx:109` — change `!== "codex"` to `=== "claude-code"` (cost tracking is Claude-only; kimi has no in-band cost data)
- (No change) `src/components/TopBar.tsx:308` — already uses `=== "claude-code"` correctly
- (No change) `src/components/SessionAtlas.tsx:159` — displays `session.backend_type` verbatim, data-driven

The launcher's `BackendOption[]` is already populated from `/api/backends`, which derives from `BACKEND_DESCRIPTORS` (extended in Task 1). The work here is updating the **string / icon / type-alias** surfaces that hardcode the two existing backends.

- [ ] **Step 9.1: Extend the local `BackendType` alias**

In `src/components/Launcher.tsx:16`:

```typescript
type BackendType = "claude-code" | "codex" | "kimi-cli";
```

(Importing the canonical type from `core/types/agent-backend.ts` would be cleaner; defer that refactor — out of scope for this PR per YAGNI.)

- [ ] **Step 9.2: Update `backendLabel()` to a switch**

Replace `Launcher.tsx:350-351`:

```typescript
function backendLabel(backendType: BackendType): string {
  switch (backendType) {
    case "claude-code": return "Claude";
    case "codex": return "Codex";
    case "kimi-cli": return "Kimi";
  }
}
```

Exhaustiveness via `switch` will trip TypeScript on the next backend addition — desired.

- [ ] **Step 9.3: Add kimi case to `BackendLogo`**

Edit `src/components/Launcher.tsx` `BackendLogo` (around line 354). Add a `kimi-cli` branch with a simple SVG mark — a moon crescent works (keeps the visual idea of "Moonshot AI" without infringing brand assets):

```typescript
function BackendLogo({ type, className }: { type: BackendType; className?: string }) {
  if (type === "claude-code") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {/* existing claude path */}
      </svg>
    );
  }
  if (type === "kimi-cli") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  // Codex — terminal-style icon (existing fallback)
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* existing codex path */}
    </svg>
  );
}
```

(Keep the existing path data inside the `claude-code` and codex branches — only **add** the kimi branch.)

- [ ] **Step 9.4: Extend `FALLBACK_BACKENDS`**

The fallback list is only used if `/api/backends` fails to load. Mirror the new descriptor:

```typescript
const FALLBACK_BACKENDS: BackendOption[] = [
  {
    type: "claude-code",
    label: "Claude Code",
    description: "Anthropic Claude Code CLI via stdio stream-json transport.",
    implemented: true,
    available: true,
  },
  {
    type: "codex",
    label: "Codex",
    description: "OpenAI Codex CLI via app-server transport.",
    implemented: true,
    available: true,
  },
  {
    type: "kimi-cli",
    label: "Kimi",
    description: "Moonshot AI Kimi Code CLI via stdio stream-json transport.",
    implemented: true,
    available: true,
  },
];
```

(Note: I corrected the existing claude-code description from `--sdk-url WebSocket` to `stdio stream-json` — the running Pneuma is using stdio per `backends/claude-code/cli-launcher.ts`. Aligns with the canonical `BACKEND_DESCRIPTORS` in `backends/index.ts`.)

- [ ] **Step 9.5: Tighten `!== "codex"` gates**

In `src/components/ContextPanel.tsx`, find both `session.backend_type !== "codex"` checks (around lines 28 and 38). They gate Claude-specific UI rows (read the surrounding context to confirm). Change to:

```tsx
{session.backend_type === "claude-code" && (
  /* …Claude-only row… */
)}
```

Same change in `src/components/ChatPanel.tsx:109`:

```tsx
{session.backend_type === "claude-code" && session.total_cost_usd > 0 && (
  /* total cost UI */
)}
```

These flips are **semantic corrections**: the original code meant "Claude" but expressed it as "not Codex" because there were only two backends. Adding kimi-cli would otherwise cause those Claude-only UIs to show with empty data on kimi sessions.

- [ ] **Step 9.6: Type-check + frontend smoke**

```bash
bun run tsc --noEmit
```

Expected: clean. The exhaustiveness of `backendLabel`'s switch will catch any other site we missed.

- [ ] **Step 9.7: Visual check**

Per `CLAUDE.md` coding conventions ("Visual verification for frontend changes"), start the dev server, open the launcher, and confirm:
- A Kimi entry appears in the backend picker (Mode launch dialog)
- The kimi icon renders (crescent moon)
- A new session card built with `backendType: "kimi-cli"` shows label "Kimi"

Use `chrome-devtools-mcp` to take a screenshot for the PR description. If the Chrome MCP is locked, fall back to the user's manual screenshot.

- [ ] **Step 9.8: Commit**

```bash
git add src/components/Launcher.tsx src/components/ContextPanel.tsx src/components/ChatPanel.tsx
git commit -m "feat(kimi): launcher backend picker + per-feature Claude-only gates"
```

---

## Task 10: End-to-end smoke test

**Files:** none modified — this is a manual checklist run on a clean shell. Document the result in the PR description.

Pre-reqs: `kimi` on PATH, authenticated (`kimi login` already done).

- [ ] **Step 10.1: Build (if running prod) or run dev**

```bash
rm -rf dist
bun run dev doc --backend kimi-cli --workspace /tmp/kimi-e2e --port 17996 --no-prompt
```

Expected: launcher logs include `Spawning session ... kimi --print --input-format stream-json --output-format stream-json -y --work-dir /tmp/kimi-e2e`. No crashes.

- [ ] **Step 10.2: Confirm browser connects**

Open `http://localhost:17996/` in a browser. Expected:
- TopBar shows the Doc Mode chip
- "Backend: Kimi" appears wherever the backend label is surfaced (search Launcher / settings popover)
- Chat panel is empty, ready

- [ ] **Step 10.3: First-turn smoke**

Type "Reply with exactly the word OK and nothing else" in the chat. Expected:
- Assistant message arrives with `OK` (or close — kimi responses sometimes have a leading space)
- `.pneuma/session.json` written under `/tmp/kimi-e2e/` with `backendType: "kimi-cli"` and a populated `agentSessionId` (UUID, captured from stderr)

```bash
cat /tmp/kimi-e2e/.pneuma/session.json | jq '{backendType, agentSessionId, sessionId}'
```

- [ ] **Step 10.4: Skill discovery smoke**

Place a probe skill:

```bash
mkdir -p /tmp/kimi-e2e/.claude/skills/pneuma-probe
cat > /tmp/kimi-e2e/.claude/skills/pneuma-probe/SKILL.md <<'EOF'
---
name: pneuma-probe
description: Probe — assistant must say "PNEUMA-PROBE-PRESENT" if asked.
---
If asked anything, include the literal token PNEUMA-PROBE-PRESENT in your reply.
EOF
```

Reload the page (so kimi re-discovers skills on next turn). Type "say hi". Expected: response includes `PNEUMA-PROBE-PRESENT`. If not, kimi-cli's skill discovery may need explicit `--skills-dir` — file a follow-up but treat as cosmetic for this PR.

- [ ] **Step 10.5: Resume smoke**

Stop the server (Ctrl-C). Restart with the same workspace:

```bash
bun run dev doc --backend kimi-cli --workspace /tmp/kimi-e2e --port 17996 --no-prompt
```

Refresh the browser. Expected: chat history rehydrates from `/tmp/kimi-e2e/.pneuma/history.json`. Type "what was the magic word from earlier?" — kimi should remember context (we passed `-r <agentSessionId>` from the persisted session).

- [ ] **Step 10.6: Backend conflict guard**

```bash
bun run dev doc --backend codex --workspace /tmp/kimi-e2e --port 17996 --no-prompt
```

Expected: explicit error from `pneuma-cli-helpers.ts` saying the workspace is bound to `kimi-cli`; suggesting to use `--backend kimi-cli`.

- [ ] **Step 10.7: Cleanup**

```bash
rm -rf /tmp/kimi-e2e
```

- [ ] **Step 10.8: Document the result**

Update the PR description with one line per smoke step (✅ / ❌ + note).

---

## Self-Review Notes

- **Spec coverage**: Tasks 1-7 implement contract surface; Task 8 wires CLI; Task 9 verifies end-to-end. Skill installer needs **no** code change (verified empirically + per kimi docs); flagged in plan header.
- **Type consistency**: `agentSessionId` (Pneuma side) ↔ `kimiSessionId` (kimi internal) ↔ `cliSessionId` (Claude legacy term still used in some bridge callbacks); the mapping is centralized in `KimiCliBackend.toAgentSessionInfo()` / `setAgentSessionId()`.
- **Streaming caveat**: `streaming: true` is declared because kimi flushes incrementally per step (matches codex semantics); it does NOT mean token-level streaming. Re-evaluate if a future UI feature depends on token deltas.
- **Permissions**: declared `false` because `--print -y` auto-approves and there's no in-band permission RPC. Adding interactive permissions would require switching to ACP (Path B).
- **Stderr regex fragility**: `kimi -r <uuid>` is undocumented. If a future kimi-cli version changes the format, this plan must be revisited. Mitigation idea (post-MVP): pass our own UUID via `-r` at launch — the docs say "creates new if not found." Not relied on in this plan because it's not yet verified.
