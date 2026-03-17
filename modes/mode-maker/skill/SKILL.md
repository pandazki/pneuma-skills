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

You are working in Pneuma Mode Maker — a development environment for creating new Pneuma modes. The workspace IS the mode package you are building. The user sees a live dashboard of the mode's structure, seed previews, and skill content.

## Mode Package Structure

A complete Pneuma mode package:

```
my-mode/
├── manifest.ts        ← ModeManifest export (required)
├── pneuma-mode.ts     ← ModeDefinition export (required)
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

1. **Start with manifest.ts** — define mode identity and configuration
2. **Create viewer/Preview.tsx** — implement the preview component
3. **Write pneuma-mode.ts** — bind manifest + viewer, implement extractContext
4. **Write skill/SKILL.md** — guide the Agent on how to work in this mode
5. **Add seed/ files** — template files for new workspaces

Keep `manifest.ts` as pure data — it's imported by both backend and frontend, so side effects or React imports would crash the server.

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

## Template Variables

Seed files and skill files support `{{key}}` template variables from init params. Use `{{modeName}}` and `{{displayName}}` for mode identity. Conditional blocks: `{{#key}}...{{/key}}` (rendered only if key is non-empty).

## Testing

```bash
# From pneuma-skills project root:
bun run dev /path/to/your-mode --workspace /tmp/test-workspace

# Or if registered as builtin:
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

| Mode | watchPatterns | Viewer Pattern | Workspace Type |
|------|--------------|----------------|----------------|
| **Doc** | `**/*.md` | react-markdown | `all`, multi-file, topBarNavigation |
| **Slide** | `slides/*.html`, `manifest.json`, `theme.css` | iframe + srcdoc | `manifest`, ordered |
| **Draw** | `**/*.excalidraw` | Excalidraw React component | `all`, multi-file, topBarNavigation |

## Theme CSS Hygiene

Modes with custom styling (e.g. `theme.css`) must scope their CSS to content classes — not bare elements like `h1`, `body`, `*`. The platform scopes theme CSS automatically during export, but using semantic class selectors (`.slide h1` instead of `h1`) and `:root` variables is critical for clean isolation. See `{SKILL_PATH}/references/viewer-guide.md` → "Theme CSS Best Practices" for the full guide.

## What NOT to Do

- Do not modify `.claude/` or `.pneuma/` — managed by the runtime, edits get overwritten
- Do not create circular imports between manifest.ts and pneuma-mode.ts
- Do not import React in manifest.ts — it must be safe for backend import (this crashes the server)
- Do not hardcode absolute paths — use relative paths within the mode package
- Do not put dynamic computation in manifest.ts — keep it as pure data
