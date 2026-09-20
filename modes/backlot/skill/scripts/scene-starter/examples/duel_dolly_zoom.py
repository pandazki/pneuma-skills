"""Four seconds: he lands, and the courtyard falls away behind him.

The Hitchcock shot. The camera runs 6.4 m -> 2.6 m down its own sightline
while the lens goes 40 mm -> 16 mm, so the challenger keeps the height he
had on screen and the colonnade behind him rushes outward. Both halves are
arithmetic - a ratio of distances equals a ratio of focal lengths - which is
exactly the kind of thing a video model cannot be asked for in words.

    0.2-1.2  the challenger leaps in and lands on his mark (1.3 m of arc)
    1.2-3.2  the dolly zoom, starting on the frame he lands
    3.2-4.0  held - `end-hold`

`dolly_zoom` is given the FIGURE, not a point: a figure resolves to its chest
where its own tracks put it at 1.2 s, which is the mark he lands on, not the
launch point he was built at.

    setup -> space -> subject -> blocking -> camera -> finish
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import previz_kit as pv                                          # noqa: E402
from courtyard import MARK_A, build_courtyard, duel_pawns, ring  # noqa: E402

pv.setup(seconds=4, fps=24, width=1280, height=720)

# --- space -----------------------------------------------------------------
build_courtyard()

# --- subject and blocking --------------------------------------------------
# He comes in from the far side of the terrace, so the leap crosses the frame
# rather than the lens: a launch point behind the camera would fill the first
# second with one enormous ochre body.
LAUNCH = (MARK_A[0] - 2.6, MARK_A[1] + 3.6)
challenger, master = duel_pawns(a_at=LAUNCH)
pv.dash(challenger, [LAUNCH, MARK_A], start=0.2, end=1.2, arc=1.3)
pv.hold(challenger, 1.2, 4.0)
pv.hold(master, 0.0, 4.0)

# --- camera ----------------------------------------------------------------
# -105 deg round the landing mark keeps the master in the frame behind him,
# on the same side of the line as the other two angles. Only the DIRECTION of
# this location matters: `dolly_zoom` puts the camera on that sightline at
# dist_from and holds it there from frame 1, so the shot opens on the wide
# end instead of popping onto it at 1.2 s.
cam = pv.camera(40, location=ring(MARK_A, 6.4, -105.0, 1.55),
                look_at=(MARK_A[0], MARK_A[1], 1.26))
pv.dolly_zoom(cam, challenger, 6.4, 2.6, 1.2, 3.2)

pv.finish()
