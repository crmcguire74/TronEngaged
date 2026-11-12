# Shared modelling helpers for the generated-art build scripts (run inside Blender, headless).
# Blender axes: X right, -Y forward, Z up. The glTF exporter converts to +Z forward, Y up.
import bpy, bmesh, math

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, metallic=0.0, rough=0.5, emission=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Metallic'].default_value = metallic; b.inputs['Roughness'].default_value = rough
    if emission: b.inputs['Emission Color'].default_value = (*emission, 1); b.inputs['Emission Strength'].default_value = strength
    return m

def _link(name, bm, material, smooth=False, subsurf=0, bevel=0.0):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); o.data.materials.append(material)
    if bevel > 0: m = o.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = 2; m.limit_method = 'ANGLE'
    if subsurf: m = o.modifiers.new('sub', 'SUBSURF'); m.levels = subsurf; m.render_levels = subsurf
    for p in o.data.polygons: p.use_smooth = smooth
    return o

def box(name, size, loc, material, rot=(0, 0, 0), bevel=0.0):
    """Axis-aligned box of full dimensions `size`, centred on `loc`."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    o = _link(name, bm, material, bevel=bevel); o.location = loc; o.rotation_euler = rot; return o

def prism(name, profile, x0, x1, material, bevel=0.0):
    """Extrudes a side profile [(y, z), ...] along X from x0 to x1."""
    bm = bmesh.new(); a = [bm.verts.new((x0, y, z)) for y, z in profile]; b = [bm.verts.new((x1, y, z)) for y, z in profile]; n = len(profile)
    bm.faces.new(a); bm.faces.new(list(reversed(b)))
    for i in range(n): bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]))
    return _link(name, bm, material, bevel=bevel)

def frustum(name, base, top, z0, z1, material, loc=(0, 0), sides=4, turn=math.pi / 4):
    """Tapered column: regular polygon of circumradius `base` at z0 and `top` at z1."""
    bm = bmesh.new(); lo = []; hi = []
    for i in range(sides):
        a = turn + 2 * math.pi * i / sides; c, s = math.cos(a), math.sin(a)
        lo.append(bm.verts.new((loc[0] + c * base, loc[1] + s * base, z0))); hi.append(bm.verts.new((loc[0] + c * top, loc[1] + s * top, z1)))
    bm.faces.new(list(reversed(lo))); bm.faces.new(hi)
    for i in range(sides): bm.faces.new((lo[i], lo[(i + 1) % sides], hi[(i + 1) % sides], hi[i]))
    return _link(name, bm, material)

def loft(name, sections, material, n=18, power=2.6, subsurf=1):
    """Skins superellipse cross-sections placed along Y. section = (y, half_width, z_top, z_bottom)."""
    bm = bmesh.new(); rings = []
    for (y, w, zt, zb) in sections:
        ring = []; cz = (zt + zb) / 2; h = (zt - zb) / 2
        for i in range(n):
            a = 2 * math.pi * i / n; c, s = math.cos(a), math.sin(a)
            ring.append(bm.verts.new((w * math.copysign(abs(c) ** (2 / power), c), y, cz + h * math.copysign(abs(s) ** (2 / power), s))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    return _link(name, bm, material, smooth=True, subsurf=subsurf)

def tube(name, pts, radius, material, res=8, bevel_res=3):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = radius; cu.bevel_resolution = bevel_res; cu.resolution_u = res; cu.use_fill_caps = True
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1)
    for p, co in zip(sp.points, pts): p.co = (*co, 1)
    sp.use_endpoint_u = True; sp.order_u = min(4, len(pts))
    o = bpy.data.objects.new(name, cu); bpy.context.collection.objects.link(o); o.data.materials.append(material)
    bpy.context.view_layer.objects.active = o; o.select_set(True); bpy.ops.object.convert(target='MESH'); o = bpy.context.active_object
    for p in o.data.polygons: p.use_smooth = True
    o.select_set(False); return o

def torus(name, major, minor, loc, material, width=1.0, seg=40, ring=10, flat=False):
    """Wheel-style torus in the Y-Z plane (axis along X), or lying flat (axis Z). `width` stretches the tube along the axis."""
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=seg, minor_segments=ring, location=loc, rotation=(0, 0 if flat else math.pi / 2, 0))
    o = bpy.context.active_object; o.name = name; o.scale = (1, 1, width); o.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for p in o.data.polygons: p.use_smooth = True
    o.select_set(False); return o

def disc(name, radius, width, loc, material, seg=28):
    """Solid wheel hub: a cylinder with its axis along X."""
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=width, vertices=seg, location=loc, rotation=(0, math.pi / 2, 0))
    o = bpy.context.active_object; o.name = name; o.data.materials.append(material); bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    o.select_set(False); return o

def apply_all():
    bpy.ops.object.select_all(action='DESELECT')
    for o in list(bpy.context.collection.objects):
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
        o.select_set(False)

def join(objs, name, origin_to_bounds=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.active_object; o.name = name
    if origin_to_bounds: bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    o.select_set(False); return o

def export(path, label, keep_prefix=None):
    """Joins everything by material (few draw calls), except objects whose name starts with `keep_prefix`, and writes a GLB."""
    apply_all(); groups = {}
    for o in bpy.context.collection.objects:
        if keep_prefix and o.name.startswith(keep_prefix): continue
        groups.setdefault(o.data.materials[0].name, []).append(o)
    for name, objs in groups.items(): join(objs, name)
    tris = sum(len(p.vertices) - 2 for o in bpy.context.collection.objects for p in o.data.polygons)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=True, export_extras=True)
    print(label, 'objects', [o.name for o in bpy.context.collection.objects], 'triangles', tris, '->', path)
    for o in list(bpy.context.collection.objects): bpy.data.objects.remove(o, do_unlink=True)
