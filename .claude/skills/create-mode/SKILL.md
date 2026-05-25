---
name: create-mode
description: Author a new Pneuma mode end-to-end — manifest + viewer + skill + seed + showcase. Use this skill whenever the user says they want to create a new mode, fork an existing one for a different domain, scaffold mode files, design a new viewer, or asks "how should I build a mode for X". Walks the user through a discovery interview, produces a design brief that names every key choice (Source kind, ViewerAddress vocabulary, action space, seed strategy, external integrations, evolution directive), and only then generates the directory skeleton. Encodes the practice rules pulled from webcraft / slide / diagram / illustrate / remotion / kami. Pneuma Skills project only; Claude Code only.
---

# Create Mode

A guided journey for adding a new mode to Pneuma Skills. The journey has **three phases** — Discovery (ask the right questions), Brief (write down every key choice with rationale and get the user's confirmation), Implementation (generate files). Each phase has a clear handoff to the next; **never skip Brief**. Pneuma already has twelve modes and a stable contract layer; the cost of a thoughtful 10-minute design brief is much smaller than the cost of building the wrong viewer.

The reference material in `references/` is where the **knowledge** lives — go read the relevant one whenever you're about to make a meaningful decision. SKILL.md is the **journey**, not the textbook.

---

## When to use

Trigger this skill when the user asks for any of:

- "create a new mode for X"
- "fork slide / webcraft / … for a different domain"
- "scaffold a mode"
- "add a [mindmap | spreadsheet | timeline | annotator | …] mode"
- "design the viewer for a mode that …"

If the user *only* asks about an existing mode's behavior, this skill is **not** the right tool — direct them to `docs/reference/viewer-agent-protocol.md` or the mode's own SKILL.md.

---

## Phase 1 — Discovery interview

Goal: extract enough signal that you can fill every field of the design brief without further interrogation. Ask **one question at a time** with `AskUserQuestion`; let each answer shape the next. Don't dump a 20-question survey on the user.

### Discovery questions (ask in this order, branch as noted)

1. **Identity** — name (kebab-case), one-line displayName, two-line description, intended icon style. *This is the only question you can pose as a single multi-line form.*
2. **Domain in one sentence** — what is the user creating with this mode? A document? A canvas of objects? A timeline? Let the user answer free-form before you offer Source-kind options. Read `references/domain-and-sources.md` while they think.
3. **Inspiration vs original** — does this mode borrow content (commands, references, design language, taxonomy) from an existing tool, library, or project? If yes, ask the upstream's name + URL + license. This determines whether you'll write `NOTICE.md` and set `inspiredBy`. Read `references/external-integrations.md` for the borrow-vs-inspiration line.
4. **Source kind** *(branch on Q2 + Q3)* — present `file-glob` / `json-file` / `aggregate-file` / `memory` with the one that fits Q2's domain pre-selected as "Recommended". Explain *why* it fits in the option's `description`. If `aggregate-file` wins, note that you'll also generate `domain.ts`.
5. **Workspace model** *(when Q4 is not `memory`)* — `"all"` / `"manifest"` / `"single"`; do users author many independent files, an ordered/structured set, or one main document? See `references/viewer-contract-patterns.md` for the FileWorkspaceModel matrix.
6. **ViewerAddress vocabulary** — "what's the smallest thing the user can point at?" Propose a draft `{ contentSet?, ... }` based on Q2's domain noun (slide / page / row / node / heading). Confirm with the user; explicitly name the coarse "where" key and any fine "within" key. See `references/viewer-contract-patterns.md::ViewerAddress`.
7. **Initial action space** — propose 2–5 actions with id / label / category / agentInvocable. Almost every viewer needs a `navigate-to` (navigate); add `ui` and `custom` only if the user names a concrete need. Don't list `capture` — it's framework-built-in.
8. **External integrations** *(conditional — only ask if Q2 or Q3 implied an external API / SDK / CDN / library / API key)* — does the viewer fetch external APIs (→ `proxy`)? does the agent or viewer need API keys (→ `init.params` with `sensitive: true` + `envMapping`)? does this need an MCP server (→ `skill.mcpServers`)? Read `references/external-integrations.md` for the proxy / Babel-JIT / NOTICE patterns.
9. **Seed strategy** — single file, multiple use-case content sets, or language×theme matrix? What's the *first* seed's narrative — what story does it tell to a brand-new user? See `references/seed-and-showcase.md`.
10. **Evolution directive** — give the evolve agent a one-sentence "what should it learn for this mode?" (e.g., "Learn the user's slide design preferences: typography, palette, density, structure"). This is what makes the mode personalize over time.

### What to read while interviewing

| When you're about to ask … | Read first |
|---|---|
| Q2 / Q4 (domain → source kind) | `references/domain-and-sources.md` |
| Q5 / Q6 / Q7 (workspace / address / actions) | `references/viewer-contract-patterns.md` |
| Q3 / Q8 (inspiration / external deps) | `references/external-integrations.md` |
| Q9 (seed strategy) | `references/seed-and-showcase.md` |
| Q10 (evolution directive) | `references/skill-md-patterns.md` (evolution section) |

If you ever find yourself stuck choosing between two patterns, open `references/case-studies.md` — it indexes which existing mode made which choice, so you can read that mode's manifest as a concrete precedent.

---

## Phase 2 — Design brief & user confirmation

Goal: write down **every key choice** with a one-line rationale, in *one place*, and get the user's explicit yes before any file is written. The brief is what you'll work from in Phase 3 — if a question wasn't resolved here, don't fudge it in Phase 3; loop back to Phase 1.

### Brief structure

Render the brief inline in the conversation (not as a file — the conversation is the canonical place to confirm). Use exactly this structure so you don't drift:

```markdown
# Mode design brief — <displayName>

## Identity
- name: <kebab-case>
- displayName: <string or LocalizedString>
- description: <one sentence>
- icon: <SVG approach: e.g. "lucide-style line icon, single path">

## Domain
<one paragraph — what the user is creating; what the viewer renders; what the agent does>

## Source layer
- kind: <file-glob | json-file | aggregate-file | memory>
- domain type T: <the TypeScript type the viewer subscribes to, sketched>
- why this kind: <one sentence — see references/domain-and-sources.md>
- domain.ts needed: <yes | no>

## Workspace model
- type: <"all" | "manifest" | "single">
- multiFile: <true | false>
- ordered: <true | false>
- hasActiveFile: <true | false>
- supportsContentSets: <true | false>

## ViewerAddress vocabulary
- coarse keys: <e.g. `contentSet?`, `slide`>
- fine keys: <e.g. `selector?`, `anchor?`>
- example address: `{ contentSet: "en-light", slide: 3 }`
- documented in: skill/SKILL.md (will write a sub-section)

## Action space
| id | label | category | agentInvocable | params |
|----|-------|----------|----------------|--------|
| navigate-to | Go to … | navigate | true | { address: object } |
| … | … | … | … | … |

(framework provides `capture` automatically — not listed)

## Seed strategy
- shape: <single | content-sets-by-use-case | language×theme>
- content sets: <list, with each name + one-line purpose>
- first seed narrative: <one sentence>

## External integrations
- proxy: <none | list routes>
- init.params: <none | list with sensitive flag>
- skill.mcpServers: <none | list>
- viewer.refreshStrategy: <"auto" | "manual">
- NOTICE.md required: <yes | no — if yes, upstream name + license + version pinned>
- inspiredBy: <none | { name, url }>

## Launcher surface
- visibility: <public (in gallery) | hidden (internal-only, manifest.hidden=true)>
- featured-eligible: <yes (default; showcase highlights present) | no (no showcase or hidden mode)>

## Evolution directive
> <one sentence to the evolve agent>

## Open questions / deferred
- <anything we punted on; e.g. "showcase imagery defers to /showcase">
```

### Confirmation gate

After rendering the brief, ask plainly: **"Does this brief look right? Anything to change before I generate files?"** If the user adjusts anything, update the brief inline and re-confirm. **Do not start Phase 3 without an explicit "go" / "yes" / equivalent.**

---

## Phase 3 — Implementation

Once the user confirms the brief, generate files in this order. Use templates from `assets/templates/`; replace the `TODO:` placeholders against the brief. Don't ad-lib structure — the templates encode the conventions extracted from existing modes.

### Step 1 — Scaffold the directory

```
modes/<name>/
├── manifest.ts          ← from assets/templates/manifest.ts.template
├── pneuma-mode.ts       ← from assets/templates/pneuma-mode.ts.template
├── domain.ts            ← only if Source kind is aggregate-file; from domain.ts.template
├── skill/
│   └── SKILL.md         ← from assets/templates/SKILL.md.template
├── seed/
│   └── <content sets per brief>
├── viewer/
│   └── <ModeName>Preview.tsx   ← scaffold a stub PreviewComponent
└── showcase/
    └── showcase.json    ← from assets/templates/showcase.json.template (with concept descriptions)

NOTICE.md                ← only if brief said "NOTICE.md required: yes"; from NOTICE.md.template
```

### Step 2 — Wire up file-by-file

For each file, fill in templates against the brief. Specifics:

- **manifest.ts** — every brief field maps to a manifest field. The template has marked sections (`// TODO: identity`, `// TODO: sources`, etc.) — fill each from the brief. Don't add fields the brief doesn't have; brevity over completeness for v0.1.0.
- **pneuma-mode.ts** — the `ModeDefinition` binding: import manifest, wire it to a stub `ViewerContract` that imports the PreviewComponent and implements `extractContext`, `workspace.resolveItems`, `workspace.createEmpty`. See `references/viewer-contract-patterns.md::pneuma-mode.ts` for the binding pattern.
- **domain.ts** (aggregate-file only) — write the `load(files) → T | null` and `save(value, current) → { writes, deletes }` pair as pure functions. Read existing modes' `domain.ts` for the pattern (slide / illustrate / kami use this).
- **skill/SKILL.md** — follow `references/skill-md-patterns.md`: Scene → Viewer Contract → Core Rules → Workflow → Commands → References. Include a `## ViewerAddress vocabulary` sub-section that names every key from the brief and a one-line meaning per key.
- **viewer/`<Name>Preview.tsx`** — stub. Renders a placeholder ("Mode initialized — start authoring"). Imports the Source from `props.sources` via `useSource`. The user (or you in a follow-up) will flesh this out.
- **seed/** — write the first content set's files per the brief's narrative.
- **showcase/showcase.json** — from template, with brief's tagline + 3 highlight concept descriptions. *Images are generated in Step 4.*
- **NOTICE.md** *(if required)* — pin upstream name + URL + license + version + sync date; include the "what we borrowed / what we adapted / what we dropped" mapping table. Template at `assets/templates/NOTICE.md.template`.

### Step 3 — Register the mode (three places, all required)

A new builtin mode needs to be registered in **three** separate
files for the runtime to find it. Skipping any one leaves it in a
half-installed state — the dev server might run, but the launcher
won't list it, or imports will fail in the frontend bundle. The
three files are deliberately separate because they're consumed by
different processes (backend / frontend / docs).

Before adding code, ask the user whether the mode should appear in
the launcher gallery at all, or be **hidden** (internal-only, like
`evolve`, `project-evolve`, `project-onboard`). Hidden modes still
need the first two registrations below but skip the README +
gallery treatment.

#### 3a. Frontend dynamic-import registry — `core/mode-loader.ts`

Add an entry to the `builtinModes: Record<string, ModeSource>` map
so the frontend can dynamic-import the mode's manifest and viewer.
Without this, the mode 404s when a user opens its URL ("Unknown
mode: <name>").

```ts
// core/mode-loader.ts — inside `const builtinModes = { ... }`
<name>: {
  loadManifest: () => import("../modes/<name>/manifest.js").then((m) => m.default),
  loadModeDefinition: () => import("../modes/<name>/pneuma-mode.js").then((m) => m.default),
},
```

#### 3b. Launcher gallery registry — `server/index.ts`

Add the mode's name to the `builtinNames` array (search for `const
builtinNames = [...]`). This array drives `/api/registry`, which
the launcher's marketplace UI and ProjectPanel's mode-tile grid
both consume. **Skipping this is the #1 way a freshly-built mode
silently fails to appear in the launcher gallery** even though
`bun run dev <name>` works fine.

```ts
// server/index.ts — search for "const builtinNames"
const builtinNames = [..., "<name>"];
```

The launcher filters out modes whose manifest declares
`hidden: true`, so hidden modes go in the array but get hidden at
render time. (Authoring choice: include them so the omission-list
pattern stays out of code.)

#### 3c. Docs — `CLAUDE.md` and `AGENTS.md`

Add the mode name to the `**Builtin Modes:**` line in `CLAUDE.md`,
then `cp CLAUDE.md AGENTS.md` (they must be byte-identical per the
release contract). If the mode is **not hidden**, also add a row to
README's "Built-in Modes" table. Hidden modes don't go in the
README.

#### Featured vs. hidden — confirm with the user

After the three registrations land, ask the user one more question:

> Should I propose this mode be eligible for the launcher's
> featured slot? The launcher randomly picks one builtin with
> showcase highlights to feature on its main page. Saying yes
> means we'll make sure `manifest.hidden` stays unset (default)
> and that `showcase.json` has at least one highlight. Saying no
> means we should set `hidden: true` in the manifest so the mode
> exists but doesn't surface in the gallery.

Record their answer in the design brief's "Featured" line. Today's
launcher has no per-mode pin (any showcase-bearing builtin gets a
random chance); a "always feature this one" affordance would be a
v0.4 enhancement and shouldn't block mode creation.

### Step 4 — Generate showcase imagery

Hand off to the existing showcase workflow. Read `.claude/commands/showcase.md` and execute its **Step 3 (Generate Showcase Images)** for the new mode — hero + 3 highlight images, 1376×768, "Ethereal Tech Dark Mockup" style, saved to `modes/<name>/showcase/`. The descriptions you put in `showcase.json` during Step 2 become the briefs for image generation.

> This is the only Phase-3 step that takes appreciable time. If image generation isn't available right now (no API key, offline), surface that to the user and let them decide whether to defer — `showcase.json` with the right descriptions but missing images is a valid intermediate state.

### Step 5 — Sanity check

Don't claim the mode is ready until you verify these:

1. `modes/<name>/manifest.ts` type-checks against `core/types/mode-manifest.ts` (`bunx tsc --noEmit` runs clean in `modes/<name>/`).
2. `bun run dev <name>` starts without error (you may not be able to run this — if not, say so explicitly and ask the user to verify).
3. **The launcher's `/api/registry` includes the new entry.** Test via `curl -s http://localhost:17996/api/registry | jq '.builtins[].name'` (or whatever port the launcher is on). If the name isn't there, you skipped Step 3b (`server/index.ts builtinNames`) — go fix it before continuing.
4. The launcher's mode gallery shows the new entry (same — say so if you can't run the launcher).
5. There are no lingering `TODO:` comments from the template you didn't address.

---

## Closing principles

These show up in every existing mode; honor them in the one you're creating too.

1. **Domain-first, transport later.** Define the domain type `T` before choosing how it serializes. Source kind is a *consequence* of T, not a prior decision.
2. **One noun for "which object" — `ViewerAddress`.** Every action that takes an object reference, every notification that reports one, every locator card that points to one, must use the *same* address shape. Mode owns the vocabulary; framework owns the slot.
3. **Action space is small.** Two to five actions covers almost every mode. If you're proposing seven, you're either modeling the wrong unit or surfacing UI as actions (Commands → ⑥ — handle there).
4. **`manifest.ts` declares; `pneuma-mode.ts` implements.** Keep the split. Manifest is read by skill-installer + backend; `pneuma-mode.ts` is read by the frontend mode-loader. Don't put React imports in `manifest.ts`.
5. **`SKILL.md` is the agent's project guide for *this* mode** — it follows the same "scene → contract → rules → examples → references" rhythm as the root `CLAUDE.md` does for the project. Put depth in `skill/references/<topic>.md` files, not in the main body.
6. **Borrowed content needs a `NOTICE.md`; borrowed ideas don't.** Direct transcription, license excerpts, command tables, font subsets → declare upstream + license + version. Architectural metaphors, aesthetic direction, workflow philosophy → no notice needed.
7. **Showcase is mandatory, but imagery can defer.** `showcase.json` with descriptions and a tagline is the minimum bar (so the launcher gallery has copy); imagery generation can happen later via the existing `/showcase` flow.

---

## References

Open the matching file when you're about to make the corresponding decision. Don't load them all eagerly — progressive disclosure.

| File | When to read |
|---|---|
| `references/mode-anatomy.md` | First touch — overview of the directory shape, required vs optional files, manifest field matrix |
| `references/domain-and-sources.md` | Picking Source kind, designing domain type T, writing `domain.ts` |
| `references/viewer-contract-patterns.md` | Wiring `ViewerContract`, choosing `ViewerAddress` vocabulary, designing `workspace.resolveItems` |
| `references/skill-md-patterns.md` | Writing `skill/SKILL.md` and the evolution directive |
| `references/seed-and-showcase.md` | Designing seed content sets and `showcase.json` |
| `references/external-integrations.md` | proxy routes, JIT compilation, API-key params, NOTICE.md mechanics |
| `references/case-studies.md` | "Where did <existing mode> make this choice?" — index by pattern, not by mode |

Templates in `assets/templates/` are the concrete files you'll write from. Each template has `TODO:` markers where the brief plugs in.
