"""make_prop.py - COPY THIS FILE and edit it into the prop you actually need.

    cp {SKILL_PATH}/scripts/blender/make_prop.py <project>/assets/brazier.py
    # edit the five marked blocks
    node {SKILL_PATH}/scripts/blender.mjs run <project>/assets/brazier.py -- \
        <project>/scene/models/brazier.glb

This is the one rung procedural three.js cannot reach. `BoxGeometry` and
`CylinderGeometry` give you perfectly sharp edges, no repeated detail and no
holes; a bevel, an array and a boolean are what make a shape read as a
manufactured object instead of a placeholder. Everything below is four bpy
primitives and three modifiers - the point is the modifiers, not the shape.

The example is a stone brazier: a bevelled cylinder base, a ring of bolts
arrayed around its rim, and a bowl cut out of the top with a boolean. Five
blocks are marked (1) ... (5); those are the ones you edit. Keep the order -
build, cut, array, material, then ground/normalize/export - because grounding
and sizing measure the finished geometry.

Two conventions worth knowing before you edit:

* **You build in Blender axes (Z up).** `primitive_cylinder_add(location=
  (0, 0, 0.3))` puts the cylinder 0.3 ABOVE the floor. `kit.ground` and
  `kit.normalize` speak glTF axes (Y up) because that is where the model is
  going, and they say so in their log lines.
* **Build around the world origin.** `kit.array(..., spin=360)` turns its
  copies about the world Z axis, and `kit.normalize` scales about the world
  origin. An object built at x = 12 will ring and scale around a point 12
  units away from itself.

`--background` has no UI and no error dialog, so every step prints a line.
Read the log before you look at the picture.
"""

import os
import sys

import bpy

import kit

TAG = "[make_prop]"


def log(message):
    print("%s %s" % (TAG, message), flush=True)


def die(message):
    print("ERROR: %s" % message, file=sys.stderr, flush=True)
    sys.exit(1)


# ---------------------------------------------------------------------------
# (1) THE DIMENSIONS. Every number the prop is built from, in one place and in
#     metres. Change these first: the geometry below is written in terms of
#     them, so a taller brazier is one edit, not six.
# ---------------------------------------------------------------------------

BASE_RADIUS = 0.45          # half the width of the pedestal
BASE_HEIGHT = 0.62          # how tall the pedestal stands
BASE_SIDES = 32             # cylinder segments; 32 is round enough at prop size
BEVEL_WIDTH = 0.022         # the edge highlight - the single most valuable 2 cm
BEVEL_SEGMENTS = 3          # 1 is a chamfer, 3 reads as cast stone

BOWL_RADIUS = 0.33          # the sphere that carves the fire bowl
BOWL_DROP = 0.24            # how far the bowl bites into the top face

BOLT_SIZE = 0.075           # one rivet, before it is arrayed
BOLT_COUNT = 8              # how many go around the rim
BOLT_HEIGHT = 0.19          # where on the pedestal the band of rivets sits

FINAL_HEIGHT = None         # e.g. 1.2 to force a size; None keeps the metres above


def main():
    output = kit.script_args()
    if not output:
        die("usage: make_prop.py -- <out.glb>")
    out_path = os.path.abspath(output[0])

    # An empty scene, or Blender's startup Cube ships inside your prop.
    kit.reset()

    # -----------------------------------------------------------------------
    # (2) THE BODY. One primitive plus a bevel. `location` is the CENTRE of a
    #     cylinder, so half its height puts its base on the floor.
    #     Swap in primitive_cube_add / primitive_cone_add / primitive_torus_add
    #     for a different silhouette; the bevel matters more than the choice.
    # -----------------------------------------------------------------------
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=BASE_SIDES,
        radius=BASE_RADIUS,
        depth=BASE_HEIGHT,
        location=(0.0, 0.0, BASE_HEIGHT / 2.0),
    )
    base = bpy.context.active_object
    base.name = "brazier_base"
    log("body: cylinder r=%.3f h=%.3f, %d sides" % (BASE_RADIUS, BASE_HEIGHT, BASE_SIDES))
    kit.bevel(base, width=BEVEL_WIDTH, segments=BEVEL_SEGMENTS)

    # -----------------------------------------------------------------------
    # (3) THE CUT. A boolean needs a cutter object; `kit.boolean` applies the
    #     modifier and deletes it, because a cutter left in the scene exports
    #     as a translucent blob floating through the prop.
    #     Use op="UNION" to weld a shape on, "INTERSECT" to keep the overlap.
    # -----------------------------------------------------------------------
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=BOWL_RADIUS,
        segments=32,
        ring_count=16,
        # Sit the sphere so it bites BOWL_DROP into the top face.
        location=(0.0, 0.0, BASE_HEIGHT + BOWL_RADIUS - BOWL_DROP),
    )
    cutter = bpy.context.active_object
    cutter.name = "brazier_bowl_cutter"
    log("cut: sphere r=%.3f biting %.3f into the top face" % (BOWL_RADIUS, BOWL_DROP))
    kit.boolean(base, cutter, op="DIFFERENCE")

    # -----------------------------------------------------------------------
    # (4) THE REPEATED DETAIL. One rivet, arrayed around the up axis. This is
    #     the cheapest "somebody made this" signal there is, and the thing a
    #     procedural three.js mesh never has.
    #     `spin=360` closes the ring; drop `spin` and pass `offset=(0, 0, 0.2)`
    #     instead for a stack, a fence or a row of windows.
    # -----------------------------------------------------------------------
    bpy.ops.mesh.primitive_cube_add(
        size=BOLT_SIZE,
        # On the rim: pushed out to the surface so the rivet reads as proud of it.
        location=(BASE_RADIUS - BOLT_SIZE * 0.25, 0.0, BOLT_HEIGHT),
    )
    bolts = bpy.context.active_object
    bolts.name = "brazier_bolts"
    log("detail: one %.3f m rivet on the rim at z=%.3f" % (BOLT_SIZE, BOLT_HEIGHT))
    kit.bevel(bolts, width=BOLT_SIZE * 0.12, segments=2)
    kit.array(bolts, count=BOLT_COUNT, spin=360)

    # -----------------------------------------------------------------------
    # (5) THE MATERIALS. Two is the minimum that makes a prop read as built
    #     from parts. Colours are LINEAR rgb, not sRGB hex: a mid grey is
    #     around 0.2, not 0.5.
    #     Pass texture_path="…/stone.png" once the image tool has produced an
    #     albedo - a flat colour is a placeholder wherever the target shows a
    #     real material.
    # -----------------------------------------------------------------------
    kit.set_material(base, color=(0.26, 0.25, 0.23), roughness=0.85, metallic=0.0)
    kit.set_material(bolts, color=(0.06, 0.06, 0.07), roughness=0.42, metallic=0.9)

    # -----------------------------------------------------------------------
    # Standing it up and shipping it. Same three calls as `prep_asset.py`, for
    # the same reason: feet on y = 0 and a known size are what let this prop
    # stand next to anything else without being placed by hand.
    # -----------------------------------------------------------------------
    parts = [base, bolts]
    kit.apply_transforms(parts)
    kit.ground(parts)
    if FINAL_HEIGHT:
        kit.normalize(parts, height=FINAL_HEIGHT)
    else:
        log("size: left at the metres in block (1); set FINAL_HEIGHT to force one")
    kit.single_sided(parts)
    kit.export_glb(out_path, parts)
    log("done")


main()
