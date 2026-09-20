"""The store room: someone walks to a tall cabinet and its door swings open.

The prop-interaction counterpart of `lab_walk.py`. Eight seconds:
0-4.6 he crosses the room (already walking at frame 1), 4.7-5.3 he turns to
face the cabinet, 5.5-6.8 the door swings open on its hinge, 5.75-6.6 the
interior lights up, and the rest holds.

Two things this example is about:

* A DOOR is a spatial event, so it belongs in the greybox: `hinge` puts the
  pivot on the hinge edge, the leaf is parented to it, and `swing` keys the
  angle. The arm that pulls it does not belong here - the figure stops within
  arm's reach of the handle facing it, and the prompt says "takes the handle
  and pulls the door open".
* CAUSE BEFORE EFFECT. The door starts moving at 5.5 s and the interior accent
  starts at 5.75 s, never the other way round.

    setup -> space -> subject -> blocking -> camera -> accent -> finish
"""

import math

import previz_kit as pv

pv.setup(seconds=8, fps=24, width=1280, height=720)

# --- space (Blender axes: Z up; the cabinet stands against the +Y wall) ----
pv.room(10, 10, 3.0, door=(0, 2.2))

# The cabinet carcass: an open box facing -Y, its opening 0.72 m across.
FRONT_Y, HINGE_X, LEAF_W = 4.35, 0.45, 0.72
lit = pv.accent_material("cabinet_lit", (0.62, 0.63, 0.65))
pv.box("cabinet_side_l", (0.05, 0.50, 2.00), (-0.295, FRONT_Y + 0.25, 1.00), pv.GREY)
pv.box("cabinet_side_r", (0.05, 0.50, 2.00), (HINGE_X + 0.025, FRONT_Y + 0.25, 1.00), pv.GREY)
pv.box("cabinet_top", (0.82, 0.50, 0.06), (0.09, FRONT_Y + 0.25, 1.97), pv.GREY)
pv.box("cabinet_base", (0.82, 0.50, 0.10), (0.09, FRONT_Y + 0.25, 0.05), pv.GREY)
inside = [pv.box("cabinet_back", (0.72, 0.04, 1.85), (0.09, FRONT_Y + 0.48, 1.025), lit)]
for index, z in enumerate((0.55, 1.05, 1.55)):
    inside.append(pv.box("cabinet_shelf_%d" % index, (0.70, 0.46, 0.03), (0.09, FRONT_Y + 0.25, z), lit))

# The door: a pivot ON the hinge edge, the leaf and its handle hanging off it
# in the pivot's own space. Rotating the pivot is the whole door.
door = pv.hinge("cabinet_door", (HINGE_X, FRONT_Y))
pv.box("cabinet_leaf", (LEAF_W, 0.04, 1.85), (-LEAF_W / 2.0, -0.02, 1.025), pv.GREY, door)
pv.box("cabinet_handle", (0.035, 0.05, 0.40), (-LEAF_W + 0.09, -0.055, 1.20), pv.DARK, door)

# --- subject and blocking --------------------------------------------------
# He is already walking at frame 1: the travel started 0.6 s before the shot
# did, so the film opens mid-stride instead of on a man waiting for his cue.
STOP = (-0.55, 3.78)
who = pv.figure("root", height=1.75, location=(STOP[0], -2.57))
pv.travel(who, [(STOP[0], -2.57), STOP], start=-0.6, end=4.6, settle=0.7)
# Square to the handle, and outside the swing: the door's free edge passes
# 0.20 m clear of him at its closest (root 1.15 m from a 0.72 m hinge).
pv.turn(who, -36, 4.7, 5.3)
pv.hold(who, 5.3, 8.0)
handle = (HINGE_X - LEAF_W + 0.09, FRONT_Y - 0.055, 1.20)
pv.log("handle is %.2f m from the shoulder, arm's reach is %.2f m"
       % (math.dist((STOP[0], STOP[1], who["dims"]["shoulder_z"]), handle), who["dims"]["arm"]))

# --- camera: a dolly alongside him that settles on the cabinet -------------
cam = pv.camera(28, location=(-4.3, -3.40, 1.85), look_at=(-0.55, -2.60, 1.05))
pv.camera_move(cam, [
    (0.0, (-4.3, -3.40, 1.85), (-0.55, -2.60, 1.05)),
    (4.8, (-4.4, 1.90, 1.65), (-0.45, 3.40, 1.15)),
    (7.5, (-4.5, 2.70, 1.55), (-0.25, 3.85, 1.25)),
], settle=0.5)

# --- the door, then what the door reveals ----------------------------------
pv.swing(door, [(5.5, 0), (6.8, 68)])
pv.accent(inside, 5.75, 6.6, (0.95, 0.88, 0.62))

pv.finish()
