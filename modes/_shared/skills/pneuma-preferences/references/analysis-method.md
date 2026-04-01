# Preference Analysis Deep Method

## Three-Layer Preference Model

### Layer 1: Cross-Mode Observable Preferences (profile.md)

Surface patterns directly inferable from behavior:

- **Language & expression** — working language, formality, verbosity, terminology habits
- **Aesthetic sensibility** — color tendencies, layout density, typography instincts, style tone
- **Collaboration mode** — directive vs. collaborative, autonomy expectations, confirmation frequency, reaction to suggestions
- **Cognitive style** — big-picture-first vs. detail-first, visual vs. textual, how they frame problems

### Layer 2: Deep Profile (profile.md, deeper section)

Requires accumulated observation across multiple sessions. Do not write this layer from thin evidence — premature deep profiles are worse than none.

- **Capability landscape** — technical depth, design sensitivity, domain knowledge boundaries
- **Value anchors** — efficiency vs. craft, innovation vs. stability, precision vs. intuition
- **Latent patterns** — what they consistently reach for without being asked, what they consistently avoid
- **Contradictions** — where behavior conflicts with stated preferences; record as-is, do not resolve

### Layer 3: Per-Mode Preferences (mode-{name}.md)

Concrete, mode-specific habits:

- Explicit instructions the user has given (quote or paraphrase, mark as "user-stated")
- Observed patterns you've inferred (mark as "observed")
- Critical constraints for this mode (in the `pneuma-critical` marker)

## Writing Principles

**This is a living document, not a label database.**

- **Full rewrite, not append** — each update is a fresh look at the whole portrait. Read the entire file, reconsider everything, rewrite what needs changing.
- **Natural-language confidence** — express certainty through prose: "consistently observed across 8+ sessions", "initial impression from two conversations", "user explicitly stated". No mechanical scores.
- **Preserve contradictions** — if behavior contradicts itself, record both sides. People are not consistent; forcing coherence is a lie.
- **Deletable** — any entry can be overturned by later observation. Nothing is permanent.
- **Temporary vs. stable** — distinguish "this project's special requirement" from "long-term stable preference". Temporary observations do not belong in the profile unless they recur.
- **No labeling** — describe behavioral patterns and choice tendencies, not personality types. "Tends to request minimal text per slide" not "is a minimalist".
- **Neutral precision** — avoidance is avoidance, control is control. Do not prettify.

## Analysis Method

The most durable motivations hide in unconscious constancy.
Obvious preferences are merely projections of deeper logic.

- **Attend to the constant** — what does the user always do without being asked? That's where the real signal lives.
- **Reverse verify** — if your conclusion is X, you should observe Y behavior. Do you?
- **Isolate variables** — if you remove factor X, does pattern Y still appear? If so, X is not the cause.
- **Watch the shadows** — avoidance, hesitation, repeated corrections, emotional spikes. These reveal boundaries more clearly than positive choices.
- **Temporal awareness** — people change. A preference from 3 months ago may be obsolete. Weight recent observations more heavily, but don't discard old ones without reason.

## Full Refresh Guide

A full refresh is a systematic review of all sessions within a time range:

1. **Determine scope** — check the changelog for the last refresh date. Sessions after that date are unprocessed.
2. **Enumerate sessions** — list sessions using data scripts or directly reading `~/.pneuma/sessions.json`:
   ```bash
   bun {EVOLVE_SCRIPTS}/list-sessions.ts --since {last_date}
   ```
3. **Extract conversation** — for each relevant session:
   ```bash
   bun {EVOLVE_SCRIPTS}/session-digest.ts --file {path}
   ```
4. **Analyze** — look for patterns across sessions. Apply the analysis method above.
5. **Rewrite** — update the preference files. Full rewrite, not append.
6. **Log** — add a changelog entry with date, scope, and summary of changes.

`{EVOLVE_SCRIPTS}` refers to the evolve mode's data access scripts. To find them, look for `list-sessions.ts` under the Pneuma installation's `modes/evolve/skill/scripts/` directory.

If the evolve scripts are not available in the current workspace, you can also:
- Read `~/.pneuma/sessions.json` for session listing (has workspace paths, modes, timestamps)
- Read `{workspace}/.pneuma/history.json` for conversation data directly
- These are JSON files readable with standard file operations

## Integration with Evolution

The evolve mode already scans session history for skill improvement proposals. A preference full refresh naturally fits into the same loop — when the evolution agent is analyzing sessions, it can simultaneously extract user preference signals at near-zero additional cost.

If you are running inside evolve mode, consider combining skill evolution analysis with preference refresh into a single pass over the session data. This turns preference maintenance from an on-demand operation into a background consolidation cycle — analogous to "dreaming" in memory systems, where cross-session patterns are extracted and refined while the user isn't actively working.
