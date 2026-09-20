"""The three-camera collage: one strike, three angles - and therefore THREE SHOTS.

This file is a PATTERN, not a scene. It renders nothing, on purpose.

A collage of one moment from three cameras is a thing the CUT does. There is
no `camera_cut()` in the kit and there should not be: a shot in this mode is
one continuous clip that one take of a video model is conditioned on, and a
clip that cuts inside itself asks the model to invent two framings and the
edit between them - which is exactly the judgement we are paying a greybox to
take away from it. `take-integrity` ("no cut inside the take") is an
acceptance check for that reason.

A collage is therefore three shots, and each one is a WHOLE shot even though
the film shows a second of it. Seedance's floor is 4 s, so a 1.2 s take
cannot be bought: every angle is its own 4 s shot on the SAME clock, and the
part the film uses is named by a trim -

    shots/duel-strike-a/   4 s, strike at 1.8-3.0 s   --trim-in 1.6 --trim-out 2.8
    shots/duel-strike-b/   4 s, strike at 1.8-3.0 s   --trim-in 1.8 --trim-out 3.0
    shots/duel-strike-c/   4 s, strike at 1.8-3.0 s   --trim-in 2.0 --trim-out 3.2

    previz.mjs meta shots/duel-strike-a --trim-in 1.6 --trim-out 2.8

`backlot.mjs cut` honours those ranges, so the film sees three ~1.2 s
segments whose overlap steps forward a fifth of a second each time - the
strike carries across the cut instead of restarting on it. Everything else -
the greybox, the take, the beats, a line's second - still runs on the shot's
own 4 s clock. Three takes are paid for instead of one; the trim is free.

## How to build them

1. Write the blocking ONCE and import it. Every angle uses the same
   `courtyard.build_courtyard()`, the same `duel_pawns()`, the same marks and
   the same seconds for the strike. If angle B's fighters stand 30 cm from
   where angle A's do, the three clips will not cut together and no prompt
   will rescue them.
2. Give every angle the SAME clock, and put the moment at the same second in
   all three: the strike runs 1.8-3.0 s in A, in B and in C. Then any trim
   inside that window cuts, and moving one is an edit rather than a re-render.
3. Change ONLY the camera block between the three files. That is the whole
   diff, and keeping it that way is what makes a re-blocking cheap: fix the
   blocking in `courtyard.py` and re-render three shots.
4. Do not cross the line. Pick a side of the axis between the two fighters
   and keep all three cameras on it, or the master will change shoulders
   between cuts. `pv.orbit`'s angles make this checkable: the axis here runs
   at about 27 deg, so every station between -153 deg and 27 deg is on one
   side of it - which is why `duel_orbit.py` sweeps -145 to 15 and stops.
5. Prompt each take with the SAME action sentence and its own framing
   sentence. The action is what has to match across the cut; the framing is
   what makes the three clips worth cutting.
6. Put the same TEMPO in all three, and read the trims off the shot clock.
   A `pv.slowmo` is blocking, not camera: it changes what second of the
   action each frame of the clip is showing, so an angle that runs the strike
   at full speed cannot be cut against one that halves it - the film would
   change speed on the cut. Copy the identical `slowmo` line into all three
   files, above the camera block. `pv.impact` is the other way round, because
   a hit is a fact about the CAMERA: each angle gets its own, at the same
   shot second, and the three cameras can be shoved by different amounts.
   Remember that a ramp moves the strike in the clip - `previz.mjs meta
   --trim-in/--trim-out` takes SHOT seconds, so the trims come from
   `pv.shot_time(<the action second of the strike>)` and not from the
   blocking. Write the ramp into all three before anyone writes a trim.

## The vocabulary these three would use

`duel_orbit.py`, `duel_dolly_zoom.py` and `duel_crane.py` are the worked
angles - a 160 deg orbit, a Hitchcock dolly zoom with a speed ramp under the
landing, and a crane rise with a `camera_move`, a `zoom` and an `impact` on
the contact. A collage borrows those camera blocks over blocking that does
not change between them: three 4 s shots, each rendered and taken in full,
and a trim on each that hands the film its second.

Run this file and it says so and stops; render one of the three instead.
"""

import sys

if __name__ == "__main__":
    print(__doc__)
    sys.stderr.write(
        "ERROR: duel_collage.py is the collage PATTERN, not a scene - it builds nothing. "
        "Render duel_orbit.py, duel_dolly_zoom.py or duel_crane.py, or copy one of them into "
        "greybox/scene.py and change its camera block.\n")
    sys.exit(1)
