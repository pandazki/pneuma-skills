---
name: pneuma-preferences
description: >
  Persistent user preference memory across sessions. Consult this skill BEFORE making
  any design, style, or aesthetic decisions — choosing colors, themes, layouts, fonts,
  tone of voice, content density, or visual direction. Also consult when starting a new
  creative task in any mode, when the user corrects your style choices, or when asked
  to analyze or refresh user preferences. Even if you think you know what to do,
  check preferences first — the user may have recorded specific constraints.
---

# User Preferences

You have persistent memory about this user stored in `~/.pneuma/preferences/`. This is your external memory — it survives across sessions, across workspaces, across modes.

## Why This Matters

Every session starts from zero. Without preferences, you guess at style choices, repeat mistakes the user already corrected, and miss patterns you've seen before. Preferences solve this:

- The user corrected you three sessions ago about font sizes → that's recorded, you won't repeat it
- The user always chooses muted colors → you start there instead of guessing
- The user prefers Chinese when writing content → you know before they have to say it again

Preferences are not instructions. They're your understanding of who this user is and how they work. The better your understanding, the less friction in collaboration.

## Files

| File | What goes in it |
|------|----------------|
| `~/.pneuma/preferences/profile.md` | Cross-mode: aesthetics, language, collaboration style, cognitive patterns, deep profile |
| `~/.pneuma/preferences/mode-{name}.md` | Mode-specific: slide layout habits, doc formatting style, color choices, etc. |

Files are created by you as needed. An absent file means no profile exists yet — not an error.

**Project sessions** carry a parallel set of preference files at `<projectRoot>/.pneuma/preferences/` — same schema, but scoped to one project. Those belong to the `pneuma-project` skill, not this one. When a project preference contradicts a personal one, follow the project's and tell the user once with a brief reason — the full conflict policy lives in `pneuma-project` (read it if you're in a project and the situation comes up).

## Three-Layer Model

Preferences organize into three layers, each requiring different levels of evidence:

**Layer 1 — Observable preferences** (profile.md): Surface patterns you can see directly. Language, aesthetic tendencies, collaboration style, cognitive approach. A few sessions of observation is enough.

**Layer 2 — Deep profile** (profile.md, deeper section): What drives the surface patterns. Capability boundaries, value anchors (efficiency vs. craft, innovation vs. stability), latent habits, contradictions. This layer requires substantial observation — premature deep profiles are worse than none, because they create false confidence.

**Layer 3 — Per-mode preferences** (mode-{name}.md): Concrete habits in a specific mode. "Always uses light themes in slides", "prefers two-column layouts for comparison content". Distinguish what the user explicitly stated from what you inferred through observation.

The layers exist because surface preferences are easy to spot but shallow, while deep patterns are powerful but require evidence. Jumping to Layer 2 from one session is the classic mistake — it produces labels, not understanding.

## Living Document Philosophy

Preference files are living documents, not label databases. This distinction matters:

- **Full rewrite, not append** — each update is a fresh look at the whole portrait, not a new line at the bottom. Reread everything, reconsider, rewrite what changed.
- **Preserve contradictions** — people are not consistent. If behavior contradicts itself, record both sides. Forcing coherence is a lie that degrades your model.
- **Everything is deletable** — any entry can be overturned by later observation. Nothing is permanent.
- **Temporary vs. stable** — "this project needs dark theme" is not a preference. "Consistently chooses dark themes across projects" is.
- **Describe, don't label** — "tends to request minimal text per slide" not "is a minimalist". Patterns, not personality types.

Why full rewrite? Because appending creates a pile of contradictory observations. A living document forces you to reconcile or explicitly preserve tension. The result is a coherent portrait, not a changelog.

**Size discipline** — keep each preference file under ~2KB. Preference files are read into your working context; bloated files waste the token budget you need for actual work. Full rewrite naturally controls growth, but if a file feels long, tighten prose and drop stale entries. A concise portrait is more useful than an exhaustive one.

## When to Read

Read preferences silently. Do not announce it.

- **Start of creative work** — before your first design decision in a session
- **Before style choices** — colors, themes, layouts, density, typography, tone
- **When the user corrects you** — check if this was a known preference you missed, or if it contradicts one. If a recorded preference said "low saturation" but the user just asked for vivid colors, update the preference — don't silently ignore the conflict

## When to Update

Update silently. Do not ask permission.

- **User explicitly states a preference** → write immediately, mark "user-stated"
- **Recurring pattern observed** → note as "observed", not from a single instance
- **Existing entry contradicted** → revise or annotate the contradiction
- **After a full refresh** → update the changelog

## Markers

Two markers have system-level meaning in preference files:

**Critical constraints** — auto-injected into the instructions file at every session startup:

    <!-- pneuma-critical:start -->
    - Never use dark backgrounds
    - All content text in simplified Chinese
    <!-- pneuma-critical:end -->

Only truly non-negotiable, user-confirmed rules go here.

**Auto-detection:** When the user uses absolute language — "never", "always", "永远不要", "每次都要", "I hate", "don't ever" — treat it as a candidate for the critical marker. Write it in, then mention it briefly so the user knows it's been recorded as a hard constraint. This is the one case where you should be transparent about the update.

**Changelog** — tracks when and what changed, enabling incremental refresh:

    <!-- changelog:start -->
    ## Changelog
    - **2026-03-31** — Full refresh (2026-01 ~ 2026-03, 12 sessions)
      - Added: prefers low-density layouts
      - Revised: aesthetic from "warm tones" to "low saturation"
    <!-- changelog:end -->

## Full Refresh

When you need to build or rebuild the preference profile from session history (e.g., first time setup, or periodic deep analysis), read `{SKILL_PATH}/references/analysis-method.md` for the detailed methodology — it covers analysis techniques, data access scripts, and the step-by-step refresh process.

## Concurrency

Multiple sessions may run simultaneously. Before rewriting a preference file:

1. Read the file and note its content
2. Perform your analysis and compose the new version
3. Read the file again immediately before writing — if the content changed since step 1, merge the new observations from the other session into your rewrite rather than overwriting them

This is lightweight optimistic concurrency. No locks, no infrastructure — just a read-before-write discipline that prevents silent data loss.

## External Memory Sources

External knowledge sources may be connected to this session as additional data providers for preference work. When available, they can supplement local preference files with context from the user's broader knowledge stores.

**Available memory sources:**

{{externalMemorySources}}
