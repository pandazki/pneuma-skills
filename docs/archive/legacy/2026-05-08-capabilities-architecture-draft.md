# Capabilities Architecture

> The viewer is a **bidirectional interface** — for humans it renders UI and interactions, for agents it exposes a structured API. **Capabilities** are the shared abstraction that unifies both sides.

## The Problem

Today, agents interact with content primarily through raw file I/O:

```
Agent writes article.json (entire file) → chokidar detects → viewer re-renders
```

This breaks down for:
- **Long content** — writing a 50-paragraph JSON in one shot is fragile, one syntax error kills the viewer
- **Incremental production** — agent can't "append a paragraph" without rewriting the whole file
- **Rich interaction** — agent can't ask the viewer to scroll, highlight, zoom, or perform domain-specific operations
- **Observability** — agent can't ask "what is the user looking at?" beyond the passive `<viewer-context>` snapshot

The existing `viewerApi.actions` mechanism solves part of this (Slide's `navigate-to`, Illustrate's `zoom-to-row`), but it's ad-hoc — each mode invents its own action vocabulary without a shared design framework.

## Core Insight

Every mode has **domain capabilities** — things the mode *can do* in its domain. These capabilities serve two audiences simultaneously:

| Audience | Interface | Example |
|----------|-----------|---------|
| **Human** | Buttons, menus, hover states, gestures | User clicks "Add Paragraph" |
| **Agent** | Structured API calls via HTTP | Agent calls `addSourceParagraph({ text: "..." })` |

The capability is the same — only the invocation surface differs. This is what makes Pneuma **AI-native**: capabilities are designed once, exposed twice.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Mode Definition                       │
│                                                          │
│  manifest.ts                                             │
│  ├── capabilities: [                                     │
│  │     { id, name, description, params, returns,         │
│  │       category, agentInvocable, humanTrigger }        │
│  │   ]                                                   │
│  │                                                       │
│  │   ┌──────────────┐         ┌──────────────────┐       │
│  │   │  For Humans   │         │   For Agents      │      │
│  │   │              │         │                  │       │
│  │   │  UI buttons  │         │  HTTP API        │       │
│  │   │  Menu items  │         │  curl commands   │       │
│  │   │  Hover/click │         │  Tool-use style  │       │
│  │   │  Keyboard    │         │  Auto-documented │       │
│  │   └──────┬───────┘         └────────┬─────────┘       │
│  │          │                          │                 │
│  │          ▼                          ▼                 │
│  │   ┌─────────────────────────────────────────┐         │
│  │   │         Capability Handler               │        │
│  │   │   (viewer implements the actual logic)   │        │
│  │   └─────────────────────────────────────────┘         │
│  │                      │                                │
│  │                      ▼                                │
│  │              State / Files / UI                       │
│  └───────────────────────────────────────────────────────│
└─────────────────────────────────────────────────────────┘
```

## Capability Categories

Capabilities fall into four natural categories:

### 1. Perception — "What does the user see?"

Agent reads the current state of the viewer. Passive context that helps the agent understand the human's perspective.

| Capability | Description | Example Modes |
|------------|-------------|---------------|
| `getViewport` | What's currently visible | Doc (heading + line range), Slide (current slide) |
| `getSelection` | What the user has selected | All modes (via `<viewer-context>`) |
| `getProgress` | Completion/status overview | Translate (paragraphs translated), Illustrate (images generated) |
| `getStructure` | Content outline/structure | Doc (heading tree), Slide (slide list), Webcraft (page tree) |

> **Today**: Partially covered by `extractContext()` and `<viewer-context>` injection. These are **passive** — sent with every user message. The gap is **on-demand** perception: agent asking "what does the user see right now?" without waiting for a user message.

### 2. Observation — "What did the user do?"

Agent learns about significant user actions. Event-driven context for understanding intent.

| Capability | Description | Example |
|------------|-------------|---------|
| `userScrolled` | User navigated to a section | "User scrolled to paragraph 15" |
| `userSelected` | User clicked/highlighted content | "User selected paragraph 3 (source)" |
| `userAction` | User triggered a UI action | "User clicked 'Critique' on page about.html" |

> **Today**: Covered by `<user-actions>` injection and `onNotifyAgent()`. This category is already well-implemented — just needs to be formalized under the capabilities umbrella.

### 3. Production — "Make something for the user"

Agent creates, modifies, or structures content. This is where the **incremental content** problem lives.

| Capability | Description | Example |
|------------|-------------|---------|
| `addContent` | Append content incrementally | Translate: `addSourceParagraph`, `addTranslation` |
| `updateContent` | Modify existing content | Translate: `replaceTranslation(index, text)` |
| `removeContent` | Delete content | All: `removeParagraph(index)` |
| `setMetadata` | Set document-level properties | Translate: `setArticleMeta(title, author, ...)` |
| `scaffold` | Initialize workspace structure | Slide: create deck structure from spec |
| `reorder` | Change content order | Slide: reorder slides |

> **Today**: Agent writes files directly. `scaffold` exists as a special action. Everything else is raw file I/O. This is the biggest gap — **production capabilities should be the primary way agents create content**, not file editing.

### 4. Interaction — "Communicate with the user"

Agent sends structured messages, notifications, or prompts through the viewer (not just chat).

| Capability | Description | Example |
|------------|-------------|---------|
| `navigate` | Direct viewer to show something | Slide: `navigate-to`, Illustrate: `zoom-to-row` |
| `highlight` | Visually emphasize content | Translate: highlight paragraph being discussed |
| `notify` | Show status/progress in viewer | "Translation 80% complete" |
| `prompt` | Ask user to make a choice in-viewer | "Which translation do you prefer: A or B?" |

> **Today**: `navigate-to` exists in Slide/Illustrate. `onNotifyAgent` goes agent→viewer but not viewer→user-in-viewer. In-viewer prompts don't exist yet.

## Capability Declaration

### In ModeManifest

```typescript
// core/types/mode-manifest.ts

export interface CapabilityDescriptor {
  /** Unique ID within the mode */
  id: string;

  /** Human-readable name */
  name: string;

  /** What this capability does — injected into skill for agent */
  description: string;

  /** Category for organization and documentation */
  category: "perception" | "observation" | "production" | "interaction";

  /** Can the agent call this via API? */
  agentInvocable: boolean;

  /** How humans trigger this (if applicable) */
  humanTrigger?: "button" | "menu" | "keyboard" | "hover" | "auto";

  /** Input parameters */
  params?: Record<string, {
    type: "string" | "number" | "boolean" | "object";
    description: string;
    required?: boolean;
  }>;

  /** Return value description */
  returns?: {
    type: "string" | "number" | "boolean" | "object" | "void";
    description: string;
  };
}

export interface ModeManifest {
  // ... existing fields ...

  /** Domain capabilities this mode exposes */
  capabilities?: CapabilityDescriptor[];
}
```

### Example: Translate Mode

```typescript
// modes/translate/manifest.ts

capabilities: [
  // ── Perception ──
  {
    id: "get-progress",
    name: "Get Translation Progress",
    description: "Returns how many paragraphs have been translated out of total.",
    category: "perception",
    agentInvocable: true,
    returns: { type: "object", description: "{ total: number, translated: number, percent: number }" },
  },

  // ── Production ──
  {
    id: "set-meta",
    name: "Set Article Metadata",
    description: "Set the article title, author, source URL, and language pair. Call this first before adding content.",
    category: "production",
    agentInvocable: true,
    params: {
      title:       { type: "string", description: "Article title in source language", required: true },
      author:      { type: "string", description: "Author name" },
      sourceUrl:   { type: "string", description: "Original article URL" },
      sourceLang:  { type: "string", description: "ISO 639-1 source language code", required: true },
      targetLang:  { type: "string", description: "ISO 639-1 target language code", required: true },
      titleTranslation: { type: "string", description: "Translated title" },
    },
  },
  {
    id: "add-paragraph",
    name: "Add Source Paragraph",
    description: "Append a source paragraph to the article. Paragraphs are added in order. The viewer updates live as each paragraph is added.",
    category: "production",
    agentInvocable: true,
    params: {
      text: { type: "string", description: "Source paragraph text", required: true },
    },
  },
  {
    id: "set-translation",
    name: "Set Paragraph Translation",
    description: "Set or replace the translation for a specific paragraph by index (0-based). The viewer highlights the paragraph as it's translated.",
    category: "production",
    agentInvocable: true,
    params: {
      index: { type: "number", description: "Paragraph index (0-based)", required: true },
      text:  { type: "string", description: "Translated text", required: true },
    },
  },
  {
    id: "batch-translations",
    name: "Set Multiple Translations",
    description: "Set translations for multiple paragraphs at once. More efficient than calling set-translation repeatedly. Each entry is { index, text }.",
    category: "production",
    agentInvocable: true,
    params: {
      entries: { type: "object", description: "Array of { index: number, text: string }", required: true },
    },
  },

  // ── Interaction ──
  {
    id: "highlight-paragraph",
    name: "Highlight Paragraph",
    description: "Temporarily highlight a paragraph row in the viewer to draw the user's attention.",
    category: "interaction",
    agentInvocable: true,
    params: {
      index: { type: "number", description: "Paragraph index (0-based)", required: true },
    },
  },
  {
    id: "scroll-to",
    name: "Scroll to Paragraph",
    description: "Scroll the viewer to bring a specific paragraph into view.",
    category: "interaction",
    agentInvocable: true,
    params: {
      index: { type: "number", description: "Paragraph index (0-based)", required: true },
    },
  },
],
```

### Example: Slide Mode (retrofitted)

```typescript
capabilities: [
  // ── Perception ──
  {
    id: "get-current-slide",
    name: "Get Current Slide",
    description: "Returns the file path and index of the currently displayed slide.",
    category: "perception",
    agentInvocable: true,
    returns: { type: "object", description: "{ file: string, index: number, title?: string }" },
  },
  {
    id: "get-deck-structure",
    name: "Get Deck Structure",
    description: "Returns the ordered list of slides with titles and file paths.",
    category: "perception",
    agentInvocable: true,
    returns: { type: "object", description: "Array of { file, index, title }" },
  },

  // ── Production ──
  {
    id: "scaffold",
    name: "Initialize Deck",
    description: "Create a new slide deck with manifest, theme, and initial slides.",
    category: "production",
    agentInvocable: true,
    humanTrigger: "button",
    params: { /* ... existing scaffold params ... */ },
  },

  // ── Interaction ──
  {
    id: "navigate-to",
    name: "Go to Slide",
    description: "Navigate the viewer to a specific slide by file path or index.",
    category: "interaction",
    agentInvocable: true,
    params: {
      file:  { type: "string", description: "Slide file path" },
      index: { type: "number", description: "Slide index (0-based)" },
    },
  },
],
```

### Example: Doc Mode (retrofitted)

```typescript
capabilities: [
  // ── Perception ──
  {
    id: "get-outline",
    name: "Get Document Outline",
    description: "Returns the heading structure of the current document as a tree.",
    category: "perception",
    agentInvocable: true,
    returns: { type: "object", description: "Array of { level, text, line }" },
  },

  // ── Interaction ──
  {
    id: "scroll-to-heading",
    name: "Scroll to Heading",
    description: "Scroll the viewer to a specific heading in the document.",
    category: "interaction",
    agentInvocable: true,
    params: {
      heading: { type: "string", description: "Heading text to scroll to", required: true },
    },
  },
],
```

### Example: WebCraft Mode (retrofitted)

```typescript
capabilities: [
  // ── Perception ──
  {
    id: "get-page-structure",
    name: "Get Page Structure",
    description: "Returns the DOM structure outline of the current page.",
    category: "perception",
    agentInvocable: true,
  },

  // ── Interaction ──
  {
    id: "audit",
    name: "Impeccable Audit",
    description: "Run a comprehensive design audit on the current page against Impeccable.style principles.",
    category: "interaction",
    agentInvocable: false,
    humanTrigger: "button",
  },
  {
    id: "critique",
    name: "Impeccable Critique",
    description: "Get focused critique on the selected element's design quality.",
    category: "interaction",
    agentInvocable: false,
    humanTrigger: "button",
  },
  // ... other Impeccable commands ...
],
```

## Capability Execution Flow

### Agent → Viewer (API call)

```
1. Agent calls:
   curl -X POST $PNEUMA_API/api/viewer/action \
     -d '{"actionId":"add-paragraph","params":{"text":"First paragraph."}}'

2. Server routes to browser via WebSocket:
   { type: "viewer_action_request", action_id: "add-paragraph", params: {...} }

3. Viewer's capability handler executes:
   - Updates internal state (adds paragraph to article data)
   - Writes updated file (article.json) — or manages in-memory state
   - Returns result: { success: true, data: { index: 0 } }

4. Server returns HTTP response to agent:
   { success: true, data: { index: 0 } }
```

### Human → Viewer (UI interaction)

```
1. User clicks "Add Paragraph" button in viewer toolbar
   (or hovers, or presses keyboard shortcut — per humanTrigger)

2. Viewer's capability handler executes:
   - Same handler as agent path
   - Updates state, writes file

3. Optionally notifies agent:
   onNotifyAgent({ type: "capability", message: "User added a paragraph" })
```

### The key principle: **same handler, two entry points.**

## Skill Auto-Documentation

The skill installer already generates a `## Viewer API` section in CLAUDE.md. Capabilities extend this naturally:

```markdown
## Viewer Capabilities

The viewer exposes domain-specific capabilities you can invoke via HTTP.
Base URL: `$PNEUMA_API` (environment variable, pre-set).

### Production

| Capability | Description |
|------------|-------------|
| `set-meta` | Set article metadata (title, author, languages) |
| `add-paragraph` | Append a source paragraph to the article |
| `set-translation` | Set or replace translation for a paragraph |
| `batch-translations` | Set multiple translations at once |

### Perception

| Capability | Description |
|------------|-------------|
| `get-progress` | Get translation progress (total, translated, percent) |

### Interaction

| Capability | Description |
|------------|-------------|
| `highlight-paragraph` | Highlight a paragraph to draw attention |
| `scroll-to` | Scroll viewer to a specific paragraph |

### Invoking Capabilities

```bash
# Set article metadata
curl -s -X POST $PNEUMA_API/api/viewer/action \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"set-meta","params":{"title":"...","sourceLang":"en","targetLang":"zh"}}'

# Add a source paragraph
curl -s -X POST $PNEUMA_API/api/viewer/action \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"add-paragraph","params":{"text":"First paragraph of the article."}}'

# Set translation for paragraph 0
curl -s -X POST $PNEUMA_API/api/viewer/action \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"set-translation","params":{"index":0,"text":"文章的第一段。"}}'

# Check progress
curl -s -X POST $PNEUMA_API/api/viewer/action \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"get-progress","params":{}}'
```
```

## Migration Path

This design is **additive** — it doesn't break existing modes. The migration is:

### Phase 1: Type + Injection (non-breaking)
1. Add `CapabilityDescriptor` type to `core/types/mode-manifest.ts`
2. Update `skill-installer.ts` to generate capability docs from `capabilities[]`
3. Existing `viewerApi.actions` continues to work — capabilities are a superset

### Phase 2: Translate Mode (first implementation)
1. Declare capabilities in `modes/translate/manifest.ts`
2. Implement handlers in `TranslatePreview.tsx` — respond to `actionRequest`
3. Agent uses capabilities instead of raw file writes for content production
4. Validate the incremental production pattern end-to-end

### Phase 3: Retrofit existing modes (gradual)
1. Slide: Wrap `navigate-to` and `scaffold` as capabilities
2. Doc: Add `get-outline` and `scroll-to-heading`
3. WebCraft: Categorize Impeccable commands as interaction capabilities
4. Each mode migrates at its own pace — no big bang

### Phase 4: Advanced patterns
1. **Capability composition** — modes can import standard capabilities (scroll, navigate)
2. **Capability discovery** — agent can query available capabilities at runtime
3. **Capability events** — viewer pushes capability state changes to agent
4. **Human-agent parity** — every UI button maps to a capability the agent can also call

## Relationship to Existing Concepts

| Existing Concept | Capabilities Relationship |
|-----------------|--------------------------|
| `viewerApi.actions` | Becomes a subset of capabilities (interaction category). Actions with `agentInvocable: true` are capabilities. |
| `extractContext()` | Passive perception — runs on every message. Capabilities add **on-demand** perception. |
| `<viewer-context>` | Auto-injected context. Capabilities don't replace this — they complement it with queryable state. |
| `<user-actions>` | Observation category. Already well-implemented, just formalized. |
| `onNotifyAgent()` | Viewer→agent push. Capabilities add agent→viewer push and pull. |
| `scaffold` | Special action → becomes a production capability with `humanTrigger: "button"`. |
| `locatorDescription` | Interaction pattern for chat→viewer navigation. Orthogonal to capabilities. |
| Raw file writes | **The thing capabilities replace** for structured content. Agent still writes files for free-form content (markdown, HTML, CSS). |

## Design Principles

1. **Declare once, expose twice.** Every capability has one handler that serves both human UI and agent API.

2. **Agent sees what user sees.** Perception capabilities give the agent the same observability humans have through the visual interface.

3. **Incremental over atomic.** Production capabilities should support fine-grained operations (add one paragraph) not just bulk operations (write entire file).

4. **Progressive enhancement.** A mode with zero capabilities still works (agent writes files directly). Capabilities are opt-in per mode.

5. **Self-documenting.** Capability declarations auto-generate the skill documentation. No manual sync between what the viewer can do and what the agent knows about.

6. **Domain-native.** Capabilities speak the mode's domain language (`addParagraph`, `setTranslation`) not generic file operations (`writeFile`, `patchJSON`).
