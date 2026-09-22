# Pneuma Skills

> **Single source of truth for agent instructions.** Claude Code reads this via the one-line `@AGENTS.md` import in `CLAUDE.md`; Codex and Kimi read this file directly. Never duplicate content into `CLAUDE.md` — it must stay a single import line.
>
> This startup guide stays below 24 KiB so Codex can read it within its default instruction budget. Architecture details live in [Project Guide](docs/reference/project-guide.md). Before editing, read the matching domain rules below; their contents are shared by both harnesses.

## Product and Architecture

Pneuma Skills is co-creation infrastructure for humans and code agents. It turns
an agent's work into a domain-specific environment where a person can watch,
participate, and carry the work forward. Four pillars support this: a **visual
environment**, **skills**, **continuous learning**, and **distribution**.

1. **Shared work, two ways to interact.** Agents use native file tools;
   people see documents, decks, boards, and other domain objects. Files remain
   the canonical surface for persistent work. Viewers consume typed Sources;
   their optional edits return to the same files. Preserve the connection
   between what the user points at, what the agent changes, and the visible
   result. `ViewerAddress` is the shared object-reference contract.
2. **The viewer is a live player for the task.** It renders work as it forms and
   supports direct edits, structured guidance, and inspection where useful.
   Design the experience around the person's task and the domain's units.
   Creation and consumption can have different interactions; partial, waiting,
   and failed states must remain understandable.
3. **A mode packages a way of working.** Its domain model, skill, scripts, seeds,
   viewer, and quality criteria belong together. The framework supplies shared
   contracts and runtime services. Mode-specific knowledge stays in the mode;
   backend-specific knowledge stays behind `BackendModule`. Capabilities are
   explicit, so a backend need not pretend to support another backend's tools.
4. **Spend agent judgment where it matters.** Interpretation, creation, and
   tradeoffs need judgment. Established assembly, validation, scheduling, and
   deterministic interaction paths belong in programs. Put repeatable mechanics
   in scripts and explain their use in skills. Essential workflow policy must
   remain usable across the supported harnesses.
5. **Let collaboration accumulate.** Sessions persist; optional projects connect
   work across modes through shared materials, context, and explicit handoffs.
   Preference skills maintain personal and project memory. Evolution proposes
   evidence-backed additions and removals to guidance for user review. Modes
   can be customized and distributed with their working methods intact.

**Formula:** `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`

**Version:** 3.51.0
**Runtime:** Bun >= 1.3.14 (required, not Node.js)

The mode catalog is in [README.md](README.md#built-in-modes); declarations live
in `modes/*/manifest.ts`. Internal-mode visibility rules live in the mode rules.

### Place responsibility before implementation

| Concern | Starting point |
|---------|----------------|
| Domain knowledge, taste, creative strategy, quality criteria | Mode skill |
| Repeatable execution, assembly, validation | Mode scripts |
| Domain rendering, interaction, user feedback | Mode viewer |
| Shared semantics across capabilities | Core contracts |
| Transport, process lifecycle, persistence mechanisms | Runtime shell / server / CLI |
| Backend dialect, capabilities, installation conventions | `BackendModule` and its implementation |

These are responsibility boundaries, not a requirement to add layers. Extend an
existing seam when it fits; introduce a shared abstraction only for a concrete
contract or demonstrated variation.

## Engineering Judgment

Apply these principles in design, implementation, review, and amendment. Scale
the explanation to the change; routine edits do not need a separate design
document. The development skills operationalize these principles and link here
for their authoritative definition.

### Correctness and boundaries

1. **Invariants before abstractions.** Identify and protect the invariants
   required by the specification and explicit contracts. Verify them; existing
   behavior is evidence, not proof of correctness. An abstraction must isolate
   real variation or carry a clear contract or boundary.
2. **One authority for each concept.** Reuse the authoritative semantic
   definition across capabilities, services, and implementation languages.
   Different representations are justified by different semantics or boundary
   projections; name their mapping and verify consistency. This does not require
   every language or process to share the same executable implementation.
3. **Explicit state and effects.** Name state, its owner and writers, lifecycle,
   failure behavior, and side effects. Shared state must have an explicit scope
   and access contract. Required ordering belongs in an observable protocol or
   control flow; do not depend on hidden globals or incidental call order.
4. **Distinguish recovery, compensation, idempotency, and undo.** Recovery
   restores the ability to proceed; compensation adds an operation to counter
   an effect; idempotency prevents duplicate effects on repetition; undo reverses
   a completed effect within a stated scope. Runtime mediation does not make an
   external effect reversible. Cancellation or timeout does not prove that a
   remote operation never happened. State what can be restored, by whom, and
   what remains uncertain before choosing retry or rollback behavior.
5. **Observable failures and explainable defaults.** Validate and report errors
   at the earliest responsible boundary. Do not silently swallow failures or
   report partial, failed, or uncertain outcomes as success. Recovery and
   degradation need explicit semantics and an observable outcome. Expected
   absence and no-op behavior may be valid when the contract defines them;
   isolating a failure must still preserve the signal to its responsible caller.

### Models and implementation

6. **Start with the smallest correct model.** Satisfy the actual specification,
   boundaries, and verification needs, then extend for demonstrated demand.
   Do not prebuild frameworks, extension points, or options for imagined futures.
7. **Prefer mature implementations that fit.** Inspect existing project code
   and established third-party implementations before building from scratch.
   Reuse must satisfy the specification, boundaries, runtime constraints, and
   verifiability. Build from scratch when suitable existing implementations
   cannot meet those requirements, and explain the concrete gap.
8. **Compose and express behavior directly.** Remove wrappers with no independent
   behavior, contract, or boundary value. A thin adapter that enforces a real
   boundary can earn its place; forwarding alone is not a reason for another layer.

### Complexity and evidence

9. **Complexity must earn its cost.** Identify the real problem and verifiable
   benefit of added complexity. Performance-motivated complexity requires a
   reproducible bottleneck measurement and comparison against the simpler
   baseline. Correctness, isolation, and maintainability benefits need their
   own evidence, such as a failing case, contract test, or concrete dependency
   analysis; they do not require inventing a performance benchmark.

## Development Toolchain

`AGENTS.md` is the common startup guide. `.agents/skills/` holds the canonical
repository skills; Claude entries link or route to the same files. Domain rules
remain in `.claude/rules/` so Claude's path-based loading keeps working. Codex
reads those same rule files explicitly — a `.claude` pathname does not make the
content Claude-only. Longer records in `.claude/references/` are reached through
the rules' topic links, outside the automatically loaded rules directory. Do not
maintain a second copy of a skill or rule.

### Rules — read before editing

| You are editing… | Read first |
|------------------|-----------|
| `src/**`, `modes/*/viewer/**` | [frontend](.claude/rules/frontend.md) |
| `server/**`, `bin/**`, `core/**`, `snapshot/**`, `plugins/**` | [server](.claude/rules/server.md) |
| `modes/**` (manifest / skill / seeds) | [modes](.claude/rules/modes.md) |
| `backends/**`, `templates/agent-commands/**` | [backends](.claude/rules/backends.md) |
| `**/__tests__/**`, `*.test.ts(x)` | [testing](.claude/rules/testing.md) |
| `desktop/**` | [desktop](.claude/rules/desktop.md) |

Read every applicable row, including when the task expands into another domain,
then read the reference sections whose triggers match the work. Rules apply
equally whether auto-loaded by Claude or explicitly read by Codex.

Keep guidance current: record a gotcha's trigger, current rule, and short reason
in the matching domain rule; put longer evidence and incident histories in its
linked references. Give new constraints evidence and an explicit scope. Correct
or retire stale guidance when its assumptions change, preserving useful history
in the references or archive. Check the size of the applicable reading path as
well as the root file; moving prose does not help if every task still loads it.

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

Use source code to verify current behavior and maintained references for contract
semantics. ADRs and archived proposals explain decisions at the time they were
written; check their status and later changes before treating them as current
implementation. When sources disagree, trace the implementation and identify
whether the code or the reference has drifted. Correct stale references; a change
to an accepted architectural decision needs an explicit supersession.

## Coding Conventions

- **TypeScript strict**, ESNext modules, bundler resolution
- **Bun APIs** over Node.js (Bun.spawn, Bun.file, etc.)
- **Contract-first**: contract changes → update `core/types/` + `core/__tests__/` + `docs/reference/` + the contracts table in `docs/reference/project-guide.md`, in the same change. Lift shared concepts into the protocol layer when their concrete consumers justify it.
- **Mode boundaries**: no React imports in `manifest.ts`; frontend bindings live in `pneuma-mode.ts`. No hardcoded mode knowledge in server/CLI — driven by ModeManifest.
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
