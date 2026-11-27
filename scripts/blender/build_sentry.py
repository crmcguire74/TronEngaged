# Track sentry: the race hazard (static, or a sweeper that slides across the lane). An original design.
#
#   python3 scripts/blender/build_sentry.py -- assets/generated
#
# A hovering defence drone that reads as "do not touch" from 100 m: a flat octagonal hull with a lit red waist ring,
# four swept fins that hang toward the road with red tips, a dark dome on top with a red slit, and a lens underneath
# that the game turns into a scan pool on the road. Radially symmetric, so it can turn slowly in place without ever
# looking like it is tumbling. About 2.6 m across, origin on the road under its centre, hull at 1.3 m.
#
# Materials: 'Body' (dark metal), 'Trim' (red, unlit at runtime), 'Lens' (the hot core). ~1.4k triangles.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from kit import reset, mat, frustum, box, torus, apply_all, join, _link

out_dir = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'generated')
os.makedirs(out_dir, exist_ok=True)
reset()
BODY = mat('Body', (0.01, 0.009, 0.01), metallic=0.8, rough=0.28)
TRIM = mat('Trim', (0, 0, 0), emission=(1.0, 0.12, 0.06), strength=1.0)
LENS = mat('Lens', (0, 0, 0), emission=(1.0, 0.55, 0.3), strength=1.0)
Z = 1.3   # hull centre height

# hull: two octagonal frustums meeting at a sharp waist
frustum('hull_top', 1.3, 0.75, Z, Z + 0.42, BODY, sides=8, turn=math.pi / 8)
frustum('hull_bot', 0.8, 1.3, Z - 0.34, Z, BODY, sides=8, turn=math.pi / 8)
# lit waist ring just proud of the hull edge
torus('waist', 1.33, 0.045, (0, 0, Z), TRIM, seg=32, ring=6, flat=True)
# dome with a slit visor
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.55, location=(0, 0, Z + 0.42)); d = bpy.context.active_object
for v in d.data.vertices:
    if v.co.z < 0: v.co.z = 0
d.data.materials.append(BODY); d.select_set(False)
torus('visor', 0.5, 0.03, (0, 0, Z + 0.62), TRIM, seg=24, ring=4, flat=True)
# four swept fins hanging toward the road, each with a red tip
for k in range(4):
    a = k * math.pi / 2 + math.pi / 4; c, s = math.cos(a), math.sin(a)
    bm = bmesh.new()
    # fin profile in its own radial plane: from the hull underside, out and down
    prof = [(0.7, Z - 0.2), (1.15, Z - 0.1), (1.55, Z - 0.85), (1.4, Z - 0.95)]
    th = 0.05; vs = []
    for side in (-1, 1):
        for r, z in prof: vs.append(bm.verts.new((c * r - s * th * side, s * r + c * th * side, z)))
    n = len(prof); bm.faces.new(vs[:n]); bm.faces.new(list(reversed(vs[n:])))
    for i in range(n): bm.faces.new((vs[i], vs[n + i], vs[n + (i + 1) % n], vs[(i + 1) % n]))
    _link('fin', bm, BODY)
    box('tip', (0.12, 0.12, 0.12), (c * 1.48, s * 1.48, Z - 0.92), TRIM, rot=(0, 0, a))
# underside lens: a short cylinder with a hot core
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.32, depth=0.12, location=(0, 0, Z - 0.38)); l = bpy.context.active_object; l.data.materials.append(LENS); l.select_set(False)

apply_all()
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); bpy.ops.object.select_all(action='DESELECT')
groups = {}
for o in list(bpy.context.collection.objects): groups.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in groups.items(): join(objs, name)
report = {}
for o in bpy.context.collection.objects:
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    report[o.name] = sum(1 for e in bm.edges if not e.is_manifold); bm.to_mesh(o.data); bm.free()
tris = sum(len(p.vertices) - 2 for o in bpy.context.collection.objects for p in o.data.polygons)
path = os.path.join(out_dir, 'sentry.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=True)
print('sentry objects', sorted(o.name for o in bpy.context.collection.objects), 'triangles', tris, 'non-manifold', report, '->', path)
