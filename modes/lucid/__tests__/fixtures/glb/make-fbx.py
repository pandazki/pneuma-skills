"""make-fbx.py - turn a fixture GLB into an FBX, so `convert` has an input.

Used only by the live tier of `blender.test.ts`, through
`blender.mjs run <this file> -- <in.glb> <out.fbx>`. An FBX is a binary format
nobody can write by hand and this repository keeps no binary fixtures, so the
one Blender in the loop makes its own input.

Textures are embedded (`path_mode='COPY'`, `embed_textures=True`) on purpose:
that is what makes the importer unpack a `<name>.fbm/` directory next to
whatever it reads, which is the behaviour `fbx_to_glb.py` stages a temp copy
to contain.
"""

import os
import sys

import bpy


def operator_exists(module, name):
    """`bpy.ops` resolves lazily, so hasattr() answers True for every name."""
    return hasattr(bpy.types, "%s_OT_%s" % (module.upper(), name))


def die(message):
    print("ERROR: %s" % message, file=sys.stderr, flush=True)
    sys.exit(1)


args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 2:
    die("usage: make-fbx.py -- <in.glb> <out.fbx>")

source = os.path.abspath(args[0])
target = os.path.abspath(args[1])

bpy.ops.wm.read_factory_settings(use_empty=True)
if not operator_exists("import_scene", "gltf"):
    die("this Blender has no glTF importer")
bpy.ops.import_scene.gltf(filepath=source)
print("[make-fbx] imported %s" % source, flush=True)

if not operator_exists("export_scene", "fbx"):
    die("this Blender has no FBX exporter")
os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
bpy.ops.export_scene.fbx(filepath=target, path_mode="COPY", embed_textures=True)
if not os.path.isfile(target):
    die("the exporter wrote no file at %s" % target)
print("[make-fbx] wrote %s (%d bytes)" % (target, os.path.getsize(target)), flush=True)
