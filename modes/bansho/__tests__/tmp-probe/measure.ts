import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLecture } from "../../domain.js";
import { graphLayout } from "../../engine/factories/graph.js";
import type { GraphFrameStep } from "../../engine/types.js";

const SEED_DIR = join(import.meta.dir, "..", "..", "seed");
for (const id of ["tech-zh", "tech-en", "pitch-zh", "pitch-en"]) {
  const src = readFileSync(join(SEED_DIR, id, "board.md"), "utf8");
  const lecture = parseLecture(src);
  const steps = lecture.sections.flatMap((s) => s.steps);
  const frames = steps.filter((s) => s.kind === "graph-frame") as GraphFrameStep[];
  for (const f of frames) {
    const l = graphLayout(f);
    console.log(`${id}  graph="${f.graph}"  natural ${l.width} x ${l.height}  nodes=${f.layout.nodes.length} edges=${f.layout.edges.length}`);
    for (const [, b] of l.boxes) console.log(`    box ${b.name}: ${b.w}x${b.h} at (${b.x},${b.y}) noteLines=${b.noteLines.length}`);
  }
}
