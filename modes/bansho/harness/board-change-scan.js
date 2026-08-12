/**
 * The board-change scan — "does every change of the board under the camera
 * carry motion, or is it a cut?"
 *
 * Scrubs the timeline through the app's OWN slider (no store poke, no test
 * hook), and at each sample records (a) which panel the viewport centre is
 * looking at and (b) whether a transition is in flight (`.bansho-depth`
 * wears a pose only DURING a move — it is empty at rest by construction,
 * V1.5). A board change with an empty depth surface at both brackets is a
 * cut; one with a pose is a walk.
 *
 * Returns JSON: { duration, samples, changes: [{from,to,t0,t1,active}] }.
 */
(async () => {
  const track = document.querySelector('[role="slider"][aria-label="Timeline"]');
  if (!track) return JSON.stringify({ error: "no timeline slider" });
  const duration = Number(track.getAttribute("aria-valuemax"));
  const panels = [...document.querySelectorAll(".bansho-panel")];
  const depth = document.querySelector(".bansho-depth");
  const stage = document.querySelector(".bansho-stage");
  if (!panels.length || !depth || !stage) return JSON.stringify({ error: "no board" });

  const viewport = document.querySelector(".bansho-viewport");
  const seek = (t) => {
    const r = track.getBoundingClientRect();
    const x = r.left + (t / duration) * r.width;
    const y = r.top + r.height / 2;
    const opts = { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 };
    track.dispatchEvent(new PointerEvent("pointerdown", opts));
    track.dispatchEvent(new PointerEvent("pointerup", opts));
  };

  /** Which board is the camera looking at: the panel covering the viewport
   *  centre (post-transform viewport coordinates — what the eye sees). */
  const boardAt = () => {
    const vr = viewport.getBoundingClientRect();
    const cx = vr.left + vr.width / 2;
    let best = -1;
    let bestD = Infinity;
    panels.forEach((p, i) => {
      const r = p.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right) {
        best = i;
        bestD = -1;
        return;
      }
      const d = Math.min(Math.abs(cx - r.left), Math.abs(cx - r.right));
      if (bestD >= 0 && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const step = Number(window.__SCAN_STEP__ ?? 0.1);
  const samples = [];
  for (let t = 0; t <= duration + 1e-9; t += step) {
    seek(t);
    samples.push({
      t: Math.round(t * 100) / 100,
      board: boardAt(),
      depth: depth.style.transform !== "",
      stage: stage.style.transform,
    });
  }
  const changes = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].board !== samples[i - 1].board) {
      // A change is "carried" when a transition is in flight anywhere in
      // the bracket it happened in — the depth surface is only ever worn
      // mid-move.
      const w = samples.slice(Math.max(0, i - 3), Math.min(samples.length, i + 3));
      changes.push({
        from: samples[i - 1].board,
        to: samples[i].board,
        t0: samples[i - 1].t,
        t1: samples[i].t,
        active: w.some((s) => s.depth),
      });
    }
  }
  return JSON.stringify({
    duration,
    step,
    samples: samples.length,
    active: changes.filter((c) => c.active).length,
    total: changes.length,
    changes,
  });
})()
