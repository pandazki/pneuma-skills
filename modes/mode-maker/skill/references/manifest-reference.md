# ModeManifest Reference

Full reference for `manifest.ts` — the pure data declaration that defines a Pneuma mode.

## All Fields

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

  // Reverse proxy for viewer API access (optional)
  // When declared, a "Proxy" section is auto-injected into CLAUDE.md
  // telling the agent to use /proxy/<name>/<path> instead of absolute URLs.
  proxy: {
    "api-name": {
      target: "https://api.example.com",       // Upstream base URL (required)
      headers: {                                // Injected on every request (optional)
        "Authorization": "Bearer {{API_KEY}}",  //   {{ENV_VAR}} resolved from process.env
        "User-Agent": "Mozilla/5.0 ...",        //   Useful for APIs that block non-browser UA
      },
      methods: ["GET", "POST"],                 // Allowed methods (default: ["GET"])
      description: "Description for CLAUDE.md", // Human-readable (optional)
    },
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

## claudeMdSection Best Practices

The `claudeMdSection` is injected into the workspace's `CLAUDE.md` and auto-loaded by Claude Code on every conversation turn. It's the **hook** that directs the agent to consult the full skill.

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
- The "Skill Reference" section is critical — it triggers CC's native skill discovery via the `installName`
- Include a brief preview of what's in SKILL.md so the agent knows it's worth consulting
- Inline only the 3-5 most critical rules that must be followed even without reading the skill
- Heavy content (examples, patterns, reference tables) belongs in SKILL.md, not here

## Icon Format

The `icon` field accepts an inline SVG string. Use `viewBox="0 0 24 24"` and `stroke="currentColor"` so it adapts to the UI theme:

```typescript
icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="..."/></svg>`,
```

## Workspace Types

| Type | Description | Example |
|------|-------------|---------|
| `"all"` | All matching files shown equally | Doc mode: every `.md` file |
| `"manifest"` | Index file defines structure/order | Slide mode: `manifest.json` lists slides |
| `"single"` | One primary file | Draw mode: single `.excalidraw` file |

## Workspace Model (pneuma-mode.ts)

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
