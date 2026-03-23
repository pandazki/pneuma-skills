# Remotion Mode v2 — Design Spec

## Overview

A built-in Pneuma mode for programmatic video creation with Remotion. The viewer uses `@remotion/player` directly to render compositions with custom playback controls — no iframe, no embedded Studio.

**Why v2:** v1 embedded Remotion Studio in an iframe via reverse proxy. This was fragile (proxy complexity, cross-origin limits, HMR issues, limited state access). v2 renders compositions directly in the viewer React component via JIT compilation, giving full control over the UI and deep access to playback state.

## Architecture

```
Agent writes src/*.tsx files
       ↓
chokidar detects → WS → browser → files prop updates
       ↓
RemotionPreview.tsx:
  1. Parse Root.tsx → extract <Composition> metadata (id, fps, size, duration)
  2. Build module map from workspace src/ files
  3. Compile with @babel/standalone (strip imports, inject Remotion APIs)
  4. Create React components via module evaluation
  5. Render with <Player component={...} ref={playerRef} />
       ↓
Custom controls: timeline scrubber, play/pause, speed, composition selector
       ↓
Agent ←→ Viewer actions (get-playback-state, seek-to-frame, etc.)
```

### Key Design Decisions

1. **Direct React rendering, no iframe** — Remotion compositions ARE React components. Rendering them directly in the viewer component is natural and eliminates postMessage complexity. Error boundaries handle user code failures. This follows how Draw mode uses Excalidraw directly.

2. **JIT compilation with @babel/standalone** — The [Remotion docs recommend this pattern](https://www.remotion.dev/docs/ai/dynamic-compilation) for AI-generated video. User TSX is compiled in-browser, with Remotion APIs injected as the module scope. No server-side bundler needed for preview.

3. **Studio as optional advanced feature** — `npx remotion studio` available via "Open in Studio" button for complex editing (props panel, render queue, timeline editing). Not required for basic preview/playback.

## Compilation Pipeline

### Module Resolution

User projects follow a predictable structure:

```
src/
├── index.ts          → registerRoot(RemotionRoot)
├── Root.tsx          → <Composition id="..." component={...} />
├── MyComposition.tsx → useCurrentFrame(), interpolate(), etc.
└── helpers/          → shared utilities
```

The compilation pipeline:

1. **Parse Root.tsx** — Regex-extract `<Composition>` declarations to build a composition registry: `{ id, component, durationInFrames, fps, width, height }`.

2. **Build module map** — Scan all `.tsx/.ts` files in workspace `src/`. For each file, read content from `files` prop.

3. **Compile each module** — Use `@babel/standalone` with `react` + `typescript` presets. Transform `import` statements:
   - `from "remotion"` → injected from pre-imported `remotion` package
   - `from "@remotion/*"` → injected from pre-imported packages (supported subset)
   - `from "./<local>"` → resolved from module map
   - Unknown imports → compilation error with helpful message

4. **Evaluate modules** — Execute compiled code with dependency injection via `new Function()`. Build a module graph respecting import order. Cache compiled modules, invalidate on file change.

5. **Extract component** — Look up the selected composition's component from the evaluated module map. Pass to `<Player component={...} />`.

### Supported Remotion APIs

Pre-bundled and available for injection:

| Package | APIs |
|---------|------|
| `remotion` (core) | `useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring`, `Easing`, `AbsoluteFill`, `Sequence`, `Series`, `Img`, `Audio`, `Video`, `OffthreadVideo`, `staticFile`, `delayRender`, `continueRender`, `random`, `Loop`, `Still` |
| `@remotion/player` | Not needed in user code (viewer handles it) |

Additional `@remotion/*` packages (google-fonts, three, motion-blur, etc.) require Studio for preview. The skill instructs the agent to prefer core APIs when possible.

### Error Handling

- **Compilation errors** — Displayed in viewer with file + line info. Sent as viewer notification (warning) to agent.
- **Runtime errors** — Caught by React ErrorBoundary around Player. Shows error overlay with stack trace. Sent as notification to agent.
- **Recovery** — On next file change, viewer re-compiles and re-renders. No manual refresh needed.

## Viewer Design

### RemotionPreview.tsx

A single React component implementing `ViewerPreviewProps`. No sub-pages, no iframe.

#### Layout

```
┌──────────────────────────────────────────────┐
│ [Composition ▼]              [⚙ Open Studio] │  ← Header bar
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│              <Player />                      │  ← Video canvas (scaled to fit)
│           (compositionWidth × Height)        │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│  ▶  ━━━━━━●━━━━━━━━━━━━━━  00:02.15 / 00:05 │  ← Controls bar
│     [0.5x] [1x] [1.5x] [2x]     [⛶]        │
└──────────────────────────────────────────────┘
```

#### States

1. **Initializing** — First compile in progress. Shows skeleton with mode branding.
2. **Ready** — Player rendering. Controls active.
3. **Compiling** — File changed, recompiling. Player shows previous frame (no flash). Subtle indicator.
4. **Error** — Compilation or runtime error. Shows error panel with details. Controls disabled.
5. **No compositions** — Root.tsx has no `<Composition>` declarations. Shows empty state with guidance.

#### Controls

- **Play/Pause** — Toggle button. Keyboard: Space.
- **Timeline scrubber** — Draggable progress bar. Shows current frame / total frames. Click to seek.
- **Time display** — `MM:SS.FF / MM:SS.FF` (current / total). Click to toggle frame number display.
- **Speed** — Segmented control: 0.5×, 1×, 1.5×, 2×. Keyboard: `[` and `]`.
- **Composition selector** — Dropdown in header. Only shown when 2+ compositions exist.
- **Fullscreen** — Expand button. Uses Player's `requestFullscreen()`.
- **Open in Studio** — Header button. Starts Studio (agent-managed) or opens if running.

#### Styling

Follow Pneuma's "Ethereal Tech" design tokens (`cc-*` CSS variables). Dark zinc background, neon orange primary. Controls use glassmorphism surfaces consistent with the rest of the UI. Timeline accent matches primary color.

### Player Configuration

```tsx
<Player
  ref={playerRef}
  component={compiledComponent}
  compositionWidth={composition.width}
  compositionHeight={composition.height}
  durationInFrames={composition.durationInFrames}
  fps={composition.fps}
  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
  controls={false}  // We render our own controls
/>
```

Scale Player to fill the available canvas area while maintaining aspect ratio, similar to webcraft's viewport scaling with CSS `transform: scale()`.

### File Change Handling

`updateStrategy: "full-reload"` — On `files` prop change:
1. Debounce 300ms (avoid rapid recompiles during saves)
2. Re-parse Root.tsx for metadata changes
3. Re-compile changed modules only (module-level cache by content hash)
4. Re-evaluate module graph
5. Update Player component reference
6. Player re-renders from current frame (no seek to 0)

## Viewer Actions (Agent → Viewer)

Declared in manifest `viewerApi.actions`:

| Action ID | Category | Params | Returns | Description |
|-----------|----------|--------|---------|-------------|
| `get-playback-state` | custom | — | `{ compositionId, frame, fps, duration, width, height, playing, playbackRate, compositions[] }` | Query full playback state |
| `seek-to-frame` | navigate | `frame: number` | `{ success }` | Jump to specific frame |
| `set-playback-rate` | ui | `rate: number` | `{ success }` | Set speed (0.5–4) |
| `set-composition` | navigate | `compositionId: string` | `{ success }` | Switch active composition |
| `capture-frame` | custom | `frame?: number` | `{ success, data: { imageDataUrl } }` | Screenshot current or specified frame |

Implementation uses `playerRef.current` methods directly.

## Viewer Context (Viewer → Agent)

Generated by `extractContext()` in pneuma-mode.ts:

```xml
<viewer-context mode="remotion">
Compositions: MyComposition (5s, 30fps, 1920×1080), Intro (3s, 30fps, 1920×1080)
Playing: MyComposition at frame 64/150 (02:04/05:00)
Status: paused
</viewer-context>
```

On compilation error:
```xml
<viewer-context mode="remotion">
Compositions: parse error
Error: src/Composition.tsx:15 — Unexpected token (JSX not closed)
</viewer-context>
```

The context is lightweight — agent knows what the user sees. For detailed state, agent uses `get-playback-state` action.

## Viewer Notifications (Viewer → Agent)

| Type | Severity | When |
|------|----------|------|
| `compilation-error` | warning | User code fails to compile |
| `runtime-error` | warning | Composition throws during render |
| `composition-change` | info | User switches composition (logged, not forwarded) |

Only `warning` severity notifications reach the agent (gated by `cliIdle`). Notifications include actionable error details so the agent can fix the code.

## Manifest

Reuse v1 manifest structure with updated viewer actions and simplified agent instructions (no Studio startup):

```typescript
const manifest: ModeManifest = {
  name: "remotion",
  version: "0.1.0",
  displayName: "Remotion",
  description: "Programmatic video creation with React",
  icon: "...", // Video-themed SVG

  skill: {
    sourceDir: "skill",
    installName: "pneuma-remotion",
    claudeMdSection: `
You are working in a Remotion video project with a live preview viewer.
The viewer compiles and renders your compositions in real-time — no need to start any dev server.

Rules:
- All animation must use Remotion's frame-based APIs (useCurrentFrame, interpolate, spring)
- CSS transitions/animations are FORBIDDEN — they don't render to video
- Always import from "remotion" — the viewer provides these APIs at runtime
- Use staticFile() for assets in public/
- For complex packages (@remotion/three, @remotion/google-fonts, etc.), tell the user to "Open in Studio" for full preview
- Follow Impeccable.style design principles for visual quality
    `.trim(),
  },

  viewer: {
    watchPatterns: ["**/*.tsx", "**/*.ts", "**/*.css", "**/*.json", "**/*.svg", "**/*.png", "**/*.jpg", "**/*.webp", "**/*.mp4", "**/*.mp3", "**/*.wav"],
    ignorePatterns: ["node_modules/**", ".git/**", ".claude/**", ".pneuma/**", "dist/**", "build/**", "out/**"],
    serveDir: ".",
  },

  viewerApi: {
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
    },
    actions: [/* see Viewer Actions table */],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: "...",
  },

  init: {
    contentCheckPattern: "src/Root.tsx",
    seedFiles: { "modes/remotion/seed/default/": "./" },
  },

  supportedBackends: ["claude-code"],
  layout: "app",

  evolution: {
    directive: "Extract the user's video style preferences: motion design (easing, timing, transitions), typography (fonts, scales), color palettes, composition patterns, pacing.",
  },
};
```

## Skill

Reuse v1 skill files with updates:

- **SKILL.md** — Remove Studio startup checklist. Add note that viewer handles compilation. Keep Impeccable.style design philosophy and Remotion API rules. Update workflow to reflect direct preview (no `.pneuma/dev-server.json`).
- **rules/*.md** — 37 official Remotion rule files + 3 assets. No changes needed (pure API knowledge).

Key SKILL.md changes from v1:
- Remove: "Start Remotion Studio", "Write URL to .pneuma/dev-server.json", PID tracking
- Add: "The viewer automatically compiles and previews your compositions", "For complex packages not supported by the preview, use 'Open in Studio'"
- Keep: Impeccable.style guidelines, animation patterns, anti-slop checklist, typography/color/motion rules

## Registration

1. **`core/mode-loader.ts`** — Add `remotion` to `builtinModes`:
   ```typescript
   remotion: {
     type: "builtin",
     manifestLoader: () => import("../modes/remotion/manifest.js").then(m => m.default),
     definitionLoader: () => import("../modes/remotion/pneuma-mode.js").then(m => m.default),
   },
   ```

2. **`server/index.ts`** — Add `"remotion"` to `builtinNames` array.

## Dependencies

Added to Pneuma's `package.json`:

| Package | Purpose | Size (approx) |
|---------|---------|---------------|
| `remotion` | Core APIs for injection | ~200KB |
| `@remotion/player` | Player component | ~50KB |
| `@babel/standalone` | In-browser TSX compilation | ~2.5MB |

All dynamically imported when Remotion mode loads (no impact on other modes). Similar to how Draw mode loads `@excalidraw/excalidraw` (~3MB).

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| JIT compilation can't handle complex npm imports | "Open in Studio" fallback. Skill guides agent to prefer core APIs. |
| @babel/standalone is 2.5MB | Dynamic import, only loads for Remotion mode. Tree-shake if possible. |
| User code errors crash viewer | React ErrorBoundary + try/catch on compilation. Graceful error display. |
| Multi-file import resolution is fragile | Well-defined resolution algorithm. Clear error messages. Workspace-local imports only. |
| Re-compilation performance on large projects | Module-level caching by content hash. Debounced recompile (300ms). Only recompile changed files. |
| Remotion version mismatch (Pneuma's vs workspace's) | Pin compatible version. Document in skill. |

## Out of Scope (v0.1)

- Render/export integration (use `npx remotion render` via agent)
- Content sets (single project per workspace)
- `@remotion/*` sub-packages in JIT preview (google-fonts, three, etc.)
- Props panel / input props editing UI
- Codex backend support
- Studio embedding (available as external "Open in Studio" only)
- Audio waveform visualization in timeline
- Thumbnail strip in timeline scrubber
