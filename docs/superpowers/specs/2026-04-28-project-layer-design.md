# Pneuma Project Layer Design

**Date:** 2026-04-28
**Status:** Draft, direction approved
**Decision:** Project Root / Session Sandbox model

## Overview

Introduce an optional Project layer above Pneuma sessions. A project is a user-owned directory with a persistent identity, multiple isolated sessions, project-scoped preferences, explicit cross-mode handoffs, and a Launcher-level overview.

The design preserves the 2.x quick-session workflow. Users can still run `pneuma <mode>` for a one-off session without creating or understanding projects. A project only exists after the user explicitly creates one or upgrades an existing quick session.

**Core formula:** `ProjectRoot(deliverables) + SessionSandbox(process state) + ExplicitHandoff(cross-mode context)`

## Goals

1. **Optional organization layer** - projects are useful for long-running work, but not required for quick sessions.
2. **User-owned directory** - project roots are normal directories the user can open in Finder, initialize with git, and push to GitHub.
3. **Multiple isolated sessions** - a project can host many sessions across one or more modes without session histories bleeding into each other.
4. **Clean deliverable surface** - final outputs live in the project root or an explicit project-approved location, while agent process files stay inside session sandboxes.
5. **Explicit cross-mode collaboration** - mode switches transfer reviewed handoff context, not hidden access to another session's private history.
6. **Project-scoped memory** - project preferences and project evolution exist separately from global user preferences.
7. **Git-friendly metadata** - Pneuma metadata is visible, centralized, and easy to ignore.
8. **Recoverable state** - copying a project directory should preserve project identity, sessions, handoffs, and project preferences.

## Non-Goals

- Strong multi-writer consistency. Concurrent writes use last-write-wins semantics.
- Realtime syncing into already-running sessions. Project preference changes apply on next session start or activation.
- Automatic migration of existing workspaces into projects.
- Mode-specific handoff protocols. All modes use the same handoff contract.
- Hidden session introspection. Sessions do not inspect each other's private history unless the user creates a handoff.
- Full git workflow management. Projects are git-friendly, but Pneuma does not own commit or push semantics.

## Design Principles

### Project Root / Session Sandbox

The project root is the user's deliverable directory. It should look like the actual product, website, document set, deck, video source, or course material being built.

Each project session gets its own sandbox under `.pneuma/sessions/<session-id>/`. Agent scratch files, private process state, session history, and transient workspace artifacts stay there by default.

```text
<project-root>/
  deliverables...
  .pneuma/
    project.json
    project-preferences.md
    timeline.jsonl
    sessions/
      <session-id>/
        session.json
        history.json
        workspace/
        scratch/
    handoffs/
      <handoff-id>.md
```

This model gives Pneuma two explicit roots:

- `projectRoot` - user-visible deliverables and project metadata.
- `sessionWorkspace` - agent working area for one session.

### Explicit Publish Boundary

A session does not naturally leak its workspace into the project root. Deliverables reach the project root through explicit writes:

- The user asks for a concrete output path.
- The mode already has a known deliverable path.
- The agent performs a project publish action and records it in the project timeline.

This is stricter than the current workspace-only model, but it matches the project promise: opening the project root should show outcomes, not process debris.

### Session Isolation

Sessions in the same project share identity, project preferences, and project-level summaries, but not raw internal histories.

Allowed shared inputs:

- `project.json`
- `project-preferences.md`
- project session index metadata
- user-approved handoffs
- project timeline facts
- deliverables in `projectRoot`

Disallowed implicit inputs:

- another session's full `history.json`
- another session's scratch files
- another session's private workspace
- hidden mode-specific state

## Project Metadata

### `.pneuma/project.json`

```ts
interface ProjectManifest {
  schemaVersion: 1;
  projectId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  root: string;
  deliverablePaths?: string[];
  defaultBackendType?: "claude" | "codex";
}
```

Rules:

- Creating or activating a project writes this file.
- Name and description changes are explicit project metadata edits.
- Metadata edits append to `.pneuma/timeline.jsonl`.
- `root` is advisory and may be refreshed if the directory is moved.

### Session Index

Each project session has a local session manifest:

```ts
interface ProjectSessionManifest {
  schemaVersion: 1;
  sessionId: string;
  projectId: string;
  mode: string;
  role?: string;
  displayName: string;
  backendType: "claude" | "codex";
  status: "active" | "idle" | "archived";
  createdAt: string;
  lastAccessed: string;
  sessionWorkspace: string;
  deliverablePaths?: string[];
  sourceQuickSessionId?: string;
}
```

The project overview can derive its session list by scanning `.pneuma/sessions/*/session.json`. A global recent-projects registry may cache this for Launcher performance, but the project directory remains the source of truth.

## Storage Layout

### Project Root

```text
<project-root>/
  README.md
  index.html
  deck.pptx
  assets/
  .pneuma/
```

The root contains user-recognizable outputs. Pneuma should not fill it with logs, snapshots, temporary prompts, or backend-specific internal files unless the user explicitly wants those as deliverables.

### `.pneuma/`

```text
.pneuma/
  project.json
  project-preferences.md
  timeline.jsonl
  sessions/
    webcraft-20260428-abc123/
      session.json
      history.json
      config.json
      workspace/
      scratch/
      shadow.git/
      checkpoints.jsonl
      replay-checkout/
      resumed-context.xml
    doc-20260428-def456/
      ...
  handoffs/
    20260428T101500-webcraft-to-doc.md
```

Existing per-workspace `.pneuma` files move inside the project session sandbox for project sessions. Quick sessions keep the current 2.x layout.

### Git Ignore Recommendation

Project creation should offer or write a local ignore block:

```gitignore
# Pneuma project metadata and session state
.pneuma/
```

This keeps normal project commits clean. Users who want to back up project sessions can opt into tracking `.pneuma/` or copy the project directory outside git.

## Launcher Experience

The Launcher gets two top-level recency sections:

1. **Recent Projects** - persistent workspaces with project identity.
2. **Recent Sessions** - independent quick sessions.

Opening a project shows:

- Project name, description, root path, created time.
- Session list with mode, role, backend, activity, and status.
- Actions to start a new session in any mode.
- Actions to resume an existing session.
- Project actions: edit identity, evolve project, open folder, upgrade/export/backup affordances as they become available.

Creating a project is a Launcher-level action. It does not require first starting a session.

## Session Startup

### Quick Session

Existing behavior remains:

```text
pneuma <mode> --workspace <workspace>
```

The session uses the current workspace-local `.pneuma/` structure. No project metadata is required.

### New Project Session

Project session startup takes both a project root and a session sandbox:

```text
pneuma <mode> --project <project-root> --role "Build the landing page"
```

Resolved runtime context:

```ts
interface RuntimeSessionContext {
  mode: string;
  backendType: "claude" | "codex";
  project?: {
    projectId: string;
    name: string;
    description?: string;
    root: string;
    preferencesPath: string;
    sessions: ProjectSessionSummary[];
  };
  workspace: string;          // sessionWorkspace, not projectRoot
  projectRoot?: string;       // deliverable root
  role?: string;
}
```

The backend still receives a normal workspace. For project sessions, that workspace is the session sandbox. Project information is injected as explicit context so the agent knows where deliverables belong.

## Agent Context Injection

At session start, Pneuma injects a project section into backend instructions:

```markdown
### Project Context

Project: <name>
Root: <project-root>
Description: <description>
This session role: <role>

Deliverables should be written to the project root or explicit deliverable paths.
Scratch work and intermediate files should stay in this session workspace.

Other sessions:
- <mode> - <role/displayName> - <status> - last active <time>
```

Project preferences are injected after global preferences and before mode-specific runtime instructions. If project and personal preferences conflict, project preferences win and the agent should briefly state that it is following the project-specific constraint.

## Cross-Mode Handoffs

Mode switching is explicit, reviewable, and non-destructive.

### Flow

1. User chooses "Switch mode" from a project session.
2. Source session generates a handoff draft:
   - current goal
   - key decisions
   - constraints
   - relevant deliverables
   - open questions
   - recommended next mode action
3. UI shows the handoff draft.
4. User can cancel, edit, or confirm.
5. On confirm, Pneuma writes `.pneuma/handoffs/<handoff-id>.md`.
6. Target mode either resumes the most recent session for that mode or starts a new session.
7. Target session receives the handoff as startup context.
8. Project timeline records the handoff event.

### Handoff File

```markdown
---
handoffId: 20260428T101500-webcraft-to-doc
projectId: ...
fromSessionId: ...
toSessionId: ...
fromMode: webcraft
toMode: doc
createdAt: 2026-04-28T10:15:00Z
---

# Handoff: webcraft to doc

## Goal

## Decisions

## Constraints

## Relevant Files

## Open Questions

## Suggested Next Step
```

Handoff files are the collaboration boundary. The target session does not read raw source session history unless the user explicitly includes excerpts in the handoff.

## Project Preferences

Pneuma keeps two orthogonal preference layers:

- Personal preferences: `~/.pneuma/preferences/`
- Project preferences: `<project-root>/.pneuma/project-preferences.md`

Project preferences apply to all sessions in that project only. They are natural-language documents managed by agents and users, with the same "observe carefully, record sparingly" standard as personal preferences.

Conflict rule:

1. Project preference wins over personal preference.
2. Mode-specific critical constraints still apply unless the project explicitly narrows or overrides them.
3. The agent should mention the conflict briefly when it affects visible behavior.

Running sessions are not required to hot-reload project preference changes. The updated preferences apply on next start or activation.

## Project Evolution

Project evolution is a project-scoped version of the existing preference analysis flow.

Inputs:

- all project session manifests
- handoff files
- project timeline
- project deliverable summaries
- user-approved session summaries

Outputs:

- updates to `.pneuma/project-preferences.md`
- a timeline event describing the evolution run

Project evolution must not write to `~/.pneuma/preferences/`. Its output is local to the project.

## Upgrade From Quick Session

A quick session can be upgraded into a project without destroying the original session.

### Flow

1. User chooses "Create project from this session" or creates a project and selects a seed quick session.
2. User selects or creates the project root.
3. Pneuma creates `.pneuma/project.json` in the project root.
4. Pneuma copies or summarizes the quick session into a new project session sandbox.
5. Existing deliverables can be copied, moved, or left in place depending on the user's selected root.
6. The original quick session remains recoverable.
7. The project timeline records the upgrade.

Upgrade is a fork. It does not convert old workspaces in place unless the user selected that same directory as the project root.

## File Watching

Project sessions default to watching `sessionWorkspace`, not the whole project root.

Mode viewers that need deliverable previews may subscribe to explicit deliverable paths in `projectRoot`. This should be opt-in per mode or per project session, because watching the whole project root would make unrelated deliverable edits flood the session.

Watcher policy:

- Always watch session-owned files.
- Watch project deliverable paths only when declared.
- Do not watch `.pneuma/sessions/*` from other sessions.
- Never infer cross-session collaboration from filesystem changes alone.

## Timeline

`.pneuma/timeline.jsonl` records project-level facts:

```ts
type ProjectTimelineEvent =
  | { type: "project.created"; at: string; projectId: string; name: string }
  | { type: "project.updated"; at: string; changes: Record<string, unknown> }
  | { type: "session.created"; at: string; sessionId: string; mode: string; role?: string }
  | { type: "session.resumed"; at: string; sessionId: string }
  | { type: "handoff.created"; at: string; handoffId: string; fromSessionId: string; toSessionId?: string }
  | { type: "deliverable.published"; at: string; sessionId: string; paths: string[] }
  | { type: "project.evolved"; at: string; sourceSessionCount: number };
```

This is not a full audit log. It is a user-visible collaboration timeline for recovery, explanation, and future analysis.

## Global Registries

Quick sessions continue to use the existing global recent-session registry.

Projects add a separate recent-projects registry:

```text
~/.pneuma/projects.json
```

```ts
interface RecentProjectRecord {
  projectId: string;
  name: string;
  description?: string;
  root: string;
  lastAccessed: string;
}
```

The registry is a cache for Launcher convenience. If it is missing or stale, Pneuma can rebuild recent project metadata from known roots when the user opens a project.

## Error Handling

- Missing `.pneuma/project.json`: the directory is not a project until the user activates it.
- Corrupt `project.json`: show a repair prompt; do not silently create a different project identity.
- Missing session sandbox: mark the session as unavailable in the project overview.
- Missing handoff file: target session starts without that handoff and records a warning.
- Moved project directory: refresh the advisory `root` value after user confirmation.
- Preference parse issues: project preferences are Markdown; unreadable files are skipped with a visible warning.

## Backward Compatibility

2.x quick sessions remain valid. Existing workspaces continue to use:

```text
<workspace>/.pneuma/session.json
<workspace>/.pneuma/history.json
```

Project sessions use:

```text
<project-root>/.pneuma/sessions/<session-id>/session.json
<project-root>/.pneuma/sessions/<session-id>/history.json
```

This avoids a forced migration and keeps old workspace restore semantics intact.

## Implementation Decomposition

This should become several board cards after spec approval:

1. **Project metadata and registry**
   - create/read/update `project.json`
   - recent-projects registry
   - explicit project activation

2. **Project session sandbox runtime**
   - resolve `projectRoot` and `sessionWorkspace`
   - write project session manifests
   - preserve quick-session behavior

3. **Launcher project overview**
   - Recent Projects section
   - project detail view
   - create project and start/resume project session actions

4. **Project context and preferences injection**
   - inject project identity, role, session summaries, and project preferences
   - implement project-over-personal conflict ordering

5. **Mode switch handoff**
   - generate editable handoff drafts
   - write handoff files
   - resume latest matching mode session or create a new one
   - record timeline events

6. **Quick-session upgrade**
   - seed project from existing session
   - choose root
   - fork session state without destroying original session

7. **Project evolution**
   - scan project sessions and handoffs
   - update project preferences only
   - record project evolution timeline event

## Testing Strategy

### Unit Tests

- Project manifest read/write and validation.
- Recent-project registry update and stale-path handling.
- Session sandbox path resolution.
- Preference merge ordering.
- Handoff file frontmatter parsing.

### Integration Tests

- Create a project from Launcher and start a session.
- Start two sessions in the same project with different modes.
- Verify each session writes process files only inside its sandbox.
- Switch modes and confirm handoff context appears in the target session.
- Upgrade a quick session into a project and verify the original remains recoverable.

### Regression Tests

- `pneuma <mode>` without project arguments behaves exactly like a quick session.
- Existing workspace `.pneuma/session.json` restore still works.
- File watcher does not subscribe to the whole project root by default.
- Ignoring `.pneuma/` keeps project deliverables git-clean.

## Open Decisions Resolved

- **Directory model:** project root is the deliverable directory; sessions use isolated sandboxes.
- **Project creation:** explicit only; no automatic project detection.
- **Cross-session collaboration:** handoff files only; no hidden session-history reads.
- **Preference conflict:** project preferences override personal preferences.
- **Upgrade semantics:** fork, not in-place migration.
