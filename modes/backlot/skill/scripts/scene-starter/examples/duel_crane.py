"""Five seconds: one exchange, and the camera climbs away over the terrace.

The shot a fight ends on. `camera_move` does the crane - two eased keys, the
last one pulled back so the final half second is still - and `zoom` opens the
lens from 30 mm to 21 mm on the way up, so the courtyard arrives in frame as
the ground drops away rather than by the camera flying twice as far.

    0.6-1.2  the challenger bursts forward 2.2 m (a lunge, not a leap: no arc)
    1.3-2.1  the master gives ground, one step back
    0.0-4.5  the crane: 1.7 m -> 8.4 m, eased, settled by 4.5 s
    0.4-4.2  30 mm -> 21 mm

glTF carries no lens animation, so the zoom's keys also land in
`scene.meta.json` as `camera_lens` - the MP4 shows it either way, and the
viewer's 3-D lane has the numbers to replay it.

    setup -> space -> subject -> blocking -> camera -> finish
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import previz_kit as pv                                                  # noqa: E402
from courtyard import CENTER, MARK_A, MARK_B, build_courtyard, duel_pawns  # noqa: E402

pv.setup(seconds=5, fps=24, width=1280, height=720)

# --- space -----------------------------------------------------------------
build_courtyard()

# --- subject and blocking --------------------------------------------------
challenger, master = duel_pawns()
LUNGE = (MARK_A[0] + 1.6, MARK_A[1] + 1.5)
GIVE = (MARK_B[0] + 0.5, MARK_B[1] + 0.6)
pv.dash(challenger, [MARK_A, LUNGE], start=0.6, end=1.2, pace="burst")
pv.hold(challenger, 1.2, 5.0)
pv.travel(master, [MARK_B, GIVE], start=1.3, end=2.1, pace="walk")
pv.hold(master, 2.1, 5.0)

# --- camera ----------------------------------------------------------------
cam = pv.camera(30, location=(0.9, -7.4, 1.70), look_at=(CENTER[0], CENTER[1], 1.30))
pv.camera_move(cam, [
    (0.0, (0.9, -7.4, 1.70), (CENTER[0], CENTER[1], 1.30)),
    (4.5, (1.4, -10.2, 8.40), (CENTER[0], CENTER[1], 0.60)),
], settle=0.5)
pv.zoom(cam, 30, 21, 0.4, 4.2)

pv.finish()
