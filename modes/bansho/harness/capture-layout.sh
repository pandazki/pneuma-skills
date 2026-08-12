#!/bin/bash
# Capture the layout baseline for every demo board.
#
# Two legs per content set, and the second one is the point:
#
#   $SET.json        the BOARD projection — step boxes (board-relative,
#                    scale-normalised), their margins, and every ink `d`.
#   $SET.notes.json  the NOTES projection — the same lecture laid out as one
#                    CSS-flow strip. The canvas pivot deliberately leaves the
#                    notes projection in flow (design §8), which makes it the
#                    surviving byte gate: a notes diff means the parser, the
#                    six factories, in-box ink or the measurement pipeline
#                    moved — none of which the box model is allowed to touch.
#
# Both legs must be captured back-to-back in ONE browser session on each side
# of the A/B; see layout-baseline/README.md for why cross-session diffs lie.
set -u
OUT="${1:?usage: capture-layout.sh <outdir>}"
PROBE="$(cd "$(dirname "$0")" && pwd)/probe-layout.js"
mkdir -p "$OUT"

view() {
  # Flip the board/notes projection through the UI's own control — no test
  # hook, no store poke: the toggle is component state, and clicking it is
  # the only honest way in.
  chrome-devtools evaluate_script "() => {
    const group = document.querySelector('[aria-label=\"Board or lecture notes view\"]');
    if (!group) return 'no-toggle';
    for (const b of group.querySelectorAll('button')) {
      if (b.textContent.trim() === '$1') { b.click(); return '$1'; }
    }
    return 'no-button';
  }" >/dev/null 2>&1
}

for SET in fourier kelly brain; do
  chrome-devtools evaluate_script "() => { window.__PNEUMA_STORE__.getState().setActiveContentSet('$SET'); return '$SET'; }" >/dev/null 2>&1
  sleep 6
  chrome-devtools evaluate_script "$(cat "$PROBE")" --output-format json --filePath "$OUT/$SET.json" >/dev/null 2>&1
  echo "$SET board -> $(wc -c < "$OUT/$SET.json" 2>/dev/null || echo MISSING) bytes"
  view Notes
  sleep 6
  chrome-devtools evaluate_script "$(cat "$PROBE")" --output-format json --filePath "$OUT/$SET.notes.json" >/dev/null 2>&1
  echo "$SET notes -> $(wc -c < "$OUT/$SET.notes.json" 2>/dev/null || echo MISSING) bytes"
  view Board
  sleep 3
done
