---
name: obsidian-knowledge
description: >
  {{customDescription}}
---

# Obsidian Knowledge Base

Every session starts from zero context. But the user has been thinking about these topics for weeks, months, sometimes years — and that thinking lives in their Obsidian vault. Notes, bookmarks, project docs, design decisions, research findings. When you search the vault before starting work, you're not just gathering information — you're respecting the context the user has already built, and producing output that fits into their existing mental model rather than a generic one.

The difference between good and great output is often grounding: the same presentation about "AI agent sandboxes" is dramatically better when it references the specific project the user bookmarked last month, uses their terminology, and connects to their existing knowledge graph.

## When to Search

Search when the answer might already exist in the user's own words:

- **Starting a new creative task** — the user says "make a deck about X" or "write a doc about Y". Before planning, search for X or Y. Even a single related note changes your approach.
- **A specific name appears** — project names, tool names, people, concepts. If the user mentions "sandbox" or "better-auth" or any proper noun, search it. They bookmarked it for a reason.
- **"Look up" / "check" / "find" / "reference"** — the user is explicitly asking you to search. Their vault first, web second.
- **You're about to use general knowledge** — pause and consider: does the user have their own take on this? A quick search costs nothing; missing their existing notes costs relevance.

When a search returns nothing, that's fine — proceed with your own knowledge. The point is to check, not to force-find.

## API

All endpoints use the Pneuma server's base URL.

**Search** — find notes by keyword:
```
POST /api/plugins/obsidian-memory/search
Body: { "query": "search terms", "limit": 5 }
→ { results: [{ entry: { path, title }, score, snippet }] }
```

**Read** — get full content of a note:
```
GET /api/plugins/obsidian-memory/read/{path}
→ { entry: { path, title, content } }
```

**Write** — create or update a note (only when user asks):
```
POST /api/plugins/obsidian-memory/write
Body: { "path": "folder/file.md", "content": "...", "tags": ["..."] }
```

**Status** — check availability (call once per session):
```
GET /api/plugins/obsidian-memory/status
→ { available: true/false }
```

## Patterns

**Search → Read:** Search returns paths and snippets. If a snippet looks relevant, read the full note. One search + one read is the typical flow.

**Cite casually:** "I found a note in your vault about X" — not formally, not with full paths.

**Don't over-search:** One or two searches per topic. No results = the user doesn't have notes on this, move on.

**Write sparingly:** Only when the user explicitly asks to save something to their vault.

{{customGuidance}}
