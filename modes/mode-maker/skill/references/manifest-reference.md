# ModeManifest Reference

Full reference for `manifest.ts` — the pure-data declaration that defines
a Pneuma mode. The manifest is imported by **both** the backend (Hono
server, CLI) and the frontend (viewer runtime), so it must have no
runtime side effects and no React imports. Keep it a plain object export.

## All Fields

```typescript
import type { ModeManifest } from "../../core/types/mode-manifest.js";

const manifest: ModeManifest = {
  // ── Identity (required) ────────────────────────────────────────────
  name: "my-mode",           // lowercase, starts with a letter — also the URL slug
  version: "1.0.0",          // semver — bump before each publish
  displayName: "My Mode",    // shown in the launcher
  description: "...",        // one-liner shown under the title
  icon: `<svg viewBox="0 0 24 24" ...>...</svg>`, // inline SVG string (optional)

  // ── Skill injection (required) ─────────────────────────────────────
  skill: {
    sourceDir: "skill",                      // directory containing SKILL.md
    installName: "pneuma-my-mode",           // installed under .claude/skills/<name>/
    claudeMdSection: `...`,                  // injected into workspace CLAUDE.md (see below)

    envMapping: {                            // init params → .env entries
      API_KEY: "apiKey",                     //   env var → init param name
    },

    sharedScripts: ["generate_image.mjs"],   // copies scripts from modes/_shared/scripts/
                                             // into this mode's skill/scripts/ at install time.
                                             // Use when multiple modes share the same tool
                                             // but want their own SKILL.md guidance around it.

    mcpServers: [{                           // MCP tool servers (optional)
      name: "server-name",                   //   key in generated .mcp.json
      command: "npx",
      args: ["-y", "package-name"],          //   supports {{param}} template
      env: { KEY: "${KEY}" },                //   ${VAR} resolved at runtime
      // OR for HTTP servers:
      // url: "https://api.example.com/mcp",
      // headers: { Authorization: "Bearer {{token}}" },
    }],

    skillDependencies: [{                    // bundled external skills (optional)
      name: "dep-skill",
      sourceDir: "deps/dep-skill",
      claudeMdSnippet: "**dep-skill** — Description",
    }],
  },

  // ── Viewer config (required) ───────────────────────────────────────
  viewer: {
    watchPatterns: ["**/*.md"],              // chokidar globs — drives the default `files` source
    ignorePatterns: ["node_modules/**", ".git/**", ".claude/**", ".pneuma/**"],
    serveDir: ".",                           // subdir served by the built-in file server (optional)
  },

  // ── Data channels (REQUIRED since 2.29) ────────────────────────────
  // Every mode must declare a `sources` field — the runtime throws a
  // migration error at startup when it's missing. Headless agent-only
  // modes (evolve etc.) opt out explicitly with `sources: {}`.
  sources: {
    files: {
      kind: "file-glob",
      config: {
        patterns: ["**/*.md"],
        ignore: ["node_modules/**"],
      },
    },
    settings: {
      kind: "json-file",
      config: {
        path: "settings.json",
        parse: (raw: string) => JSON.parse(raw),
        serialize: (v: unknown) => JSON.stringify(v, null, 2),
      },
    },
    deck: {
      kind: "aggregate-file",                // structured multi-file view
      config: {
        patterns: ["slides/*.html", "manifest.json"],
        load: (files) => buildDeck(files),   // files → domain object
        save: (deck, current) => ({          // domain object → { writes, deletes }
          writes: serializeDeck(deck),
          deletes: [],
        }),
      },
    },
    draftState: {
      kind: "memory",                        // ephemeral in-memory channel
      config: { initial: { unsavedCount: 0 } },
    },
  },

  // ── Viewer API — shown to the agent in CLAUDE.md (optional) ────────
  viewerApi: {
    workspace: {
      type: "all",              // "all" | "manifest" | "single"
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
      manifestFile: undefined,  // required when type === "manifest"
      supportsContentSets: false,
    },
    actions: [],                // agent-callable viewer actions (optional)
    commands: [                 // user-invocable commands surfaced in the viewer toolbar
      { id: "polish", label: "Polish", description: "Final quality pass" },
    ],
    scaffold: {                 // initialize a blank workspace from a spec (optional)
      description: "Create HTML pages from a site spec",
      params: {
        title: { type: "string", description: "Site title", required: true },
      },
      clearPatterns: ["**/*.html"],
    },
    locatorDescription: `...`,  // description injected into CLAUDE.md telling the agent
                                // how to author <viewer-locator> tags for this mode
  },

  // ── Reverse proxy for viewer fetches (optional) ────────────────────
  proxy: {
    "api-name": {
      target: "https://api.example.com",
      headers: {
        Authorization: "Bearer {{API_KEY}}",   // {{ENV_VAR}} resolved from process.env
        "User-Agent": "Mozilla/5.0 ...",
      },
      methods: ["GET", "POST"],                 // default: ["GET"]
      description: "Example API — used for X",  // shown in CLAUDE.md
    },
  },

  // ── Agent preferences (optional) ───────────────────────────────────
  agent: {
    permissionMode: "bypassPermissions",
    greeting: "...",                         // first message sent to the agent on a new session
  },

  // ── Workspace init (optional) ──────────────────────────────────────
  init: {
    contentCheckPattern: "**/*.md",          // skip seeding if any match exists
    seedFiles: {
      "modes/my-mode/seed/README.md": "README.md",
    },
    params: [
      // three types: "string", "number", "select"
      { name: "apiKey",     label: "API Key",           type: "string", defaultValue: "",     sensitive: true },
      { name: "slideWidth", label: "Slide Width (px)",  type: "number", defaultValue: 1280 },
      {
        name: "paperSize",
        label: "Paper Size",
        type: "select",
        options: ["A3", "A4", "A5", "Letter", "Legal"],
        defaultValue: "A4",
      },
    ],

    // Optional hook: derive additional params from user-entered ones.
    // Used for conditional template blocks in claudeMdSection — e.g.
    // `{{#imageGenEnabled}}…{{/imageGenEnabled}}`.
    deriveParams: (params) => ({
      ...params,
      imageGenEnabled: (params.falApiKey || params.openrouterApiKey) ? "true" : "",
    }),
  },

  // ── Evolution (optional) ───────────────────────────────────────────
  // Directive consumed by `pneuma evolve <mode>` — the Evolution Agent
  // analyzes the user's session history and proposes personalized skill
  // augmentations the user can accept or discard.
  evolution: {
    directive: `
Learn the user's design preferences from their session history. Focus on:
aesthetic direction, color palette tendencies, typography choices, layout
patterns, animation preferences. Augment the skill with personalized
guidance that reflects the user's style while respecting explicit
instructions.`,
  },
};

export default manifest;
```

## claudeMdSection Best Practices

`claudeMdSection` is injected into the workspace's `CLAUDE.md` and
auto-loaded by the agent on every conversation turn. It's the **hook**
that directs the agent to the full skill.

**Template:**

```markdown
## Pneuma {DisplayName} Mode

You are running inside Pneuma {DisplayName} Mode. The user sees your
edits live in a browser preview panel.

### Skill Reference
**Before your first action in a new conversation**, consult the
`{installName}` skill — it contains {brief preview of key topics}.

### Core Rules
- {3-5 most critical rules inline}
- Do not ask for confirmation on simple edits — just do them
```

**Keep it concise (~10-20 lines).** It's loaded on every message; bloat
here costs tokens forever. Heavy content belongs in the referenced
SKILL.md, not here. The "Skill Reference" line is what triggers the
agent's native skill-discovery mechanism via `installName`.

Use `{{key}}` from init params + `{{#key}}…{{/key}}` conditional blocks
for sections that should appear only when a param is set:

```
{{#imageGenEnabled}}
### Image Generation
`scripts/generate_image.mjs` — generate images from text prompts.
{{/imageGenEnabled}}
```

## Icon Format

Inline SVG string. Use `viewBox="0 0 24 24"`, `stroke="currentColor"`,
and no width/height — so the icon adapts to the launcher's theme and
sizes itself against its container:

```typescript
icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="..."/></svg>`,
```

## Workspace Types

| `type` | Description | Example |
|--------|-------------|---------|
| `"all"` | Every matching file is a top-level item | Doc mode: every `.md` |
| `"manifest"` | A single index file defines structure/order | Slide mode: `manifest.json` lists slide files |
| `"single"` | One primary file owns the workspace | Draw mode: a single `.excalidraw` |

The `type` in `manifest.viewerApi.workspace` shows up in CLAUDE.md to
tell the agent the shape. The matching `workspace` in `pneuma-mode.ts`
(see `viewer-guide.md`) adds the runtime behaviors — TopBar tabs,
`resolveItems`, `createEmpty`.

## Source Descriptors

`sources` is a map whose keys are the `sources.<key>` your viewer reads
via `useSource(sources.<key>)`. Four built-in provider kinds:

| Kind | Purpose | Config |
|------|---------|--------|
| `file-glob` | Reactive list of workspace files | `{ patterns, ignore? }` |
| `json-file` | Single JSON file with typed read/write | `{ path, parse, serialize }` |
| `aggregate-file` | Derived view over many files (e.g. a Deck from HTML + manifest.json) | `{ patterns, ignore?, load, save }` |
| `memory` | Ephemeral in-memory channel (cross-component state) | `{ initial? }` |

See `core/types/source.ts` for the authoritative type and
`modes/slide/domain.ts` for a worked `aggregate-file` example.
