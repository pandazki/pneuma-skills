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
* `slowmo(start, end, factor)` - a scene-wide time remap: between two SHOT
  seconds the action runs at 1/factor speed (2 = half speed, 0.5 = twice as
  fast), baked through every curve at `finish()`
* `shot_time(action_time)` · `action_time(shot_time)` - the two clocks a
  `slowmo` splits apart, converted; BEATS ARE SHOT SECONDS
* `impact(cam, at, push=0.15, shake=0.02, seconds=0.25)` - the hit: a push
  down the sightline and a decaying shake, added on top of whatever the
  camera was already doing, stated in SHOT time
* `accent(objects, start, end, color)` - the one colour event
* `landmark(name, objects, label=None, color=None)` - a named place the model
  has to be able to READ: one flat palette colour over its blocks, recorded in
  `scene.meta.json` with what is in frame and who is standing in front of it
* `set_interpolation(obj, mode, ease)` · `F(seconds)` · `T(frame)` ·
  `shot()` · `runner_args()` · `log(text)` · `die(reason)`
* `finish(render=True)` - bake, validate, render, save, export, write meta

## Axes

Everything here speaks BLENDER axes: Z up, and the ground plane is XY. A
figure's forward is its local +Y, which is why `travel` yaws the root to the
path tangent and why a yaw of 0 faces +Y. That one sentence is the whole sign
convention.

## Two clocks: shot time and action time

Without a `slowmo` there is one clock and this section says nothing: shot
time IS action time. A `slowmo` splits them.

* SHOT time is the clip's own clock. It runs 0 to `seconds`, one frame every
  1/fps, and it is what the audience, the trim, the beats table, the
  `time_warp` sidecar and `impact` all speak.
* ACTION time is the clock the blocking is written on. Every `travel`,
  `dash`, `turn`, `hold`, `swing`, `move`, `camera_move`, `orbit`, `zoom`,
  `dolly_zoom` and `accent` second is an ACTION second.

`slowmo(start, end, factor)` says that between shot seconds `start` and `end`
the action advances at 1/factor of its usual rate. `finish()` then puts every
animated curve in the scene through one piecewise-linear map
`t_action = W(t_shot)` - slope 1 outside the segments, 1/factor inside,
continuous at the joins - and rebakes it. The shot's `seconds` and frame count
never change: a 4 s shot is 96 frames before and after the ramp.

What DOES change is where a later beat lands. A segment of length L at factor
f eats `L * (1 - 1/f)` seconds of action, and everything after it slides that
far LATER in the clip. `slowmo(0.9, 1.9, 2)` costs 0.5 s, so an action written
at 3.2 s is seen at 3.7 s, and the last 0.5 s of what you wrote falls off the
end of the clip. Write the blocking first, add the ramp, then check the tail:

    pv.shot_time(3.2)    # 3.7 - the second of the CLIP a beat written at 3.2 lands on
    pv.action_time(3.7)  # 3.2 - what the action is doing at second 3.7 of the clip

**Beats are shot seconds.** The rows of `shot-plan.md` and the JSON
`previz.mjs beats --set` loads describe the clip the viewer scrubs and the
trim cuts out, so a beat written in action time goes through `pv.shot_time()`
before it is written down. `scene.meta.json` carries the segments themselves
as `time_warp: [{from, to, factor}]` in shot seconds, which is what lets the
viewer draw the ramp under the same timeline.

`impact` is the exception that proves the rule: a hit is a fact about the
CLIP, so its `at` is a shot second and it is composed after the remap - a
strike stays as sharp as it was written even inside a slowmo segment.

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

## Landmarks, and the two things the sidecar carries for the prompt

A grey block is a shape, not a place. Conditioned on seven grey blocks the
model cannot tell the shop from the bus stop, so it decides for itself once
per take and seven takes of one street disagree about where the shop is. A
`landmark` is the fix: it paints one named place in one saturated palette
colour nobody else has, so `@Video1` shows a RED block and the prompt can say
"the red block is the convenience store's awning".

`finish()` writes two arrays the prompt skeleton reads and the picture cannot
carry on its own - the same reason `camera_lens` and `time_warp` are in the
sidecar rather than in the glTF:

* `landmarks: [{name, label, color, rgb, objects, in_frame: {first, last},
  screen: {first, last}}]` - what each colour means, whether that place
  projects inside the camera view on the first and the last frame, and which
  third of that frame it lands in. A landmark that is in frame at neither end
  is one the prompt has to say is NOT in the picture, or the model paints it
  anyway. `screen` is `"left"` (view x below 1/3), `"centre"`, `"right"`
  (above 2/3) or `None` when the camera does not see it there - "behind"
  orders the depth and says nothing about left and right, so without this a
  street the block had shop-left, stop-right comes back mirrored (trial 4,
  s06, 2026-09-22). The rgb and the object names are here for the same reason
  the accents are: glTF carries no Workbench material colour, so the picture
  has it and the 3D lane has to be told.
* `subjects_detail: [{name, color, rgb, behind}]` - one entry per subject, in
  `subjects` order. For a figure, `behind.first` / `behind.last` are the
  landmarks standing behind it from the camera at those two frames (farther
  away, within 25 degrees of the camera's line to the figure, nearest first),
  which is the geography sentence the prompt owes. A prop added by `move` or
  `swing` is a subject too and carries `behind: null`.

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
* An f-curve extrapolates CONSTANT outside its keys, which is what makes the
  time warp safe at both ends: a speed-up that runs the action past the last
  key holds the last value instead of flying off it.
* A camera shake is sampled at `fps`, so it cannot oscillate faster than the
  clip can show it. `impact` swings on a four-frame cycle across the frame and
  a three-frame cycle up it - both under Nyquist. Anything faster aliases into
  a slow wobble that is in the curve and not in the picture.
"""

import json
import math
import os
import sys

import bpy

# Aliased under an underscore so the kit's own API index - "every public name
# this module defines" - never picks up something it merely imported.
from bpy_extras.object_utils import world_to_camera_view as _world_to_camera_view
from mathutils import Vector as _Vector

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
_LANDMARKS = []
_SUBJECTS = []
_LENS = []
_WARPS = []
_IMPACTS = []

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
    global _SHOT, _FIGURES, _ACCENTS, _LANDMARKS, _SUBJECTS, _LENS, _WARPS, _IMPACTS, WHITE, GREY, DARK
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
    _LANDMARKS = []
    _SUBJECTS = []
    _LENS = []
    _WARPS = []
    _IMPACTS = []
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
    """Where a figure is and which way it faces at ACTION time `seconds`: (x, y, z, yaw radians).

    Action time, not shot time - the two are the same second until a `slowmo`
    exists, and after one they are not (see "Two clocks" at the top of this
    file). The tracks were written in action seconds, so this reads them in
    action seconds; `pv.shot_time()` says which frame of the clip the answer
    is seen on.

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
    """Key the root on every frame; the profile is already eased, so the keys are LINEAR.

    Each frame asks the tracks where the figure is at the ACTION time that
    frame of the clip shows, so a `slowmo` is baked in exactly rather than
    resampled out of an already-baked curve: the pawn is the one thing in the
    scene whose motion is an analytic function of the time, and a remap of an
    analytic function is still analytic.
    """
    state = shot()
    root = fig["root"]
    for frame in range(1, state["frames"] + 1):
        x, y, z, yaw = pose_at(fig, action_time(T(frame)))
        root.location = (x, y, z)
        root.rotation_euler = (0.0, 0.0, yaw)
        root.keyframe_insert("location", frame=frame)
        root.keyframe_insert("rotation_euler", frame=frame)
    set_interpolation(root, "LINEAR", None)
    log("baked %s over %d frames%s"
        % (fig["name"], state["frames"],
           " through %d time-warp segment(s)" % len(_WARPS) if _WARPS else ""))


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


def _rebake_lens_track(camera):
    """Re-read the focal curve after a time warp moved it.

    `_key_lens` recorded the frames the zoom was WRITTEN on, which are action
    frames; once the curve has been through `W(t)` those numbers describe a
    lens the clip no longer shows. The sidecar has to agree with the render,
    so the track is read back off the warped curve itself.
    """
    if not _WARPS or not _LENS or camera is None:
        return
    curves = [curve for curve in _fcurves(camera.data) if curve.data_path == "lens"]
    if not curves:
        return
    del _LENS[:]
    for frame in range(1, shot()["frames"] + 1):
        _LENS.append({"frame": frame, "mm": round(float(curves[0].evaluate(frame)), 4)})


def _accent_track():
    """The accents in SHOT seconds - the clock the viewer replays them against."""
    if not _WARPS:
        return list(_ACCENTS)
    return [dict(entry, **{"from": round(shot_time(entry["from"]), 4),
                           "to": round(shot_time(entry["to"]), 4)})
            for entry in _ACCENTS]


def _warp_track():
    """The registered ramps, in SHOT seconds - `[]` when the clip runs at one speed."""
    return [{"from": round(segment["from"], 4), "to": round(segment["to"], 4),
             "factor": round(segment["factor"], 4)} for segment in _WARPS]


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


# ---------------------------------------------------------------------------
# Tempo: the greybox is the clock the video model follows
# ---------------------------------------------------------------------------

# How far a remap is allowed to go. Below 0.25 the clip runs the action at
# four times speed, which reads as dropped frames rather than as a fast cut;
# above 8 the action barely moves and the model paints a freeze instead of
# slow motion. Both ends are refusals rather than clamps, because a factor of
# 20 is a typo for 2.0 often enough to be worth saying so out loud.
_SLOWMO_FACTOR = (0.25, 8.0)

# A hit is a quarter of a second of camera, give or take. Anything longer is
# not a hit, it is a move, and a move is `camera_move`.
_IMPACT_SECONDS = (0.08, 2.0)
# A shove of more than a metre and a half, or a shake with half a metre of
# amplitude, is not a camera being hit - it is a camera being thrown.
_IMPACT_PUSH = 1.5
_IMPACT_SHAKE = 0.5
# The shove lands over this fraction of the window and rings down over the
# rest: a push that eased in over half its window is a nudge, not a hit.
_IMPACT_ATTACK = 0.18
_IMPACT_DECAY = 4.0
# The shake's two periods, in FRAMES rather than in Hz, and both longer than
# two frames - the clip samples at `fps`, so a faster oscillation aliases into
# a slow wobble that is in the curve and absent from the picture. Two periods
# that do not divide each other keep the jitter from tracing a straight line.
_IMPACT_ACROSS_FRAMES = 4.0
_IMPACT_LIFT_FRAMES = 3.0

# The ID collections whose keys the warp rewrites: objects (blocking, props,
# the camera and its target), camera data (the focal curve `zoom` writes),
# materials (the colour curve `accent` writes), and lights and worlds because
# an author reaching for raw `bpy` can key those too.
_WARPABLE = ("objects", "cameras", "materials", "lights", "worlds")


def slowmo(start, end, factor):
    """Run the ACTION at 1/factor speed between two SHOT seconds; returns the segment.

    The greybox is the clock the video model follows, so tempo has to live in
    the greybox: a fight whose greybox moves at one speed comes back as a take
    that moves at one speed, whatever the prompt said about slow motion.

    `start` and `end` are SHOT seconds - where the ramp sits in the finished
    clip. `factor` is how much slower the action runs inside it: 2 is half
    speed, 4 is quarter speed, and a factor below 1 is a speed-up (0.5 runs
    the action twice as fast). The shot's `seconds` and frame count do not
    change; the segment is registered here and applied once, at `finish()`,
    to every animated curve in the scene through one piecewise-linear map.

    The cost, which is the whole thing to understand before using it: a
    segment of length L eats `L * (1 - 1/factor)` seconds of action, and
    EVERYTHING AFTER IT LANDS THAT MUCH LATER IN THE CLIP. `slowmo(0.9, 1.9,
    2)` costs 0.5 s, so a camera move written to end at 3.2 s is seen ending
    at 3.7 s, and the last 0.5 s of the action written for a 4 s shot is not
    in the clip at all. Write the blocking, add the ramp, then check the tail
    with `pv.shot_time(...)` and shorten the action if the ramp pushed it past
    the clock. The one line this function logs says what the last frame of the
    clip is showing, in action seconds, for exactly that reason.

    Segments may be laid end to end but never overlapped - two ramps over the
    same second have no single answer, and the refusal says so. Beats are shot
    seconds: convert with `pv.shot_time()` before writing the timeline down.
    """
    state = shot()
    start, end, factor = float(start), float(end), float(factor)
    if end <= start:
        die("slowmo: end (%s s) must be after start (%s s)" % (end, start))
    if start < -1e-6:
        die("slowmo: start (%s s) is before the clip's first frame - a ramp is stated in SHOT seconds, "
            "and the clip runs 0-%s s" % (start, state["seconds"]))
    if end > state["seconds"] + 1e-6:
        die("slowmo: end %s s is past the shot's %s s - a ramp is stated in SHOT seconds, so it has to fit "
            "inside the clip; shorten it, or give the shot more seconds (previz.mjs shot ... --seconds)"
            % (end, state["seconds"]))
    if abs(factor - 1.0) < 1e-9:
        die("slowmo: a factor of 1 is no remap at all - drop the call, or say how much slower the action "
            "should run (2 = half speed, 0.5 = twice as fast)")
    if factor < _SLOWMO_FACTOR[0] or factor > _SLOWMO_FACTOR[1]:
        die("slowmo: factor %s is outside %.2f-%.1f - past those the clip stops reading as a speed ramp "
            "(a freeze at one end, dropped frames at the other); if the action really is that slow, give "
            "the shot more seconds and write it slower" % (factor, _SLOWMO_FACTOR[0], _SLOWMO_FACTOR[1]))
    for other in _WARPS:
        if start < other["to"] - 1e-9 and other["from"] < end - 1e-9:
            die("slowmo: %.2f-%.2f s overlaps the segment already registered at %.2f-%.2f s - the whole "
                "scene passes through ONE time curve, and two ramps over the same second have no single "
                "answer. Lay them end to end, or merge them into one segment."
                % (start, end, other["from"], other["to"]))
    segment = {"from": start, "to": end, "factor": factor}
    _WARPS.append(segment)
    _WARPS.sort(key=lambda entry: entry["from"])
    cost = (end - start) * (1.0 - 1.0 / factor)
    log("slowmo %.2f-%.2f s at 1/%g speed: %.2f s of clip carries %.2f s of action, so everything after it "
        "lands %.2f s %s and the clip's last frame shows %.2f s of action (of the %.2f s written)"
        % (start, end, factor, end - start, (end - start) / factor, abs(cost),
           "later" if cost >= 0 else "earlier", action_time(state["seconds"]), state["seconds"]))
    return dict(segment)


def action_time(shot_seconds):
    """SHOT second -> ACTION second: what the action is doing at that second of the clip.

    The identity until a `slowmo` exists. This is `W(t)` itself - the map the
    whole scene is baked through at `finish()`.
    """
    t = float(shot_seconds)
    out = t
    for segment in _WARPS:
        if t <= segment["from"]:
            break
        inside = min(t, segment["to"]) - segment["from"]
        out -= inside * (1.0 - 1.0 / segment["factor"])
    return out


def shot_time(action_seconds):
    """ACTION second -> SHOT second: which second of the clip a beat written at `t` is seen on.

    The inverse of `action_time`, and the function a beats table goes through:
    `previz.mjs beats` describes the clip, and the clip is shot time. An
    answer past the shot's `seconds` is a real answer and means what it says -
    the ramp pushed that beat off the end of the clip.
    """
    a = float(action_seconds)
    lag = 0.0
    for segment in _WARPS:
        opens = segment["from"] - lag
        if a <= opens:
            break
        length = segment["to"] - segment["from"]
        closes = opens + length / segment["factor"]
        if a <= closes:
            return segment["from"] + (a - opens) * segment["factor"]
        lag += length * (1.0 - 1.0 / segment["factor"])
    return a + lag


def _action_frame(frame):
    """The (fractional) frame of the UNWARPED animation that shot `frame` shows."""
    return 1.0 + action_time(T(frame)) * shot()["fps"]


def _animated(holder):
    """Whether this datablock owns an action at all."""
    animation = getattr(holder, "animation_data", None)
    return bool(animation and animation.action)


def _assign(holder, data_path, index, value):
    """Set one channel of one property; returns the index `keyframe_insert` wants.

    Blender refuses an index for a property that is not an array (`lens` is
    the one this kit hits), so the shape of the property decides the call.
    """
    owner_path, _, prop = data_path.rpartition(".")
    owner = holder.path_resolve(owner_path) if owner_path else holder
    current = getattr(owner, prop)
    try:
        current[index] = value
    except TypeError:
        setattr(owner, prop, value)
        return -1
    return index


def _resample(holder, frames):
    """Rewrite every curve of `holder` so frame f carries what it had at `_action_frame(f)`.

    Every channel is SAMPLED first and WRITTEN second: a curve read after its
    own rewrite would be reading the answer it had just produced. The result
    is one key per frame, LINEAR, exactly like `orbit` and the figure bake -
    the easing is in the samples, and the glTF exporter force-samples anyway.
    """
    curves = _fcurves(holder)
    if not curves:
        return 0
    plan = [(curve.data_path, curve.array_index,
             [curve.evaluate(_action_frame(frame)) for frame in range(1, frames + 1)])
            for curve in curves]
    for data_path, index, samples in plan:
        for frame, value in enumerate(samples, start=1):
            slot = _assign(holder, data_path, index, value)
            holder.keyframe_insert(data_path, index=slot, frame=frame)
    _shape_keys(holder, "LINEAR", None, (1, frames))
    return len(plan)


def _apply_time_warp(skip):
    """Put every keyed channel in the file through `W(t)`. A no-op with no segments.

    `skip` is the set of datablocks that have already been baked through the
    map (the figures), addressed by pointer because a material and an object
    are allowed to share a name.
    """
    if not _WARPS:
        return
    state = shot()
    touched, channels = [], 0
    for collection in _WARPABLE:
        for holder in getattr(bpy.data, collection, []):
            if holder.as_pointer() in skip or not _animated(holder):
                continue
            count = _resample(holder, state["frames"])
            if count:
                # Named by collection: a camera's object and its data share a
                # name, and "cam, cam" in a log is not an observation.
                touched.append("%s/%s" % (collection, holder.name))
                channels += count
    log("time warp: %d segment(s) %s, %d channel(s) on %d datablock(s) resampled (%s), clip's last frame "
        "shows %.2f s of action"
        % (len(_WARPS), ", ".join("%.2f-%.2f s at 1/%g" % (seg["from"], seg["to"], seg["factor"])
                                  for seg in _WARPS),
           channels, len(touched), ", ".join(touched) if touched else "none",
           action_time(state["seconds"])))


def _report_tail(camera):
    """After a remap, say whether the clip still ends on a settled camera.

    `camera_move` pulls its last key back so the tail is still - but it does
    that in ACTION seconds, and a ramp registered afterwards can push the
    settle off the end of the clip and take the `end-hold` guarantee with it.
    This is not refused: a shot that deliberately ends mid-move is legal, and
    the check is an acceptance judgement rather than an invariant. It must not
    go UNSAID, though, which is what this line is for.
    """
    if not _WARPS or camera is None:
        return
    state = shot()
    tail = max(1, state["frames"] - int(round(0.5 * state["fps"])))
    channels = _channels(camera)
    travelled = math.dist(_keyed_location(camera, channels, tail),
                          _keyed_location(camera, channels, state["frames"]))
    log("end-hold after the remap: %s moves %.3f m over the clip's last %.2f s%s"
        % (camera.name, travelled, (state["frames"] - tail) / float(state["fps"]),
           "" if travelled <= 0.02 else
           " - the ramp pushed the settle past the end of the clip, so the shot finishes on a moving "
           "camera; shorten the action, move the ramp, or say the motion was wanted"))


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(vector):
    """A unit vector, or None when there is no direction to be had."""
    length = math.sqrt(vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2)
    if length < 1e-9:
        return None
    return (vector[0] / length, vector[1] / length, vector[2] / length)


def _channels(obj):
    """This object's curves by (data_path, index), for reading a path without moving it."""
    return dict(((curve.data_path, curve.array_index), curve) for curve in _fcurves(obj))


def _keyed_location(obj, channels, frame):
    """Where an object's own curves put it on `frame` - its built location when nothing keys it."""
    point = list(obj.location)
    for axis in range(3):
        curve = channels.get(("location", axis))
        if curve is not None:
            point[axis] = curve.evaluate(frame)
    return (float(point[0]), float(point[1]), float(point[2]))


def _impact_envelope(u):
    """1 at the hit, EXACTLY 0 at the end of the window, exponential in between.

    The subtracted tail is what makes the zero exact. A bare exponential never
    reaches zero, so the camera would end the window a millimetre or two off
    the path it is supposed to have returned to, and "returns to its path"
    would be a claim nobody could measure.
    """
    return math.exp(-_IMPACT_DECAY * u) - u * math.exp(-_IMPACT_DECAY)


def _impact_push(u):
    """0 -> 1 over the attack, then the ring-down back to exactly 0."""
    if u <= _IMPACT_ATTACK:
        return _ease(u / _IMPACT_ATTACK)
    return _impact_envelope((u - _IMPACT_ATTACK) / (1.0 - _IMPACT_ATTACK))


def impact(cam, at, push=0.15, shake=0.02, seconds=0.25):
    """The hit: at SHOT second `at` the camera is shoved down its own sightline and rings down.

    A strike lands on ONE frame, and the clip has to say so or the model
    paints two bodies passing each other. `push` metres is how far the camera
    is driven towards what it is looking at - it lands over the first fifth of
    the window and recovers over the rest - and `shake` metres is the
    amplitude of a decaying jitter across and up the frame, both back to
    exactly zero by `at + seconds`.

    It is ADDED to whatever the camera was already doing: the base path is
    read from the camera's own curves frame by frame and the offset is laid on
    top, so a `camera_move`, an `orbit` or a `dolly_zoom` underneath is kept,
    not overwritten. Two hits close together simply add up.

    `at` is a SHOT second and the offset is composed AFTER the time warp, so a
    hit inside a `slowmo` segment stays as sharp as it was written - which is
    the point of having both: the action around it crawls, the camera does
    not. `at` may be negative for the same reason `travel`'s start may be: the
    clip opens mid-ring-down. The recovery has to finish inside the clip,
    because a shot that ends with the camera still off its path fails
    `end-hold`, so that is refused rather than rendered.

    The sightline is read at the hit's first frame and held for the window;
    over a quarter of a second a moving camera's aim does not turn enough to
    matter, and a fixed direction is what makes "push along the sightline"
    a number anybody can measure off the export.

    Returns the camera handle.
    """
    obj, target, _data = _camera_parts(cam, "impact")
    state = shot()
    at, push, shake, seconds = float(at), float(push), float(shake), float(seconds)
    if seconds < _IMPACT_SECONDS[0] or seconds > _IMPACT_SECONDS[1]:
        die("impact: seconds=%s is outside %.2f-%.1f s - a hit is a quarter of a second of camera; "
            "anything longer is a move, and a move is pv.camera_move(...)"
            % (seconds, _IMPACT_SECONDS[0], _IMPACT_SECONDS[1]))
    if push < 0.0 or push > _IMPACT_PUSH:
        die("impact: push=%s m is outside 0-%.1f m - that is the camera being thrown, not hit; the "
            "default 0.15 m reads as a hit at 6 m" % (push, _IMPACT_PUSH))
    if shake < 0.0 or shake > _IMPACT_SHAKE:
        die("impact: shake=%s m is outside 0-%.1f m of amplitude - the default 0.02 m is already a visible "
            "jitter at 6 m" % (shake, _IMPACT_SHAKE))
    if push <= 1e-6 and shake <= 1e-6:
        die("impact: push and shake are both 0, so nothing would happen - give it the metres the camera "
            "should be shoved, or drop the call")
    if at + seconds > state["seconds"] + 1e-6:
        die("impact: the hit at %s s rings down until %.2f s, past the shot's %s s - the clip would end "
            "with the camera still off its path, which is the end-hold check. Move the hit earlier, "
            "shorten seconds=, or give the shot more seconds (previz.mjs shot ... --seconds)"
            % (at, at + seconds, state["seconds"]))
    first, last, at, _stop = _window("impact", at, at + seconds)
    if last <= first:
        die("impact: %s s at %s fps is less than the two frames a hit needs - one frame is a jump cut, "
            "not a hit; give it at least %.2f s" % (seconds, state["fps"], 2.0 / state["fps"]))
    _IMPACTS.append({
        "object": obj,
        "target": target,
        "at": at,
        "first": first,
        "last": last,
        "push": push,
        "shake": shake,
    })
    log("impact on %s at %.2f s (frames %d-%d): %.2f m down the sightline, %.3f m of shake, back on the "
        "path by %.2f s" % (obj.name, at, first, last, push, shake, T(last)))
    return cam


def _apply_impacts():
    """Lay every registered hit on top of the camera path it belongs to."""
    if not _IMPACTS:
        return
    state = shot()
    frames = state["frames"]
    cameras = []
    grouped = {}
    for hit in _IMPACTS:
        name = hit["object"].name
        if name not in grouped:
            grouped[name] = []
            cameras.append(name)
        grouped[name].append(hit)
    for name in cameras:
        hits = grouped[name]
        obj, target = hits[0]["object"], hits[0]["target"]
        channels, aim = _channels(obj), _channels(target)
        base = [_keyed_location(obj, channels, frame) for frame in range(1, frames + 1)]
        offsets = [[0.0, 0.0, 0.0] for _ in range(frames)]
        for hit in hits:
            here = base[hit["first"] - 1]
            there = _keyed_location(target, aim, hit["first"])
            forward = _unit((there[0] - here[0], there[1] - here[1], there[2] - here[2]))
            if forward is None:
                die("impact: at %.2f s the camera is standing on what it is looking at, so there is no "
                    "sightline to be pushed down - place it with pv.camera(..., location=...)" % hit["at"])
            # Straight down is the one aim with no "across the frame": any
            # level axis will do, and +X is the one the scene is built on.
            right = _unit(_cross(forward, (0.0, 0.0, 1.0))) or (1.0, 0.0, 0.0)
            up = _cross(right, forward)
            span = max(1e-6, T(hit["last"]) - hit["at"])
            for frame in range(hit["first"], hit["last"] + 1):
                elapsed = T(frame) - hit["at"]
                u = max(0.0, min(1.0, elapsed / span))
                shove = hit["push"] * _impact_push(u)
                ring = hit["shake"] * _impact_envelope(u)
                beats = elapsed * state["fps"]
                across = ring * math.sin(2.0 * math.pi * beats / _IMPACT_ACROSS_FRAMES)
                lift = ring * math.sin(2.0 * math.pi * beats / _IMPACT_LIFT_FRAMES + 1.1)
                row = offsets[frame - 1]
                for axis in range(3):
                    row[axis] += forward[axis] * shove + right[axis] * across + up[axis] * lift
        for frame in range(1, frames + 1):
            station, row = base[frame - 1], offsets[frame - 1]
            obj.location = (station[0] + row[0], station[1] + row[1], station[2] + row[2])
            obj.keyframe_insert("location", frame=frame)
        _shape_keys(obj, "LINEAR", None, (1, frames))
        moved = max(math.dist((0.0, 0.0, 0.0), tuple(offset)) for offset in offsets)
        log("impact: %d hit(s) composed onto %s's path over %d frames, furthest %.3f m off it"
            % (len(hits), name, frames, moved))


def accent(objects, start, end, color, name="accent"):
    """Key a Workbench colour change and record it for the 3D lane to replay.

    glTF carries no Workbench material animation, so the accent travels in
    `scene.meta.json` instead. A material shared with objects OUTSIDE this
    list is COPIED first: an accent that also turned the floor blue would be
    a defect nobody would think to check for.

    `start` and `end` are ACTION seconds like every other beat, and the
    sidecar records where a `slowmo` moved them to in SHOT seconds - the
    viewer replays the colour against the clip, not against the blocking.
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
# Landmarks: the places the model has to be able to READ
# ---------------------------------------------------------------------------

# Eight saturated colours, far apart from each other and from the kit's three
# greys, so "the red block" is unambiguous in a 640-wide preview. Eight is the
# whole list on purpose: past that the colours stop being tellable apart and a
# greybox with nine named places is not one anybody can read anyway.
LANDMARK_PALETTE = [
    ("red",     (0.85, 0.15, 0.12)),
    ("blue",    (0.15, 0.35, 0.85)),
    ("yellow",  (0.92, 0.80, 0.10)),
    ("green",   (0.15, 0.65, 0.25)),
    ("magenta", (0.80, 0.15, 0.70)),
    ("cyan",    (0.10, 0.70, 0.75)),
    ("orange",  (0.95, 0.50, 0.10)),
    ("purple",  (0.45, 0.20, 0.75)),
]

# The kit's own three, named, so a pawn left the default colour is reported as
# "white" rather than as the nearest thing in the landmark palette.
_KIT_COLOURS = [
    ("white", (0.90, 0.90, 0.90)),
    ("grey", (0.62, 0.63, 0.65)),
    ("dark", (0.35, 0.36, 0.38)),
]

# How far off the camera's line to a figure a landmark may sit and still count
# as being BEHIND that figure. A half-angle, in the ground plane.
_BEHIND_DEGREES = 25.0

# The frame in thirds, in normalised camera-view x. A place whose centre lands
# in an outer third is one the prompt can call screen-left or screen-right;
# the middle third is reported as "centre" and the prompt says nothing about
# it, because a landmark near the axis is either behind somebody or in the
# middle, and being told it is on a side is a composition the model obeys.
_SCREEN_THIRDS = (1.0 / 3.0, 2.0 / 3.0)


def _landmark_meshes(objects):
    """`objects` as a flat list of things that can carry a material."""
    if isinstance(objects, dict):
        die("landmark: that is a dict of parts (what `room` returns), not an object - pass the parts "
            "this place is made of, e.g. [parts[\"back\"], parts[\"left\"]]")
    items = list(objects) if isinstance(objects, (list, tuple)) else [objects]
    if not items:
        die("landmark: needs at least one object - the blocks that ARE this place")
    for obj in items:
        data = getattr(obj, "data", None)
        if data is None or not hasattr(data, "materials"):
            die("landmark: %s carries no material, so it cannot be painted a colour the model can "
                "read - name the box or cylinder that stands for the place, not its hinge or its parent"
                % getattr(obj, "name", obj))
    return items


def landmark(name, objects, label=None, color=None):
    """Declare a named place the model must be able to READ in the greybox.

    `objects` is one object or a list of them (blocks, cylinders, a `room`
    part). Every one of them gets ONE flat material of a distinct saturated
    palette colour, so the render shows the place in a colour nobody else has
    and the prompt can say which block is the shop. `color` is a palette name
    ("red") or an (r, g, b); omitted, the next unused palette entry is taken.
    `label` is the prose the prompt will use ("the shop awning"); it defaults
    to `name`.

    Declare one for every place the beats name, and for any place whose SIDE
    the story cares about. Without them the model decides per take which grey
    block is which, and two takes of one street disagree.

    Returns the landmark record; `finish()` writes them all to
    `scene.meta.json` with what is in frame and who stands in front of them.
    """
    shot()
    name = str(name)
    if not name.strip():
        die("landmark: needs a name - the id the prompt and the beats call this place")
    for entry in _LANDMARKS:
        if entry["name"] == name:
            die('landmark: "%s" is already declared (%s) - one record per place; give this one its '
                "own name or add its blocks to the first call" % (name, entry["label"]))
    if len(_LANDMARKS) >= len(LANDMARK_PALETTE):
        die("landmark: \"%s\" would be number %d and the palette has %d colours - a greybox with more "
            "named places is one nobody can read; merge two of them or drop one"
            % (name, len(_LANDMARKS) + 1, len(LANDMARK_PALETTE)))

    items = _landmark_meshes(objects)
    owner = {}
    for entry in _LANDMARKS:
        for other in entry["objects"]:
            owner[other] = entry["name"]
    for obj in items:
        if obj.name in owner:
            die('landmark: %s is already part of landmark "%s" - one object is one place, so the '
                "colour the model reads stays unambiguous" % (obj.name, owner[obj.name]))

    palette = dict(LANDMARK_PALETTE)
    taken_names = set(entry["color"] for entry in _LANDMARKS)
    taken_rgb = set(tuple(entry["rgb"]) for entry in _LANDMARKS)
    if color is None:
        color_name, rgb = next((pair for pair in LANDMARK_PALETTE if pair[0] not in taken_names))
    elif isinstance(color, str):
        color_name = color
        if color_name not in palette:
            die('landmark: "%s" is not a palette colour - use one of %s, or pass an (r, g, b)'
                % (color_name, ", ".join(entry[0] for entry in LANDMARK_PALETTE)))
        rgb = palette[color_name]
    else:
        try:
            rgb = tuple(float(channel) for channel in color)
        except (TypeError, ValueError):
            rgb = ()
        if len(rgb) != 3:
            die("landmark: color must be a palette name or an (r, g, b) (got %r)" % (color,))
        color_name = "custom"
    rgb = tuple(round(float(channel), 4) for channel in rgb)
    if color_name != "custom" and color_name in taken_names:
        used = next(entry["name"] for entry in _LANDMARKS if entry["color"] == color_name)
        die('landmark: %s is already landmark "%s" - two places in one colour is the thing the '
            "colours exist to prevent; pick another of %s"
            % (color_name, used, ", ".join(entry[0] for entry in LANDMARK_PALETTE if entry[0] not in taken_names) or "none left"))
    if rgb in taken_rgb:
        used = next(entry["name"] for entry in _LANDMARKS if tuple(entry["rgb"]) == rgb)
        die('landmark: rgb%s is already landmark "%s" - two places in one colour is the thing the '
            "colours exist to prevent" % (rgb, used))

    # One material for the whole place, put into every slot of every object -
    # the same path `accent` recolours through. The Workbench render (the MP4
    # the video model is conditioned on) reads `diffuse_color`, so the colour
    # is in the picture; glTF drops a node-less material's colour on the floor
    # (measured: every material exports at the default 0.8 grey), which is
    # exactly why the rgb and the object names also travel in the sidecar.
    mat = material("%s_landmark" % name, rgb)
    for obj in items:
        slots = obj.data.materials
        if len(slots) == 0:
            slots.append(mat)
        else:
            for slot in range(len(slots)):
                slots[slot] = mat

    record = {
        "name": name,
        "label": str(label) if label is not None else name,
        "color": color_name,
        "rgb": [rgb[0], rgb[1], rgb[2]],
        "objects": [obj.name for obj in items],
        "handles": items,
    }
    _LANDMARKS.append(record)
    log("landmark %s = %s, %s rgb%s on %d object(s): %s"
        % (name, record["label"], color_name, rgb, len(items), ", ".join(record["objects"])))
    return record


def _world_centre(objects, depsgraph):
    """The centre of the union of `objects`' world bounding boxes, at the
    frame the scene is currently on."""
    low = None
    high = None
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        matrix = evaluated.matrix_world
        for corner in evaluated.bound_box:
            point = matrix @ _Vector(corner)
            if low is None:
                low = [point.x, point.y, point.z]
                high = [point.x, point.y, point.z]
                continue
            for axis in range(3):
                low[axis] = min(low[axis], point[axis])
                high[axis] = max(high[axis], point[axis])
    return tuple((low[axis] + high[axis]) / 2.0 for axis in range(3))


def _nearest_colour(rgb):
    """The colour NAME closest to `rgb` - the kit's three greys or the palette."""
    if rgb is None:
        return None
    best = None
    for name, value in list(_KIT_COLOURS) + list(LANDMARK_PALETTE):
        distance = sum((float(rgb[axis]) - value[axis]) ** 2 for axis in range(3))
        if best is None or distance < best[1]:
            best = (name, distance)
    return best[0]


def _first_rgb(obj):
    """An object's own colour, as the three rounded channels, or None."""
    data = getattr(obj, "data", None) if obj is not None else None
    slots = getattr(data, "materials", None) if data is not None else None
    if not slots or slots[0] is None:
        return None
    return [round(float(channel), 4) for channel in tuple(slots[0].diffuse_color)[:3]]


def _frame_facts(scene, frame):
    """At `frame`: each landmark's centre, whether the camera sees it and
    which third of the frame it lands in, and the landmarks standing behind
    each figure."""
    scene.frame_set(frame)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    camera = scene.camera.evaluated_get(depsgraph)
    eye = camera.matrix_world.translation
    places = {}
    for entry in _LANDMARKS:
        centre = _world_centre(entry["handles"], depsgraph)
        view = _world_to_camera_view(scene, camera, _Vector(centre))
        seen = bool(0.0 <= view.x <= 1.0 and 0.0 <= view.y <= 1.0 and view.z > 0.0)
        # WHICH SIDE OF THE FRAME, from the same projection that answers
        # in_frame. Out of frame is not a side: it is `None`, so the prompt
        # says nothing rather than placing a block the take will not contain.
        side = None
        if seen:
            side = "left" if view.x < _SCREEN_THIRDS[0] else ("right" if view.x > _SCREEN_THIRDS[1] else "centre")
        places[entry["name"]] = {
            "centre": centre,
            "in_frame": seen,
            "side": side,
        }
    # BEHIND is a fact about the ground plane: a landmark is behind a figure
    # when it is farther from the camera and within a narrow cone of the
    # camera's line to that figure. Z is ignored on purpose - an awning three
    # metres up is still behind the person under it.
    limit = math.cos(math.radians(_BEHIND_DEGREES))
    behind = {}
    for fig in _FIGURES:
        here = fig["root"].evaluated_get(depsgraph).matrix_world.translation
        to_figure = (here.x - eye.x, here.y - eye.y)
        span = math.hypot(*to_figure)
        found = []
        if span > 1e-6:
            for entry in _LANDMARKS:
                centre = places[entry["name"]]["centre"]
                to_place = (centre[0] - eye.x, centre[1] - eye.y)
                reach = math.hypot(*to_place)
                if reach <= span or reach < 1e-6:
                    continue
                cosine = (to_figure[0] * to_place[0] + to_figure[1] * to_place[1]) / (span * reach)
                if cosine >= limit:
                    found.append((reach, entry["name"]))
        behind[fig["root"].name] = [name for _, name in sorted(found)]
    return {"landmarks": places, "behind": behind}


def _landmark_track(first, last):
    """The landmarks, with what the camera sees of them at both ends and
    which side of the frame each one lands on."""
    return [
        {
            "name": entry["name"],
            "label": entry["label"],
            "color": entry["color"],
            "rgb": list(entry["rgb"]),
            "objects": list(entry["objects"]),
            "in_frame": {
                "first": first["landmarks"][entry["name"]]["in_frame"],
                "last": last["landmarks"][entry["name"]]["in_frame"],
            },
            "screen": {
                "first": first["landmarks"][entry["name"]]["side"],
                "last": last["landmarks"][entry["name"]]["side"],
            },
        }
        for entry in _LANDMARKS
    ]


def _subjects_detail(first, last):
    """One entry per subject, in `subjects` order - a figure carries what is
    behind it, a prop carries `behind: null`."""
    figures = {fig["root"].name: fig for fig in _FIGURES}
    rows = []
    for name in _SUBJECTS:
        fig = figures.get(name)
        if fig is None:
            rgb = _first_rgb(bpy.data.objects.get(name))
            rows.append({"name": name, "color": _nearest_colour(rgb), "rgb": rgb, "behind": None})
            continue
        rgb = _first_rgb(fig["body"])
        rows.append({
            "name": name,
            "color": _nearest_colour(rgb),
            "rgb": rgb,
            "behind": {"first": first["behind"][name], "last": last["behind"][name]},
        })
    return rows


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

    # Order matters, and it is the whole of the tempo design: the figures bake
    # through the time map analytically, everything else is resampled through
    # the same map, and only then are the impacts laid on top - because an
    # impact is stated in SHOT seconds and must not be remapped with the
    # action it punctuates.
    for fig in _FIGURES:
        _bake_figure(fig)
    _apply_time_warp(set(fig["root"].as_pointer() for fig in _FIGURES))
    _apply_impacts()
    _rebake_lens_track(scene.camera)
    _report_tail(scene.camera)

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

    # The two ends of the clip, read off the BAKED scene: where every landmark
    # is, whether the camera sees it, and who is standing in front of it. It
    # has to be after the bake, the warp and the impacts - the answer is about
    # the frames the model will be conditioned on, not about what was written.
    first = _frame_facts(scene, 1)
    last = _frame_facts(scene, state["frames"])
    scene.frame_set(1)

    meta = {
        "fps": state["fps"],
        "frames": state["frames"],
        "seconds": state["seconds"],
        "width": state["width"],
        "height": state["height"],
        "camera": scene.camera.name,
        "subjects": list(_SUBJECTS),
        "accents": _accent_track(),
        # What each colour in the picture MEANS, and who is in front of it.
        # A grey block is a shape; only this says it is the shop.
        "landmarks": _landmark_track(first, last),
        "subjects_detail": _subjects_detail(first, last),
        # The second thing glTF drops on the floor, after the accent colours:
        # the focal length curve. `[]` when the lens never moved, in which
        # case the exported camera's own yfov is the whole truth.
        "camera_lens": _lens_track(),
        # The speed ramps, in shot seconds, so the viewer can draw a tempo row
        # under the beats timeline. `[]` when the clip runs at one speed.
        "time_warp": _warp_track(),
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
    overview = {key: value for key, value in meta.items()
                if key not in ("camera_lens", "landmarks", "subjects_detail")}
    overview["camera_lens_keys"] = len(meta["camera_lens"])
    overview["landmarks"] = [entry["name"] for entry in meta["landmarks"]]
    log("summary %s" % json.dumps(overview, sort_keys=True))
    return meta
