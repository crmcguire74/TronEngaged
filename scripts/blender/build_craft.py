# Builds the patrol skimmer that circles above the arenas and circuits (original design).
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_craft.py -- assets/generated
# Blender axes: X right, -Y forward (nose), Z up. About 9 m nose to tail and 8.6 m across the wings.
# Players mostly see it from below, so the belly carries the detail: keel, lit seams, a searchlight lens and nav lights.
import sys, os, math, bmesh, bpy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit

out = sys.argv[sys.argv.index('--') + 1]
kit.reset()
SHELL = kit.mat('Shell', (0.03, 0.035, 0.045), 0.85, 0.34)
PANEL = kit.mat('Panel', (0.075, 0.085, 0.1), 0.7, 0.42)
TRIM = kit.mat('Trim', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 4.0)
GLASS = kit.mat('Window', (0.01, 0.025, 0.035), 0.2, 0.12, (0.05, 0.16, 0.22), 0.8)
LENS = kit.mat('Lens', (0, 0, 0), 0.0, 0.3, (1.0, 0.97, 0.9), 6.0)
RED = kit.mat('NavRed', (0, 0, 0), 0.0, 0.4, (1.0, 0.1, 0.05), 6.0)
GREEN = kit.mat('NavGreen', (0, 0, 0), 0.0, 0.4, (0.1, 1.0, 0.35), 6.0)

def plate(name, pts, z0, z1, material, bevel=0.0):
    """Flat slab: polygon [(x, y), ...] in plan, from z0 to z1."""
    bm = bmesh.new(); a = [bm.verts.new((x, y, z0)) for x, y in pts]; b = [bm.verts.new((x, y, z1)) for x, y in pts]; n = len(pts)
    bm.faces.new(list(reversed(a))); bm.faces.new(b)
    for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    return kit._link(name, bm, material, bevel=bevel)

def cyl(name, radius, depth, loc, material, axis='Y', seg=32):
    rot = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=seg, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name; o.data.materials.append(material); bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    for p in o.data.polygons: p.use_smooth = True
    o.select_set(False); return o

# fuselage: a long flattened blade, widest just behind the canopy
kit.loft('Hull', [(-4.6, 0.06, 0.12, -0.04), (-3.7, 0.5, 0.42, -0.26), (-2.2, 0.92, 0.7, -0.42), (0.0, 1.12, 0.8, -0.5), (2.2, 1.02, 0.66, -0.44), (3.8, 0.74, 0.48, -0.34), (4.3, 0.6, 0.4, -0.3)], SHELL, n=20, power=3.2)
kit.loft('Canopy', [(-3.3, 0.04, 0.44, 0.36), (-2.7, 0.4, 0.9, 0.46), (-1.5, 0.48, 1.0, 0.56), (-0.5, 0.3, 0.86, 0.58), (-0.05, 0.04, 0.72, 0.62)], GLASS, n=16, power=2.4)
# keel under the hull, carrying the searchlight
kit.loft('Keel', [(-2.8, 0.05, -0.3, -0.36), (-1.8, 0.4, -0.36, -0.7), (1.2, 0.46, -0.4, -0.76), (2.6, 0.08, -0.36, -0.42)], PANEL, n=16, power=4.0)
cyl('Searchlight', 0.34, 0.06, (0, -0.6, -0.78), LENS, axis='Z')
kit.torus('LensRing', 0.37, 0.035, (0, -0.6, -0.77), TRIM, seg=36, ring=6, flat=True)
for sx in (-1, 1):
    # swept wings with a thin lit leading edge and an upturned fin at each tip
    plate('Wing', [(sx * 0.9, -1.7), (sx * 4.05, 1.5), (sx * 4.3, 2.7), (sx * 0.9, 2.5)], -0.08, 0.08, SHELL)
    plate('WingPanel', [(sx * 1.4, -0.6), (sx * 3.5, 1.55), (sx * 3.6, 2.2), (sx * 1.4, 2.1)], -0.1, -0.08, PANEL)
    kit.tube('LeadEdge', [(sx * 0.95, -1.74, 0.0), (sx * 2.5, -0.15, 0.0), (sx * 4.08, 1.46, 0.0)], 0.045, TRIM, res=2, bevel_res=2)
    kit.tube('HullLine', [(sx * 0.62, -3.5, 0.18), (sx * 1.08, -1.6, 0.12), (sx * 1.12, 0.4, 0.1), (sx * 0.95, 2.6, 0.06), (sx * 0.66, 4.2, 0.02)], 0.028, TRIM, res=10, bevel_res=2)
    kit.tube('BellyLine', [(sx * 0.42, -1.7, -0.62), (sx * 0.47, 1.1, -0.68)], 0.026, TRIM, res=2, bevel_res=2)
    kit.prism('Fin', [(1.5, 0.0), (2.75, 0.0), (2.95, 0.95), (2.35, 0.95)], sx * 4.12 - 0.07, sx * 4.12 + 0.07, SHELL)
    kit.tube('FinEdge', [(sx * 4.12, 1.5, 0.05), (sx * 4.12, 2.35, 0.95)], 0.03, TRIM, res=2, bevel_res=2)
    kit.torus('Nav', 0.07, 0.07, (sx * 4.12, 2.95, 0.96), RED if sx < 0 else GREEN, seg=10, ring=6)
    # twin engine pods with lit exhaust rings
    pod = kit.loft('Pod', [(0.9, 0.24, 0.16, -0.3), (1.8, 0.4, 0.26, -0.44), (3.9, 0.42, 0.28, -0.46), (4.55, 0.36, 0.22, -0.4)], SHELL, n=16, power=2.4)
    pod.location.x = sx * 1.75
    ex = kit.torus('Exhaust', 0.3, 0.05, (sx * 1.75, 4.56, -0.09), TRIM, seg=28, ring=6, flat=True)
    ex.rotation_euler = (math.pi / 2, 0, 0); bpy.ops.object.select_all(action='DESELECT'); ex.select_set(True); bpy.context.view_layer.objects.active = ex
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False); ex.select_set(False)
    cyl('Burner', 0.26, 0.05, (sx * 1.75, 4.55, -0.09), LENS, axis='Y', seg=24)
# spine line and nose light
kit.tube('Spine', [(0, -0.1, 0.72), (0, 1.6, 0.68), (0, 3.6, 0.5)], 0.03, TRIM, res=6, bevel_res=2)
kit.box('NoseLight', (0.16, 0.08, 0.06), (0, -4.5, 0.04), LENS)
kit.export(os.path.join(out, 'patrol-craft.glb'), 'CRAFT')
