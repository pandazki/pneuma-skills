---
name: pneuma-mode-maker
description: >
  Pneuma Mode Maker workspace guidelines. Use for ANY task in this workspace:
  creating modes, editing manifest.ts, pneuma-mode.ts, viewer components, skill prompts,
  seed files, publishing, forking, or any mode package development.
  This skill defines the ModeManifest reference, ViewerContract patterns, and publishing workflow.
  Consult before your first edit in a new conversation.
---

# Pneuma Mode Maker Skill

The workspace IS the mode package you are building. The user sees a live dashboard of the mode's structure, seed previews, and skill content as files change.

## Core Rules

- Follow existing mode patterns (doc, slide, draw) for consistency — see "Existing Mode Examples" below.
- Do not ask for confirmation on simple edits — just do them.

## Working with the viewer

Mode-maker's viewer is a development IDE for the mode package — *not* a content canvas. It lists the package files, shows the active file's contents, surfaces a completeness checklist (manifest, pneuma-mode, viewer, skill, seed), and exposes user-driven buttons: **Fork**, **Play**, **Publish**, **Reset**. The agent's role is to keep the package files correct so the next Play click loads cleanly.

### Reading what the user sees

Each turn, you receive a `<viewer-context>` block describing the package state. For mode-maker it looks like:

```xml
<viewer-context mode="mode-maker" file="viewer/Preview.tsx">
Developing mode: "Quiz" (quiz)
Status: 3/5 components
  - manifest.ts: done
  - pneuma-mode.ts: done
  - viewer component: done
  - skill/SKILL.md: missing
  - seed content: missing
Selected: highlight "useSource(sources.files)"
</viewer-context>
```

What it tells you:

- `file="..."` — which file the user is currently focused on in the dashboard. If they ask "fix this" or "rename this", they almost always mean this file.
- `Status: N/5 components` — completeness checklist. Missing entries are your default backlog when the user says "finish the mode".
- `Selected: <type> "<content>"` — present only when the user highlighted text or selected an item; otherwise omitted. Treat `viewing` (no selection) as "they're just looking, don't assume scope".

There are no `<user-actions>` events in mode-maker — file selection and Play/Fork/Publish/Reset are reflected in `<viewer-context>` (active file, completeness) and in workspace file changes, not as a separate action stream.

### Locator cards

Mode-maker does not surface `<viewer-locator>` cards — there are no domain objects (slides, paper pages, board tiles) to anchor to. When you want to point the user at something, link the file directly in chat:

```
Take a look at [`viewer/Preview.tsx`](viewer/Preview.tsx) — the `useSource` call on line 12 is what's wrong.
```

### Viewer actions (agent → viewer)

The mode-maker manifest does not declare any `actions`, so the viewer is read-only from your side — there is no `POST $PNEUMA_API/api/viewer/action` endpoint to invoke for this mode. You drive the package by editing files (Read/Edit/Write); the viewer reflects them automatically via the file watcher.

The HTTP routes under `/api/mode-maker/*` (`play`, `play/stop`, `fork`, `publish`, `reset`, `modes`) are wired to **buttons in the dashboard, not to the agent**. Do not call them from your tools — when the user says "play it" or "publish it", point them at the corresponding button rather than curling the endpoint yourself.

### Play harness — the primary feedback loop

Play is the heartbeat of mode-maker. Clicking **Play** in the dashboard does this:

1. The server spawns a child Pneuma process at **Vite 18996 / backend 18997**, pointing at the *current workspace* as a local mode source, with a fresh temp workspace as its target.
2. The child loads your latest `manifest.ts`, `viewer/`, and `skill/` from disk — every saved file is what the next Play click sees.
3. An iframe shows the child running. The user clicks through it like a real session.

Your job around Play:

- **Before the user clicks Play**, make sure the package compiles: `manifest.ts` is pure data (no React, no side effects), `pneuma-mode.ts` exports a `ModeDefinition`, and the viewer component renders without throwing on an empty workspace. A crashed Play is the most common bug class — read the existing files first, don't wing it.
- **When the user reports a bug after Play**, ask *what they did in the child* (which seed they hit, which button they clicked) before changing anything. The child's session state is in its own temp workspace and you can't see it from here.
- **Only one Play instance runs at a time.** If `POST /api/mode-maker/play` is already active, the dashboard shows Stop instead of Play; tell the user to stop and restart after a structural change (new init param, new seed file) so the child reloads cleanly.

Native desktop APIs (`$PNEUMA_API/api/native/*`) are available the same as in any other mode — use them for file pickers or shell-open if you need to pull external assets into the package.

## Mode Package Structure

A complete Pneuma mode package:

```
my-mode/
├── manifest.ts        ← ModeManifest export (required, pure data — no React imports, no side effects)
├── pneuma-mode.ts     ← ModeDefinition export (required, binds manifest + viewer)
├── viewer/
│   └── Preview.tsx    ← React component implementing ViewerPreviewProps (required)
├── skill/
│   └── SKILL.md       ← Agent skill prompt (required)
└── seed/
    └── ...            ← Template files for new workspaces (recommended)
```

For the full ModeManifest TypeScript reference, claudeMdSection best practices, icon format, and workspace types, read `{SKILL_PATH}/references/manifest-reference.md`.

For the ViewerContract implementation guide (ViewerPreviewProps, viewer patterns, extractContext, System Bridge API), read `{SKILL_PATH}/references/viewer-guide.md`.

## Development Workflow

1. **Start with manifest.ts** — define mode identity, `viewer.watchPatterns`, and (if the mode has structured state beyond a flat file list) declare `sources`
2. **Create viewer/Preview.tsx** — implement the preview component. Files arrive via `sources`, not as a `files` prop — subscribe with `useSource(sources.files)`. See `viewer-guide.md` for examples
3. **Write pneuma-mode.ts** — bind manifest + viewer, implement `extractContext`, and provide a runtime workspace model (TopBar tabs, `createEmpty`, etc.)
4. **Write skill/SKILL.md** — guide the Agent on how to work in this mode
5. **Add seed/ files** — template files for new workspaces

Keep `manifest.ts` as pure data — it's imported by both backend and frontend, so side effects or React imports would crash the server.

### Read the mode's own skill first

**Before your first edit in any new conversation**, read the workspace's `skill/SKILL.md` (and anything under `skill/references/`). That file is the skill that will be installed when someone runs *this* mode — it's the authoritative description of the mode's domain (slide design principles, kami paper discipline, webcraft Impeccable.style rules, etc.). Mode-maker's own skill teaches you how to *build* modes; the target mode's skill teaches you what the mode is *for*.

This matters especially for forks. A workspace forked from slide still has slide's `skill/SKILL.md` and references — read them to learn slide's design vocabulary before editing. Otherwise you'll rebuild domain knowledge from scratch (fetching external docs, reading builtin sources) when the answer was sitting in `skill/` the whole time.

Rule of thumb: if the user asks you to change the *design aesthetic, content conventions, or domain workflow* of the mode, `skill/SKILL.md` is where that vocabulary lives. If they ask you to change *manifest config, viewer plumbing, or publish flow*, consult `{SKILL_PATH}/references/` in the mode-maker skill.

### The Source abstraction

Pneuma's viewer runtime does not hand your component a `files` array directly. Instead, every data channel declared in `manifest.sources` becomes a `Source<T>` under `props.sources`, which the viewer subscribes to via the `useSource` hook. The runtime synthesizes a default `files` source from `viewer.watchPatterns` so legacy modes keep working, but new modes should declare their sources explicitly — `file-glob` for a flat file list, `json-file` for typed settings, `aggregate-file` for a derived domain object, `memory` for ephemeral state. This makes writes type-safe and origin-tagged (no manual echo suppression) and keeps viewer code decoupled from storage layout. Full details in `viewer-guide.md`.

## MCP Servers and Skill Dependencies

Modes can declare external tool servers and skill dependencies in `manifest.ts`:

- **`mcpServers`** — MCP tool servers (e.g. Playwright, Brave Search). On install, Pneuma writes entries to workspace `.mcp.json`. Supports `{{param}}` template in args/env/headers, and `${VAR}` for runtime env resolution.
- **`skillDependencies`** — External skills bundled with the mode. On install, copied to `.claude/skills/<name>/` and injected into CLAUDE.md.
- **`envMapping`** — Maps init params to `.env` entries AND agent process env vars.

**Sensitive value flow**: user enters API key → saved in `.pneuma/config.json` → `.env` generated → agent process gets env var → `${VAR}` in `.mcp.json` resolves at runtime.

### Adding a Skill Dependency

When the user wants to bundle an external skill:

1. **Acquire** via Claude Code marketplace: `claude marketplace add rbouschery/marketplace` then `claude plugin install -s project apple-mail@rbouschery-marketplace`
2. **Copy** into mode package: `cp -r .claude/skills/apple-mail deps/apple-mail`
3. **Declare** in manifest.ts:
   ```typescript
   skillDependencies: [{
     name: "apple-mail",
     sourceDir: "deps/apple-mail",
     claudeMdSnippet: "**apple-mail** — Send and manage emails via Apple Mail",
   }],
   ```

The skill gets bundled with the mode — consumers don't need marketplace access.

## Proxy for External APIs

If the mode's viewer needs to fetch external APIs (weather data, stock prices, third-party services), declare a `proxy` field in `manifest.ts`. This enables a server-side reverse proxy that avoids CORS issues and can inject headers (auth tokens, User-Agent).

```typescript
proxy: {
  myapi: {
    target: "https://api.example.com",
    headers: { "User-Agent": "Mozilla/5.0 ..." },  // optional
    methods: ["GET"],                                // optional, default GET only
    description: "Example API",                      // shown in CLAUDE.md
  },
},
```

**What this does:**
- Pneuma auto-generates a "Proxy" section in CLAUDE.md, so the agent knows to use `/proxy/myapi/...` in viewer code
- Server forwards `/proxy/myapi/path` → `https://api.example.com/path` with configured headers
- Users can add more proxies at runtime by writing `proxy.json` in the workspace

**When to use:** Any time the viewer fetches data from an external domain. Even APIs that work without proxy today may break in other browsers or environments. The proxy also enables header injection (auth, UA) without exposing secrets in viewer code.

See `manifest-reference.md` for the full `proxy` field schema.

## Template Variables

Seed files and skill files support `{{key}}` template variables from init params. Use `{{modeName}}` and `{{displayName}}` for mode identity. Conditional blocks: `{{#key}}...{{/key}}` (rendered only if key is non-empty).

## Testing

Play (covered in **Working with the viewer**) is the primary loop. As a CLI fallback when the user wants to test outside the mode-maker window:

```bash
# From pneuma-skills project root — any local mode directory works as the first arg
bun run dev /path/to/your-mode --workspace /tmp/test-workspace

# Or if your mode is registered as a builtin under modes/:
bun run dev your-mode --workspace /tmp/test-workspace
```

## Distribution

Push to GitHub, then load remotely:

```bash
pneuma github:user/my-mode --workspace ~/my-project
```

The mode is cloned to `~/.pneuma/modes/` and loaded automatically.

## Publishing to Pneuma Registry

```bash
# Publish the current workspace as a mode
bunx pneuma-skills mode publish [--workspace .] [--force]

# List all published modes
bunx pneuma-skills mode list
```

### Pre-publish Checklist

1. `manifest.ts` has valid `name` (lowercase, starts with letter), `version` (semver), and `displayName`
2. `pneuma-mode.ts` exists and exports a `ModeDefinition`
3. `viewer/` directory contains the preview component
4. `skill/SKILL.md` contains the agent skill prompt
5. Bump `version` in `manifest.ts` before each publish (existing versions cannot be overwritten unless `--force`)

### Third-Party Dependencies

Modes can use any npm package in their viewer. Install with `bun add <package>`, import normally. Dependencies are inlined at publish time via `Bun.build()` — consumers don't need to install anything. React and React-DOM are provided by the host runtime and should not be bundled.

## Existing Mode Examples

Read the ones closest to what you're building — they're the best reference for the current contracts:

| Mode | `sources` | Viewer Pattern | Workspace Type | Good reference for |
|------|-----------|----------------|----------------|--------------------|
| **Doc** | default `files` | react-markdown | `all`, multi-file, topBarNavigation | Simple text-first modes |
| **Kami** | default `files` + paper size via init params | srcdoc iframe + paper canvas | `manifest`, multi-file | Fixed-size canvas layouts, editorial typography |
| **Slide** | custom `deck` aggregate-file | srcdoc iframe + slide navigator | `manifest`, ordered | Structured multi-file domain objects |
| **WebCraft** | `site` aggregate-file + `assets` file-glob + `files` file-glob | srcdoc iframe + responsive preview | `manifest`, multi-file, content sets | Web design with multiple switchable content sets |
| **Draw** | default `files` | Excalidraw React component | `single` | Canvas-driven single-file modes |
| **GridBoard** | default `files` | dnd-kit tile grid | `all`, multi-file | Compile-at-runtime tile systems |

## Theme CSS Hygiene

Modes with custom styling (e.g. `theme.css`) must scope their CSS to content classes — not bare elements like `h1`, `body`, `*`. The platform scopes theme CSS automatically during export, but using semantic class selectors (`.slide h1` instead of `h1`) and `:root` variables is critical for clean isolation. See `{SKILL_PATH}/references/viewer-guide.md` → "Theme CSS Best Practices" for the full guide.

## What NOT to Do

- Do not modify `.claude/` or `.pneuma/` — managed by the runtime, edits get overwritten
- Do not create circular imports between manifest.ts and pneuma-mode.ts
- Do not import React in manifest.ts — it must be safe for backend import (this crashes the server)
- Do not hardcode absolute paths — use relative paths within the mode package
- Do not put dynamic computation in manifest.ts — keep it as pure data
