---
name: pneuma-brand
description: Define a brand's visual system, core assets and representative applications in Brand Studio. Use when creating, extending or reviewing a brand that downstream makers will adapt.
---

# Brand Studio

## Scene

You and the user are designing a brand. The brand itself is the deliverable:
a recognizable point of view, visual rules, core assets, and examples showing
how the system behaves in different contexts. The user sees these together in
the workbench. Downstream designers and application builders use this system
to produce their own materials. A polished example is evidence of a direction,
not a promise that every production asset or application has already been built.

## Viewer contract

Each project lives in a directory with `brand.json` and local artifacts. The
viewer groups work into references, identity, core assets and application
examples. Application-context filters answer “where will this brand live?”
Inspecting a work exposes its references, generation brief and optional image
regions. Compare opens the first reference alongside the selected work.

### ViewerAddress vocabulary

| Key | Kind | Meaning |
|---|---|---|
| `contentSet` | Framework reserved | Project directory prefix |
| `item` | Coarse | Stable work ID from `brand.json`, independent of order or filename |
| `region` | Optional fine | ID of a declared normalized image rectangle |

Use `navigate-to` with `{ address: { contentSet: "morrow", item: "brand-world" } }`.
Use `compare` for a work with references. Reuse the address in a viewer locator
or framework `capture`. A region highlights that portion of the image; capture
still shows the work with the highlighted region, not a cropped asset.
File changes update the viewer. The viewer does not generate images or write
brand decisions itself. Read-only sharing hides agent controls.

## Core rules

- Define the audience, promise, personality and intended application contexts
  before expanding the visual language. A mascot is optional, not a brand prerequisite.
- Separate invariants from flexibility: wordmark geometry, character proportions,
  palette roles, type hierarchy, composition, photography, voice, and usage limits.
- Explain what an example demonstrates and what the downstream maker must adapt.
  Do not default to building an App, business website, complete campaign or print run.
- Read actual reference images. Record the role of each reference; a layout example
  is not permission to replace the brand's identity with that reference's identity.
- Use existing image generation/editing tools for raster art. Prefer a native image
  tool when available; otherwise use the installed shared scripts when configured.
  Keep consistent anchors for character identity. Do not redraw a detailed mascot
  with approximate CSS geometry in downstream examples.
- Keep core source assets separate from their application mockups. A character on
  a poster is not a transparent reusable cutout; a mockup is not a print-ready dieline.
- Preserve versions when exploring. Stable IDs and `referenceIds` retain lineage.
  Never overwrite a source reference just to make a comparison look successful.
- Only mark work `ready` after the file exists and has been inspected. `generating`
  means a real request is in progress. `failed` records a useful error. A timeout
  leaves remote completion uncertain; do not blindly repeat a paid request.
- Paths are relative to the project. Keep assets local and do not depend on expiring
  URLs, absolute filesystem paths, or undocumented external rendering services.

## Workflow

1. Read the project, current references and existing user decisions. Ask only for
   missing facts that would change the brand: audience, promise, character, use scenes.
2. Write the brief, application contexts and initial work plan into `brand.json` so
   the user can see the direction before every asset is finished.
3. Develop a coherent identity: mark, palette roles, typography, graphic language,
   image treatment, and optional character rules. Explore meaningful alternatives;
   explain their tradeoffs, and preserve the chosen rules.
4. Create core reusable assets and representative applications. For each context,
   state what stays fixed, what may change, and what its example demonstrates.
   App onboarding, packaging, social posts and retail can be examples of one brand;
   none requires implementing a complete product inside this mode.
5. Review images at full size and the assembled brand book. Check legibility,
   consistency, factual copy and whether another maker could apply the rules.
   Use capture or browser evidence; text-only inspection cannot verify visual fidelity.
6. Validate with `bun "<SKILL_DIR>/scripts/check.ts" <project-directory>`.
   On a fresh installed skill, first run `bun install --cwd "<SKILL_DIR>/scripts"`
   to install the declared validation dependency. Substitute the actual skill path.
7. Prepare handoff: `brand.json`, original core assets, examples, and their guidance.
   Run `bun "<SKILL_DIR>/scripts/export-site.ts" <project-directory>` to produce
   a self-contained `brand-book.html`. The export toolbar downloads or deploys this
   book through configured Vercel / Cloudflare Pages providers. Refresh the book
   after changes; it is a generated deliverable, not another source of identity rules.
8. Point to the work with a viewer locator, and distinguish the brand system delivered
   from the downstream production work still needed.

## Commands

| ID | Response |
|---|---|
| `define` | Resolve the brand promise and use contexts; update brief and rules. |
| `generate` | Develop identity or core assets from the selected references. |
| `apply` | Produce a representative application that tests the brand in a named context. |
| `audit` | Review identity consistency, asset reuse and clarity of downstream guidance. |

## References

| When | Read |
|---|---|
| Authoring or repairing project data | [Project format](references/project-format.md) |
| Planning identity and applications | [Brand development](references/brand-development.md) |
| Generating core assets and examples | [Image workflow](references/image-workflow.md) |
