---
name: pneuma-doc
description: >
  Pneuma Doc Mode workspace guidelines. Use for ANY task in this workspace:
  writing, editing, creating documents, reports, articles, READMEs, notes, outlines,
  research summaries, translations, restructuring, formatting, or any markdown content.
  This skill defines how the live-preview environment works and how to edit effectively.
  Consult before your first edit in a new conversation.
---

# Pneuma Doc Mode — Document Editing Skill

You are working in Pneuma Doc Mode — a WYSIWYG markdown editing environment where the user views your edits in real-time in a browser preview panel.

## Core Principles

1. **Act, don't ask**: For straightforward edits, just do them. Only ask for clarification on ambiguous requests
2. **Incremental edits**: Make focused changes — the user sees each edit live as you make it
3. **Preserve structure**: Don't reorganize content unless explicitly asked
4. **Quality markdown**: Use proper GFM conventions consistently

## Working with the viewer

The user watches a live markdown preview while you edit. Treat the viewer as a shared surface: read what they're looking at, drop them locator cards back to the result, and reach for the scaffold action only when they want a clean slate.

### Reading what the user sees

Each user message may be preceded by a `<viewer-context>` block describing the panel state, and a `<user-actions>` block describing what they just clicked. Use these to resolve deictic phrases like "this section", "here", "that heading".

Example context:

```
<viewer-context>
[Context: file "README.md"]
[User selected: heading (level 2) "Installation"]
</viewer-context>
```

When you see the above and the user says "tighten this section up", they mean the `## Installation` heading and the prose underneath it in `README.md`. Edit that file directly — don't ask which one.

If no `<viewer-context>` is attached, the user hasn't selected anything specific; default to the most recently edited file or ask only when the request is genuinely ambiguous.

### Locator cards

After creating or editing a document, post a `<viewer-locator>` card at the end of your reply so the user can jump straight to the result. The `data` payload uses one key: `file`, the path relative to the workspace root.

Examples:

```
<viewer-locator label="Open notes.md" data='{"file":"notes.md"}' />
```

```
<viewer-locator label="See the rewritten Installation section" data='{"file":"README.md"}' />
```

One card per file you touched is plenty. Use a label that names what the user will find when they click — "Open the new draft" beats "View file".

### Viewer actions

The viewer exposes one agent-invocable action: `scaffold`. Call it with a POST to `$PNEUMA_API/api/viewer/action`:

```bash
curl -X POST "$PNEUMA_API/api/viewer/action" \
  -H "Content-Type: application/json" \
  -d '{
    "actionId": "scaffold",
    "params": {
      "files": "[{\"name\":\"intro.md\",\"heading\":\"Introduction\"},{\"name\":\"methods.md\",\"heading\":\"Methods\"},{\"name\":\"results.md\",\"heading\":\"Results\"}]"
    }
  }'
```

The browser will surface a confirmation prompt before the scaffold runs.

### Scaffold

`scaffold` initializes the workspace with empty markdown files. It clears only the currently viewed files, then writes one file per entry in `files`.

- **`files`** (optional): a JSON-encoded array of `{ name, heading? }`. `name` is the filename (with or without `.md`); `heading` becomes the H1 inside the new file.

Use scaffold only when the user explicitly asks to start fresh — "wipe these and start over", "set up an outline with these chapters", "blank workspace with three files for X / Y / Z". For everyday additions, just `Write` a new `.md` file directly. Scaffold requires user confirmation in the browser, so don't fire it speculatively.

## File Convention

- The workspace contains markdown files (`.md`)
- Edit existing `.md` files or create new ones as requested
- Use standard GitHub-Flavored Markdown (GFM)
- One document per file — separate topics keep the workspace navigable and let the viewer show clean file tabs

## Editing Guidelines

- Use the `Edit` tool (preferred) for surgical changes to existing content
- Use the `Write` tool for creating new files or full rewrites
- Make focused, incremental edits — the user sees changes live, so each edit should leave the document in a valid state
- Preserve existing content structure unless asked to reorganize — the user chose that structure deliberately

## Constraints

- Do not create non-markdown files unless explicitly asked
- Do not modify `.claude/` directory contents — managed by the runtime, your edits would be overwritten on next session
- Do not run long-running background processes
- Do not ask for confirmation before simple edits — just do them. The user sees your edits live and can course-correct immediately
