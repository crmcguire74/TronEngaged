# "Blade": the player's machine seen from outside, built to the same dimensions as cockpit v5, so the chase view and
# the cockpit view are one machine. An original design.
#
#   python3 scripts/blender/build_cycle_blade.py -- assets/generated
#
# Silhouette, front to back: a blade nose that runs through a hubless front ring; a long low cowl with a lit spine and
# lit shoulders; side fairings over the rider's legs; a belly keel between the rings with a ground-light strip along
# its foot; swing arms to a hubless rear ring; a tail that lifts slightly and ends in a light bar.
#
# Game hooks (src/games/cycles/view.ts):
#   - 'Trim' parts are re-lit in the rider's colour at runtime
#   - 'WheelF' / 'WheelR' carry a `radius` extra, and are spun by distance travelled
#   - the seat sits where the game puts the rider's eye (EYE: 1.27 m up, 0.2 m back)
# Budget: about 14k triangles in 8 draw calls (the supplied machines use 20-25).
#
# Checks before export (see the 3d-modeling validations): transforms applied, normals recalculated outward, doubles
# merged, n-gons triangulated by the exporter, and non-manifold edges counted and reported.
#
# Blender axes: X right, -Y forward, Z up (glTF: x right, y up, z forward).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from kit import reset, mat, loft, tube, torus, box, prism, apply_all, join

out_dir = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'generated')
os.makedirs(out_dir, exist_ok=True)
reset()

BODY = mat('Body', (0.006, 0.006, 0.008), metallic=0.45, rough=0.3)
SATIN = mat('Satin', (0.014, 0.015, 0.018), metallic=0.5, rough=0.6)
TRIM = mat('Trim', (0, 0, 0), emission=(0.3, 0.9, 1.0), strength=1.0)
TYRE = mat('Tyre', (0.008, 0.009, 0.011), metallic=0.3, rough=0.4)

# ---------------------------------------------------------------- cowl: identical stations to cockpit v5
COWL = [(0.02, 0.27, 0.90, 0.56), (-0.22, 0.33, 0.985, 0.52), (-0.55, 0.31, 0.985, 0.5), (-0.9, 0.245, 0.91, 0.5),
        (-1.22, 0.17, 0.81, 0.52), (-1.55, 0.095, 0.71, 0.56), (-1.86, 0.035, 0.645, 0.6), (-1.98, 0.008, 0.625, 0.615)]
loft('cowl', COWL, BODY, n=20, power=3.2, subsurf=1)
def top_at(y):
    for (y0, w0, t0, _), (y1, w1, t1, _) in zip(COWL, COWL[1:]):
        if y1 <= y <= y0: k = (y - y0) / (y1 - y0); return t0 + (t1 - t0) * k, w0 + (w1 - w0) * k
    return COWL[-1][2], COWL[-1][1]
tube('spine', [(0, y, top_at(y)[0] + 0.004) for y in [-0.3, -0.7, -1.1, -1.45, -1.7, -1.92]], 0.007, TRIM, res=10, bevel_res=2)
for sx in (-1, 1):
    pts = []
    for y in [-0.05, -0.4, -0.75, -1.1, -1.45, -1.78, -1.95]:
        t, w = top_at(y); pts.append((sx * (w * 0.93 + 0.004), y, t - (t - 0.5) * 0.34))
    tube('shoulder', pts, 0.008, TRIM, res=10, bevel_res=2)
# nose slit: a short bar of light across the blade tip, the machine's "face" from the front
box('nose', (0.05, 0.03, 0.012), (0, -1.97, 0.63), TRIM)

# ---------------------------------------------------------------- side fairings and the rider's grips
for sx in (-1, 1):
    x0, x1 = sorted((sx * 0.39, sx * 0.45))
    prism('fairing', [(-0.55, 0.62), (-0.35, 0.84), (0.35, 0.88), (0.85, 0.8), (0.95, 0.6), (0.6, 0.42), (-0.3, 0.42)], x0, x1, BODY, bevel=0.008)
    tube('fair_line', [(sx * 0.457, -0.5, 0.65), (sx * 0.459, -0.33, 0.845), (sx * 0.459, 0.35, 0.885), (sx * 0.459, 0.84, 0.805)], 0.008, TRIM, res=10, bevel_res=2)
    tube('fair_low', [(sx * 0.457, -0.25, 0.47), (sx * 0.457, 0.55, 0.47)], 0.006, TRIM, res=4, bevel_res=2)
    tube('grip', [(sx * 0.38, -0.36, 0.97), (sx * 0.41, -0.315, 0.966), (sx * 0.44, -0.27, 0.96)], 0.02, SATIN, res=6, bevel_res=2)
    tube('strut', [(sx * 0.27, -0.42, 0.9), (sx * 0.33, -0.4, 0.94), (sx * 0.375, -0.37, 0.965)], 0.014, SATIN, res=6, bevel_res=2)

# ---------------------------------------------------------------- belly keel between the rings, with a ground light
loft('keel', [(-0.95, 0.16, 0.52, 0.2), (-0.4, 0.22, 0.5, 0.16), (0.3, 0.22, 0.5, 0.16), (0.85, 0.16, 0.52, 0.22)], SATIN, n=14, power=3.0, subsurf=1)
for sx in (-1, 1): tube('ground_line', [(sx * 0.215, -0.75, 0.2), (sx * 0.225, -0.1, 0.17), (sx * 0.225, 0.5, 0.17), (sx * 0.21, 0.8, 0.22)], 0.007, TRIM, res=8, bevel_res=2)

# ---------------------------------------------------------------- seat and tail
box('seat', (0.36, 0.7, 0.07), (0, 0.42, 0.66), SATIN, bevel=0.02)
loft('tail', [(0.6, 0.24, 0.84, 0.55), (1.0, 0.2, 0.88, 0.6), (1.45, 0.12, 0.84, 0.66), (1.8, 0.03, 0.8, 0.74)], BODY, n=16, power=3.0, subsurf=1)
tube('tail_line', [(0, 0.62, 0.85), (0, 1.1, 0.885), (0, 1.5, 0.845), (0, 1.79, 0.802)], 0.006, TRIM, res=8, bevel_res=2)
box('tail_bar', (0.2, 0.02, 0.03), (0, 1.8, 0.77), TRIM)

# ---------------------------------------------------------------- rings: hubless, with forks and swing arms to the bearing races
def ring(name, centre, width):
    parts = [torus(name, 0.52, 0.05, centre, TYRE, width=width, seg=72, ring=10)]
    for k in range(12):
        a = 2 * math.pi * k / 12; parts.append(box('tread', (0.05 * width * 2.5, 0.05, 0.018), (0, centre[1] + math.sin(a) * 0.565, centre[2] + math.cos(a) * 0.565), SATIN, rot=(-a, 0, 0)))
    return parts
FR, RR = (0, -1.45, 0.53), (0, 1.3, 0.53)
front, rear = ring('tyreF', FR, 1.3), ring('tyreR', RR, 1.6)
for c in (FR, RR):
    torus('glow_in', 0.458, 0.011, c, TRIM, seg=72, ring=6)
    for sx in (-1, 1): torus('glow_side', 0.52, 0.009, (sx * 0.07, c[1], c[2]), TRIM, seg=72, ring=6)
for sx in (-1, 1):
    tube('fork', [(sx * 0.2, -0.95, 0.7), (sx * 0.16, -1.15, 0.58), (sx * 0.13, -1.32, 0.42), (sx * 0.12, FR[1] + 0.2, FR[2] - 0.42)], 0.032, SATIN, res=8, bevel_res=2)
    tube('swing', [(sx * 0.2, 0.75, 0.3), (sx * 0.17, 1.0, 0.22), (sx * 0.14, RR[1] - 0.2, RR[2] - 0.42)], 0.034, SATIN, res=8, bevel_res=2)

# ---------------------------------------------------------------- checks, then export: one mesh per material, wheels kept
def keep(objs, name, pivot):
    o = join(objs, name); bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.context.scene.cursor.location = pivot; bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); o.select_set(False); return o

apply_all()
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); bpy.ops.object.select_all(action='DESELECT')
keep(front, 'WheelF', FR); keep(rear, 'WheelR', RR)
groups = {}
for o in list(bpy.context.collection.objects):
    if o.name in ('WheelF', 'WheelR'): continue
    groups.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in groups.items(): join(objs, name)
report = {}
for o in bpy.context.collection.objects:
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    report[o.name] = sum(1 for e in bm.edges if not e.is_manifold); bm.to_mesh(o.data); bm.free()
bpy.data.objects['WheelF']['radius'] = 0.57; bpy.data.objects['WheelR']['radius'] = 0.57
tris = sum(len(p.vertices) - 2 for o in bpy.context.collection.objects for p in o.data.polygons)
path = os.path.join(out_dir, 'cycle-blade.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=True, export_extras=True)
print('cycle blade objects', sorted(o.name for o in bpy.context.collection.objects), 'triangles', tris, 'non-manifold edges', report, '->', path)
