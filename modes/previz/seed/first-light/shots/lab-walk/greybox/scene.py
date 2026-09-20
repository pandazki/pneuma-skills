"""The lab shot: a researcher walks in, touches a console, the device wakes.

The example this mode was built from, written in the kit. Eight seconds:
0-0.5 the doorway establishes, 0.5-4.5 the walk in (settling over the last
0.7 s), 5.35-5.5 the button dips, 5.5-7.5 the device brightens, 7.5-8 hold.
The camera pushes in and settles.

What the greybox does NOT say is how the body moves. The figure is a pawn: it
travels to the console and stops facing it, within arm's reach of the button,
and the prompt says "raises the left hand and presses the button". The dip and
the accent are props, so they stay here - and the accent starts at the second
the prompt puts the hand on the button, never before it.

Read it as the shape a shot script takes:
    setup -> space -> subject -> blocking -> camera -> accent -> finish
"""

import math

import bpy  # raw bpy stays available: the kit is a vocabulary, not a fence

import previz_kit as pv

pv.setup(seconds=8, fps=24, width=1280, height=720)

# --- space (Blender axes: Z up, the walk runs along +Y) --------------------
pv.room(9, 14, 3.4, door=(0, 2.2))
for x in (-3.2, 3.2):
    for y in ((1, 5) if x < 0 else (-3, 1, 5)):
        pv.box("rack_%s_%s" % (x, y), (0.9, 1.6, 2.2), (x, y, 1.1), pv.GREY)

# The console the hand will reach, with its button on the top face.
pv.box("console", (1.1, 0.6, 1.05), (0.55, 0.55, 0.525), pv.GREY)
pv.cylinder("button", 0.07, 0.04, (0.19, 0.42, 1.07), pv.DARK, vertices=16)

# The device: base, column, core and three rings. The core and the rings get
# their own material so the accent can recolour them without touching the room.
glow = pv.accent_material("device_glow", (0.62, 0.63, 0.65))
pv.cylinder("device_base", 0.9, 0.5, (0, 3.0, 0.25), pv.GREY)
pv.cylinder("device_col", 0.28, 1.6, (0, 3.0, 1.3), pv.WHITE)
core = pv.sphere("device_core", 0.62, (0, 3.0, 2.5), glow)
rings = []
for index in range(3):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.95 + index * 0.18, minor_radius=0.035, location=(0, 3.0, 2.5))
    ring = bpy.context.active_object
    ring.name = "device_ring_%d" % index
    ring.rotation_euler = (math.radians(70 - index * 25), math.radians(index * 40), 0)
    ring.data.materials.append(glow)
    rings.append(ring)

# --- subject and blocking --------------------------------------------------
# From the doorway to the console, arriving facing it: the path runs +Y and a
# figure's forward is +Y, so it stops square to the console with the button
# 0.65 m from its shoulder - inside the 0.72 m the prompt's hand has to cover.
worker = pv.figure("root", height=1.75, location=(0.45, -5.6))
STOP = (0.45, -0.05)
pv.travel(worker, [(0.45, -5.6), STOP], start=0.5, end=4.5, settle=0.7)
pv.hold(worker, 4.5, 8.0)
pv.log("button is %.2f m from the shoulder, arm's reach is %.2f m"
       % (math.dist((STOP[0], STOP[1], worker["dims"]["shoulder_z"]), (0.19, 0.42, 1.07)), worker["dims"]["arm"]))

# --- camera: a slow push-in that settles half a second before the end ------
cam = pv.camera(28, location=(-3.5, -5.9, 2.1), look_at=(0.3, 0.2, 1.25))
pv.camera_move(cam, [
    (0.0, (-3.5, -5.9, 2.1), (0.3, 0.2, 1.25)),
    (7.5, (-2.3, -2.9, 1.75), (0.3, 0.2, 1.25)),
], settle=0.5)

# --- the trigger: nothing before the touch, blue by 7.5 s ------------------
pv.move(bpy.data.objects["button"], [(5.35, (0.19, 0.42, 1.07)), (5.5, (0.19, 0.42, 1.045))])
pv.accent([core] + rings, 5.5, 7.5, (0.08, 0.42, 1.0))

pv.finish()
