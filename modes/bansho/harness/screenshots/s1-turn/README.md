# S1 G7 evidence — `@turn` walks to a clean board

Captured 2026-08-10 by the coordinator, not the implementer: S1's report
disclosed that G7 and the layout A/B were not run (wall-clock budget), so
both were run here rather than accepted on the construction argument.

Board: `~/bansho-boards/_all/turn-demo/` (`@board 2`, one `@turn`, closing
`@overview`). Dark theme, viewport 1600×1100, dev server on **17997** —
the ready line advertises 17996 and 404s, a known framework bug.

| File | What it shows |
|---|---|
| `turn-final.png` | End state (t = 16.7s). Board 1 holds the whole first topic — heading, the highlighted 结论, the two list items, the hand-off line. Board 2 holds only what was written after `@turn`. The script pane shows `@turn` between them. |

**The verdict this evidence supports:** `@turn` does what its semantics
claim and nothing more. DOM probe at the same moment: 2 panels, **8 steps
on board 1 and 2 on board 2** — the pen moved, the standing content stayed.
That is the whole point of the verb: `@erase` would have destroyed the
first topic, and drifting into overflow would not have happened at all
(the first board is nowhere near full — it is at 8 steps of a 2-board room
with plenty of room left). Only an explicit turn produces this shape.

**Also verified in the same session (not pictured):** the layout-baseline
A/B. `fourier` / `kelly` / `brain` — none of which use any stage verb —
captured on this branch and on `471d9fa` back-to-back with the same probe:
**byte-identical on all three.** The glance and the turn are geometry-inert
for boards that do not use them.
