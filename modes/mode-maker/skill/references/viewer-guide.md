# ViewerContract Implementation Guide

Reference for implementing the viewer component (`viewer/Preview.tsx`) and
the `pneuma-mode.ts` binding in a Pneuma mode.

## ViewerPreviewProps

The viewer is a React component that receives `ViewerPreviewProps` — a
typed channel between the runtime and the mode. Files and other data do
not arrive as raw props; they flow through the **Source abstraction**.

```typescript
interface ViewerPreviewProps {
  /** Data channels instantiated from manifest.sources (or the synthesized
   *  `{ files: file-glob }` default if the manifest doesn't declare sources).
   *  Every Source<T> delivers typed, origin-tagged events and, for
   *  write-capable providers, exposes a write() method. */
  sources: Record<string, Source<unknown>>;

  /** Direct file I/O for viewers with dynamic write targets (e.g. a text
   *  editor where the active file is user-selected). Prefer a json-file
   *  source for static write targets declared in the manifest. */
  fileChannel: FileChannel;

  /** Currently selected element, or null. */
  selection: ViewerSelectionContext | null;
  onSelect: (sel: ViewerSelectionContext | null) => void;

  /** Preview mode. Pass-through — the runtime decides when to flip it. */
  mode: "view" | "edit" | "select" | "annotate";

  /** Immutable init params (falApiKey, slideWidth, etc.). */
  initParams?: Record<string, number | string>;

  /** Framework-managed active file and viewport. */
  activeFile?: string | null;
  onActiveFileChange?: (file: string | null) => void;
  onViewportChange?: (v: { file: string; startLine: number; endLine: number; heading?: string }) => void;

  /** Agent ↔ viewer action bus (optional). */
  actionRequest?: ViewerActionRequest | null;
  onActionResult?: (requestId: string, result: ViewerActionResult) => void;
  onNotifyAgent?: (n: ViewerNotification) => void;

  /** Chat-locator navigation. */
  navigateRequest?: ViewerLocator | null;
  onNavigateComplete?: () => void;

  /** Pre-computed by the runtime from workspace.resolveItems. */
  workspaceItems?: WorkspaceItem[];

  /** User-invocable commands declared in manifest.viewerApi.commands. */
  commands?: ViewerCommandDescriptor[];

  /** Cache invalidation ticks. */
  contentVersion?: number;
  imageVersion: number;

  /** True during replay — the viewer should suppress editing/selection/annotate. */
  readonly?: boolean;
}
```

See `core/types/viewer-contract.ts` for the full authoritative shape.

## Reading files — use `useSource`

Files never arrive as a raw array anymore. Subscribe to the `files` source
(the default source every mode gets unless it declares its own sources):

```tsx
import { useSource } from "../../../src/hooks/useSource.js";
import type { Source } from "../../../core/types/source.js";
import type { ViewerPreviewProps, ViewerFileContent } from "../../../core/types/viewer-contract.js";

export default function Preview({ sources }: ViewerPreviewProps) {
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value, status } = useSource(filesSource);
  const files = value ?? [];

  if (status === "loading") return <p>Loading…</p>;
  if (files.length === 0) return <p>No files yet.</p>;

  return <pre>{files[0].content}</pre>;
}
```

`useSource` re-renders on every source event (server-originated change,
write ack, etc.) and returns `{ value, status, error }`.

## Writing files

Three options, in order of preference:

**1. Declare a json-file source in the manifest.** The source gives you
a typed `write()` method, and the runtime tracks origin tags so your
viewer never has to implement echo detection:

```typescript
// manifest.ts
sources: {
  settings: {
    kind: "json-file",
    config: {
      path: "settings.json",
      parse: (raw) => JSON.parse(raw) as Settings,
      serialize: (v: Settings) => JSON.stringify(v, null, 2),
    },
  },
},
```

```tsx
// Preview.tsx
const settingsSource = sources.settings as Source<Settings>;
const { value: settings } = useSource(settingsSource);
const update = (next: Settings) => settingsSource.write?.(next);
```

**2. Use `fileChannel` for dynamic write targets** (a freeform editor
where the active file is user-chosen):

```tsx
fileChannel.write("notes/today.md", "# Today\n…");
```

**3. Aggregate-file source** for structured multi-file state (a Deck
built from many HTML files + a manifest.json): see Slide's
`modes/slide/domain.ts` for a worked example. Prefer this when the
"document" is a derived view over many files.

## Viewer Patterns

Pick the pattern closest to the content shape you're serving:

| Pattern | Good for | Reference mode |
|---------|----------|----------------|
| **react-markdown** | Prose, docs, notes | `modes/doc` |
| **HTML srcdoc iframe** | Slide-like layouts, web-design output | `modes/slide`, `modes/webcraft`, `modes/kami` |
| **Specialized React component** | JSON-driven / canvas / structured data | `modes/draw`, `modes/diagram`, `modes/gridboard` |
| **Full custom UI** | Multi-panel dashboards, editors | `modes/mode-maker`, `modes/illustrate` |

## pneuma-mode.ts — the runtime binding

`pneuma-mode.ts` exports a `ModeDefinition` that ties the manifest to the
viewer component, provides `extractContext`, and optionally extends the
workspace model with frontend behavior (TopBar tabs, createEmpty, etc.).

```typescript
import type { ModeDefinition } from "../../core/types/viewer-contract.js";
import manifest from "./manifest.js";
import Preview from "./viewer/Preview.js";

const pneumaMode: ModeDefinition = {
  manifest,
  PreviewComponent: Preview,

  // Runtime-facing workspace model (extends manifest.viewerApi.workspace).
  workspace: {
    type: "all",
    multiFile: true,
    ordered: false,
    hasActiveFile: false,
  },

  extractContext(selection, files) {
    if (!selection) return "";
    const file = selection.file ?? "?";
    return `<viewer-context file="${file}">\n${selection.content}\n</viewer-context>`;
  },

  updateStrategy: "incremental", // or "full-reload" — full-reload remounts
                                  // the viewer on every file change (simple
                                  // but heavy); incremental trusts the viewer
                                  // to re-render from sources.
};

export default pneumaMode;
```

### extractContext

`extractContext(selection, files)` translates the user's visual focus into
a short XML block that prefixes the next user message. This is how the
agent knows what "this", "here", or "that section" refers to. Keep it
short — tens of lines, not hundreds. The `files` arg is the current
workspace file list, injected by the runtime for your convenience.

### Workspace model — TopBar navigation

If your mode has multiple files the user can switch between, set
`topBarNavigation: true` and provide `resolveItems` + `createEmpty` so
the framework's top bar renders file tabs and a "+" button:

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
        label: f.path.split("/").pop()!.replace(/\.(md|markdown)$/i, ""),
        index: i,
      }));
  },
  createEmpty(files) {
    const taken = new Set(files.map((f) => f.path));
    let name = "untitled.md";
    for (let n = 1; taken.has(name); n++) name = `untitled-${n}.md`;
    return [{ path: name, content: `# ${name.replace(/\.md$/, "")}\n` }];
  },
},
```

## Theme CSS Best Practices

Modes with custom styling (e.g. `theme.css` for slides) should follow
these conventions. The platform auto-scopes theme CSS to the content
container during export, but how you write the CSS determines how
cleanly that scoping works.

### Use CSS custom properties for design tokens

Define colors, fonts, and spacing as `:root` variables. The platform
extracts `:root` blocks so content inside containers can reference them
via `var()` even after scoping:

```css
/* GOOD — variables in :root, applied via class selectors */
:root {
  --color-fg: #2D2A26;
  --color-bg: #FAF6F1;
  --font-sans: 'Inter', sans-serif;
}
.slide { font-family: var(--font-sans); color: var(--color-fg); }

/* BAD — global element selectors leak into export chrome */
body { font-family: 'Inter'; color: #2D2A26; }
h1 { font-size: 2rem; }
```

### Scope styles to content classes

Use your mode's semantic class names (`.slide`, `.slide-title`) instead
of bare element selectors (`h1`, `p`, `ul`). This prevents style leakage
even without platform scoping.

### Avoid global resets

Scope `box-sizing` and margin/padding resets to your content container,
not the whole page:

```css
/* GOOD */
.slide *, .slide *::before, .slide *::after { box-sizing: border-box; }

/* AVOID */
* { margin: 0; padding: 0; box-sizing: border-box; }
```

### How platform scoping works (reference)

During export the platform:
1. Extracts `@import` and `:root { ... }` blocks — kept global.
2. Wraps everything else inside a content container using CSS nesting
   (e.g. `.slide-page { … }`).
3. Export chrome uses its own `--color-cc-*` variables, fully isolated.

This means `body { color: red }` in theme CSS becomes
`.slide-page body { … }` — which never matches, because body is not
inside `.slide-page`. The container inherits through the cascade instead.

## System Bridge API

HTTP endpoints for OS-level operations the browser can't perform
directly. Viewer components call these via `fetch`:

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/api/system/open` | POST | `{ path: string }` | Open file/dir with the system default program |
| `/api/system/open-url` | POST | `{ url: string }` | Open URL in the default browser |
| `/api/system/reveal` | POST | `{ path: string }` | Reveal file in Finder/Explorer |

- `path` is relative to the workspace root.
- `url` must be `http://` or `https://` — other schemes are rejected.
- All return `{ success: boolean; message?: string }`.

```typescript
// "Reveal in Finder" button
const reveal = (rel: string) =>
  fetch("/api/system/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: rel }),
  });
```

When running inside the Electron desktop app the bridge also exposes
native-only capabilities (file dialogs, etc.) via `/api/native/*` — the
runtime proxies these through the focused browser window, so they
return `{ available: false }` in web-only environments.
