---
paths:
  - "modes/**"
---

# Mode Authoring Rules

## Baseline

- **Creating a new mode?** Use the `create-mode` skill (`.agents/skills/create-mode/`) — discovery interview → design brief → skeleton. Do not hand-roll the structure.
- **`manifest.ts` must have no React imports** — it is read by both the Bun backend and the frontend. React bindings live in `pneuma-mode.ts` (`ModeDefinition = { manifest, viewer }`); that split exists on purpose.
- **Hidden modes**: `hidden: true` removes a mode from user-pickable lists (launcher grids, ProjectPanel tiles). Internal modes (`evolve`, `project-evolve`, `project-onboard`, `project-tidy`) are hidden — triggered by UI affordances or programmatically only.
- **Shared assets**: global skills in `modes/_shared/skills/` (e.g. `pneuma-preferences`); shared scripts in `modes/_shared/scripts/` opted in via `SkillConfig.sharedScripts`, copied per-mode at install. Share *script sources* across modes, not SKILL.md guidance — each mode owns its own skill text.
- **Language**: source and mode skills use English; Chinese seed/showcase exceptions follow AGENTS.md. Wordtaste model-facing Chinese follows its verbatim-human-quote contract; see the prompt-ownership reference below.

- **Harness portability**: every mode `skill/SKILL.md` needs YAML `name` (matching `skill.installName`) and a concise `description` with a use condition. Resolve helper paths from the loaded skill directory; do not hardcode `.claude/skills`. Read injected blocks from the active instructions file (`CLAUDE.md` or `AGENTS.md`). Essential workflow policy must also work without Claude's native `Workflow` / `Task` tool names.

## Before changing a mode

- Apply the root product and architecture guidance and Engineering Judgment.
  Establish the domain invariants and state writers before choosing a Source
  kind, new action, or shared abstraction.
- Mode skill updates require a manifest version bump, a matching `changelog`
  entry, and a search for old version literals in tests. This applies to mode skills;
  repository development skills use the shared guidance check.
- A viewer change also reads [frontend rules](frontend.md). For observation,
  launch your own `--viewing` session: attaching a browser to an editing session
  can deliver notifications that cause the agent to change files.
- `hidden: true` modes remain internal across mode pickers and session lists.
  `scanProjectSessions` marks their sessions `internal`; user-facing lists must
  filter them. Named UI actions and programmatic launches can still use them.
- Plotwise's style catalog (`modes/plotwise/viewer/styleCatalog.ts` + `style-thumbs/`)
  mirrors `skill/references/styles.md`: a card pitch is the short form of the entry's
  "Best for", and `__tests__/style-board.test.tsx` fails when the roster, its order or
  a narration mode drifts. Change both together.
- Keep essential workflow policy in the mode skill for harnesses without a
  workflow runner. Put repeatable mechanics and bounded retry behavior in scripts;
  report missing, failed, or uncertain results explicitly.

## Read the matching implementation records

Read the linked section before changing or verifying that concern. Records keep
incident evidence and corrections together. Several Plotwise and Wordtaste
records describe earlier implementations; read the active mode skill and code
before applying an old command, endpoint, or prompt recipe.

| When working on | Read |
|-----------------|------|
| Viewing sessions, editing flags, test-workspace protection | [Observation and session lifecycle](../references/mode-gotchas.md#observation-and-session-lifecycle) |
| Seed galleries, skill versions, templates, showcase files, upstream sync | [Authoring and distribution](../references/mode-gotchas.md#authoring-and-distribution) |
| API credentials, worktree environments, Bun dotenv behavior | [Credentials and script environments](../references/mode-gotchas.md#credentials-and-script-environments) |
| Shell pipelines, Unicode, status-code parsing | [Shell portability](../references/mode-gotchas.md#shell-portability) |
| Wordtaste planning, writer prompts, chapter/asset ownership | [Wordtaste prompt ownership](../references/mode-gotchas.md#wordtaste-prompt-ownership) |
| Workflow results, interactive pipelines, retries, queues, background processes | [Workflow execution and recovery](../references/mode-gotchas.md#workflow-execution-and-recovery) |
| Image/video generation, knowledge figures, audio, transcript QA, sprite alignment, headless Blender, GLB cleaning, WebGL capture | [Media generation and validation](../references/mode-gotchas.md#media-generation-and-validation) |

Keep this file focused on authoring rules and routing. Add detailed evidence to
the matching reference section and identify its mode/version scope; an incident
in one mode does not establish a universal product constraint.
