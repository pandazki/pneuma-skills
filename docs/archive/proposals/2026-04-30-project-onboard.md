# project-onboard — fresh-project initialization mode

> Status: design — implementation under `feat/project-onboard`. Target: Pneuma 3.0 beta.

## Problem

A user creates a Pneuma project against a directory they already care about (their existing repo, design folder, writing project, ...). The first thing they see today is the empty shell — a project chip with no sessions, no project description, no atlas, no cover, an icon that's a generated dotted letter. To make Pneuma useful they have to manually pick a mode, brief the agent, populate project metadata, and hope the agent reads what's already on disk.

We can do better. The directory already has signal: README, logos, package manifest, design files, asset folders. A first-run agent that mines this material and presents a curated discovery report — plus two well-tailored task suggestions — turns the empty shell into a guided "here's where we go from here" moment.

## Goal

When a user lands on a fresh Pneuma project (no sessions yet, project.json present but `onboardedAt` absent), Pneuma auto-launches a one-shot **`project-onboard`** session that:

1. Mines the project directory for existing material — README, logos, palette signals, package manifest, framework hints, asset folders.
2. Surfaces what it found in a high-aesthetic discovery report rendered in the viewer (left pane).
3. Proposes concrete writes to `project.json` (displayName, description), `project-atlas.md` (anchors, conventions, open threads), and `cover.png` (using an existing logo if one fits — never fabricated).
4. Recommends **two** next-step tasks tailored to (a) what the project looks like and (b) which API keys the user has configured.
5. On user click of a task card: applies the writes, marks the project as onboarded, and emits a Smart Handoff to spawn the chosen task in the right mode.

This mode is **single-shot** — once the project is onboarded, the empty shell is replaced by a normal project view. A "Re-discover" button in the ProjectPanel re-runs onboarding when the user wants a refresh.

## Locked decisions

### Mode name + visibility

`project-onboard`. Hidden from the user-facing mode list (launcher's Built-in Modes section, ProjectPanel's mode picker, anywhere else modes are surfaced for human selection). Only Pneuma itself triggers it — auto on fresh project, manual via the Re-discover button.

Implementation: new `hidden?: boolean` field on `ModeManifest`. Filter applied in `core/mode-loader.ts`'s exported list and at every UI surface that renders a mode picker. `evolve`, `project-evolve`, and `project-onboard` all flagged `hidden: true` in the same PR — the existing two are already conceptually hidden (only triggered from specific UI affordances), so the flag legitimizes that pattern.

### Auto-trigger

`project.json` gains an optional field:

```ts
interface ProjectManifest {
  // ... existing fields
  onboardedAt?: number; // ms epoch, set by project-onboard's apply step
}
```

The `?project=<root>` URL (no session) routes to:
- `EmptyShell` (current behavior) if `onboardedAt` is set OR if `sessions/` already has any entry (legacy projects, post-onboarded projects)
- `project-onboard` auto-launch otherwise (fresh project, never onboarded)

Auto-launch is fire-once-per-page-load — refreshing the page on a fresh project re-enters the same (or resumed) project-onboard session, not a new one each time.

The ProjectPanel gains a "Re-discover" button (small, inside the project meta area) that always spawns a new project-onboard session, regardless of `onboardedAt`. This is the escape hatch for "the project changed, re-mine it" or "I dismissed the onboarding too fast and want to try again".

### Viewer shape

Custom — does not reuse `EvolutionPreview`. Lives at `modes/project-onboard/viewer/OnboardPreview.tsx`.

Single-page layout, top to bottom:

1. **Hero band** — proposed cover (large, framed) + proposed display name + proposed one-line description. Each piece has a "this is auto-detected, edit if wrong" affordance.
2. **Anchors found** — bullet list / card grid of what the agent extracted (brand colors, conventions, existing assets, framework hints). Each anchor cites its source ("from `README.md` line 12", "from `assets/logo.svg`").
3. **Open questions** (if any) — things the agent flagged as ambiguous, surfaced for the user.
4. **What's next** — two large task cards. Each card carries: task title, target mode, time estimate, one-paragraph rationale anchored on what was found, and a primary action button.
5. **Footer controls** — `Apply only (no task)` to commit the writes without spawning a task, or `Skip` to dismiss and go to the empty shell.

Aesthetic regulator: the `project-onboard` viewer is the **first impression** of Pneuma for a new project. It needs to look better than the average mode viewer. Reuse the project's `cc-*` design tokens (deep zinc bg, neon orange accent, glassmorphism) but elevate spacing, typography, and detail polish. No icons-as-emoji; SVG only. No info dumps; every line earns its place.

### Proposal/apply mechanism

Reuse the evolve pattern, but the proposal is one structured object (not a stream of independent proposal files).

The agent writes a single `proposal.json` in `<sessionDir>/onboard/`:

```jsonc
{
  "schemaVersion": 1,
  "project": {
    "displayName": "...",
    "description": "...",
    "coverSource": "/abs/path/to/existing/logo.svg" | null
  },
  "atlas": "<full markdown body for project-atlas.md>",
  "anchors": [
    { "label": "Brand", "value": "deep navy + warm orange", "source": "assets/logo.svg" },
    ...
  ],
  "openQuestions": [
    "README mentions Phase 2 launch but no date — is this active?"
  ],
  "tasks": [
    {
      "title": "A precise project introduction page",
      "targetMode": "webcraft",
      "timeEstimate": "~30min",
      "rationale": "...",
      "handoffPayload": {
        "intent": "Build a one-page intro site...",
        "summary": "...",
        "suggestedFiles": ["README.md", "assets/logo.svg"],
        "keyDecisions": ["Use existing brand palette", ...],
        "openQuestions": []
      }
    },
    { ...second task... }
  ],
  "apiKeyHints": {
    "missingButRecommended": ["openrouter"], // null if everything's already configured
    "rationale": "..."
  }
}
```

The viewer reads `proposal.json`, renders the report, lets the user edit fields inline (committed back to the same file), and exposes apply controls.

Apply step (server-side, triggered by viewer):
1. Write `project.json` (displayName, description, onboardedAt).
2. If `coverSource` is set and is an image file, copy it to `<root>/.pneuma/cover.png` (resize to 512×512 max long edge if needed).
3. Write `<root>/.pneuma/project-atlas.md` from the atlas field.
4. If a task was clicked: emit Smart Handoff with the chosen `handoffPayload`. Otherwise no-op (apply-only).

### Two-task recommendation logic

Mode skill teaches the agent to choose two tasks based on:

| Signal | Recommended directions |
|---|---|
| No API keys configured | webcraft static intro page; remotion type-driven hero (≤ 30s) |
| OpenRouter / fal.ai key present | illustrate one-shot visual; webcraft with AI-generated configurations; kami paper-style poster |
| fal.ai (video gen) present | clipcraft short / longer remotion |
| Project has clear visual brand (logo + palette) | webcraft prioritized — extend existing aesthetic |
| Project is library / dev tool | remotion tech-explainer or webcraft docs landing |
| Project is creative / personal | kami visual essay or illustrate gallery |

The mode skill gives the agent a `sweet-spot.md` reference (in the mode skill's `references/`) with examples of well-tailored task pairings. The agent's job is to pick two that are achievable AND visibly delightful given the configured keys.

**Hard rule**: do not recommend a task that requires an API key the user hasn't configured. Failing-out-of-the-gate is the worst possible onboarding outcome.

### API key prompt

If the agent's task selection logic identifies "the user would benefit from key X but doesn't have it", the proposal's `apiKeyHints` is populated. The viewer renders a soft prompt above the task cards: "Adding an OpenRouter key would unlock: AI-generated illustrations for this project's intro page" with a one-click form that writes to `~/.pneuma/api-keys.json`.

Skipping is fine. The form is friendly, not blocking. The two task cards always work without keys (per the hard rule above) — the prompt is purely "you could have a third option".

## Out of scope (not in this PR)

- Replacing the `EmptyShell` for already-onboarded projects (it's still the right surface when onboarding has run and there's just no active session).
- Evolution config for `project-onboard` itself — the mode is single-shot per project; it doesn't accumulate learnings to evolve.
- Localizing the viewer — English only for v1 (matches the rest of the codebase).
- Running on remote/cloud-hosted projects — local fs only.

## Implementation phases

1. **Design doc** (this file) — locked decisions reviewable in one read.
2. **`hidden: true`** — manifest field + filter at all mode-list surfaces. Mark `evolve`, `project-evolve`, `project-onboard` (once defined) as hidden.
3. **Mode skeleton** — `modes/project-onboard/{manifest.ts, skill/SKILL.md, viewer/OnboardPreview.tsx}`. Skill teaches the discovery + proposal + recommendation logic. Viewer renders the report.
4. **Auto-trigger** — `project.json.onboardedAt`; project URL routing decision; ProjectPanel "Re-discover" button.
5. **Apply hook** — server route that consumes the proposal, performs writes, optionally emits handoff. Reuses existing handoff infrastructure.
6. **API key prompt** — optional viewer affordance.
7. **Dogfood** — run on `advanced-agentic-dev-patterns`, `vibe-skills`, `nemori`. Tune skill heuristics + viewer polish.

## Acceptance criteria for 3.0 beta gate

A user with no Pneuma exposure can:

1. Run `pneuma project create ~/my-existing-repo` (or open an existing one).
2. See a beautiful discovery report appear within ~30s.
3. Recognize their own project in the auto-detected metadata (name + description match what they would have written).
4. See a cover that's either their existing logo or the dotted-letter fallback (never a fabricated one).
5. Click one of the two task suggestions.
6. End up in a productive mode session with the brief already loaded — and the task gives them something visibly delightful within 5 minutes.

If any of these breaks for a reasonable test project, the gate isn't green.
