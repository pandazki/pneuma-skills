# ReadFile Scene Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render inline image thumbnails on file tool-call blocks in the chat, plus a per-block action row (open with default app / open in code editor / reveal in Finder), with backend tool-naming differences pushed into a per-backend `BackendModule.toolFileRef` resolver.

**Architecture:** Each backend's `BackendModule` exposes an optional pure `toolFileRef(name, input) → { path, kind }`. A shared `stampFileRefs` helper, called on every assistant-message broadcast in all three backend bridges, stamps a normalized `fileRef` onto `tool_use` blocks. The chat reads `block.fileRef` only — zero tool-name or `if (backend === …)` knowledge in the UI. A new `GET /api/file?path=<abs>` serves workspace files for `<img>`. New mode-agnostic components: `FilePreview` (image thumbnail + lightbox, extensible), `ToolFileActions` (the three buttons), `ImageLightbox`.

**Tech Stack:** Bun, Hono, React 19, Tailwind 4, bun:test. Spec: `docs/superpowers/specs/2026-05-11-readfile-scene-preview-design.md`.

---

## File Structure

| File | Responsibility | New/Modified |
|---|---|---|
| `backends/tool-file-ref.ts` | `defaultToolFileRef` + `KIND_BY_NAME` + `ToolFileRef` type. Pure, no other-module imports. | New |
| `backends/__tests__/tool-file-ref.test.ts` | Unit tests for `defaultToolFileRef`. | New |
| `core/types/agent-backend.ts` | Add optional `toolFileRef?` to `BackendModule`. | Modified |
| `backends/claude-code/manifest.ts` | `toolFileRef: defaultToolFileRef`. | Modified |
| `backends/codex/manifest.ts` | `toolFileRef: defaultToolFileRef`. | Modified |
| `backends/kimi-cli/manifest.ts` | `toolFileRef`: kimi-aware (Claude-shaped names + generic `path` key + default fallback). | Modified |
| `core/__tests__/backend-module.test.ts` | Assert each backend module's `toolFileRef` resolves an `Edit` call. | Modified |
| `server/session-types.ts` | Add `fileRef?` to the `tool_use` `ContentBlock` variant. | Modified |
| `server/file-ref.ts` | `stampFileRefs(content, backendType)` — iterates `tool_use` blocks, looks up the backend module's `toolFileRef`, stamps `block.fileRef`. | New |
| `server/__tests__/file-ref.test.ts` | Unit tests for `stampFileRefs`. | New |
| `server/ws-bridge.ts` | Call `stampFileRefs` in `handleAssistantMessage` (Claude path). | Modified |
| `server/ws-bridge-codex.ts` | Call `stampFileRefs` in the `onBrowserMessage` broadcast callback for `assistant` messages. | Modified |
| `server/ws-bridge-kimi.ts` | Call `stampFileRefs` in `onAdapterMessage` before broadcast. | Modified |
| `server/index.ts` | Add `GET /api/file?path=<abs>` (workspace-containment-checked file server). | Modified |
| `server/__tests__/file-route.test.ts` | Tests for `GET /api/file`. | New |
| `src/hooks/useFocusTrap.ts` | Mode-agnostic copy of `modes/clipcraft/viewer/hooks/useFocusTrap.ts`. | New |
| `src/components/ImageLightbox.tsx` | Full-screen image overlay (Esc / backdrop / focus-trap). | New |
| `src/components/__tests__/ImageLightbox.test.tsx` | Tests. | New |
| `src/components/FilePreview.tsx` | `{ path }` → image thumbnail + lightbox; `isInlinePreviewable(path)` companion; non-image → `null`. | New |
| `src/components/__tests__/FilePreview.test.tsx` | Tests. | New |
| `src/components/ToolFileActions.tsx` | `{ path }` → Open / Editor▾ / Reveal buttons. | New |
| `src/components/__tests__/ToolFileActions.test.tsx` | Tests. | New |
| `src/components/ToolBlock.tsx` | New `fileRef?` prop; render `<ToolFileActions>` + (when previewable) `<FilePreview>`; force-expand for previewable images. | Modified |
| `src/components/MessageBubble.tsx` | Pass `fileRef={block.fileRef}` to `<ToolBlock>` at both call sites. | Modified |
| `CLAUDE.md`, `CHANGELOG.md`, `package.json` | Docs + version bump. | Modified |

---

## Task 1: `defaultToolFileRef` pure helper

**Files:**
- Create: `backends/tool-file-ref.ts`
- Test: `backends/__tests__/tool-file-ref.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backends/__tests__/tool-file-ref.test.ts
import { describe, expect, it } from "bun:test";
import { defaultToolFileRef } from "../tool-file-ref.js";

describe("defaultToolFileRef", () => {
  it("maps Read to kind=read with file_path", () => {
    expect(defaultToolFileRef("Read", { file_path: "/w/a.png" })).toEqual({ path: "/w/a.png", kind: "read" });
  });
  it("maps Write to kind=write", () => {
    expect(defaultToolFileRef("Write", { file_path: "/w/a.ts", content: "x" })).toEqual({ path: "/w/a.ts", kind: "write" });
  });
  it("maps Edit to kind=edit", () => {
    expect(defaultToolFileRef("Edit", { file_path: "/w/a.ts" })).toEqual({ path: "/w/a.ts", kind: "edit" });
  });
  it("maps NotebookEdit to kind=edit, accepts notebook_path", () => {
    expect(defaultToolFileRef("NotebookEdit", { notebook_path: "/w/n.ipynb" })).toEqual({ path: "/w/n.ipynb", kind: "edit" });
  });
  it("returns undefined for unknown tool names", () => {
    expect(defaultToolFileRef("Bash", { command: "cat a.png" })).toBeUndefined();
    expect(defaultToolFileRef("Grep", { pattern: "x" })).toBeUndefined();
  });
  it("returns undefined when no path present or path is not a non-empty string", () => {
    expect(defaultToolFileRef("Read", {})).toBeUndefined();
    expect(defaultToolFileRef("Read", { file_path: "" })).toBeUndefined();
    expect(defaultToolFileRef("Read", { file_path: 123 })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test backends/__tests__/tool-file-ref.test.ts`
Expected: FAIL — cannot find module `../tool-file-ref.js`.

- [ ] **Step 3: Write the implementation**

```ts
// backends/tool-file-ref.ts
/**
 * Normalized reference to the file a tool call operates on. Lets the chat
 * UI render previews / system-open actions without knowing any backend's
 * tool naming — each backend's BackendModule.toolFileRef returns one of
 * these (or undefined).
 */
export interface ToolFileRef {
  path: string;
  kind: "read" | "write" | "edit";
}

/**
 * The Claude-shaped file-tool convention, also used verbatim by the Codex
 * backend (its adapter normalizes fileChange → an `Edit` tool_use with
 * `file_path`). A non-default backend overrides BackendModule.toolFileRef
 * with its own resolver when its tool naming differs.
 */
const KIND_BY_NAME: Record<string, ToolFileRef["kind"]> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  NotebookEdit: "edit",
};

export function defaultToolFileRef(
  toolName: string,
  input: Record<string, unknown>,
): ToolFileRef | undefined {
  const kind = KIND_BY_NAME[toolName];
  if (!kind) return undefined;
  const raw = input.file_path ?? input.notebook_path;
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return { path: raw, kind };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test backends/__tests__/tool-file-ref.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backends/tool-file-ref.ts backends/__tests__/tool-file-ref.test.ts
git commit -m "feat(backends): defaultToolFileRef — Claude-shaped file-tool resolver"
```

---

## Task 2: `BackendModule.toolFileRef?` contract + wire claude-code & codex

**Files:**
- Modify: `core/types/agent-backend.ts` (the `BackendModule` interface)
- Modify: `backends/claude-code/manifest.ts`, `backends/codex/manifest.ts`
- Test: `core/__tests__/backend-module.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `core/__tests__/backend-module.test.ts` (inside the existing describe block; if the file imports the modules already, reuse those imports):

```ts
import { claudeCodeModule } from "../../backends/claude-code/manifest.js";
import { codexModule } from "../../backends/codex/manifest.js";

describe("BackendModule.toolFileRef", () => {
  it("claude-code resolves an Edit call to a file ref", () => {
    expect(claudeCodeModule.toolFileRef?.("Edit", { file_path: "/w/a.ts" })).toEqual({ path: "/w/a.ts", kind: "edit" });
    expect(claudeCodeModule.toolFileRef?.("Read", { file_path: "/w/a.png" })).toEqual({ path: "/w/a.png", kind: "read" });
  });
  it("codex resolves an Edit call to a file ref", () => {
    expect(codexModule.toolFileRef?.("Edit", { file_path: "/w/main.ts" })).toEqual({ path: "/w/main.ts", kind: "edit" });
  });
  it("returns undefined for non-file tools", () => {
    expect(claudeCodeModule.toolFileRef?.("Bash", { command: "ls" })).toBeUndefined();
  });
});
```

> Check the actual export names in `backends/claude-code/manifest.ts` and `backends/codex/manifest.ts` before writing the import (the BackendModule export — e.g. `claudeCodeModule`, `codexModule`). Use whatever they actually are.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/__tests__/backend-module.test.ts`
Expected: FAIL — `toolFileRef` is `undefined` (not yet wired).

- [ ] **Step 3: Add `toolFileRef?` to the `BackendModule` interface**

In `core/types/agent-backend.ts`, find the `BackendModule` interface and add (place it near the other capability/identity fields, with this JSDoc):

```ts
  /**
   * Pure helper: given a tool_use block's name + input, return a normalized
   * reference to the file it operates on, or undefined if the tool isn't a
   * file op. Lets the chat UI render inline previews / system-open actions
   * without knowing this backend's tool naming. Optional — backends that
   * don't implement it simply don't get previews/actions on their tool
   * calls (graceful, no special-casing).
   */
  toolFileRef?(toolName: string, input: Record<string, unknown>):
    | import("../../backends/tool-file-ref.js").ToolFileRef
    | undefined;
```

> If `core/types/agent-backend.ts` already imports types from `backends/`, prefer a top-of-file `import type { ToolFileRef } from "../../backends/tool-file-ref.js";` and reference `ToolFileRef` directly instead of the inline `import(...)`. Match the file's existing import style.

- [ ] **Step 4: Wire claude-code & codex manifests**

In `backends/claude-code/manifest.ts`, add the import and the field on the exported module object:

```ts
import { defaultToolFileRef } from "../tool-file-ref.js";
// ...inside the BackendModule object literal:
  toolFileRef: defaultToolFileRef,
```

Same in `backends/codex/manifest.ts`:

```ts
import { defaultToolFileRef } from "../tool-file-ref.js";
// ...inside the BackendModule object literal:
  toolFileRef: defaultToolFileRef,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test core/__tests__/backend-module.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/types/agent-backend.ts backends/claude-code/manifest.ts backends/codex/manifest.ts core/__tests__/backend-module.test.ts
git commit -m "feat(backends): BackendModule.toolFileRef — wire claude-code + codex"
```

---

## Task 3: kimi-cli `toolFileRef`

**Files:**
- Modify: `backends/kimi-cli/manifest.ts`
- Test: extend `core/__tests__/backend-module.test.ts`

> kimi-cli passes its native tool function names through verbatim (`backends/kimi-cli/protocol.ts` line ~168: `{ type: "tool_use", id: call.id, name: call.function.name, input }`). The exact names for kimi's file ops aren't pinned here, so the resolver covers two cases: (1) Claude-shaped names (`Read`/`Write`/`Edit`/`NotebookEdit`), reusing `defaultToolFileRef`; (2) any tool whose `input` carries a non-empty string `path` or `file_path` → treat as `edit` kind. This is deliberately permissive — it never throws, and worst case it stamps a `fileRef` on a tool that isn't really a file op, which only means the chat shows an "Open" button that may 404 (handled gracefully). If kimi's real tool names turn out to need finer mapping, refine here later.

- [ ] **Step 1: Write the failing test**

Add to `core/__tests__/backend-module.test.ts`:

```ts
import { kimiCliModule } from "../../backends/kimi-cli/manifest.js";

describe("kimi-cli toolFileRef", () => {
  it("resolves Claude-shaped names via the default", () => {
    expect(kimiCliModule.toolFileRef?.("Read", { file_path: "/w/a.png" })).toEqual({ path: "/w/a.png", kind: "read" });
  });
  it("resolves a generic `path` key to kind=edit", () => {
    expect(kimiCliModule.toolFileRef?.("view_file", { path: "/w/a.ts" })).toEqual({ path: "/w/a.ts", kind: "edit" });
  });
  it("resolves a generic `file_path` key on an unknown tool to kind=edit", () => {
    expect(kimiCliModule.toolFileRef?.("str_replace", { file_path: "/w/a.ts" })).toEqual({ path: "/w/a.ts", kind: "edit" });
  });
  it("returns undefined when there's no usable path", () => {
    expect(kimiCliModule.toolFileRef?.("run_shell", { command: "ls" })).toBeUndefined();
  });
});
```

> Confirm the BackendModule export name in `backends/kimi-cli/manifest.ts` (e.g. `kimiCliModule`) and adjust the import.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/__tests__/backend-module.test.ts`
Expected: FAIL — kimi's `toolFileRef` is `undefined`.

- [ ] **Step 3: Implement kimi's resolver**

In `backends/kimi-cli/manifest.ts`:

```ts
import { defaultToolFileRef, type ToolFileRef } from "../tool-file-ref.js";

function kimiToolFileRef(toolName: string, input: Record<string, unknown>): ToolFileRef | undefined {
  const claudeShaped = defaultToolFileRef(toolName, input);
  if (claudeShaped) return claudeShaped;
  // kimi exposes its own tool names; fall back to "does the input name a file?".
  const raw = input.path ?? input.file_path;
  if (typeof raw === "string" && raw.length > 0) return { path: raw, kind: "edit" };
  return undefined;
}
// ...inside the BackendModule object literal:
  toolFileRef: kimiToolFileRef,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test core/__tests__/backend-module.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backends/kimi-cli/manifest.ts core/__tests__/backend-module.test.ts
git commit -m "feat(backends): kimi-cli toolFileRef — Claude-shaped + generic path fallback"
```

---

## Task 4: `fileRef` on `tool_use` ContentBlock + `stampFileRefs` helper

**Files:**
- Modify: `server/session-types.ts` (the `ContentBlock` `tool_use` variant)
- Create: `server/file-ref.ts`
- Test: `server/__tests__/file-ref.test.ts`

- [ ] **Step 1: Add `fileRef?` to the `tool_use` variant**

In `server/session-types.ts`, change the `tool_use` line of the `ContentBlock` union from:

```ts
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
```

to:

```ts
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      /**
       * Normalized file reference, stamped by `stampFileRefs` from the
       * backend's `toolFileRef`. Present only for file-touching tool calls
       * the backend recognizes. The chat reads this to render inline
       * previews + system-open actions without knowing any tool naming.
       */
      fileRef?: { path: string; kind: "read" | "write" | "edit" };
    }
```

- [ ] **Step 2: Write the failing test**

```ts
// server/__tests__/file-ref.test.ts
import { describe, expect, it } from "bun:test";
import { stampFileRefs } from "../file-ref.js";
import type { ContentBlock } from "../session-types.js";

describe("stampFileRefs", () => {
  it("stamps fileRef on a recognized tool_use (claude-code)", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "reading" },
      { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/w/a.png" } },
    ];
    stampFileRefs(content, "claude-code");
    const tu = content[1] as Extract<ContentBlock, { type: "tool_use" }>;
    expect(tu.fileRef).toEqual({ path: "/w/a.png", kind: "read" });
  });
  it("leaves non-file tool_use blocks untouched", () => {
    const content: ContentBlock[] = [
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
    ];
    stampFileRefs(content, "claude-code");
    const tu = content[0] as Extract<ContentBlock, { type: "tool_use" }>;
    expect(tu.fileRef).toBeUndefined();
  });
  it("is a no-op for content with no tool_use blocks", () => {
    const content: ContentBlock[] = [{ type: "text", text: "hi" }];
    expect(() => stampFileRefs(content, "codex")).not.toThrow();
  });
  it("works for codex (Edit with file_path)", () => {
    const content: ContentBlock[] = [
      { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/w/main.ts" } },
    ];
    stampFileRefs(content, "codex");
    const tu = content[0] as Extract<ContentBlock, { type: "tool_use" }>;
    expect(tu.fileRef).toEqual({ path: "/w/main.ts", kind: "edit" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test server/__tests__/file-ref.test.ts`
Expected: FAIL — cannot find `../file-ref.js`.

- [ ] **Step 4: Implement `stampFileRefs`**

```ts
// server/file-ref.ts
import type { ContentBlock } from "./session-types.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import { getBackendModule } from "../backends/index.js";

/**
 * Mutates `content` in place: for each `tool_use` block, if the backend's
 * `toolFileRef` recognizes it as a file op, stamp `block.fileRef`. No-op
 * when the backend doesn't implement `toolFileRef`. Called on every
 * assistant-message broadcast in each backend's bridge so the chat UI can
 * render previews / system-open actions off a single normalized field.
 */
export function stampFileRefs(content: ContentBlock[], backendType: AgentBackendType): void {
  let resolve: ((name: string, input: Record<string, unknown>) => { path: string; kind: "read" | "write" | "edit" } | undefined) | undefined;
  try {
    resolve = getBackendModule(backendType).toolFileRef;
  } catch {
    return; // unknown backend type — nothing to stamp
  }
  if (!resolve) return;
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    const ref = resolve(block.name, block.input);
    if (ref) block.fileRef = ref;
  }
}
```

> Verify `getBackendModule` is exported from `backends/index.ts` and that `AgentBackendType` is the right type name in `core/types/agent-backend.ts` — `ws-bridge.ts` already imports both, so copy its import style.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test server/__tests__/file-ref.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add server/session-types.ts server/file-ref.ts server/__tests__/file-ref.test.ts
git commit -m "feat(server): ContentBlock.fileRef + stampFileRefs helper"
```

---

## Task 5: Call `stampFileRefs` in all three backend bridges

**Files:**
- Modify: `server/ws-bridge.ts` (`handleAssistantMessage`, around line 733-795)
- Modify: `server/ws-bridge-codex.ts` (the `onBrowserMessage` broadcast callback)
- Modify: `server/ws-bridge-kimi.ts` (`onAdapterMessage`, around line 251)

- [ ] **Step 1: Claude path — `ws-bridge.ts`**

Add the import near the other `./` imports:

```ts
import { stampFileRefs } from "./file-ref.js";
```

In `handleAssistantMessage`, immediately before the `browserMsg` is constructed (where it does `type: "assistant", message: msg.message`), stamp the content:

```ts
  private handleAssistantMessage(session: Session, msg: CLIAssistantMessage) {
    // Normalize file-tool references so the chat can render previews + open-actions
    // without knowing Claude's tool naming.
    if (Array.isArray(msg.message?.content)) {
      stampFileRefs(msg.message.content, this.backendType);
    }
    // ... existing code ...
```

> Check the actual field name for the backend type on the bridge instance (the file already references it — search for `this.backendType` or similar in `ws-bridge.ts`; use that). If `handleAssistantMessage` is only ever the Claude path, the literal `"claude-code"` is also acceptable.

- [ ] **Step 2: Codex path — `ws-bridge-codex.ts`**

Find the `onBrowserMessage` callback registered on the `CodexAdapter` (where browser messages from the adapter get broadcast to browsers). Add the import:

```ts
import { stampFileRefs } from "./file-ref.js";
```

In the callback, before broadcasting, if the message is an `assistant` message stamp its content:

```ts
adapter.onBrowserMessage((msg) => {
  if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
    stampFileRefs(msg.message.content, "codex");
  }
  // ... existing broadcast logic ...
});
```

> If `ws-bridge-codex.ts` doesn't itself register the callback (e.g. it wraps something in `ws-bridge.ts`), put the stamp wherever Codex `assistant` messages are finalized before `broadcastToBrowsers`. The adapter's `emitToolUse` (`backends/codex/codex-adapter.ts:1561`) is the alternative spot — but prefer the `server/` side to keep `backends/` free of the `server/` import.

- [ ] **Step 3: kimi path — `ws-bridge-kimi.ts`**

Add the import:

```ts
import { stampFileRefs } from "./file-ref.js";
```

In `onAdapterMessage`, after `assistantMsg` is built and before `this.session.messageHistory.push(assistantMsg)` / `broadcastToBrowsers`:

```ts
  private onAdapterMessage(pneuma: PneumaMessage): void {
    if (this.turnStartedAt === null) this.turnStartedAt = Date.now();
    const assistantMsg: BrowserIncomingMessage = {
      type: "assistant",
      message: { /* ...existing... */ content: pneuma.content as ContentBlock[], /* ... */ },
      parent_tool_use_id: null,
      timestamp: Date.now(),
    };
    if (Array.isArray(assistantMsg.message.content)) {
      stampFileRefs(assistantMsg.message.content, "kimi-cli");
    }
    this.session.messageHistory.push(assistantMsg);
    this.deps.broadcastToBrowsers(this.session, assistantMsg);
    // ... rest unchanged ...
```

> Confirm `"kimi-cli"` is the correct `AgentBackendType` literal for the kimi backend (check `backends/kimi-cli/manifest.ts` / `backends/index.ts`).

- [ ] **Step 4: Run the bridge + backend test suites**

Run: `bun test server/__tests__/ backends/`
Expected: PASS (no regressions; the lifecycle harness tests skip if CLI binaries are absent).

- [ ] **Step 5: Commit**

```bash
git add server/ws-bridge.ts server/ws-bridge-codex.ts server/ws-bridge-kimi.ts
git commit -m "feat(server): stamp fileRef on assistant messages in all three bridges"
```

---

## Task 6: `GET /api/file?path=<abs>` route

**Files:**
- Modify: `server/index.ts` (alongside the other `/api/system/*` routes — search for `app.post("/api/system/open"` around line 2365)
- Test: `server/__tests__/file-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/file-route.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
// We want the same route registration startServer uses. If startServer is too
// heavy to spin up here, factor the route into an exported `mountFileRoute(app, { workspace })`
// in server/index.ts and import that. Otherwise, register an app exactly as below.
import { mountFileRoute } from "../index.js";

let workspace: string;
let app: Hono;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "pneuma-fileroute-"));
  app = new Hono();
  mountFileRoute(app, { workspace });
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("GET /api/file", () => {
  it("serves a file inside the workspace with a content-type", async () => {
    await writeFile(join(workspace, "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await app.request(`/api/file?path=${encodeURIComponent(join(workspace, "a.png"))}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });
  it("403 for a path escaping the workspace", async () => {
    const res = await app.request(`/api/file?path=${encodeURIComponent(join(workspace, "..", "outside.txt"))}`);
    expect(res.status).toBe(403);
  });
  it("404 for a nonexistent file inside the workspace", async () => {
    const res = await app.request(`/api/file?path=${encodeURIComponent(join(workspace, "nope.png"))}`);
    expect(res.status).toBe(404);
  });
  it("400 when the path is a directory", async () => {
    await mkdir(join(workspace, "sub"), { recursive: true });
    const res = await app.request(`/api/file?path=${encodeURIComponent(join(workspace, "sub"))}`);
    expect(res.status).toBe(400);
  });
  it("400 when path query param is missing", async () => {
    const res = await app.request(`/api/file`);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/__tests__/file-route.test.ts`
Expected: FAIL — `mountFileRoute` not exported.

- [ ] **Step 3: Implement the route**

In `server/index.ts`, add an exported `mountFileRoute` and call it from `startServer` where the app + workspace are in scope. (If `startServer` already inlines `/api/system/*` registration, register `/api/file` there too AND export a thin `mountFileRoute(app, { workspace })` that does the same thing for the test.)

```ts
import { resolve, sep } from "node:path";  // (sep may already be imported)
import { statSync, existsSync } from "node:fs";  // (likely already imported)

export function mountFileRoute(app: Hono, opts: { workspace: string }): void {
  const workspaceRoot = resolve(opts.workspace);
  app.get("/api/file", (c) => {
    const rel = c.req.query("path");
    if (!rel) return c.json({ error: "missing path" }, 400);
    const abs = resolve(rel);
    if (abs !== workspaceRoot && !abs.startsWith(workspaceRoot + sep)) {
      return c.json({ error: "path escapes workspace" }, 403);
    }
    if (!existsSync(abs)) return c.json({ error: "not found" }, 404);
    try {
      if (!statSync(abs).isFile()) return c.json({ error: "not a file" }, 400);
    } catch {
      return c.json({ error: "stat failed" }, 500);
    }
    const file = Bun.file(abs);
    return new Response(file, {
      headers: {
        "content-type": file.type || "application/octet-stream",
        "cache-control": "private, max-age=60",
      },
    });
  });
}
```

Then in `startServer` (where `app` and the resolved `workspace` exist), add: `mountFileRoute(app, { workspace });`

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/__tests__/file-route.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts server/__tests__/file-route.test.ts
git commit -m "feat(server): GET /api/file — workspace-contained file server for chat previews"
```

---

## Task 7: Lift `useFocusTrap` into `src/hooks/`

**Files:**
- Create: `src/hooks/useFocusTrap.ts` (copy of `modes/clipcraft/viewer/hooks/useFocusTrap.ts`)

- [ ] **Step 1: Copy the file**

```bash
mkdir -p src/hooks
cp modes/clipcraft/viewer/hooks/useFocusTrap.ts src/hooks/useFocusTrap.ts
```

- [ ] **Step 2: Adjust the header comment**

Open `src/hooks/useFocusTrap.ts` and change the leading JSDoc's "Usage" example reference if it mentions the clipcraft path; the hook body is otherwise environment-agnostic and needs no changes. Keep the same exported `useFocusTrap<T>(active)` signature.

- [ ] **Step 3: Verify it type-checks**

Run: `bunx --bun tsc --noEmit 2>&1 | grep "src/hooks/useFocusTrap" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFocusTrap.ts
git commit -m "chore(src): add mode-agnostic useFocusTrap hook (copy from clipcraft)"
```

---

## Task 8: `ImageLightbox` component

**Files:**
- Create: `src/components/ImageLightbox.tsx`
- Test: `src/components/__tests__/ImageLightbox.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/__tests__/ImageLightbox.test.tsx
import { describe, expect, it, mock } from "bun:test";
import { render, fireEvent, screen } from "@testing-library/react";
import { ImageLightbox } from "../ImageLightbox.js";

describe("ImageLightbox", () => {
  it("renders the image with the given src/alt", () => {
    render(<ImageLightbox src="/api/file?path=%2Fw%2Fa.png" alt="a.png" onClose={() => {}} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("/api/file?path=%2Fw%2Fa.png");
    expect(img.getAttribute("alt")).toBe("a.png");
  });
  it("calls onClose on Escape", () => {
    const onClose = mock(() => {});
    render(<ImageLightbox src="x" alt="x" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("calls onClose when the backdrop is clicked", () => {
    const onClose = mock(() => {});
    render(<ImageLightbox src="x" alt="x" onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog").parentElement!); // the fixed backdrop
    expect(onClose).toHaveBeenCalled();
  });
  it("does not close when the image itself is clicked", () => {
    const onClose = mock(() => {});
    render(<ImageLightbox src="x" alt="x" onClose={onClose} />);
    fireEvent.click(screen.getByRole("img"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

> Confirm the test setup uses `@testing-library/react` + a DOM env (check an existing `src/components/__tests__/*.test.tsx` — e.g. `ProjectPanel.test.ts` or `SetupTab.test.tsx`; if a different testing approach is used, mirror it). If there's no React component test infra in `src/components/__tests__/`, fall back to testing pure logic only and add a note; do not introduce a new test framework.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/ImageLightbox.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ImageLightbox`**

```tsx
// src/components/ImageLightbox.tsx
import { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  return (
    <div
      ref={trapRef}
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[96vw] max-h-[92vh] outline-none"
      >
        <img src={src} alt={alt} className="max-w-full max-h-[92vh] object-contain rounded" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/ImageLightbox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ImageLightbox.tsx src/components/__tests__/ImageLightbox.test.tsx
git commit -m "feat(chat): ImageLightbox — full-screen image overlay"
```

---

## Task 9: `FilePreview` component + `isInlinePreviewable`

**Files:**
- Create: `src/components/FilePreview.tsx`
- Test: `src/components/__tests__/FilePreview.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/__tests__/FilePreview.test.tsx
import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { FilePreview, isInlinePreviewable } from "../FilePreview.js";

describe("isInlinePreviewable", () => {
  it("true for image extensions, case-insensitive", () => {
    for (const p of ["/w/a.png", "/w/a.JPG", "/w/a.jpeg", "/w/a.gif", "/w/a.WEBP", "/w/a.svg"]) {
      expect(isInlinePreviewable(p)).toBe(true);
    }
  });
  it("false for non-image files and extensionless paths", () => {
    for (const p of ["/w/a.ts", "/w/a.md", "/w/a.json", "/w/README", "/w/a.png.bak"]) {
      expect(isInlinePreviewable(p)).toBe(false);
    }
  });
});

describe("FilePreview", () => {
  it("renders an <img> pointing at /api/file for an image path", () => {
    render(<FilePreview path="/w/assets/a.png" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("/api/file?path=" + encodeURIComponent("/w/assets/a.png"));
  });
  it("renders nothing for a non-image path", () => {
    const { container } = render(<FilePreview path="/w/a.ts" />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/FilePreview.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FilePreview`**

```tsx
// src/components/FilePreview.tsx
import { useState } from "react";
import { ImageLightbox } from "./ImageLightbox.js";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

function extOf(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** True when FilePreview will render an inline preview for this path (v1: images). */
export function isInlinePreviewable(path: string): boolean {
  return IMAGE_EXTS.has(extOf(path));
}

function fileApiUrl(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function FilePreview({ path }: { path: string }) {
  const [zoomed, setZoomed] = useState(false);
  const [errored, setErrored] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  if (!isInlinePreviewable(path)) return null;

  const url = fileApiUrl(path);

  if (errored) {
    return (
      <div className="mt-2 text-[11px] text-cc-muted italic">
        Preview unavailable — the file may have changed or been removed.
      </div>
    );
  }

  return (
    <div className="mt-2">
      <img
        src={url}
        alt={basename(path)}
        loading="lazy"
        onError={() => setErrored(true)}
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalWidth && el.naturalHeight) setDims({ w: el.naturalWidth, h: el.naturalHeight });
        }}
        onClick={() => setZoomed(true)}
        className="max-h-[180px] rounded border border-cc-border/60 cursor-zoom-in object-contain"
      />
      {dims && (
        <div className="mt-1 text-[10px] text-cc-muted font-mono-code">
          {dims.w}×{dims.h}
        </div>
      )}
      {zoomed && <ImageLightbox src={url} alt={basename(path)} onClose={() => setZoomed(false)} />}
    </div>
  );
}
```

> Byte-size in the metadata line (the `412 KB` from the mockup) is intentionally omitted in v1 — `naturalWidth`/`naturalHeight` covers the useful part and avoids an extra HEAD request. A follow-up can add it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/FilePreview.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FilePreview.tsx src/components/__tests__/FilePreview.test.tsx
git commit -m "feat(chat): FilePreview — inline image thumbnail (v1) + isInlinePreviewable"
```

---

## Task 10: `ToolFileActions` component

**Files:**
- Create: `src/components/ToolFileActions.tsx`
- Test: `src/components/__tests__/ToolFileActions.test.tsx`

> Server routes already exist: `POST /api/system/open` (`{ path }`), `POST /api/system/reveal` (`{ path }`), `GET /api/system/editors` (returns `{ editors: { id, name }[] }` — confirm shape via `server/editor-bridge.ts` `detectEditors()`), `POST /api/system/open-in-editor` (`{ editorId, path }`). Use `getApiBase()` from `src/utils/api.js` for the base (other components do).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/__tests__/ToolFileActions.test.tsx
import { describe, expect, it, beforeEach, mock } from "bun:test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToolFileActions } from "../ToolFileActions.js";

describe("ToolFileActions", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear?.();
    // @ts-expect-error test stub
    globalThis.fetch = mock(async (url: string) => {
      if (String(url).includes("/api/system/editors")) {
        return new Response(JSON.stringify({ editors: [{ id: "vscode", name: "VS Code" }, { id: "zed", name: "Zed" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
  });

  it("renders Open / Editor / Reveal controls", () => {
    render(<ToolFileActions path="/w/a.png" />);
    expect(screen.getByRole("button", { name: /open/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /editor/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reveal|finder/i })).toBeTruthy();
  });

  it("clicking Open POSTs /api/system/open with the path", async () => {
    render(<ToolFileActions path="/w/a.png" />);
    fireEvent.click(screen.getByRole("button", { name: /^open$/i }));
    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
      const openCall = calls.find((c: unknown[]) => String(c[0]).endsWith("/api/system/open"));
      expect(openCall).toBeTruthy();
      expect(JSON.parse((openCall![1] as RequestInit).body as string)).toEqual({ path: "/w/a.png" });
    });
  });

  it("clicking Reveal POSTs /api/system/reveal with the path", async () => {
    render(<ToolFileActions path="/w/a.png" />);
    fireEvent.click(screen.getByRole("button", { name: /reveal|finder/i }));
    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
      expect(calls.some((c: unknown[]) => String(c[0]).endsWith("/api/system/reveal"))).toBe(true);
    });
  });

  it("Editor split-button persists the chosen editor to localStorage", async () => {
    render(<ToolFileActions path="/w/a.ts" />);
    // open the chevron menu
    fireEvent.click(screen.getByRole("button", { name: /more editors|editor options/i }));
    await screen.findByText("Zed");
    fireEvent.click(screen.getByText("Zed"));
    await waitFor(() => {
      expect(globalThis.localStorage.getItem("pneuma.lastEditor")).toBe("zed");
    });
  });
});
```

> If `src/components/__tests__/` has no React DOM test infra, reduce this to: a pure helper test for the `localStorage` key name + the request-body shape builder, and skip the render tests with a note. Don't add a new test framework.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/ToolFileActions.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ToolFileActions`**

```tsx
// src/components/ToolFileActions.tsx
import { useEffect, useRef, useState } from "react";
import { getApiBase } from "../utils/api.js";

const LAST_EDITOR_KEY = "pneuma.lastEditor";

type Editor = { id: string; name: string };

async function post(path: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return (data as { success?: boolean }).success !== false;
  } catch {
    return false;
  }
}

export function ToolFileActions({ path }: { path: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [editors, setEditors] = useState<Editor[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Lazy-load the editor list on first chevron click.
  useEffect(() => {
    if (!menuOpen || editors !== null) return;
    fetch(`${getApiBase()}/api/system/editors`)
      .then((r) => r.json())
      .then((d) => setEditors(Array.isArray((d as { editors?: Editor[] }).editors) ? (d as { editors: Editor[] }).editors : []))
      .catch(() => setEditors([]));
  }, [menuOpen, editors]);

  // Close the menu on outside-click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [menuOpen]);

  const run = async (label: string, fn: () => Promise<boolean>) => {
    setErr(null);
    const ok = await fn();
    if (!ok) setErr(`Couldn't ${label}.`);
  };

  const openInEditor = (editorId: string) => {
    localStorage.setItem(LAST_EDITOR_KEY, editorId);
    return run("open in editor", () => post("/api/system/open-in-editor", { editorId, path }));
  };

  const rememberedEditor = (() => {
    try { return localStorage.getItem(LAST_EDITOR_KEY); } catch { return null; }
  })();

  return (
    <div className="mt-2 flex items-center gap-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => void run("open", () => post("/api/system/open", { path }))}
        className="px-2 py-0.5 rounded border border-cc-border/60 text-cc-muted hover:text-cc-fg hover:border-cc-border cursor-pointer"
        title="Open with the default app"
      >
        ↗ Open
      </button>

      <div ref={menuRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => {
            // No menu picked yet → use remembered or fetch+use first; otherwise behave like a normal button.
            const target = rememberedEditor;
            if (target) void openInEditor(target);
            else setMenuOpen(true);
          }}
          className="px-2 py-0.5 rounded-l border border-r-0 border-cc-border/60 text-cc-muted hover:text-cc-fg hover:border-cc-border cursor-pointer"
          title="Open in code editor"
        >
          ✎ Editor
        </button>
        <button
          type="button"
          aria-label="More editors / editor options"
          onClick={() => setMenuOpen((v) => !v)}
          className="px-1 py-0.5 rounded-r border border-cc-border/60 text-cc-muted hover:text-cc-fg hover:border-cc-border cursor-pointer"
        >
          ▾
        </button>
        {menuOpen && (
          <div role="menu" className="absolute bottom-full left-0 mb-1 min-w-[160px] rounded-lg border border-cc-border bg-cc-surface py-1 z-10 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]">
            {editors === null && <div className="px-3 py-1.5 text-cc-muted">Loading…</div>}
            {editors?.length === 0 && <div className="px-3 py-1.5 text-cc-muted">No code editor detected</div>}
            {editors?.map((ed) => (
              <button
                key={ed.id}
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); void openInEditor(ed.id); }}
                className="w-full text-left px-3 py-1.5 text-cc-fg hover:bg-cc-hover cursor-pointer"
              >
                {ed.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => void run("reveal in Finder", () => post("/api/system/reveal", { path }))}
        className="px-2 py-0.5 rounded border border-cc-border/60 text-cc-muted hover:text-cc-fg hover:border-cc-border cursor-pointer"
        title="Reveal in Finder / Explorer"
      >
        📁 Reveal
      </button>

      {err && <span className="text-cc-error">{err}</span>}
    </div>
  );
}
```

> Verify the actual JSON shape returned by `POST /api/system/open` / `reveal` / `open-in-editor` in `server/index.ts` + `server/system-bridge.ts` + `server/editor-bridge.ts`. The code above treats any non-`{ success: false }` 2xx as success — adjust if those routes return `{ ok: ... }` or similar.
> No-emoji policy: the codebase prefers SVG icons / text over emoji in UI. The ↗ / ✎ / 📁 above are placeholders — replace with the small inline SVGs used elsewhere in `ToolBlock.tsx` (`ToolIcon`) / the existing icon set, or plain text labels ("Open" / "Editor" / "Reveal") if no fitting icon exists. Decide during implementation; the test queries by accessible name, not glyph.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/ToolFileActions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ToolFileActions.tsx src/components/__tests__/ToolFileActions.test.tsx
git commit -m "feat(chat): ToolFileActions — open / editor / reveal buttons for file tool blocks"
```

---

## Task 11: Wire `fileRef` into `ToolBlock.tsx` + `MessageBubble.tsx`

**Files:**
- Modify: `src/components/ToolBlock.tsx` (the `ToolBlock` component, ~line 78)
- Modify: `src/components/MessageBubble.tsx` (the two `<ToolBlock .../>` call sites, ~line 450 and ~line 833)

- [ ] **Step 1: Add the `fileRef` prop + render the new components in `ToolBlock`**

In `src/components/ToolBlock.tsx`:

1. Add the import:

```ts
import { FilePreview, isInlinePreviewable } from "./FilePreview.js";
import { ToolFileActions } from "./ToolFileActions.js";
```

2. Change the `ToolBlock` signature + body. Replace:

```tsx
export function ToolBlock({
  name,
  input,
}: {
  name: string;
  input: Record<string, unknown>;
  toolUseId: string;
}) {
  const [open, setOpen] = useState(false);
```

with:

```tsx
export function ToolBlock({
  name,
  input,
  fileRef,
}: {
  name: string;
  input: Record<string, unknown>;
  toolUseId: string;
  fileRef?: { path: string; kind: "read" | "write" | "edit" };
}) {
  // Image file reads default to expanded so the thumbnail is visible without a click.
  const startExpanded = !!fileRef && isInlinePreviewable(fileRef.path);
  const [open, setOpen] = useState(startExpanded);
```

3. In the expanded body, after `<ToolDetail .../>`, add the preview + actions when `fileRef` is set. Replace:

```tsx
      {open && (
        <div className="px-3 pb-3 pt-0 border-t border-cc-border">
          <div className="mt-2">
            <ToolDetail name={name} input={input} />
          </div>
        </div>
      )}
```

with:

```tsx
      {open && (
        <div className="px-3 pb-3 pt-0 border-t border-cc-border">
          <div className="mt-2">
            <ToolDetail name={name} input={input} />
          </div>
          {fileRef && isInlinePreviewable(fileRef.path) && <FilePreview path={fileRef.path} />}
          {fileRef && <ToolFileActions path={fileRef.path} />}
        </div>
      )}
```

- [ ] **Step 2: Pass `fileRef` from `MessageBubble.tsx`**

Find the two `<ToolBlock .../>` usages (around lines 450 and 833). For the one rendering from a grouped item (`<ToolBlock key={i} name={item.name} input={item.input} toolUseId={item.id} />`), add `fileRef={item.fileRef}`. For the one rendering from a content `block` (`<ToolBlock name={block.name} input={block.input} toolUseId={block.id} />`), add `fileRef={block.fileRef}`.

> `item` / `block` are `tool_use` `ContentBlock`s, which now carry `fileRef?` (Task 4). If the grouped-item type is a separate local interface that doesn't include `fileRef`, add `fileRef?: { path: string; kind: "read" | "write" | "edit" }` to it and thread it through wherever that group is built.

- [ ] **Step 3: Build the frontend to check it compiles**

Run: `bunx --bun tsc --noEmit 2>&1 | grep -E "ToolBlock|MessageBubble|FilePreview|ToolFileActions" || echo "clean"`
Expected: `clean` (modulo pre-existing unrelated errors elsewhere).

- [ ] **Step 4: Visual verification**

Per CLAUDE.md's "Visual verification for frontend changes": start the dev server (`bun run dev doc --workspace /tmp/preview-test --no-open`), put an image file in that workspace, ask the agent (or trigger) a `Read` of it, and use `chrome-devtools-mcp` to screenshot the chat panel — confirm the Read block is expanded with a thumbnail and the action row, and a non-image Read just shows the action row. If `chrome-devtools-mcp` is unavailable, say so explicitly rather than claiming success.

- [ ] **Step 5: Commit**

```bash
git add src/components/ToolBlock.tsx src/components/MessageBubble.tsx
git commit -m "feat(chat): render FilePreview + ToolFileActions on file tool blocks via fileRef"
```

---

## Task 12: Docs + version bump + final test run

**Files:**
- Modify: `CLAUDE.md`, `CHANGELOG.md`, `package.json`

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS (the one pre-existing `core/sources/__tests__/base.test.ts` console-error line is not a real failure; `0 fail`).

- [ ] **Step 2: Update `CLAUDE.md`**

- In the "Communication" / chat section, add a line: `tool_use` blocks may carry a normalized `fileRef` (`{ path, kind }`), stamped by `stampFileRefs` from each `BackendModule`'s `toolFileRef`; the chat renders inline image previews + system-open actions (open / editor / reveal) off it.
- In the Core Contracts table, note `BackendModule` gained `toolFileRef`.
- Bump the `**Version:**` line to `3.5.0`.

- [ ] **Step 3: Update `package.json`**

Bump `"version"` to `"3.5.0"`.

- [ ] **Step 4: Update `CHANGELOG.md`**

Add a `## [3.5.0] - 2026-05-11` section summarizing: inline image thumbnails on `Read` tool blocks (default-expanded), per-block open/editor/reveal actions on all file-touching tool calls, backend-agnostic via `BackendModule.toolFileRef` + `stampFileRefs` (the chat carries no tool-name knowledge), new `GET /api/file` route, new `src/hooks/useFocusTrap`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CHANGELOG.md package.json
git commit -m "docs: ReadFile scene preview + system-open actions — 3.5.0"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

(CI tags + publishes on push to main per `release.yml`. Do NOT create or push git tags manually.)

---

## Notes for the implementer

- **Backend tool naming is the backend's problem.** Never add `if (toolName === "Read")` or `if (backend === "codex")` to anything in `src/`. The chat reads `block.fileRef`; the only place tool names appear is inside each backend's `toolFileRef` (and `defaultToolFileRef`'s `KIND_BY_NAME`).
- **The `/api/file` route is the only new attack surface.** Keep the `resolve(path)` + `startsWith(workspaceRoot + sep)` guard exactly as written. Mirror it on `/api/projects/:id/file` if you touch that.
- **No-emoji policy** (CLAUDE.md / a `feedback_no_emoji` preference): the glyphs in `ToolFileActions` are placeholders — use the existing inline SVG icon set or plain text labels.
- **Test infra check first:** before Tasks 8–11, look at an existing `src/components/__tests__/*.test.tsx` to confirm `@testing-library/react` + a DOM env are wired. If not, downgrade those tests to pure-logic tests and note it; do not introduce a new test framework.
- **Don't manually create git tags** — CI does it on push to main.
- **Visual verification is required** for Task 11 per CLAUDE.md; if `chrome-devtools-mcp` isn't available, say so rather than claiming the UI works.

## Self-review notes

- Spec coverage: image preview (Tasks 9, 11) ✓; default-expand for images (Task 11) ✓; open/editor/reveal actions on all file tool blocks (Tasks 10, 11) ✓; `BackendModule.toolFileRef` contract (Task 2) ✓; `defaultToolFileRef` shared helper (Task 1) ✓; kimi support (Task 3) ✓; `stampFileRefs` + `fileRef` field (Tasks 4, 5) ✓; `GET /api/file` (Task 6) ✓; `ImageLightbox` with focus-trap (Tasks 7, 8) ✓; tests for all units (Tasks 1–11) ✓; CLAUDE.md + contract-table updates (Task 12) ✓. Codex `apply_patch`/shell-`exec` reads explicitly out of scope per spec — covered by "codex's `Edit` is handled" (Task 2 test) ✓.
- Type consistency: `ToolFileRef` / `{ path; kind: "read"|"write"|"edit" }` is the same shape everywhere (Tasks 1, 2, 3, 4, 11); `defaultToolFileRef`, `stampFileRefs`, `isInlinePreviewable`, `mountFileRoute`, `useFocusTrap`, `FilePreview`, `ToolFileActions`, `ImageLightbox` are referenced with consistent signatures across tasks.
- Placeholders: the remaining "verify the actual export name / route shape / test infra" notes are deliberate — they point the implementer at the source of truth rather than hardcoding a guess that might be wrong. The functional behavior is fully specified in every step.
