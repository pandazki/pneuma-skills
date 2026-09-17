"""kit.py - the Blender helpers a lucid asset script imports.

An agent-written script never has to rediscover how Blender selects objects,
which operator name survived this release, or why an apply silently did
nothing. It writes:

    import kit

    objs = kit.import_model(path)   # empties Blender's startup scene first
    kit.yaw(objs, 90)
    kit.apply_transforms(objs)
    kit.ground(objs)
    kit.normalize(objs, height=1.8)
    kit.single_sided(objs)
    kit.export_glb(out, objs)

`blender.mjs run` puts this directory on `sys.path` (that is what `--kit`,
which is on by default, does), so the bare `import kit` works from a script
saved anywhere. `blender.mjs kit` prints this file's API.

## Two axis conventions, on purpose

Everything that MEASURES or PLACES the model speaks **glTF axes (Y up)**,
because that is where the model is going: `world_bbox`, `ground`, `normalize`
and every printed bounding box. Blender (x, y, z) = glTF (x, -z, y).

Everything that BUILDS geometry speaks **Blender axes (Z up)**, because it
sits next to `bpy.ops.mesh.primitive_*` calls that already do: the `offset`
of `array`, the location of a `boolean` cutter. Every log line that carries a
vector names the space it is in, so a number read from the log is never
ambiguous.

## Every function prints one line

`--background` has no UI, no progress bar and no error dialog. The printed log
is the only observability there is, so each function here prints exactly one
`[kit]` line saying what it did to how many objects - including when it
decided to do nothing, which is the case that otherwise looks like success.

Misuse (two normalize dimensions, a ratio outside (0, 1], a file Blender
cannot import) calls `die()`: one `ERROR:` line on stderr and `sys.exit(1)`.
Blender can exit 0 after an uncaught Python exception, so a raise is not a
reliable refusal.

## Measured notes

* **`hasattr(bpy.types, "WM_OT_fbx_import")` is False on Blender 5.2.1 even
  though `bpy.ops.wm.fbx_import` exists and works.** The `bpy.types` probe only
  sees operators registered from Python (add-ons); the built-in C++ importers
  - `wm.fbx_import`, `wm.obj_import`, `wm.obj_export` - are invisible to it.
  `bpy.ops.<mod>.<name>.get_rna_type()` raises `KeyError` for a name that does
  not exist and returns the type for one that does, for both kinds. That is
  what `operator_exists()` uses. (`hasattr(bpy.ops.wm, anything)` is always
  True and proves nothing at all - `bpy.ops` resolves lazily.)
* The glTF importer bakes its Y-up -> Z-up conversion into the vertices: after
  `import_scene.gltf` the object transform is identity. FBX and OBJ do not,
  which is why `apply_transforms` exists.
* Blender's bundled Python has numpy and does not have Pillow, so `world_bbox`
  reads real vertex coordinates through `foreach_get` instead of approximating
  with `obj.bound_box`, whose 8 corners over-report under rotation.
* **Blender's factory startup scene contains a Cube, a Camera and a Light.**
  A script that imports a model and then asks for `mesh_objects()` gets its
  model AND that cube: measured here, the cube silently doubled the height of
  the box a `normalize` was computed from. So the first `import_model()` in a
  process empties the scene (later ones add to it, which is how parts are
  assembled), and `reset()` does it explicitly for a script that builds
  geometry instead of importing it.
"""

import atexit
import fnmatch
import math
import os
import shutil
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

TAG = "[kit]"

#: The collection the glTF importer parks its own helper objects in. They are
#: not part of the model and must never reach a bounding box or an export.
NOT_EXPORTED = "glTF_not_exported"

#: An export smaller than this is the exporter's empty-scene header, not a
#: model. Measured: a GLB with one 12-triangle cube is ~1.6 KB.
MIN_GLB_BYTES = 1024

#: Default weld distance for `merge_fragments`, in the model's own units.
MERGE_THRESHOLD = 1e-4

#: Set by the first `import_model`, so a second import adds parts to the scene
#: rather than wiping the first one. `reset()` clears it again.
_SCENE_CLEARED = False

_EXTENSION_IMPORTERS = {
    ".glb": (("import_scene", "gltf"), ("wm", "gltf_import")),
    ".gltf": (("import_scene", "gltf"), ("wm", "gltf_import")),
    ".fbx": (("import_scene", "fbx"), ("wm", "fbx_import")),
    ".obj": (("wm", "obj_import"), ("import_scene", "obj")),
}


def log(message):
    """Print one `[kit]` line to stdout, flushed."""
    print("%s %s" % (TAG, message), flush=True)


def die(message):
    """Print one `ERROR:` line to stderr and exit 1."""
    print("ERROR: %s" % message, file=sys.stderr, flush=True)
    sys.exit(1)


def script_args():
    """The arguments Blender was given after the literal `--`."""
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def operator_exists(module, name):
    """Is `bpy.ops.<module>.<name>` really registered in this Blender?"""
    try:
        getattr(getattr(bpy.ops, module), name).get_rna_type()
        return True
    except (AttributeError, KeyError, RuntimeError):
        return False


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _fmt(vector):
    return "(%.4f, %.4f, %.4f)" % (vector[0], vector[1], vector[2])


def _blender_to_gltf(point):
    """Blender (x, y, z) -> glTF (x, z, -y)."""
    return [point[0], point[2], -point[1]]


def _not_exported(obj):
    return any(collection.name == NOT_EXPORTED for collection in obj.users_collection)


def _object_mode():
    """Leave edit/pose mode if some earlier step is still in it."""
    if bpy.context.view_layer.objects.active is None:
        return
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def _select(objs):
    """Make exactly `objs` the selection, with the first as active.

    Written as `select_set` rather than `bpy.ops.object.select_all`, which
    needs a context an empty scene does not have.
    """
    _object_mode()
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    live = [obj for obj in objs if obj.name in bpy.context.view_layer.objects]
    for obj in live:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = live[0] if live else None
    return live


def _meshes(objs):
    return [obj for obj in objs if obj.type == "MESH"]


def _roots(objs):
    """The objects in `objs` whose parent is outside `objs`.

    Moving those moves the whole group exactly once: a child follows its
    parent, so translating both would apply the offset twice.
    """
    members = {obj.name for obj in objs}
    return [obj for obj in objs if obj.parent is None or obj.parent.name not in members]


def _world_coordinates(obj):
    """Every vertex of `obj` in Blender world space, as an (N, 3) array."""
    mesh = obj.data
    count = len(mesh.vertices)
    if count == 0:
        return None
    flat = np.empty(count * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", flat)
    local = flat.reshape(count, 3)
    matrix = np.array(obj.matrix_world.to_4x4(), dtype=np.float64)
    return local @ matrix[:3, :3].T + matrix[:3, 3]


def _blender_bounds(objs):
    """(min, max) of `objs` in Blender world space, or None."""
    low = None
    high = None
    for obj in _meshes(objs):
        coordinates = _world_coordinates(obj)
        if coordinates is None:
            continue
        obj_low = coordinates.min(axis=0)
        obj_high = coordinates.max(axis=0)
        low = obj_low if low is None else np.minimum(low, obj_low)
        high = obj_high if high is None else np.maximum(high, obj_high)
    if low is None:
        return None
    return low, high


def _transform_roots(objs, matrix):
    """Left-multiply a world matrix onto every root of `objs`."""
    roots = _roots(objs)
    for obj in roots:
        obj.matrix_world = matrix @ obj.matrix_world
    bpy.context.view_layer.update()
    return roots


def _apply_modifier(obj, modifier_name, what):
    """Apply one modifier now, so the mesh data tells the truth afterwards.

    Leaving it on the stack would work (the exporter applies modifiers), but
    then every triangle count and bounding box measured between here and the
    export would describe geometry that no longer exists.
    """
    _select([obj])
    if obj.data.users > 1:
        obj.data = obj.data.copy()
        log("%s: copied multi-user mesh data on %r first - applying to shared data is refused"
            % (what, obj.name))
    bpy.ops.object.modifier_apply(modifier=modifier_name)


def _identity_rotation_scale(obj, tolerance=1e-5):
    """Did the bake actually land? An operator report is not evidence."""
    _, rotation, scale = obj.matrix_world.decompose()
    if any(abs(value - 1.0) > tolerance for value in scale):
        return False
    return abs(rotation.angle) <= tolerance or abs(abs(rotation.angle) - 2 * math.pi) <= tolerance


def _triangles(obj):
    return sum(max(len(polygon.vertices) - 2, 0) for polygon in obj.data.polygons)


def _stage_fbx(path):
    """Copy an FBX somewhere disposable before importing it.

    Blender's FBX importer unpacks embedded textures into a `<name>.fbm/`
    directory NEXT TO THE FILE IT READS. Importing straight out of a workspace
    litters it with a directory nobody asked for, and the next import picks up
    the stale dump. The copy lives in the OS temp directory and is removed at
    interpreter exit - not immediately, because the imported images are file
    references into that `.fbm` directory until the export has read them.
    """
    scratch = tempfile.mkdtemp(prefix="lucid-kit-")
    atexit.register(shutil.rmtree, scratch, ignore_errors=True)
    staged = os.path.join(scratch, os.path.basename(path))
    shutil.copy2(path, staged)
    return staged


# ---------------------------------------------------------------------------
# Getting a model in
# ---------------------------------------------------------------------------


def reset():
    """Empty the scene, so Blender's startup cube cannot join the model."""
    global _SCENE_CLEARED
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _SCENE_CLEARED = True
    log("reset: empty scene at factory settings - no default cube, camera or light")


def import_model(path):
    """Import one .glb/.gltf/.fbx/.obj and return the objects it added."""
    global _SCENE_CLEARED
    absolute = os.path.abspath(path)
    if not os.path.isfile(absolute):
        die("import_model: no such file: %s" % absolute)
    extension = os.path.splitext(absolute)[1].lower()
    candidates = _EXTENSION_IMPORTERS.get(extension)
    if candidates is None:
        die("import_model: unsupported extension %r - kit reads %s"
            % (extension, ", ".join(sorted(_EXTENSION_IMPORTERS))))

    chosen = next((pair for pair in candidates if operator_exists(*pair)), None)
    if chosen is None:
        die("import_model: this Blender has no importer for %s (looked for %s). "
            "Enable the matching Import-Export add-on, or convert the file elsewhere."
            % (extension, " and ".join("bpy.ops.%s.%s" % pair for pair in candidates)))

    first = not _SCENE_CLEARED
    if first:
        # Blender's startup scene holds a Cube, a Camera and a Light, and every
        # later measurement would include that cube.
        bpy.ops.wm.read_factory_settings(use_empty=True)
        _SCENE_CLEARED = True

    read_from = _stage_fbx(absolute) if extension == ".fbx" else absolute
    before = {obj.name for obj in bpy.context.scene.objects}
    getattr(getattr(bpy.ops, chosen[0]), chosen[1])(filepath=read_from)
    added = [obj for obj in bpy.context.scene.objects if obj.name not in before]
    kept = [obj for obj in added if not _not_exported(obj)]
    log("import_model: %s via bpy.ops.%s.%s -> %d object(s), %d mesh(es)%s%s%s"
        % (os.path.basename(absolute), chosen[0], chosen[1], len(kept), len(_meshes(kept)),
           ", %d skipped as %s" % (len(added) - len(kept), NOT_EXPORTED) if len(added) != len(kept) else "",
           " (read from a temp copy so no .fbm dump lands next to the source)" if read_from != absolute else "",
           "; emptied the startup scene first" if first else "; added to the scene already loaded"))
    if not kept:
        die("import_model: the importer added no objects - the file is empty or unreadable")
    return kept


def mesh_objects():
    """Every MESH object in the scene that is not an importer helper."""
    found = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not _not_exported(obj)]
    log("mesh_objects: %d mesh object(s) in the scene" % len(found))
    return found


# ---------------------------------------------------------------------------
# Measuring
# ---------------------------------------------------------------------------


def world_bbox(objs):
    """(min, max) of `objs` in glTF axes (Y up), measured from real vertices."""
    bounds = _blender_bounds(objs)
    if bounds is None:
        die("world_bbox: none of the %d object(s) has any vertices to measure" % len(objs))
    low, high = bounds
    corners = [_blender_to_gltf(low), _blender_to_gltf(high)]
    # The axis map negates one component, so the glTF minimum is not the image
    # of the Blender minimum: take the per-axis extremes of both mapped corners.
    gltf_min = [float(min(corners[0][axis], corners[1][axis])) for axis in range(3)]
    gltf_max = [float(max(corners[0][axis], corners[1][axis])) for axis in range(3)]
    log("world_bbox: glTF min %s max %s  size %s" % (
        _fmt(gltf_min), _fmt(gltf_max),
        _fmt([gltf_max[axis] - gltf_min[axis] for axis in range(3)])))
    return gltf_min, gltf_max


# ---------------------------------------------------------------------------
# Getting a model straight
# ---------------------------------------------------------------------------


def yaw(objs, degrees):
    """Turn `objs` about the up axis, through the world origin."""
    rotated = _transform_roots(objs, Matrix.Rotation(math.radians(degrees), 4, "Z"))
    log("yaw: %+.3f deg about the up axis on %d root object(s) - still on the node "
        "transform until apply_transforms()" % (degrees, len(rotated)))
    return objs


def apply_transforms(objs):
    """Bake rotation and scale into the vertices, leaving identity on the node.

    A rotation left on a node is the one that hurts: a loader that measures a
    model through its node matrices and then normalizes the raw geometry puts a
    rotated asset somewhere nobody predicted, with a clean console. Location is
    deliberately NOT applied - `ground` and `normalize` write a translation and
    a uniform scale, which compose harmlessly.

    Shared mesh data is copied first. `transform_apply(isolate_users=True)`
    looks like it covers that case and does not: measured on Blender 5.2.1 with
    two objects on one datablock, the operator returned, copied nothing, and
    left both rotations exactly where they were - so the check below is not
    defensive programming, it is the only thing that noticed.
    """
    meshes = _meshes(objs)
    if not meshes:
        log("apply_transforms: nothing to bake - no mesh objects")
        return objs
    shared = [obj for obj in meshes if obj.data.users > 1]
    for obj in shared:
        obj.data = obj.data.copy()
    selected = _select(meshes)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    stubborn = [obj.name for obj in selected if not _identity_rotation_scale(obj)]
    log("apply_transforms: baked rotation and scale into %d mesh(es)%s%s"
        % (len(selected) - len(stubborn),
           " (%d instance(s) of shared mesh data were copied first, so each could "
           "take its own rotation)" % len(shared) if shared else "",
           "; %d REFUSED" % len(stubborn) if stubborn else ""))
    if stubborn:
        die("apply_transforms: %s still carry a rotation or scale on the node. "
            "Blender refuses to apply a transform to an object with shape keys or "
            "to geometry it cannot make single-user; exporting now would ship a "
            "model whose node matrix and vertex data disagree. Remove the shape "
            "keys, or place this asset by hand." % ", ".join(stubborn))
    return objs


def ground(objs):
    """Put the feet on y = 0 and the centre on x = z = 0 (glTF axes)."""
    bounds = _blender_bounds(objs)
    if bounds is None:
        die("ground: none of the %d object(s) has any vertices to measure" % len(objs))
    low, high = bounds
    # Blender z is glTF y (up); Blender x/y are glTF x/-z (the floor plane).
    delta = Vector((
        -(low[0] + high[0]) * 0.5,
        -(low[1] + high[1]) * 0.5,
        -low[2],
    ))
    moved = _transform_roots(objs, Matrix.Translation(delta))
    log("ground: moved %d root object(s) by glTF %s - feet at y = 0, centred in x and z"
        % (len(moved), _fmt(_blender_to_gltf(delta))))
    return objs


def normalize(objs, height=None, longest=None, width=None):
    """Scale `objs` about the world origin so exactly one dimension hits its target.

    Exactly one of `height` (glTF y), `width` (glTF x) or `longest` (whichever
    of the three is largest) must be given: two targets on one uniform scale
    cannot both be met, and silently honouring one of them is how an asset ends
    up the wrong size with a log that says it succeeded.

    Scaling happens about the world origin, so `ground()` first and the result
    stays grounded and centred.
    """
    asked = {"height": height, "width": width, "longest": longest}
    given = sorted(name for name, value in asked.items() if value is not None)
    if len(given) != 1:
        die("normalize: give exactly one of height=, width= or longest=, not %s"
            % (", ".join(given) if given else "none"))
    dimension = given[0]
    target = float(asked[dimension])
    if target <= 0:
        die("normalize: %s must be greater than 0, got %g" % (dimension, target))

    gltf_min, gltf_max = world_bbox(objs)
    size = [gltf_max[axis] - gltf_min[axis] for axis in range(3)]
    current = {"width": size[0], "height": size[1], "longest": max(size)}[dimension]
    if current <= 1e-9:
        die("normalize: this model measures %g along %s - there is nothing to scale"
            % (current, dimension))

    factor = target / current
    _transform_roots(objs, Matrix.Scale(factor, 4))
    log("normalize: %s %.4f -> %.4f, uniform scale x%.5f about the world origin"
        % (dimension, current, target, factor))
    return objs


# ---------------------------------------------------------------------------
# Cleaning up what a generator produced
# ---------------------------------------------------------------------------


def decimate(objs, ratio):
    """Collapse-decimate every mesh to `ratio` of its triangles, and apply it."""
    if not 0 < ratio <= 1:
        die("decimate: ratio must be inside (0, 1], got %r" % (ratio,))
    meshes = [obj for obj in _meshes(objs) if len(obj.data.polygons) > 0]
    before = sum(_triangles(obj) for obj in meshes)
    for obj in meshes:
        modifier = obj.modifiers.new(name="lucid_decimate", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        _apply_modifier(obj, modifier.name, "decimate")
    after = sum(_triangles(obj) for obj in meshes)
    log("decimate: ratio %.4f on %d mesh(es), %d -> %d triangles%s"
        % (ratio, len(meshes), before, after,
           " (no reduction: a lattice or an already-welded mesh has no redundant vertices left)"
           if meshes and after >= before else ""))
    return objs


def single_sided(objs, thin_names=()):
    """Turn backface culling on everywhere except the parts named as thin.

    Blender's glTF exporter writes `doubleSided: true` for every material whose
    `use_backface_culling` is off, which is the default - so an unattended
    import doubles the fragment cost of the whole model for nothing. Leaves,
    flags, signs and cloth are the real exceptions: name them in `thin_names`
    and they stay double-sided. A name matches if a pattern is a
    case-insensitive substring of it, or an fnmatch glob that matches it.

    A material shared between a thin object and a solid one stays double-sided:
    a culled card disappears from one side, which is worse than one extra draw.
    """
    patterns = [str(pattern).strip().lower() for pattern in thin_names if str(pattern).strip()]
    decisions = {}
    thin_objects = []
    for obj in objs:
        name = obj.name.lower()
        thin = any(pattern in name or fnmatch.fnmatch(name, pattern) for pattern in patterns)
        if thin:
            thin_objects.append(obj.name)
        for slot in getattr(obj, "material_slots", []):
            if slot.material is None:
                continue
            decisions.setdefault(slot.material, set()).add(thin)

    culled = 0
    shared = []
    for material, votes in decisions.items():
        if len(votes) > 1:
            shared.append(material.name)
        thin = any(votes)
        if hasattr(material, "use_backface_culling"):
            material.use_backface_culling = not thin
        if not thin:
            culled += 1
    log("single_sided: backface culling on for %d of %d material(s)%s%s"
        % (culled, len(decisions),
           "; thin: %s" % ", ".join(sorted(thin_objects)) if thin_objects else "",
           "; %s shared between thin and solid objects, left double-sided" % ", ".join(sorted(shared))
           if shared else ""))
    return objs


def merge_fragments(objs, threshold=MERGE_THRESHOLD):
    """Join every mesh into one object and weld its coincident vertices.

    An image-to-3D mesh arrives as hundreds of disconnected shells: every
    modifier, every material assignment and every scene-graph operation then
    costs hundreds of times what it should, and nothing downstream can treat
    the asset as one thing. Joining does not change what it looks like.

    The objects you passed in no longer exist afterwards - keep the returned
    list, not the one you handed over.
    """
    meshes = _meshes(objs)
    if not meshes:
        log("merge_fragments: nothing to merge - no mesh objects")
        return objs
    before_objects = len(meshes)
    before_vertices = sum(len(obj.data.vertices) for obj in meshes)
    target = _select(meshes)[0]
    if before_objects > 1:
        bpy.ops.object.join()
        target = bpy.context.view_layer.objects.active
    _select([target])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=threshold)
    bpy.ops.object.mode_set(mode="OBJECT")
    after_vertices = len(target.data.vertices)
    log("merge_fragments: %d mesh(es) -> 1 (%r), welded at %g: %d -> %d vertices"
        % (before_objects, target.name, threshold, before_vertices, after_vertices))
    return [target]


# ---------------------------------------------------------------------------
# Building a prop
# ---------------------------------------------------------------------------


def bevel(obj, width, segments=2):
    """Bevel every edge of `obj` by `width` (Blender units) and apply it.

    The one modifier that separates a hard-surface prop from a primitive: a
    perfectly sharp edge catches no light, so an unbevelled box reads as a
    placeholder at any resolution.
    """
    if width <= 0:
        die("bevel: width must be greater than 0, got %r" % (width,))
    if segments < 1:
        die("bevel: segments must be at least 1, got %r" % (segments,))
    before = len(obj.data.polygons)
    modifier = obj.modifiers.new(name="lucid_bevel", type="BEVEL")
    modifier.width = width
    modifier.segments = int(segments)
    modifier.limit_method = "ANGLE"
    _apply_modifier(obj, modifier.name, "bevel")
    log("bevel: %r width %g, %d segment(s), %d -> %d faces"
        % (obj.name, width, segments, before, len(obj.data.polygons)))
    return obj


def array(obj, count, offset=(0.0, 0.0, 0.0), spin=None):
    """Repeat `obj` `count` times: along `offset`, or around the up axis.

    `offset` is a constant displacement in **Blender axes (Z up)**, which is
    what the `bpy.ops.mesh.primitive_*` call that made `obj` used. Give `spin`
    instead - the total sweep in degrees, 360 for a closed ring - to turn each
    copy about the world Z axis, which a constant offset cannot express. Build
    the prop around the origin and the ring lands where you expect.

    The ring is built with an offset Empty, and the Empty's transform is NOT
    just the rotation. The array modifier repeats
    `inverse(obj.matrix_world) @ empty.matrix_world` in the object's own space,
    so a bare rotation makes every copy re-apply the object's own offset:
    measured here, a ring of 8 rivets came out as a spiral that sank 0.17 m per
    copy and stretched the prop from 0.55 m to 1.61 m tall. The Empty therefore
    carries `rotation @ obj.matrix_world`, which is the only value that makes
    copy i land on `rotation^i` of the original, wherever the object sits.
    """
    if count < 1:
        die("array: count must be at least 1, got %r" % (count,))
    before = len(obj.data.polygons)
    modifier = obj.modifiers.new(name="lucid_array", type="ARRAY")
    modifier.use_relative_offset = False
    pivot = None
    if spin is None:
        modifier.use_constant_offset = True
        modifier.constant_offset_displace = tuple(float(value) for value in offset)
        how = "offset %s in Blender axes (Z up)" % _fmt(offset)
    else:
        pivot = bpy.data.objects.new("lucid_array_pivot", None)
        bpy.context.scene.collection.objects.link(pivot)
        pivot.matrix_world = Matrix.Rotation(math.radians(float(spin) / count), 4, "Z") @ obj.matrix_world
        bpy.context.view_layer.update()
        modifier.use_object_offset = True
        modifier.offset_object = pivot
        how = "a %g deg sweep about the up axis" % float(spin)
    modifier.count = int(count)
    _apply_modifier(obj, modifier.name, "array")
    if pivot is not None:
        bpy.data.objects.remove(pivot, do_unlink=True)
    log("array: %r x%d, %s, %d -> %d faces" % (obj.name, count, how, before, len(obj.data.polygons)))
    return obj


def boolean(obj, cutter, op="DIFFERENCE"):
    """Cut `cutter` out of (or into) `obj`, apply it, and delete the cutter.

    The cutter is removed on purpose: a helper left in the scene exports as a
    visible box floating through the prop, which is the classic "why is that
    there" gap in a first render.
    """
    operation = str(op).upper()
    if operation not in ("DIFFERENCE", "UNION", "INTERSECT"):
        die("boolean: op must be DIFFERENCE, UNION or INTERSECT, got %r" % (op,))
    before = len(obj.data.polygons)
    modifier = obj.modifiers.new(name="lucid_boolean", type="BOOLEAN")
    modifier.operation = operation
    modifier.object = cutter
    if "solver" in modifier.bl_rna.properties.keys():
        # Pin the solver: the default has changed between releases, and FLOAT
        # leaves holes in geometry EXACT handles.
        modifier.solver = "EXACT"
    _apply_modifier(obj, modifier.name, "boolean")
    cutter_name = cutter.name
    bpy.data.objects.remove(cutter, do_unlink=True)
    log("boolean: %s %r from %r, %d -> %d faces (cutter deleted)"
        % (operation, cutter_name, obj.name, before, len(obj.data.polygons)))
    return obj


def set_material(obj, color, roughness=0.6, metallic=0.0, texture_path=None):
    """Give `obj` one Principled material, single-sided, optionally textured.

    `color` is linear RGB (three floats) or RGBA. `texture_path` replaces the
    base colour with an image - which is what a surface the target actually
    shows needs; a flat colour is a placeholder, not a material.
    """
    rgba = tuple(float(value) for value in color)
    if len(rgba) == 3:
        rgba = rgba + (1.0,)
    if len(rgba) != 4:
        die("set_material: color needs 3 or 4 numbers, got %r" % (color,))

    material = bpy.data.materials.new("%s_mat" % obj.name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        die("set_material: this Blender's new material has no Principled BSDF node")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = float(roughness)
    bsdf.inputs["Metallic"].default_value = float(metallic)
    material.use_backface_culling = True

    textured = ""
    if texture_path:
        absolute = os.path.abspath(texture_path)
        if not os.path.isfile(absolute):
            die("set_material: no texture at %s" % absolute)
        image = bpy.data.images.load(absolute)
        node = material.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        node.location = (-400, 200)
        material.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
        textured = ", base colour from %s (%dx%d)" % (os.path.basename(absolute), image.size[0], image.size[1])

    obj.data.materials.clear()
    obj.data.materials.append(material)
    log("set_material: %r <- %r rgba %s roughness %.2f metallic %.2f, single-sided%s"
        % (obj.name, material.name, _fmt(rgba[:3]), float(roughness), float(metallic), textured))
    return material


# ---------------------------------------------------------------------------
# Getting a model out
# ---------------------------------------------------------------------------


def export_glb(path, objs):
    """Write `objs` to a .glb with modifiers applied, and prove it landed.

    Blender can exit 0 after an uncaught exception, and the exporter writes a
    valid empty GLB when it was handed nothing, so the size check is the only
    evidence that a model came out.
    """
    absolute = os.path.abspath(path)
    os.makedirs(os.path.dirname(absolute) or ".", exist_ok=True)
    if not operator_exists("export_scene", "gltf"):
        die("export_glb: this Blender has no glTF exporter. Enable the 'Import-Export: glTF 2.0' add-on.")

    selected = _select(objs)
    if not selected:
        die("export_glb: none of the %d object(s) is in the view layer - nothing to export" % len(objs))
    kwargs = {"filepath": absolute, "export_format": "GLB", "export_apply": True}
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    scoped = "use_selection" in properties
    if scoped:
        kwargs["use_selection"] = True
    bpy.ops.export_scene.gltf(**kwargs)

    if not os.path.isfile(absolute):
        die("export_glb: the exporter reported success but wrote no file at %s" % absolute)
    size = os.path.getsize(absolute)
    if size < MIN_GLB_BYTES:
        die("export_glb: %s is only %d bytes - that is an empty glTF header, not a model. "
            "Check the [kit] log above for the mesh count." % (absolute, size))
    log("export_glb: %s, %d object(s)%s, %d triangle(s), %d byte(s)"
        % (absolute, len(selected), "" if scoped else " (whole scene: this Blender's exporter has no use_selection)",
           sum(_triangles(obj) for obj in _meshes(selected)), size))
    return absolute
