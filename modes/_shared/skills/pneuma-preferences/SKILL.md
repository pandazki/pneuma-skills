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

You have persistent memory about this user's preferences stored in `~/.pneuma/preferences/`.

## Quick Start

1. **Read** `~/.pneuma/preferences/profile.md` and `~/.pneuma/preferences/mode-{current-mode}.md` (if they exist)
2. **Apply** what you learn to your current task — style choices, tone, layout, density
3. **Update** the files when you notice new stable patterns or the user states a preference

If the files don't exist yet, that's fine — create them when you have enough observations.

## Files

| File | What goes in it |
|------|----------------|
| `profile.md` | Cross-mode preferences: aesthetics, language, collaboration style, cognitive patterns |
| `mode-{name}.md` | Mode-specific habits: slide layout preferences, doc formatting style, color choices, etc. |

## Reading Preferences

Read preferences silently at the start of creative work. Do not announce it. Apply them naturally.

Key moments to check preferences:
- Beginning of a session where you'll create or edit content
- Before choosing a color scheme, theme, layout, or typographic style
- When the user corrects a design or style choice — check if this is a known preference you missed
- When the user says "I always want..." or "never do..." — that might already be recorded

## Updating Preferences

Update silently when you observe something worth recording. Do not ask permission.

- **User explicitly states a preference** → write it immediately, note "user-stated"
- **You notice a recurring pattern across this session** → note it as "observed"
- **An existing preference is contradicted** → revise or note the contradiction
- Each update is a **full rewrite** of the file — reread everything, reconsider, rewrite what changed

## Critical Constraints

Users can mark hard constraints that get auto-injected into every session:

    <!-- pneuma-critical:start -->
    - Never use dark backgrounds
    - Always use simplified Chinese for content
    <!-- pneuma-critical:end -->

Only truly non-negotiable, user-confirmed rules go here. Everything else stays in the main body.

## Changelog

Maintain a changelog at the end of each preference file for incremental tracking:

    <!-- changelog:start -->
    ## Changelog
    - **2026-03-31** — Full refresh (2026-01 ~ 2026-03, 12 sessions)
      - Added: prefers low-density layouts
      - Revised: aesthetic from "warm tones" to "low saturation"
    <!-- changelog:end -->

## Full Refresh

When the user asks to analyze their preferences across sessions, or when you want to build/rebuild the preference profile from history, read `{SKILL_PATH}/references/analysis-method.md` for the detailed methodology — it covers the three-layer preference model, writing principles, analysis techniques, and step-by-step refresh instructions.

## Concurrency

Multiple sessions may run simultaneously. Read the latest file content before rewriting to minimize overwrites.
