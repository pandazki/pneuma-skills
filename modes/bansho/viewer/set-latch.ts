/**
 * Content-set resolution + the live-join latch — the two decisions that
 * decide WHICH lecture the board shows and WHERE the player joins it.
 * Pure core, unit-tested; BanshoPreview wires the store into it.
 *
 * Both used to live inline in the viewer and both were wrong in the same
 * place: the seeded-board opening.
 *
 * 1. `resolveSetKey` — the lecture and the theme must resolve through ONE
 *    key. The viewer used to fall back `byContentSet[active] ?? [""] ??
 *    first` for the lecture but only `themeCss[active] ?? [""]` for the
 *    theme, so during the pre-selection window (content sets exist,
 *    `activeContentSet` still null because the matcher is async) a seeded
 *    board rendered a real lecture with NO theme.css at all. Invisible only
 *    while the shipped seeds' stacks happen to equal `BOARD_BASE_CSS`.
 *
 * 2. `joinDecision` — `null → "tech-zh"` is the SAME opening as the one the
 *    hydration latch already judged, not a user switching boards. Re-latching
 *    on it read `lecture !== null` at a moment when the fallback lecture was
 *    already non-null, so a board that arrived from the seed gallery — the
 *    live broadcast case, latched at hydration as "play from 0" — was
 *    converted to history and joined at its tip: the demo appeared fully
 *    written, in one frame, and never performed. Only a genuine
 *    prefix → prefix switch is a new opening to judge.
 */

/** Store shape this core reads — `null` = "not resolved yet", "" = root. */
export type SetKey = string | null;

/**
 * The opening verdict: where the FIRST compiled timeline joins. Decided
 * from the HYDRATION SNAPSHOT (`filesAtHydration` — the paths present
 * when the workspace finished its initial load), never the live file
 * list. The third wrong path both module-header bugs share a root with:
 * on an empty workspace with seeds declared, the app shell shows the seed
 * gallery INSTEAD of the viewer, so the viewer's first mount happens only
 * after seed content landed — a latch reading live files at that moment
 * sees board.md, judges the board pre-existing, and the freshly seeded
 * demo appears fully written in one frame, never performed. The question
 * is "was this board there when the WORKSPACE opened" ("has it been
 * performed before", to the limit of what disk can answer), and only the
 * snapshot answers it: existed at hydration → history, join at the tip
 * (zero replay — F22); absent → the first compile IS the live broadcast,
 * play from 0 (R2). `null` (not hydrated yet) leaves the latch open — the
 * caller's conservative default (tip) applies, so a slow initial fetch
 * can never replay an existing board.
 */
export function hydrationJoin(
  hydratedPaths: readonly string[] | null,
): boolean | null {
  if (hydratedPaths === null) return null;
  return hydratedPaths.some(
    (p) => p === "board.md" || p.endsWith("/board.md"),
  );
}

/**
 * The key BOTH the lecture and the theme resolve through. `null` when the
 * board carries nothing at all.
 *
 * `active` is the store's raw value: `null` before the async matcher picks
 * a set. It is treated exactly like the root key — the fallback chain is
 * what covers the pre-selection window, and it has to be one chain.
 */
export function resolveSetKey(
  availableKeys: readonly string[],
  active: SetKey,
): string | null {
  if (availableKeys.length === 0) return null;
  const wanted = active ?? "";
  if (availableKeys.includes(wanted)) return wanted;
  if (availableKeys.includes("")) return "";
  // Pre-selection fallback: SORTED, deterministically — the caller passes
  // Object.keys(byContentSet), whose order is readdir + watcher insertion
  // order, while the async matcher resolves through the alphabetically
  // sorted `contentSets`. Picking by insertion order made the transient
  // pre-selection render (and its full compile) land on a
  // filesystem-order-dependent board with 2+ sets on disk; sorting makes
  // the transient board the same one the matcher will usually name.
  return [...availableKeys].sort()[0]!;
}

/**
 * What an `activeContentSet` (SELECTION) transition means for the join
 * latch. Returns the latch's new value, or `null` for "leave it alone".
 *
 *  - `prev === next` — nothing happened.
 *  - `prev === null` — the async content-set matcher just named the OPENING
 *    the hydration latch already judged. Same board, same opening; keep the
 *    latch. Re-judging here is what turned a seeded board into history.
 *  - otherwise — the user switched to a DIFFERENT board. That board is
 *    being opened now, so it gets its own verdict: existing content = join
 *    at the tip, empty = its first compile is the live broadcast.
 *
 * Note this tracks the SELECTION, not the rendered key: dropping the
 * compiled board is a separate decision that must follow the RENDERED key
 * (`resolveSetKey`), because that is what BoardCanvas is keyed on and only
 * a remount produces a new compile. Coupling the two dropped a compiled
 * board that was never rebuilt — the board rendered, the transport read
 * 0.0s/0.0s forever.
 */
export function relatchOnSelectionChange(
  prev: SetKey,
  next: SetKey,
  /** Whether the set being switched TO already has content. */
  nextHasLecture: boolean,
): boolean | null {
  if (prev === next) return null;
  if (prev === null) return null;
  return nextHasLecture;
}
