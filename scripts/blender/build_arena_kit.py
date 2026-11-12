# Builds the stadium kit that surrounds the cycle grid: a 16 m grandstand module and a corner pylon.
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_arena_kit.py -- assets/generated
# Module frame: X runs along the arena side, +Y points away from the arena, Z up. y = 0 is the module's inner face.
# The arena deck is at z = 0 and the surrounding floor at z = -5, so the kit reaches down to -5.2.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit

out = sys.argv[sys.argv.index('--') + 1]

def materials():
    return dict(
        shell=kit.mat('Shell', (0.022, 0.028, 0.04), 0.8, 0.38),
        deck=kit.mat('Deck', (0.05, 0.058, 0.072), 0.3, 0.7),
        trim=kit.mat('Trim', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 4.0),
        window=kit.mat('Window', (0, 0, 0), 0.0, 0.4, (0.35, 0.6, 0.8), 0.6),
    )

# ---------------------------------------------------------------- grandstand module
kit.reset(); M = materials(); W = 16.0; h = W / 2
# retaining wall facing the grid, with a light line along its lip
kit.box('Wall', (W, 1.6, 8.4), (0, 0.8, -1.0), M['shell'])
kit.box('WallLip', (W, 0.16, 0.16), (0, -0.02, 3.2), M['trim'])
kit.box('WallLine', (W, 0.06, 0.1), (0, -0.02, 0.9), M['trim'])
# raked seating deck with tread lights
kit.prism('Rake', [(1.6, 3.2), (15.0, 11.4), (15.0, 12.2), (1.6, 4.0)], -h, h, M['deck'])
for i in range(6):
    t = (i + 0.5) / 6; y = 1.6 + 13.4 * t; z = 4.0 + 8.2 * t
    kit.box('Tread', (W - 1.4, 0.12, 0.07), (0, y, z + 0.06), M['trim'])
# rear wall, glazed gallery and the roof that leans out over the seating
kit.box('Back', (W, 1.6, 23.4), (0, 15.8, 6.5), M['shell'])
kit.box('Gallery', (W - 1.6, 0.1, 3.4), (0, 14.96, 14.6), M['window'])
for i in range(7): kit.box('Mullion', (0.16, 0.16, 3.6), (-h + 1.6 + i * (W - 3.2) / 6, 14.92, 14.6), M['shell'])
kit.prism('Roof', [(16.6, 18.2), (4.6, 21.6), (4.6, 22.1), (16.6, 19.4)], -h, h, M['shell'])
kit.box('RoofLip', (W, 0.2, 0.2), (0, 4.6, 21.82), M['trim'])
kit.prism('RoofSoffit', [(15.0, 18.3), (6.0, 20.85), (6.0, 20.95), (15.0, 18.4)], -h + 2.2, h - 2.2, M['window'])
# buttress fins on the module seams give the long sides a rhythm
for sx in (-1, 1):
    x = sx * (h - 0.3)
    kit.prism('Fin', [(-0.6, -5.2), (-0.6, 3.6), (4.4, 22.3), (17.4, 19.6), (17.4, -5.2)], x - 0.3, x + 0.3, M['shell'])
    kit.prism('FinEdge', [(-0.68, 0.0), (-0.68, 3.6), (4.34, 22.3), (4.5, 22.3), (-0.52, 3.6), (-0.52, 0.0)], x - 0.08, x + 0.08, M['trim'])
kit.export(os.path.join(out, 'arena-stand.glb'), 'STAND')

# ---------------------------------------------------------------- corner pylon (centred on the origin)
kit.reset(); M = materials()
kit.frustum('Base', 7.2, 6.0, -5.2, 6.0, M['shell'])
kit.frustum('Shaft1', 5.2, 4.2, 6.0, 26.0, M['shell'])
kit.frustum('Shaft2', 3.6, 2.6, 26.6, 42.0, M['shell'])
kit.frustum('Cap', 2.9, 0.5, 42.6, 47.0, M['shell'])
kit.frustum('Spire', 0.22, 0.05, 47.0, 58.0, M['trim'], sides=6, turn=0)
for z, r in ((6.0, 6.2), (26.0, 4.4), (42.0, 2.95)): kit.frustum('Band', r, r, z, z + 0.6, M['trim'])
# light seams up the faces of each tier, and lit slots near the base
for k in range(4):
    a = k * math.pi / 2; c, s = math.cos(a), math.sin(a)
    for (r0, r1, z0, z1) in ((5.2, 4.2, 7.4, 25.2), (3.6, 2.6, 27.6, 41.2)):
        f = 0.7071; m0 = r0 * f + 0.05; m1 = r1 * f + 0.05
        kit.tube('Seam', [(c * m0, s * m0, z0), (c * m1, s * m1, z1)], 0.22, M['trim'], res=1, bevel_res=1)
    kit.box('Slot', (2.4, 0.12, 1.2), (c * 4.75, s * 4.75, 2.2), M['window'], rot=(0, 0, a + math.pi / 2))
# a floating halo above the cap
kit.torus('Halo', 4.4, 0.18, (0, 0, 50.0), M['trim'], seg=48, ring=6, flat=True)
kit.export(os.path.join(out, 'arena-pylon.glb'), 'PYLON')
