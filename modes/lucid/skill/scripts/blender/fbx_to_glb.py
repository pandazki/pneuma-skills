"""fbx_to_glb.py - convert an FBX into a web-ready GLB, fixing the usual traps.

Run through `blender.mjs convert`, which supplies the binary and the arguments:

    blender --background --factory-startup --python fbx_to_glb.py -- \
        <in.fbx> <out.glb> [--yaw deg] [--texture-size N] [--double-sided 0|1]

Three things this does that a bare import/export does not:

1. **The source file is copied into a temp directory first.** Blender's FBX
   importer unpacks embedded textures into a `<name>.fbm/` directory NEXT TO
   THE SOURCE. Importing straight out of a workspace litters it with a folder
   nobody asked for, and re-importing later picks up the stale dump.

2. **`--yaw` is baked into the vertices.** Leaving the rotation on the object
   means the GLB carries it as a node matrix; a loader that measures the model
   through node matrices and then normalises the raw geometry will place a
   rotated asset somewhere nobody predicted. `transform_apply` puts the
   rotation where it cannot be lost. When the scene is parented (so applying a
   transform per object would move children), the rotation is left on the root
   objects and this script says so instead of quietly producing the wrong file.

3. **Backface culling is turned on unless asked otherwise.** Blender's glTF
   exporter writes `doubleSided: true` for every material whose
   `use_backface_culling` is off, which is the default - so an unattended
   conversion doubles the fragment cost of the whole model for nothing.

Every step prints a line: `--background` has no other observability.
"""

import json
import math
import os
import shutil
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector

TAG = "[fbx_to_glb]"
DEFAULT_TEXTURE_SIZE = 1024


def log(message):
    print("%s %s" % (TAG, message), flush=True)


def die(message):
    print("ERROR: %s" % message, file=sys.stderr, flush=True)
    sys.exit(1)


def script_args():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def parse_args(args):
    if len(args) < 2:
        die("usage: fbx_to_glb.py -- <in.fbx> <out.glb> [--yaw deg] "
            "[--texture-size N] [--double-sided 0|1]")
    parsed = {
        "input": os.path.abspath(args[0]),
        "output": os.path.abspath(args[1]),
        "yaw": 0.0,
        "texture_size": DEFAULT_TEXTURE_SIZE,
        "double_sided": False,
    }
    rest = args[2:]
    index = 0
    while index < len(rest):
        flag = rest[index]
        if index + 1 >= len(rest):
            die("%s needs a value" % flag)
        value = rest[index + 1]
        if flag == "--yaw":
            parsed["yaw"] = float(value)
        elif flag == "--texture-size":
            parsed["texture_size"] = int(value)
        elif flag == "--double-sided":
            parsed["double_sided"] = value not in ("0", "false", "False")
        else:
            die("unknown flag %r" % flag)
        index += 2
    return parsed


def operator_exists(module, name):
    """Is `bpy.ops.<module>.<name>` actually registered?

    `bpy.ops` resolves lazily, so `hasattr(bpy.ops.wm, "anything")` is True for
    every name and proves nothing - measured on Blender 5.2.1, where the
    hasattr said yes and the call raised 'could not be found'. The registered
    operator type is the only evidence. (The same five lines appear in
    render_views.py and probe.py: these scripts are run individually by Blender
    and share no import path.)
    """
    return hasattr(bpy.types, "%s_OT_%s" % (module.upper(), name))


def import_fbx(path):
    # A future Blender may move FBX import to a built-in C++ operator under a
    # different name; 5.2.1 still registers the Python add-on's.
    if operator_exists("import_scene", "fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
        return "import_scene.fbx"
    if operator_exists("wm", "fbx_import"):
        bpy.ops.wm.fbx_import(filepath=path)
        return "wm.fbx_import"
    die("this Blender has no FBX importer. Enable the 'Import-Export: FBX format' "
        "add-on, or convert the file elsewhere.")


def mesh_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def world_bounds(objects):
    low = [float("inf")] * 3
    high = [float("-inf")] * 3
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                low[axis] = min(low[axis], point[axis])
                high[axis] = max(high[axis], point[axis])
    if low[0] == float("inf"):
        return None
    return {"min": [round(v, 6) for v in low], "max": [round(v, 6) for v in high]}


def apply_yaw(degrees):
    """Rotate the scene about the up axis and bake the rotation into the data."""
    rotation = Matrix.Rotation(math.radians(degrees), 4, "Z")
    roots = [obj for obj in bpy.context.scene.objects if obj.parent is None]
    for obj in roots:
        obj.matrix_world = rotation @ obj.matrix_world
    bpy.context.view_layer.update()
    log("rotated %d root object(s) by %.3f deg about the up axis" % (len(roots), degrees))

    meshes = mesh_objects()
    bakeable = [obj for obj in meshes if obj.parent is None and obj.data.users == 1]
    if not bakeable:
        log("NOT baking the rotation into vertices: no unparented, single-user mesh to bake it into")
        return False
    if len(bakeable) != len(meshes):
        log("NOT baking the rotation into vertices: %d of %d mesh objects are parented "
            "or share mesh data, and applying a transform per object would move them "
            "relative to each other. The rotation stays on the node transforms."
            % (len(meshes) - len(bakeable), len(meshes)))
        return False
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bakeable:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = bakeable[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.select_all(action="DESELECT")
    log("baked the rotation into %d mesh(es) - the GLB will carry it in the vertices, "
        "not in a node matrix" % len(bakeable))
    return True


def set_backface_culling(double_sided):
    touched = 0
    for material in bpy.data.materials:
        if not hasattr(material, "use_backface_culling"):
            continue
        material.use_backface_culling = not double_sided
        touched += 1
    log("use_backface_culling = %s on %d material(s) -> doubleSided will be %s"
        % (not double_sided, touched, str(bool(double_sided)).lower()))
    return touched


def resize_images(limit):
    resized = []
    for image in bpy.data.images:
        if image.name in ("Render Result", "Viewer Node"):
            continue
        width, height = image.size
        if width == 0 or height == 0:
            log("skipping image %r: no pixel data loaded" % image.name)
            continue
        longest = max(width, height)
        if longest <= limit:
            continue
        scale = limit / float(longest)
        new_width = max(1, int(round(width * scale)))
        new_height = max(1, int(round(height * scale)))
        image.scale(new_width, new_height)
        resized.append({
            "name": image.name,
            "from": [width, height],
            "to": [new_width, new_height],
        })
        log("resized image %r %dx%d -> %dx%d" % (image.name, width, height, new_width, new_height))
    if not resized:
        log("no image exceeded %dpx on its long edge" % limit)
    return resized


def export_glb(path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    if not operator_exists("export_scene", "gltf"):
        die("this Blender has no glTF exporter. Enable the 'Import-Export: glTF 2.0' add-on.")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True)
    if not os.path.isfile(path):
        die("the exporter reported success but wrote no file at %s" % path)


def main():
    args = parse_args(script_args())
    if not os.path.isfile(args["input"]):
        die("input does not exist: %s" % args["input"])

    log("reset to factory settings (empty scene)")
    bpy.ops.wm.read_factory_settings(use_empty=True)

    scratch = tempfile.mkdtemp(prefix="lucid-fbx-")
    try:
        staged = os.path.join(scratch, os.path.basename(args["input"]))
        shutil.copy2(args["input"], staged)
        log("staged the source in %s (the importer writes a .fbm texture dump "
            "next to whatever it reads)" % scratch)

        importer = import_fbx(staged)
        log("imported with %s" % importer)

        before_meshes = mesh_objects()
        before = {
            "objects": len(bpy.context.scene.objects),
            "meshObjects": len(before_meshes),
            "materials": len(bpy.data.materials),
            "bbox": world_bounds(before_meshes),
        }
        log("before: %d object(s), %d mesh(es), %d material(s), bbox %s"
            % (before["objects"], before["meshObjects"], before["materials"], before["bbox"]))
        if not before_meshes:
            die("no mesh objects after import - nothing to convert")

        baked = False
        if args["yaw"]:
            baked = apply_yaw(args["yaw"])
        else:
            log("no --yaw given; orientation left as imported")

        set_backface_culling(args["double_sided"])
        resized = resize_images(args["texture_size"])

        export_glb(args["output"])
        after_meshes = mesh_objects()
        after = {
            "objects": len(bpy.context.scene.objects),
            "meshObjects": len(after_meshes),
            "materials": len(bpy.data.materials),
            "bbox": world_bounds(after_meshes),
        }
        log("after:  %d object(s), %d mesh(es), %d material(s), bbox %s"
            % (after["objects"], after["meshObjects"], after["materials"], after["bbox"]))
        log("wrote %s (%d bytes)" % (args["output"], os.path.getsize(args["output"])))
        log("summary %s" % json.dumps({
            "input": args["input"],
            "output": args["output"],
            "importer": importer,
            "yaw": args["yaw"],
            "yawBaked": baked,
            "doubleSided": args["double_sided"],
            "textureSize": args["texture_size"],
            "resizedImages": resized,
            "before": before,
            "after": after,
        }))
        log("done")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


main()
