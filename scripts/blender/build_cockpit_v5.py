# Cockpit v5: "Blade". An original ring-wheel cockpit built for a headset first and a monitor second.
#
#   python3 scripts/blender/build_cockpit_v5.py -- assets/generated
#
# The rider lies forward over a long, low cowl that narrows to a blade and runs straight through a hubless front ring.
# What you see from the seat, from the middle of the view outwards:
#   - the ring's top arc sitting just under the horizon, with the blade nose piercing it: a fixed frame for speed
#   - a single light line down the cowl's spine that points at the road ahead
#   - a slim instrument hood carrying the live display, two holo gauges and the light-wall lamps
#   - prone grips on short struts either side of the cowl (they roll with the steering)
#   - swept side fairings with lit top edges in the lower periphery, so the machine wraps around you
#   - a rear ring and tail, for anyone who looks back over a shoulder
# Budget: about 14k triangles in nine draw calls. No canopy glass and no clear-coat: in a headset the cockpit covers a
# large part of every frame, so layered transparency and second lighting lobes there are paid for on every pixel.
#
# Blender axes: X right, -Y forward, Z up (glTF: x right, y up, z forward). The rider's eye is at Blender
# (0, 0.2, 1.27), the same point the game uses (EYE in src/games/cycles/view.ts).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from kit import reset, mat, loft, tube, torus, box, prism, apply_all, join

out_dir = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'generated')
os.makedirs(out_dir, exist_ok=True)
reset()

BODY = mat('Body', (0.004, 0.004, 0.005), metallic=0.2, rough=0.16)
SATIN = mat('Satin', (0.012, 0.013, 0.016), metallic=0.5, rough=0.62)
TRIM = mat('Trim', (0, 0, 0), emission=(0.3, 0.9, 1.0), strength=1.0)
RUBBER = mat('Rubber', (0.02, 0.02, 0.022), rough=0.75)
TYRE = mat('Tyre', (0.008, 0.009, 0.011), metallic=0.3, rough=0.4)
SCREEN = mat('Screen', (0.02, 0.05, 0.07), emission=(0.1, 0.3, 0.4), strength=0.5)
LAMP = mat('WallLamp', (0.1, 0.12, 0.15), emission=(0.1, 0.14, 0.2), strength=0.4)
DIAL = mat('Dial', (0, 0, 0))

# ---------------------------------------------------------------- cowl: a tapered blade from the rider's chest to the nose
COWL = [  # (y, half width, top, bottom)
    (0.02, 0.27, 0.90, 0.56), (-0.22, 0.33, 0.985, 0.52), (-0.55, 0.31, 0.985, 0.5), (-0.9, 0.245, 0.91, 0.5),
    (-1.22, 0.17, 0.81, 0.52), (-1.55, 0.095, 0.71, 0.56), (-1.86, 0.035, 0.645, 0.6), (-1.98, 0.008, 0.625, 0.615)]
loft('cowl', COWL, BODY, n=20, power=3.2, subsurf=1)

def top_at(y):
    """Interpolated cowl top height and half width at a given Y (for laying lines on the surface)."""
    for (y0, w0, t0, _), (y1, w1, t1, _) in zip(COWL, COWL[1:]):
        if y1 <= y <= y0:
            k = (y - y0) / (y1 - y0); return t0 + (t1 - t0) * k, w0 + (w1 - w0) * k
    return COWL[-1][2], COWL[-1][1]

# the spine line: one bright stroke down the middle of the cowl that leads the eye to the road
spine = [(0, y, top_at(y)[0] + 0.004) for y in [-0.7, -0.95, -1.2, -1.45, -1.7, -1.92]]
tube('spine', spine, 0.0055, TRIM, res=10, bevel_res=2)
# shoulder lines: each side, two-thirds up the flank, from the grips to the nose
for sx in (-1, 1):
    pts = []
    for y in [-0.12, -0.4, -0.75, -1.1, -1.45, -1.78, -1.95]:
        t, w = top_at(y); pts.append((sx * (w * 0.93 + 0.004), y, t - (t - 0.5) * 0.34))
    tube('shoulder', pts, 0.006, TRIM, res=10, bevel_res=2)

# ---------------------------------------------------------------- instrument hood, display, gauges and lamps
# a low wedge on the cowl ahead of the grips; its rear face leans back towards the eye and carries the display
hood = prism('hood', [(-0.26, 0.97), (-0.3, 0.995), (-0.46, 0.995), (-0.55, 0.975)], -0.24, 0.24, BODY, bevel=0.01)
tube('hood_lip', [(-0.235, -0.3, 0.998), (0, -0.302, 1.0), (0.235, -0.3, 0.998)], 0.004, TRIM, res=6, bevel_res=2)

def quad(name, centre, half_w, half_h, material, eye=(0, 0.2, 1.27)):
    """A flat panel centred at `centre`, turned to face the eye, with 0..1 UVs (u left to right, v bottom to top as seen)."""
    cx, cy, cz = centre; nx, ny, nz = eye[0] - cx, eye[1] - cy, eye[2] - cz; l = math.sqrt(nx * nx + ny * ny + nz * nz); n = (nx / l, ny / l, nz / l)
    r = (1, 0, 0); u = (r[1] * n[2] - r[2] * n[1], r[2] * n[0] - r[0] * n[2], r[0] * n[1] - r[1] * n[0])  # up = right x normal
    u = (-u[0], -u[1], -u[2]) if u[2] < 0 else u
    # wound so the front face looks at the eye: right, then up, is clockwise seen from the eye's side, so go the other way
    corners = [(-1, -1), (-1, 1), (1, 1), (1, -1)]
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap'); vs = []
    for sx, sy in corners:
        vs.append(bm.verts.new((cx + r[0] * sx * half_w + u[0] * sy * half_h, cy + r[1] * sx * half_w + u[1] * sy * half_h, cz + r[2] * sx * half_w + u[2] * sy * half_h)))
    f = bm.faces.new(vs)
    for loop, (sx, sy) in zip(f.loops, corners): loop[uv].uv = ((1 - sx) / 2, (1 - sy) / 2)  # glTF flips V on export, and the panel is seen from its back-to-front axis
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); o.data.materials.append(material); return o

# the display is a holographic pane standing on the hood lip (2:1, the HUD canvas's shape), low enough to stay under the
# horizon; the gauges flank it, and the game turns them to face the eye
quad('Screen', (0, -0.335, 1.032), 0.1, 0.05, SCREEN)
quad('DialL', (-0.185, -0.31, 1.012), 0.034, 0.034, DIAL)
quad('DialR', (0.185, -0.31, 1.012), 0.034, 0.034, DIAL)
for sx in (-1, 1): box('lamp', (0.026, 0.02, 0.01), (sx * 0.258, -0.36, 0.995), LAMP, bevel=0.003)

# ---------------------------------------------------------------- grips: prone bars on short struts, rolled as one 'Yoke'
yoke = []
for sx in (-1, 1):
    a, b = (sx * 0.38, -0.36, 0.97), (sx * 0.44, -0.27, 0.96)  # inboard-front and outboard-rear ends (see GRIPS in view.ts)
    yoke.append(tube('grip', [a, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + 0.002), b], 0.019, RUBBER, res=8, bevel_res=3))
    yoke.append(tube('strut', [(sx * 0.27, -0.42, 0.9), (sx * 0.33, -0.4, 0.94), (sx * 0.375, -0.37, 0.965)], 0.013, SATIN, res=6, bevel_res=2))
    yoke.append(tube('end', [(sx * 0.44, -0.27, 0.96), (sx * 0.452, -0.255, 0.958)], 0.022, TRIM, res=4, bevel_res=2))
yoke.append(tube('cross', [(-0.27, -0.42, 0.9), (0, -0.44, 0.88), (0.27, -0.42, 0.9)], 0.016, SATIN, res=6, bevel_res=2))

# ---------------------------------------------------------------- front ring: hubless, the blade runs straight through it
FR = (0, -1.45, 0.53)
front = [torus('tyreF', 0.52, 0.05, FR, TYRE, width=1.3, seg=72, ring=10)]
for k in range(12):  # tread blocks, so the spin reads even though the ring is round
    a = 2 * math.pi * k / 12; front.append(box('tread', (0.13, 0.05, 0.018), (0, FR[1] + math.sin(a) * 0.565, FR[2] + math.cos(a) * 0.565), SATIN, rot=(-a, 0, 0)))
torus('glowF_in', 0.458, 0.011, FR, TRIM, seg=72, ring=6)
for sx in (-1, 1): torus('glowF_side', 0.52, 0.009, (sx * 0.068, FR[1], FR[2]), TRIM, seg=72, ring=6)
torus('glowF_out', 0.572, 0.006, FR, TRIM, seg=72, ring=6)
# fork blades: from the cowl flanks down and forward to the ring's bearing race
for sx in (-1, 1):
    tube('fork', [(sx * 0.2, -0.95, 0.7), (sx * 0.16, -1.15, 0.58), (sx * 0.13, -1.32, 0.42), (sx * 0.12, FR[1] + 0.2, FR[2] - 0.42)], 0.03, SATIN, res=8, bevel_res=2)

# ---------------------------------------------------------------- side fairings: in the lower periphery, either side of the hips
for sx in (-1, 1):
    x0, x1 = sorted((sx * 0.39, sx * 0.45))
    prism('fairing', [(-0.55, 0.62), (-0.35, 0.84), (0.35, 0.88), (0.85, 0.8), (0.95, 0.6), (0.6, 0.42), (-0.3, 0.42)], x0, x1, BODY, bevel=0.008)
    tube('fair_line', [(sx * 0.455, -0.5, 0.65), (sx * 0.457, -0.33, 0.845), (sx * 0.457, 0.35, 0.885), (sx * 0.457, 0.84, 0.805)], 0.006, TRIM, res=10, bevel_res=2)
    tube('fair_low', [(sx * 0.455, -0.25, 0.47), (sx * 0.455, 0.55, 0.47)], 0.004, TRIM, res=4, bevel_res=2)

# ---------------------------------------------------------------- seat, tail and rear ring
box('seat', (0.36, 0.7, 0.07), (0, 0.42, 0.66), SATIN, bevel=0.02)
loft('tail', [(0.6, 0.24, 0.84, 0.55), (1.0, 0.2, 0.86, 0.6), (1.45, 0.12, 0.8, 0.66), (1.75, 0.03, 0.74, 0.7)], BODY, n=16, power=3.0, subsurf=1)
tube('tail_line', [(0, 0.62, 0.85), (0, 1.1, 0.865), (0, 1.5, 0.8), (0, 1.74, 0.742)], 0.005, TRIM, res=8, bevel_res=2)
RR = (0, 1.3, 0.565)
rear = [torus('tyreR', 0.56, 0.06, RR, TYRE, width=1.9, seg=56, ring=8)]
for k in range(12):
    a = 2 * math.pi * k / 12; rear.append(box('treadR', (0.22, 0.05, 0.022), (0, RR[1] + math.sin(a) * 0.615, RR[2] + math.cos(a) * 0.615), SATIN, rot=(-a, 0, 0)))
torus('glowR_in', 0.495, 0.012, RR, TRIM, seg=56, ring=6)

# ---------------------------------------------------------------- export: one mesh per material, except the moving parts
def keep(objs, name, pivot):
    o = join(objs, name); bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.context.scene.cursor.location = pivot; bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); o.select_set(False); return o

apply_all()
keep(yoke, 'Yoke', (0, -0.36, 0.95)); keep(front, 'WheelF', FR); keep(rear, 'WheelR', RR)
for n in ('Screen', 'DialL', 'DialR'):  # panels pivot on their own centre, so the game can place gauges at the node
    vs = bpy.data.objects[n].data.vertices; keep([bpy.data.objects[n]], n, tuple(sum(v.co[i] for v in vs) / len(vs) for i in range(3)))
KEEP = {'Yoke', 'WheelF', 'WheelR', 'Screen', 'DialL', 'DialR'}
groups = {}
for o in list(bpy.context.collection.objects):
    if o.name in KEEP: continue
    groups.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in groups.items(): join(objs, name)
bpy.data.objects['WheelF']['radius'] = 0.57; bpy.data.objects['WheelR']['radius'] = 0.62
tris = sum(len(p.vertices) - 2 for o in bpy.context.collection.objects for p in o.data.polygons)
path = os.path.join(out_dir, 'cockpit-v5.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=True, export_extras=True)
print('cockpit v5 objects', sorted(o.name for o in bpy.context.collection.objects), 'triangles', tris, '->', path)
