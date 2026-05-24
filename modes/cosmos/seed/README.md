# Welcome to Cosmos

This workspace ships with one example projection so you can see what
cosmos does before you bring your own content.

- **`input.md`** — a 500-word original mystery scene, *The Antiqued Map*.
- **`cosmos.json`** — the agent's structured projection of that scene
  into 22 nodes (characters, objects, places, events, clues, inferences)
  and 19 typed edges. Open the viewer to explore it.

## Try it on your own content

1. **Replace `input.md`** with whatever you want to understand —
   a chapter, a paper, a codebase tarball, a long thread, a brief.
   Anything with internal structure.
2. **Ask the agent** to re-project it ("regenerate the cosmos from the
   new input" or just click the **Re-project** command in the viewer).
3. The agent reads, picks a vocabulary fit for your content's domain,
   and rewrites `cosmos.json`. The viewer re-renders live.

The vocabulary is open — for code the agent will use *file / function /
class / depends_on*; for prose, *character / event / clue / supports*;
for research, *claim / evidence / refutes*; for business, *domain /
flow / step*. You can also ask the agent to use a specific vocabulary.

## What you can do in the viewer

- **Click a node** to select it. The agent sees a `<viewer-context>`
  block with its address; ask "tell me more about this" and it knows
  exactly what.
- **Click a layer** in the sidebar to focus on it (dims the rest).
- **Density toggle** at the top of the sidebar — Overview shows labels,
  Learn adds summaries, Deep-dive adds tags.
- Ask the agent for a **guided tour** — it can step you through the
  cosmos in a curated order using the `tour[]` already in cosmos.json.

That's it. Replace, re-project, explore.
