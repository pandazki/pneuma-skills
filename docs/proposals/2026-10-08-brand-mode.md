# Mode design brief — Brand Studio

## Evidence and scope

Requested in [issue #106](https://github.com/pandazki/pneuma-skills/issues/106),
with the [Feishu workflow](https://gwrdluzl9j9.feishu.cn/wiki/ZhfVwvNWCiK2V4kyJS4c3Z9Zn4d)
as the primary reference. Read revision 394 in full and inspected all 22 body
images plus both comment images before implementation. The issue itself contains
only a social post link and no additional requirements.

The examples connect logo and mascot references to six identity boards (logo,
type/color, visual experiments, character rules, packaging photography, retail),
then to mobile screens and campaign reskins. The reference layouts remain
recognizable while the mascot changes poses and costumes. The comment comparison
shows why approximating a detailed illustration with code loses fidelity.
Plan reusable cutouts up front; inspect real renders against the design.
The promotion and expression-sheet appendix were also inspected.

## Identity and domain

- Name: `brand`; display name: Brand Studio; version: 0.1.0.
- The brand itself is the deliverable: a coherent visual system, core assets,
  and examples that explain how it behaves in different application contexts.
- Downstream makers adapt the system into production materials. Brand Studio
  does not default to implementing an App or delivering every final channel asset.
- Viewer: browse identity, assets and examples; filter by application context;
  inspect reference lineage, compare work and point at declared image regions.
- Public gallery and featured eligibility; original Morrow demonstration brand.

## Invariants, state and reuse

Stable item IDs are the address authority. Reference IDs and application-context
IDs resolve within the project. Paths remain relative and contained. Planned,
generating, failed and ready work stay distinct. Malformed manifests and missing
media remain visible failures. The agent owns persistent files; the viewer owns
transient filters, inspection and comparison state. Reuse Source, file serving,
viewer actions and shared image scripts; no new image service or rendering engine.

## Source and workspace

`aggregate-file` loads `BrandStudio { byContentSet: Record<string, ProjectState> }`
from each project's `brand.json` and HTML specimens. The workspace is manifest,
multiFile true, ordered true, hasActiveFile true, supportsContentSets true.
`domain.ts` validates projects and isolates bad projects. Viewer writes reject.
Application contexts describe purpose and adaptation guidance; works may serve
several contexts. Stages are references, identity, assets and applications.

## ViewerAddress and actions

- `contentSet?`: framework project prefix; `item`: coarse stable work ID.
- `region?`: fine ID of a declared normalized rectangle in an image.
- Example: `{ contentSet: "morrow", item: "brand-world", region: "palette" }`.
- `navigate-to`: navigate, agentInvocable, `{ address: object }`.
- `compare`: ui, agentInvocable, `{ address: object }`; compare the first reference.
- Framework capture is reused. Region navigation highlights the region; it does
  not pretend to export a cropped reusable asset.

## Skill and seed

Teach brand discovery, identity invariants, reference roles, reusable core assets,
representative applications, consistency review and handoff. Commands: define,
generate, apply, audit. The first seed is Morrow: a warm focus brand with an
original plush orange companion, identity board, wordmark, transparent core asset,
and digital/social/packaging examples. One coherent brand demonstrates several
use scenes; no copied research images or source prompts are redistributed.

## Integrations and effects

No proxy or MCP requirement; automatic refresh. Optional sensitive
`openrouterApiKey` maps to `OPENROUTER_API_KEY` for installed shared image scripts.
Prefer a harness image tool when available. Remote generation failures remain
observable; ambiguous timeouts do not justify blindly repeating a paid request.
Local undo cannot cancel remote processing or charges.

The research workflow is credited as inspiration. No NOTICE is required because
upstream text, prompts, images and code are not copied. Showcase assets are newly
generated and their exact prompts recorded.

## Cloud and delivery

The user confirmed read-only sharing and website deployment. Both present the
brand system and its examples. The hosted player renders package files alone,
hides agent/export controls, and is whitelisted only after browser verification.

The mode's deterministic export script builds a self-contained `brand-book.html`.
A small shared `ModeManifest.artifactExport.file` declaration lets the runtime
preview/download/deploy a declared HTML file at `/export/<mode>` without owning
brand schema knowledge. Existing Vercel and Cloudflare Pages providers consume
`index.html`. The generated book embeds ready image outputs and excludes research
references. Editable HTML specimens remain source-kit files and are labeled as such.
Publishing is a user action; this development task does not publish a live site.

The mode is bundled for hosted-player use; frontend registry, distribution and npm
file list agree. The launcher scans directories, with no server-side name list.

## Evolution directive

Learn accepted identity rules, reference choices, composition, density, character
consistency and downstream guidance preferences from explicit feedback.

## Verification and deferred work

Test invalid manifests, references, IDs, regions, state transitions, project
isolation and export containment. Verify browsing, application filters, comparison,
narrow layout, read-only player content sets/checkpoints, and deploy-page collection
in a browser. Run guidance validation, typecheck, routine tests and both builds.

Native Figma export, arbitrary canvas dragging, persistent viewer edits and final
business-asset production are outside this mode's initial scope.

### Verification results — 2026-10-08

- Routine repository run: 7,474 passed, 99 skipped, two integration failures
  (desktop bundle entry and player registry/whitelist alignment). Both were fixed.
  The subsequent affected-suite run passed 2,214 tests with 24 skipped and no
  failures; the final focused regression run passed 29 tests with no failures.
- Typecheck, guidance validation, application build and standalone player build
  passed. Builds retain the existing large-chunk warning. `git diff --check` passed.
- Browser inspection covered the desktop board, narrow layout, context filters,
  comparison, launcher discovery and export preview. The deployment collector
  returned one self-contained `index.html` with embedded images.
- A real shadow-git package exercised two projects and two checkpoints in the
  standalone player. Moving backward removes later projects; moving forward
  restores them. All four images loaded, creation/export controls were absent,
  and no browser errors were recorded. Malformed-project recovery also has a
  viewer regression test. The final review had no remaining blocking findings.
- Local evidence: `/tmp/brand-final-tests.log`, `/tmp/brand-final-targeted.log`,
  `/tmp/brand-player-final.png`, `/tmp/brand-viewer-narrow.png`, and
  `/tmp/brand-export-page.png`. Reproduce player verification with
  `bun scripts/smoke-brand.ts` after building the player.

No production player or public website was deployed during development.
