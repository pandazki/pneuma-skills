# Projection Workflows

> Step-by-step workflows tuned to specific content domains. The
> first time you encounter a new domain in a session, scan the
> relevant section. After that, the general workflow in SKILL.md
> is sufficient.

## Codebase

Strong inputs: a directory of source files, a single repo, a
package. Token-heavy — use parallel reads aggressively.

> **On Claude Code, prefer Path A** (the Workflow-backed projection in
> SKILL.md). The projection workflow already does steps 3–5 below —
> parallel per-partition extraction in fresh contexts, cross-edge merge,
> *and* an adversarial verify pass the manual recipe can't afford. The
> steps below are the **Path B fallback**: the in-context recipe for
> when the `Workflow` tool is unavailable (Codex / Kimi) or the repo is
> small enough to hold in one context. Don't run both.

### Steps (Path B fallback)

1. **Survey first.** `Glob` for source files, count by extension.
   Read `README.md`, `package.json` / `pyproject.toml` / `Cargo.toml`,
   `tsconfig.json`. Don't open every file yet.
2. **Identify entrypoints.** Where does the program start? `index.ts`,
   `main.py`, `bin/*`, `cmd/*`. These become the first nodes.
3. **Spawn parallel Task subagents** for sub-areas — one per top-level
   directory, each instructed to "extract the file/function/class
   nodes and their inbound/outbound dependencies in this area; return
   a JSON list of nodes + edges". This is how you avoid sequential
   token exhaustion on a 200k-LOC repo.
4. **Merge** subagent outputs into a single `cosmos.json`. Resolve
   cross-area edges (a `service` calling a `data` function).
5. **Cluster into layers.** Group by architectural concern:
   `api`, `service`, `data`, `ui`, `utility`, `config`. The cluster
   may not match directory structure — that's fine; layers are about
   *concern*, not *location*.
6. **Write tour.** Aim for "start at entrypoint → main domain logic
   → external integrations → tests". 5–8 steps.

### Pitfalls

- **Don't node-ify every line.** A function with 3 callers and no
  callees can be a tag on its caller's node — not its own node.
- **Generic edge verbs.** `depends_on` is allowed but `calls` /
  `imports` / `implements` are more useful when applicable.

## Fiction (mystery, novel chapter, short story)

Strong inputs: a `.md` or `.txt` of prose. Token-light usually —
sequential read is fine.

### Steps

1. **Read the whole thing.** Don't skim — fiction's meaning is in
   the connections.
2. **First pass: characters, places, objects.** Walk through and
   emit a node for each. Use `name` exactly as the text names them
   (don't normalize "Mr. Halloran" to "Halloran").
3. **Second pass: events.** What happens? Events have time anchors;
   each is a node with a place + a participant set as edges.
4. **Third pass: clues + inferences.** Every observation that
   constrains interpretation is a clue (`cl-` prefix). Every
   conclusion the text reaches or implies is an inference (`i-`
   prefix).
5. **Edge verbs are everything.** `discovers`, `vanished_near`,
   `refers_to`, `supports`, `contradicts`. Use the text's verbs
   when possible.
6. **Tour:** narrative arc — moment of discovery → expansion of
   stakes → contradiction of first theory → landing on the
   inference.

### Pitfalls

- **Spoilers in summaries.** If the user is mid-read, summaries
  shouldn't reveal what happens. Use `tags: [spoiler]` and let
  the viewer hide them later (v0.2 feature; for now, just be
  conscious).
- **One-mention things.** A character mentioned once doesn't need
  a node. Stay above the "would-the-user-click-this" threshold.

## Research (paper, abstract, technical report)

### Steps

1. **Read abstract + conclusion first.** That's the spine.
2. **Emit `claim` nodes** for the central assertions.
3. **Emit `evidence` nodes** for what supports each claim — datasets,
   experiments, prior work, derivations.
4. **Emit `method` nodes** for techniques used. They sit between
   evidence and claims.
5. **Edges:** `supports`, `relies_on`, `refutes`, `extends`, `cites`.
   Be specific about strength — use `weight` to differentiate
   "single experiment supports this" from "decades of work supports
   this".
6. **Tour:** central claim → key evidence → method → limitations →
   how-this-extends-prior-work.

### Pitfalls

- **Treating citations as evidence.** A citation is `cites`, not
  `supports` — unless the paper explicitly uses it to support a
  claim.
- **Method buried in claim summaries.** If the user can't see
  *how* a claim was reached, the cosmos isn't doing its job.
  Methods get their own nodes.

## Business workflow

Strong inputs: a process document, a runbook, an org chart.

### Steps

1. **Identify domains.** Top-level business areas (Sales, Ops,
   Finance). These are `domain` nodes.
2. **Identify flows per domain.** A flow is a sequence of steps
   that achieves a domain outcome (order fulfillment, hiring,
   incident response). `flow` nodes.
3. **Steps within flows.** Each `step` is an action by an `actor`
   against a `system`, possibly producing a `metric` or triggering
   a `decision`.
4. **Edges:** `triggers`, `consumes`, `produces`, `decides`,
   `escalates_to`. Direction matters here — show the arrow of time.
5. **Tour:** start with the dominant flow, walk it linearly, branch
   into a key decision and its outcomes.

### Pitfalls

- **Conflating flow and step.** A "Customer Onboarding" is a flow;
  its first step is "Receive signup". Don't make the flow a node
  AND name all its steps the same thing.
- **Hidden actors.** Systems don't act on their own — an actor or
  policy triggers them. If you find a `system` with only outbound
  `produces` edges, you're missing the actor.

## Knowledge base / wiki (Karpathy pattern)

### Steps

1. **Parse the index.** Karpathy wikis have an `index.md` with
   wikilinks + categories. The deterministic part — extract these.
2. **Emit `topic` nodes** for each category.
3. **Emit `article` nodes** for each linked article.
4. **For each article, read it** (or batch-read with subagents)
   and extract `entity` + `claim` + `source` nodes inside.
5. **Edges:** `categorizes` (topic → article), `references`
   (article → article, article → entity), `defines` (article →
   concept), `cites` (article → source).
6. **Tour:** entry topic → its central article → key entities → a
   surprising cross-reference into another topic.

### Pitfalls

- **Article = node, paragraph = nothing.** A wiki article's *content*
  becomes the article's `summary` + edges out; don't node-ify
  paragraphs.
- **Wikilink ≠ semantic edge.** A wikilink might be `references`
  (mention) or `defines` (target is the definition) or `cites`
  (target is the source). Read context to pick the verb.

## Conversation / thread

### Steps

1. **Emit `participant` nodes** for each speaker.
2. **Emit `message` nodes** — but only load-bearing ones. Filler
   ("ok", "thanks") doesn't need a node.
3. **Emit `claim`, `question`, `decision` nodes** as you spot them
   inside messages.
4. **Edges:** `replies_to`, `agrees_with`, `disagrees_with`, `asks`,
   `resolves`.
5. **Tour:** opening question → key disagreements → resolution.

### Pitfalls

- **Faithful transcription.** This isn't archival — drop noise.
- **One node per message.** Too many. A long, important message
  might become 1–3 claim/decision nodes; a short ack becomes 0.

## When the content doesn't fit

Sometimes the user brings something weird — a screenplay annotated
with director's notes, a recipe book, a personal journal. In that
case:

1. **Talk to the user.** Ask "what are you trying to see in this?"
   The answer names the projection.
2. **Borrow vocabulary from the closest analog.** A recipe book is
   close to a knowledge base (categories → recipes → ingredients).
   A journal is close to a thread (entries → claims → moods).
3. **Document your vocabulary choice** in `project.description` so
   the user knows what they're looking at and can ask for
   adjustments.
