#!/bin/bash
# W7's acceptance test: THE SAME LECTURE AT TWO WINDOW WIDTHS.
#
#   two-width.sh <debug-port> [outdir] [set ...]
#
# A board has a fixed canonical size (engine/layout.ts::PANEL_WIDTH), so the
# canonical layout of a `board.md` may not depend on the reader's window at
# all — not the wraps, not the fold, not one path's `d` string. That claim is
# a MEASUREMENT here and nothing less: capture the layout-baseline probe's own
# JSON at 1280 and at 1990, and diff. Byte-identical is the proof, and it is
# what turns 「你我看到的是同一堂课」 from a hope into a fact.
#
# Before W7 this check was impossible: `panelW` was the viewport's width, so
# the two captures were legitimately different lectures.
#
# Both widths are captured back-to-back in ONE browser process, which is the
# same discipline every other leg of this gate follows (layout-baseline/
# README.md — cross-session captures are not byte-stable). A resize between
# the two is legitimate and was proved so in W2c: a resize round trip inside
# one session is byte-identical.
#
# The probe suspends the camera transform for the read, so `scale` is 1 on
# both sides and no exclusion is needed — the diff is the whole file.
set -u
PORT="${1:?usage: two-width.sh <debug-port> [outdir] [set ...]}"
OUT="${2:-/tmp/bansho-two-width}"
shift 2 2>/dev/null || shift 1
SETS=("$@")
[ ${#SETS[@]} -eq 0 ] && SETS=(fourier kelly brain)
HERE="$(cd "$(dirname "$0")" && pwd)"

WIDTHS=(1280 1990)
HEIGHT=1100

for W in "${WIDTHS[@]}"; do
  bun "$HERE/cdp.mjs" "$PORT" viewport "$W" "$HEIGHT" >/dev/null
  # The width change trips `invalidateMeasurements` (150ms debounce) and a
  # full rebuild; give it room before the probe reads.
  sleep 4
  bash "$HERE/capture-cdp.sh" "$PORT" "$OUT/$W" "${SETS[@]}" >/dev/null
  echo "captured at ${W}x${HEIGHT}"
done

FAIL=0
for SET in "${SETS[@]}"; do
  for LEG in "$SET" "$SET.notes"; do
    A="$OUT/${WIDTHS[0]}/$LEG.json"
    B="$OUT/${WIDTHS[1]}/$LEG.json"
    if cmp -s "$A" "$B"; then
      echo "$LEG  BYTE-IDENTICAL at ${WIDTHS[0]} and ${WIDTHS[1]}"
    else
      echo "$LEG  DIFFERS  <-- the window is still in the canonical layout"
      FAIL=1
    fi
  done
done
exit "$FAIL"
