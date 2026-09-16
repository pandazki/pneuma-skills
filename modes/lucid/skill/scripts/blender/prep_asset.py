"""prep_asset.py - the entry checklist for an incoming model, as one program.

Run through `blender.mjs prep`, which supplies the binary, the arguments and
the glTF checklist on the result:

    blender --background --factory-startup --python prep_asset.py -- \
        <in> <out.glb> [--yaw deg] [--height m | --longest m | --width m] \
        [--decimate r] [--merge] [--thin name,name]

Every model that arrives from image-to-3D, an FBX pack or a download needs the
same four things before it can stand next to anything else in a scene, and
none of them can be guessed from the file: which way it faces, where its feet
are, how big it really is, and whether it is one object or four hundred loose
shells. Doing that by hand is where the rung stops being used at all, so it is
one command here.

The order is not arbitrary:

    import -> merge -> yaw -> apply -> ground -> normalize -> decimate
           -> single-sided -> export

* **merge first**, because welding four hundred shells into one mesh changes
  the vertex count every later step reports, and joining after a decimate
  would decimate each shell separately.
* **yaw then apply**, because a rotation left on the node is the one that
  silently misplaces the asset later: a loader that measures through node
  matrices and then normalizes the raw geometry puts it somewhere nobody
  predicted, with a clean console.
* **ground then normalize**, because the scale is taken about the world
  origin: with the feet already on y = 0 the model stays grounded and centred
  through the scale, and the printed "after" box is the box the scene will see.
* **decimate after normalize**, so the triangle count reported at the end is
  the one that ships, and **single-sided last**, after every step that could
  have created a material.

Exactly one normalize dimension is accepted. Two targets cannot both be met by
one uniform scale, and honouring one of them silently is how an asset ends up
the wrong size with a log that says it worked.
"""

import json
import os
import sys

import bpy

import kit

TAG = "[prep_asset]"

USAGE = ("usage: prep_asset.py -- <in> <out.glb> [--yaw deg] "
         "[--height m | --longest m | --width m] [--decimate r] [--merge] "
         "[--thin name,name]")

DIMENSIONS = ("height", "longest", "width")


def log(message):
    print("%s %s" % (TAG, message), flush=True)


def die(message):
    print("ERROR: %s" % message, file=sys.stderr, flush=True)
    sys.exit(1)


def number(flag, value, minimum=None, maximum=None):
    try:
        parsed = float(value)
    except ValueError:
        die("%s must be a number, got %r" % (flag, value))
    if minimum is not None and parsed <= minimum:
        die("%s must be greater than %g, got %g" % (flag, minimum, parsed))
    if maximum is not None and parsed > maximum:
        die("%s must be at most %g, got %g" % (flag, maximum, parsed))
    return parsed


def parse_args(args):
    if len(args) < 2:
        die(USAGE)
    parsed = {
        "input": os.path.abspath(args[0]),
        "output": os.path.abspath(args[1]),
        "yaw": None,
        "height": None,
        "longest": None,
        "width": None,
        "decimate": None,
        "merge": False,
        "thin": [],
    }
    rest = args[2:]
    index = 0
    while index < len(rest):
        flag = rest[index]
        if flag == "--merge":
            parsed["merge"] = True
            index += 1
            continue
        if index + 1 >= len(rest):
            die("%s needs a value" % flag)
        value = rest[index + 1]
        if flag == "--yaw":
            parsed["yaw"] = number(flag, value, minimum=-361, maximum=360)
        elif flag == "--decimate":
            parsed["decimate"] = number(flag, value, minimum=0, maximum=1)
        elif flag == "--thin":
            parsed["thin"] = [part.strip() for part in value.split(",") if part.strip()]
        elif flag in ("--height", "--longest", "--width"):
            parsed[flag[2:]] = number(flag, value, minimum=0)
        else:
            die("unknown flag %r\n%s" % (flag, USAGE))
        index += 2

    asked = [name for name in DIMENSIONS if parsed[name] is not None]
    if len(asked) > 1:
        die("normalize by exactly one dimension: %s were all given, and one uniform "
            "scale cannot satisfy two of them. Pick the dimension that aligns this "
            "asset with its neighbours." % ", ".join("--" + name for name in asked))
    return parsed


def census(objs, label):
    """The four numbers that say whether this model changed shape."""
    gltf_min, gltf_max = kit.world_bbox(objs)
    materials = {slot.material.name for obj in objs for slot in obj.material_slots if slot.material}
    triangles = sum(
        max(len(polygon.vertices) - 2, 0)
        for obj in objs if obj.type == "MESH"
        for polygon in obj.data.polygons
    )
    report = {
        "bbox": {"min": [round(v, 6) for v in gltf_min], "max": [round(v, 6) for v in gltf_max]},
        "size": [round(gltf_max[axis] - gltf_min[axis], 6) for axis in range(3)],
        "triangles": triangles,
        "objects": len(objs),
        "meshObjects": sum(1 for obj in objs if obj.type == "MESH"),
        "materials": len(materials),
    }
    log("%-6s %d object(s), %d mesh(es), %d triangle(s), %d material(s)"
        % (label, report["objects"], report["meshObjects"], report["triangles"], report["materials"]))
    log("%-6s bbox glTF min [%s] max [%s]  size [%s]"
        % (label,
           ", ".join("%.4f" % v for v in gltf_min),
           ", ".join("%.4f" % v for v in gltf_max),
           ", ".join("%.4f" % v for v in report["size"])))
    return report


def main():
    args = parse_args(kit.script_args())
    if not os.path.isfile(args["input"]):
        die("input does not exist: %s" % args["input"])

    objs = kit.import_model(args["input"])
    if not [obj for obj in objs if obj.type == "MESH"]:
        die("no mesh objects after import - nothing to prepare")
    before = census(objs, "before")

    steps = []
    if args["merge"]:
        objs = kit.merge_fragments(objs)
        steps.append("merge")
    else:
        log("skipping merge (no --merge): loose shells stay separate objects")

    if args["yaw"]:
        kit.yaw(objs, args["yaw"])
        steps.append("yaw %g" % args["yaw"])
    else:
        log("no --yaw: orientation left as imported. Only a picture can tell you "
            "which way this faces - render six views first.")

    kit.apply_transforms(objs)
    steps.append("apply")
    kit.ground(objs)
    steps.append("ground")

    dimension = next((name for name in DIMENSIONS if args[name] is not None), None)
    if dimension:
        kit.normalize(objs, **{dimension: args[dimension]})
        steps.append("normalize %s=%g" % (dimension, args[dimension]))
    else:
        log("no --height/--longest/--width: size left as imported. An image-to-3D "
            "asset arrives normalized to a 1-unit longest edge, which is not a size.")

    if args["decimate"] is not None:
        kit.decimate(objs, args["decimate"])
        steps.append("decimate %g" % args["decimate"])
    else:
        log("no --decimate: triangle count left as imported")

    kit.single_sided(objs, thin_names=args["thin"])
    steps.append("single-sided")

    after = census(objs, "after")
    kit.export_glb(args["output"], objs)
    steps.append("export")

    log("summary %s" % json.dumps({
        "input": args["input"],
        "output": args["output"],
        "bytes": os.path.getsize(args["output"]),
        "steps": steps,
        "yaw": args["yaw"],
        "normalize": None if dimension is None else {"dimension": dimension, "target": args[dimension]},
        "decimate": args["decimate"],
        "merged": args["merge"],
        "thin": args["thin"],
        "before": before,
        "after": after,
        "blender": bpy.app.version_string,
    }))
    log("done")


main()
