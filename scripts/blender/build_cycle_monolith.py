# "Monolith": an enclosed-shell light cycle, an original design in the direction of the modern film machines (a
# single smooth shell over both wheels, light rings glowing through its flanks, one long strip down each side, the
# rider low and prone on top).
#
#   python3 scripts/blender/build_cycle_monolith.py -- assets/generated
#
# Silhouette, front to back: a rounded nose that rises into a tall front cowl over the front wheel; a waist that dips
# where the rider's chest and knees go; a second tall cowl over the rear wheel; a short tail. The wheels sit inside
# the shell and show as lit rings set into each flank, the way the reference machines read from the side.
#
# Game hooks (src/games/cycles/view.ts): 'Trim' is re-lit in the rider's colour; 'WheelF' / 'WheelR' carry a radius
# and are spun by distance travelled (here they are the inner tyres, seen through the side rings).
# About 9k triangles, one mesh per material plus the two wheels.
#
# Blender axes: X right, -Y forward, Z up (glTF: x right, y up, z forward).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from kit import reset, mat, loft, tube, torus, box, apply_all, join

out_dir = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'generated')
os.makedirs(out_dir, exist_ok=True)
reset()
BODY = mat('Body', (0.007, 0.0075, 0.009), metallic=0.55, rough=0.24)
SATIN = mat('Satin', (0.016, 0.017, 0.02), metallic=0.5, rough=0.55)
TRIM = mat('Trim', (0, 0, 0), emission=(0.3, 0.9, 1.0), strength=1.0)
TYRE = mat('Tyre', (0.008, 0.009, 0.011), metallic=0.3, rough=0.4)

FR, RR, WR = (0, -1.18, 0.6), (0, 1.16, 0.6), 0.58   # wheel centres and radius

# ---------------------------------------------------------------- the shell: one loft from nose to tail
# (y, half width, top, bottom). The two cowls stand over the wheels; the waist between them is where the rider lies.
SHELL = [(-1.98, 0.06, 0.70, 0.52), (-1.86, 0.22, 0.98, 0.26), (-1.62, 0.33, 1.18, 0.1), (-1.25, 0.37, 1.24, 0.06),
         (-0.86, 0.36, 1.16, 0.07), (-0.5, 0.31, 0.9, 0.12), (-0.1, 0.29, 0.82, 0.14), (0.3, 0.31, 0.88, 0.13),
         (0.72, 0.37, 1.12, 0.07), (1.12, 0.39, 1.22, 0.06), (1.5, 0.35, 1.14, 0.1), (1.78, 0.24, 0.96, 0.24), (1.92, 0.07, 0.78, 0.46)]
loft('shell', SHELL, BODY, n=24, power=3.4, subsurf=1)
def side_at(y):
    for (y0, w0, t0, b0), (y1, w1, t1, b1) in zip(SHELL, SHELL[1:]):
        if y0 <= y <= y1: k = (y - y0) / (y1 - y0); return w0 + (w1 - w0) * k, t0 + (t1 - t0) * k, b0 + (b1 - b0) * k
    return SHELL[-1][1], SHELL[-1][2], SHELL[-1][3]

# ---------------------------------------------------------------- light: rings in the flanks, a long strip, a spine
for c in (FR, RR):
    for sx in (-1, 1):
        w, _, _ = side_at(c[1])
        torus('flank_ring', WR * 0.86, 0.022, (sx * (w + 0.004), c[1], c[2]), TRIM, seg=64, ring=6)
        torus('flank_ring_in', WR * 0.6, 0.012, (sx * (w + 0.004), c[1], c[2]), TRIM, seg=48, ring=5)
        torus('hub_cap', 0.12, 0.04, (sx * (w + 0.002), c[1], c[2]), SATIN, seg=24, ring=6)
for sx in (-1, 1):
    # the long strip runs low along each flank from cowl to cowl, under the rider's knees
    pts = []
    for y in [-1.7, -1.3, -0.8, -0.3, 0.2, 0.7, 1.2, 1.62]:
        w, t, b = side_at(y); pts.append((sx * (w * 0.985 + 0.006), y, b + (t - b) * 0.32))
    tube('flank_strip', pts, 0.011, TRIM, res=12, bevel_res=2)
    # a short upper accent on each cowl
    for y0, y1 in ((-1.55, -0.95), (0.85, 1.42)):
        pts = []
        for y in [y0, (y0 + y1) / 2, y1]:
            w, t, b = side_at(y); pts.append((sx * (w * 0.9 + 0.004), y, t - (t - b) * 0.16))
        tube('cowl_line', pts, 0.008, TRIM, res=10, bevel_res=2)
tube('spine', [(0, y, side_at(y)[1] + 0.004) for y in [-1.78, -1.4, -1.0, -0.6]], 0.007, TRIM, res=10, bevel_res=2)
tube('spine_r', [(0, y, side_at(y)[1] + 0.004) for y in [0.6, 1.0, 1.4, 1.75]], 0.007, TRIM, res=10, bevel_res=2)
box('nose_bar', (0.16, 0.02, 0.014), (0, -1.975, 0.66), TRIM)
box('tail_bar', (0.2, 0.02, 0.024), (0, 1.925, 0.72), TRIM)

# ---------------------------------------------------------------- where the rider touches it: grips and foot pegs
for sx in (-1, 1):
    tube('grip', [(sx * 0.24, -0.95, 1.12), (sx * 0.3, -0.86, 1.1), (sx * 0.36, -0.78, 1.07)], 0.022, SATIN, res=6, bevel_res=2)
    box('peg', (0.12, 0.16, 0.04), (sx * 0.34, 0.68, 0.5), SATIN, bevel=0.01)
box('saddle', (0.34, 0.7, 0.05), (0, 0.18, 0.86), SATIN, bevel=0.02)

# ---------------------------------------------------------------- wheels inside the shell (spun by the game)
def wheel(name, centre):
    return [torus(name, 0.5, 0.08, centre, TYRE, width=1.4, seg=48, ring=8), torus('glow', 0.42, 0.012, centre, TRIM, seg=48, ring=4)]
front, rear = wheel('tyreF', FR), wheel('tyreR', RR)

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
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    report[o.name] = sum(1 for e in bm.edges if not e.is_manifold); bm.to_mesh(o.data); bm.free()
bpy.data.objects['WheelF']['radius'] = WR; bpy.data.objects['WheelR']['radius'] = WR
tris = sum(len(p.vertices) - 2 for o in bpy.context.collection.objects for p in o.data.polygons)
path = os.path.join(out_dir, 'cycle-monolith.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=True, export_extras=True)
print('cycle monolith objects', sorted(o.name for o in bpy.context.collection.objects), 'triangles', tris, 'non-manifold', report, '->', path)
