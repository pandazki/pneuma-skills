# Audience Calibration

> The full taxonomy behind ELI5 Mode's ladder. Adapted from the upstream ELI5
> skill (DreambigOu/ELI5, MIT — see `../../NOTICE.md`), extended with the page
> visual register each audience's HTML page should carry.

Open this before writing a page. Find the row for your audience, take four
things from it — **vocabulary ceiling**, **analogy domain**, **framing**,
**visual register** — and design the page from those rather than from a general
sense that this person is "less technical".

Two rules cut across every row:

- **The reader is not the topic's junior.** They are an expert in something
  else who needs one thing from your field. A page that treats their unfamiliarity
  as a deficiency fails no matter how accurate it is.
- **The analogy domain is the lever.** Vocabulary and length are adjustments;
  the analogy is the actual translation. A manager understands a database index
  through queue times and headcount, a nine-year-old through a toy box, and
  reaching for the wrong domain loses the reader in the first paragraph even
  when every word is simple.

---

## Ages

| Audience | Vocabulary & sentences | Analogy domain | Framing | Page visual register |
|---|---|---|---|---|
| **Age 5** | Everyday words only. One idea per sentence. No term survives unless it is immediately re-said in kid words. | Toys, animals, snacks, the playground, hide-and-seek, tidying up a room. | "Here is a fun thing, and here is how it works." Curiosity, never obligation. | Rounded sans, body 22–28px, headings 48–72px, bright crayon palette on warm off-white, big SVG shapes, well under one screen of real text. |
| **Age 10** | Simple but not baby words. Cause and effect is fine — "because", "so that", "if … then". | School, sports, video games, collecting things, group projects, pocket money. | "How it works, and why it's clever." They will accept a mechanism if it has a payoff. | Rounded-to-geometric sans, body 20–22px, saturated but slightly cooler palette, numbered step strip, a simple labelled diagram. |
| **Age 15** | Abstraction is fine. Real terms are fine when you define them once. Casual register — never *performed* casual. | Phones, social platforms, games, music, group chats, part-time work. | "This is actually how the thing you already use works." Respect, plus a hook. | Confident geometric sans, body 18–20px, bold single accent, pull quotes, chunky badges, skimmable sections. |
| **Age 20–30** | Direct and unpadded. Common technical terms are safe; specialist jargon is not. | Rent, jobs, money, apps, commuting, planning a trip, splitting a bill. | "Here's what it is, here's what it means for you." Practical over theoretical. | Clean modern sans, body 17–19px, contemporary restrained palette, one clear figure, medium density. |
| **Age 40+** | Clear and complete. Respectful of long experience in other domains. | Home ownership, careers, managing a household or a team, insurance, long-term planning. | "This is the same problem you already solve elsewhere, in a different medium." | Comfortable humanist sans or serif, body 18–20px, calm neutral palette, generous line-height, unhurried structure. |

**On age labels.** They are stand-ins for reading level and life experience, not
literal birthdays. A user asking for "an age 5 explanation" usually wants the
*delight and clarity* of that register — write the page a curious child could
follow and an adult would enjoy reading aloud.

---

## Grade / education levels

| Audience | Vocabulary ceiling | Depth | Framing | Page visual register |
|---|---|---|---|---|
| **5th grade** | Concrete words. Zero jargon — not "jargon with a definition", none. | The single core idea plus one consequence. | "Think of it like …" all the way through. | As Age 10: rounded sans, big type, bright, a step strip, one screen. |
| **Middle school** | Basic terminology allowed, each defined at first use. | Step-by-step logic; two or three linked ideas. | "First this happens, then this, and that's why …" | Geometric sans, body 19–20px, colour-coded steps, a simple numbered flow diagram. |
| **Senior high** | Proper terms, briefly explained. Moderate complexity is fine. | Mechanism plus one interesting complication. | "The real version has a wrinkle, and here it is." | Clean sans, body 17–18px, a modest accent, sidebars for definitions, a real diagram. |
| **College student** | Technical terms with brief context. Theory *and* application. | Full mechanism, named concepts, one worked example. | "Here's the model, here's how it shows up in practice." | Academic-clean sans, body 16–17px, restrained palette, a figure with a caption, a small code or formula block where it earns its place. |
| **Graduate school** | Full domain vocabulary. Defining basics wastes their time and reads as condescension. | Nuance, trade-offs, edge cases, failure modes, what the standard account gets wrong. | "You know the textbook version; here is where it is interesting." | Dense technical layout, body 15–16px, mono for anything symbolic, an explicit trade-offs table, references or footnotes. |

---

## Job roles

| Audience | They care about | Frame around | Page visual register |
|---|---|---|---|
| **Manager** | Impact, timeline, risk, cost, who is affected. | Business outcomes and the decision in front of them. Lead with the answer; put the mechanism below the fold, or leave it out. | Memo-shaped: answer in the first screen, neutral professional sans at 16–17px, one accent, number tiles, a cost/benefit table, a decision box at the end. Quantify or cut. |
| **Director** | Strategy, ROI, competitive position, resource allocation. | Big picture and second-order effects. One level higher than the manager page — less "what we should do this sprint", more "what this changes about our position". | Executive-brief: strong opening statement, 3–4 stat tiles, a one-figure strategic diagram, generous whitespace, no implementation detail at all. |
| **Product manager** | User value, priorities, scope, what to build vs skip. | Feature impact and the boundary of the work. Say plainly what is cheap, what is expensive, and what is a trap. | Structured product-brief: crisp sans, a scope table (in / out / later), user-facing framing, one flow diagram, an explicit "what this costs us" section. |
| **Engineer** | How it works, architecture, trade-offs, failure modes, maintenance cost. | Technical mechanics. Use real terminology — hedging it reads as being talked down to. Compare to structures they already know. | Precise: prose sans plus a real mono, body 15–16px, cool muted palette, annotated code block, complexity notes, an explicit trade-offs section, inline SVG diagrams. No illustration. |
| **Designer** | User experience, visual impact, flow, accessibility. | How it changes what the user perceives and does — latency, state, error surfaces, what becomes possible. | Visual-first: editorial type pairing, strong type contrast, before/after or flow figures given real space, a deliberate palette that itself demonstrates taste. |
| **Colleague / teammate** | Practical context and what they need to collaborate. | How it affects their work specifically. Assume shared context; skip the preamble. | Working-doc: readable sans at 16–17px, minimal decoration, a "what changes for you" section, a short checklist, one diagram if there is a handoff to draw. |
| **Executive / CEO** | The decision, the number, the risk. | One page, one thesis, one recommendation. | The most compressed rung there is: a headline claim, three supporting numbers, one line of risk, one line of ask. Anything longer is not this audience. |

---

## Relationships

| Audience | Tone | Analogy domain | Page visual register |
|---|---|---|---|
| **Partner (wife / husband / spouse)** | Warm, conversational, patient. The register of talking over dinner, not presenting. | Household tasks, shared routines, things you both did last week, money you manage together. | Warm serif or humanist sans, body 19–21px, soft low-saturation palette, roomy margins, minimal decoration, personal second-person voice. |
| **Parents / grandparents** | Respectful and clear, with zero condescension. Slower, but never simpler than they are. | Technology they already use, home and repair analogies, generational bridges ("it's like the phone book, but the phone book updates itself"). | Large warm serif, body 20–22px, line-height 1.8+, high contrast, big touch-sized links, generous spacing, one gentle illustration at most. |
| **Kids / children** | Playful and encouraging. Short. Let them feel clever at the end. | Games, cartoons, school, animals, building blocks. | As Age 5 / Age 10 depending on stated age: rounded type, bright palette, huge headings, a story strip, one meaningful emoji if it carries real meaning. |
| **Friend** | Casual, occasionally funny, unpolished on purpose. | Pop culture, shared interests, "you know how …". | Relaxed modern sans, body 17–18px, a personality accent colour, an aside or two, low formality — but still a designed page, not a text message. |
| **Client / customer** | Professional, reassuring, non-defensive. Especially when explaining a failure. | Their business, their workflow, the outcome they bought. | Polished neutral: restrained palette, clear headings, a plain-language summary box up top, an explicit "what happens next" section. |

---

## Language calibration

Three broad modes cut across the tables. Once you know which one a page is in,
a lot of small decisions answer themselves.

### Simple audiences — young ages, family, non-technical roles

- **No jargon. Zero.** If a term is genuinely unavoidable, define it in the
  same breath and then keep using the plain phrase, not the term.
- **One idea per sentence.** Two clauses joined by "and" is usually two
  sentences pretending to be one.
- **Concrete beats abstract.** "The server is like a waiter who takes your
  order to the kitchen" beats "the server handles client-server communication",
  and it is not less true — it is the same truth at a resolution they can hold.
- **Use "you" and "your".** Second person turns a description into something
  happening to the reader.
- **Length is short.** A kid's page that runs three screens has already lost.

### Technical audiences — engineers, grad students

- **Use proper terminology.** Explaining what a hash map is to someone who
  writes them daily is the fastest way to lose their attention.
- **Spend the page on the interesting part** — trade-offs, edge cases, why the
  obvious design was rejected, what breaks under load.
- **Anchor to what they know**: "it's a B-tree, but the leaves are chained so
  range scans don't have to walk back up".
- **Be concise.** Respecting their existing knowledge is itself a form of
  clarity.
- **Be exact.** This is the one rung where an approximation reads as an error.
  Give real complexities, real names, real caveats.

### Business audiences — managers, directors, PMs

- **Lead with impact,** not mechanism. The first screen must be able to stand
  alone as the whole answer.
- **Quantify.** "Roughly 40% of peak-hour queries" is a fact they can act on;
  "a lot of queries" is not.
- **Skip implementation detail** unless it changes a decision. If it does,
  compress it to the sentence that changes it.
- **Frame as decisions.** End on "this means we should …", with the options and
  what each costs. A business page that ends on a description has not finished.

---

## Tone matching

| Audience band | Voice |
|---|---|
| **Ages 5–10** | Enthusiastic, like a favourite teacher who is genuinely delighted by the thing. "Oh, this one's fun." |
| **Teenagers** | Slightly casual, never performed. No adult impression of teen slang; the fastest way to be dismissed. |
| **Professionals** | Confident and clear. Bridge the knowledge gap without narrating the gap. |
| **Family** | Patient, warm, conversational — explaining over dinner, not from a lectern. |
| **Executives** | Decisive. State the conclusion, support it, stop. |

---

## Choosing the ladder

- **The user named one audience** → build a one-rung ladder. A single tailored
  page is a complete explainer; offer to add rungs afterwards rather than
  guessing at extras they did not ask for.
- **The user named several** → use their order if it is already simplest-first,
  otherwise reorder to climb and say that you did.
- **The user named none** → default to **age 5 → manager → engineer**. Those
  three sit far enough apart that the register shift is obvious, and they cover
  the three questions people actually have: *what even is this*, *what does it
  cost me*, *how does it really work*.
- **An audience with no row here** (a nurse, a lawyer, a musician, a specific
  named person) → build the row yourself before writing. Name their daily
  domain (that is the analogy source), name what they are accountable for (that
  is the framing), name their vocabulary ceiling in *your* field, then pick the
  closest visual register row and adjust. Write the result into the manifest
  entry's `tone` field so the next session inherits it.

---

## Quality check before you call a page done

- Does the first sentence say what the thing *is*, without machinery?
- Does the analogy come from a domain this specific reader lives in?
- Is there a "so what" that names why *they* should care?
- Is everything on the page true — simplified, but not invented?
- Does the page *look* like it was designed for this person, not restyled from
  the rung next to it?
- Read side by side with its neighbour rung: is the difference obvious in the
  first two seconds? If not, one of the two is not committed to its register.
