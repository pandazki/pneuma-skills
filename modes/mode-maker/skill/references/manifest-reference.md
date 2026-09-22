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
    installName: "pneuma-my-mode",           // installed under the selected backend's skills directory
    mdScene: "...",                          // 1–3 sentence scene paragraph for the pneuma:start block (see below)

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

  // ── Data channels (required) ───────────────────────────────────────
  // Every mode declares a `sources` field — startup fails without it.
  // Headless agent-only modes (evolve etc.) opt out explicitly with
  // `sources: {}`.
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

  // ── Viewer API — shown to the agent in the active instructions file (CLAUDE.md or AGENTS.md) (optional) ────────
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
  },
  // Note: how the agent authors <viewer-locator> tags is documented in the
  // mode's SKILL.md, not in the manifest. A locator is a `ViewerLocator`
  // (`core/types/viewer-contract.ts`) = `{ label, address: ViewerAddress }`;
  // its `address` field — a mode-defined `ViewerAddress` — names the target
  // object. The wire tag is `<viewer-locator label="..." address='{...}' />`.

  // ── Reverse proxy for viewer fetches (optional) ────────────────────
  proxy: {
    "api-name": {
      target: "https://api.example.com",
      headers: {
        Authorization: "Bearer {{API_KEY}}",   // {{ENV_VAR}} resolved from process.env
        "User-Agent": "Mozilla/5.0 ...",
      },
      methods: ["GET", "POST"],                 // default: ["GET"]
      description: "Example API — used for X",  // shown in the active instructions file (CLAUDE.md or AGENTS.md)
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
    // Used for conditional template blocks in the skill's .md files — e.g.
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

## mdScene

`mdScene` is the one to three sentence scene paragraph the installer puts
in the `pneuma:start` block of the workspace's instructions file
(`CLAUDE.md` or `AGENTS.md`), which the agent reads on every turn. The
installer already wraps it in a header naming the mode, runtime shell and
backend, and follows it with the path to the installed `SKILL.md`; the
scene paragraph adds the human-shaped context.

**Template:**

```ts
mdScene:
  "You and the user are {doing what, on what kind of object} inside " +
  "{DisplayName}. The user sees {what the viewer shows} as you edit; " +
  "{the one thing about the collaboration a newcomer must know}.",
```

Write it as a scene — what the user and the agent are doing together —
not as a system prompt or a rule list. Architecture, file conventions,
workflows and prohibitions belong in `SKILL.md`, which loads through the
agent's own skill discovery via `installName`. If `mdScene` is omitted
the installer builds a generic scene from `displayName` + `description`.

`claudeMdSection` is deprecated: it is read only when `mdScene` is
missing, and only its first paragraph is used as scene text.

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

The `type` in `manifest.viewerApi.workspace` shows up in the active instructions file (CLAUDE.md or AGENTS.md) to
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
