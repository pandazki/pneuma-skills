# Pneuma WebCraft Mode — Third-Party Notices

## Design intelligence: pbakaus/impeccable

The `skill/` content of this mode (SKILL.md design-intelligence section,
all `references/cmd-*.md` command bodies, the `references/*.md` register
and topic references, and `skill/scripts/palette.mjs`) is adapted from
[pbakaus/impeccable](https://github.com/pbakaus/impeccable)
("Impeccable.style") under the Apache 2.0 License.

**Synced against:** impeccable skill-v3.9.1 (July 1, 2026).

### Local adaptations

The pneuma-webcraft mode lives inside Pneuma's live-preview runtime,
which already provides the visual environment that upstream's slash
commands and the `npx impeccable` CLI/extension wrap around. To fit
that, the upstream content is adapted as follows:

| Upstream | Pneuma-webcraft adaptation |
|---|---|
| One skill per verb (`/<verb>` slash command) up to v2.x; consolidated into a single `impeccable` skill with verb-arg routing in v3.0 | All verb bodies inlined as `references/cmd-<verb>.md`; the agent reads them on demand. |
| Deep topic references folded into their commands in v3.5.0 (`typography.md` → `typeset`, `color-and-contrast.md` → `colorize`, `spatial-design.md` → `layout`, `motion-design.md` → `animate`, `responsive-design.md` → `adapt`, `ux-writing.md` → `clarify`, `cognitive-load.md` + `heuristics-scoring.md` + `personas.md` → `critique`) | Mirrored — the standalone topic files are gone; each command carries its "Reference Material" section inline. Only `brand.md`, `product.md`, and `interaction-design.md` remain as standalone references. |
| `teach` renamed to `init` in v3.5.0 (`teach` kept as a deprecated alias) | Mirrored — the toolbar command id is `init` (`cmd-init.md`); a typed `teach` is honored as an alias per SKILL.md routing. |
| `SKILL.src.md` compiled per-harness at build time (v3.5.0): `<codex>` / `<gemini>` provider blocks, `<!-- rule:* -->` eval markers | Pneuma ships one skill text to all backends. Rule markers are stripped. Provider-block content that is model-agnostic in substance (Codex ghost-card / over-round / sketchy-SVG / stripe / grid-background bans, the Gemini image-hover ban, the Codex tracking floor) is inlined for every backend as "model-tell bans" — the patterns are defects regardless of which model produced them. Harness-conditional plumbing (Codex Browser-skill notes, Run Notes accounting, `fork_context` flags) is not ported. |
| `scripts/palette.mjs` brand-seed picker (v3.5.0: 129 hand-curated OKLCH seed anchors, each with a mood and composition strategy) | Adopted verbatim as a skill script — it is self-contained data + `node:crypto`, and true random seed selection is the point (agent-picked "random" drifts back to favorites). SKILL.md Setup step 5 teaches it for brand-new projects only; committed brand colors always win. |
| `Invoke /impeccable` bridge paragraph | Replaced with: "consult the 'Impeccable.style Design Intelligence' section of the pneuma-webcraft skill (SKILL.md)". |
| `STOP and call the AskUserQuestion tool to clarify.` | Templated as `{{ask_instruction}}` (substituted at runtime to "STOP and ask the user using a normal message"). |
| `{{command_prefix}}impeccable <verb>` slash-command invocations | Rewritten as bare `<verb>` (or "the `<verb>` command") — pneuma users invoke from the toolbar, not via a slash prefix. The `{{command_prefix}}` token is stripped. |
| Bare `/impeccable` context-aware recommendation menu (v3.5.0, `context.mjs` + `context-signals.mjs` + inline `detect.mjs` scan) | Not adopted — webcraft has no bare invocation; commands arrive from the toolbar via `<user-actions>` or by intent routing. The `init` command's closing "recommend next commands" step is ported (it needs no scripts). |
| `npx impeccable detect` deterministic detector (41 rules, v3.5.0 htmlparser2 rewrite) + `npx impeccable live` browser overlay + `hooks` post-edit detector hooks for Claude/Codex/Cursor/Copilot (v3.6.0–v3.9.1) | Not adopted — pneuma-webcraft critique stays on the agent-driven pattern catalog (the same DON'T rules embedded in SKILL.md); the CSS-checkable detector rules added in v3.5.0 are ported as agent-readable bans instead. Live preview is the iframe in the Pneuma viewer; a separate "live mode" and editor-hook plumbing aren't needed. Consequently `reference/live.md`, `reference/hooks.md`, the entire `skill/scripts/live-*` / `hook*` / `detect.mjs` / `context*.mjs` families, and the `skill/agents/*` subagents are not ported. |
| Critique dual-sub-agent isolation + `⚠️ DEGRADED` provenance banner (v3.9.0) | Adopted — Assessment A/B run as isolated sub-agents when the backend exposes a Task tool; browser-overlay evidence is replaced by the Pneuma viewer's `capture` action. |
| `reference/codex.md` (v3.1.0 Codex-specific image flow) | Not adopted — Pneuma's image generation goes through `scripts/generate_image.mjs` / `edit_image.mjs` (taught in SKILL.md), not Codex's native image subagent. Where upstream branches on "if Codex with native image gen, do X; otherwise do Y" we port the Y branch (with Pneuma's own image-gen scripts standing in for the native path in `craft` / `shape`). |
| Skill self-update check (v3.5.0 `UPDATE_AVAILABLE` directive) | Not adopted — Pneuma's own skill-version tracking (`skill-version.json` + launcher update prompt) owns update detection. |
| Monorepo per-app `PRODUCT.md` / `DESIGN.md` resolution (v3.8.0) | Not adopted — webcraft workspaces are content-set-shaped, not monorepos; context files live at the project root. |
| `PRODUCT.md` + `DESIGN.md` context files (v3.0 successor to `.impeccable.md`) | Either filename is accepted; the `init` command still updates a pre-existing `.impeccable.md` in place for back-compat with existing user workspaces. The `document` command writes the DESIGN.md visual spec. |
| `node {{scripts_path}}/load-context.mjs` and the other context/persistence helper scripts (`pin.mjs`, `critique-storage.mjs`, `is-generated.mjs`, …) | Not shipped — the pneuma viewer already keeps the design context file visible in the live preview iframe. Behaviors that mattered are preserved as direct agent instructions instead of wrapped in helper scripts. `palette.mjs` is the one deliberate exception (see its row above). |
| `.impeccable/critique/<timestamp>__<slug>.md` snapshot persistence + `ignore.md` (v3.1.0; `IMPECCABLE_CRITIQUE_META` + trend helper in v3.9.x) | Adopted as agent-driven behavior — `critique` writes the snapshot (YAML frontmatter carries `total_score` / `p0_count` / `p1_count`) via the Write tool and reads the recent files back for the trend line; `polish` reads the latest matching snapshot via Read. No helper script is shipped; `ignore.md` is honored as a user-curated list of intentional deviations. |
| Per-skill `version: x.y.z` frontmatter field | Dropped — the mode's version travels with `package.json`. |

### License excerpt

> Copyright 2024-2026 Paul Bakaus
>
> Licensed under the Apache License, Version 2.0 (the "License");
> you may not use this file except in compliance with the License.
> You may obtain a copy of the License at
>
>     http://www.apache.org/licenses/LICENSE-2.0
>
> Unless required by applicable law or agreed to in writing, software
> distributed under the License is distributed on an "AS IS" BASIS,
> WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
