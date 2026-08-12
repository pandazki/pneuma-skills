#!/bin/bash
# Capture the layout baseline through the ISOLATED CDP driver (harness/cdp.mjs)
# instead of the shared `chrome-devtools` daemon — same two legs per content
# set as capture-layout.sh, same probe, no cross-agent page theft.
#
#   capture-cdp.sh <debug-port> <outdir> [set ...]
#
# Both legs of an A/B must be captured back-to-back in ONE browser process;
# see layout-baseline/README.md for why cross-session diffs lie.
set -u
PORT="${1:?usage: capture-cdp.sh <debug-port> <outdir> [set ...]}"
OUT="${2:?usage: capture-cdp.sh <debug-port> <outdir> [set ...]}"
shift 2
SETS=("$@")
[ ${#SETS[@]} -eq 0 ] && SETS=(fourier kelly brain)
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PROBE="$HERE/probe-layout.js"
mkdir -p "$OUT"

cdp() { bun "$HERE/cdp.mjs" "$PORT" "$@"; }

# `probe-layout.js` is a bare arrow FUNCTION (the shape the chrome-devtools
# CLI's evaluate_script wants). `cdp.mjs eval` evaluates an EXPRESSION, so
# the probe has to be called — otherwise the capture is the JSON of a
# function object, i.e. `{}` on every leg. One wrapper, written once here.
PROBE_EXPR="/tmp/bansho-probe-call.js"
{ printf '('; cat "$PROBE"; printf ')()'; } > "$PROBE_EXPR"

# Flip the board/notes projection through the UI's own control — no test
# hook, no store poke: the toggle is component state.
view() {
  cdp eval "(() => {
    const group = document.querySelector('[aria-label=\"Board or lecture notes view\"]');
    if (!group) return 'no-toggle';
    for (const b of group.querySelectorAll('button')) {
      if (b.textContent.trim() === '$1') { b.click(); return '$1'; }
    }
    return 'no-button';
  })()" >/dev/null
}

for SET in "${SETS[@]}"; do
  cdp eval "(() => { window.__PNEUMA_STORE__.getState().setActiveContentSet('$SET'); return '$SET'; })()" >/dev/null
  sleep 6
  cdp evalFile "$PROBE_EXPR" > "$OUT/$SET.json"
  echo "$SET board -> $(wc -c < "$OUT/$SET.json") bytes"
  view Notes
  sleep 6
  cdp evalFile "$PROBE_EXPR" > "$OUT/$SET.notes.json"
  echo "$SET notes -> $(wc -c < "$OUT/$SET.notes.json") bytes"
  view Board
  sleep 3
done
