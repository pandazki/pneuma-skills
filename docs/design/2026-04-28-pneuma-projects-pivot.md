# Pneuma 3.0 Project Layer — UX Pivot

> **Date**: 2026-04-28
> **Status**: Draft (awaiting confirmation)
> **Decided by**: Pandazki
> **Supersedes (UI sections only)**: §9–10 of [`2026-04-27-pneuma-projects-design.md`](./2026-04-27-pneuma-projects-design.md). The data model, file layout, handoff protocol, preference layering, evolution flow, and backend contracts are unchanged.

---

## 1. Why the pivot

The current implementation models Project as a **separate page route** (`/?project=…` → `ProjectPage` component). That page renders the project's metadata and session list as its own destination, with a "← Back" path returning to the launcher.

Three problems with this:

1. **It's a meaningless detour.** The page doesn't do anything that needs its own route — it's just a metadata surface plus a session picker. Users land there, look at it, then click into a session anyway. The intermediate page is a tax on every project entry.
2. **It fights the mental model.** A Project is the *organizational frame* for ongoing work, not a "place" you visit. The natural place to see "what is this project, what's in it, what can I do across it" is **while you're working in it** — not on a separate screen disconnected from the work.
3. **It clones state.** ProjectPage re-fetches project info, session list, registry — duplicating work the main app shell already does when you enter a session.

The fix: collapse Project from a page into a **persistent component on the working surface**.

---

## 2. New mental model

> **Project lives in the top-left of the working app shell, alongside Mode and Session.**

The header strip becomes a **three-tier identity chip**:

```
Project ▾   ⌒   Mode ▾   ⌒   Session ▾   +
```

- **Project chip** (new) — present only when the active session belongs to a project. Clicking it expands the **Project Panel**.
- **Mode chip** (existing, slightly relabeled) — current mode; clicking opens the mode switcher (already exists as `ModeSwitcherDropdown`).
- **Session chip** (existing) — the current session display name; clicking lists sibling sessions of the same mode.
- **+** — start a new session in the current project (or quick session if no project).

For **quick sessions** (no project), the layout is unchanged: just `[Pneuma] [Mode ▾] [Session ▾] [+]`. The Project chip simply isn't rendered.

### The Project Panel

Click the Project chip → a wide dropdown (or popover) drops down from the chip, anchored to the top-left. Width roughly half the viewport; height fits the content. It overlays the editor/viewer behind it but doesn't replace it.

The panel contains:

**Identity row**
- Cover (default procedural OR `<project>/.pneuma/cover.png`)
- Display name (large) + optional description
- Path (with `~` shortening, hover to see full)
- "Edit" affordance to rename / re-describe (writes back to `project.json`)

**Sessions area**
- All sessions in the project, grouped by mode (e.g., a column per mode containing 1-N sessions)
- Each session row: display name + last accessed + a primary "Open" affordance
- A "+ New session" affordance at the bottom of each mode column (and a "+ New session in another mode" entry)
- The currently-active session is visually marked

**Cross-mode activity timeline (optional, future polish)**
- Recent handoffs in the project, who → who, when
- Mostly informational; skip for first cut if it bloats scope

**Project-level actions**
- Evolve Project Preferences
- Edit project info (rename / description)
- Archive (see §5)

The panel closes on Esc, click-outside, or clicking the chip again.

---

## 3. State transitions

### A. From launcher → enter a project

Two entry points on a project card:

- **Default click** (whole card hot-zone, e.g. cover + title): enter the **app shell with no active session**. The Project Panel auto-opens. The user's next move: pick a session to enter, or start a new one in some mode.
- **Quick resume affordance**: clicking a specific session (or a mode chip with a count badge) on the card directly resumes that session (skipping the empty-shell intermediate).

The current bare ProjectPage is replaced by **the empty-shell-with-panel-open state**. There is no separate route component anymore; URL stays at `/?project=<root>` but the rendered surface is the main app shell.

### B. Inside a session — switch sessions or modes

- Click Mode chip → existing mode switcher (unchanged behavior, including handoff for cross-mode)
- Click Session chip → lists sibling sessions of the same mode (existing behavior; possibly augmented to show project-wide grouping)
- Click Project chip → expand panel; from the panel, click any session → switch to it

### C. Quick session (no project)

The Project chip isn't rendered. No Project Panel. Everything else is identical to today.

### D. Empty shell state (project loaded, no session)

When the user enters a project from launcher's main-card click, the app shell renders without:
- Mode viewer (no mode loaded)
- Chat panel (no agent connected)
- Mode chip / Session chip in the header

What renders:
- Logo + Project chip + (no Mode/Session) + (+ to start new session)
- Project Panel auto-open, occupying central screen real estate
- Background of the viewer area is empty / hint text "Pick a session or start a new one in any mode"

This state is genuinely useful: it's the "I'm in this project's home, ready to start working" surface. The current ProjectPage tried to be this, but as a separate route it felt detached. As an in-shell state it feels like home.

---

## 4. Surfaces summary

| Surface | Today | After pivot |
|---|---|---|
| Launcher Recent Projects | Cards | **Cards (kept)**, but click semantics clarified: card body → empty shell w/ panel; mode/session chip on card → quick resume |
| `/?project=...` route | Renders `ProjectPage` (separate page) | **Renders main app shell in empty-shell-with-panel-open state** |
| `/?session=...&mode=...` route | App shell with active session | **Unchanged**; if session belongs to a project, header gains Project chip + Project Panel becomes accessible |
| TopBar header | Logo + Mode + Session + `+` | Logo + **Project (when applicable)** + Mode + Session + `+` |
| Project Panel | n/a | New: anchored dropdown from Project chip — identity, sessions list, project actions, archive |

---

## 5. Archive (sub-feature, integrated in the panel)

Project archive is **soft-delete with a restore path**:

- An archived project disappears from the launcher's main "Recent Projects" + "All Projects" lists
- It's reachable through a separate launcher entry: "Archived Projects" (toggle / link / drawer — TBD; defaults to a small link near the All Projects heading)
- Archiving is initiated from the Project Panel → "Archive" action (with a confirm)
- The project's files on disk are not touched. Sessions inside an archived project still work if invoked directly (e.g., bookmarked URLs); the archive is a registry-level filter, not a destructive op
- Restoring is a single click from the Archived list

Storage: add an `archived: boolean` (default false) to project entries in `~/.pneuma/sessions.json`. Filter applied at the API/UI level.

---

## 6. What gets deleted, replaced, kept

**Deleted**
- `src/components/ProjectPage.tsx` and its routing branch in `App.tsx`
- The "← Back" experience — there's no separate page to go back from anymore

**New**
- `ProjectChip` — header chip component (rendered conditionally)
- `ProjectPanel` — dropdown / popover containing the project identity, session grid, actions
- "Empty shell" rendering path in `App.tsx` — handles the case `?project=… & no session`
- Archive UI: launcher Archived bucket + Project Panel archive action
- Backend: `archived` field in registry entry, filter on `/api/projects` (default: hide archived; query param `?archived=true` to list archived only)

**Kept (no change)**
- All data model: `project.json`, `<project>/.pneuma/sessions/{id}/`, handoffs, preferences
- Backend routes for projects: list, create, sessions, cover (just add `archived` filter)
- Mode switcher dropdown (Task 15) — already lives in the header; works regardless of project context
- Handoff Card (Task 11) — overlay anchored bottom-right; survives unchanged
- All session-internal behavior (skill installer, env vars, etc.)

**Renamed/refactored**
- The `Recent Projects` section in Launcher.tsx — keeps its content but the card click handler changes (default → app shell empty state; mode/session chips → quick resume URLs)

---

## 7. Open questions to confirm at implementation time

These are the four UX details we discussed; my proposed defaults are noted, to be confirmed before or during implementation:

| # | Question | Proposed default |
|---|---|---|
| Q1 | Quick session (no project) header shape | Unchanged: `[Pneuma] [Mode ▾] [Session ▾]`, no Project chip |
| Q2 | Project Panel visual form | Anchored dropdown from chip (width ~640px, max-height ~70vh), overlays editor; closes on Esc / click-outside / chip re-click |
| Q3 | Quick-resume affordance on launcher card | Clicking the mode badges / session count row at the bottom of the card resumes the latest session of that mode; main card body click → empty shell with panel |
| Q4 | Archive semantics | Soft delete: hidden from default lists, recoverable from "Archived Projects" entry. Files untouched. Direct URLs to archived sessions still work. |

Additional implementation notes (for when we start coding, not part of the user-facing spec):

- The "empty shell" state requires `App.tsx` to gracefully render without a session. Today many sub-components assume `sessionId` exists; this state needs guards or a dedicated "shell-only" composition.
- Project Panel should reuse `ProjectCard` cover + `useAnimatedMount` for fade-in, matching existing dialog conventions.
- `ProjectChip` styling should mirror `ModeSwitcherDropdown`'s chip shape so the three chips read as a coherent identity strip.
- Backward compat: legacy registry entries without `archived` field are treated as `archived: false`.

---

## 8. Acceptance criteria (when this lands)

- [ ] Clicking a project card from the launcher (main body) lands you in the app shell at `/?project=<root>` with the Project Panel open and no session active. There is no separate "loading project" screen.
- [ ] The Project Panel shows project identity, sessions grouped by mode, and the project actions (Evolve, Edit, Archive).
- [ ] Inside an active project session, the top-left header shows `[Pneuma] [Project ▾] [Mode ▾] [Session ▾] [+]`. Clicking the Project chip opens the same Project Panel.
- [ ] Quick sessions render `[Pneuma] [Mode ▾] [Session ▾] [+]` (no Project chip), behavior unchanged.
- [ ] Archive an active project from its panel → confirm prompt → project disappears from main lists. An "Archived Projects" entry on the launcher reveals it; restore brings it back.
- [ ] A launcher card includes a quick-resume affordance (e.g., clicking the mode-breakdown row) that bypasses the empty shell and lands directly in the latest session of that mode.
- [ ] No `ProjectPage` component or `?project=` route handler distinct from the main app shell remains in the codebase.

---

## 9. Implementation phasing (rough)

When we start, suggested order:

1. **Empty shell state** in `App.tsx` — make the shell render gracefully without an active session. Without this, the Project Panel has nowhere to live in the no-session case.
2. **`ProjectChip` + `ProjectPanel`** — the new header component + its dropdown contents. Initially visually parked; no archive yet.
3. **Wire `?project=` to the empty shell** — replace ProjectPage; delete its route and component.
4. **Archive: backend + launcher Archived bucket + panel action**.
5. **Quick-resume affordance** on launcher cards.
6. **Polish + visual verification** — Vite HMR + chrome-devtools-mcp for click-through smoke.

Each phase is independently shippable; the suite stays green at each step.
