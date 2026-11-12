# Builds the first-person cockpit used in cockpit view and VR.
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_cockpit.py -- assets/generated/cockpit.glb
# Blender axes: X right, -Y forward, Z up (exports to glTF +Z forward, Y up). Rider eye is near (0, 0.2, 1.27).
import bpy, bmesh, math, sys
from mathutils import Vector

out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, metallic=0.0, rough=0.5, emission=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Metallic'].default_value = metallic; b.inputs['Roughness'].default_value = rough
    if emission: b.inputs['Emission Color'].default_value = (*emission, 1); b.inputs['Emission Strength'].default_value = strength
    return m

BODY = mat('Body', (0.02, 0.024, 0.032), 0.8, 0.44)   # satin, not gloss: the form should read, not the reflections
PANEL = mat('Panel', (0.022, 0.026, 0.034), 0.5, 0.5)
METAL = mat('Metal', (0.045, 0.05, 0.06), 0.9, 0.3)   # dark alloy: nothing in the cockpit is chrome
GRIP = mat('Grip', (0.012, 0.012, 0.014), 0.0, 0.9)
TRIM = mat('Trim', (0.0, 0.0, 0.0), 0.0, 0.4, (0.31, 0.89, 1.0), 4.0)
SCREEN = mat('Screen', (0.0, 0.0, 0.0), 0.0, 0.3, (0.1, 0.3, 0.4), 1.0)

def finish(obj, material, subsurf=2, bevel=0.0):
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    obj.data.materials.append(material)
    if bevel > 0: m = obj.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = 3; m.limit_method = 'ANGLE'
    if subsurf: m = obj.modifiers.new('sub', 'SUBSURF'); m.levels = subsurf; m.render_levels = subsurf
    for p in obj.data.polygons: p.use_smooth = True
    obj.select_set(False); return obj

def loft(name, sections, material, n=20, power=2.6, subsurf=2):
    """Skins superellipse cross-sections placed along Y. section = (y, half_width, z_top, z_bottom)."""
    bm = bmesh.new(); rings = []
    for (y, w, zt, zb) in sections:
        ring = []; cz = (zt + zb) / 2; h = (zt - zb) / 2
        for i in range(n):
            a = 2 * math.pi * i / n; c, s = math.cos(a), math.sin(a)
            x = w * math.copysign(abs(c) ** (2 / power), c); z = cz + h * math.copysign(abs(s) ** (2 / power), s)
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(obj)
    return finish(obj, material, subsurf)

def box(name, size, loc, rot, material, bevel=0.012, subsurf=1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); o = bpy.context.active_object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True); o.select_set(False); return finish(o, material, subsurf, bevel)

def tube(name, pts, radius, material, res=10):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = radius; cu.bevel_resolution = 4; cu.resolution_u = res; cu.use_fill_caps = True
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1)
    for p, co in zip(sp.points, pts): p.co = (*co, 1)
    sp.use_endpoint_u = True; sp.order_u = min(4, len(pts))
    o = bpy.data.objects.new(name, cu); bpy.context.collection.objects.link(o); o.data.materials.append(material)
    bpy.context.view_layer.objects.active = o; o.select_set(True); bpy.ops.object.convert(target='MESH'); o = bpy.context.active_object
    for p in o.data.polygons: p.use_smooth = True
    o.select_set(False); return o

# --- forward cowl: one continuous swept surface from the rider to the prow
loft('Cowl', [(-0.16, 0.30, 0.955, 0.56), (-0.34, 0.385, 0.985, 0.50), (-0.62, 0.40, 0.975, 0.46), (-0.95, 0.34, 0.90, 0.43), (-1.25, 0.24, 0.80, 0.42), (-1.48, 0.13, 0.69, 0.45), (-1.62, 0.035, 0.60, 0.53)], BODY, power=4.4)
# --- tank between the knees
loft('Tank', [(-0.20, 0.19, 0.90, 0.52), (0.02, 0.235, 0.925, 0.50), (0.30, 0.215, 0.86, 0.50), (0.58, 0.17, 0.75, 0.52)], BODY, n=16, power=4.0)
# --- shoulders of the fairing, giving the view a framed, architectural edge
for sx in (-1, 1):
    loft('Shoulder', [(-0.22, 0.045, 0.93, 0.70), (-0.55, 0.06, 0.965, 0.66), (-0.95, 0.05, 0.90, 0.62), (-1.30, 0.03, 0.80, 0.60)], BODY, n=12).location.x = sx * 0.43
    # restrained light strip along each shoulder (never down the centre line of sight)
    tube('TrimRail', [(sx * 0.405, -0.20, 0.972), (sx * 0.425, -0.55, 1.004), (sx * 0.395, -0.95, 0.94), (sx * 0.30, -1.28, 0.842), (sx * 0.17, -1.50, 0.732)], 0.0055, TRIM)
for sx in (-1, 1):
    tube('Chevron', [(sx * 0.215, -0.66, 0.985), (sx * 0.17, -0.98, 0.905), (sx * 0.105, -1.27, 0.803), (sx * 0.045, -1.50, 0.695)], 0.0042, TRIM)
# energy core set flush in the tank between the knees
bpy.ops.mesh.primitive_torus_add(major_radius=0.062, minor_radius=0.0055, major_segments=40, minor_segments=6, location=(0, 0.06, 0.93), rotation=(math.radians(5), 0, 0))
core = bpy.context.active_object; core.name = 'CoreRing'; core.data.materials.append(TRIM); core.select_set(False)
bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.006, vertices=32, location=(0, 0.06, 0.929), rotation=(math.radians(5), 0, 0))
lens = bpy.context.active_object; lens.name = 'CoreLens'; lens.data.materials.append(PANEL); lens.select_set(False)
# prow marker
box('Prow', (0.16, 0.012, 0.012), (0, -1.615, 0.612), (0, 0, 0), TRIM, bevel=0.003, subsurf=0)

# --- instrument: a thin pane of light standing clear of the cowl on a single blade (no hood, no housing)
tilt = math.radians(-27)
box('PaneBack', (0.43, 0.01, 0.225), (0, -0.468, 1.041), (tilt, 0, 0), PANEL, bevel=0.004, subsurf=0)
box('PaneStalk', (0.05, 0.03, 0.16), (0, -0.50, 0.93), (math.radians(-14), 0, 0), METAL, bevel=0.01)
c0, s0 = math.cos(tilt), math.sin(tilt)
for (dx, dz, w, h) in ((0, 0.1125, 0.434, 0.004), (0, -0.1125, 0.434, 0.004), (0.215, 0, 0.004, 0.229), (-0.215, 0, 0.004, 0.229)):
    box('PaneEdge', (w, 0.006, h), (dx, -0.4625 + s0 * dz * -1, 1.041 + c0 * dz), (tilt, 0, 0), TRIM, bevel=0.0, subsurf=0)
# screen quad: normal toward the rider; U runs toward the rider's right (-X); V is pre-flipped for a canvas texture
c, s = math.cos(tilt), math.sin(tilt); ctr = Vector((0, -0.4585, 1.041)); hw, hh = 0.195, 0.0975
up = Vector((0, -s, c)); rt = Vector((-1, 0, 0))
me = bpy.data.meshes.new('Screen'); vs = [ctr - rt * hw - up * hh, ctr + rt * hw - up * hh, ctr + rt * hw + up * hh, ctr - rt * hw + up * hh]
me.from_pydata([tuple(v) for v in vs], [], [(0, 1, 2, 3)]); uv = me.uv_layers.new(name='UVMap')
for loop, t in zip(me.loops, [(0, 1), (1, 1), (1, 0), (0, 0)]): uv.data[loop.index].uv = t
scr = bpy.data.objects.new('Screen', me); bpy.context.collection.objects.link(scr); scr.data.materials.append(SCREEN)
# status pips under the screen
for i in range(5): box('Pip', (0.018, 0.006, 0.008), ((i - 2) * 0.05, -0.412, 0.944), (tilt, 0, 0), TRIM, bevel=0.002, subsurf=0)

# --- steering: a low yoke with swept blade bars, each carrying a line of light, and ringed grips
box('Yoke', (0.15, 0.085, 0.04), (0, -0.33, 0.985), (math.radians(-12), 0, 0), METAL, bevel=0.014)
box('YokeLine', (0.09, 0.004, 0.004), (0, -0.372, 0.998), (math.radians(-12), 0, 0), TRIM, bevel=0.0, subsurf=0)
for sx in (-1, 1):
    tube('Bar', [(sx * 0.03, -0.33, 1.0), (sx * 0.14, -0.325, 1.035), (sx * 0.25, -0.26, 1.03), (sx * 0.33, -0.17, 1.005)], 0.0145, METAL)
    tube('BarLine', [(sx * 0.05, -0.345, 1.006), (sx * 0.14, -0.340, 1.038), (sx * 0.25, -0.275, 1.033), (sx * 0.322, -0.188, 1.01)], 0.0032, TRIM)
    tube('Grip', [(sx * 0.33, -0.17, 1.005), (sx * 0.365, -0.125, 0.992), (sx * 0.40, -0.075, 0.978)], 0.0205, GRIP)
    tube('GripRingA', [(sx * 0.331, -0.1685, 1.0046), (sx * 0.334, -0.1645, 1.0034)], 0.0228, TRIM, res=2)
    tube('GripCap', [(sx * 0.40, -0.075, 0.978), (sx * 0.404, -0.069, 0.9765)], 0.0228, TRIM, res=2)

# apply modifiers and join by material so the runtime gets a handful of draw calls
bpy.ops.object.select_all(action='DESELECT')
for o in list(bpy.context.collection.objects):
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    o.select_set(False)
groups = {}
for o in bpy.context.collection.objects: groups.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    bpy.context.active_object.name = name
tris = sum(len(p.vertices) - 2 for o in bpy.context.collection.objects for p in o.data.polygons)
print('COCKPIT objects', [o.name for o in bpy.context.collection.objects], 'triangles', tris)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True, use_selection=True)
print('COCKPIT wrote', out)
