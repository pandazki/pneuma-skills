# Perspective lenses — vocabulary for variant tours

A `cosmos.perspectives[]` entry is a *variant tour* through the same
cosmos, framed by one design lens. The lens is the question you're
asking; the manifestsIn list is the walk. This catalog isn't a list
of patterns to find — it's vocabulary for the kinds of question that
have proven worth asking when reading a system, a story, or a
research program.

Read this once. Then forget it. The lenses are most useful when one
surfaces unbidden in front of a fresh cosmos — not when you're
hunting them.

If none of the names below fit a lens you see, **invent**. The
`lens` field on `CosmosPerspective` is open. The vocabulary below
is starter scaffolding, not grammar.

---

## How to read each entry

Each lens below has the same shape:

- **Essence** — one sentence: what the lens is, at root.
- **Where it shows up** — concrete signals across multiple domains.
  The signals are how you *notice* a perspective is worth writing;
  the essence is what you've noticed.
- **Falsification** — what would make this NOT the lens, only an
  apparent one. Helps keep perspectives honest.
- **Example perspective entry** — a sketch of how the variant tour
  might land in `cosmos.perspectives[]`, with `manifestsIn` ids that
  ground the walk.

Skim by name when you feel the gestalt. Read deep when you're trying
to articulate a perspective you almost have.

---

## Orthogonality

**Essence.** A system has two (or more) axes that vary independently —
neither dictates the other, and decisions along one don't propagate
into the other.

**Where it shows up.**
- *Codebase:* a module that's split into "what the data is" vs "where
  the data goes" — both can change without the other.
- *Fiction:* two character arcs that interweave but neither depends
  on the other to resolve.
- *Business:* a service that can change its persistence layer or its
  API surface independently.
- *Research:* an experimental design where two variables are crossed
  rather than nested.

**Falsification.** If A's value forces B's, they're not orthogonal —
they're coupled. The pattern is real when the cross-product space
genuinely has all cells populated, not just a diagonal.

**Example perspective entry**

```json
{
  "id": "perspective-content-vs-presentation-orthogonal",
  "lens": "orthogonality",
  "name": "Content type and presentation surface vary independently",
  "insight": "The mode declares what a Source<T> renders and the persona declares how dense it renders. Either can change without the other — the same KnowledgeGraph T can be rendered at three densities; the same density can wrap any T.",
  "steps": [
    {
      "focus": ["ct-source"],
      "narrative": "Start at the Source<T> contract. It says nothing about *how* T renders — only that the viewer receives a stream of values. Persona doesn't appear here."
    },
    {
      "focus": ["ct-viewer-preview-props"],
      "narrative": "Now look at the props the viewer receives. Persona shows up as a prop alongside sources — separately. The two axes meet here, but only as inputs that travel side-by-side; neither names the other."
    },
    {
      "focus": ["mode-cosmos", "shell-use-source"],
      "narrative": "Watch them combine downstream. The mode picks the T (cosmos picks Cosmos); the shell-side useSource hook supplies value updates; persona threads through the viewer to render at a density. Three lights, one wiring — but the wires never cross."
    }
  ]
}
```

Note how each step focuses on different nodes and tells the user
something specific to that beat — not the thesis repeated. The
last step uses two `focus` ids because the point of step 3 is the
*combination*; both nodes light up so the user reads them together.

---

## Cybernetic loop

**Essence.** A subsystem holds some property (attention, freshness,
correctness) against a known perturbation by sensing → comparing →
correcting in a closed loop.

**Where it shows up.**
- *Codebase:* retry-with-backoff; idempotency keys; reconciliation
  loops; `chokidar` → state diff → re-render.
- *Fiction:* a detective discovering, doubting, refining a theory in
  cycles.
- *Business:* a feedback dashboard whose own state shapes which signals
  it surfaces, which shape decisions, which shape state.
- *Research:* an evaluation loop where measurement informs theory which
  informs the next measurement.

**Falsification.** If there's no comparison step — no point at which the
system *knows* it's off and *acts* to correct — it's a feed-forward
pipeline, not a cybernetic loop. The signature is the **error signal**.

**Example perspective entry**

```json
{
  "id": "perspective-source-origin-loop",
  "lens": "cybernetic-loop",
  "name": "Origin-tagged Source<T> as bidirectional reconciliation",
  "insight": "The Source<T> contract holds the property 'viewer's local state matches disk' by tagging every value event with origin (self/external/initial). When external arrives, viewer reconciles; when self echoes, viewer ignores. The error signal is the origin tag itself.",
  "manifestsIn": ["ct-source", "ct-file-channel", "rt-sources-impl"],
  "evidence": "Self-writes still emit value events (rather than being silently absorbed) precisely so the loop closes."
}
```

---

## Entropy gradient

**Essence.** A system has places where chaos accumulates (parts that
grow, drift, fragment over time) and places where chaos is actively
resisted (cores, contracts, named invariants). The gradient between
them tells you where the design's energy goes.

**Where it shows up.**
- *Codebase:* a `core/` that stays small while `modes/`, `tests/`,
  `docs/archive/` sprawl. The contract is what holds; the periphery
  is where time accumulates.
- *Fiction:* a setting whose social rules are stable while characters'
  lives are chaotic — or vice versa.
- *Business:* a policy doc that everyone obeys (low entropy) vs an
  inbox that everyone has to triage (high entropy).
- *Research:* a small set of axioms stable across decades; conjectures
  proliferating around them.

**Falsification.** If chaos is uniformly distributed — every file
roughly equally messy, every domain equally fluid — there isn't a
gradient, there's a soup. The pattern needs a *contour*.

**Example perspective entry**

```json
{
  "id": "perspective-contracts-anchor",
  "lens": "entropy-gradient",
  "name": "core/types/ is the low-entropy anchor; modes/ absorbs change",
  "insight": "12 mode packages can rev versions, switch tech stacks, even fork — but a change to ModeManifest or ViewerContract is a project-wide event. The contracts hold entropy down; the periphery soaks it up. This is why mode authors can move fast: the floor is solid.",
  "manifestsIn": ["ct-mode-manifest", "ct-viewer-contract", "mode-webcraft", "mode-clipcraft", "mode-cosmos"]
}
```

---

## Self-similarity (fractal)

**Essence.** The same structure appears at multiple scales — micro,
meso, macro — and the resemblance isn't superficial.

**Where it shows up.**
- *Codebase:* a "Plan" that contains "Tasks" that contain "Steps", and
  all three share the same `id / status / dependencies` shape.
- *Agentic:* an Agent that orchestrates sub-Agents that each follow
  the same `read → reason → act → verify` cycle.
- *Fiction:* a scene that mirrors the chapter that mirrors the book —
  the same conflict at three magnifications.
- *Business:* the org chart's pattern shows up in each department's
  internal structure.

**Falsification.** Coincidental shape doesn't count. The pattern needs
the **same forces** producing the structure at each scale, not just
the same boxes.

**Example perspective entry**

```json
{
  "id": "perspective-projection-as-fractal",
  "lens": "self-similarity",
  "name": "cosmos itself is fractal — Pneuma projects modes, this seed projects pneuma",
  "insight": "Cosmos is a mode in pneuma-skills, and the bootstrap seed is cosmos projecting pneuma-skills. Same act (structured projection) at the meta level. Pneuma's contracts let modes write their own world; cosmos uses that to write a world that contains pneuma. The pattern is the act of self-description scaling.",
  "manifestsIn": ["mode-cosmos", "ref-create-mode-skill", "ct-mode-manifest"]
}
```

---

## Causal chain

**Essence.** X causes Y causes Z — not "X happens before Y" or "X
correlates with Y", but each step is the *because* of the next.

**Where it shows up.**
- *Codebase:* "the user opens a project URL because EmptyShell calls
  /api/projects/:id/sessions because the launcher's URL flow needs to
  decide whether to mount a session or auto-trigger onboarding."
- *Mystery / detective:* "the map was hidden recently because the ink
  matches the era because the watermark matches because the desk is
  Tobias's."
- *Research:* a paper's argument chain from premise → mechanism →
  measurement → conclusion.

**Falsification.** If you can re-order the chain without breaking it,
or if any step can be removed and the conclusion still follows, it
isn't a causal chain — it's a list. The signature is irreversibility.

**Example perspective entry**

```json
{
  "id": "perspective-message-becomes-edit",
  "lens": "causal-chain",
  "name": "User message → agent reads → agent edits → chokidar fires → viewer re-renders → user sees change",
  "insight": "Pneuma's reactive loop has six concrete steps and each one is the cause of the next. No step is decorative — remove any one and the live-preview promise breaks. The loop's reliability is the unbroken irreversibility of this chain.",
  "manifestsIn": ["shell-ws-client", "be-claude-code", "rt-file-ref", "ct-source", "shell-use-source"]
}
```

---

## Tension

**Essence.** Two design forces pull in opposite directions and the
designer is consciously holding both. The pattern isn't compromise —
it's *productive tension*.

**Where it shows up.**
- *Codebase:* "files are agent's mother tongue (so don't abstract)" vs
  "viewer needs typed domain (so abstract)" — held in `Source<T>`
  with the file-channel escape hatch.
- *Product design:* power-user features vs. first-run simplicity.
- *Fiction:* a character who loves and loathes the same thing.
- *Research:* generality vs. tractability.

**Falsification.** If one force has clearly won and the other is just
a vestige, there's no tension — there's a winner with a footnote. The
pattern needs **both** forces continuing to shape decisions.

**Example perspective entry**

```json
{
  "id": "perspective-files-vs-domain",
  "lens": "tension",
  "name": "Files are sacred AND viewers need domain types",
  "insight": "Pneuma refuses to abstract files away (agents speak files natively) but viewers can't operate on raw bytes; they need a Deck, a Studio, a Cosmos. The resolution isn't compromise — it's the Source<T> abstraction sitting between them, plus a fileChannel escape hatch when domain *is* files. Both forces remain present in every Source usage.",
  "manifestsIn": ["ct-source", "ct-file-channel", "ct-viewer-contract", "ref-3-0-design"]
}
```

---

## Convergence point

**Essence.** Many separately-conceived concerns funnel through one node.
The node carries weight disproportionate to its surface.

**Where it shows up.**
- *Codebase:* a single file every layer ends up touching (think
  `skill-installer.ts` in pneuma — the meeting point of contracts,
  state, marker blocks, per-backend conventions).
- *Fiction:* the antiques desk where the map is found — many threads
  meet here.
- *Business:* a single approval step every workflow crosses.

**Falsification.** High in-degree alone isn't convergence; it can just
be a hub. The pattern requires that **different concerns** meet there,
not just many instances of the same concern.

**Example perspective entry**

```json
{
  "id": "perspective-instructions-file-as-convergence",
  "lens": "convergence",
  "name": "Instructions file as the convergence of three state circles",
  "insight": "Global preferences, project metadata, session-specific handoffs — three independent state circles, each owned by different code paths — all meet inside the assembled CLAUDE.md / AGENTS.md per session. Whoever maintains this file is implicitly mediating between user, project, and runtime — which is why marker blocks (rather than freeform append) are non-negotiable.",
  "manifestsIn": ["rt-instructions-file", "rt-skill-installer", "rt-handoff-routes", "ref-controlled-state-surface"]
}
```

---

## Layered translation

**Essence.** Data moves through stages where each stage translates from
the previous stage's vocabulary into a new one. The translation is the
work; the carrying isn't.

**Where it shows up.**
- *Codebase:* raw bytes → file → parsed AST → domain object → rendered
  pixel. Each stage uses different concepts than the one before.
- *Agentic:* world adapter (sensor) → snapshot (normalized) → cognition
  (interpreted) → action (motor) — OMNE's basic shape.
- *Research:* observations → measurements → variables → claims.

**Falsification.** If adjacent stages share the same vocabulary,
they're just two halves of one stage. The pattern needs a vocabulary
shift across each boundary.

**Example perspective entry**

```json
{
  "id": "perspective-omne-cognition-stack",
  "lens": "layered-translation",
  "name": "Perception → Cognition → Objective → Capability as four vocabularies",
  "insight": "OMNE's services aren't a flat list — they form a translation stack. Perception speaks 'snapshot'. Cognition speaks 'evidence'. Objective Management speaks 'task'. Capabilities speak 'tool invocation'. Each adjacent pair shares no nouns — that's the translation. A single user goal traverses all four.",
  "manifestsIn": ["perc-world-adapter", "cog-veracity", "cog-evidence", "run-omne", "cap-agent-capabilities"]
}
```

---

## Hidden hand

**Essence.** An entity shapes the behavior of many other parts without
appearing in their direct call graphs — it acts from offstage, through
constraints, defaults, or implicit assumptions.

**Where it shows up.**
- *Codebase:* a config file no module imports but everyone honors (a
  `.env`, a YAML constraint registry); a base class that injects
  behavior without anyone naming it.
- *Fiction:* an absent or dead character whose values dictate the
  living's choices.
- *Business:* a policy doc cited in every meeting but read by none.
- *Agentic:* a system prompt baked into a `pneuma:start` block that
  invisibly governs every reply.

**Falsification.** If the entity is called directly and frequently,
it's not hidden — it's central. The pattern needs the *absence* from
direct call graphs to be the conspicuous thing.

**Example perspective entry**

```json
{
  "id": "perspective-claude-md-as-hidden-hand",
  "lens": "hidden-hand",
  "name": "CLAUDE.md is invoked by no module but read by every session",
  "insight": "The agent's behavior is shaped overwhelmingly by what's in the assembled CLAUDE.md, yet no code path 'calls' CLAUDE.md. It's the system's hidden hand: read once on launch, internalized, then quietly governing every subsequent decision. This is why the marker-block assembly is a contract — what governs invisibly must be assembled visibly.",
  "manifestsIn": ["rt-instructions-file", "rt-skill-installer", "ref-claude-md"]
}
```

---

## Paradigm shift / Succession

**Essence.** The work is mid-migration from one set of axioms to
another. v1 and v2 coexist; the seams between them are where the
design's *future* shows.

**Where it shows up.**
- *Codebase:* `omne_core` and `omne_core_v1` living side by side, with
  re-export shims; ADRs that reverse earlier ADRs; type names ending
  in `Legacy` or `V2`.
- *Fiction:* a culture rewriting its founding myth in the middle of
  the story.
- *Research:* a field where the old paradigm hasn't been declared dead
  but the new one is openly preparing.

**Falsification.** Genuine migration shows in dual artifacts that the
maintainer can articulate the *difference* between. If v1 is just
"the old code we haven't deleted", that's debt, not succession.

**Example perspective entry**

```json
{
  "id": "perspective-published-language-succession",
  "lens": "paradigm-shift",
  "name": "v0.2 monolith → v0.3 published-language multi-package mid-flight",
  "insight": "omne_core (legacy) and omne_core_v1 (Published Language) coexist deliberately. The new code authors against v1; the old code continues to serve the parts where the new vocabulary hasn't landed. The seam isn't debt — it's the locus where the architecture's next form is being articulated. Watch this boundary to understand where OMNE is heading.",
  "manifestsIn": ["fnd-omne-core", "fnd-omne-core-v1", "doc-domain-glossary"]
}
```

---

## When to invent a new pattern

The vocabulary above is a starter. Invent when:

- You see a clear pattern in front of you that doesn't fit any name
  here.
- A domain has its own established vocabulary the user would
  recognize ("the Strategy pattern", "the Cathedral and the Bazaar",
  "the boundary anti-pattern from DDD").
- Combining two patterns makes a new one that's more useful than
  either alone ("orthogonal-tension": two forces that pull
  independently, on independent axes).

The discipline doesn't soften: a new lens still needs at least one
`manifestsIn` and an `insight` that reads as wisdom about the
system. Make the noun precise. Avoid jargon that doesn't earn its
place.

## A closing posture

Perspectives teach a posture more than a method. The posture is:
**read the facts, then sit with them, then say out loud what makes
them cohere as a system — and which walk would show that to someone
else**.

When you say it out loud and it lands, that sentence is your
`insight`. The `manifestsIn` list is the walk that earns it.
