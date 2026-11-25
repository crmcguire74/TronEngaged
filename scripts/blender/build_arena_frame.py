# Arena frame: one original module the Disc Arena arranges differently per environment (ring of portals, stacked
# columns, tilted rings round the core, a broken lattice, a long colonnade).
#
#   python3 scripts/blender/build_arena_frame.py -- assets/generated
#
# A tall hexagonal portal: six bevelled bars, an inset light strip running round the inside edge, a light node at each
# corner and a foot that plants it. 8 m tall, 5.4 m wide, centred on its base, facing +Z (glTF) so the game can aim it
# at the arena centre. Two materials, 'Body' and 'Trim' (the game re-lights Trim in the environment's accent), so an
# arena of 24 of them is two instanced draws. About 2.2k triangles.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from kit import reset, mat, box, apply_all, join

out_dir = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'generated')
os.makedirs(out_dir, exist_ok=True)
reset()
BODY = mat('Body', (0.01, 0.011, 0.014), metallic=0.6, rough=0.32)
TRIM = mat('Trim', (0, 0, 0), emission=(0.3, 0.9, 1.0), strength=1.0)

# Blender: X right, -Y forward (glTF +Z), Z up. The hexagon stands in the X-Z plane with flats top and bottom.
H, W = 8.0, 5.4
cx, cz = 0.0, H / 2
rx, rz = W / 2, H / 2
corners = [(cx + rx * math.cos(a), cz + rz * math.sin(a)) for a in [math.radians(d) for d in (0, 60, 120, 180, 240, 300)]]

def bar(name, a, b, thick, depth, material, inset=0.0, dy=0.0):
    """A straight bar from corner a to corner b in the X-Z plane, `thick` across and `depth` deep along Y."""
    (x0, z0), (x1, z1) = a, b; mx, mz = (x0 + x1) / 2, (z0 + z1) / 2; L = math.hypot(x1 - x0, z1 - z0); ang = math.atan2(z1 - z0, x1 - x0)
    nx, nz = -(z1 - z0) / L, (x1 - x0) / L  # inward normal (corners run anticlockwise)
    o = box(name, (L + thick * 0.6, depth, thick), (mx + nx * inset, dy, mz + nz * inset), material, rot=(0, -ang, 0), bevel=min(0.05, thick * 0.2)); return o

for i in range(6):
    a, b = corners[i], corners[(i + 1) % 6]
    bar('frame', a, b, 0.34, 0.5, BODY)
    bar('strip', a, b, 0.06, 0.08, TRIM, inset=0.24, dy=-0.25)   # lit inner edge, on the face toward the arena
    bar('strip_b', a, b, 0.04, 0.06, TRIM, inset=0.24, dy=0.25)  # and a dimmer one on the back
for (x, z) in corners:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.2, location=(x, -0.27, z)); n = bpy.context.active_object; n.data.materials.append(TRIM); n.select_set(False)
# foot: a low plinth under the bottom flat, with a light line along its top edge
box('foot', (W * 0.62, 1.1, 0.35), (0, 0, 0.175), BODY, bevel=0.04)
box('foot_line', (W * 0.58, 0.05, 0.04), (0, -0.56, 0.33), TRIM)

apply_all()
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); bpy.ops.object.select_all(action='DESELECT')
groups = {}
for o in list(bpy.context.collection.objects): groups.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in groups.items(): join(objs, name)
bad = 0
for o in bpy.context.collection.objects:
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()
tris = sum(len(p.vertices) - 2 for o in bpy.context.collection.objects for p in o.data.polygons)
path = os.path.join(out_dir, 'arena-frame.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=True)
print('arena frame objects', sorted(o.name for o in bpy.context.collection.objects), 'triangles', tris, '->', path)
