"""probe.py - what Blender sees inside a .glb or .fbx, as one JSON line.

Run through `blender.mjs probe`, which supplies the binary and the arguments:

    blender --background --factory-startup --python probe.py -- <file>

Blender writes a lot to stdout that nobody asked for (add-on registration,
importer chatter, the quit banner), so the report is emitted on a single line
behind the marker `LUCID_PROBE_JSON`. The wrapper reads the last such line and
prints the payload; everything else is progress.

Reported in glTF axes, not Blender's: this file exists to answer questions
about an asset that is on its way into a web scene. Blender (X, Y, Z) =
glTF (X, -Z, Y), so the inverse used here is glTF (x, y, z) = (bx, bz, -by).

Triangle counts come from the polygon list (`len(poly.vertices) - 2` per face)
rather than from a tessellation cache, because that arithmetic is stable across
Blender releases and needs no API that moves.
"""

import json
import os
import sys

import bpy
from mathutils import Vector

TAG = "[probe]"
MARKER = "LUCID_PROBE_JSON"
NOT_EXPORTED = "glTF_not_exported"


def log(message):
    print("%s %s" % (TAG, message), flush=True)


def die(message):
    print("ERROR: %s" % message, file=sys.stderr, flush=True)
    sys.exit(1)


def script_args():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def blender_to_gltf(point):
    """Blender (x, y, z) -> glTF (x, z, -y)."""
    return [point[0], point[2], -point[1]]


def operator_exists(module, name):
    """Is `bpy.ops.<module>.<name>` actually registered?

    `bpy.ops` resolves lazily, so `hasattr(bpy.ops.wm, "anything")` is True for
    every name and proves nothing - measured on Blender 5.2.1, where the
    hasattr said yes and the call raised 'could not be found'. The registered
    operator type is the only evidence. (The same five lines appear in
    render_views.py and fbx_to_glb.py: these scripts are run individually by
    Blender and share no import path.)
    """
    return hasattr(bpy.types, "%s_OT_%s" % (module.upper(), name))


def import_file(path):
    extension = os.path.splitext(path)[1].lower()
    if extension == ".glb" or extension == ".gltf":
        if operator_exists("import_scene", "gltf"):
            bpy.ops.import_scene.gltf(filepath=path)
            return "import_scene.gltf"
        if operator_exists("wm", "gltf_import"):
            bpy.ops.wm.gltf_import(filepath=path)
            return "wm.gltf_import"
        die("this Blender has no glTF importer")
    if extension == ".fbx":
        # A future Blender may move FBX import to a built-in C++ operator under
        # a different name; 5.2.1 still registers the Python add-on's.
        if operator_exists("import_scene", "fbx"):
            bpy.ops.import_scene.fbx(filepath=path)
            return "import_scene.fbx"
        if operator_exists("wm", "fbx_import"):
            bpy.ops.wm.fbx_import(filepath=path)
            return "wm.fbx_import"
        die("this Blender has no FBX importer. Enable the 'Import-Export: FBX format' "
            "add-on, or convert the file elsewhere.")
    die("unsupported extension %r - probe reads .glb, .gltf or .fbx" % extension)


def triangles_of(mesh):
    return sum(max(len(polygon.vertices) - 2, 0) for polygon in mesh.polygons)


def main():
    args = script_args()
    if not args:
        die("usage: probe.py -- <file.glb|file.fbx>")
    path = os.path.abspath(args[0])
    if not os.path.isfile(path):
        die("input does not exist: %s" % path)

    log("reset to factory settings (empty scene)")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    log("importing %s" % path)
    importer = import_file(path)
    log("imported with %s" % importer)

    objects = []
    armatures = []
    low = [float("inf")] * 3
    high = [float("-inf")] * 3
    total_triangles = 0

    for obj in bpy.context.scene.objects:
        hidden = any(collection.name == NOT_EXPORTED for collection in obj.users_collection)
        entry = {
            "name": obj.name,
            "type": obj.type,
            "parent": obj.parent.name if obj.parent else None,
            "notExported": hidden,
        }
        if obj.type == "MESH":
            entry["triangles"] = triangles_of(obj.data)
            entry["vertices"] = len(obj.data.vertices)
            entry["materials"] = [slot.material.name for slot in obj.material_slots if slot.material]
            if not hidden:
                total_triangles += entry["triangles"]
                for corner in obj.bound_box:
                    point = obj.matrix_world @ Vector(corner)
                    for axis in range(3):
                        low[axis] = min(low[axis], point[axis])
                        high[axis] = max(high[axis], point[axis])
        if obj.type == "ARMATURE":
            bones = [bone.name for bone in obj.data.bones]
            entry["bones"] = len(bones)
            armatures.append({"name": obj.name, "bones": len(bones), "boneNames": bones[:64]})
        objects.append(entry)

    images = []
    for image in bpy.data.images:
        if image.name in ("Render Result", "Viewer Node"):
            continue
        images.append({
            "name": image.name,
            "width": image.size[0],
            "height": image.size[1],
            "source": image.source,
            "packed": bool(image.packed_file),
        })

    has_bounds = low[0] != float("inf")
    # The axis map negates one component, so the glTF min is not the image of
    # the Blender min: take the per-axis extremes of both mapped corners.
    if has_bounds:
        mapped = [blender_to_gltf(low), blender_to_gltf(high)]
        gltf_min = [min(mapped[0][axis], mapped[1][axis]) for axis in range(3)]
        gltf_max = [max(mapped[0][axis], mapped[1][axis]) for axis in range(3)]
    report = {
        "ok": True,
        "file": path,
        "importer": importer,
        "objects": objects,
        "meshObjects": sum(1 for entry in objects if entry["type"] == "MESH"),
        "triangles": total_triangles,
        "armatures": armatures,
        "images": images,
        "bboxGltf": None if not has_bounds else {
            "min": [round(v, 6) for v in gltf_min],
            "max": [round(v, 6) for v in gltf_max],
        },
        "bboxBlender": None if not has_bounds else {
            "min": [round(v, 6) for v in low],
            "max": [round(v, 6) for v in high],
        },
        "axes": "bboxGltf is Y-up glTF space; bboxBlender is Z-up Blender space",
    }
    log("%d object(s), %d triangle(s), %d armature(s), %d image(s)"
        % (len(objects), total_triangles, len(armatures), len(images)))
    print("%s %s" % (MARKER, json.dumps(report)), flush=True)


main()
