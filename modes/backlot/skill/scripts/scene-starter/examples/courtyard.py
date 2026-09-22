"""The ruined mountain-temple courtyard: the set three duel examples share.

A greybox set is worth writing ONCE. `duel_orbit.py`, `duel_dolly_zoom.py`
and `duel_crane.py` are three shots of the same fight in the same place, and
they agree about that place by importing this module rather than by copying
its numbers - which is also what lets them be cut together (see
`duel_collage.py`).

Copy BOTH files into a shot: `previz.mjs render` runs `greybox/scene.py` with
the kit on `sys.path`, and the scene adds its own directory, so a
`courtyard.py` beside it imports. Change the set here and every angle of the
fight changes with it.

The plan, in metres, Blender axes (Z up, the ground is XY):

    +Y  ......... colonnade at y = 7.6, seven columns, three of them broken
        bell tower at x = -10        great tree at x = 8.6, y = -4.2
        .............. the duel happens at CENTER ..............
    -Y  ......... the terrace edge and two steps at y = -9

The bell tower and the great tree are declared as LANDMARKS, so they come out
of the render red and blue instead of grey and the prompt can name them. That
is what stops three angles of one fight from disagreeing about which end of
the terrace the tower is on - see `references/greybox.md`.

Nothing here moves. Prayer flags are geometry, not cloth simulation: the
video model paints the flutter, the greybox says where the lines hang.
"""

import math

import previz_kit as pv

# --- the plan --------------------------------------------------------------

TERRACE = (24.0, 18.0)      # the stone platform the fight happens on
CENTER = (0.0, -0.5)        # what the cameras look at
MARK_A = (-1.7, -1.2)       # the challenger's mark
MARK_B = (1.5, 0.4)         # the master's mark
COLONNADE_Y = 7.6
TOWER = (-10.0, 0.8)
TREE = (8.6, -4.2)

# Two muted body colours. A greybox is grey on purpose, but two pawns in one
# frame have to be TOLD APART - at 8 m the visor alone does not do it, and a
# note that says "the challenger leaps" is useless if nobody can say which
# one he is.
OCHRE = (0.78, 0.63, 0.42)
SLATE = (0.44, 0.50, 0.60)


def facing(here, there):
    """The yaw in degrees that points a figure at `there` - forward is +Y."""
    return math.degrees(-math.atan2(there[0] - here[0], there[1] - here[1]))


def ring(center, radius, degrees, height):
    """A point on an orbit ring - the same angle convention `pv.orbit` uses."""
    angle = math.radians(degrees)
    return (center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle), height)


def strut(name, a, b, thickness=0.05, material=None):
    """A thin box spanning two 3-D points - a rope, a rafter, a flag line.

    The kit has no "line", and it does not need one: a box whose long axis is
    +X, yawed onto the direction and pitched onto the rise, is a line. This is
    what "the kit is a vocabulary, not a fence" means in practice - raw `bpy`
    for the rotation, everything else from the kit.
    """
    dx, dy, dz = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    middle = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0, (a[2] + b[2]) / 2.0)
    obj = pv.box(name, (length, thickness, thickness), middle, material if material is not None else pv.DARK)
    obj.rotation_euler = (0.0, -math.asin(max(-1.0, min(1.0, dz / length))), math.atan2(dy, dx))
    return obj


def _flag_line(name, a, b, sag=0.9, flags=5):
    """A sagging line of prayer flags between two points."""
    parts = []
    points = []
    for step in range(5):
        u = step / 4.0
        points.append((a[0] + (b[0] - a[0]) * u,
                       a[1] + (b[1] - a[1]) * u,
                       a[2] + (b[2] - a[2]) * u - sag * 4.0 * u * (1.0 - u)))
    for index in range(4):
        parts.append(strut("%s_rope_%d" % (name, index), points[index], points[index + 1], 0.04))
    for index in range(flags):
        u = (index + 0.5) / flags
        low = min(3, int(u * 4))
        local = u * 4.0 - low
        hang = (points[low][0] + (points[low + 1][0] - points[low][0]) * local,
                points[low][1] + (points[low + 1][1] - points[low][1]) * local,
                points[low][2] + (points[low + 1][2] - points[low][2]) * local)
        parts.append(pv.box("%s_flag_%d" % (name, index), (0.26, 0.03, 0.34),
                            (hang[0], hang[1], hang[2] - 0.20), pv.GREY))
    return parts


def build_courtyard():
    """Terrace, colonnade, bell tower, great tree, rubble and two flag lines.

    Returns the parts by name so a shot can accent one of them (the bell, say)
    without hunting through `bpy.data.objects`.
    """
    parts = {}
    width, depth = TERRACE

    # The floor everything stands on: its TOP is z = 0, so a figure at z = 0
    # is standing on the stone rather than sunk into it.
    parts["terrace"] = pv.box("terrace", (width, depth, 0.4), (0.0, 0.0, -0.2), pv.GREY)
    for index, (dy, dz) in enumerate(((-0.45, -0.20), (-1.05, -0.45))):
        parts["step_%d" % index] = pv.box("step_%d" % index, (9.0, 0.6, 0.22),
                                          (0.0, -depth / 2.0 + dy, dz), pv.GREY)

    # The colonnade. Three of the seven are broken off, which is what makes it
    # a RUIN rather than a temple - and broken columns give the orbit
    # something to sweep past at different heights.
    heights = (4.6, 4.6, 2.0, 4.6, 3.1, 4.6, 1.3)
    for index, height in enumerate(heights):
        x = -9.0 + index * 3.0
        parts["column_%d" % index] = pv.cylinder("column_%d" % index, 0.42, height,
                                                 (x, COLONNADE_Y, height / 2.0), pv.WHITE, vertices=18)
    for index, x in enumerate((-7.5, 4.5)):
        parts["architrave_%d" % index] = pv.box("architrave_%d" % index, (3.9, 0.9, 0.5),
                                                (x, COLONNADE_Y, 4.85), pv.WHITE)

    # The bell tower at the -X end, with its bell hanging inside it.
    parts["tower"] = pv.box("tower", (3.8, 3.8, 6.4), (TOWER[0], TOWER[1], 3.2), pv.WHITE)
    parts["tower_top"] = pv.box("tower_top", (4.6, 4.6, 0.5), (TOWER[0], TOWER[1], 6.65), pv.GREY)
    parts["bell"] = pv.cylinder("bell", 0.75, 1.2, (TOWER[0], TOWER[1], 5.6), pv.DARK, vertices=16)

    # The great tree: a trunk and two canopy masses, because one sphere reads
    # as a lollipop from every angle an orbit will see it from.
    parts["trunk"] = pv.cylinder("trunk", 0.52, 5.2, (TREE[0], TREE[1], 2.6), pv.DARK, vertices=14)
    parts["canopy"] = pv.sphere("canopy", 3.3, (TREE[0], TREE[1], 6.3), pv.GREY)
    parts["canopy_low"] = pv.sphere("canopy_low", 2.1, (TREE[0] - 2.2, TREE[1] + 1.4, 5.2), pv.GREY)

    # Rubble: fallen stone the fighters move around. The drums are fallen
    # column sections, lying down - a cylinder rotated onto its side.
    for index, (x, y, yaw) in enumerate(((-5.8, 3.4, 18), (6.2, 2.6, -37), (-3.4, 5.2, 64),
                                         (4.8, -5.6, 8), (-7.2, -4.4, -22))):
        block = pv.box("block_%d" % index, (1.3, 0.95, 0.72), (x, y, 0.36), pv.WHITE)
        block.rotation_euler = (0.0, 0.0, math.radians(yaw))
        parts["block_%d" % index] = block
    for index, (x, y, yaw) in enumerate(((2.9, 4.6, 76), (-6.6, 0.9, 12))):
        drum = pv.cylinder("drum_%d" % index, 0.42, 2.4, (x, y, 0.42), pv.WHITE, vertices=16)
        drum.rotation_euler = (math.radians(90.0), 0.0, math.radians(yaw))
        parts["drum_%d" % index] = drum

    # Prayer flags: tower to tree, and tower to the tallest standing column.
    parts["flags_tree"] = _flag_line("flags_tree", (TOWER[0] + 1.9, TOWER[1] - 0.6, 6.2),
                                     (TREE[0] - 0.4, TREE[1] + 0.3, 5.0))
    parts["flags_column"] = _flag_line("flags_column", (TOWER[0] + 1.9, TOWER[1] + 1.2, 6.4),
                                       (0.0, COLONNADE_Y, 4.4), sag=0.7, flags=4)

    # THE TWO PLACES THE STORY CARES ABOUT THE SIDE OF. Grey, the tower and
    # the tree are two more lumps and the model decides per take which side of
    # the terrace each one is on; painted, `@Video1` shows a red mass at one
    # end and a blue one at the other, and the prompt can say which is which.
    # `finish()` records both, with whether the camera sees them at each end of
    # the clip and which of them is standing behind each fighter.
    pv.landmark("tower", [parts["tower"], parts["tower_top"]],
                label="bell tower", color="red")
    pv.landmark("tree", [parts["trunk"], parts["canopy"], parts["canopy_low"]],
                label="great tree", color="blue")

    pv.log("courtyard %.0fx%.0f m terrace, %d named parts" % (width, depth, len(parts)))
    return parts


def duel_pawns(a_at=MARK_A, b_at=MARK_B):
    """The two fighters, told apart by colour; returns (challenger, master).

    `a_at` is where the challenger BEGINS - pass his launch point when the
    shot opens with him already in the air, and land him on `MARK_A` with
    `pv.dash(..., arc=...)`.
    """
    challenger = pv.figure("challenger", height=1.78, location=a_at,
                           yaw=facing(a_at, b_at), material=pv.material("ochre", OCHRE))
    master = pv.figure("master", height=1.72, location=b_at,
                       yaw=facing(b_at, a_at), material=pv.material("slate", SLATE))
    return challenger, master
