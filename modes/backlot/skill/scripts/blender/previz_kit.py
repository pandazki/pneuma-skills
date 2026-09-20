"""previz_kit.py - the greybox grammar a previz scene.py imports.

A greybox is not a model of the world; it is a STATEMENT about space, action
and camera that a video model can be conditioned on. The kit exists so an
agent spends its judgement on that statement and none of it on rediscovering
how Blender hinges a door, how a path turns a corner, or which export
flag survived this release.

    import previz_kit as pv

    pv.setup(seconds=8, fps=24, width=1280, height=720)
    pv.room(9, 14, 3.4, door=(0, 2.2))
    who = pv.figure("root", location=(0.45, -5.6))
    pv.travel(who, [(0.45, -5.6), (0.45, -0.05)], start=0.5, end=4.5)
    pv.hold(who, 4.5, 8.0)
    cam = pv.camera(28)
    pv.camera_move(cam, [(0, (-3.5, -5.9, 2.1), (0.3, 0.2, 1.25)),
                         (7.5, (-2.3, -2.9, 1.75), (0.3, 0.2, 1.25))])
    pv.accent([core], 5.5, 7.5, (0.08, 0.42, 1.0))
    pv.finish()

`previz.mjs render` puts this directory on `sys.path` and passes the output
directory, the preview scale and the expected frame range after a literal
`--`. Run the same scene.py under bare Blender and the kit falls back to
`./frames` at full size with no expectations, so raw bpy debugging still
works. Raw `bpy` stays available throughout: the kit is a starting vocabulary,
not a fence.

## The vocabulary

Times are SECONDS; the kit converts them to frames. Everything is metres.

* `setup(seconds, fps, width, height)` - empty the file, fix the shot's clock
  and size, build the Workbench greybox look
* `box(name, size, location, material, parent)` · `cylinder(name, radius,
  depth, ...)` · `sphere(name, radius, ...)` · `plane(name, size, ...)` ·
  `room(width, depth, height, door=(x, w))` - the space
* `material(name, rgb)` · `accent_material(name, rgb)` · `WHITE`/`GREY`/`DARK`
* `figure(name, height, location, yaw, material)` - a person-sized pawn
* `travel(fig, path, start, end, settle, ramp, pace="walk")` - walk or run a
  ground path; the cruise speed is checked against `pace`
* `dash(fig, path, start, end, pace="leap", settle, ramp, arc=None)` - the
  same path machinery at burst speed, with an optional parabolic leap arc
* `turn(fig, to_yaw, start, end)` · `hold(fig, start, end)` ·
  `pose_at(fig, seconds)` - where a figure is and faces at any shot time,
  answered from its tracks before anything is baked
* `hinge(name, location, axis)` + `swing(pivot, keys)` - a prop that pivots
* `move(obj, keys, ease)` - eased location/rotation keys for a prop
* `camera(lens, name, location, look_at)` - the shot camera, TRACK_TO aimed
* `camera_move(cam, keys, settle)` - eased camera keys that end settled
* `orbit(cam, center, radius, height, deg_from, deg_to, start, end, look_at,
  ease)` - an arc around a point, aim held on the middle
* `zoom(cam, mm_from, mm_to, start, end, ease)` - animate the focal length
* `dolly_zoom(cam, subject, dist_from, dist_to, start, end, ease)` - travel
  the camera's own sightline while the lens holds the subject's size
* `accent(objects, start, end, color)` - the one colour event
* `set_interpolation(obj, mode, ease)` · `F(seconds)` · `T(frame)` ·
  `shot()` · `runner_args()` · `log(text)` · `die(reason)`
* `finish(render=True)` - bake, validate, render, save, export, write meta

## Axes

Everything here speaks BLENDER axes: Z up, and the ground plane is XY. A
figure's forward is its local +Y, which is why `travel` yaws the root to the
path tangent and why a yaw of 0 faces +Y. That one sentence is the whole sign
convention.

## What the greybox states, and what it leaves to the model

A greybox states SPACE, BLOCKING and CAMERA: what is where, who is where and
facing which way at each second, and what the lens does. It does NOT state
body action. A gait, a hand rising, a press - that is what the video model is
good at and what hinged boxes are bad at: a mannequin whose knees are solved
to the centimetre still reads as a puppet, and a model conditioned on a
puppet paints a puppet. So the subject here is a PAWN: a person-sized volume
with an unambiguous front, travelling a ground path. "Walks in, raises the
left hand and presses the button" belongs in the PROMPT, written over a clip
that has already fixed where he walks, when he arrives and which way he
faces.

The one body-adjacent thing the pawn still carries is SPEED. The model
animates a gait at whatever speed the clip shows, so `travel` checks the
cruise speed against the pace you declare and refuses an implausible one: a
3 m/s "walk" comes back as a skate or a sprint.

Props are the other way round. A door opening is a spatial event, not a limb,
so it stays in the greybox: `hinge` gives the pivot, `swing` keys the angle.

## Every function prints one line

`--background` has no UI and no error dialog; the printed log is the only
observability there is. Each function prints one `[previz]` line saying what
it did. A refusal calls `die()`: one `ERROR:` line on stderr and
`sys.exit(1)`, because Blender can exit 0 after an uncaught Python exception
and a raise is therefore not a reliable refusal.

## Measured notes (Blender 5.2.1, 2026-09-20)

* A Blender 5.x action stores its curves in layers/strips, not in
  `action.fcurves`; `_fcurves()` reads whichever this release has.
* The glTF exporter with `export_animation_mode="SCENE"` and
  `export_force_sampling=True` writes ONE animation per animated object, named
  after the object, sampled on every frame, with glTF time = frame / fps.
  The camera's TRACK_TO constraint arrives baked as translation + rotation.
* glTF carries no Workbench material colour animation, which is why `accent`
  records what it recoloured into `scene.meta.json` for the 3D lane to replay.
* glTF carries no FOCAL LENGTH animation either, and for the same kind of
  reason. Measured: with these export options an animated camera `lens`
  produces no channel at all - the camera's animation is `translation` +
  `rotation` only, and `cameras[0].perspective.yfov` is the lens at FRAME 1,
  frozen. Blender 5.2.1 can write the curve as `KHR_animation_pointer`
  (`export_pointer_animation=True` emits a second animation, also named after
  the camera, pointing at `/cameras/0/perspective/yfov`), but that is a
  non-core extension three.js's GLTFLoader does not read, and the duplicate
  animation name would break "one animation per object". So `zoom` and
  `dolly_zoom` record their focal keys in `scene.meta.json` as
  `camera_lens: [{frame, mm}]` - the Workbench render (the MP4 the video model
  is conditioned on) shows the zoom either way.
"""

import json
import math
import os
import sys

import bpy

# ---------------------------------------------------------------------------
# Refusals and the log
# ---------------------------------------------------------------------------


def die(message):
    """Refuse: one ERROR line on stderr, exit 1 (a raise is not reliable here)."""
    sys.stderr.write("ERROR: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    """One `[previz]` line on stdout - the only observability a headless run has."""
    print("[previz] %s" % message)
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# The runner's arguments
# ---------------------------------------------------------------------------


def runner_args():
    """The `--key value` pairs `previz.mjs render` passes after a literal `--`."""
    argv = list(sys.argv)
    if "--" not in argv:
        return {}
    rest = argv[argv.index("--") + 1:]
    args = {}
    index = 0
    while index + 1 < len(rest):
        if rest[index].startswith("--"):
            args[rest[index][2:]] = rest[index + 1]
            index += 2
        else:
            index += 1
    return args


# ---------------------------------------------------------------------------
# Shot state
# ---------------------------------------------------------------------------

_SHOT = None
_FIGURES = []
_ACCENTS = []
_SUBJECTS = []
_LENS = []

WHITE = None
GREY = None
DARK = None


def shot():
    """The current shot: seconds, fps, frames, width, height, out dir, scale."""
    if _SHOT is None:
        die("call previz_kit.setup(seconds=..., fps=...) before anything else")
    return _SHOT


def F(seconds):
    """Shot time in seconds -> the 1-based frame it lands on."""
    state = shot()
    frame = 1 + int(round(float(seconds) * state["fps"]))
    return max(1, min(state["frames"], frame))


def T(frame):
    """A 1-based frame -> the shot time it starts at."""
    return (frame - 1) / float(shot()["fps"])


def setup(seconds=8.0, fps=24, width=1280, height=720, world=(0.82, 0.83, 0.85)):
    """Empty the file, set the shot's clock and size, and build the Workbench look."""
    global _SHOT, _FIGURES, _ACCENTS, _SUBJECTS, _LENS, WHITE, GREY, DARK
    args = runner_args()
    frames = int(round(float(seconds) * int(fps)))
    if abs(float(seconds) * int(fps) - frames) > 1e-6:
        die("%s s at %s fps is not a whole number of frames" % (seconds, fps))
    if frames < 1:
        die("a shot needs at least one frame (got %s s at %s fps)" % (seconds, fps))

    # The runner's expectation is a CHECK, never an override: what the scene
    # says it is has to agree with what shot.json says it is, and disagreeing
    # in silence is how a paid take ends up one beat short.
    for key, mine, label in (
        ("expect-frames", frames, "frames"),
        ("expect-fps", int(fps), "fps"),
        ("expect-width", int(width), "width"),
        ("expect-height", int(height), "height"),
    ):
        if key in args and int(round(float(args[key]))) != int(mine):
            die(
                "scene.py says %s=%s but shot.json says %s=%s - edit setup() or the shot spec "
                "(previz.mjs shot ... --seconds --fps --size) so the two agree"
                % (label, mine, label, args[key])
            )

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = int(fps)
    scene.render.fps_base = 1.0
    scene.frame_start = 1
    scene.frame_end = frames
    scene.render.resolution_x = int(width)
    scene.render.resolution_y = int(height)
    scene.render.resolution_percentage = int(round(float(args.get("scale", 1.0)) * 100))
    scene.render.engine = "BLENDER_WORKBENCH"

    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    shading.show_shadows = True
    shading.shadow_intensity = 0.35
    shading.show_cavity = True
    shading.cavity_type = "BOTH"
    scene.display.render_aa = "8"
    scene.world = bpy.data.worlds.new("previz_world")
    scene.world.color = tuple(world)

    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.use_overwrite = True
    scene.render.use_placeholder = False
    out_dir = args.get("out", os.path.join(os.getcwd(), "frames"))
    scene.render.filepath = os.path.join(out_dir, "f_")

    _SHOT = {
        "seconds": float(seconds),
        "fps": int(fps),
        "frames": frames,
        "width": int(width),
        "height": int(height),
        "scale": float(args.get("scale", 1.0)),
        "out": out_dir,
        "blend": args.get("blend"),
        "glb": args.get("glb"),
        "meta": args.get("meta"),
        "camera": None,
    }
    _FIGURES = []
    _ACCENTS = []
    _SUBJECTS = []
    _LENS = []
    WHITE = material("white", (0.90, 0.90, 0.90))
    GREY = material("grey", (0.62, 0.63, 0.65))
    DARK = material("dark", (0.35, 0.36, 0.38))
    log(
        "setup %ss @ %sfps = %d frames, %dx%d at %d%%, frames -> %s"
        % (seconds, fps, frames, width, height, scene.render.resolution_percentage, out_dir)
    )
    return _SHOT


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------


def material(name, rgb):
    """A flat Workbench material - `diffuse_color` is what MATERIAL shading reads."""
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
    mat.use_nodes = False
    return mat


def accent_material(name="accent", rgb=(0.62, 0.63, 0.65)):
    """A material meant to be recoloured by `accent`, owned by one prop."""
    return material(name, rgb)


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------


def _finish_object(obj, name, mat, parent):
    obj.name = name
    if mat is not None:
        obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse.identity()
    return obj


def box(name, size, location=(0, 0, 0), material=None, parent=None):
    """A cuboid of `size` (x, y, z) metres, centred on `location`.

    `location` is in the PARENT's space when `parent` is given - which is what
    makes a door leaf `box(..., parent=hinge(...))` swing about the hinge.
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.scale = tuple(size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.location = tuple(location)
    return _finish_object(obj, name, material if material is not None else WHITE, parent)


def cylinder(name, radius, depth, location=(0, 0, 0), material=None, parent=None, vertices=32):
    """An upright cylinder centred on `location`."""
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=vertices, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.location = tuple(location)
    return _finish_object(obj, name, material if material is not None else WHITE, parent)


def sphere(name, radius, location=(0, 0, 0), material=None, parent=None, smooth=True):
    """A UV sphere centred on `location`."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=(0, 0, 0))
    obj = bpy.context.active_object
    if smooth:
        bpy.ops.object.shade_smooth()
    obj.location = tuple(location)
    return _finish_object(obj, name, material if material is not None else WHITE, parent)


def plane(name, size, location=(0, 0, 0), material=None):
    """A flat rectangle of `size` (x, y) metres - a floor or a wall panel."""
    return box(name, (size[0], size[1], 0.02), location, material if material is not None else GREY)


def room(width, depth, height, door=None, material=None, name="room"):
    """Floor, three walls and a front wall with an optional `door=(x, width)` gap."""
    mat = material if material is not None else WHITE
    parts = {}
    parts["floor"] = box("%s_floor" % name, (width, depth, 0.1), (0, 0, -0.05), GREY)
    parts["back"] = box("%s_wall_back" % name, (width, 0.2, height), (0, depth / 2.0, height / 2.0), mat)
    parts["left"] = box("%s_wall_l" % name, (0.2, depth, height), (-width / 2.0, 0, height / 2.0), mat)
    parts["right"] = box("%s_wall_r" % name, (0.2, depth, height), (width / 2.0, 0, height / 2.0), mat)
    front_y = -depth / 2.0
    if door is None:
        parts["front"] = box("%s_wall_front" % name, (width, 0.2, height), (0, front_y, height / 2.0), mat)
    else:
        door_x, door_w = (door if isinstance(door, (tuple, list)) else (0.0, float(door)))
        door_h = min(height - 0.4, 2.4)
        left_w = max(0.0, (door_x - door_w / 2.0) + width / 2.0)
        right_w = max(0.0, width / 2.0 - (door_x + door_w / 2.0))
        if left_w > 0.01:
            parts["front_l"] = box("%s_door_l" % name, (left_w, 0.2, height), (-width / 2.0 + left_w / 2.0, front_y, height / 2.0), mat)
        if right_w > 0.01:
            parts["front_r"] = box("%s_door_r" % name, (right_w, 0.2, height), (width / 2.0 - right_w / 2.0, front_y, height / 2.0), mat)
        if height - door_h > 0.01:
            parts["front_top"] = box(
                "%s_door_top" % name, (door_w, 0.2, height - door_h), (door_x, front_y, door_h + (height - door_h) / 2.0), mat
            )
    log("room %.1fx%.1fx%.1f m, %d parts, door=%s" % (width, depth, height, len(parts), door))
    return parts


# ---------------------------------------------------------------------------
# The subject: a pawn
# ---------------------------------------------------------------------------

# Proportions as fractions of the figure's height, so a 1.55 m and a 1.90 m
# figure read as the same kind of body. At the 1.75 m default the shoulders
# are 1.46 m up and the body is 0.46 m across by 0.26 m deep - an adult's real
# plan view, which is the whole reason the facing is legible. The head sits
# straight on the body (no gap: a floating ball reads as a lamp, not a head)
# and `_BODY_TOP + 2 * _HEAD_R == 1`, so the figure is exactly `height` tall.
_BODY_TOP = 0.835
_BODY_WIDTH = 0.263
_BODY_DEPTH = 0.149
_HEAD_R = 0.0825
# The body tapers to this fraction of its width at the floor. A straight
# column reads as a bollard; a tapered one reads as a standing body, and the
# shoulder line - the part that says which way it faces - stays full width.
_BODY_FOOT = 0.88
# Shoulder to fingertip. Nothing is drawn with it; it is the radius an author
# checks a prop against when placing a figure "within arm's reach" of the
# thing the prompt will say it touches.
_ARM = 0.410


def figure(name, height=1.75, location=(0.0, 0.0), yaw=0.0, material=None):
    """A person-sized PAWN: a root that travels, one body volume, a head, a face marker.

    No arms and no legs, on purpose - the note at the top of this file says
    why. The body is an ELLIPSE in plan, wide across the shoulders and shallow
    front to back, so which way the figure faces reads from any camera angle;
    the dark visor on the head settles it at a glance. Forward is local +Y, so
    `yaw=0` faces +Y and `yaw=-90` faces +X.

    Returns the handle `travel`, `turn` and `hold` take. `dims["arm"]` is the
    shoulder-to-fingertip radius: stop the figure closer than that to whatever
    it is meant to touch, and the prompt can say "presses the button" over a
    clip where the button is actually within its reach.
    """
    shot()
    mat = material if material is not None else WHITE
    h = float(height)
    if h < 0.3:
        die("figure: height is metres of body, not a scale factor (got %s)" % height)
    dims = {
        "height": h,
        "width": _BODY_WIDTH * h,
        "depth": _BODY_DEPTH * h,
        "shoulder_z": _BODY_TOP * h,
        "head_r": _HEAD_R * h,
        "arm": _ARM * h,
    }
    dims["head_z"] = dims["shoulder_z"] + dims["head_r"]

    root = bpy.data.objects.new(name, None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.3
    bpy.context.scene.collection.objects.link(root)
    root.location = (float(location[0]), float(location[1]), 0.0)
    root.rotation_euler = (0.0, 0.0, math.radians(yaw))

    body = cylinder("%s_body" % name, dims["width"] / 2.0, dims["shoulder_z"],
                    (0, 0, dims["shoulder_z"] / 2.0), mat, root, vertices=28)
    # Shaping the MESH and not the object keeps every scale at 1: a parent
    # with a non-uniform scale is what shears its children once glTF has
    # decomposed the matrix. Squash in Y for the shoulder axis, taper toward
    # the floor for a body rather than a post.
    squash = dims["depth"] / dims["width"]
    top = dims["shoulder_z"]
    for vertex in body.data.vertices:
        taper = _BODY_FOOT + (1.0 - _BODY_FOOT) * max(0.0, min(1.0, (vertex.co.z + top / 2.0) / top))
        vertex.co.x *= taper
        vertex.co.y *= squash * taper
    head = sphere("%s_head" % name, dims["head_r"], (0, 0, dims["head_z"]), mat, root)
    # The face. It has to STICK OUT: a marker flush with the head is invisible
    # the moment the figure is more than a few metres from the lens, and then
    # nothing in the frame says which way the body is pointing.
    visor = box("%s_visor" % name,
                (dims["head_r"] * 1.45, dims["head_r"] * 1.15, dims["head_r"] * 0.62),
                (0, dims["head_r"] * 0.72, dims["head_z"] + dims["head_r"] * 0.10), DARK, root)

    fig = {
        "name": name,
        "root": root,
        "body": body,
        "head": head,
        "visor": visor,
        "dims": dims,
        "base": (float(location[0]), float(location[1]), math.radians(yaw)),
        "tracks": [],
    }
    _FIGURES.append(fig)
    _SUBJECTS.append(root.name)
    log("figure %s h=%.2f at (%.2f, %.2f) yaw=%.0f deg, body %.2f x %.2f m, arm's reach %.2f m"
        % (name, h, location[0], location[1], yaw, dims["width"], dims["depth"], dims["arm"]))
    return fig


# ---------------------------------------------------------------------------
# Motion tracks
# ---------------------------------------------------------------------------

# Metres of path a heading is averaged over. A corner then arrives as a turn
# the figure leans into over half a metre rather than a one-frame snap, and
# the figure still stands exactly on the path.
_HEADING_WINDOW = 0.7

# Plausible cruise speeds in m/s. These are not style: the video model
# animates a gait at whatever speed the clip shows, so they are the speeds a
# gait can honestly be animated at.
_PACES = {"walk": (0.7, 1.9), "run": (2.5, 6.5)}

# `dash`'s own table, kept SEPARATE on purpose. A leap is not a fast walk, and
# the way to let one through must never be to widen the speeds a walk is
# checked against - a 4 m/s "walk" would come back as a skate whatever the
# story needed.
_DASH_PACES = {"leap": (4.0, 12.0), "burst": (2.5, 6.0)}

# The tallest arc `dash` will put under a leap. Higher than this and the pawn
# is not leaping, it is flying, and the clip stops being a statement about
# where a body goes.
_MAX_ARC = 3.0


def _ease(t):
    """Smoothstep on [0, 1]."""
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def _shortest(angle):
    """An angle difference folded into [-pi, pi] - the short way round."""
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def _path_length(path):
    total = 0.0
    for index in range(1, len(path)):
        total += math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1])
    return total


def _point_along(path, distance):
    """(x, y, heading) at `distance` metres along a ground polyline."""
    if len(path) == 1:
        return path[0][0], path[0][1], 0.0
    remaining = max(0.0, distance)
    for index in range(1, len(path)):
        ax, ay = path[index - 1]
        bx, by = path[index]
        segment = math.hypot(bx - ax, by - ay)
        heading = math.atan2(bx - ax, by - ay)  # +Y is forward, so yaw is atan2(dx, dy) negated below
        if segment <= 1e-9:
            continue
        if remaining <= segment or index == len(path) - 1:
            ratio = min(1.0, remaining / segment)
            return ax + (bx - ax) * ratio, ay + (by - ay) * ratio, -heading
        remaining -= segment
    return path[-1][0], path[-1][1], 0.0


def _heading_at(path, length, distance):
    """Yaw (rad) of the path at `distance`, read as the CHORD across a window.

    A chord cannot wrap: it is a direction between two points, not an angle
    being averaged, so a path that doubles back still produces a heading that
    sweeps the short way round instead of spinning through 360 degrees.
    """
    span = min(_HEADING_WINDOW, length)
    low = max(0.0, min(length - span, distance - span / 2.0))
    ax, ay, _ = _point_along(path, low)
    bx, by, _ = _point_along(path, low + span)
    if math.hypot(bx - ax, by - ay) < 1e-9:
        return _point_along(path, distance)[2]
    return -math.atan2(bx - ax, by - ay)


def _cruise_speed(length, span, ramp, settle):
    """The one speed the middle of a travel runs at; ramp and settle average half of it."""
    return length / max(1e-6, ramp / 2.0 + max(1e-6, span - ramp - settle) + settle / 2.0)


def _ground_move(label, paces, fig, path, start, end, settle, ramp, pace, arc):
    """The one path-and-speed machine behind `travel` and `dash`.

    Both verbs mean the same thing to the scene - a root crossing the ground
    between two times - and differ only in the speeds they accept and in
    whether the path leaves the floor. Keeping one implementation is what
    stops a future fix to the easing or the heading from landing in one verb
    and not the other.
    """
    state = shot()
    if len(path) < 2:
        die("%s: needs a path of at least two (x, y) points" % label)
    if end <= start:
        die("%s: end (%s) must be after start (%s)" % (label, end, start))
    if end <= 0.0:
        die("%s: end (%s s) is at or before the shot's first frame - none of it would be seen" % (label, end))
    if end > state["seconds"] + 1e-6:
        die("%s: end %s s is past the shot's %s s" % (label, end, state["seconds"]))
    span = float(end) - float(start)
    settle = max(0.0, min(float(settle), span * 0.6))
    ramp = max(0.0, min(float(ramp), (span - settle) * 0.5))
    points = [(float(point[0]), float(point[1])) for point in path]
    length = _path_length(points)
    if length <= 1e-6:
        die("%s: the path has zero length - a figure that stays put needs hold(), not %s()" % (label, label))
    rise = 0.0 if arc in (None, 0, 0.0) else float(arc)
    if rise < 0.0 or rise > _MAX_ARC:
        die("%s: arc=%s m must be a rise between 0 and %.1f m - that is a leap; anything taller is a "
            "flight, and the clip stops saying where the body goes" % (label, arc, _MAX_ARC))
    speed = _cruise_speed(length, span, ramp, settle)
    if pace is not None:
        key = str(pace).lower()
        if key not in paces:
            die("%s: pace must be %s, or None to skip the check (got %r)"
                % (label, " or ".join('"%s"' % name for name in sorted(paces)), pace))
        low, high = paces[key]
        if speed < low or speed > high:
            die(
                "%s: %s covers %.2f m between %s s and %s s, which cruises at %.2f m/s "
                "(%.2f s ramp + %.2f s cruise + %.2f s settle) - a %s is %.1f-%.1f m/s. "
                "Give it more seconds, a shorter path, or the pace it really is; the video "
                "model animates the gait at the speed this clip shows."
                % (label, fig["name"], length, start, end, speed, ramp, max(0.0, span - ramp - settle),
                   settle, key, low, high)
            )
    fig["tracks"].append({
        "kind": "travel",
        "path": points,
        "start": float(start),
        "end": float(end),
        "settle": settle,
        "ramp": ramp,
        "length": length,
        "arc": rise,
    })
    x, y, _ = _point_along(points, length)
    yaw = math.degrees(_heading_at(points, length, length)) + 0.0
    yaw = 0.0 if abs(yaw) < 1e-9 else yaw
    log("%s %s %.2f m over %.2f-%.2f s at %.2f m/s (%s%s), arrives (%.2f, %.2f) facing %.0f deg"
        % (label, fig["name"], length, start, end, speed, pace,
           ", arc %.2f m" % rise if rise else "", x, y, yaw))
    return (x, y, yaw)


def travel(fig, path, start, end, settle=0.7, ramp=0.3, pace="walk"):
    """Move a figure along a ground path between two times; returns the arrival (x, y, yaw degrees).

    Root motion and nothing else: no bob, no sway, no gait. It eases out of
    the start over `ramp` seconds, cruises at one speed, and eases into the
    stop over `settle`. The yaw follows the path, averaged over a short window
    so a corner rounds off, and eased into over the ramp so a figure that
    starts facing elsewhere turns into its path instead of snapping to it.

    `start` MAY BE NEGATIVE: the travel then began before the shot did and the
    figure is already moving at frame 1 - which is how a shot opens mid-action
    instead of on somebody standing still waiting for their cue.

    `pace` is a claim about the speed, and the claim is CHECKED. The video
    model animates a gait at whatever speed this clip shows, so a walk that
    cruises at 3 m/s comes back as a skate or a sprint. Pass `pace=None` when
    the subject is not a person on foot. A burst that is genuinely faster than
    a run is `dash`, which has its own speeds - never a loosened `pace` here.
    """
    return _ground_move("travel", _PACES, fig, path, start, end, settle, ramp, pace, 0.0)


def dash(fig, path, start, end, pace="leap", settle=0.2, ramp=0.15, arc=None):
    """A burst along a ground path - a leap, a lunge, a charge; returns the arrival (x, y, yaw degrees).

    Everything `travel` does, at the speeds a body can be thrown across a
    space rather than walked across it: `"leap"` is 4-12 m/s and `"burst"` is
    2.5-6 m/s, checked the same way and kept in their own table so the walking
    speeds never have to be widened to let a fight through. The ramp and
    settle default short, because a burst does not ease out of the floor the
    way a walk does.

    `arc=<metres>` lifts the root on a parabola that peaks halfway ALONG THE
    PATH and is back on the floor at the end - the leap itself. It is keyed
    against distance travelled, not time, so the landing happens on the frame
    the figure arrives rather than a few frames either side of it.

    The body in the air is still the prompt's job: this fixes where the leap
    starts, how high it goes, where it lands and when. "Springs off the step,
    sword low, lands in a crouch" is a sentence, not a pawn.
    """
    return _ground_move("dash", _DASH_PACES, fig, path, start, end, settle, ramp, pace, arc)


def turn(fig, to_yaw, start, end):
    """Rotate the figure in place to `to_yaw` degrees, eased.

    `to_yaw` is taken literally: 270 spins three quarters of the way round
    where -90 arrives at the same facing the short way. A heading derived from
    a path never does that - `_heading_at` reads a direction, not an angle.
    """
    if end <= start:
        die("turn: end (%s) must be after start (%s)" % (end, start))
    fig["tracks"].append({"kind": "turn", "yaw": math.radians(float(to_yaw)), "start": float(start), "end": float(end)})
    log("turn %s to %.0f deg over %.2f-%.2f s" % (fig["name"], to_yaw, start, end))
    return to_yaw


def hold(fig, start, end):
    """Keep the pose over a window - the settled tail a shot usually needs."""
    if end < start:
        die("hold: end (%s) is before start (%s)" % (end, start))
    fig["tracks"].append({"kind": "hold", "start": float(start), "end": float(end)})
    log("hold %s %.2f-%.2f s" % (fig["name"], start, end))
    return fig


# ---------------------------------------------------------------------------
# Baking a figure
# ---------------------------------------------------------------------------


def _travel_distance(track, t):
    """Metres along the path at shot time t: eased out of the start, eased into the stop."""
    start, end = track["start"], track["end"]
    ramp, settle, length = track["ramp"], track["settle"], track["length"]
    if t <= start:
        return 0.0
    if t >= end:
        return length
    cruise = max(1e-6, (end - start) - ramp - settle)
    speed = _cruise_speed(length, end - start, ramp, settle)
    u = t - start
    if u < ramp:
        w = u / ramp
        return speed * ramp * w * w / 2.0
    if u < ramp + cruise:
        return speed * ramp / 2.0 + speed * (u - ramp)
    w = min(1.0, (u - ramp - cruise) / max(1e-6, settle))
    return speed * ramp / 2.0 + speed * cruise + speed * settle * (w - w * w / 2.0)


def pose_at(fig, seconds):
    """Where a figure is and which way it faces at shot time `seconds`: (x, y, z, yaw radians).

    A pure function of the tracks, so it answers before `finish` has baked
    anything - which is how a camera can be aimed at where somebody WILL be
    standing rather than at the mark they were built on.

    Tracks CARRY FORWARD: a travel that has ended still holds its arrival, so
    a `turn` or a `hold` after it sees where the figure stopped without anyone
    restating it, and every time is answered from scratch - which is what lets
    a travel's `start` be negative.
    """
    t = float(seconds)
    tracks = sorted([track for track in fig["tracks"] if track["kind"] in ("travel", "turn", "hold")],
                    key=lambda track: track["start"])
    x, y, yaw = fig["base"]
    z = 0.0
    for track in tracks:
        if t < track["start"]:
            continue
        if track["kind"] == "travel":
            walked = _travel_distance(track, t)
            px, py, _ = _point_along(track["path"], walked)
            heading = _heading_at(track["path"], track["length"], walked)
            into = 1.0 if track["ramp"] <= 1e-6 else _ease((t - track["start"]) / track["ramp"])
            x, y = px, py
            # The leap: a parabola in DISTANCE along the path, so the feet
            # leave the floor at the start and are back on it exactly when
            # the figure arrives, whatever the easing did to the timing.
            rise = track.get("arc", 0.0)
            along = min(1.0, max(0.0, walked / max(1e-6, track["length"])))
            z = rise * 4.0 * along * (1.0 - along) if rise else 0.0
            # Written as heading PLUS a decaying offset, not as a blend
            # towards the heading: once the ramp is over the yaw is the
            # heading itself, so a path that turns a corner never leaves
            # the figure carrying a wound-up 270 where -90 was meant.
            yaw = heading + _shortest(yaw - heading) * (1.0 - into)
        elif track["kind"] == "turn":
            w = _ease((t - track["start"]) / max(1e-6, track["end"] - track["start"]))
            yaw = yaw + (track["yaw"] - yaw) * w
    return (x, y, z, yaw)


def _bake_figure(fig):
    """Key the root on every frame; the profile is already eased, so the keys are LINEAR."""
    state = shot()
    root = fig["root"]
    for frame in range(1, state["frames"] + 1):
        x, y, z, yaw = pose_at(fig, T(frame))
        root.location = (x, y, z)
        root.rotation_euler = (0.0, 0.0, yaw)
        root.keyframe_insert("location", frame=frame)
        root.keyframe_insert("rotation_euler", frame=frame)
    set_interpolation(root, "LINEAR", None)
    log("baked %s over %d frames" % (fig["name"], state["frames"]))


# ---------------------------------------------------------------------------
# Props and the camera
# ---------------------------------------------------------------------------


def _fcurves(obj):
    """This release's f-curves for an object - Blender 5.x hides them in layers."""
    animation = obj.animation_data
    if not animation or not animation.action:
        return []
    action = animation.action
    layers = getattr(action, "layers", None)
    if not layers:
        return list(action.fcurves)
    curves = []
    for layer in layers:
        for strip in layer.strips:
            bag = strip.channelbag(animation.action_slot) if hasattr(strip, "channelbag") else None
            if bag:
                curves.extend(bag.fcurves)
    return curves


def set_interpolation(obj, mode="BEZIER", ease="EASE_IN_OUT"):
    """Set every key of an object's curves to one interpolation mode.

    `mode` is a Blender interpolation: `"BEZIER"` for an eased key, `"LINEAR"`
    for keys that are already a sampled curve and must not be re-smoothed,
    `"CONSTANT"` for a switch. `ease` is the easing side; pass `None` to leave
    it alone. Reach for it when you key an object by hand - a hand-keyed look
    target, a prop you drove with raw `bpy` - and want the kit's curve shape.
    """
    for curve in _fcurves(obj):
        for point in curve.keyframe_points:
            point.interpolation = mode
            if ease:
                point.easing = ease


# The name the kit used before this was public; kept so older scene.py files
# that reached for the private one keep working.
_set_interpolation = set_interpolation


def move(obj, keys, ease="EASE_IN_OUT"):
    """Key an object's location (and rotation, when a key carries one) over time.

    `keys` is [(seconds, (x, y, z))] or [(seconds, (x, y, z), (rx, ry, rz) in degrees)].
    """
    if not keys:
        die("move: needs at least one key")
    for key in keys:
        frame = F(key[0])
        obj.location = tuple(key[1])
        obj.keyframe_insert("location", frame=frame)
        if len(key) > 2 and key[2] is not None:
            obj.rotation_euler = tuple(math.radians(a) for a in key[2])
            obj.keyframe_insert("rotation_euler", frame=frame)
    set_interpolation(obj, "BEZIER", ease)
    if obj.name not in _SUBJECTS:
        _SUBJECTS.append(obj.name)
    log("move %s over %d keys" % (obj.name, len(keys)))
    return obj


_AXES = {"X": 0, "Y": 1, "Z": 2}


def hinge(name, location, axis="Z", parent=None):
    """A pivot empty on a hinge LINE; parent the leaf to it and `swing` it open.

    A door is not a box that slides: it turns about its hinge edge, and the
    only way a greybox says that is to put the origin there. So `hinge` goes
    at the hinge edge and the leaf hangs off it -

        pivot = pv.hinge("cabinet_door", (0.45, 3.35))
        pv.box("cabinet_leaf", (0.72, 0.04, 1.85), (-0.36, -0.02, 1.0), pv.GREY, pivot)
        pv.swing(pivot, [(5.5, 0), (6.8, 68)])

    - the leaf's location being in the pivot's space (that is what `parent=`
    means everywhere in this kit). `axis` is the axis it turns about: "Z" for
    a door, "X" or "Y" for a lid or a hatch. `location` may be (x, y), which
    means the hinge line stands on the floor.
    """
    axis = str(axis).upper()
    if axis not in _AXES:
        die('hinge: axis must be "X", "Y" or "Z" (got %r)' % axis)
    point = tuple(float(value) for value in location)
    if len(point) == 2:
        point = (point[0], point[1], 0.0)
    if len(point) != 3:
        die("hinge: location must be (x, y) or (x, y, z) (got %r)" % (location,))
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "SINGLE_ARROW"
    obj.empty_display_size = 0.25
    bpy.context.scene.collection.objects.link(obj)
    obj.location = point
    obj["previz_axis"] = axis
    _finish_object(obj, name, None, parent)
    log("hinge %s at (%.2f, %.2f, %.2f) about %s" % (name, point[0], point[1], point[2], axis))
    return obj


def swing(pivot, keys, ease="EASE_IN_OUT"):
    """Key a hinge's angle: `[(seconds, degrees), ...]` about the axis it was given.

    Eased by default, which is what a door pushed by a hand does; pass
    `ease="LINEAR"` for something driven at a constant rate. The angles are
    absolute, so the first key states the angle the prop STARTS at - a door
    that is already ajar opens from `[(0.0, 15), (6.8, 80)]`.
    """
    state = shot()
    if not keys:
        die("swing: needs at least one (seconds, degrees) key")
    index = _AXES[str(pivot.get("previz_axis", "Z")).upper()]
    mode = "LINEAR" if str(ease).upper() == "LINEAR" else "BEZIER"
    angles = []
    for key in keys:
        t, degrees = float(key[0]), float(key[1])
        if t < -1e-6 or t > state["seconds"] + 1e-6:
            die("swing: %s s is outside the shot's 0-%s s - a key off the clock would land on the "
                "first or last frame instead" % (t, state["seconds"]))
        euler = list(pivot.rotation_euler)
        euler[index] = math.radians(degrees)
        pivot.rotation_euler = euler
        pivot.keyframe_insert("rotation_euler", frame=F(t))
        angles.append(degrees)
    set_interpolation(pivot, mode, None if mode == "LINEAR" else ease)
    if pivot.name not in _SUBJECTS:
        _SUBJECTS.append(pivot.name)
    log("swing %s %s deg over %d keys about %s (%s)"
        % (pivot.name, " -> ".join("%.0f" % angle for angle in angles), len(angles),
           pivot.get("previz_axis", "Z"), mode))
    return pivot


def camera(lens=35.0, name="cam", location=(0, -6, 1.6), look_at=(0, 0, 1.2)):
    """The shot camera, aimed by a TRACK_TO constraint at a target empty."""
    state = shot()
    data = bpy.data.cameras.new(name)
    data.lens = float(lens)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = tuple(location)
    target = bpy.data.objects.new("%s_target" % name, None)
    target.empty_display_size = 0.15
    bpy.context.scene.collection.objects.link(target)
    target.location = tuple(look_at)
    track = obj.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    bpy.context.scene.camera = obj
    state["camera"] = obj.name
    log("camera %s lens %.0f mm at (%.2f, %.2f, %.2f)" % (name, lens, location[0], location[1], location[2]))
    return {"object": obj, "target": target, "data": data}


def camera_move(cam, keys, settle=0.5, ease="EASE_IN_OUT"):
    """Eased camera keys: [(seconds, (x, y, z), (look x, y, z))].

    The last key is pulled back to `settle` seconds before the end and held
    there, so a shot never finishes on a camera that is still moving - which
    is the `end-hold` acceptance check, made structural.
    """
    state = shot()
    if not keys:
        die("camera_move: needs at least one key")
    obj, target = cam["object"], cam["target"]
    last = state["seconds"] - max(0.0, float(settle))
    plan = []
    for index, key in enumerate(keys):
        t = float(key[0])
        if index == len(keys) - 1:
            t = min(t, last)
        plan.append((t, key[1], key[2] if len(key) > 2 else None))
    for t, location, look in plan:
        obj.location = tuple(location)
        obj.keyframe_insert("location", frame=F(t))
        if look is not None:
            target.location = tuple(look)
            target.keyframe_insert("location", frame=F(t))
    # Hold: an explicit final key at the last frame, identical to the last move.
    tail_t, tail_location, tail_look = plan[-1]
    if state["frames"] > F(tail_t):
        obj.location = tuple(tail_location)
        obj.keyframe_insert("location", frame=state["frames"])
        if tail_look is not None:
            target.location = tuple(tail_look)
            target.keyframe_insert("location", frame=state["frames"])
    set_interpolation(obj, "BEZIER", ease)
    set_interpolation(target, "BEZIER", ease)
    log("camera_move %d keys, settles at %.2f s" % (len(plan), tail_t))
    return cam


# ---------------------------------------------------------------------------
# Camera moves a video model cannot invent: orbit, zoom, dolly zoom
# ---------------------------------------------------------------------------

# A lens is a real piece of glass. Outside this range the number is a mistake
# rather than a style - and `dolly_zoom` can compute its way out of it, which
# is exactly the case the check exists for.
_LENS_MM = (4.0, 400.0)


def _camera_parts(cam, label):
    """The (object, target, data) of a camera handle, or a refusal that says so."""
    if not isinstance(cam, dict) or not all(key in cam for key in ("object", "target", "data")):
        die("%s: the first argument is the handle previz_kit.camera(...) returned, not a bare object" % label)
    return cam["object"], cam["target"], cam["data"]


def _window(label, start, end):
    """Validate a move's [start, end] seconds; returns (first frame, last frame, start, end).

    `start` may be NEGATIVE for the same reason `travel`'s may: the move began
    before the shot did, so frame 1 opens already inside it.
    """
    state = shot()
    start, end = float(start), float(end)
    if end <= start:
        die("%s: end (%s s) must be after start (%s s)" % (label, end, start))
    if end <= 0.0:
        die("%s: end (%s s) is at or before the shot's first frame - none of it would be seen" % (label, end))
    if end > state["seconds"] + 1e-6:
        die("%s: end %s s is past the shot's %s s - shorten the move, or give the shot more seconds "
            "(previz.mjs shot ... --seconds)" % (label, end, state["seconds"]))
    return F(start), F(end), start, end


def _progress(frame, start, end, ease):
    """How far through a move `frame` is, 0..1, eased unless told otherwise."""
    u = max(0.0, min(1.0, (T(frame) - start) / (end - start)))
    return _ease(u) if ease else u


def _shape_keys(obj, mode, ease, frames):
    """`set_interpolation` over ONE frame range.

    A camera usually carries keys from an earlier `camera_move`. Re-shaping
    every key it owns because this move samples its own curve would silently
    flatten somebody else's eased move, so this only touches the keys the
    caller just wrote.
    """
    low, high = frames
    for curve in _fcurves(obj):
        for point in curve.keyframe_points:
            if not (low - 0.5 <= point.co.x <= high + 0.5):
                continue
            point.interpolation = mode
            if ease:
                point.easing = ease


def _point3(value, label, default_z=0.0, at=0.0):
    """A world point from (x, y), (x, y, z), a `figure` handle or a Blender object.

    A figure resolves to its CHEST at shot time `at` - the position its own
    tracks put it in, not the mark it was built on, because a camera told to
    hold "the challenger" has to be aimed at where he lands. A prop object
    resolves to its origin as the scene stands; a prop that is keyed should be
    passed as the point the shot is about.
    """
    if isinstance(value, dict) and "root" in value and "dims" in value:
        x, y, z, _yaw = pose_at(value, at)
        # Plus the root's own height: a figure caught mid-leap has its chest
        # where the leap has taken it, not where it would be standing.
        return (float(x), float(y), float(z) + float(value["dims"]["shoulder_z"]) * 0.85)
    if isinstance(value, bpy.types.Object):
        bpy.context.view_layer.update()
        return _translation(value)
    try:
        point = [float(number) for number in value]
    except (TypeError, ValueError):
        return die("%s: expected (x, y), (x, y, z), a figure or an object (got %r)" % (label, value))
    if len(point) == 2:
        return (point[0], point[1], float(default_z))
    if len(point) == 3:
        return (point[0], point[1], point[2])
    return die("%s: expected (x, y) or (x, y, z) (got %r)" % (label, value))


def _translation(obj):
    """An object's world position as a plain tuple."""
    where = obj.matrix_world.translation
    return (float(where[0]), float(where[1]), float(where[2]))


def _focal_length(obj):
    """A camera object's focal length in mm."""
    return float(obj.data.lens)


def _evaluated(obj, frame, read):
    """What `read` sees on `frame` once the curves have been evaluated."""
    scene = bpy.context.scene
    was = scene.frame_current
    scene.frame_set(int(frame))
    value = read(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    scene.frame_set(was)
    return value


def _keyed(obj, data_path):
    """Whether something already owns this channel of this object."""
    return any(curve.data_path == data_path for curve in _fcurves(obj))


def _opening_frame(obj, data_path, first):
    """The frame a move should start keying from - 1 when nothing owns the channel yet.

    A move that begins at 2 s on a camera nobody has keyed would otherwise
    leave the camera parked wherever it was built until frame 48 and then POP
    onto the start of the move. Owning the channel from frame 1 holds the
    opening station instead, which is the shot the author drew. When somebody
    else does own it - a `camera_move` that brings the camera in - the move
    keeps its hands off the frames before its own window.
    """
    return first if _keyed(obj, data_path) else 1


def _refuse_cut(label, what, frame, found, wanted, fix):
    """Refuse a move that would start somewhere other than where the shot already is."""
    die("%s: on frame %d the camera's %s is already animated to %s, but this move opens at %s - the shot "
        "would cut there. %s" % (label, frame, what, found, wanted, fix))


def _key_lens(data, frame, mm):
    """Key the focal length AND record it for `scene.meta.json`.

    Both, always: the Workbench render reads the f-curve and the viewer's 3D
    lane reads the sidecar, because glTF carries no lens animation (see the
    measured note at the top of this file).
    """
    data.lens = float(mm)
    data.keyframe_insert("lens", frame=int(frame))
    _LENS.append({"frame": int(frame), "mm": round(float(mm), 4)})


def _lens_track():
    """The recorded focal keys, one per frame, in order - what `finish` writes."""
    byframe = {}
    for entry in _LENS:
        byframe[entry["frame"]] = entry
    return [byframe[frame] for frame in sorted(byframe)]


def orbit(cam, center, radius, height, deg_from, deg_to, start, end, look_at=None, ease=True):
    """Fly the camera around `center` on a circle while it keeps looking at the middle.

    The one move a video model will not invent from a sentence: the space has
    to hold still and be seen from every side of it, which is what makes an
    orbit worth greyboxing at all. `center` is (x, y) (or a figure, or an
    object); the camera stands `radius` metres out at `height` metres up and
    sweeps from `deg_from` to `deg_to`. Angles are the ordinary mathematical
    ones in the ground plane - 0 deg is the +X side of the centre, 90 deg the
    +Y side - and they are ABSOLUTE, so `deg_from=0, deg_to=540` is a full
    turn and a half the long way round, and a negative sweep goes the other
    way.

    `look_at` defaults to the centre at whatever height the camera's target
    already sits at, so the tilt you set in `camera(..., look_at=...)` is kept.

    Keyed on EVERY frame of the window and left LINEAR, because the easing is
    already in the samples: two eased keys would cut the chord across the arc
    and the camera would pass through the middle of the shot. `start` may be
    negative - the orbit was already running when the shot began. When nothing
    has keyed the camera yet, the first station is held from frame 1, so an
    orbit that begins at 2 s opens on its own start instead of popping into
    it; when a `camera_move` owns those frames, the orbit has to begin where
    that move left the camera and says so if it does not.

    Returns the camera handle.
    """
    obj, target, _data = _camera_parts(cam, "orbit")
    first, last, start, end = _window("orbit", start, end)
    middle = _point3(center, "orbit: center", at=max(0.0, start))
    radius = float(radius)
    if radius < 0.2:
        die("orbit: radius %s m is not an orbit - give it the metres the camera stands off the centre "
            "(a duel filmed from 6-9 m reads; from 0 m the camera is inside the fight)" % radius)
    sweep = float(deg_to) - float(deg_from)
    if abs(sweep) < 1e-6:
        die("orbit: deg_from and deg_to are both %s - an orbit that does not travel is a still camera, "
            "which is pv.camera(..., location=...) on its own" % deg_from)
    tilt = float(target.location[2])
    aim = ((middle[0], middle[1], tilt) if look_at is None
           else _point3(look_at, "orbit: look_at", default_z=tilt, at=max(0.0, start)))

    def station(degrees):
        angle = math.radians(degrees)
        return (middle[0] + radius * math.cos(angle), middle[1] + radius * math.sin(angle), float(height))

    opening = _opening_frame(obj, "location", first)
    if opening == first and first > 1:
        was = _evaluated(obj, first, _translation)
        gap = math.dist(was, station(float(deg_from)))
        if gap > 0.05:
            _refuse_cut("orbit", "position", first,
                        "(%.2f, %.2f, %.2f)" % was,
                        "(%.2f, %.2f, %.2f), %.2f m away" % (station(float(deg_from)) + (gap,)),
                        "Start the orbit at the angle and radius the camera already stands at, or let "
                        "camera_move bring it to that station first.")

    for frame in range(opening, last + 1):
        obj.location = station(float(deg_from) + sweep * _progress(frame, start, end, ease))
        obj.keyframe_insert("location", frame=frame)
    _shape_keys(obj, "LINEAR", None, (opening, last))
    target.location = aim
    target.keyframe_insert("location", frame=opening)
    target.keyframe_insert("location", frame=last)
    _shape_keys(target, "LINEAR", None, (opening, last))
    log("orbit %s %.0f -> %.0f deg (%.0f deg of arc) around (%.2f, %.2f) at r=%.2f m, z=%.2f m, "
        "%.2f-%.2f s, %d keys from frame %d, looking at (%.2f, %.2f, %.2f)"
        % (obj.name, float(deg_from), float(deg_to), abs(sweep), middle[0], middle[1], radius, float(height),
           start, end, last - opening + 1, opening, aim[0], aim[1], aim[2]))
    return cam


def zoom(cam, mm_from, mm_to, start, end, ease=True):
    """Animate the focal length from `mm_from` to `mm_to` between two times.

    The lens on its own: the camera does not move, the frame closes in or
    opens out. Keyed on every frame and LINEAR, like `orbit`, so the eased
    curve is in the samples.

    glTF carries NO lens animation, so the keys are also written to
    `scene.meta.json` as `camera_lens: [{frame, mm}]` for the viewer's 3D lane
    to apply. The Workbench render - the MP4 the video model is conditioned
    on - shows the zoom either way.

    Like `orbit`, a zoom on a lens nobody has keyed holds `mm_from` from frame
    1 rather than popping onto it, and a zoom that follows another lens move
    has to start on the focal length that move left behind.

    Returns the camera handle.
    """
    obj, _target, data = _camera_parts(cam, "zoom")
    first, last, start, end = _window("zoom", start, end)
    mm_from, mm_to = float(mm_from), float(mm_to)
    for label, mm in (("mm_from", mm_from), ("mm_to", mm_to)):
        if mm < _LENS_MM[0] or mm > _LENS_MM[1]:
            die("zoom: %s is %.1f mm, outside the %.0f-%.0f mm a lens exists in - 18-24 mm is wide, "
                "35-50 mm is normal, 85 mm and up is long" % (label, mm, _LENS_MM[0], _LENS_MM[1]))
    if abs(mm_to - mm_from) < 1e-6:
        die("zoom: mm_from and mm_to are both %.1f mm - a zoom needs two focal lengths; set the lens once "
            "with pv.camera(%.0f) instead" % (mm_from, mm_from))
    opening = _opening_frame(data, "lens", first)
    if opening == first and first > 1:
        was = _evaluated(obj, first, _focal_length)
        if abs(was - mm_from) > 0.5:
            _refuse_cut("zoom", "focal length", first, "%.1f mm" % was, "%.1f mm" % mm_from,
                        "Start this zoom on the focal length the last one ended at, or move the earlier "
                        "zoom's end to match.")
    for frame in range(opening, last + 1):
        _key_lens(data, frame, mm_from + (mm_to - mm_from) * _progress(frame, start, end, ease))
    _shape_keys(data, "LINEAR", None, (opening, last))
    log("zoom %s %.1f -> %.1f mm over %.2f-%.2f s, %d keys from frame %d (also recorded in "
        "scene.meta.json camera_lens - glTF carries no lens animation)"
        % (data.name, mm_from, mm_to, start, end, last - opening + 1, opening))
    return cam


def dolly_zoom(cam, subject, dist_from, dist_to, start, end, ease=True):
    """Hitchcock: travel the camera's own sightline while the lens holds the subject's size.

    The camera moves along the line it already stands on towards (or away
    from) `subject` - a point, an object, or a figure, which resolves to its
    CHEST where its own tracks put it at `start`, not the mark it was built
    on - from `dist_from` to `dist_to` metres, and the focal length is scaled
    by the same ratio (mm is proportional to distance), so the subject keeps
    the height on screen it had and everything behind it rushes in or falls
    away. It is the one shot whose whole content is the relationship between
    two numbers, which is why it belongs in the greybox and not in a prompt.

    The lens at `dist_from` is the camera's CURRENT focal length, so set it
    with `pv.camera(50, ...)`; the compensated end of the move is computed and
    refused if it lands outside a real lens.

    The sightline is read from where the camera stands when you call this, and
    the move owns the camera from frame 1 unless something else already does:
    the opening station is held until `start`, so the shot begins on the wide
    end instead of popping onto it. If a `camera_move` already owns those
    frames, the position it leaves the camera at has to match `dist_from` -
    otherwise the shot would cut, and that is refused rather than rendered.

    Returns the camera handle.
    """
    obj, target, data = _camera_parts(cam, "dolly_zoom")
    first, last, start, end = _window("dolly_zoom", start, end)
    point = _point3(subject, "dolly_zoom: subject", at=max(0.0, start))
    dist_from, dist_to = float(dist_from), float(dist_to)
    for label, metres in (("dist_from", dist_from), ("dist_to", dist_to)):
        if metres < 0.3:
            die("dolly_zoom: %s is %.2f m - closer than 0.3 m the camera is inside the body it is "
                "filming; give it the metres from the subject it should stand at" % (label, metres))
    if abs(dist_to - dist_from) < 1e-3:
        die("dolly_zoom: dist_from and dist_to are both %.2f m - the camera never moves, so nothing is "
            "compensated; that is pv.zoom(...)" % dist_from)

    # The sightline, read where the camera will BE when the move starts: the
    # keyed position if a camera_move owns those frames, the built one if not.
    opening = _opening_frame(obj, "location", first)
    if opening == 1:
        bpy.context.view_layer.update()
        here = _translation(obj)
    else:
        here = _evaluated(obj, first, _translation)
    away = (here[0] - point[0], here[1] - point[1], here[2] - point[2])
    span = math.sqrt(away[0] ** 2 + away[1] ** 2 + away[2] ** 2)
    if span < 1e-3:
        die("dolly_zoom: the camera is standing on the subject, so there is no line to travel - place it "
            "with pv.camera(..., location=...) before asking for a dolly zoom")
    unit = (away[0] / span, away[1] / span, away[2] / span)

    # A camera somebody else already keyed has to BE at dist_from when this
    # starts, or the audience sees a cut nobody asked for.
    if opening == first and first > 1 and abs(span - dist_from) > 0.05:
        _refuse_cut("dolly_zoom", "position", first, "%.2f m from the subject" % span,
                    "dist_from = %.2f m" % dist_from,
                    "Match dist_from to where the camera already is, or let camera_move bring it to the "
                    "dolly's start station first.")

    # The lens this compensates FROM is whatever the camera is actually on
    # when the move starts - the value an earlier `zoom` left there, not the
    # last number anybody assigned.
    lens_opening = _opening_frame(data, "lens", first)
    base_mm = float(data.lens) if lens_opening == 1 else _evaluated(obj, first, _focal_length)
    end_mm = base_mm * dist_to / dist_from
    if end_mm < _LENS_MM[0] or end_mm > _LENS_MM[1]:
        die("dolly_zoom: holding the subject's size from %.2f m to %.2f m takes the %.0f mm lens to "
            "%.1f mm, outside %.0f-%.0f mm - dolly a smaller ratio, or start from a different lens"
            % (dist_from, dist_to, base_mm, end_mm, _LENS_MM[0], _LENS_MM[1]))

    def station(metres):
        return (point[0] + unit[0] * metres, point[1] + unit[1] * metres, point[2] + unit[2] * metres)

    for frame in range(min(opening, lens_opening), last + 1):
        metres = dist_from + (dist_to - dist_from) * _progress(frame, start, end, ease)
        if frame >= opening:
            obj.location = station(metres)
            obj.keyframe_insert("location", frame=frame)
        if frame >= lens_opening:
            _key_lens(data, frame, base_mm * metres / dist_from)
    _shape_keys(obj, "LINEAR", None, (opening, last))
    _shape_keys(data, "LINEAR", None, (lens_opening, last))
    target.location = point
    target.keyframe_insert("location", frame=opening)
    target.keyframe_insert("location", frame=last)
    _shape_keys(target, "LINEAR", None, (opening, last))
    log("dolly_zoom %s %.2f -> %.2f m from (%.2f, %.2f, %.2f), lens %.1f -> %.1f mm over %.2f-%.2f s, "
        "%d keys from frame %d (subject height held; camera_lens goes to scene.meta.json)"
        % (obj.name, dist_from, dist_to, point[0], point[1], point[2], base_mm, end_mm, start, end,
           last - opening + 1, opening))
    return cam


def accent(objects, start, end, color, name="accent"):
    """Key a Workbench colour change and record it for the 3D lane to replay.

    glTF carries no Workbench material animation, so the accent travels in
    `scene.meta.json` instead. A material shared with objects OUTSIDE this
    list is COPIED first: an accent that also turned the floor blue would be
    a defect nobody would think to check for.
    """
    state = shot()
    objects = list(objects)
    if not objects:
        die("accent: needs at least one object")
    if end <= start:
        die("accent: end (%s) must be after start (%s)" % (end, start))
    inside = set(obj.name for obj in objects)
    materials = []
    for obj in objects:
        if not obj.data.materials:
            obj.data.materials.append(accent_material("%s_%s" % (name, obj.name)))
        for slot in range(len(obj.data.materials)):
            mat = obj.data.materials[slot]
            if mat is None:
                continue
            shared = [other for other in bpy.data.objects
                      if other.name not in inside and getattr(other.data, "materials", None) and mat.name in other.data.materials]
            if shared:
                copy = mat.copy()
                copy.name = "%s_%s" % (name, obj.name)
                obj.data.materials[slot] = copy
                log("accent: %s shared %s with %d other object(s) - gave it its own copy %s"
                    % (obj.name, mat.name, len(shared), copy.name))
                mat = copy
            if mat not in materials:
                materials.append(mat)
    rgb = (float(color[0]), float(color[1]), float(color[2]))
    for mat in materials:
        base = tuple(mat.diffuse_color)
        mat.diffuse_color = base
        mat.keyframe_insert("diffuse_color", frame=F(start))
        mat.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
        mat.keyframe_insert("diffuse_color", frame=F(end))
    # What is actually recoloured: the glTF node names the viewer will look
    # for, which are the Blender object names.
    names = sorted(inside)
    _ACCENTS.append({"objects": names, "from": float(start), "to": float(end), "color": list(rgb)})
    log("accent %s from %.2f to %.2f s -> rgb%s" % (", ".join(names), start, end, rgb))
    return objects


# ---------------------------------------------------------------------------
# finish
# ---------------------------------------------------------------------------


def _blender_version():
    return ".".join(str(part) for part in bpy.app.version)


def _export_glb(path):
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    options = dict(
        filepath=path,
        export_format="GLB",
        export_animations=True,
        export_cameras=True,
        export_yup=True,
        export_apply=False,
        export_force_sampling=True,
        export_frame_range=True,
    )
    if "export_animation_mode" in properties:
        # One animation per animated object, named after the object - what the
        # viewer's mixer plays all of at once.
        options["export_animation_mode"] = "SCENE"
    bpy.ops.export_scene.gltf(**options)


def finish(render=True):
    """Bake the figures, check the range, then render, save, export and write the meta."""
    state = shot()
    scene = bpy.context.scene
    args = runner_args()

    for fig in _FIGURES:
        _bake_figure(fig)

    if scene.frame_start != 1 or scene.frame_end != state["frames"]:
        die(
            "the scene's frame range is %d..%d but the shot is %d frames (1..%d) - "
            "something changed frame_start/frame_end after setup()"
            % (scene.frame_start, scene.frame_end, state["frames"], state["frames"])
        )
    if int(scene.render.fps) != state["fps"]:
        die("the scene's fps is %s but the shot is %s fps" % (scene.render.fps, state["fps"]))
    if scene.camera is None:
        die("the scene has no camera - call previz_kit.camera(...)")
    for key, mine, label in (
        ("expect-frames", state["frames"], "frames"),
        ("expect-fps", state["fps"], "fps"),
    ):
        if key in args and int(round(float(args[key]))) != int(mine):
            die("scene has %s=%s, shot.json expects %s=%s" % (label, mine, label, args[key]))

    meta = {
        "fps": state["fps"],
        "frames": state["frames"],
        "seconds": state["seconds"],
        "width": state["width"],
        "height": state["height"],
        "camera": scene.camera.name,
        "subjects": list(_SUBJECTS),
        "accents": list(_ACCENTS),
        # The second thing glTF drops on the floor, after the accent colours:
        # the focal length curve. `[]` when the lens never moved, in which
        # case the exported camera's own yfov is the whole truth.
        "camera_lens": _lens_track(),
        "blender": _blender_version(),
        "engine": scene.render.engine,
    }

    if state["blend"]:
        os.makedirs(os.path.dirname(state["blend"]) or ".", exist_ok=True)
        # No `.blend1`: Blender's rolling backup would otherwise leave a second
        # multi-megabyte file in a workspace the viewer watches, on every render.
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=state["blend"])
        log("saved %s" % state["blend"])
    if state["glb"]:
        os.makedirs(os.path.dirname(state["glb"]) or ".", exist_ok=True)
        _export_glb(state["glb"])
        log("exported %s (%d bytes)" % (state["glb"], os.path.getsize(state["glb"])))
    if state["meta"]:
        os.makedirs(os.path.dirname(state["meta"]) or ".", exist_ok=True)
        with open(state["meta"], "w") as handle:
            json.dump(meta, handle, indent=2)
            handle.write("\n")
        log("wrote %s" % state["meta"])

    if render:
        os.makedirs(state["out"], exist_ok=True)
        log("rendering %d frames to %s" % (state["frames"], state["out"]))
        bpy.ops.render.render(animation=True)

    # The summary line is the headless log's one machine-readable record, and
    # a focal curve is one key per frame - counted here, kept in full in
    # scene.meta.json, which is the file the viewer reads.
    overview = {key: value for key, value in meta.items() if key != "camera_lens"}
    overview["camera_lens_keys"] = len(meta["camera_lens"])
    log("summary %s" % json.dumps(overview, sort_keys=True))
    return meta
