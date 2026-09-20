"""Six seconds: the challenger leaps past the master, and the camera swings 160 deg round them.

The orbit is the point. A video model asked for "the camera circles the
fighters" invents a different courtyard every second; conditioned on this
clip it keeps the one that is here, because the terrace, the colonnade and
the tree hold still while the lens goes round them.

    0.0-5.5  the camera travels from -145 deg to 15 deg at 5.6 m, 2.2 m up
    2.2-3.2  the challenger leaps past the master (4.1 m, 1.15 m of arc)
    3.0-3.8  the master turns to follow him
    5.5-6.0  everything settled - `end-hold`

The whole sweep stays on ONE SIDE of the line between the two fighters (the
axis runs at about 27 deg and the sweep ends at 15 deg), so this angle cuts
together with the other two - see `duel_collage.py`.

The body action is NOT here: "springs off his back foot, blade held low,
lands in a crouch" is a sentence in prompts.md, written over a clip that has
already fixed where he lands, when, and which way he faces.

    setup -> space -> subject -> blocking -> camera -> finish
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import previz_kit as pv                                                          # noqa: E402
from courtyard import CENTER, MARK_A, MARK_B, build_courtyard, duel_pawns, facing, ring  # noqa: E402

pv.setup(seconds=6, fps=24, width=1280, height=720)

# --- space -----------------------------------------------------------------
build_courtyard()

# --- subject and blocking --------------------------------------------------
# The leap passes the master on his open side: 1.75 m from the line to his
# centre, which is 1.3 m of clearance between two 0.46 m bodies. That number
# is what the `penetration` check is about, and it is decided here rather
# than hoped for in the prompt.
PAST = (2.4, -1.4)
challenger, master = duel_pawns()
pv.dash(challenger, [MARK_A, PAST], start=2.2, end=3.2, arc=1.15)
pv.hold(challenger, 3.2, 6.0)
pv.turn(master, facing(MARK_B, PAST), 3.0, 3.8)
pv.hold(master, 3.8, 6.0)

# --- camera ----------------------------------------------------------------
# The camera is BUILT on the orbit's first station, so the two agree: -145 deg
# is the near corner of the terrace, 15 deg ends level with the great tree.
RADIUS, HEIGHT = 5.6, 2.2
FROM_DEG, TO_DEG = -145.0, 15.0
cam = pv.camera(30, location=ring(CENTER, RADIUS, FROM_DEG, HEIGHT),
                look_at=(CENTER[0], CENTER[1], 1.45))
pv.orbit(cam, CENTER, RADIUS, HEIGHT, FROM_DEG, TO_DEG, 0.0, 5.5)

pv.finish()
