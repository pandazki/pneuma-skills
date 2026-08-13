#!/bin/bash
# thumb.sh <seed> <fraction> <panelIndex> — seed-gallery thumbnail through the
# real seed-apply path: fit one board face in the viewport, hide the viewport
# overlays, clip to that face at 16:10 anchored on its top edge (which is
# exactly what the card's `object-cover object-top` shows).
set -u
R="${BANSHO_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../.." && pwd)}"
S="${BANSHO_SHOT_DIR:?set BANSHO_SHOT_DIR to a scratch dir holding this rig's outputs}"
PORT="${BANSHO_CDP_PORT:-9412}"
CDP="bun $R/modes/bansho/harness/cdp.mjs $PORT"
SEED="$1"; F="$2"; IDX="$3"

bash "$(dirname "${BASH_SOURCE[0]}")/go.sh" "$SEED" "$F" light

# zoom out to the floor, then back in until one face fits the board area
for i in $(seq 1 14); do
  SCALE=$($CDP eval "(()=>{const m=getComputedStyle(document.querySelector('.bansho-stage')).transform.match(/matrix\(([-\d.]+)/);return m[1];})()")
  DONE=$(python3 -c "print(1 if $SCALE <= 0.80 else 0)")
  [ "$DONE" = "1" ] && break
  $CDP wheel 688 350 160 1 >/dev/null
  sleep 0.4
done
$CDP evalFile "$(dirname "${BASH_SOURCE[0]}")/hide-all.js" >/dev/null
sleep 1

# pan the camera onto the requested face (a left-drag pans the stage)
if [ "$IDX" -ge 0 ]; then
  for k in 1 2 3; do
    D=$($CDP eval "(()=>{const p=document.querySelectorAll('.bansho-panel')[$IDX];const r=p.getBoundingClientRect();return JSON.stringify([Math.round(r.x+r.width/2-innerWidth/2),Math.round(r.y+r.height/2-355)]);})()")
    DX=$(echo "$D" | cut -d, -f1 | tr -d '['); DY=$(echo "$D" | cut -d, -f2 | tr -d ']')
    NEED=$(python3 -c "print(1 if abs($DX)>6 or abs($DY)>6 else 0)")
    [ "$NEED" = "0" ] && break
    read SX SY EX EY <<<"$(python3 -c "
dx,dy=$DX,$DY
sx,sy=688,355
ex,ey=sx-dx,sy-dy
ex=max(60,min(1316,ex)); ey=max(40,min(690,ey))
print(sx,sy,round(ex),round(ey))")"
    $CDP drag "$SX" "$SY" "$EX" "$EY" >/dev/null
    sleep 1
  done
fi

RECT=$($CDP eval "(()=>{const ps=[...document.querySelectorAll('.bansho-panel')];const cx=innerWidth/2,cy=350;let p=ps[$IDX];if($IDX<0){let best=null,bd=1e9;ps.forEach(el=>{const r=el.getBoundingClientRect();const d=Math.hypot(r.x+r.width/2-cx,r.y+r.height/2-cy);if(d<bd){bd=d;best=el;}});p=best;}const r=p.getBoundingClientRect();return JSON.stringify([r.x,r.y,r.width,r.height,[...document.querySelectorAll('.bansho-panel')].indexOf(p)]);})()")
echo "panel rect: $RECT  scale: ${SCALE:-?}"
X=$(echo "$RECT" | cut -d, -f1 | tr -d '['); Y=$(echo "$RECT" | cut -d, -f2)
W=$(echo "$RECT" | cut -d, -f3); H=$(echo "$RECT" | cut -d, -f4)
read CX CY CW CH <<<"$(python3 -c "
x,y,w,h=$X,$Y,$W,$H
ch=min(h, w/1.6)
print(round(x,1), round(y,1), round(w,1), round(ch,1))")"
$CDP shot "$S/sc-out/thumb-$SEED.png" "$CX" "$CY" "$CW" "$CH" 1 >/dev/null
sips -z 900 1440 "$S/sc-out/thumb-$SEED.png" --out "$S/sc-out/thumb-$SEED-s.png" >/dev/null
sips -g pixelWidth -g pixelHeight "$S/sc-out/thumb-$SEED.png" | grep pixel | tr -d '\n'; echo " <- $SEED raw"
$CDP evalFile "$(dirname "${BASH_SOURCE[0]}")/show.js" >/dev/null
