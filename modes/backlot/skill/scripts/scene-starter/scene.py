"""The greybox for this shot.

This starter already renders, so `previz.mjs render <shot-dir> --preview`
succeeds before you have written a line of it. Replace its contents with the
shot's real space, blocking and camera; keep the shape:

    setup   ->   space   ->   subject   ->   blocking   ->   camera   ->   finish

Units are metres, Z is up, and a figure's forward is +Y. The figure is a PAWN
on purpose: the greybox fixes where a body is, when it gets there and which
way it faces, and the PROMPT says what the body does when it arrives.
`previz_kit` lives on sys.path because `previz.mjs render` put it there; run
`previz.mjs doctor` if the import fails. Raw `bpy` is available too - the kit
is a starting vocabulary, not a fence.
"""

import previz_kit as pv

# The clock and the frame this shot is cut to. `previz.mjs render` passes the
# shot spec in and the kit REFUSES if this line disagrees with it, so change
# the shot spec and this line together.
pv.setup(seconds=8, fps=24, width=1280, height=720)

# --- space -----------------------------------------------------------------
# A floor to cast a shadow on and a wall to read depth against. Anything the
# subject reaches, passes or stops at has to exist here, or the acceptance
# checks for penetration and blocking have nothing to be about.
pv.plane("floor", (14, 14), (0, 0, 0), pv.GREY)
pv.box("wall_back", (14, 0.2, 3.2), (0, 6, 1.6))
crate = pv.box("crate", (0.8, 0.8, 0.8), (0.0, 1.1, 0.4), pv.GREY)

# --- subject ---------------------------------------------------------------
# A person-sized pawn: one body volume, a head and a dark visor that says
# which way it faces. It stands at the start of its path.
STOP = (0.0, 0.45)

# --- blocking --------------------------------------------------------------
# The times are fractions of the shot ONLY so this starter renders at any
# duration; a real shot states its beats in seconds, copied from
# shot-plan.md. The DISTANCE follows from the time, because `travel` refuses a
# speed no walk could have: the video model animates a gait at whatever speed
# this clip shows.
S = pv.shot()["seconds"]
GO, ARRIVE = min(0.5, S * 0.1), max(1.2, S * 0.55)
RAMP, SETTLE = 0.3, min(0.8, (ARRIVE - GO) * 0.3)
DIST = round(1.2 * ((ARRIVE - GO) - (RAMP + SETTLE) / 2.0), 2)  # 1.2 m/s of walk

walker = pv.figure("walker", height=1.75, location=(STOP[0], STOP[1] - DIST))
pv.travel(walker, [(STOP[0], STOP[1] - DIST), STOP], start=GO, end=ARRIVE, settle=SETTLE, ramp=RAMP)
pv.hold(walker, ARRIVE, S)

# --- camera ----------------------------------------------------------------
# A slow push-in; `settle` pulls the last key back so the tail is still.
cam = pv.camera(35, location=(-4.2, -6.6, 2.00), look_at=(0.0, -2.4, 1.00))
pv.camera_move(cam, [
    (0.0, (-4.2, -6.6, 2.00), (0.0, -2.4, 1.00)),
    (S, (-3.4, -4.6, 1.75), (0.0, 0.6, 1.05)),
], settle=min(0.5, S * 0.1))

# --- finish ----------------------------------------------------------------
# Bakes the figures, checks the frame range against the shot spec, renders the
# PNG sequence, saves scene.blend, exports scene.glb and writes
# scene.meta.json. Always the last line.
pv.finish()
