---
name: craft
description: "New visual work: name the job kind and the freedom it earns, settle the direction, write the intent contract, build with full commitment, then finish with a reviewed verdict."
argument-hint: "[feature description]"
user-invocable: true
---

# New visual work

This is the flow for any request to make new visual work — a whole site, a page inside one, a section, a redesign, a scoped refinement — whether or not the `craft` command was invoked from the toolbar. "Build me a landing page", "add a pricing section", and "redesign this" all land here.

`PRODUCT.md` owns product truth. `DESIGN.md` owns durable visual decisions. A surface brief in `.impeccable/surfaces/<page-slug>.md` owns strategy that belongs to one page.

## MANDATORY PREPARATION

Before proceeding, consult the "Impeccable.style Design Intelligence" section of the pneuma-webcraft skill (SKILL.md) — it carries the setup steps, the visitor modes, and the Context Gathering Protocol. If no design context exists yet, run the `init` command (see [cmd-init](cmd-init.md)) first; a missing `DESIGN.md` does **not** route back to `init`.

Load [craft-floor.md](craft-floor.md) immediately before you edit UI, not now — the floor is for building, not for planning.

---

## 1. Decide what is already true

Read `DESIGN.md`, the active content set's representative pages, tokens, components, and assets. Then place the request on this ladder — **each rung earns a different amount of freedom, and getting the rung wrong is the classic failure in both directions**: restyling a whole product around one new section, or polishing the look the user asked you to discard.

| Job kind | What is fixed | What you decide |
|---|---|---|
| **Scoped refinement** — "make this button tighter" | Everything outside the ask: identity, behavior, copy, layout | Only the named element. No interview, no direction round, no `DESIGN.md` change. |
| **Section added to a page that works** | The page's world and composition | The new purpose, content, hierarchy, states, interaction, and how the addition joins what surrounds it. Never turn a local addition into an identity exercise. |
| **New page inside an established product** | The visual system: palette, type, components, motion grammar | The structure. Derive five to seven materially different compositions from the content, task, and behavior, order them by resonance, and put the strongest two or three in front of the user as full options of equal weight. |
| **Redesign** | Product truth, content, function, constraints, explicit brand commitments | The visual world — replaced, not polished. The old look is evidence of what the subject *is*, never authority over what it becomes. Rewrite `DESIGN.md` at finish. |
| **Blank slate / no visual authority** | Nothing but product truth | The whole world, with the user. Run step 3's derivation in full. |

Two corrections that decide this correctly: an **established world** is inherited even when `DESIGN.md` is missing — a coherent identity already in the code is authority, and you document it rather than replace it. An **incomplete brand** (a logo and two colors) keeps its confirmed assets and recognizable traits, and you expand the system with the user for this surface.

## 2. Ask what will change the work

Ask **one** round of two or three related questions, then move. Skip settled facts — a precise request may need only a compact confirmation. {{ask_instruction}}

- **Persuade:** who must act, what they should believe, and which real proof, content, or assets earn that belief.
- **Operate:** the task, the information it needs, the states that matter, the frequency, the constraints.
- **Read:** the reader's question, the source material, the structure, the wayfinding.
- **Experience:** what leads, how exploration unfolds, which interaction or transition matters.

Across all four, ask what success looks like, what must remain untouched, and what would make a polished result feel wrong. Never ask for CSS values or for a canned aesthetic lane.

## 3. Choose the direction

**Extending or adding inside an established world:** skip to step 4. Inherit the world; resolve composition only.

**Creating or replacing a visual world:**

1. Name the product's unique mechanism in one sentence, the audience's real scene, its cultural home, and what this first surface must prove. Name the page this category always ships *and* its predictable opposite — both are the rut, and both stay out of the candidate list. A brief that paints its own picture (a product name, a titled artifact, a governing metaphor) adds its literal reading to the rut: spend at most one candidate on it and derive the rest from elsewhere in the audience's world.
2. From that cultural world, list **seven** concrete visual systems, artifacts, places, or rituals the audience knows by heart — each with one line on why it resonates and can carry the mechanism, ordered by resonance. The audience's world includes its graphic and screen traditions, not only its physical objects: the notation, publications, identity programs, data graphics, and interfaces it reads daily. A nameable abstract system (a school of poster, a documentation standard) is as concrete a candidate as any object. What would this thing look like as a physical object; what did its world look like before the web? Near-duplicates count once. **If more than three of the seven share one material family, the derivation stopped at the subject's most obvious artifact** — dig until the list spans at least three families.
3. Turn that material into complete directions: each joins a reusable visual world to a concrete first-surface experience — world, first viewport, visitor path, signature interaction, cross-surface reach, honest risk.
4. Present **one** committed direction, not a ranked menu: a lineup hands selection back to a taste function and invites the safest card. Carry at most two alternates beside it, each with a one-line case and an honest risk line. Name what each rejected candidate did better, and raise the presented direction to match before showing it — a raise nobody can read did not happen. A raise transfers ambition and discipline (a palette's total commitment, a grid's density courage, a form's structural honesty), never the rejected candidate's clothes: one world owns the page.
5. Offer **the standing exit**: one quiet, permanent alternative — the category standard, played straight. It is the user's door, never yours. Never recommend it, never weigh it against the direction, never let it soften what you present. When the user takes it, convention becomes the commitment: ask once for two or three products this should sit alongside, make their craft level the bar, and execute the canon at full fidelity, without irony or smuggled quirk. Record a standing preference as a brand commitment in `PRODUCT.md`.

Every direction you show must already be viable: every relationship it visualizes true, a real palette and component family, a distinctive composition, workable at full-page scale within the available assets and performance budget. **Truth binds claims, not demonstrations.** In greenfield work, author whatever illustrative material the concept needs at full fidelity, label it synthetic wherever a visitor could mistake it for real, and hand the user the list of what to replace. What stays uninventable are commercial and factual claims: prices, customers, benchmarks, capabilities the product does not have. Refusing a bold direction because its demonstration data does not exist yet is timidity wearing honesty's clothes.

**When image generation is available in this session**, visualizing the locked direction before building it produces the most compositional and ambitious work. Generate the first viewport as a full-fidelity mock (structure-led prompt, real product name and real content, the direction's own palette and material world, no invented commercial claims), show it, and get approval. See SKILL.md's Image Generation section for the call. Without image generation there is no mock and no apology for it: the ambition moves into the direction contract's FIRST VIEWPORT block and a named signature interaction, and the finish review audits those promises in behavior.

## 4. Commit the world

Pick a **color strategy** before picking colors:

- **Restrained** — tinted neutrals plus one accent under 10%. The default when the visitor came to operate or read.
- **Committed** — one saturated color carries 30–60% of the surface.
- **Full palette** — three or four named roles, each used deliberately.
- **Drenched** — the surface IS the color.

Persuade and Experience surfaces have permission for the bolder strategies; take it when the brief allows. Color commits at page scale — fields that own whole regions, not accents scattered over a neutral ground. Tinted neutrals add 0.005–0.015 chroma toward the brand's own hue, never toward warm-by-default. Use OKLCH throughout. Dark or light is never a default: write one sentence of physical scene (who uses this, where, under what light) and let it force the answer; if it doesn't, the sentence isn't concrete enough yet.

Choose type like objects from the subject's world, in the mode's register. Operate and Read surfaces are well served by system stacks and workhorse UI faces. Persuade and Experience surfaces want faces with a point of view — and **these training-data defaults mean you stopped looking**: Fraunces, Playfair Display, Cormorant, Lora, Crimson, Newsreader, Syne, Space Grotesk, Space Mono, IBM Plex, Inter-as-display, DM Sans, DM Serif, Outfit, Plus Jakarta Sans, Instrument Sans. Naming one anyway requires a reason no other face could satisfy, and a subject association is never that reason: books wanting a serif, bookshops wanting hand-lettering, and tech wanting a mono are exactly the associations this list exists to break. Don't pair two faces that are similar but not identical; pair on a contrast axis, or use one family across weights.

Energy is not the enemy of trust: a brief's negative constraints (no gamification, no hype) rule out those devices, not exuberance, and adjectives describing the product's *behavior* (quiet support, calm coaching) do not dictate the surface's energy. A brief-pinned world pins the world, not its softest rendition — the pinned world's full material range stays in play. Before writing code, reread your own OWN-WORLD block: when it says cream, paper, parchment, ivory, or lamplight on a Persuade surface the brief never pinned, the rendition failed and you rework it from the world's saturated materials first.

## 5. Record the decision

**Before code**, state the chosen direction as a contract in the page's opening comment — five short blocks, 150 words at most, as an HTML comment placed as the first child of `<body>` so it survives any build step:

- **THESIS:** the one idea this surface owns, and the category-default arrangement it refuses.
- **OWN-WORLD:** the palette and component language, specific enough to be recognizable with all content removed.
- **STORY:** what the visitor understands, believes, and does.
- **FIRST VIEWPORT:** the exact composition — what is where, at what scale, and where the primary action sits.
- **FORM:** the chosen form, its position on your ordered list, and the palette seed if `palette.mjs` supplied one.

Close with one more line — **FINISH:** the run's exit condition, verbatim: `unreviewed and undocumented is unfinished; this build ends with the finish review, its verdict, and DESIGN.md`.

If a block reads like a mood, the direction is not decided yet. The comment tops the file you reopen on every edit; it is the one reminder that survives a long build. A page that looks complete with the FINISH line undischarged is not done, it is abandoned at the finish line.

On a new or replacement world, `DESIGN.md` is written **at finish, from the built page** (step 7) — a rulebook written before the build gets defended against reality instead of describing it. An ordinary extension does not rewrite `DESIGN.md`. If the work settles durable strategy for this page, write the surface brief now (`.impeccable/surfaces/<page-slug>.md`, per SKILL.md).

For `shape`, return the selected direction to [cmd-shape](cmd-shape.md) and stop before persistence or implementation.

## 6. Build with full commitment

Build the direction you presented, not a safer interpretation of it. The form supplies structure, reading order, component conventions, and native motion; the product supplies every fact. Commit every atom: nav, buttons, inputs, and links are rebuilt in the form's vocabulary, and a stock component inside a committed form is a lapse. Land the first build fully committed — committing is the hard part, and the passes that follow exist to make the committed thing clear and effective, never to dilute it.

**When an approved mock exists, the mock is the spatial contract, not a mood board.** Reproduce it first: rebuild the region until a `capture` at the mock's framing overlaps it near-exactly — materials, components, elevation, assets, and implied design language included. Exactly three concessions exist: fonts (the closest obtainable face), icons (exact match unless the user already chose a library), and genuine defects in the mock. Set the capture beside the freshly reopened mock, never beside your memory of it; models systematically believe their HTML/CSS/SVG recreation succeeded when it did not. When a region keeps losing that comparison, stop recreating it in code and produce it as a rendered asset composited into the page. The mock also outranks every written record of it: when your notes commit to less than the mock shows — a softer texture, a sparser field, a sculpted plate flattened to CSS — correct the record upward. Qualifiers like "subtle" and "restrained", and counts rounded down to a comfortable fraction, are how approved materials die between approval and build. Check colors by number, not by eye: sample the capture's ground, dominant fields, and accents and set them against the recorded values; a difference with a color name (warmer, grayer, darker) is drift to fix, a few digits of compression noise is the same color. Only when reproduction holds do motion, interaction, and responsiveness get added.

- **The first viewport is a thesis, not a header.** Demonstrate the mechanism immediately, at the scale the form has in life; do not trap the concept inside a standard hero shell. The memory test: if someone left after one viewport, what would they describe an hour later? If the honest answer is a mood, the concept has not committed yet.
- **Prove the hero before building past it.** Render the first viewport, `capture` it, and judge it against the direction (and the mock, when one exists) before any later section. The hero carries the run's ambition and every following section inherits its shortfall. Judge scale and density as quantities — a field at a tenth of the intended coverage, or type at half its weight, is a different design — and a two-minute retry here is what a rebuild verdict costs later.
- **Prove, don't claim.** Show the subject doing its job: the interface at work, the mechanism dramatized, specifics a competitor could not copy-paste. Sections that restate a claim in different words add length, not substance.
- **Author the assets; never substitute chrome.** Great surfaces live on carefully made content: names, entries, copy, covers, thumbnails, textures. Gradients, glass, and generic icon tiles where an authored asset belongs are the gap wearing chrome. Icons drawn in the world's own grammar are the remedy, not the target.
- **Build the form's web leverage.** When the chosen world names a technique (canvas, WebGL, view transitions, generative motion), build the technique itself, not a static imitation of it. The graceful fallback serves constrained clients; it is not the default experience.
- **Pace the scroll like a studio.** Vary density, scale, image, motion, and quiet inside one grammar — a dense passage earns a quiet one — and end the page anchored by a real close. One spacing rhythm throughout, with more space above a heading than below it.
- **Use real, verified imagery when the brief implies it.** Search for the subject's physical object rather than the category; one decisive photo beats five mediocre ones. Verify that any external URL resolves.
- **Author motion as material.** The form has native motion — what it does in life between states. Give the page that motion once, orchestrated, rather than scattered hover effects. Bound expensive effects and keep content visible by default.

Preserve semantics, accessibility, performance, responsiveness, content-set conventions, and working behavior throughout.

## 7. Inspect and finish

Inspect in **one batched round**, then at most one more. Use the viewer's `capture` action (SKILL.md, "Verifying your work") — never an external browser, which renders the files outside their content set and shows you something the user is not looking at.

- Capture the full page, then each major section as its own crop at legible scale. A single full-page thumbnail hides exactly the failures that matter: crude controls, wrong lettering character, flattened material behind a superficially similar section order.
- Settle or disable entrance motion before capturing — an element hidden by animation timing reads as a missing element and gets "fixed" into a regression.
- Then open every capture and confirm it shows what its name claims: no black or blank regions, no half-loaded state. **A capture that is invalid is evidence of nothing, and no verdict may rest on it** — retake it and run the review again.
- `capture` shoots the live viewer at its current viewport, so responsive claims are not evidence you can produce alone. Verify the responsive composition by reading the real breakpoints and clamp scales with the actual copy in place, and when a width genuinely matters, ask the user to set the viewport and say what they see.

Critique the render against the user's request and against the direction contract, promise by promise. On a Persuade surface, verify the mode did its job: a first-time visitor should know what this is, why it matters, and what to do, within seconds, in the form's own vocabulary.

**Run the review from outside the build.** When the backend exposes a Task tool, spawn a fresh sub-agent for the finish review with no forked conversation history, and give it: the original request, the confirmed answers, the page path, the capture paths, the direction contract, the approved mock path when one exists, and [craft-floor.md](craft-floor.md). A reviewer that inherits your transcript inherits your framing, your optimism, and your abstractions. Without a Task tool, run the pass in-thread after stepping fully out of the build context, and say in one line that the review was in-context (`DEGRADED: single-context finish review`) — a substituted review is disclosed, never silent.

The review ends on **a derived verdict, computed from what the captures show, not felt**. Report it under its own word, at its actual scope:

- **rebuild** — fidelity failed wholesale, not in patches. Skip the fix batch, re-derive the named regions, produce the named assets, and run a full review again over fresh captures. Tell the user what is happening rather than asking permission to fix a failure. Consult them on a second rebuild directive, or when rebuilding would discard content they approved.
- **fix** — apply the material fixes in **one batch**, rebuild once, recapture the same views, and score every fix `resolved`, `partial`, or `unresolved` against the new evidence. Items still open earn one more round. Two rounds is the budget an unattended run ends at; in an attended session, put the table in front of the user and let them choose between shipping as it stands and funding another round. Stop the moment a round resolves nothing, and work only from the review's findings — never from a re-opened hunt of your own.
- **ship** — nothing is owed. Report the verdict at its scope and go document.

A verdict pass scores the listed fixes and nothing else: "all three fixes scored resolved" is a claim it supports; "no material issues remain" is not. A table with open findings is never announced as a pass. **When the user answers a ship with evidence against it** — their own screenshot, a named mismatch with the mock — that evidence outranks every capture you made: put their material in the packet and run a fresh full review. Patching inline and self-certifying is how a rejected page ships twice.

Then record the world: run the `document` flow ([cmd-document](cmd-document.md)) over what actually shipped, ground truth over intention, and re-run it if any later fix round changes the surface — a `DESIGN.md` describing a layout that no longer exists turns defects into system guidance. A clean page is not finished. Finished is the contract kept, the review closed, and the system recorded.
