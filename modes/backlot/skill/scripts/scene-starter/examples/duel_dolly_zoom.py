"""Four seconds: he lands - slowly - and the courtyard falls away behind him.

The Hitchcock shot, with a speed ramp under the landing. The camera runs
6.4 m -> 2.6 m down its own sightline while the lens goes 40 mm -> 16.25 mm
(the same 2.6/6.4 ratio), so the challenger keeps the height he had on screen
and the colonnade behind him rushes outward. Both halves are arithmetic - a
ratio of distances equals a ratio of focal lengths - which is exactly the kind
of thing a video model cannot be asked for in words.

TWO CLOCKS, because of the `slowmo`. The blocking below is written in ACTION
seconds; the clip - and therefore the beats table, the trim and the prompt's
timeline - runs on SHOT seconds:

    shot 0.2-0.9   action 0.2-0.9   he leaps off the terrace (1.3 m of arc)
    shot 0.9-1.5   action 0.9-1.2   the descent and the landing, at HALF SPEED
    shot 1.5-3.5   action 1.2-3.2   the dolly zoom, starting on the frame he lands
    shot 3.5-4.0                    held - `end-hold`

`pv.slowmo(0.9, 1.5, 2)` costs 0.6 * (1 - 1/2) = 0.3 s of action, so
everything written after it is seen 0.3 s later: the dolly zoom written to end
at 3.2 s ends at 3.5 s, which is what leaves exactly the settled half second
`end-hold` wants. `pv.shot_time(3.2)` is how that was checked rather than
hoped for, and it is how the beats for this shot were written down.

The ramp belongs HERE and not in the prompt: the greybox is the clock the
video model follows, so a descent that is seven frames of action spread over
fourteen frames of clip comes back as a descent that takes fourteen frames.
"Slow motion, dust hanging in the air" is then a sentence about texture over
a clip that is already slow, instead of an instruction the model has to
reconcile with a greybox moving at one speed.

`dolly_zoom` is given the FIGURE, not a point: a figure resolves to its chest
where its own tracks put it at ACTION 1.2 s, which is the mark he lands on,
not the launch point he was built at.

    setup -> space -> subject -> blocking -> tempo -> camera -> finish
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

# --- tempo -----------------------------------------------------------------
# Shot seconds, not action seconds: the ramp is where it sits in the CLIP.
# 0.9-1.5 s of clip carries 0.9-1.2 s of action - the descent and the contact
# with the stone - and everything after it lands 0.3 s later.
pv.slowmo(0.9, 1.5, 2.0)

# --- camera ----------------------------------------------------------------
# -105 deg round the landing mark keeps the master in the frame behind him,
# on the same side of the line as the other two angles. Only the DIRECTION of
# this location matters: `dolly_zoom` puts the camera on that sightline at
# dist_from and holds it there from frame 1, so the shot opens on the wide
# end instead of popping onto it. Its seconds are ACTION seconds like every
# other beat - the ramp above is what moves them to 1.5-3.5 s of clip.
cam = pv.camera(40, location=ring(MARK_A, 6.4, -105.0, 1.55),
                look_at=(MARK_A[0], MARK_A[1], 1.26))
pv.dolly_zoom(cam, challenger, 6.4, 2.6, 1.2, 3.2)

pv.finish()
