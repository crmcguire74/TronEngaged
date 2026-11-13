# Third-generation first-person cockpit (cockpit view and VR), original design: deep gloss-black clear-coated bodywork,
# polished chrome hardware, broad clean neon bands, an octagonal black-glass display with the live readout under it,
# twin round black-glass gauges with live holographic graphics, chrome handlebars with ribbed black grips, and a hinged glass canopy.
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_cockpit_v3.py -- assets/generated
# Blender axes: X (the rider's right is -X), -Y forward, Z up. The rider's eye is at (0, 0.2, 1.27).
# Named nodes the game drives: 'Yoke' (origin on the steering axis; rolls about Y), 'Canopy' (origin on the rear hinge;
# opens about X), 'DialL' / 'DialR' (gauge needles; origin at the dial centre, they turn about their local Y in Blender,
# which is local -Z in three). Materials re-skinned by name: Body, Chrome, Trim (rider colour), WallLamp (light-wall
# state), Screen (live HUD), DisplayGlass, Glass (canopy), Needle.
import sys, os, math, bmesh, bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit

out = sys.argv[sys.argv.index('--') + 1]
kit.reset()
BODY = kit.mat('Body', (0.008, 0.009, 0.011), 0.2, 0.12)       # clear-coated black (the game adds the clearcoat)
CHROME = kit.mat('Chrome', (0.9, 0.92, 0.95), 1.0, 0.06)       # polished chrome
SATIN = kit.mat('Satin', (0.035, 0.038, 0.045), 0.8, 0.35)
RUBBER = kit.mat('Rubber', (0.012, 0.012, 0.014), 0.0, 0.7)
TRIM = kit.mat('Trim', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 4.0)
LAMP = kit.mat('WallLamp', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 2.0)
SCREEN = kit.mat('Screen', (0, 0, 0), 0.0, 0.3, (0.1, 0.3, 0.4), 1.0)
DGLASS = kit.mat('DisplayGlass', (0.0, 0.0, 0.0), 0.0, 0.03)
GLASS = kit.mat('Glass', (0.6, 0.8, 0.9), 0.0, 0.05)
LENS = kit.mat('Lens', (0.01, 0.012, 0.015), 0.3, 0.05)
NEEDLE = kit.mat('Needle', (0, 0, 0), 0.0, 0.4, (1.0, 1.0, 1.0), 4.0)
HOLO = kit.mat('Holo', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 1.0)   # line-art overlay; the game draws it

EYE = Vector((0, 0.2, 1.27))
yoke_parts, canopy_parts = [], []

def link(name, bm, material, smooth=False):
    return kit._link(name, bm, material, smooth=smooth)

def orient(o, normal, loc):
    """Turns an object built facing +Z so that it faces `normal`, and moves it to `loc`."""
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(normal.normalized()); o.location = loc; return o

def octagon(hw, hh, c):
    return [(-hw + c, -hh), (hw - c, -hh), (hw, -hh + c), (hw, hh - c), (hw - c, hh), (-hw + c, hh), (-hw, hh - c), (-hw, -hh + c)]

def slab(name, poly, z0, z1, material):
    """Prism from a 2D polygon in local XY, from z0 to z1 (faces +Z)."""
    bm = bmesh.new(); a = [bm.verts.new((x, y, z0)) for x, y in poly]; b = [bm.verts.new((x, y, z1)) for x, y in poly]; n = len(poly)
    bm.faces.new(list(reversed(a))); bm.faces.new(b)
    for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    return link(name, bm, material)

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
    """Cylinder along local Z, from 0 to depth."""
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=seg, location=(0, 0, depth / 2))
    o = bpy.context.active_object; o.name = name; o.data.materials.append(material); bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    for p in o.data.polygons: p.use_smooth = True
    o.select_set(False); return o

def ring(name, major, minor, material, seg=48):
    o = kit.torus(name, major, minor, (0, 0, 0), material, seg=seg, ring=8, flat=True); return o

def along(o, a, b):
    """Places a +Z-built part so it runs from a to b."""
    d = (Vector(b) - Vector(a)); return orient(o, d, Vector(a))

def quad(name, ctr, rt, up, hw, hh, material):
    me = bpy.data.meshes.new(name); vs = [ctr - rt * hw - up * hh, ctr + rt * hw - up * hh, ctr + rt * hw + up * hh, ctr - rt * hw + up * hh]
    me.from_pydata([tuple(v) for v in vs], [], [(0, 1, 2, 3)]); uv = me.uv_layers.new(name='UVMap')
    for loop, t in zip(me.loops, [(0, 1), (1, 1), (1, 0), (0, 0)]): uv.data[loop.index].uv = t   # V pre-flipped for a canvas texture
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); o.data.materials.append(material); return o

def on_top(w, zt, zb, power, frac):
    c = frac ** (power / 2); s = math.sqrt(max(0.0, 1 - c * c)); cz = (zt + zb) / 2; h = (zt - zb) / 2
    return cz + h * s ** (2 / power)

# ------------------------------------------------------------------ forward cowl with broad neon bands sweeping to the prow
COWL = [(-0.50, 0.46, 0.895, 0.50), (-0.80, 0.47, 0.925, 0.46), (-1.10, 0.37, 0.89, 0.44), (-1.40, 0.22, 0.80, 0.45), (-1.62, 0.06, 0.665, 0.52)]
P = 5.0
cowl = kit.loft('Cowl', COWL, BODY, n=28, power=P)
# the cowl's rear cap faces the rider: satin, so it doesn't mirror the lit stands behind him as a white blotch
cowl.data.materials.append(SATIN)
for poly in cowl.data.polygons:
    if abs(poly.normal.y) > 0.9 and poly.center.y > -0.55: poly.material_index = 1
def cowl_at(y):
    for a, b in zip(COWL, COWL[1:]):
        if b[0] <= y <= a[0]:
            t = (y - a[0]) / (b[0] - a[0]); return tuple(a[k] + (b[k] - a[k]) * t for k in range(4))
    return COWL[-1]
def sec_at(SECS, y):
    for a, b in zip(SECS, SECS[1:]):
        lo, hi = sorted((a[0], b[0]))
        if lo <= y <= hi:
            t = (y - a[0]) / (b[0] - a[0]); return tuple(a[k] + (b[k] - a[k]) * t for k in range(4))
    return SECS[0] if abs(y - SECS[0][0]) < abs(y - SECS[-1][0]) else SECS[-1]
def band_on_cowl(name, sx, f_of_t, width, y0, y1, material, steps=24, lift=0.0035, SECS=None, power=None):
    """A flat light band lying on the cowl surface: f_of_t gives the band's centre as a fraction of the half-width."""
    bm = bmesh.new(); prev = None
    for i in range(steps + 1):
        t = i / steps; y = y0 + (y1 - y0) * t; _, w, zt, zb = sec_at(SECS or COWL, y); f = f_of_t(t); df = width / (2 * w); PP = power or P
        pts = []
        for ff in (max(0.01, f - df), min(0.98, f + df)): pts.append(bm.verts.new((sx * w * ff, y, on_top(w, zt, zb, PP, ff) + lift)))
        if prev: bm.faces.new((prev[0], prev[1], pts[1], pts[0]) if sx > 0 else (prev[1], prev[0], pts[0], pts[1]))
        prev = pts
    return link(name, bm, material, smooth=True)
for sx in (-1, 1):
    # the main sweep: wide at the shoulders, converging toward the prow
    band_on_cowl('CowlBand', sx, lambda t: 0.93 - 0.7 * t ** 1.15, 0.042, -0.52, -1.5, TRIM)
    # a fine chrome pinstripe running inside it
    band_on_cowl('CowlPin', sx, lambda t: 0.8 - 0.6 * t ** 1.15, 0.005, -0.56, -1.42, CHROME)
kit.box('Prow', (0.1, 0.02, 0.014), (0, -1.6, 0.675), TRIM)
# a broad lit edge framing the rear of the dash, following the cowl's top contour (joins the two sweeps)
_, w0, zt0, zb0 = COWL[0]
kit.tube('DashEdge', [(w0 * f, -0.503, on_top(w0, zt0, zb0, P, abs(f)) + 0.003) for f in [i / 20 * 1.86 - 0.93 for i in range(21)]], 0.0095, TRIM, res=4, bevel_res=3)

# ------------------------------------------------------------------ octagonal black-glass display facing the rider's eye
C = Vector((0, -0.68, 0.985)); N = EYE - C; N.x = 0; N.normalize(); UP = Vector((0, -N.z, N.y)); RT = Vector((-1, 0, 0))
HW, HH = 0.17, 0.083
house = slab('Housing', octagon(0.215, 0.122, 0.05), -0.1, 0.0, BODY); orient(house, N, C - N * 0.004)
bez = frame('Bezel', octagon(0.196, 0.105, 0.042), octagon(0.177, 0.088, 0.034), 0.0, 0.012, BODY); orient(bez, N, C)
# a broad lit octagon framing the glass, and a line-art overlay floated just in front of the live readout
glow = frame('DisplayGlow', octagon(0.194, 0.103, 0.041), octagon(0.184, 0.093, 0.037), 0.0, 0.004, TRIM); orient(glow, N, C + N * 0.012)
quad('Screen', C + N * 0.002, RT, UP, HW, HH, SCREEN)
dg = slab('DisplayGlass', octagon(0.18, 0.09, 0.035), 0.0, 0.002, DGLASS); orient(dg, N, C + N * 0.006)
quad('HoloFrame', C + N * 0.0045, RT, UP, 0.185, 0.1, HOLO)
# a neon lip under the display and lamp columns on the housing's flanks show the light wall's state
lip = frame('LampLip', [(-0.15, -0.116), (0.15, -0.116), (0.18, -0.1), (-0.18, -0.1)], [(-0.145, -0.111), (0.145, -0.111), (0.17, -0.103), (-0.17, -0.103)], 0.0, 0.006, LAMP); orient(lip, N, C)
for sx in (-1, 1):
    col = slab('LampCol', [(-0.006, -0.06), (0.006, -0.06), (0.006, 0.06), (-0.006, 0.06)], 0.0, 0.006, LAMP); orient(col, N, C + RT * (sx * 0.208))

# ------------------------------------------------------------------ twin round black-glass gauges with chrome bezels; the game draws their live graphics
needles = []
for sx, nm in ((1, 'DialL'), (-1, 'DialR')):
    dc = Vector((sx * 0.3, -0.62, 0.935)); dn = (EYE - dc).normalized()
    orient(cyl('GaugeCup', 0.072, 0.07, BODY, seg=48), -dn, dc - dn * 0.001)
    orient(ring('GaugeBezel', 0.066, 0.009, CHROME, seg=56), dn, dc + dn * 0.006)
    orient(cyl('GaugeFace', 0.06, 0.004, LENS, seg=48), dn, dc)
    orient(ring('GaugeRing', 0.051, 0.0026, TRIM, seg=56), dn, dc + dn * 0.0055)
    # the dial graphics (light arc, tick fans, digital readout) are drawn by the game on the 'DialL'/'DialR' nodes
    needles.append((nm, dc + dn * 0.009, dn))

# ------------------------------------------------------------------ side pods: triangular light bezels with chrome toggles
for sx in (-1, 1):
    pc = Vector((sx * 0.45, -0.56, 0.86)); pn = (EYE - pc).normalized()
    tri_o = [(-0.085, 0.05), (0.085, 0.05), (0.0, -0.075)]; tri_i = [(-0.056, 0.032), (0.056, 0.032), (0.0, -0.04)]
    orient(slab('Pod', [(-0.1, 0.062), (0.1, 0.062), (0.0, -0.092)], -0.08, 0.0, BODY), pn, pc)
    orient(frame('PodTri', tri_o, tri_i, 0.0, 0.005, TRIM), pn, pc)
    orient(slab('PodGlass', tri_i, 0.0, 0.002, LENS), pn, pc)
    orient(cyl('Toggle', 0.006, 0.05, CHROME, seg=16), pn + Vector((0, 0, 0.6)), pc + pn * 0.004 + Vector((0, 0, 0.0)))
    tb = cyl('ToggleTip', 0.011, 0.016, CHROME, seg=20); orient(tb, pn + Vector((0, 0, 0.6)), pc + (pn + Vector((0, 0, 0.6))).normalized() * 0.05)

# ------------------------------------------------------------------ yoke: chrome bars, a turbine hub, ribbed grips
PIV = Vector((0, -0.46, 0.93))
hub = cyl('Hub', 0.048, 0.07, CHROME, seg=48); yoke_parts.append(along(hub, PIV + Vector((0, -0.035, -0.01)), PIV + Vector((0, 0.035, 0.012))))
yoke_parts.append(along(cyl('HubFace', 0.04, 0.004, LENS, seg=48), PIV + Vector((0, 0.035, 0.012)), PIV + Vector((0, 0.04, 0.0135))))
hr = ring('HubRing', 0.034, 0.003, TRIM); yoke_parts.append(orient(hr, Vector((0, 1, 0.3)), PIV + Vector((0, 0.038, 0.013))))
for i in range(12):
    a = i / 12 * math.tau; fin = kit.box('HubFin', (0.003, 0.004, 0.026), (0, 0, 0), CHROME)
    fin.location = PIV + Vector((math.cos(a) * 0.022, 0.04, 0.013 + math.sin(a) * 0.022)); fin.rotation_euler = (0, -a, 0); yoke_parts.append(fin)
for sx in (-1, 1):
    yoke_parts.append(kit.tube('Bar', [(sx * 0.045, -0.46, 0.935), (sx * 0.17, -0.45, 0.962), (sx * 0.26, -0.432, 0.984), (sx * 0.30, -0.42, 0.99)], 0.0135, CHROME, res=12, bevel_res=4))
    yoke_parts.append(kit.tube('BarBand', [(sx * 0.09, -0.457, 0.958), (sx * 0.17, -0.449, 0.977), (sx * 0.24, -0.437, 0.995)], 0.0032, TRIM, res=10, bevel_res=2))
    g0, g1 = Vector((sx * 0.300, -0.42, 0.99)), Vector((sx * 0.392, -0.359, 0.985)); gd = (g1 - g0)
    yoke_parts.append(along(cyl('Collar', 0.021, 0.022, CHROME, seg=32), g0 - gd.normalized() * 0.012, g0 + gd.normalized() * 0.01))
    yoke_parts.append(along(cyl('Grip', 0.0185, gd.length, RUBBER, seg=32), g0, g1))
    for k in range(7):
        r = ring('Rib', 0.0188, 0.0028, RUBBER, seg=32); yoke_parts.append(orient(r, gd, g0 + gd * (0.18 + k * 0.11)))
    yoke_parts.append(orient(ring('GripGlow', 0.0205, 0.0022, TRIM, seg=32), gd, g0 + gd.normalized() * 0.013))
    yoke_parts.append(along(cyl('BarEnd', 0.022, 0.016, CHROME, seg=32), g1, g1 + gd.normalized() * 0.016))
    yoke_parts.append(orient(ring('BarEndGlow', 0.013, 0.0025, TRIM, seg=32), gd, g1 + gd.normalized() * 0.0165))
    yoke_parts.append(kit.tube('Lever', [(sx * 0.31, -0.405, 1.012), (sx * 0.35, -0.38, 1.02), (sx * 0.385, -0.352, 1.012)], 0.0035, CHROME, res=8, bevel_res=2))

# ------------------------------------------------------------------ tub: knee fairings with chrome rails, tank, core
for sx in (-1, 1):
    fair = kit.loft('Fairing', [(0.35, 0.04, 0.8, 0.55), (0.0, 0.05, 0.85, 0.5), (-0.35, 0.05, 0.87, 0.5), (-0.62, 0.035, 0.85, 0.55)], BODY, n=14, power=4.0); fair.location.x = sx * 0.45
    kit.tube('Rail', [(sx * 0.45, 0.35, 0.805), (sx * 0.455, 0.0, 0.857), (sx * 0.45, -0.35, 0.877), (sx * 0.445, -0.62, 0.855)], 0.008, CHROME, res=12, bevel_res=3)
    kit.tube('RailBand', [(sx * 0.43, 0.3, 0.797), (sx * 0.434, 0.0, 0.848), (sx * 0.43, -0.35, 0.868), (sx * 0.426, -0.6, 0.848)], 0.0085, TRIM, res=12, bevel_res=2)
TANK = [(-0.22, 0.17, 0.84, 0.5), (0.0, 0.22, 0.87, 0.48), (0.3, 0.2, 0.82, 0.48), (0.6, 0.15, 0.72, 0.5)]
kit.loft('Tank', TANK, BODY, n=16, power=4.0)
# neon sweeps on the tank that open around the core and close again behind it
for sx in (-1, 1): band_on_cowl('TankBand', sx, lambda t: 0.5 + 0.32 * math.sin(math.pi * t), 0.03, -0.2, 0.56, TRIM, SECS=TANK, power=4.0)
kit.torus('CoreBezel', 0.088, 0.012, (0, -0.02, 0.868), CHROME, seg=56, ring=8, flat=True)
kit.torus('CoreRing', 0.07, 0.006, (0, -0.02, 0.874), TRIM, seg=56, ring=6, flat=True)
orient(cyl('CoreLens', 0.066, 0.006, LENS, seg=48), Vector((0, 0, 1)), Vector((0, -0.02, 0.866)))
kit.loft('RearDeck', [(0.45, 0.2, 0.86, 0.6), (0.7, 0.24, 0.92, 0.6), (1.0, 0.16, 0.86, 0.62)], BODY, n=14, power=4.0)
kit.box('TailBand', (0.22, 0.016, 0.01), (0, 1.0, 0.862), TRIM)

# ------------------------------------------------------------------ canopy: an open glass shell on a rear hinge
def shell(name, sections, material, n=24, power=2.6):
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
CAN = [(0.62, 0.34, 1.40, 0.86), (0.30, 0.47, 1.53, 0.86), (0.0, 0.5, 1.56, 0.86), (-0.30, 0.48, 1.49, 0.87), (-0.55, 0.42, 1.3, 0.9), (-0.74, 0.3, 1.12, 0.96)]
arc = lambda y, w, zt, zb, k: [(w * math.copysign(abs(math.cos(a)) ** (2 / 2.6), math.cos(a)), y, zb + (zt - zb) * abs(math.sin(a)) ** (2 / 2.6)) for a in [math.pi * i / k for i in range(k + 1)]]
canopy_parts.append(shell('CanopyGlass', CAN, GLASS))
for sx in (-1, 1): canopy_parts.append(kit.tube('CanopyRail', [(sx * w, y, zb) for (y, w, zt, zb) in CAN], 0.007, CHROME, res=10, bevel_res=3))
canopy_parts.append(kit.tube('CanopyLip', arc(*CAN[-1], 16), 0.0045, TRIM, res=4, bevel_res=2))
canopy_parts.append(kit.tube('CanopyArch', arc(*CAN[0], 10), 0.014, CHROME, res=4, bevel_res=3))
HINGE = Vector((0, 0.62, 0.86))

# ------------------------------------------------------------------ export
kit.apply_all()
def keep(parts, name, origin):
    o = kit.join(parts, name); bpy.context.scene.cursor.location = origin
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); o.select_set(False); return o
keep(yoke_parts, 'Yoke', PIV); keep(canopy_parts, 'Canopy', HINGE)
groups = {}
for o in list(bpy.context.collection.objects):
    if o.name in ('Yoke', 'Canopy'): continue
    groups.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in groups.items(): kit.join(objs, name)
# needles last, unapplied: their rotation stays on the node so the game can turn them about the dial axis
for nm, loc, dn in needles:
    nd = kit.box(nm, (0.0035, 0.002, 0.046), (0, 0, 0.017), NEEDLE)       # built pointing up local Z, lying in the XZ plane
    bpy.ops.object.select_all(action='DESELECT'); nd.select_set(True); bpy.context.view_layer.objects.active = nd; bpy.ops.object.transform_apply(location=True, rotation=True, scale=False); nd.select_set(False)
    # local -Y faces the eye; local Z points 'up' on the dial
    up = Vector((0, 0, 1)) - dn * dn.z; up.normalize(); rt = up.cross(-dn)
    from mathutils import Matrix
    m = Matrix((rt, dn, up)).transposed(); nd.rotation_mode = 'QUATERNION'; nd.rotation_quaternion = m.to_quaternion(); nd.location = loc
tris = sum(len(p.vertices) - 2 for o in bpy.context.collection.objects for p in o.data.polygons)
bpy.ops.object.select_all(action='SELECT')
path = os.path.join(out, 'cockpit-v3.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=True)
print('COCKPIT3 objects', sorted(o.name for o in bpy.context.collection.objects), 'triangles', tris, '->', path)
