# Start / finish gantry for the race circuits: an original design.
#
#   python3 scripts/blender/build_start_gantry.py -- assets/generated
#
# Two raked blade pylons stand either side of the road and carry a wedge crossbeam. The beam's front face holds a row of
# start lamps on their own material ('Lamps'), which the game lights through the countdown (red, then green on GO).
# Lit inner edges ('Trim', re-lit in the circuit's accent at runtime) run up each pylon and along the beam, and each
# pylon stands on a plinth with a ground-light line.
#
# Built for an 18 m span between pylon centres; the game scales it uniformly to each track's width. The model is
# symmetric front to back, so riders see the same face arriving and leaving. Three materials, ~3k triangles.
#
# Blender axes: X across the road, -Y along it (glTF +Z), Z up.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from kit import reset, mat, box, prism, tube, apply_all, join

out_dir = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'generated')
os.makedirs(out_dir, exist_ok=True)
reset()
BODY = mat('Body', (0.008, 0.009, 0.012), metallic=0.75, rough=0.3)
TRIM = mat('Trim', (0, 0, 0), emission=(0.3, 0.9, 1.0), strength=1.0)
LAMP = mat('Lamps', (0, 0, 0), emission=(1.0, 0.25, 0.15), strength=1.0)

SPAN, H, BEAM = 18.0, 9.2, 1.5          # pylon centres apart, beam underside height, beam depth (vertical)
DEPTH = 1.4                              # pylon thickness along the road

def pylon(sx):
    """A blade pylon: wide at the foot, narrowing and raking inward to meet the beam. Profile in the X-Z plane, extruded along Y."""
    x0 = sx * SPAN / 2
    # outline, going round: foot outer, foot inner, head inner, head outer (inner edge leans toward the road)
    prof = [(x0 + sx * 1.25, 0.0), (x0 - sx * 0.55, 0.0), (x0 - sx * 0.15, H + BEAM), (x0 + sx * 0.75, H + BEAM)]
    bm = bmesh.new(); a = [bm.verts.new((x, -DEPTH / 2, z)) for x, z in prof]; b = [bm.verts.new((x, DEPTH / 2, z)) for x, z in prof]
    bm.faces.new(a); bm.faces.new(list(reversed(b)))
    for i in range(4): bm.faces.new((a[i], b[i], b[(i + 1) % 4], a[(i + 1) % 4]))
    from kit import _link
    _link('pylon', bm, BODY, bevel=0.06)
    # lit inner edge, on both faces, from the foot to the beam
    for fy in (-1, 1):
        tube('edge', [(x0 - sx * 0.5, fy * (DEPTH / 2 + 0.01), 0.3), (x0 - sx * 0.17, fy * (DEPTH / 2 + 0.01), H)], 0.045, TRIM, res=4, bevel_res=2)
        # three rungs across the face, shorter as the blade narrows
        for k, z in enumerate((2.2, 4.6, 7.0)):
            w = 1.55 - k * 0.32; xi = x0 - sx * (0.48 - z / H * 0.33)
            box('rung', (w, 0.04, 0.09), (xi + sx * w / 2, fy * (DEPTH / 2 + 0.015), z), TRIM)
    # plinth and ground light
    box('plinth', (2.6, DEPTH + 0.9, 0.4), (x0 + sx * 0.35, 0, 0.2), BODY, bevel=0.05)
    for fy in (-1, 1): box('ground', (2.4, 0.05, 0.05), (x0 + sx * 0.35, fy * (DEPTH / 2 + 0.46), 0.38), TRIM)

for sx in (-1, 1): pylon(sx)

# crossbeam: a wedge (deeper at the top), symmetric front and back, spanning past both pylons
L = SPAN + 1.8
prism('beam', [(-0.75, H + BEAM), (0.75, H + BEAM), (0.55, H), (-0.55, H)], -L / 2, L / 2, BODY, bevel=0.05)
for fy in (-1, 1):
    # light lines along the top and bottom edges of each face
    box('beam_top', (L - 0.3, 0.04, 0.06), (0, fy * 0.73, H + BEAM - 0.08), TRIM)
    box('beam_low', (L - 0.6, 0.04, 0.05), (0, fy * 0.57, H + 0.1), TRIM)
    # start lamps: twelve square pods across the middle of the face
    for k in range(12):
        x = (k - 5.5) * 1.05
        box('lamp_back', (0.78, 0.06, 0.62), (x, fy * 0.66, H + BEAM * 0.52), BODY)
        box('lamp', (0.62, 0.04, 0.46), (x, fy * 0.7, H + BEAM * 0.52), LAMP)
# underside light bar, the line riders pass beneath
box('under', (SPAN - 1.0, 0.5, 0.05), (0, 0, H - 0.02), TRIM)

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
path = os.path.join(out_dir, 'start-gantry.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=True)
print('start gantry objects', sorted(o.name for o in bpy.context.collection.objects), 'triangles', tris, 'non-manifold', report, '->', path)
