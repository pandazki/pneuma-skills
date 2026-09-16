"""render_views.py - six orthographic views of a GLB on one contact sheet.

Run through `blender.mjs render-views`, which supplies the binary and the
arguments:

    blender --background --factory-startup --python render_views.py -- \
        <in.glb> <out.png> [size]

Why six and not four: a bounding box cannot tell you which way a model faces,
and front/back look identical in a four-view sheet whenever the silhouette is
roughly symmetric - which is most props, most vehicles and every character
seen from the side. -Z/+Z and -X/+X as separate tiles is what makes "this
model is facing backwards" visible before it is placed in a scene.

Axis convention: tiles are named in glTF axes (Y up), and the name is the
direction FROM the model's centre TO the camera. `-Z front` therefore views
the model from the -Z side. Blender's axes are rotated relative to glTF's:
Blender (X, Y, Z) = glTF (X, -Z, Y). The sidecar JSON records each tile's
camera direction in glTF axes so nothing downstream has to infer it.

Headless notes: `--background` has no OpenGL context, so there are no viewport
overlays, no annotations and no grease-pencil text - Workbench and EEVEE
renders are all that is available. Tile labels therefore live in the printed
log and in the sidecar, not burnt into the pixels. Compositing uses numpy over
`bpy.data.images` buffers because Blender's bundled Python has numpy and does
not have Pillow.
"""

import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

# kit.py sits next to this file and is the one definition of the shared checks.
# `blender.mjs` already puts this directory on sys.path (that is what --kit
# does); these two lines add it again so the helper also runs standalone under
# a bare `blender --python`, and keep the import from dropping a __pycache__
# into the installed skill directory.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kit

TAG = "[render_views]"
COLS = 3
ROWS = 2
DEFAULT_SIZE = 512
# Framing slack around the projected bounding box, so nothing touches the edge.
MARGIN = 1.08
# Collection the glTF importer parks its helper objects in.
NOT_EXPORTED = "glTF_not_exported"

# (tile name, camera direction in glTF axes)
VIEWS = [
    ("-Z front", (0.0, 0.0, -1.0)),
    ("+X right", (1.0, 0.0, 0.0)),
    ("+Z back", (0.0, 0.0, 1.0)),
    ("-X left", (-1.0, 0.0, 0.0)),
    ("+Y top", (0.0, 1.0, 0.0)),
    ("iso", (1.0, 1.0, 1.0)),
]


def log(message):
    print("%s %s" % (TAG, message), flush=True)


def die(message):
    print("ERROR: %s" % message, file=sys.stderr, flush=True)
    sys.exit(1)


def script_args():
    """Blender hands the whole command line to the script; ours starts at `--`."""
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def gltf_to_blender(vector):
    """glTF (x, y, z) -> Blender (x, -z, y)."""
    return Vector((vector[0], -vector[2], vector[1]))


def set_if(target, name, value, what):
    """Assign an optional setting, saying so when this Blender lacks it.

    Workbench's shading properties move occasionally between releases; a render
    that silently lost its texture colouring is worse than one that says it did.
    """
    if not hasattr(target, name):
        log("note: this Blender has no %s (%s left at its default)" % (name, what))
        return False
    try:
        setattr(target, name, value)
    except (TypeError, ValueError) as error:
        log("note: %s rejected %r (%s)" % (name, value, error))
        return False
    return True


def import_glb(path):
    if kit.operator_exists("import_scene", "gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
        return "import_scene.gltf"
    if kit.operator_exists("wm", "gltf_import"):
        bpy.ops.wm.gltf_import(filepath=path)
        return "wm.gltf_import"
    die("this Blender has no glTF importer")


def renderable_meshes():
    keep = []
    skipped = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if any(collection.name == NOT_EXPORTED for collection in obj.users_collection):
            skipped += 1
            continue
        keep.append(obj)
    return keep, skipped


def world_bounds(objects):
    low = Vector((float("inf"),) * 3)
    high = Vector((float("-inf"),) * 3)
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                low[axis] = min(low[axis], point[axis])
                high[axis] = max(high[axis], point[axis])
    return low, high


def configure_workbench(scene, size):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    shading = scene.display.shading
    set_if(shading, "light", "STUDIO", "studio lighting")
    set_if(shading, "color_type", "TEXTURE", "textured shading")
    set_if(shading, "show_specular_highlight", True, "specular highlights")
    set_if(shading, "background_type", "VIEWPORT", "flat background")
    set_if(shading, "background_color", (0.06, 0.06, 0.07), "dark neutral background")


def place_camera(camera, centre, corners, direction, radius):
    """Frame the bounding box tightly for one view direction.

    The camera is orthographic, so distance does not change the framing; what
    does is `ortho_scale`, which has to cover the box as PROJECTED onto this
    camera's right/up axes. Using the box diagonal instead would zoom out on
    every view to fit the one worst angle.
    """
    facing = gltf_to_blender(direction).normalized()
    # A Blender camera looks down its local -Z, so its +Z points back at us.
    rotation = facing.to_track_quat("Z", "Y")
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = rotation
    camera.location = centre + facing * (radius * 2.0 + 1.0)

    right = rotation @ Vector((1.0, 0.0, 0.0))
    up = rotation @ Vector((0.0, 1.0, 0.0))
    half_width = max(abs((corner - centre).dot(right)) for corner in corners)
    half_height = max(abs((corner - centre).dot(up)) for corner in corners)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(max(half_width, half_height) * 2.0 * MARGIN, 1e-4)
    camera.data.clip_start = 0.001
    camera.data.clip_end = radius * 6.0 + 10.0


def load_tile(path, size):
    image = bpy.data.images.load(path)
    # Read and write the buffers as raw data: a round trip through sRGB would
    # apply a transform on load and another on save, and darken the sheet.
    image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    if (width, height) != (size, size):
        die("tile %s rendered at %dx%d, expected %dx%d" % (path, width, height, size, size))
    buffer = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(buffer)
    bpy.data.images.remove(image)
    return buffer.reshape(height, width, 4)


def main():
    args = script_args()
    if len(args) < 2:
        die("usage: render_views.py -- <in.glb> <out.png> [size]")
    in_path = os.path.abspath(args[0])
    out_path = os.path.abspath(args[1])
    size = int(args[2]) if len(args) > 2 else DEFAULT_SIZE
    if size < 16:
        die("size must be at least 16, got %d" % size)
    if not os.path.isfile(in_path):
        die("input does not exist: %s" % in_path)

    log("reset to factory settings (empty scene)")
    bpy.ops.wm.read_factory_settings(use_empty=True)

    log("importing %s" % in_path)
    importer = import_glb(in_path)
    log("imported with %s" % importer)

    meshes, skipped = renderable_meshes()
    log("%d mesh object(s) to render, %d skipped from %s" % (len(meshes), skipped, NOT_EXPORTED))
    if not meshes:
        die("no mesh objects after import - nothing to render")

    low, high = world_bounds(meshes)
    centre = (low + high) * 0.5
    extent = high - low
    radius = max(extent.length * 0.5, 1e-3)
    log("world bbox (Blender axes) min %s max %s" % (fmt(low), fmt(high)))

    scene = bpy.context.scene
    configure_workbench(scene, size)
    log("engine BLENDER_WORKBENCH at %dx%d per tile" % (size, size))

    camera_data = bpy.data.cameras.new("lucid_camera")
    camera = bpy.data.objects.new("lucid_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    out_dir = os.path.dirname(out_path) or "."
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(out_path))[0]
    corners = [
        Vector((x, y, z))
        for x in (low.x, high.x)
        for y in (low.y, high.y)
        for z in (low.z, high.z)
    ]

    tiles = []
    tile_paths = []
    try:
        for index, (name, direction) in enumerate(VIEWS):
            place_camera(camera, centre, corners, direction, radius)
            tile_path = os.path.join(out_dir, ".%s-tile-%d.png" % (base, index))
            tile_paths.append(tile_path)
            scene.render.filepath = tile_path
            bpy.ops.render.render(write_still=True)
            if not os.path.isfile(tile_path):
                die("Blender reported success but wrote no tile at %s" % tile_path)
            row, col = divmod(index, COLS)
            log("tile %d/%d %-9s row %d col %d  ortho_scale %.4f  -> %s"
                % (index + 1, len(VIEWS), name, row, col, camera.data.ortho_scale, os.path.basename(tile_path)))
            tiles.append({
                "index": index,
                "name": name,
                "row": row,
                "col": col,
                "cameraDirection": list(direction),
                "orthoScale": round(camera.data.ortho_scale, 6),
            })

        log("compositing %d tiles into a %dx%d sheet" % (len(tiles), COLS * size, ROWS * size))
        sheet = np.zeros((ROWS * size, COLS * size, 4), dtype=np.float32)
        for tile, tile_path in zip(tiles, tile_paths):
            pixels = load_tile(tile_path, size)
            # Blender image rows run bottom-up, so row 0 of the sheet is its bottom.
            y0 = (ROWS - 1 - tile["row"]) * size
            x0 = tile["col"] * size
            sheet[y0:y0 + size, x0:x0 + size] = pixels

        out_image = bpy.data.images.new("lucid_sheet", width=COLS * size, height=ROWS * size, alpha=True)
        out_image.colorspace_settings.name = "Non-Color"
        out_image.pixels.foreach_set(sheet.reshape(-1))
        out_image.file_format = "PNG"
        out_image.filepath_raw = out_path
        out_image.save()
        bpy.data.images.remove(out_image)
        log("wrote %s (%d bytes)" % (out_path, os.path.getsize(out_path)))
    finally:
        # A half-finished sheet must not leave six hidden PNGs in the user's
        # workspace, and a re-run must not composite yesterday's tiles.
        removed = 0
        for tile_path in tile_paths:
            if os.path.isfile(tile_path):
                os.remove(tile_path)
                removed += 1
        log("removed %d intermediate tile(s)" % removed)

    sidecar_path = out_path + ".json"
    sidecar = {
        "sheet": out_path,
        "source": in_path,
        "tileSize": size,
        "cols": COLS,
        "rows": ROWS,
        "axes": "glTF (Y up); each tile name is the direction from the model centre to the camera",
        "meshObjects": len(meshes),
        "skippedNotExported": skipped,
        "bboxBlender": {"min": [round(v, 6) for v in low], "max": [round(v, 6) for v in high]},
        "tiles": tiles,
    }
    with open(sidecar_path, "w", encoding="utf-8") as handle:
        json.dump(sidecar, handle, indent=2)
    log("wrote %s" % sidecar_path)
    log("done")


def fmt(vector):
    return "(%.4f, %.4f, %.4f)" % (vector.x, vector.y, vector.z)


main()
