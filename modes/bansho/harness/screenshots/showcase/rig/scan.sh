#!/bin/bash
# scan.sh f0 f1 steps — seek across a fraction range, report stage scale at each.
set -u
R="${BANSHO_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../.." && pwd)}"
CDP="bun $R/modes/bansho/harness/cdp.mjs $PORT"
F0="$1"; F1="$2"; N="$3"
RECT=$($CDP eval "(()=>{const t=document.querySelector('[aria-label=\"Timeline\"]');const r=t.getBoundingClientRect();return JSON.stringify([r.x,r.y,r.width,r.height]);})()")
X=$(echo "$RECT" | cut -d, -f1 | tr -d '['); Y=$(echo "$RECT" | cut -d, -f2)
W=$(echo "$RECT" | cut -d, -f3); H=$(echo "$RECT" | cut -d, -f4 | tr -d ']')
CY=$(python3 -c "print(round($Y + $H/2))")
for i in $(seq 0 "$N"); do
  F=$(python3 -c "print($F0 + ($F1-$F0)*$i/$N)")
  CX=$(python3 -c "print(round($X + $F*$W))")
  $CDP click "$CX" "$CY" >/dev/null
  sleep 2
  $CDP eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Pause'); if(b)b.click(); return 1;})()" >/dev/null
  sleep 1
  OUT=$($CDP eval "(()=>{const s=document.querySelector('.bansho-stage');const m=getComputedStyle(s).transform.match(/matrix\(([-\d.]+)/);const t=document.body.innerText.match(/([\d.]+)s \/ /);return JSON.stringify({f:'$F',t:t&&t[1],scale:m&&m[1]});})()")
  echo "$OUT"
done
