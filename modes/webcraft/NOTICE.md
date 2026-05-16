# Pneuma WebCraft Mode — Third-Party Notices

## Design intelligence: pbakaus/impeccable

The `skill/` content of this mode (SKILL.md design-intelligence section,
all `references/cmd-*.md` command bodies, and the `references/*.md` topic
references for typography, color-and-contrast, spatial-design,
motion-design, interaction-design, responsive-design, ux-writing) is
adapted from [pbakaus/impeccable](https://github.com/pbakaus/impeccable)
("Impeccable.style") under the Apache 2.0 License.

**Synced against:** impeccable skill-v3.1.1 (May 14, 2026).

### Local adaptations

The pneuma-webcraft mode lives inside Pneuma's live-preview runtime,
which already provides the visual environment that upstream's slash
commands and the `npx impeccable` CLI/extension wrap around. To fit
that, the upstream content is adapted as follows:

| Upstream | Pneuma-webcraft adaptation |
|---|---|
| One skill per verb (`/<verb>` slash command) up to v2.x; consolidated into a single `impeccable` skill with verb-arg routing in v3.0 | All verb bodies inlined as `references/cmd-<verb>.md`; the agent reads them on demand. |
| `Invoke /impeccable` bridge paragraph | Replaced with: "consult the 'Impeccable.style Design Intelligence' section of the pneuma-webcraft skill (SKILL.md)". |
| `STOP and call the AskUserQuestion tool to clarify.` | Templated as `{{ask_instruction}}` (substituted at runtime to "STOP and ask the user using a normal message"). |
| `{{command_prefix}}impeccable <verb>` slash-command invocations | Rewritten as bare `<verb>` (or "the `<verb>` command") — pneuma users invoke from the toolbar, not via a slash prefix. The `{{command_prefix}}` token is stripped. |
| `npx impeccable --json` deterministic detector + `npx impeccable live` browser overlay (v3.0.4+ Live mode) | Not adopted — pneuma-webcraft critique stays on the agent-driven pattern catalog (the same DON'T rules embedded in SKILL.md). Live preview is the iframe in the Pneuma viewer; a separate "live mode" command isn't needed. Consequently `reference/live.md`, the entire `skill/scripts/live-*.mjs` family, and the `skill/agents/impeccable-asset-producer.md` Codex subagent (which only feeds Live mode's asset pipeline) are not ported. |
| `reference/codex.md` (v3.1.0 Codex-specific image flow) | Not adopted — Pneuma's image generation goes through `scripts/generate_image.mjs` / `edit_image.mjs` (taught in SKILL.md), not Codex's native image subagent. Where upstream branches on "if Codex with native image gen, do X; otherwise do Y" we port the Y branch. |
| `PRODUCT.md` + `DESIGN.md` context files (v3.0 successor to `.impeccable.md`) | Either filename is accepted; the `teach` command writes to `.impeccable.md` for back-compat with existing user workspaces. The `document` command writes the DESIGN.md visual spec. |
| `node {{scripts_path}}/load-context.mjs` and the rest of `skill/scripts/*` (`pin.mjs`, `design-parser.mjs`, `critique-storage.mjs`, `is-generated.mjs`, `cleanup-deprecated.mjs`, the `live-*` family) | Not shipped — the pneuma viewer already keeps the design context file visible in the live preview iframe. Behaviors that mattered are preserved as direct agent instructions instead of wrapped in helper scripts. |
| `.impeccable/critique/<timestamp>__<slug>.md` snapshot persistence + `ignore.md` (v3.1.0) | Adopted as agent-driven behavior — `critique` writes the snapshot via the Write tool; `polish` reads the latest matching snapshot via Read. No helper script is shipped; `ignore.md` is honored as a user-curated list of intentional deviations. |
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
