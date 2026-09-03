/**
 * The learner's main line, derived — not read — from the course.
 *
 * `path[]` is the director's bookkeeping of what was watched, and it can
 * be short of the truth (the first live course had `["n2b"]`: no root, and
 * the segment the learner was actually on was missing because they had
 * opened it from the rail). The line the rail shows and the map
 * highlights is therefore built from what cannot drift: the tip is the
 * last recorded segment that exists, and the line is its ancestor chain by
 * `parent` links. What "continue" means right now is the tip's
 * continuations.
 */

import type { ChoiceRef, CourseNode, CourseSet } from "../domain.js";

export interface MainLine {
  /** The segment the learner's line currently ends on; null when the course has no root yet. */
  tip: string | null;
  /** root → tip, the segments the learner actually took. */
  spine: string[];
  /** The tip's continuations — the choices that extend the line. */
  next: ChoiceRef[];
}

/** root → id by parent links; stops at a missing node or a cycle. */
export function ancestorChain(nodes: Record<string, CourseNode>, id: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && nodes[cur] && !seen.has(cur)) {
    seen.add(cur);
    chain.unshift(cur);
    cur = nodes[cur].parent;
  }
  return chain;
}

export function mainLine(set: Pick<CourseSet, "nodes" | "path" | "rootNode">): MainLine {
  const recorded = [...set.path].reverse().find((id) => !!set.nodes[id]);
  const tip = recorded ?? (set.nodes[set.rootNode] ? set.rootNode : null);
  if (!tip) return { tip: null, spine: [], next: [] };
  return { tip, spine: ancestorChain(set.nodes, tip), next: set.nodes[tip].children };
}
