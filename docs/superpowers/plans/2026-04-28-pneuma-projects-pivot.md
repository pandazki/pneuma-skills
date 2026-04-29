# Pneuma 3.0 Project Layer — UX Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recast the Project Layer UI from a separate `/?project=…` route (`ProjectPage`) into a header chip + dropdown panel embedded in the main app shell. Project becomes a *persistent surface inside the working app*, not a place you visit.

**Architecture:** Three changes ripple through the frontend: (1) `App.tsx` learns an "empty shell" rendering path so the header survives without a session; (2) two new components — `ProjectChip` in the header and `ProjectPanel` as its anchored dropdown — replace `ProjectPage`; (3) `Launcher` cards rewire their click semantics so the main body lands on the empty shell while the mode-breakdown row quick-resumes the latest session of that mode. Archive (Phase 4) is added as a registry-level filter, not a destructive operation. All data model + handoff + preferences contracts are unchanged.

**Tech Stack:** React 19 + Vite 7 + Tailwind CSS 4 + Zustand 5. Existing tokens (`cc-*`), animations (`launcherFadeIn`, `overlayFadeIn`, `cubic-bezier(0.16, 1, 0.3, 1)`), and chip / dropdown shapes from `ModeSwitcherDropdown.tsx` are the visual reference.

**Design language:** See `.impeccable.md` — Ethereal Tech, glassmorphism with restraint, purposeful orange, content-first. Specific bans for this work:
- No side-stripe borders >1px on rows / cards / panel sections.
- No nested cards inside the panel — sessions are flat rows, not card-grid-in-card.
- No identical card grid for sessions; group by mode column with varied internal rhythm.
- No hero-metric layout; the panel is informational, not a stats dashboard.
- No gradient text. Solid tokens only.
- Use existing `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quart) easing — don't introduce bounce/elastic.

**Spec source:** `docs/design/2026-04-28-pneuma-projects-pivot.md` (UI sections only). Earlier 3.0 spec `docs/design/2026-04-27-pneuma-projects-design.md` remains canonical for everything below the UI.

**Resolved open questions** (Q1–Q4 from §7 of the pivot doc):
- **Q1** Quick session header: `[Pneuma] [Mode ▾] [Session ▾]`, no Project chip — confirmed.
- **Q2** Project Panel form: anchored dropdown from chip, ~640px wide, `max-h: 70vh`, closes on Esc / click-outside / chip re-click — confirmed.
- **Q3** Quick-resume affordance: clicking the mode-breakdown row on a launcher card resumes the latest session of that mode; main card body click → empty shell — confirmed.
- **Q4** Archive: soft delete; hidden from default lists; `?archived=true` to list archived; restorable; on-disk files untouched — confirmed.
- **Resolved during planning:** TopBar already has a `+` for `createEmpty` (mode-content scope: new slide / page). The pivot doc's `+` (start new session) is folded **into the Project Panel** instead, to avoid two `+` icons in one chip strip with different meanings. Quick sessions: existing `+` stays; no extra "new session" button (quick sessions can't have siblings).

---

## File Structure

**New files:**
- `src/components/ProjectChip.tsx` — header chip; opens panel on click
- `src/components/ProjectPanel.tsx` — anchored dropdown content; uses identity row + sessions area + actions

**Modified files:**
- `src/App.tsx` — empty-shell rendering path; remove ProjectPage routing branch
- `src/components/TopBar.tsx` — render ProjectChip when projectContext is present
- `src/components/Launcher.tsx` — Archived bucket entry; (Phase 5) quick-resume affordance wiring
- `src/components/ProjectCard.tsx` — split click semantics; mode-breakdown row becomes quick-resume hot zone
- `bin/sessions-registry.ts` — `archived?: boolean` field on `ProjectRegistryEntry`
- `server/projects-routes.ts` — `?archived=true` filter; archive / restore endpoints

**Deleted:**
- `src/components/ProjectPage.tsx`
- The `isLauncher && projectParam` branch in `App.tsx`

---

## Phase 1 — Empty shell state in App.tsx

The header has nowhere to live in the no-session case until App.tsx renders gracefully without `sessionId` / `modeManifest`. This must come first.

### Task 1.1: Detect empty-shell URL state

**Files:**
- Modify: `src/App.tsx:217-245`

- [ ] **Step 1:** In `App()`, after the existing `isLauncher` and `projectParam` derivations, add an `isEmptyShell` derived state: `const isEmptyShell = !!projectParam && !params.has("session") && !params.has("mode");`. The current launcher-with-project branch (lines 225–238) should be replaced — see Task 3.1 below — but in this task we just add the detection.

- [ ] **Step 2:** Verify type-check: `bun run build` (or `bunx tsc --noEmit`) — expect green.

### Task 1.2: Empty-shell render path with TopBar + placeholder viewer

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TopBar.tsx` — needs to tolerate missing `modeManifest`

- [ ] **Step 1:** Add a new branch in `App()` (after the launcher branch, before the session render path): when `isEmptyShell`, render the standard editor-layout chrome (border, mesh gradients, TopBar) but with:
  - No `Group` / `Panel` / `RightPanel` — instead a centered hint area that says "Pick a session below or start a new one" (1 sentence, `text-cc-muted/60`, no card around it).
  - HandoffCard is omitted (no project session active).
  - `ProjectPanel` mounted in **auto-open** state (Phase 2 Task 2.5 wires this).

```tsx
if (isEmptyShell) {
  return (
    <div className="flex flex-col h-screen bg-cc-bg text-cc-fg relative overflow-hidden p-4 sm:p-6 md:p-8">
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[50%] bg-cc-primary/10 blur-[120px] rounded-full pointer-events-none animate-[pulse-dot_8s_ease-in-out_infinite]" />
      <div className="absolute top-[20%] right-[-10%] w-[50%] h-[60%] bg-purple-500/10 blur-[100px] rounded-full pointer-events-none animate-[pulse-dot_10s_ease-in-out_infinite_reverse]" />
      <div className="relative z-10 flex flex-col flex-1 border border-cc-primary/20 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(249,115,22,0.15)] ring-1 ring-white/5 before:absolute before:inset-0 before:bg-cc-surface/40 before:backdrop-blur-3xl before:-z-10">
        <TopBar />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-cc-muted/60 text-sm font-body">
            Pick a session or start a new one in any mode.
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** Make `TopBar` survive without a session: check `useStore((s) => s.modeViewer)` — if undefined, hide the tabs row, the share dropdown, the editing toggle, and the `createEmpty` `+`. The chip strip on the left stays; only ProjectChip will be visible (Phase 2). For empty shell, the `ContentSetSelector`s are auto-hidden (their guards already handle empty arrays).

- [ ] **Step 3:** Verify visually: `bun run dev` with no project, navigate to `/?project=<some-existing-project-root>`. Confirm the placeholder text renders inside the chrome with the mesh background. Use chrome-devtools-mcp `take_screenshot` to confirm.

### Task 1.3: Skip mode + WS load when in empty shell

**Files:**
- Modify: `src/App.tsx:250-356` (the main `useEffect`)

- [ ] **Step 1:** Wrap the body of the main `useEffect` so when `isEmptyShell` is true, only the `/api/session` fetch runs (to populate `projectContext`). Skip `loadModeAsync`, `connect()`, `/api/files`, `/api/config`, `/api/git/available`. Reason: empty shell has no session → no agent → no mode viewer.

- [ ] **Step 2:** The `/api/session` path returns `{ project: { projectRoot, homeRoot, sessionDir } }` — but in empty shell there is *no session yet*. Use `/api/projects/:id/sessions` directly: it returns `{ project: { name, displayName, description?, root }, sessions }`. Map this into the store: set `projectContext` to `{ projectRoot, homeRoot: projectRoot, sessionDir: projectRoot, projectName: project.displayName, projectDescription: project.description }`. (For empty shell `homeRoot` and `sessionDir` aren't meaningful — there's no session — but the slice typing requires strings, so projectRoot is the safe stand-in.)

- [ ] **Step 3:** Also extend `/api/session` (the active-session endpoint, used by App.tsx:320) to enrich the `project` block with `projectName` (= manifest.displayName) and `projectDescription` (= manifest.description). This fills the chip label inside an active project session without an extra fetch. Server change lives in `server/index.ts` — find where the `/api/session` response is assembled and add the manifest-derived fields when `pneumaProjectRoot` is configured.

- [ ] **Step 3:** Verify: navigate to `/?project=<root>` and confirm in DevTools that no `/ws/browser/*` connection is opened, no `/api/files` call fires, but `projectContext` is set in the store.

---

## Phase 2 — ProjectChip + ProjectPanel

### Task 2.1: ProjectChip component

**Files:**
- Create: `src/components/ProjectChip.tsx`
- Test: `src/__tests__/ProjectChip.test.tsx` (smoke render only — interaction wiring tested via the panel below)

- [ ] **Step 1:** Build the chip mirroring `ModeSwitcherDropdown.tsx:148-156`. Same dimensions, same `bg-cc-bg/40 border border-cc-border/60 hover:border-cc-primary/50 rounded-md px-2 py-0.5 text-xs` shape so the three chips read as a coherent strip. The chip label is `projectContext.projectName ?? "Project"` (project name comes from `/api/projects/:id/sessions` — the panel will own loading; the chip shows whatever's in the store). The down-caret matches mode/session chips.

- [ ] **Step 2:** Click toggles a local `open` state, which is hoisted via callback prop to the parent so `ProjectPanel` can render anchored to it. Esc / click-outside close the panel (mirror the existing pattern from ModeSwitcherDropdown lines 49-68). Use the same `useRef + useEffect` close-on-outside-click pattern.

- [ ] **Step 3:** Smoke test — render with mock projectContext and assert the chip text is the project name.

- [ ] **Step 4:** Commit.

### Task 2.2: ProjectPanel — identity row

**Files:**
- Create: `src/components/ProjectPanel.tsx`

- [ ] **Step 1:** Build the panel as a forward-ref absolute-positioned div, anchored under the chip with `top-full left-0 mt-2`. Width: `w-[640px]` (about half a typical viewport), max-height `max-h-[70vh] overflow-auto`, surface `bg-cc-surface border border-cc-border rounded-2xl shadow-[0_24px_64px_-24px_rgba(0,0,0,0.6)] backdrop-blur-xl z-[100]`. Match the radii/shadow rhythm used in the editor chrome (`rounded-2xl`, glassmorphism), not the smaller `rounded-lg` used for plain dropdowns — this panel is a content surface, not a menu.

- [ ] **Step 2:** Identity row layout (top of panel): horizontal flex, 16px gap.
  - Left: 96×96 cover (use existing `<CoverImage>` from `ProjectCard.tsx:38-52` — extract it to `src/components/ProjectCover.tsx` so both the card and panel share it). Rounded `rounded-xl`, `overflow-hidden`, `aspect-square`, no border (the cover is the focus, not the frame).
  - Right column: project displayName in `font-display text-2xl text-cc-fg`, then description in `text-sm text-cc-muted/80 line-clamp-2`, then path in `text-[11px] font-mono-code text-cc-muted/50` with `~` shortening (use `shortenPath` from `src/utils/string.ts`) and `title` for full path on hover.
  - Far right: a tiny "Edit" text button (`text-xs text-cc-muted hover:text-cc-primary`) that opens an inline rename/re-describe form (Phase 4 polish — for now wire to a no-op).

- [ ] **Step 3:** Add a vertical divider (`border-t border-cc-border/50`) below the identity row before the next section. Don't separate sections with extra cards — the divider is the section break.

- [ ] **Step 4:** Commit.

### Task 2.3: ProjectPanel — sessions area, grouped by mode

**Files:**
- Modify: `src/components/ProjectPanel.tsx`

- [ ] **Step 1:** Inside the panel, fetch `/api/projects/:id/sessions` on mount via `useEffect`. Cache result in component state. Show a centered `text-cc-muted/60` spinner row while loading (avoid skeletons — they're AI-slop tells in this design language).

- [ ] **Step 2:** Group sessions by `mode`. Render as a CSS grid: `grid-cols-[repeat(auto-fit,minmax(220px,1fr))]`, `gap-4`. Each column = one mode:
  - **Column header**: `<div className="text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium pb-2 border-b border-cc-border/40">{mode.displayName ?? mode.name}</div>` — use `<h3>` semantics for screen readers but the styled wrapper is the visual.
  - **Sessions in column**: vertical stack of rows. Each row is a flat clickable element (`<button>` or `<a>` if it changes URL): `flex items-center gap-2 px-2 py-2 rounded-md text-left hover:bg-cc-hover/50 transition-colors`. Inside: 32×32 mode glyph or session number, session display name (`text-sm text-cc-fg truncate`), last-accessed below in `text-[11px] text-cc-muted/50` (use `timeAgo` helper). Currently-active session: add an `aria-current="page"` and a subtle `bg-cc-primary/8 ring-1 ring-cc-primary/30` (this is a subtle background tint, not a side-stripe).
  - **Footer of column**: `+ New {mode} session` row — same row shape, dotted border `border border-dashed border-cc-border/50 hover:border-cc-primary/40 text-cc-muted hover:text-cc-primary`. Click → `POST /api/launch` with `{specifier: mode, project: projectRoot}`.

- [ ] **Step 3:** **Modes not yet used** — under the per-mode grid, render a small "Start in another mode…" row with a select-style trigger that, on click, opens a tiny popover listing remaining modes (fetch `/api/registry`, dedupe). Click → same launch as above. Keep this affordance compact; it's the long tail.

- [ ] **Step 4:** Click handlers: opening a session does `POST /api/launch` with `{specifier: mode, workspace: projectRoot, project: projectRoot, sessionId}` then `window.location.href = data.url`. This matches today's `ProjectPage.openSession` exactly — the implementer can copy that logic verbatim.

- [ ] **Step 5:** Commit.

### Task 2.4: ProjectPanel — project actions

**Files:**
- Modify: `src/components/ProjectPanel.tsx`

- [ ] **Step 1:** Below the sessions area, separated by another `border-t border-cc-border/50 mt-4 pt-4`, render a horizontal row of two text actions:
  - **Evolve Preferences** — `POST /api/launch` with `{specifier: "evolve", project: projectRoot, workspace: projectRoot}` (matches `ProjectPage.evolveProject`).
  - **Archive** — disabled placeholder for now (`opacity-50 cursor-not-allowed`); enabled in Phase 4.
- Both: `text-xs text-cc-muted hover:text-cc-fg`, separated by a `text-cc-muted/30` middle dot. No buttons-as-cards; these are tertiary actions. (Rename/description editing is deliberately out of MVP scope — the original `ProjectPage` didn't ship it either.)

- [ ] **Step 2:** Commit.

### Task 2.5: Wire ProjectChip into TopBar + auto-open in empty shell

**Files:**
- Modify: `src/components/TopBar.tsx:368-405`
- Modify: `src/App.tsx`

- [ ] **Step 1:** In `TopBar.tsx`, between `<img src="/logo.png" />` (around line 372-374) and `<ModeSwitcherDropdown />` (line 376), conditionally insert `<ProjectChip />` when `useStore(s => s.projectContext)` is truthy. Add a 1-px vertical divider (`<span className="w-px h-3 bg-cc-border/40" aria-hidden />`) between Project chip and Mode chip so the three chips have a visual rhythm beat — not three identical pills mashed together. Also add the same divider between Mode chip and ContentSetSelector when both render.

- [ ] **Step 2:** Pass an `autoOpen` prop down: `<ProjectChip autoOpen={isEmptyShell} />`. (Hoist the `isEmptyShell` derivation to the store, or pass via context, or recompute from URL inside ProjectChip — pick whichever is simplest; the implementer can choose.)

- [ ] **Step 3:** In `App.tsx` empty-shell branch, the panel mount lives inside TopBar (because ProjectChip owns it). Verify the auto-open works: load `/?project=<root>` and the panel appears immediately without an interaction.

- [ ] **Step 4:** Visual verification with chrome-devtools-mcp: take a screenshot of the empty-shell state with panel open. Confirm chip strip reads correctly: `[logo] [Project ▾]` and the panel has identity, sessions grid, actions.

- [ ] **Step 5:** Commit.

---

## Phase 3 — Wire `?project=` to empty shell, delete ProjectPage

### Task 3.1: Remove ProjectPage routing branch

**Files:**
- Modify: `src/App.tsx:33-35,224-238`
- Delete: `src/components/ProjectPage.tsx`

- [ ] **Step 1:** Remove the `ProjectPage` lazy import (lines 33-35) and the `isLauncher && projectParam` branch (lines 224-238). The empty-shell branch from Phase 1 already handles `?project=...` URLs.

- [ ] **Step 2:** `git rm src/components/ProjectPage.tsx`.

- [ ] **Step 3:** Run `bun run build` — fix any dangling imports.

- [ ] **Step 4:** Verify the launcher's "click on project card" still works: clicking a card navigates to `/?project=<root>` and lands on empty shell with panel auto-open. (Card href is already `/?project=<root>` per `ProjectCard.tsx:77,122`.)

- [ ] **Step 5:** Commit.

### Task 3.2: Smoke-test handoff cards still survive

**Files:** none (verification only)

- [ ] **Step 1:** Inside an active project session (not empty shell), trigger a handoff via the agent. Confirm `HandoffCard` still renders bottom-right. (HandoffCard is mounted from `App.tsx:417,451` — both branches retained.)

- [ ] **Step 2:** No commit; this is gating verification.

---

## Phase 4 — Archive: backend + launcher Archived bucket + panel action

### Task 4.1: Add `archived` field to ProjectRegistryEntry

**Files:**
- Modify: `bin/sessions-registry.ts`
- Modify: `bin/__tests__/sessions-registry.test.ts`

- [ ] **Step 1:** Add `archived?: boolean` to the `ProjectRegistryEntry` interface. Default treatment when the field is missing: `archived === false`.

- [ ] **Step 2:** Update `upsertProject` to preserve `archived` if present on the existing entry (don't overwrite it on resume). New helpers: `archiveProject(data, id): SessionsFile` and `restoreProject(data, id): SessionsFile`.

- [ ] **Step 3:** Add tests:
  - Upsert preserves `archived: true`.
  - `archiveProject` flips a project's flag without touching others.
  - `restoreProject` clears the flag.
  - Legacy entries without the field are read as `archived: false`.

- [ ] **Step 4:** Run `bun test bin/__tests__/sessions-registry.test.ts` — green.

- [ ] **Step 5:** Commit.

### Task 4.2: Server endpoints — filter + archive + restore

**Files:**
- Modify: `server/projects-routes.ts`
- Modify: `server/__tests__/projects-routes.test.ts`

- [ ] **Step 1:** `GET /api/projects` accepts `?archived=` query:
  - default (no param) → return projects where `archived !== true`
  - `?archived=true` → return only `archived === true`
  - `?archived=all` → return both
- [ ] **Step 2:** Add `POST /api/projects/:id/archive` → calls `archiveProject` and persists. Returns `{archived: true}`.
- [ ] **Step 3:** Add `POST /api/projects/:id/restore` → calls `restoreProject`. Returns `{archived: false}`.
- [ ] **Step 4:** Tests:
  - Archived project hidden from default list, present in `?archived=true`.
  - `/archive` and `/restore` round-trip correctly.
  - 404 on unknown id.
- [ ] **Step 5:** Run `bun test server/__tests__/projects-routes.test.ts` — green.
- [ ] **Step 6:** Commit.

### Task 4.3: ProjectPanel "Archive" action with confirm

**Files:**
- Modify: `src/components/ProjectPanel.tsx`

- [ ] **Step 1:** Replace the disabled placeholder from Task 2.4 with a working text button. Click → inline confirm (no modal): the button row morphs to "Archive this project? [Cancel] [Confirm]" using `grid-template-columns` transition so it slides in (no height animation). On Confirm, `POST /api/projects/:id/archive` and on success, navigate `window.location.href = "/"` (back to launcher; the project is now hidden).

- [ ] **Step 2:** Visual verification with chrome-devtools-mcp.

- [ ] **Step 3:** Commit.

### Task 4.4: Launcher "Archived Projects" entry

**Files:**
- Modify: `src/components/Launcher.tsx`

- [ ] **Step 1:** In the Recent Projects section header (the `flex items-center justify-between mb-5` block around `Launcher.tsx:3631`), add a small text link next to the count: `text-[11px] text-cc-muted/50 hover:text-cc-primary cursor-pointer`. Label: "Archived" — only render if `archivedCount > 0` (fetch `/api/projects?archived=true` once on mount, store the count). Click toggles a local `showArchived` state.

- [ ] **Step 2:** When `showArchived` is true, render a second compact list below the main one — same `ProjectCard` `variant="compact"` but with a Restore action. Restore = `POST /api/projects/:id/restore` then refresh both lists.

- [ ] **Step 3:** Visual verification with chrome-devtools-mcp.

- [ ] **Step 4:** Commit.

---

## Phase 5 — Quick-resume affordance on launcher cards

### Task 5.1: Split ProjectCard click semantics

**Files:**
- Modify: `src/components/ProjectCard.tsx`
- Modify: `src/components/Launcher.tsx` (passes `quickResume` callback)

- [ ] **Step 1:** Today the entire card is an `<a href="/?project=...">`. Split it: card body (cover + name + description) keeps the project URL. The bottom meta row containing `<SessionMeta>` (`ProjectCard.tsx:104-112` for Featured, `:140-145` for Compact) becomes a separate `<button>` rendered inside the card with `position: relative; z-index: 1` and `stopPropagation` on click. On click of that row, call into a `quickResume` callback.

- [ ] **Step 2:** `Launcher.tsx` defines `quickResume(project)` — finds the latest session in `project.modeBreakdown`'s first mode (or `project.modeBreakdown[0]`'s most-recent session — either is fine; the data already returns sessions sorted by `lastAccessed` desc when joined). Calls `POST /api/launch` with `{specifier: mode, workspace: project.root, project: project.root, sessionId: latestSessionId}` then redirects.

- [ ] **Step 3:** When the project has zero sessions, the bottom row shows "No sessions yet" (already does) and is non-interactive — fall back to the card body click which lands the user on empty shell where they can start one.

- [ ] **Step 4:** Visual verification: confirm the hot-zone split is unambiguous to a first-time user. The bottom row should have a hover treatment distinct from the card body (slight `bg-cc-hover/30` on its own; the card body keeps its own border-color hover). Two distinct hover regions communicate the split.

- [ ] **Step 5:** Commit.

---

## Phase 6 — Polish + visual verification

### Task 6.1: End-to-end golden path verification

**Files:** none (verification only)

- [ ] **Step 1:** Start `bun run dev`. With chrome-devtools-mcp, walk:
  1. Launcher → click project card body → land on empty shell with panel auto-open.
  2. From panel, click an existing session → land in active project session, ProjectChip visible in header.
  3. Click ProjectChip → panel reopens overlaying the editor.
  4. Click "+ New mode session" → spawns a new mode session in the project.
  5. Trigger handoff between modes; confirm HandoffCard appears and confirm-routing works.
  6. From a launcher project card, click the mode-breakdown row → land directly in the latest session of that mode.
  7. Archive a project → confirm it disappears from the main list and appears under "Archived". Restore → it returns.

- [ ] **Step 2:** Take screenshots of each step; verify visual cohesion (chip strip looks like one composed identity, not three pasted-in pills; panel feels like it belongs to the editor chrome).

- [ ] **Step 3:** Light mode pass — empty shell uses session-dark (it's a session shell, just one without an active session — feels of-a-piece with the editor). Confirm no `launcher-light` class leaks onto the empty-shell root.

### Task 6.2: Final type check + test suite

**Files:** none

- [ ] **Step 1:** `bun run build` — green.
- [ ] **Step 2:** `bun test` — entire suite green; baseline before this branch was 830 pass / 0 fail per the summary.
- [ ] **Step 3:** Update `CLAUDE.md` if the empty-shell rendering path or ProjectChip warrants a Known Gotcha entry. Likely candidate: "App shell mounts without `modeManifest` when `?project=…` and no session — gate any TopBar feature on `s.modeViewer` presence."
- [ ] **Step 4:** Commit.

---

## Acceptance criteria recap (from pivot doc §8)

- [ ] Clicking a project card body lands on empty shell with panel auto-open. No "loading project" intermediate page.
- [ ] Project Panel shows identity, sessions grouped by mode, and actions (Evolve, Edit, Archive).
- [ ] Inside an active project session, header reads `[Pneuma] [Project ▾] [Mode ▾] [Session ▾]`. Click ProjectChip opens same panel.
- [ ] Quick sessions render `[Pneuma] [Mode ▾] [Session ▾]` (no Project chip).
- [ ] Archive flow works: confirm in panel → project hidden from main list → revealed via Archived entry → restore returns.
- [ ] Launcher card includes a quick-resume affordance bypassing empty shell.
- [ ] No `ProjectPage` component or distinct `?project=` route handler remains.
