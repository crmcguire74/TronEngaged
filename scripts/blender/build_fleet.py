# Builds the rest of the air fleet (original designs): a broadcast camera drone that films the action, and a heavy
# carrier that crosses the sky far above the arenas and circuits.
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_fleet.py -- assets/generated
# Blender axes: X right, -Y forward (nose / lens), Z up. Light materials are re-skinned in the game by name.
import sys, os, math, bmesh, bpy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit

out = sys.argv[sys.argv.index('--') + 1]

def mats():
    return dict(
        shell=kit.mat('Shell', (0.03, 0.035, 0.045), 0.85, 0.32),
        panel=kit.mat('Panel', (0.08, 0.09, 0.105), 0.75, 0.4),
        alloy=kit.mat('Alloy', (0.22, 0.235, 0.26), 1.0, 0.3),
        trim=kit.mat('Trim', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 4.0),
        window=kit.mat('Window', (0, 0, 0), 0.0, 0.4, (0.35, 0.6, 0.8), 1.2),
        lens=kit.mat('Lens', (0, 0, 0), 0.0, 0.3, (1.0, 0.97, 0.9), 6.0),
        glass=kit.mat('CamGlass', (0.01, 0.02, 0.03), 0.3, 0.05),
        red=kit.mat('NavRed', (0, 0, 0), 0.0, 0.4, (1.0, 0.1, 0.05), 6.0),
        green=kit.mat('NavGreen', (0, 0, 0), 0.0, 0.4, (0.1, 1.0, 0.35), 6.0),
    )

def cyl(name, radius, depth, loc, material, axis='Y', seg=32):
    rot = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=seg, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name; o.data.materials.append(material); bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    for p in o.data.polygons: p.use_smooth = True
    o.select_set(False); return o

def ring_y(name, major, minor, loc, material, seg=40):
    """Torus whose axis runs along Y (facing forward/back)."""
    o = kit.torus(name, major, minor, loc, material, seg=seg, ring=8, flat=True)
    o.rotation_euler = (math.pi / 2, 0, 0); bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False); o.select_set(False); return o

# ---------------------------------------------------------------- broadcast drone (about 1.5 m across)
kit.reset(); M = mats()
kit.loft('Body', [(-0.46, 0.05, 0.06, -0.05), (-0.32, 0.3, 0.15, -0.13), (0.05, 0.36, 0.18, -0.15), (0.38, 0.22, 0.12, -0.1), (0.5, 0.05, 0.05, -0.04)], M['shell'], n=20, power=3.0)
kit.loft('Spine', [(-0.3, 0.05, 0.2, 0.12), (0.0, 0.09, 0.24, 0.12), (0.34, 0.04, 0.16, 0.1)], M['panel'], n=12, power=3.0)
cyl('Lens', 0.1, 0.1, (0, -0.37, -0.07), M['glass'], seg=32)
ring_y('LensRing', 0.11, 0.014, (0, -0.42, -0.07), M['trim'])
cyl('LensHood', 0.125, 0.07, (0, -0.33, -0.07), M['alloy'], seg=32)
for sx in (-1, 1):
    kit.box('Arm', (0.3, 0.08, 0.04), (sx * 0.42, 0.02, 0.02), M['alloy'], bevel=0.01)
    kit.torus('Rotor', 0.22, 0.026, (sx * 0.62, 0.02, 0.02), M['alloy'], seg=40, ring=8, flat=True)
    kit.torus('RotorGlow', 0.19, 0.008, (sx * 0.62, 0.02, 0.03), M['trim'], seg=40, ring=6, flat=True)
    cyl('Hub', 0.05, 0.07, (sx * 0.62, 0.02, 0.02), M['shell'], axis='Z', seg=16)
    kit.tube('SideLine', [(sx * 0.3, -0.3, 0.06), (sx * 0.36, 0.05, 0.08), (sx * 0.22, 0.38, 0.05)], 0.008, M['trim'], res=8, bevel_res=2)
kit.torus('Status', 0.025, 0.025, (0, 0.46, 0.06), M['red'], seg=10, ring=6)
kit.box('Belly', (0.16, 0.36, 0.02), (0, 0.02, -0.155), M['trim'])
kit.export(os.path.join(out, 'drone.glb'), 'DRONE')

# ---------------------------------------------------------------- heavy carrier (about 84 m long)
kit.reset(); M = mats()
kit.loft('Hull', [(-42, 1.5, 1.5, -1.0), (-35, 7.5, 4.5, -3.5), (-18, 12, 6, -6), (16, 12.5, 6, -6.5), (33, 10.5, 5, -5.5), (41, 8, 4, -4)], M['shell'], n=24, power=6.0, subsurf=0)
# stepped superstructure toward the stern, with glazed bands
kit.box('Deck1', (15, 34, 4), (0, 12, 7.5), M['shell'], bevel=0.4)
kit.box('Deck2', (9, 16, 4), (0, 19, 11.4), M['panel'], bevel=0.3)
kit.box('Bridge', (6, 5, 2.2), (0, 9, 14.3), M['shell'], bevel=0.3)
for sx in (-1, 1):
    kit.box('Band1', (0.12, 30, 0.7), (sx * 7.52, 12, 7.8), M['window'])
    kit.box('Band2', (0.12, 13, 0.6), (sx * 4.52, 19, 11.6), M['window'])
    # flank light lines and a row of hull lights
    kit.tube('Flank', [(sx * 7.6, -35, 0.0), (sx * 12.1, -18, 0.0), (sx * 12.6, 16, 0.0), (sx * 10.6, 33, 0.0), (sx * 8.1, 41, 0.0)], 0.18, M['trim'], res=12, bevel_res=2)
    for i in range(9): kit.box('Port', (0.2, 1.4, 0.5), (sx * 12.4, -14 + i * 3.6, -2.6), M['window'])
    kit.torus('Nav', 0.45, 0.45, (sx * 12.7, -2, 3.2), M['red'] if sx < 0 else M['green'], seg=10, ring=6)
    # outrigger engine nacelles
    kit.loft('Nacelle', [(18, 1.2, 1.2, -1.2), (24, 2.6, 2.4, -2.4), (40, 2.6, 2.4, -2.4), (44, 2.2, 2.0, -2.0)], M['panel'], n=16, power=2.4, subsurf=0).location = (sx * 15, 0, -1)
    kit.box('Pylon', (4, 8, 0.8), (sx * 13, 30, -1), M['shell'])
    ring_y('Exhaust', 2.0, 0.25, (sx * 15, 44.1, -1), M['trim'])
    cyl('Burner', 1.8, 0.3, (sx * 15, 44.0, -1), M['lens'], seg=24)
cyl('MainBurner', 3.2, 0.4, (0, 41.2, 0), M['lens'], seg=32)
ring_y('MainRing', 3.5, 0.3, (0, 41.4, 0), M['trim'])
# bow: a long spike and a lit keel; the hangar bay glows on the underside
kit.frustum('Spike', 1.4, 0.15, 0, 16, M['alloy'], sides=6, turn=0).rotation_euler = (math.pi / 2, 0, 0)
bpy.data.objects['Spike'].location = (0, -40, 0)
kit.box('Keel', (0.4, 70, 0.4), (0, 0, -6.6), M['trim'])
kit.box('Hangar', (9, 22, 0.2), (0, 6, -6.45), M['window'])
kit.export(os.path.join(out, 'carrier.glb'), 'CARRIER')
