# Design — Scene-type preview + system-open actions for file tool calls

**Date:** 2026-05-11
**Status:** Approved (brainstorm), pending spec review

## Problem

When the agent runs a file-touching tool call — `Read` (Claude Code), `Edit`,
`Write`, etc. — the chat panel renders a flat row: an icon, the tool name, and
the path. For an image file that's a missed opportunity: the user has to leave
the chat (open Finder, open an editor) just to see what the agent looked at.
Two gaps:

1. **No inline preview.** A `Read` of an image should show a thumbnail right
   there.
2. **No system-open affordance.** Every file the agent touches should be one
   click away from "open with the default app", "open in my code editor", and
   "reveal in Finder/Explorer".

## Scope (v1)

- **Inline preview: images only** — `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`.
  A `Read` of an image renders a thumbnail (capped height) plus dimensions +
  byte size, and the tool block **defaults to expanded**. Other file types keep
  today's collapsed-by-default behavior. The preview component is structured so
  Markdown / JSON / video / audio / PDF can slot in later without touching the
  call site.
- **System-open actions: every file-touching tool block** — a small action row
  with three buttons:
  - **Open** — open the file with the OS default app (`/api/system/open`,
    already exists).
  - **Editor ▾** — open the file in a detected code editor
    (`/api/system/editors` to list, `/api/system/open-in-editor` to open; both
    already exist). Split button: clicking opens with the remembered editor (or
    the first detected); the chevron reveals the list. The choice is persisted
    in `localStorage`.
  - **Reveal** — show the file in Finder/Explorer (`/api/system/reveal`,
    already exists).
  These work in both web (the server spawns `open`/`xdg-open`/`start` —
  identical to the existing reveal flow; when Pneuma runs locally the server is
  the user's machine) and Electron.

### Out of scope (v1)

- Non-image inline previews (markdown render, JSON tree, video/audio players,
  PDF). The architecture leaves a clean seam; these are follow-ups.
- Server-side thumbnail scaling. The `<img>` pulls the original file; the
  browser decodes. Fine for the typical few-hundred-KB image; a future
  optimization can add a `?w=` resize param to the file route.
- Parsing shell `exec` commands (`cat foo.txt`, `sed -n …`) to detect that a
  Codex/kimi *read* happened. Codex represents reads as `Bash` calls, not a
  discrete tool; v1 does not try to reverse-engineer the file path out of a
  shell command. Codex's `Edit` calls (which carry `file_path`) are covered.

## Backend-agnostic design

Different backends represent file tool calls differently:

- **Claude Code** — `Read` / `Write` / `Edit` / `NotebookEdit`, file path in
  `input.file_path` (or `input.notebook_path`).
- **Codex** — its adapter normalizes `fileChange` → an `Edit` `tool_use` with
  `input.file_path`; file *reads* happen as `Bash` calls (no discrete read
  tool).
- **kimi-cli** — passes its native tool function names through verbatim; the
  exact names for kimi's file ops are confirmed during implementation.

The chat UI must not carry this knowledge. The design pushes it into the
per-backend `BackendModule`:

### Contract change: `BackendModule.toolFileRef?`

Add an optional pure method to `BackendModule` (`core/types/agent-backend.ts`):

```ts
/**
 * Given a tool_use block's name + input, return a normalized reference to
 * the file it operates on, or undefined if this tool isn't a file op.
 * Lets the chat UI render previews / open-actions without knowing any
 * backend's tool naming.
 */
toolFileRef?(toolName: string, input: Record<string, unknown>):
  | { path: string; kind: "read" | "write" | "edit" }
  | undefined;
```

- A shared `defaultToolFileRef(toolName, input)` helper (in `backends/` —
  e.g. `backends/tool-file-ref.ts`, sibling of `backends/index.ts`) implements
  the Claude-shaped convention: a `{ Read: "read", Write: "write", Edit:
  "edit", NotebookEdit: "edit" }` name→kind map, path from `input.file_path ??
  input.notebook_path` (must be a non-empty string, else `undefined`).
- `claude-code` and `codex` set `toolFileRef = defaultToolFileRef` — the helper
  is a superset; Codex only emits `Edit`, so the extra map entries are inert.
- `kimi-cli` sets its own (mapping kimi's native file-tool names; falls back to
  `defaultToolFileRef` for any Claude-shaped names it also emits, and returns
  `undefined` for tools it doesn't recognize — graceful degradation, never
  throws).
- Backends with no recognizable file op for a given call return `undefined` →
  the chat UI shows the plain row, exactly as today. No special-casing.

### Stamping `fileRef` onto the block

`tool_use` `ContentBlock` gains an optional field (`server/session-types.ts` +
mirror in `core/types/` if the canonical block type lives there; update
`core/__tests__/`):

```ts
// on the tool_use variant of ContentBlock
fileRef?: { path: string; kind: "read" | "write" | "edit" };
```

A single shared helper in `server/ws-bridge.ts`:

```ts
export function stampFileRefs(content: ContentBlock[], backendType: AgentBackendType): void {
  const mod = getBackendModule(backendType);
  if (!mod.toolFileRef) return;
  for (const block of content) {
    if (block.type === "tool_use") {
      const ref = mod.toolFileRef(block.name, block.input);
      if (ref) block.fileRef = ref;
    }
  }
}
```

Called once per assistant-message emission, from each backend's bridge path
before broadcast:

- Claude: in `handleAssistantMessage` (`ws-bridge.ts`).
- Codex: in `ws-bridge-codex.ts` / the Codex adapter's assistant-message emit.
- kimi: in `ws-bridge-kimi.ts` / the kimi adapter's assistant-message emit.

Three call sites, one uniform line each — no `if (backend === …)` branching.
All backend difference lives inside each `toolFileRef` implementation.

## Frontend

### New components (all in `src/components/`, mode-agnostic)

**`ToolFileActions.tsx`** — `{ path: string }`. Renders the three-button action
row (Open / Editor▾ / Reveal). Each button POSTs the corresponding
`/api/system/*` route with `{ path }` (Open / Reveal) or `{ editorId, path }`
(Editor). On a failed response: a small inline error line under the row (no
dialog, no toast system needed). The editor list is fetched lazily on first
chevron click (`/api/system/editors`); the chosen editor id is persisted in
`localStorage` under a single key (e.g. `pneuma.lastEditor`). If exactly one
editor is detected, the chevron is omitted and Editor is a plain button.

**`FilePreview.tsx`** — `{ path: string }`. Dispatches by extension:

- Image extensions → `<img src={fileApiUrl(path)} className="max-h-[180px] …"
  loading="lazy" onError={…}>`, with a metadata line: dimensions from the
  decoded image's `naturalWidth`/`naturalHeight` (read in the `onLoad`
  handler), byte size from the `content-length` of a `HEAD` request to the
  file route (`Bun.file` Response sets `content-length` automatically; if the
  HEAD fails, the size is simply omitted from the line). Clicking the thumbnail
  opens `<ImageLightbox src={fileApiUrl(path)} alt={basename(path)} />`.
  `onError` → a "preview unavailable (file may have changed)" placeholder; the
  `ToolFileActions` row stays.
- Anything else → `return null` (the seam where future types plug in).
- Companion pure function `isInlinePreviewable(path: string): boolean` —
  exported so the call site can decide default-expand without importing
  extension knowledge.

**`ImageLightbox.tsx`** — `{ src, alt, onClose }`. Fixed full-screen overlay,
Esc to close, click-backdrop to close, focus-trap, `role="dialog"` +
`aria-modal` + `aria-label`. The chat UI is mode-agnostic, so the focus-trap
logic is lifted into a shared `src/hooks/useFocusTrap.ts` (a copy of
`modes/clipcraft/viewer/hooks/useFocusTrap.ts`); ClipCraft's lightboxes are
left importing their local copy (no cross-layer dependency either direction).
Visual treatment matches the existing "Ethereal Tech" overlay style (deep
zinc, `backdrop-blur`).

### Call-site change: `src/components/ToolBlock.tsx`

`ToolBlock` already receives the `tool_use` block. It now reads `block.fileRef`:

- `block.fileRef` present → render `<ToolFileActions path={block.fileRef.path} />`
  at the bottom of the expanded detail area.
- `block.fileRef` present **and** `isInlinePreviewable(block.fileRef.path)` →
  also render `<FilePreview path={block.fileRef.path} />`, **and** force the
  block's default `expanded` state to `true`.
- No `fileRef` → unchanged (today's behavior).

`ToolBlock` references no tool names and no extensions — it asks `fileRef` and
`isInlinePreviewable`. (If `ToolBlock` already has a hardcoded `file_path`
extraction for the collapsed-row preview text, that stays; it's display-only
and not on the new path.)

## New backend route: `GET /api/file?path=<abs>`

`server/index.ts`, mirroring the existing `/api/projects/:id/file` pattern:

- `resolve(path)` → must be inside the session `workspace` root
  (`resolved === workspace || resolved.startsWith(workspace + sep)`), else
  `403`.
- File must exist (`404`) and be a regular file (`400`).
- `return new Response(Bun.file(abs), { headers: { "content-type": file.type ||
  "application/octet-stream", "cache-control": "private, max-age=60" } })`.

The frontend passes the absolute `fileRef.path` straight through; the server
does the containment check. The client never needs to know the workspace root.
(`fileApiUrl(path)` = `` `/api/file?path=${encodeURIComponent(path)}` ``.)

## Error handling / edge cases

- **File gone** (a later op moved/deleted it): `<img onError>` → placeholder;
  action buttons stay (the user may still want to look in Finder). A button's
  POST failing → inline error line.
- **Remote Pneuma** (server ≠ user's machine): `open` / editor / reveal run on
  the server — identical to the existing `/api/system/reveal` behavior; not
  special-cased.
- **Path traversal**: the only new attack surface is `/api/file`; strict
  `resolve` + `startsWith(workspace + sep)` guard, same as
  `/api/projects/:id/file`.
- **Huge image**: `<img>` pulls the original; the browser may be slow on a
  multi-MB file but it doesn't block. v1 accepts this; a `?w=` resize param is
  the documented follow-up.
- **No editors detected**: the Editor button is disabled with a tooltip
  ("No code editor detected").
- **Non-Electron `/api/system/*`**: already handled by the existing routes
  (they spawn shell commands); nothing new.

## Testing

- `defaultToolFileRef` — pure-function tests: `Read`/`Write`/`Edit`/
  `NotebookEdit` → correct kind + path; `notebook_path` fallback; unknown tool
  → `undefined`; missing/empty `file_path` → `undefined`.
- `stampFileRefs` — given a content array with mixed block types and a backend
  type, stamps `fileRef` only on recognized `tool_use` blocks; no-op when the
  backend has no `toolFileRef`.
- Each backend's `toolFileRef` wiring — `claude-code` and `codex` resolve a
  `file_path`-bearing `Edit`; `kimi-cli` resolves its file tool (names pinned
  during implementation).
- `GET /api/file` — bun:test: valid file → `200` + correct `content-type`;
  `../` traversal → `403`; nonexistent → `404`; directory → `400`. Mirrors the
  `/api/projects/:id/file` test in `projects-routes.test.ts`.
- `isInlinePreviewable` — pure-function tests over the image extension set
  (case-insensitive) and negatives.
- `FilePreview` — component tests: image path → renders `<img>` with the file
  API url; non-image → renders nothing; `onError` → placeholder.
- `ToolFileActions` — component tests: renders three buttons; Editor split
  button persists the choice to `localStorage`; clicking each button POSTs the
  expected route with `{ path }` / `{ editorId, path }`.
- `ImageLightbox` — component tests: Esc closes; backdrop click closes; focus
  is trapped; focus restored on close.

## Files touched

- `core/types/agent-backend.ts` — add `toolFileRef?` to `BackendModule`.
- `server/session-types.ts` (+ `core/types/` mirror + `core/__tests__/` if the
  canonical `ContentBlock` lives there) — add `fileRef?` to the `tool_use`
  variant.
- `backends/tool-file-ref.ts` — new: `defaultToolFileRef` + `KIND_BY_NAME`.
- `backends/claude-code/manifest.ts`, `backends/codex/manifest.ts` — set
  `toolFileRef = defaultToolFileRef`.
- `backends/kimi-cli/manifest.ts` — set `toolFileRef` (kimi-specific, falling
  back to `defaultToolFileRef`).
- `server/ws-bridge.ts` — new `stampFileRefs` helper + call it on Claude's
  assistant-message path.
- `server/ws-bridge-codex.ts` / `backends/codex/codex-adapter.ts` — call
  `stampFileRefs` on Codex's assistant-message emit.
- `server/ws-bridge-kimi.ts` / `backends/kimi-cli/kimi-adapter.ts` — call
  `stampFileRefs` on kimi's assistant-message emit.
- `server/index.ts` — new `GET /api/file` route.
- `src/components/ToolBlock.tsx` — read `block.fileRef`; render the new
  components; force-expand for previewable images.
- `src/components/ToolFileActions.tsx`, `src/components/FilePreview.tsx`,
  `src/components/ImageLightbox.tsx` — new.
- `src/hooks/useFocusTrap.ts` — new (copy of
  `modes/clipcraft/viewer/hooks/useFocusTrap.ts` for the mode-agnostic chat UI).
- Tests as listed above.

## CLAUDE.md updates

- "Communication" / chat section: note that `tool_use` blocks may carry a
  normalized `fileRef` (path + kind), populated by each `BackendModule`'s
  `toolFileRef`, and that the chat renders inline image previews + system-open
  actions off it.
- Contracts table: `BackendModule` gains `toolFileRef`.
