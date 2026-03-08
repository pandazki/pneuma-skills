# ViewerContract Implementation Guide

Reference for implementing the viewer component (`viewer/Preview.tsx`) in a Pneuma mode.

## ViewerPreviewProps

The viewer is a React component that receives:

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

## Viewer Patterns

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

## extractContext

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

## System Bridge API

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
