# Pneuma Mode Maker Skill

You are working in Pneuma Mode Maker — a development environment for creating new Pneuma modes. The workspace IS the mode package you are building. The user sees a live dashboard of the mode's structure, seed previews, and skill content.

## Mode Package Structure

A complete Pneuma mode package has the following structure:

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

## ModeManifest Reference

The manifest is a pure data declaration exported from `manifest.ts`. All fields:

```typescript
const manifest: ModeManifest = {
  // Identity (required)
  name: "my-mode",           // Unique lowercase identifier
  version: "1.0.0",          // Semver version
  displayName: "My Mode",    // Human-readable name
  description: "...",        // Short description
  icon: `<svg viewBox="0 0 24 24" ...>...</svg>`, // SVG icon string (optional, shown in launcher)

  // Skill injection (required)
  skill: {
    sourceDir: "skill",                    // Directory containing skill files
    installName: "pneuma-my-mode",         // Install name under .claude/skills/
    claudeMdSection: `...`,                // Injected into workspace CLAUDE.md (see below)
    envMapping: {                          // Generate .env from init params (optional)
      API_KEY: "apiKey",                   //   env var name → init param name
    },
    mcpServers: [{                         // MCP tool servers (optional)
      name: "server-name",                //   key in .mcp.json
      command: "npx",                     //   stdio: command to run
      args: ["-y", "package-name"],       //   stdio: args (supports {{param}} template)
      env: { KEY: "${KEY}" },             //   env vars (${VAR} = runtime resolve)
      // OR for HTTP servers:
      // url: "https://api.example.com/mcp",
      // headers: { Authorization: "Bearer {{token}}" },
    }],
    skillDependencies: [{                  // External skill dependencies (optional)
      name: "dep-skill",                  //   install to .claude/skills/<name>/
      sourceDir: "deps/dep-skill",        //   source relative to mode package root
      claudeMdSnippet: "**dep-skill** — Description", // CLAUDE.md entry (optional)
    }],
  },

  // Viewer configuration (required)
  viewer: {
    watchPatterns: ["**/*.md"],             // Glob patterns to watch for changes
    ignorePatterns: [                      // Patterns to ignore
      "node_modules/**", ".git/**", ".claude/**", ".pneuma/**"
    ],
    serveDir: ".",                         // HTTP serve directory (optional)
  },

  // Viewer API — self-description for CLAUDE.md injection (optional)
  viewerApi: {
    workspace: {
      type: "all",        // "all" | "manifest" | "single"
      multiFile: true,    // Multiple files or single file
      ordered: false,     // Files have order (e.g. slides)
      hasActiveFile: false, // Track active/selected file
      manifestFile: undefined, // For type="manifest": index file path
      supportsContentSets: false, // Multiple content sets as top-level dirs (optional)
    },
    actions: [],          // Agent-callable viewer actions (optional)
    scaffold: { ... },    // Workspace initialization capability (optional)
  },

  // Agent preferences (optional)
  agent: {
    permissionMode: "bypassPermissions",   // "bypassPermissions" recommended
    greeting: "...",                        // Auto-greeting on new session
  },

  // Workspace initialization (optional)
  init: {
    contentCheckPattern: "**/*.md",        // Glob to check if workspace has content
    seedFiles: {                           // Source → destination mapping
      "modes/my-mode/seed/README.md": "README.md",
    },
    params: [                              // Interactive init parameters
      { name: "key", label: "Label", type: "string", defaultValue: "value" },
    ],
  },
};
```

### claudeMdSection Best Practices

The `claudeMdSection` is injected into the workspace's `CLAUDE.md` and is auto-loaded by Claude Code on every conversation. It serves as the **hook** that directs the agent to read the full skill.

**Template pattern** (follow this for all modes):

```markdown
## Pneuma {DisplayName} Mode

You are a {role} running inside Pneuma {DisplayName} Mode.
The user sees your edits live in a browser preview panel.

### Skill Reference
**Before your first action in a new conversation**, consult the `{installName}` skill.
It contains {preview of key topics}.

### Core Rules
- {3-5 most critical rules inline}
- Do not ask for confirmation on simple edits — just do them
```

**Key principles:**
- Keep it **concise** (~10-20 lines) — it's loaded on every message, so avoid bloat
- The "Skill Reference" section is critical — it directs the agent to consult the skill via CC's native skill mechanism (not manual file reading)
- Reference the skill by its `installName` (e.g. `pneuma-slide`) so CC's skill discovery can resolve it
- Include a brief preview of what's in SKILL.md so the agent knows it's worth consulting
- Inline only the 3-5 most critical rules that the agent must follow even without reading the skill
- Heavy content (examples, patterns, reference tables) belongs in SKILL.md, not claudeMdSection

### Icon Format

The `icon` field accepts an inline SVG string. Use `viewBox="0 0 24 24"` and `stroke="currentColor"` so it adapts to the UI theme:

```typescript
icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="..."/></svg>`,
```

### Workspace Types

| Type | Description | Example |
|------|-------------|---------|
| `"all"` | All matching files shown equally | Doc mode: every `.md` file |
| `"manifest"` | Index file defines structure/order | Slide mode: `manifest.json` lists slides |
| `"single"` | One primary file | Draw mode: single `.excalidraw` file |

### Workspace Model (pneuma-mode.ts)

The `workspace` object in `pneuma-mode.ts` extends the manifest's `viewerApi.workspace` with runtime behavior. Three optional fields enable TopBar file navigation:

| Field | Type | Description |
|-------|------|-------------|
| `topBarNavigation` | `boolean` | Show file tabs in the TopBar |
| `resolveItems(files)` | `(files) => WorkspaceItem[]` | Filter and label files for the tab bar |
| `createEmpty(files)` | `(files) => { path, content }[]` | Generate a default empty file (for the "+" button) |

Example (from Doc mode):

```typescript
workspace: {
  type: "all",
  multiFile: true,
  ordered: false,
  hasActiveFile: true,
  topBarNavigation: true,
  resolveItems(files) {
    return files
      .filter((f) => /\.(md|markdown)$/i.test(f.path))
      .map((f, i) => ({
        path: f.path,
        label: f.path.replace(/^.*\//, "").replace(/\.(md|markdown)$/i, ""),
        index: i,
      }));
  },
  createEmpty(files) {
    const existing = new Set(files.map((f) => f.path));
    let name = "untitled.md";
    let n = 1;
    while (existing.has(name)) {
      name = `untitled-${n++}.md`;
    }
    return [{ path: name, content: `# ${name.replace(/\.md$/, "")}\n` }];
  },
},
```

When `topBarNavigation` is enabled, set `hasActiveFile: true` and implement both `resolveItems` and `createEmpty`.

## ViewerContract Implementation Guide

The viewer is a React component that receives `ViewerPreviewProps`:

```typescript
interface ViewerPreviewProps {
  files: ViewerFileContent[];       // All workspace files
  selection: ViewerSelectionContext | null;
  onSelect: (sel: ViewerSelectionContext | null) => void;
  mode: "view" | "edit" | "select" | "annotate";
  contentVersion?: number;          // Increments on file changes
  imageVersion: number;             // Increments on image changes
  initParams?: Record<string, number | string>;
  onActiveFileChange?: (file: string | null) => void;
  workspaceItems?: WorkspaceItem[];
  actionRequest?: ViewerActionRequest | null;
  onActionResult?: (requestId: string, result: ViewerActionResult) => void;
  onViewportChange?: (viewport: { ... }) => void;
  onNotifyAgent?: (notification: ViewerNotification) => void;
}
```

### Viewer Patterns

**Markdown viewer** (like Doc mode):
- Use `react-markdown` + `remark-gfm` + `rehype-raw`
- Render files as formatted markdown
- Good for text-based content modes

**HTML iframe viewer** (like Slide mode):
- Render HTML files in sandboxed `<iframe srcdoc="...">`
- Good for visual/layout-oriented modes
- Images served via `/content/` endpoint

**JSON/data viewer** (like Draw mode):
- Parse JSON data and render with a specialized component
- Good for structured data modes (diagrams, configs)

**Custom viewer**:
- Any React component that renders the workspace files
- Full freedom to build any UI

### System Bridge API

The Pneuma runtime provides HTTP endpoints for OS-level operations that browser code cannot perform directly. Viewer components can call these from the frontend:

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/api/system/open` | POST | `{ path: string }` | Open file/directory with system default program |
| `/api/system/open-url` | POST | `{ url: string }` | Open URL in default browser |
| `/api/system/reveal` | POST | `{ path: string }` | Reveal file in Finder/Explorer |

- **`path`** is relative to the workspace root (e.g. `"docs/readme.md"`, `"."` for workspace root)
- **`url`** must be `http://` or `https://` — other schemes are rejected
- All return `{ success: boolean, message?: string }`

Example usage in a viewer component:

```typescript
// "Open in Finder" button
const handleReveal = (relPath: string) => {
  fetch('/api/system/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPath }),
  });
};
```

### extractContext

The `extractContext` function in `pneuma-mode.ts` translates the visual state into text for the Agent:

```typescript
extractContext(selection, files): string {
  // Return an XML block that describes what the user sees
  return `<viewer-context mode="my-mode" file="${file}">
Selected: heading "Introduction"
Visible section: Getting Started
</viewer-context>`;
}
```

This enables the Agent to understand references like "this section", "here", etc.

## Development Workflow

1. **Start with manifest.ts** — define mode identity and configuration
2. **Create viewer/Preview.tsx** — implement the preview component
3. **Write pneuma-mode.ts** — bind manifest + viewer, implement extractContext
4. **Write skill/SKILL.md** — guide the Agent on how to work in this mode
5. **Add seed/ files** — template files for new workspaces

### MCP Servers and Skill Dependencies

Modes can declare external tool servers and skill dependencies:

- **`mcpServers`** — Declares MCP tool servers (e.g. Playwright, Brave Search). On install, Pneuma writes entries to workspace `.mcp.json`. Supports `{{param}}` template in args/env/headers, and `${VAR}` for runtime env resolution.
- **`skillDependencies`** — Declares external skills the mode depends on. On install, Pneuma copies them to `.claude/skills/<name>/` and injects a "Available Skills" section into CLAUDE.md. Source files live in the mode package (e.g. `deps/<name>/SKILL.md`).
- **`envMapping`** — Maps init params to `.env` file entries AND agent process env vars. The env vars are available at runtime for `${VAR}` references in `.mcp.json`.

**Sensitive value flow example**: user enters API key → saved in `.pneuma/config.json` → `.env` generated → agent process gets env var → `${VAR}` in `.mcp.json` resolves at runtime.

#### Adding a Skill Dependency

When the user wants to add an external skill dependency (e.g. "I need the apple-mail skill"):

**Step 1: Acquire the skill files via Claude Code marketplace**

```bash
# Add the marketplace registry (if not already added)
claude marketplace add rbouschery/marketplace

# Install the skill to the current project
claude plugin install -s project apple-mail@rbouschery-marketplace
```

This puts the skill files into `.claude/skills/<name>/` in the current workspace.

**Step 2: Copy into the mode package's `deps/` directory**

```bash
# Copy the installed skill into the mode package for bundling
cp -r .claude/skills/apple-mail deps/apple-mail
```

**Step 3: Add the `skillDependencies` entry to `manifest.ts`**

```typescript
skillDependencies: [{
  name: "apple-mail",
  sourceDir: "deps/apple-mail",
  claudeMdSnippet: "**apple-mail** — Send and manage emails via Apple Mail",
}],
```

**Result**: The skill is now bundled with the mode package. When users run this mode, Pneuma installer copies `deps/apple-mail/` → workspace `.claude/skills/apple-mail/` and injects the description into CLAUDE.md. No marketplace access needed at runtime.

### Template Variables

Seed files and skill files support `{{key}}` template variables from init params. Use `{{modeName}}` and `{{displayName}}` for mode identity. Conditional blocks use `{{#key}}...{{/key}}` (rendered only if key is non-empty).

## Testing

Test your mode locally:

```bash
# From pneuma-skills project root:
bun run dev /path/to/your-mode --workspace /tmp/test-workspace

# Or if registered as builtin:
bun run dev your-mode --workspace /tmp/test-workspace
```

## Distribution

Push your mode package to a GitHub repository, then load it remotely:

```bash
pneuma github:user/my-mode --workspace ~/my-project
```

The mode will be cloned to `~/.pneuma/modes/` and loaded automatically.

## Publishing to Pneuma Registry

Publish your mode to R2 so anyone can run it with a single command:

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
5. Bump `version` in `manifest.ts` before each publish (existing versions cannot be overwritten unless `--force` is used)

### Version Management

- Follow semver: `1.0.0` → `1.0.1` (patch), `1.1.0` (minor), `2.0.0` (major)
- Pre-release tags (e.g. `1.0.0-beta.1`) are not supported
- Use `--force` to overwrite an existing version (not recommended for shared modes)

### Shareable URL

After publishing, a one-liner command is printed:

```bash
bunx pneuma-skills https://pub-xxx.r2.dev/modes/my-mode/1.0.0.tar.gz --workspace ~/project
```

The mode is downloaded, extracted to `~/.pneuma/modes/`, and started automatically.

## Existing Mode Examples

### Doc Mode (Markdown)
- `watchPatterns: ["**/*.md"]`
- Viewer: `react-markdown` rendering
- Workspace: `type: "all"`, multi-file, `topBarNavigation: true`, `createEmpty` generates `untitled.md`
- Simple, text-focused

### Slide Mode (HTML Presentations)
- `watchPatterns: ["slides/*.html", "manifest.json", "theme.css", "assets/**/*"]`
- Viewer: iframe with HTML rendering per slide
- Workspace: `type: "manifest"`, ordered, `manifestFile: "manifest.json"`, `supportsContentSets: true`
- Init params: slideWidth, slideHeight, API keys

### Draw Mode (Excalidraw)
- `watchPatterns: ["**/*.excalidraw"]`
- Viewer: Excalidraw React component
- Workspace: `type: "all"`, multi-file, `topBarNavigation: true`, `createEmpty` generates `drawing.excalidraw`
- JSON-based content

## Third-Party Dependencies

Modes can use any npm package in their viewer component:

1. Install with `bun add <package>` in the workspace
2. Import normally in viewer code: `import * as echarts from 'echarts'`
3. Dependencies are automatically bundled when the mode is published

`package.json` in the workspace tracks all dependencies. They are inlined at publish time via `Bun.build()` — consumers don't need to install anything. React and React-DOM are provided by the host runtime and should not be bundled.

## What NOT to Do
- Do not modify `.claude/` or `.pneuma/` directories — these are managed by the runtime
- Do not create circular imports between manifest.ts and pneuma-mode.ts
- Do not import React in manifest.ts — it must be safe for backend import
- Do not hardcode absolute paths — use relative paths within the mode package
- Keep manifest.ts as pure data — no side effects, no dynamic computation
