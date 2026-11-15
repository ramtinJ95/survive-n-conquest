"""Converts the models that assets/models.json names from the purchased packs into one file the game loads.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/convert-models.py -- <assets-source> [<out.glb>]

<assets-source> holds one folder per pack, with the FBX files in models/ and the palette texture in textures/.
The output defaults to game-assets/public/models.glb. Neither the packs nor the output may be committed to this
repository: their licence forbids redistribution.

Each model becomes one mesh named after its key in the manifest. Its palette texture is baked into one color per
face, so the file holds no texture and the game shades the models like everything else it draws. The mesh is
turned by `turn` degrees about Blender's x, y and z axes, stretched by the `stretch` factors along them, scaled
until its longest side is `size` meters, and moved to stand on the origin, centered on its footprint. `triangles`
thins a model that is too heavy to draw thousands of times. `paint` gives the whole model one color of the game's
own palette in place of the pack's.
"""
import json
import math
import os
import sys

import bpy
import numpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[sys.argv.index("--") + 1:]
source = args[0]
out = os.path.abspath(args[1]) if len(args) > 1 else os.path.join(ROOT, "game-assets", "public", "models.glb")
with open(os.path.join(ROOT, "assets", "models.json")) as file:
    manifest = json.load(file)

palettes = {}


def palette(pack):
    if pack not in palettes:
        image = bpy.data.images.load(os.path.join(source, pack, "textures", manifest["packs"][pack]))
        width, height = image.size
        pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
        palettes[pack] = pixels.reshape(height, width, 4)
    return palettes[pack]


def imported(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"{path} holds no mesh")
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.data.transform(obj.matrix_world)
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    for other in [o for o in bpy.data.objects if o not in before and o is not obj]:
        bpy.data.objects.remove(other)
    return obj


def bake(mesh, pixels):
    height, width, _ = pixels.shape
    uv = mesh.uv_layers.active.data
    colors = mesh.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for face in mesh.polygons:
        u = sum(uv[i].uv.x for i in face.loop_indices) / face.loop_total
        v = sum(uv[i].uv.y for i in face.loop_indices) / face.loop_total
        r, g, b, _ = pixels[min(int((v % 1) * height), height - 1), min(int((u % 1) * width), width - 1)]
        for i in face.loop_indices:
            colors.data[i].color_srgb = (r, g, b, 1)
    mesh.color_attributes.active_color = colors
    mesh.color_attributes.render_color_index = mesh.color_attributes.find("Color")
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    mesh.materials.clear()


def thin(obj, triangles):
    mesh = obj.data
    mesh.calc_loop_triangles()
    modifier = obj.modifiers.new("thin", "DECIMATE")
    modifier.ratio = triangles / len(mesh.loop_triangles)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    colors = obj.data.color_attributes["Color"].data
    for face in obj.data.polygons:
        mean = [sum(colors[i].color_srgb[c] for i in face.loop_indices) / face.loop_total for c in range(3)]
        for i in face.loop_indices:
            colors[i].color_srgb = (*mean, 1)


def paint(mesh, hex_color):
    red, green, blue = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    for corner in mesh.color_attributes["Color"].data:
        corner.color_srgb = (red, green, blue, 1)


def stand(mesh, turn, stretch, size):
    mesh.transform(Euler([math.radians(angle) for angle in turn]).to_matrix().to_4x4())
    mesh.transform(Matrix.Diagonal((*stretch, 1)))
    corners = [vertex.co for vertex in mesh.vertices]
    lo = Vector([min(c[axis] for c in corners) for axis in range(3)])
    hi = Vector([max(c[axis] for c in corners) for axis in range(3)])
    scale = size / max(hi - lo)
    mesh.transform(Matrix.Scale(scale, 4) @ Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    return (hi - lo) * scale


bpy.ops.wm.read_factory_settings(use_empty=True)
for name, model in manifest["models"].items():
    obj = imported(os.path.join(source, model["pack"], "models", model["model"] + ".fbx"))
    bake(obj.data, palette(model["pack"]))
    if "triangles" in model:
        thin(obj, model["triangles"])
    if "paint" in model:
        paint(obj.data, model["paint"])
    extent = stand(obj.data, model.get("turn", (0, 0, 0)), model.get("stretch", (1, 1, 1)), model["size"])
    obj.name = obj.data.name = name
    obj.data.calc_loop_triangles()
    print(
        f"MODEL {name}: {model['pack']}/{model['model']}, {len(obj.data.loop_triangles)} triangles, "
        f"{extent.x:.2f} m wide, {extent.y:.2f} m deep, {extent.z:.2f} m tall"
    )

os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_materials="NONE",
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_normals=False,
    export_texcoords=False,
    export_animations=False,
    export_skins=False,
    export_morph=False,
)
print(f"WROTE {out}, {os.path.getsize(out)} bytes")
