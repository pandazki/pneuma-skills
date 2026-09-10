# Pneuma Skills

> **Single source of truth for agent instructions.** Claude Code reads this via the one-line `@AGENTS.md` import in `CLAUDE.md`; Codex and Kimi read this file directly. Never duplicate content into `CLAUDE.md` — it must stay a single import line.
>
> This startup guide stays below 24 KiB so Codex can read it within its default instruction budget. Architecture details live in [Project Guide](docs/reference/project-guide.md). Before editing, read the matching domain rules below; their contents are shared by both harnesses.

## Project Overview

Pneuma Skills is co-creation infrastructure for humans and code agents. Agents edit files directly (Read/Edit/Write); files remain the canonical collaboration surface. Viewers are live **players** for agent output, rendering work in domain terms (a deck, a board, a project) so humans can watch, intervene in the UI, or hand structured guidance back. Four pillars: a **visual environment** (live players with optional participation), **skills** (domain knowledge + seed templates + session persistence), **continuous learning** (evolution agent for cross-session preference extraction), and **distribution** (mode marketplace, publishing, sharing). Multiple agent backends (Claude Code, Codex, Kimi CLI) selected at startup.

**Formula:** `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`

**Version:** 3.47.3
**Runtime:** Bun >= 1.3.14 (required, not Node.js)
**Builtin Modes:** `webcraft`, `doc`, `slide`, `draw`, `diagram`, `illustrate`, `remotion`, `gridboard`, `kami`, `clipcraft`, `cosmos`, `wordtaste`, `bansho`, `eli5`, `plotwise`, `sprite`, `mode-maker`, `evolve`, `project-evolve`, `project-onboard`, `project-tidy`

> Modes can set `hidden: true` to disappear from user-pickable lists (launcher grids, ProjectPanel mode-tile picker). Their sessions are also stamped `internal: true` by `scanProjectSessions` and filtered out of user-facing session lists (project panel, project cards, quick-resume). Internal modes (`evolve`, `project-evolve`, `project-onboard`, `project-tidy`) are hidden — triggered by specific UI affordances or programmatically, never by a "what mode to start?" choice.

## Development Toolchain

`AGENTS.md` is the common startup guide. `.agents/skills/` holds the canonical
repository skills; Claude entries link or route to the same files. Domain rules
remain in `.claude/rules/` so Claude's path-based loading keeps working. Codex
reads those same rule files explicitly — a `.claude` pathname does not make the
content Claude-only. Do not maintain a second copy of a skill or rule.

### Rules — read before editing

| You are editing… | Read first |
|------------------|-----------|
| `src/**`, `modes/*/viewer/**` | [frontend](.claude/rules/frontend.md) |
| `server/**`, `bin/**`, `core/**`, `snapshot/**`, `plugins/**` | [server](.claude/rules/server.md) |
| `modes/**` (manifest / skill / seeds) | [modes](.claude/rules/modes.md) |
| `backends/**`, `templates/agent-commands/**` | [backends](.claude/rules/backends.md) |
| `**/__tests__/**`, `*.test.ts(x)` | [testing](.claude/rules/testing.md) |
| `desktop/**` | [desktop](.claude/rules/desktop.md) |

Read every applicable row, including when the task expands into another domain.
Record newly discovered gotchas in the matching rule file. Rules apply equally
whether auto-loaded by Claude or explicitly read by Codex.

### Skills and command entry points

| Task | Claude Code | Codex | Shared procedure |
|------|-------------|-------|------------------|
| Create or fork a mode | `/create-mode` | `$create-mode` | [.agents/skills/create-mode/SKILL.md](.agents/skills/create-mode/SKILL.md) |
| Substantial development / review | `/dev-workflow` | `$dev-workflow` | [.agents/skills/dev-workflow/SKILL.md](.agents/skills/dev-workflow/SKILL.md) |
| Version bump and release | `/bump` | `$bump` | [.agents/skills/bump/SKILL.md](.agents/skills/bump/SKILL.md) |
| Showcase materials | `/showcase` | `$showcase` | [.agents/skills/showcase/SKILL.md](.agents/skills/showcase/SKILL.md) |
| Architecture decision record | `/create-adr` | `$create-adr` | [.agents/skills/create-adr/SKILL.md](.agents/skills/create-adr/SKILL.md) |

After changing repository guidance, run `bun run check:guidance` to verify the
startup budget, metadata, and shared entry-point wiring.

Codex also exposes skills through `/skills`. If the active session predates these
files, start a new session to refresh discovery. If a menu is unavailable, read
the linked `SKILL.md` directly and follow it for the user's request. Do not assume
Claude custom command files are discovered by Codex. Release/showcase/ADR skills
are explicit-invocation entries; a mention in a bug report is not a request to run
that procedure.

### Roles and workflow execution

The `dev-workflow` skill owns the shared **implement → review + verify → amend**
procedure and the explore / architect / implementation / amendment role guides.
`.claude/agents/` contains native Claude metadata plus pointers to those guides;
Codex reads the same guides using the tools available in its session. Work locally
by default; the roster's existence alone does not request delegation.

Claude's optional `Workflow` runner can automate delegated waves using
`.claude/workflows/dev-master-orchestrator.js`; its arguments and engine routing
live in `.claude/workflows/README.md`. Without that tool, follow the common skill
with ordinary tools. Do not assume Claude model names or native tools exist in
another harness. Keep the review/verification bar and report any missing evidence.

### Reference routing

| Need | Read |
|------|------|
| CLI flags, project structure, architecture, contract directory, runtime lifecycle | [Project Guide](docs/reference/project-guide.md) |
| Viewer ↔ agent ↔ server messages, actions, addresses, selection | [Viewer–Agent Protocol](docs/reference/viewer-agent-protocol.md) |
| Files owned by Pneuma, sessions, projects, preferences, persistence | [Controlled State Surface](docs/reference/controlled-state-surface.md) |
| Ports, WebSockets, launcher child processes | [Network Topology](docs/reference/network-topology.md) |
| Backend dialect and lifecycle quirks | `backends/<name>/README.md` |
| Architectural rationale / new decisions | [ADR index](docs/adr/README.md) |

Read the relevant sections when the task needs them; do not preload the entire
reference library. Contract changes update the contract directory in Project Guide.

## Coding Conventions

- **TypeScript strict**, ESNext modules, bundler resolution
- **Bun APIs** over Node.js (Bun.spawn, Bun.file, etc.)
- **Contract-first**: contract changes → update `core/types/` + `core/__tests__/` + `docs/reference/` + the contracts table in `docs/reference/project-guide.md`, in the same change. Recurring concepts get lifted to the protocol layer (thin waist) instead of being solved ad-hoc per feature.
- **No hardcoded mode knowledge** in server/CLI — driven by ModeManifest
- **Backend selected at startup only** — no runtime backend switching in session UI
- **Zustand** sliced store (`src/store/`), mode viewers in `modes/<mode>/viewer/`
- **Design tokens**: "Ethereal Tech" theme via `cc-*` CSS custom properties (deep zinc bg `#09090b`, neon orange primary `#f97316`, glassmorphism surfaces with `backdrop-blur`)
- **English only** in source code — comments, JSDoc, identifiers, commit messages, docs in `core/`, `server/`, `src/`, `backends/`, `bin/`. Chinese allowed only in mode seed templates (`zh-light/`, `zh-dark/`), showcase content, `docs/` archive
- **Visual verification for frontend changes**: After modifying viewer components, CSS, or any UI-facing code, use the available browser tools (`chrome-devtools-mcp` when installed) to screenshot the running dev server and verify before reporting completion. Do not judge visual correctness by reading code alone
- **Conventional commits**: `feat(area): …` / `fix(area): …` / `test(area): …` / `chore: …` — descriptive, explain the why. Never create or push git tags (CI owns releases).

## Release Process

Use the shared `bump` skill for a release. CI (`release.yml`) tags, creates the
GitHub Release, and publishes npm on push to `main`. **Never create or push tags.**

The same commit updates `package.json`, `desktop/package.json` (equal versions),
this file's **Version** line, and `CHANGELOG.md`. Update both `README.md` and
`README.zh.md` when user-facing features or CLI usage changed. `CLAUDE.md` stays
exactly `@AGENTS.md` plus a newline.

Run `bun run check:guidance`, `bun run typecheck`, `bun run test:all`, and
`bun run build` before pushing.
Mode skill updates also bump the mode manifest version with a matching `changelog`
entry; check tests for the old version literal. Validate package size when adding
large assets. Deploy the online player when the release diff affects it — CI does
not deploy that surface. Verify the publishing outcome before reporting success.

The complete checklist, player-deploy paths, package-size limits, and partial
release recovery notes live in
[release-process.md](.agents/skills/bump/references/release-process.md). Read it as
part of every release; do not reconstruct those operational details from memory.
