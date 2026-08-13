(opts) => {
  const board = document.querySelector(".bansho-board");
  if (!board) return { error: "no board" };
  // W3 — the 瑕疵 layer is PAINT-TIME (per-block lean, per-word drift), so
  // `getBoundingClientRect` reports the leaned box while `offset*` keeps
  // reporting the canonical one. This probe's job is CANONICAL layout, so
  // it lifts the layer for the whole read exactly the way `boardRects`
  // does — one attribute, restored in `finally`. A board with the knob at
  // 0 (or on code that predates W3) carries no attribute, so this is a
  // no-op and captures either side of W3 stay directly comparable.
  //
  // Pass `{ asPainted: true }` for the OTHER leg: what the reader actually
  // sees. The two together are the proof — `rect` moves, and
  // `boardLayoutWidth` / `boardLayoutHeight` / `margins` / `paths` / `svgs`
  // do not.
  const surface = document.querySelector(".bansho-board-surface");
  const flawed =
    !(opts && opts.asPainted) &&
    surface !== null &&
    surface.hasAttribute("data-bansho-flawed");
  if (flawed) surface.removeAttribute("data-bansho-flawed");
  // W7 — the CAMERA is suspended for the read too, for the same reason and
  // by the same mechanism. Once a board has a fixed canonical size the
  // at-rest zoom is `viewW / PANEL_WIDTH`, not 1, so `scale` below stops
  // being 1 and every reading would be divided by a DIFFERENT float at
  // every window width. Board coordinates are dyadic-ish (1/64 LayoutUnits)
  // and the divide is not exact, so a row sitting on a .xx5 boundary would
  // flip by 0.01 between two windows — an instrument artefact indistinguish-
  // able from moved ink, in exactly the gate that exists to prove nothing
  // moved. Suspended, `scale` reads 1 at EVERY width and the divide is the
  // identity, so the two-width diff is byte-identity with no exclusions.
  //
  // No-op wherever the camera was already at rest AND rest meant identity —
  // which is every capture taken before W7 — so captures either side of it
  // stay directly comparable. (Same shape as the flaw suspension above and
  // as `boardRects`' depth lift: one inline style, restored in `finally`.)
  const suspended = (opts && opts.asPainted)
    ? []
    : [".bansho-stage", ".bansho-depth"]
        .map((sel) => document.querySelector(sel))
        .filter((el) => el !== null)
        .map((el) => {
          const was = el.style.transform;
          el.style.transform = "none";
          return { el, was };
        });
  try {
    return read();
  } finally {
    for (const s of suspended) s.el.style.transform = s.was;
    if (flawed) surface.setAttribute("data-bansho-flawed", "");
  }

  function read() {
  const base = board.getBoundingClientRect();
  // Empirical accumulated scale — 1 before C1, non-1 once the stage transforms.
  const scale = board.offsetWidth > 0 ? base.width / board.offsetWidth : 1;
  const round = (n) => Math.round(n * 100) / 100;
  const boardRect = (el) => {
    const b = el.getBoundingClientRect();
    return [
      round((b.left - base.left) / scale),
      round((b.top - base.top) / scale),
      round(b.width / scale),
      round(b.height / scale),
    ];
  };
  // The board's own padding: the frame every box coordinate is quoted in.
  // `rect` is board-BORDER-relative, so the §7.5 y-oracle needs the padding
  // to convert between "distance down the content face" (what the fold
  // computes) and "distance from the board's top edge" (what `rect` reads).
  const bs = getComputedStyle(board);
  const pad = [
    round(Number.parseFloat(bs.paddingTop) || 0),
    round(Number.parseFloat(bs.paddingRight) || 0),
    round(Number.parseFloat(bs.paddingBottom) || 0),
    round(Number.parseFloat(bs.paddingLeft) || 0),
  ];
  const steps = [];
  for (const n of board.querySelectorAll("[data-bansho-ref]")) {
    // Ink `d` strings, recorded PER BOX (canvas pivot §12.2 item 4). The
    // box is the step element itself, so this traversal already scopes each
    // path to its box: a box that MOVES carries its ink with it and every
    // `d` here must stay byte-identical. Recorded before the box model
    // lands, deliberately, so both sides of the re-basing A/B speak the
    // same format (README "honest refresh" discipline).
    const paths = [];
    for (const p of n.querySelectorAll("svg path")) {
      paths.push(p.getAttribute("d") || "");
    }
    const svgs = [];
    for (const s of n.querySelectorAll("svg")) {
      svgs.push([
        s.getAttribute("viewBox") || "",
        s.style.left || "",
        s.style.top || "",
        s.style.width || "",
        s.style.height || "",
      ].join("|"));
    }
    // A `display:none` step (an unmaterialised chart layer) reports an
    // all-zero client rect, so `boardRect` would record pure camera echo
    // rather than geometry — stable within one capture, garbage across two
    // taken at different camera positions. Record the fact instead of the
    // number, and let the comparator treat a one-sided `hidden` as a
    // structural failure. Its rendered content is the container's SVG paths,
    // which are compared exactly like everything else.
    const r = n.getBoundingClientRect();
    const hidden = r.width === 0 && r.height === 0;
    // The §7.5 spacing model's inputs, read straight off the mounted box:
    // `gap(a,b) = max(marginBottom(a), marginTop(b))`. `rect[3]` is the
    // BORDER box, so h and the margins are separate numbers — exactly what
    // the y-oracle consumes. Recording them on the OLD code is what makes
    // the oracle non-circular: it is fed the old build's reality.
    const cs = getComputedStyle(n);
    const margins = [
      round(Number.parseFloat(cs.marginTop) || 0),
      round(Number.parseFloat(cs.marginBottom) || 0),
    ];
    steps.push({
      ref: n.getAttribute("data-bansho-ref"),
      // First class token — the block type, so a y delta can be attributed
      // to a KIND of block (heading / paragraph / list) rather than to a
      // bare step index.
      cls: (n.getAttribute("class") || "").split(/\s+/)[0] || "",
      ...(hidden ? { hidden: true } : { rect: boardRect(n) }),
      margins,
      paths,
      svgs,
    });
  }
  return {
    scale: round(scale),
    boardLayoutWidth: board.offsetWidth,
    boardLayoutHeight: board.offsetHeight,
    boardPadding: pad,
    stepCount: steps.length,
    steps,
  };
  }
}
