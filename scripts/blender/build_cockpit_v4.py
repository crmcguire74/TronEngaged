# Fourth-generation first-person cockpit (cockpit view and VR), original design.
#
# What changed from v3, and why: v3 was an assembly of separate boxes and slabs — a flat cowl, two pods bolted to its
# flanks, a bar yoke — and it read as a kit of parts rather than one machine. v4 is built around a single wrap-around
# binnacle swept on an arc about the rider, so the dash, the gauge pods and the shoulder fairings are one continuous
# surface with the instruments sunk into it. On top of that: raked A-pillars carrying the canopy, a four-layer
# instrument stack with real depth, hex vent arrays on the shoulders, a floor pan with pedal plates so the lower
# frame is not empty, and a yoke whose crossbar is one swept tube rather than two straight bars and a hub.
#
#   python3 scripts/blender/build_cockpit_v4.py -- assets/generated          (bpy as a module)
#   blender -b --python scripts/blender/build_cockpit_v4.py -- assets/generated
#
# Blender axes: X (the rider's right is -X), -Y forward, Z up. The rider's eye is at (0, 0.2, 1.27).
# Named nodes the game drives: 'Yoke' (origin on the steering axis; rolls about Y), 'Canopy' (origin on the rear
# hinge; opens about X), 'DialL' / 'DialR' (gauge anchors; the game draws holographic graphics on them).
# Materials re-skinned by name: Body, Chrome, Satin, Rubber, Trim (rider colour), WallLamp (light-wall state),
# Screen (live HUD), DisplayGlass, Glass (canopy), Lens, Needle, Holo.
import bpy  # first: bmesh is a compiled submodule that bpy registers on import
import sys, os, math, bmesh
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/generated'
kit.reset()
BODY = kit.mat('Body', (0.008, 0.009, 0.011), 0.2, 0.12)       # clear-coated black (the game adds the clearcoat)
CHROME = kit.mat('Chrome', (0.9, 0.92, 0.95), 1.0, 0.06)
SATIN = kit.mat('Satin', (0.035, 0.038, 0.045), 0.8, 0.35)
RUBBER = kit.mat('Rubber', (0.012, 0.012, 0.014), 0.0, 0.7)
TRIM = kit.mat('Trim', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 4.0)
LAMP = kit.mat('WallLamp', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 2.0)
SCREEN = kit.mat('Screen', (0, 0, 0), 0.0, 0.3, (0.1, 0.3, 0.4), 1.0)
DGLASS = kit.mat('DisplayGlass', (0.0, 0.0, 0.0), 0.0, 0.03)
GLASS = kit.mat('Glass', (0.6, 0.8, 0.9), 0.0, 0.05)
LENS = kit.mat('Lens', (0.01, 0.012, 0.015), 0.3, 0.05)
NEEDLE = kit.mat('Needle', (0, 0, 0), 0.0, 0.4, (1.0, 1.0, 1.0), 4.0)
HOLO = kit.mat('Holo', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 1.0)

EYE = Vector((0, 0.2, 1.27))
yoke_parts, canopy_parts = [], []

# ------------------------------------------------------------------ helpers
def link(name, bm, material, smooth=False, subsurf=0, bevel=0.0):
    return kit._link(name, bm, material, smooth=smooth, subsurf=subsurf, bevel=bevel)

def orient(o, normal, loc):
    """Turns an object built facing +Z so that it faces `normal`, and moves it to `loc`."""
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(normal).normalized()); o.location = loc; return o

def slab(name, poly, z0, z1, material, bevel=0.0):
    """Prism from a 2D polygon in local XY, from z0 to z1 (faces +Z)."""
    bm = bmesh.new(); a = [bm.verts.new((x, y, z0)) for x, y in poly]; b = [bm.verts.new((x, y, z1)) for x, y in poly]; n = len(poly)
    bm.faces.new(list(reversed(a))); bm.faces.new(b)
    for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    return link(name, bm, material, bevel=bevel)

def frame(name, outer, inner, z0, z1, material):
    """A flat ring between two polygons with the same vertex count (bezels, outlines)."""
    bm = bmesh.new(); n = len(outer)
    oa = [bm.verts.new((x, y, z0)) for x, y in outer]; ob = [bm.verts.new((x, y, z1)) for x, y in outer]
    ia = [bm.verts.new((x, y, z0)) for x, y in inner]; ib = [bm.verts.new((x, y, z1)) for x, y in inner]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ob[i], ob[j], ib[j], ib[i])); bm.faces.new((oa[j], oa[i], ia[i], ia[j]))
        bm.faces.new((oa[i], oa[j], ob[j], ob[i])); bm.faces.new((ia[j], ia[i], ib[i], ib[j]))
    return link(name, bm, material)

def cyl(name, r, depth, material, seg=40):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=seg, location=(0, 0, depth / 2))
    o = bpy.context.active_object; o.name = name; o.data.materials.append(material)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    for p in o.data.polygons: p.use_smooth = True
    o.select_set(False); return o

def ring(name, major, minor, material, seg=48):
    return kit.torus(name, major, minor, (0, 0, 0), material, seg=seg, ring=8, flat=True)

def along(o, a, b):
    return orient(o, Vector(b) - Vector(a), Vector(a))

def quad(name, ctr, rt, up, hw, hh, material):
    me = bpy.data.meshes.new(name); vs = [ctr - rt * hw - up * hh, ctr + rt * hw - up * hh, ctr + rt * hw + up * hh, ctr - rt * hw + up * hh]
    me.from_pydata([tuple(v) for v in vs], [], [(0, 1, 2, 3)]); uv = me.uv_layers.new(name='UVMap')
    for loop, t in zip(me.loops, [(0, 1), (1, 1), (1, 0), (0, 0)]): uv.data[loop.index].uv = t
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); o.data.materials.append(material); return o

def polygon_ring(sides, r, turn=0.0):
    return [(math.cos(turn + i / sides * math.tau) * r, math.sin(turn + i / sides * math.tau) * r) for i in range(sides)]

# ------------------------------------------------------------------ the wrap binnacle
# One surface swept on an arc about a centre behind the rider. At each angle a short vertical profile is placed, so
# the dash rolls continuously from the left hip, across the instrument face, to the right hip: no seams, no bolted-on
# pods. ARC_C is the sweep centre; the profile is given in (radial offset, height) about the surface line.
ARC_C = Vector((0.0, 0.46, 0.0))       # behind the rider, on the floor
A0, A1 = math.radians(-104), math.radians(104)
STEPS = 54

def arc_radius(a):
    """How far the binnacle stands off the sweep centre at angle a (0 = straight ahead of the rider)."""
    t = abs(a) / A1
    return 1.02 + 0.30 * t ** 1.9          # wider at the hips than at the nose

def arc_top(a):
    """Crest height of the binnacle at angle a: lowest dead ahead so the road is never masked."""
    t = abs(a) / A1
    return 0.955 + 0.085 * t ** 1.5

def arc_point(a, r_off, z):
    r = arc_radius(a) + r_off
    return Vector((math.sin(a) * r, ARC_C.y - math.cos(a) * r, z))

# profile across the binnacle: (radial offset from the surface line, height above the crest)
PROFILE = [(-0.235, -0.330), (-0.225, -0.120), (-0.185, -0.028), (-0.120, 0.004), (-0.030, 0.014),
           (0.062, 0.006), (0.120, -0.034), (0.145, -0.115), (0.150, -0.330)]

def sweep(name, material, prof, a0=A0, a1=A1, steps=STEPS, z_shift=0.0, r_shift=0.0, smooth=True, cap=True):
    bm = bmesh.new(); rings = []
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps; top = arc_top(a) + z_shift
        rings.append([bm.verts.new(arc_point(a, ro + r_shift, top + dz)) for ro, dz in prof])
    for p, q in zip(rings, rings[1:]):
        for k in range(len(prof) - 1): bm.faces.new((p[k], p[k + 1], q[k + 1], q[k]))
    if cap and len(prof) > 2:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    return link(name, bm, material, smooth=smooth)

binnacle = sweep('Binnacle', BODY, PROFILE)
# satin inner lip facing the rider, so the surface nearest the eye does not mirror the lit stands as a white blotch
binnacle.data.materials.append(SATIN)
for poly in binnacle.data.polygons:
    if poly.normal.y > 0.55: poly.material_index = 1

# a continuous neon inlay running the crest of the binnacle, and a fine chrome pinstripe inside it
sweep('CrestInlay', TRIM, [(-0.040, 0.0175), (0.004, 0.0175)], z_shift=0.0, smooth=False)
sweep('CrestPin', CHROME, [(0.055, 0.0085), (0.064, 0.0085)], smooth=False)
# a second inlay low on the outer face, which is the line the eye follows round the hips
sweep('HipInlay', TRIM, [(0.1555, -0.148), (0.1555, -0.108)], smooth=False)

# ------------------------------------------------------------------ forward cowl ahead of the binnacle
# A long tapered prow that falls away from the dash crest to the nose, so the rider sees bodywork and then road,
# never a cliff edge. Lofted superellipses, same language as the machine's exterior.
COWL = [(-0.55, 0.455, 0.930, 0.52), (-0.84, 0.455, 0.940, 0.47), (-1.14, 0.365, 0.900, 0.45),
        (-1.44, 0.215, 0.805, 0.46), (-1.66, 0.062, 0.670, 0.53)]
P = 5.0
kit.loft('Cowl', COWL, BODY, n=28, power=P)

def sec_at(SECS, y):
    for a, b in zip(SECS, SECS[1:]):
        lo, hi = sorted((a[0], b[0]))
        if lo <= y <= hi:
            t = (y - a[0]) / (b[0] - a[0]); return tuple(a[k] + (b[k] - a[k]) * t for k in range(4))
    return SECS[0] if abs(y - SECS[0][0]) < abs(y - SECS[-1][0]) else SECS[-1]

def on_top(w, zt, zb, power, frac):
    c = frac ** (power / 2); s = math.sqrt(max(0.0, 1 - c * c)); cz = (zt + zb) / 2; h = (zt - zb) / 2
    return cz + h * s ** (2 / power)

def band_on(name, sx, f_of_t, width, y0, y1, material, SECS, power, steps=26, lift=0.0035):
    bm = bmesh.new(); prev = None
    for i in range(steps + 1):
        t = i / steps; y = y0 + (y1 - y0) * t; _, w, zt, zb = sec_at(SECS, y); f = f_of_t(t); df = width / (2 * w)
        pts = [bm.verts.new((sx * w * ff, y, on_top(w, zt, zb, power, ff) + lift)) for ff in (max(0.01, f - df), min(0.985, f + df))]
        if prev: bm.faces.new((prev[0], prev[1], pts[1], pts[0]) if sx > 0 else (prev[1], prev[0], pts[0], pts[1]))
        prev = pts
    return link(name, bm, material, smooth=True)

for sx in (-1, 1):
    band_on('CowlBand', sx, lambda t: 0.93 - 0.70 * t ** 1.15, 0.044, -0.58, -1.54, TRIM, COWL, P)
    band_on('CowlPin', sx, lambda t: 0.78 - 0.58 * t ** 1.15, 0.005, -0.62, -1.46, CHROME, COWL, P)
    band_on('CowlEdge', sx, lambda t: 0.985, 0.012, -0.58, -1.60, CHROME, COWL, P, lift=0.0015)
kit.box('Prow', (0.1, 0.02, 0.014), (0, -1.64, 0.676), TRIM)

# hex vent arrays on the cowl shoulders: a detail that reads as engineered rather than extruded
for sx in (-1, 1):
    for k in range(5):
        y = -0.72 - k * 0.085; _, w, zt, zb = sec_at(COWL, y); f = 0.60 - k * 0.012
        z = on_top(w, zt, zb, P, f)
        hx = slab('Vent', polygon_ring(6, 0.021, math.pi / 6), 0.0, 0.006, SATIN)
        hx.location = (sx * w * f, y, z + 0.001)
        hr = slab('VentRim', polygon_ring(6, 0.026, math.pi / 6), 0.0, 0.0028, CHROME)
        hr.location = (sx * w * f, y, z)

# ------------------------------------------------------------------ instrument stack: four layers of real depth
C = Vector((0, -0.70, 0.995)); N = (EYE - C); N.x = 0; N.normalize()
UP = Vector((0, -N.z, N.y)); RT = Vector((-1, 0, 0))
def octagon(hw, hh, c):
    return [(-hw + c, -hh), (hw - c, -hh), (hw, -hh + c), (hw, hh - c), (hw - c, hh), (-hw + c, hh), (-hw, hh - c), (-hw, -hh + c)]

orient(slab('Shroud', octagon(0.238, 0.138, 0.055), -0.13, 0.0, BODY, bevel=0.004), N, C - N * 0.006)          # outer hood
# The glare shield round the display is deliberately satin, not polished: a chrome lip here catches the key light as
# a pinpoint specular that bloom paints straight across the instruments, which is the opposite of what a glare
# shield is for. Chrome stays on the yoke, the rails and the small hardware, where the highlight is wanted.
orient(frame('ShroudLip', octagon(0.238, 0.138, 0.055), octagon(0.221, 0.123, 0.050), 0.0, 0.010, SATIN), N, C - N * 0.004)
orient(slab('Recess', octagon(0.214, 0.118, 0.046), -0.055, 0.0, SATIN), N, C + N * 0.004)                      # sunk well
orient(frame('Bezel', octagon(0.200, 0.106, 0.043), octagon(0.180, 0.089, 0.035), 0.0, 0.013, BODY), N, C + N * 0.012)
orient(frame('BezelGlow', octagon(0.197, 0.103, 0.042), octagon(0.188, 0.095, 0.038), 0.0, 0.004, TRIM), N, C + N * 0.024)
quad('Screen', C + N * 0.014, RT, UP, 0.172, 0.084, SCREEN)
orient(slab('DisplayGlass', octagon(0.183, 0.092, 0.036), 0.0, 0.002, DGLASS), N, C + N * 0.018)
quad('HoloFrame', C + N * 0.0165, RT, UP, 0.187, 0.101, HOLO)
# light-wall lamp columns flanking the stack, and a lit lip beneath it
orient(frame('LampLip', [(-0.152, -0.132), (0.152, -0.132), (0.182, -0.114), (-0.182, -0.114)],
             [(-0.147, -0.127), (0.147, -0.127), (0.172, -0.117), (-0.172, -0.117)], 0.0, 0.006, LAMP), N, C + N * 0.004)
for sx in (-1, 1):
    orient(slab('LampCol', [(-0.0065, -0.068), (0.0065, -0.068), (0.0065, 0.068), (-0.0065, 0.068)], 0.0, 0.006, LAMP), N, C + RT * (sx * 0.228) + N * 0.004)
    orient(cyl('StackKnurl', 0.010, 0.030, CHROME, seg=18), RT * sx, C + RT * (sx * 0.244) - UP * 0.052)

# ------------------------------------------------------------------ gauges, sunk into the binnacle at the hips
needles = []
for sx, nm in ((1, 'DialL'), (-1, 'DialR')):
    # inboard enough to flank the display inside the rider's forward view, not out on the hips where they are
    # only seen by turning the head
    # on the rider-facing inner wall of the binnacle, proud of the surface. Set on the arc's outer line they sit
    # inside the solid shell and the bodywork hides them completely.
    ang = sx * math.radians(26)
    dc = arc_point(ang, -0.055, arc_top(ang) + 0.010)
    dn = (EYE - dc).normalized()
    orient(cyl('GaugeWell', 0.082, 0.085, SATIN, seg=48), -dn, dc - dn * 0.002)
    orient(ring('GaugeBezel', 0.070, 0.0095, CHROME, seg=56), dn, dc + dn * 0.007)
    orient(cyl('GaugeFace', 0.062, 0.004, LENS, seg=48), dn, dc)
    orient(ring('GaugeRing', 0.053, 0.0026, TRIM, seg=56), dn, dc + dn * 0.0058)
    # three chrome studs round each bezel, the small asymmetry that stops a dial looking stamped
    for k in range(3):
        a = math.radians(-120 + k * 120)
        up = Vector((0, 0, 1)) - dn * dn.z; up.normalize(); rt = up.cross(-dn)
        orient(cyl('GaugeStud', 0.0048, 0.008, CHROME, seg=12), dn, dc + dn * 0.008 + (rt * math.cos(a) + up * math.sin(a)) * 0.0765)
    needles.append((nm, dc + dn * 0.010, dn))

# ------------------------------------------------------------------ raked A-pillars carrying the canopy
# The pillars have to rise outside the rider's forward cone: the eye is at z 1.27, so anything that climbs through
# that height near the centre line lies straight across the road. These stay outboard and rake back hard.
PILLAR = [(0.515, 0.20, 0.985), (0.560, 0.02, 1.160), (0.545, -0.17, 1.330), (0.470, -0.32, 1.440)]
for sx in (-1, 1):
    kit.tube('Pillar', [(sx * x, y, z) for x, y, z in PILLAR], 0.022, BODY, res=14, bevel_res=5)
    kit.tube('PillarInlay', [(sx * (x - 0.016), y, z + 0.010) for x, y, z in PILLAR], 0.0045, TRIM, res=12, bevel_res=3)
    kit.tube('PillarRib', [(sx * (x + 0.014), y, z - 0.004) for x, y, z in PILLAR], 0.0035, CHROME, res=12, bevel_res=3)
    # rear-view strake at the shoulder
    base = Vector((sx * 0.535, 0.16, 1.00))
    st = kit.box('Strake', (0.012, 0.115, 0.052), (0, 0, 0), BODY, bevel=0.004); st.location = base + Vector((sx * 0.035, -0.02, 0.055)); st.rotation_euler = (0, sx * 0.22, 0)
    mg = kit.box('StrakeGlass', (0.003, 0.098, 0.040), (0, 0, 0), LENS); mg.location = base + Vector((sx * 0.043, -0.02, 0.055)); mg.rotation_euler = (0, sx * 0.22, 0)

# ------------------------------------------------------------------ yoke: one swept crossbar, knurled grips, paddles
PIV = Vector((0, -0.47, 0.935))
CROSS = [(-0.395, -0.352, 0.988), (-0.300, -0.420, 0.992), (-0.165, -0.455, 0.966),
         (0.0, -0.466, 0.944), (0.165, -0.455, 0.966), (0.300, -0.420, 0.992), (0.395, -0.352, 0.988)]
yoke_parts.append(kit.tube('Cross', CROSS, 0.0145, CHROME, res=16, bevel_res=5))
yoke_parts.append(kit.tube('CrossInlay', [(x * 0.97, y - 0.009, z + 0.011) for x, y, z in CROSS], 0.0034, TRIM, res=14, bevel_res=3))
# centre boss: a shallow turbine face rather than a protruding hub
yoke_parts.append(along(cyl('Boss', 0.052, 0.034, CHROME, seg=48), PIV + Vector((0, -0.012, -0.004)), PIV + Vector((0, 0.022, 0.010))))
yoke_parts.append(along(cyl('BossFace', 0.042, 0.004, LENS, seg=48), PIV + Vector((0, 0.022, 0.010)), PIV + Vector((0, 0.027, 0.012))))
yoke_parts.append(orient(ring('BossRing', 0.036, 0.0028, TRIM), Vector((0, 1, 0.33)), PIV + Vector((0, 0.025, 0.0115))))
for i in range(14):
    a = i / 14 * math.tau
    fin = kit.box('BossFin', (0.0026, 0.0035, 0.024), (0, 0, 0), CHROME)
    fin.location = PIV + Vector((math.cos(a) * 0.022, 0.026, 0.0115 + math.sin(a) * 0.022)); fin.rotation_euler = (0, -a, 0)
    yoke_parts.append(fin)
for sx in (-1, 1):
    g0, g1 = Vector((sx * 0.395, -0.352, 0.988)), Vector((sx * 0.452, -0.268, 0.978))
    gd = g1 - g0
    yoke_parts.append(along(cyl('Collar', 0.0215, 0.020, CHROME, seg=32), g0 - gd.normalized() * 0.010, g0 + gd.normalized() * 0.010))
    yoke_parts.append(along(cyl('Grip', 0.0188, gd.length, RUBBER, seg=32), g0, g1))
    # knurling: fine rings the whole length, tighter than v3's seven ribs, so the grip reads as a grip
    for k in range(13):
        yoke_parts.append(orient(ring('Knurl', 0.0193, 0.0019, RUBBER, seg=28), gd, g0 + gd * (0.10 + k * 0.064)))
    yoke_parts.append(orient(ring('GripGlow', 0.0208, 0.0022, TRIM, seg=32), gd, g0 + gd.normalized() * 0.012))
    yoke_parts.append(along(cyl('BarEnd', 0.0225, 0.015, CHROME, seg=32), g1, g1 + gd.normalized() * 0.015))
    yoke_parts.append(orient(ring('BarEndGlow', 0.0132, 0.0025, TRIM, seg=32), gd, g1 + gd.normalized() * 0.0155))
    # trigger paddle behind the grip, and a thumb plate on top of it
    pad = kit.box('Paddle', (0.010, 0.064, 0.030), (0, 0, 0), CHROME, bevel=0.003)
    pad.location = g0 + gd * 0.42 + Vector((0, 0.030, -0.018)); pad.rotation_euler = (0.22, sx * 0.34, 0); yoke_parts.append(pad)
    thumb = kit.box('Thumb', (0.020, 0.024, 0.005), (0, 0, 0), TRIM)
    thumb.location = g0 + gd * 0.30 + Vector((0, -0.004, 0.022)); thumb.rotation_euler = (0, sx * 0.30, 0); yoke_parts.append(thumb)

# ------------------------------------------------------------------ tub, floor pan and tank
for sx in (-1, 1):
    fair = kit.loft('Fairing', [(0.36, 0.045, 0.80, 0.52), (0.0, 0.055, 0.86, 0.47), (-0.36, 0.055, 0.88, 0.47), (-0.64, 0.038, 0.86, 0.52)], BODY, n=16, power=4.0)
    fair.location.x = sx * 0.455
    kit.tube('Rail', [(sx * 0.455, 0.36, 0.806), (sx * 0.460, 0.0, 0.862), (sx * 0.455, -0.36, 0.882), (sx * 0.450, -0.64, 0.858)], 0.008, CHROME, res=12, bevel_res=3)
    kit.tube('RailBand', [(sx * 0.434, 0.31, 0.798), (sx * 0.438, 0.0, 0.852), (sx * 0.434, -0.36, 0.872), (sx * 0.430, -0.62, 0.850)], 0.0085, TRIM, res=12, bevel_res=2)
# floor pan with pedal plates: the lower frame had nothing in it, so the view fell away into bodywork
floor = slab('FloorPan', [(-0.33, -0.98), (0.33, -0.98), (0.40, -0.42), (0.40, 0.18), (-0.40, 0.18), (-0.40, -0.42)], 0.0, 0.018, SATIN, bevel=0.004)
floor.location.z = 0.605
for sx in (-1, 1):
    kit.box('Pedal', (0.10, 0.17, 0.012), (sx * 0.185, -0.70, 0.645), CHROME, rot=(-0.19, 0, 0), bevel=0.003)
    for k in range(4):
        kit.box('PedalRib', (0.085, 0.009, 0.006), (sx * 0.185, -0.76 + k * 0.040, 0.655 + k * 0.0075), RUBBER, rot=(-0.19, 0, 0))
    kit.box('PedalGlow', (0.094, 0.006, 0.004), (sx * 0.185, -0.615, 0.6275), TRIM, rot=(-0.19, 0, 0))
TANK = [(-0.24, 0.175, 0.845, 0.50), (0.0, 0.225, 0.875, 0.48), (0.3, 0.205, 0.825, 0.48), (0.6, 0.155, 0.725, 0.50)]
kit.loft('Tank', TANK, BODY, n=18, power=4.0)
for sx in (-1, 1): band_on('TankBand', sx, lambda t: 0.5 + 0.32 * math.sin(math.pi * t), 0.030, -0.22, 0.56, TRIM, TANK, 4.0)
kit.torus('CoreBezel', 0.090, 0.012, (0, -0.02, 0.872), CHROME, seg=56, ring=8, flat=True)
kit.torus('CoreRing', 0.071, 0.006, (0, -0.02, 0.878), TRIM, seg=56, ring=6, flat=True)
orient(cyl('CoreLens', 0.067, 0.006, LENS, seg=48), Vector((0, 0, 1)), Vector((0, -0.02, 0.870)))
kit.loft('RearDeck', [(0.46, 0.205, 0.865, 0.60), (0.72, 0.245, 0.925, 0.60), (1.02, 0.165, 0.865, 0.62)], BODY, n=14, power=4.0)
kit.box('TailBand', (0.22, 0.016, 0.01), (0, 1.02, 0.866), TRIM)

# ------------------------------------------------------------------ canopy: a compound-curve shell on a rear hinge
def shell(name, sections, material, n=26, power=2.6):
    bm = bmesh.new(); rings = []
    for (y, w, zt, zb) in sections:
        rr = []
        for i in range(n + 1):
            a = math.pi * i / n; c, s = math.cos(a), math.sin(a)
            rr.append(bm.verts.new((w * math.copysign(abs(c) ** (2 / power), c), y, zb + (zt - zb) * abs(s) ** (2 / power))))
        rings.append(rr)
    for a, b in zip(rings, rings[1:]):
        for i in range(n): bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    return kit._link(name, bm, material, smooth=True, subsurf=1)

CAN = [(0.64, 0.335, 1.40, 0.86), (0.32, 0.472, 1.535, 0.86), (0.0, 0.502, 1.565, 0.86),
       (-0.30, 0.482, 1.495, 0.87), (-0.56, 0.420, 1.305, 0.90), (-0.76, 0.295, 1.120, 0.96)]
arc = lambda y, w, zt, zb, k: [(w * math.copysign(abs(math.cos(a)) ** (2 / 2.6), math.cos(a)), y, zb + (zt - zb) * abs(math.sin(a)) ** (2 / 2.6)) for a in [math.pi * i / k for i in range(k + 1)]]
canopy_parts.append(shell('CanopyGlass', CAN, GLASS))
for sx in (-1, 1): canopy_parts.append(kit.tube('CanopyRail', [(sx * w, y, zb) for (y, w, zt, zb) in CAN], 0.007, CHROME, res=10, bevel_res=3))
canopy_parts.append(kit.tube('CanopyLip', arc(*CAN[-1], 18), 0.0045, TRIM, res=4, bevel_res=2))
canopy_parts.append(kit.tube('CanopyArch', arc(*CAN[0], 12), 0.014, CHROME, res=4, bevel_res=3))
# a spine rib running the crown, which is what gives a canopy its read in a reflection
canopy_parts.append(kit.tube('CanopySpine', [(0, y, zt) for (y, w, zt, zb) in CAN], 0.006, CHROME, res=10, bevel_res=3))
HINGE = Vector((0, 0.64, 0.86))

# ------------------------------------------------------------------ export
kit.apply_all()
def keep(parts, name, origin):
    o = kit.join(parts, name); bpy.context.scene.cursor.location = origin
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); o.select_set(False); return o
keep(yoke_parts, 'Yoke', PIV); keep(canopy_parts, 'Canopy', HINGE)
groups = {}
for o in list(bpy.context.collection.objects):
    if o.name in ('Yoke', 'Canopy'): continue
    groups.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in groups.items(): kit.join(objs, name)
# dial anchors last, unapplied: their transform stays on the node so the game can place graphics on them
for nm, loc, dn in needles:
    nd = kit.box(nm, (0.0035, 0.002, 0.046), (0, 0, 0.017), NEEDLE)
    bpy.ops.object.select_all(action='DESELECT'); nd.select_set(True); bpy.context.view_layer.objects.active = nd
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False); nd.select_set(False)
    up = Vector((0, 0, 1)) - dn * dn.z; up.normalize(); rt = up.cross(-dn)
    m = Matrix((rt, dn, up)).transposed(); nd.rotation_mode = 'QUATERNION'; nd.rotation_quaternion = m.to_quaternion(); nd.location = loc
tris = sum(len(p.vertices) - 2 for o in bpy.context.collection.objects for p in o.data.polygons)
bpy.ops.object.select_all(action='SELECT')
os.makedirs(out, exist_ok=True)
path = os.path.join(out, 'cockpit-v4.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=True)
print('COCKPIT4 objects', sorted(o.name for o in bpy.context.collection.objects), 'triangles', tris, '->', path)
