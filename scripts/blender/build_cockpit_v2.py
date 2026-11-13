# Builds the second-generation first-person cockpit (cockpit view and VR): gloss-black bodywork with panel lines,
# a brushed-alloy instrument binnacle with a live display, light-wall lamps either side of it, a steerable yoke and a
# hinged glass canopy that lowers over the rider at the start.
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_cockpit_v2.py -- assets/generated
# Blender axes: X right (the rider's right is -X), -Y forward, Z up. The rider's eye is at (0, 0.2, 1.27).
# Named nodes the game drives: 'Yoke' (origin on the steering axis; rolls about Y), 'Canopy' (origin on the rear hinge;
# opens about X). Materials the game re-skins by name: Trim (rider colour), Screen (live HUD), WallLamp (light-wall state),
# Glass (canopy).
import sys, os, math, bmesh, bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit

out = sys.argv[sys.argv.index('--') + 1]
kit.reset()
BODY = kit.mat('Body', (0.012, 0.014, 0.018), 1.0, 0.16)        # lacquered black metal: reflections give the form
ALLOY = kit.mat('Alloy', (0.2, 0.215, 0.24), 1.0, 0.3)         # brushed light alloy: bezels, rails, yoke
SATIN = kit.mat('Satin', (0.04, 0.045, 0.055), 0.75, 0.42)      # inner panels
RUBBER = kit.mat('Rubber', (0.014, 0.014, 0.016), 0.0, 0.85)
TRIM = kit.mat('Trim', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 4.0)
LAMP = kit.mat('WallLamp', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 2.0)
SCREEN = kit.mat('Screen', (0, 0, 0), 0.0, 0.3, (0.1, 0.3, 0.4), 1.0)
GLASS = kit.mat('Glass', (0.6, 0.8, 0.9), 0.0, 0.05)
LENS = kit.mat('Lens', (0.02, 0.03, 0.04), 0.4, 0.1)

EYE = Vector((0, 0.2, 1.27))

def shell(name, sections, material, n=24, power=2.6):
    """Open top-half superellipse shell skinned along Y (no floor, no caps). section = (y, half_width, z_top, z_base)."""
    bm = bmesh.new(); rings = []
    for (y, w, zt, zb) in sections:
        ring = []
        for i in range(n + 1):
            a = math.pi * i / n; c, s = math.cos(a), math.sin(a)
            ring.append(bm.verts.new((w * math.copysign(abs(c) ** (2 / power), c), y, zb + (zt - zb) * abs(s) ** (2 / power))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(n): bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    return kit._link(name, bm, material, smooth=True, subsurf=1)

def on_top(w, zt, zb, power, frac):
    """Height of a superellipse loft's upper surface at |x| = frac * half_width."""
    c = frac ** (power / 2); s = math.sqrt(max(0.0, 1 - c * c)); cz = (zt + zb) / 2; h = (zt - zb) / 2
    return cz + h * s ** (2 / power)

def quad(name, ctr, rt, up, hw, hh, material):
    me = bpy.data.meshes.new(name); vs = [ctr - rt * hw - up * hh, ctr + rt * hw - up * hh, ctr + rt * hw + up * hh, ctr - rt * hw + up * hh]
    me.from_pydata([tuple(v) for v in vs], [], [(0, 1, 2, 3)]); uv = me.uv_layers.new(name='UVMap')
    for loop, t in zip(me.loops, [(0, 1), (1, 1), (1, 0), (0, 0)]): uv.data[loop.index].uv = t   # V pre-flipped for a canvas texture
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); o.data.materials.append(material); return o

yoke_parts, canopy_parts = [], []

# ------------------------------------------------------------------ forward cowl: two lacquered panels with a seam
COWL = [(-0.50, 0.34, 0.88, 0.50), (-0.80, 0.37, 0.93, 0.46), (-1.10, 0.33, 0.895, 0.44), (-1.40, 0.22, 0.80, 0.45), (-1.62, 0.06, 0.665, 0.52)]
P = 5.0
kit.loft('Cowl', COWL, BODY, n=24, power=P)
for sx in (-1, 1):
    # shoulder light lines follow the cowl's upper edge; a fine seam line sits either side of centre
    kit.tube('CowlLine', [(sx * w * 0.9, y, on_top(w, zt, zb, P, 0.9) + 0.004) for (y, w, zt, zb) in COWL[:-1]], 0.0045, TRIM, res=10, bevel_res=2)
    kit.tube('CowlSeam', [(sx * 0.07, y, on_top(w, zt, zb, P, 0.07 / w) + 0.003) for (y, w, zt, zb) in COWL[:-1]], 0.0028, ALLOY, res=10, bevel_res=2)
kit.box('Prow', (0.12, 0.012, 0.012), (0, -1.615, 0.67), TRIM)

# ------------------------------------------------------------------ instrument binnacle facing the rider's eye
C = Vector((0, -0.66, 0.99)); N = (EYE - C); N.x = 0; N.normalize(); UP = Vector((0, -N.z, N.y)); RT = Vector((-1, 0, 0))
tilt = math.atan2(-UP.y, UP.z); ROT = (tilt, 0, 0); HW, HH = 0.17, 0.085
kit.box('Binnacle', (0.5, 0.13, 0.24), tuple(C - N * 0.07), SATIN, rot=ROT, bevel=0.012)
for (dx, dz, w, h) in ((0, HH + 0.016, 2 * HW + 0.06, 0.03), (0, -HH - 0.016, 2 * HW + 0.06, 0.03), (HW + 0.016, 0, 0.03, 2 * HH + 0.004), (-HW - 0.016, 0, 0.03, 2 * HH + 0.004)):
    kit.box('Bezel', (w, 0.02, h), tuple(C + RT * -dx + UP * dz + N * 0.004), ALLOY, rot=ROT, bevel=0.004)
quad('Screen', C + N * 0.006, RT, UP, HW, HH, SCREEN)
# brow over the display, with a light edge, and the light-wall lamps: two columns beside the display and a bar under it
BD = Vector((0, math.cos(-0.25), math.sin(-0.25)))
kit.box('Brow', (0.5, 0.085, 0.022), tuple(C + UP * (HH + 0.05) + N * 0.03), BODY, rot=(-0.25, 0, 0), bevel=0.006)
kit.box('BrowEdge', (0.46, 0.008, 0.008), tuple(C + UP * (HH + 0.05) + N * 0.03 + BD * 0.044), TRIM, rot=(-0.25, 0, 0))
for sx in (-1, 1):
    kit.box('LampCol', (0.018, 0.012, 2 * HH), tuple(C + RT * (sx * (HW + 0.05)) + N * 0.006), LAMP, rot=ROT)
kit.box('LampBar', (2 * HW, 0.012, 0.014), tuple(C - UP * (HH + 0.042) + N * 0.006), LAMP, rot=ROT)
# side pods angled in toward the rider, each with a stack of light ticks
for sx in (-1, 1):
    pc = Vector((sx * 0.46, -0.6, 0.91)); n = (EYE - pc).normalized(); t = math.asin(n.z); yaw = math.atan2(-n.x, n.y)
    upv = Vector((math.sin(yaw) * math.sin(t), -math.cos(yaw) * math.sin(t), math.cos(t)))
    kit.box('Pod', (0.17, 0.11, 0.16), tuple(pc), SATIN, rot=(t, 0, yaw), bevel=0.01)
    for i in range(4): kit.box('PodTick', (0.11 - i * 0.018, 0.006, 0.01), tuple(pc + n * 0.057 + upv * (-0.05 + i * 0.033)), TRIM, rot=(t, 0, yaw))
# steering column into the cowl

# ------------------------------------------------------------------ yoke (rolls with the steering)
PIV = Vector((0, -0.46, 0.93))
yoke_parts.append(kit.box('Hub', (0.15, 0.075, 0.05), tuple(PIV), ALLOY, rot=(-0.2, 0, 0), bevel=0.014))
yoke_parts.append(kit.box('HubLine', (0.1, 0.006, 0.006), tuple(PIV + Vector((0, 0.04, 0.012))), TRIM))
for sx in (-1, 1):
    yoke_parts.append(kit.tube('Bar', [(sx * 0.05, -0.46, 0.935), (sx * 0.17, -0.45, 0.96), (sx * 0.26, -0.43, 0.982), (sx * 0.30, -0.42, 0.99)], 0.014, ALLOY, res=10, bevel_res=3))
    yoke_parts.append(kit.tube('BarLine', [(sx * 0.07, -0.455, 0.95), (sx * 0.17, -0.445, 0.974), (sx * 0.26, -0.425, 0.996), (sx * 0.295, -0.418, 1.003)], 0.0028, TRIM, res=10, bevel_res=2))
    yoke_parts.append(kit.tube('Grip', [(sx * 0.30, -0.42, 0.99), (sx * 0.345, -0.39, 0.988), (sx * 0.39, -0.36, 0.985)], 0.019, RUBBER, res=6, bevel_res=4))
    yoke_parts.append(kit.tube('GripRing', [(sx * 0.2995, -0.4203, 0.99), (sx * 0.3035, -0.4175, 0.9898)], 0.022, TRIM, res=1, bevel_res=4))
    yoke_parts.append(kit.tube('GripCap', [(sx * 0.39, -0.36, 0.985), (sx * 0.396, -0.356, 0.9848)], 0.021, ALLOY, res=1, bevel_res=4))
    yoke_parts.append(kit.box('Trigger', (0.012, 0.03, 0.012), (sx * 0.33, -0.41, 1.012), TRIM))

# ------------------------------------------------------------------ tub: knee fairings with alloy rails, tank and core
for sx in (-1, 1):
    fair = kit.loft('Fairing', [(0.35, 0.04, 0.8, 0.55), (0.0, 0.05, 0.85, 0.5), (-0.35, 0.05, 0.87, 0.5), (-0.62, 0.035, 0.85, 0.55)], BODY, n=14, power=4.0); fair.location.x = sx * 0.45
    kit.tube('Rail', [(sx * 0.45, 0.35, 0.805), (sx * 0.455, 0.0, 0.857), (sx * 0.45, -0.35, 0.877), (sx * 0.445, -0.62, 0.855)], 0.009, ALLOY, res=10, bevel_res=3)
    kit.tube('RailLine', [(sx * 0.432, 0.3, 0.8), (sx * 0.436, 0.0, 0.85), (sx * 0.432, -0.35, 0.87), (sx * 0.428, -0.6, 0.85)], 0.003, TRIM, res=10, bevel_res=2)
kit.loft('Tank', [(-0.22, 0.17, 0.84, 0.5), (0.0, 0.22, 0.87, 0.48), (0.3, 0.2, 0.82, 0.48), (0.6, 0.15, 0.72, 0.5)], BODY, n=16, power=4.0)
kit.torus('CoreRing', 0.07, 0.006, (0, -0.02, 0.873), TRIM, seg=48, ring=6, flat=True)
kit.torus('CoreBezel', 0.085, 0.01, (0, -0.02, 0.868), ALLOY, seg=48, ring=8, flat=True)
bpy.ops.mesh.primitive_cylinder_add(radius=0.066, depth=0.008, vertices=40, location=(0, -0.02, 0.87)); o = bpy.context.active_object; o.data.materials.append(LENS); o.select_set(False)
kit.loft('RearDeck', [(0.45, 0.2, 0.86, 0.6), (0.7, 0.24, 0.92, 0.6), (1.0, 0.16, 0.86, 0.62)], BODY, n=14, power=4.0)
kit.box('TailLine', (0.2, 0.01, 0.01), (0, 1.0, 0.86), TRIM)

# ------------------------------------------------------------------ canopy: an open glass shell on a rear hinge
CAN = [(0.62, 0.34, 1.40, 0.86), (0.30, 0.47, 1.53, 0.86), (0.0, 0.5, 1.56, 0.86), (-0.30, 0.48, 1.49, 0.87), (-0.55, 0.42, 1.3, 0.9), (-0.74, 0.3, 1.12, 0.96)]
canopy_parts.append(shell('CanopyGlass', CAN, GLASS, n=24, power=2.6))
for sx in (-1, 1): canopy_parts.append(kit.tube('CanopyRail', [(sx * w, y, zb) for (y, w, zt, zb) in CAN], 0.007, SATIN, res=10, bevel_res=3))
# the front edge carries the light, framing the road ahead (nothing runs down the centre of the view)
y, w, zt, zb = CAN[-1]
canopy_parts.append(kit.tube('CanopyLip', [(w * math.copysign(abs(math.cos(a)) ** (2 / 2.6), math.cos(a)), y, zb + (zt - zb) * abs(math.sin(a)) ** (2 / 2.6)) for a in [math.pi * i / 16 for i in range(17)]], 0.004, TRIM, res=4, bevel_res=2))
y, w, zt, zb = CAN[0]
canopy_parts.append(kit.tube('CanopyArch', [(w * math.copysign(abs(math.cos(a)) ** (2 / 2.6), math.cos(a)), y, zb + (zt - zb) * abs(math.sin(a)) ** (2 / 2.6)) for a in [math.pi * i / 10 for i in range(11)]], 0.014, ALLOY, res=4, bevel_res=3))
HINGE = Vector((0, 0.62, 0.86))

# ------------------------------------------------------------------ export: yoke and canopy stay separate nodes
kit.apply_all()
def keep(parts, name, origin):
    o = kit.join(parts, name); bpy.context.scene.cursor.location = origin
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); o.select_set(False); return o
keep(yoke_parts, 'Yoke', PIV); keep(canopy_parts, 'Canopy', HINGE)
groups = {}
for o in bpy.context.collection.objects:
    if o.name in ('Yoke', 'Canopy'): continue
    groups.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in groups.items(): kit.join(objs, name)
tris = sum(len(p.vertices) - 2 for o in bpy.context.collection.objects for p in o.data.polygons)
bpy.ops.object.select_all(action='SELECT')
path = os.path.join(out, 'cockpit-v2.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=True)
print('COCKPIT2 objects', sorted(o.name for o in bpy.context.collection.objects), 'triangles', tris, '->', path)
