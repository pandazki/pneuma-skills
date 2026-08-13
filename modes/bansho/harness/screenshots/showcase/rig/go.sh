#!/bin/bash
# go.sh <set> <fraction> [theme] — switch content set, pause, seek, report state.
# Port 9412 (this run's isolated Chrome). Theme is forced browser-locally.
set -u
R="${BANSHO_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../.." && pwd)}"
S="${BANSHO_SHOT_DIR:?set BANSHO_SHOT_DIR to a scratch dir holding this rig's outputs}"
PORT="${BANSHO_CDP_PORT:-9412}"
CDP="bun $R/modes/bansho/harness/cdp.mjs $PORT"
SET="$1"; F="$2"; THEME="${3:-}"

if [ -n "$THEME" ]; then $CDP evalFile "$(dirname "${BASH_SOURCE[0]}")/theme-$THEME.js" >/dev/null; sleep 1; fi

CUR=$($CDP eval "window.__PNEUMA_STORE__.getState().activeContentSet")
if [ "$CUR" != "$SET" ]; then
  $CDP eval "(()=>{window.__PNEUMA_STORE__.getState().setActiveContentSet('$SET');return 'switched';})()" >/dev/null
  sleep 6
fi

# pause if playing
$CDP eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Pause'); if(b){b.click();return 'paused';} return 'already';})()" >/dev/null
sleep 1

RECT=$($CDP eval "(()=>{const t=document.querySelector('[aria-label=\"Timeline\"]');const r=t.getBoundingClientRect();return JSON.stringify([r.x,r.y,r.width,r.height]);})()")
X=$(echo "$RECT" | cut -d, -f1 | tr -d '[')
Y=$(echo "$RECT" | cut -d, -f2)
W=$(echo "$RECT" | cut -d, -f3)
H=$(echo "$RECT" | cut -d, -f4 | tr -d ']')
CX=$(python3 -c "print(round($X + $F*$W))")
CY=$(python3 -c "print(round($Y + $H/2))")
$CDP click "$CX" "$CY" >/dev/null
sleep 2
# a seek leaves the player running; pause again so the clock does not walk
$CDP eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Pause'); if(b){b.click();return 'paused';} return 'already';})()" >/dev/null
sleep 3
$CDP eval "(()=>{const m=document.body.innerText.match(/([\d.]+)s \/ ([\d.]+)s/);const s=document.querySelector('.bansho-board-surface');const bad=document.body.innerText.includes('handwriting font fallback');return JSON.stringify({t:m&&m[1],dur:m&&m[2],theme:s&&s.getAttribute('data-bansho-theme'),set:window.__PNEUMA_STORE__.getState().activeContentSet,fontFallback:bad});})()"
