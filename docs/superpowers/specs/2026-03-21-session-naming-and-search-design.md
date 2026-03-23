# Session Naming & Search

## Overview

Add session naming (create-time + rename) and search to the launcher's Recent Sessions.

## Data Model

### SessionRecord (bin/pneuma-cli-helpers.ts)

Add optional `sessionName` field:

```typescript
export interface SessionRecord {
  id: string;
  mode: string;
  displayName: string;       // Mode display name (e.g. "Doc", "Slide")
  sessionName?: string;      // User-facing session name (editable)
  workspace: string;
  backendType: AgentBackendType;
  lastAccessed: number;
}
```

Display priority: `sessionName ?? displayName`.

Old records without `sessionName` display identically to today — fully backward compatible.

### Default sessionName

Same rule as workspace directory basename: `{safeName}-{timeTag}` where `safeName` is the mode specifier and `timeTag` is `YYYYMMDD-HH` from `new Date().toISOString()`.

Example: `doc-20260321-14`

## Changes

### 1. LaunchDialog — session name input

- Add "Session name" text input below workspace path in `LaunchDialog`.
- Pre-fill with default name (`{safeName}-{timeTag}`).
- User can edit freely; the value is sent as `sessionName` in `POST /api/launch`.
- When resuming an existing session, the field is hidden (name already set).

### 2. POST /api/launch — accept sessionName

- Accept optional `sessionName` in request body.
- Pass it through to the spawned pneuma process via `--session-name <name>` CLI flag.

### 3. CLI (bin/pneuma.ts) — --session-name flag

- `parseCliArgs` accepts `--session-name`.
- `recordSession` accepts optional `sessionName` parameter.
- Stored in `SessionRecord.sessionName`.

### 4. PATCH /api/sessions/:id — rename

New endpoint in launcher mode block of `server/index.ts`:

```
PATCH /api/sessions/:id
Body: { sessionName: string }
Response: { ok: true }
```

Reads registry, finds record by id, updates `sessionName`, writes back.

### 5. SessionCard — display & inline rename

- Display `sessionName ?? displayName` as the session title.
- Show pencil icon on hover (alongside replay/delete buttons).
- Click pencil: title becomes an inline `<input>`, pre-filled with current name.
- Save on Enter or blur; cancel on Escape.
- On save: `PATCH /api/sessions/:id` then update local state.

### 6. Recent Sessions — search

- Add search input at the top of the Recent Sessions section (magnifying glass icon, compact).
- Filter sessions client-side by matching query against `sessionName`, `displayName`, and `workspace` (case-insensitive substring match).
- Empty query shows all sessions.
- Search input only visible when there are sessions to search (>= 1).

## Files to Modify

| File | Change |
|------|--------|
| `bin/pneuma-cli-helpers.ts` | Add `sessionName` to `SessionRecord`, add `--session-name` to `ParsedCliArgs` and `parseCliArgs` |
| `bin/pneuma.ts` | Pass `sessionName` to `recordSession`, accept `--session-name` flag |
| `server/index.ts` | Accept `sessionName` in `POST /api/launch`, add `PATCH /api/sessions/:id` endpoint |
| `src/components/Launcher.tsx` | Session name input in LaunchDialog, inline rename in SessionCard, search in Recent Sessions |

## Non-goals

- Session name is not synced to workspace directory name or `.pneuma/session.json`.
- No validation beyond non-empty string (no uniqueness constraint).
- No CLI-only rename command (launcher UI only for now).
