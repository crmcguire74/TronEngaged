# Overwatch Hauler: the heavy craft that stands over the Outlands events — an original design, built here because the
# obvious reference model on Sketchfab carries a licence that does not allow its file to be redistributed in a build.
#
# Silhouette: a wide arched spine carried on two raked legs, a sensor gondola slung underneath, four lift pods, and a
# sweep of hardlight bands down the spine. Nothing about it is a copy of a film prop; it is drawn from the same
# vocabulary as the rest of the game's fleet (see build_fleet.py, build_craft.py).
#
#   python3 scripts/blender/build_hauler.py -- assets/generated
#   blender -b --python scripts/blender/build_hauler.py -- assets/generated
#
# Blender axes: X right, -Y forward, Z up. Materials: Body, Chrome, Trim (accent, recoloured per environment), Lens.
import bpy  # first: bmesh is a compiled submodule that bpy registers on import
import sys, os, math, bmesh
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/generated'
kit.reset()
BODY = kit.mat('Body', (0.012, 0.014, 0.018), 0.55, 0.38)
CHROME = kit.mat('Chrome', (0.62, 0.66, 0.71), 1.0, 0.22)
TRIM = kit.mat('Trim', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 4.0)
LENS = kit.mat('Lens', (0.01, 0.012, 0.015), 0.3, 0.06)

SPAN, HEIGHT = 46.0, 26.0

def arch_pts(z0, lift, inset=0.0, n=21):
    """Points along the main arch: a flattened catenary from one leg top to the other."""
    pts = []
    for i in range(n):
        u = i / (n - 1)
        x = (u * 2 - 1) * (SPAN / 2 - inset)
        z = z0 + lift * math.sin(math.pi * u) ** 0.8
        pts.append((x, 0.0, z))
    return pts

# ---------------------------------------------------------------- spine: a deep arched beam
spine = kit.tube('Spine', arch_pts(HEIGHT * 0.52, HEIGHT * 0.34), 2.2, BODY, res=16, bevel_res=6)
kit.tube('SpineCap', arch_pts(HEIGHT * 0.52 + 2.0, HEIGHT * 0.34), 0.9, CHROME, res=14, bevel_res=4)
# hardlight bands running the length of the spine, one over and one under
kit.tube('SpineBandTop', arch_pts(HEIGHT * 0.52 + 1.55, HEIGHT * 0.34), 0.30, TRIM, res=14, bevel_res=3)
kit.tube('SpineBandLow', arch_pts(HEIGHT * 0.52 - 1.6, HEIGHT * 0.34), 0.24, TRIM, res=14, bevel_res=3)
# ribs across the beam, which is what makes it read as structure rather than a bent pipe
for i in range(9):
    u = (i + 0.5) / 9
    x = (u * 2 - 1) * (SPAN / 2 - 3.0)
    z = HEIGHT * 0.52 + HEIGHT * 0.34 * math.sin(math.pi * u) ** 0.8
    r = kit.box('Rib', (0.7, 5.2, 0.6), (x, 0, z), CHROME, bevel=0.12)
    r.rotation_euler = (0, (u - 0.5) * 0.9, 0)

# ---------------------------------------------------------------- legs: raked, tapered, with lit shins
for sx in (-1, 1):
    top = Vector((sx * (SPAN / 2 - 0.8), 0.0, HEIGHT * 0.52))
    knee = Vector((sx * (SPAN / 2 + 2.6), 0.6, HEIGHT * 0.24))
    foot = Vector((sx * (SPAN / 2 - 1.2), -1.4, 0.0))
    kit.tube('Leg', [tuple(top), tuple(knee), tuple(foot)], 1.5, BODY, res=14, bevel_res=5)
    kit.tube('LegBand', [(top.x - sx * 1.1, top.y, top.z - 1.0), (knee.x - sx * 1.1, knee.y, knee.z), (foot.x - sx * 1.1, foot.y, foot.z + 2.0)], 0.26, TRIM, res=12, bevel_res=3)
    # ankle block and a wide pad, so the craft reads as something that can set down
    kit.box('Ankle', (3.0, 3.4, 1.6), (foot.x, foot.y, 1.3), CHROME, bevel=0.2)
    kit.box('Pad', (4.6, 5.6, 0.7), (foot.x, foot.y, 0.35), BODY, bevel=0.2)
    kit.box('PadGlow', (4.0, 5.0, 0.16), (foot.x, foot.y, 0.70), TRIM)
    # lift pods: two per leg, outboard on short pylons
    for sy in (-1, 1):
        py = Vector((sx * (SPAN / 2 + 5.4), sy * 5.2, HEIGHT * 0.40))
        kit.box('Pylon', (5.0, 1.0, 0.9), (sx * (SPAN / 2 + 2.4), sy * 4.4, HEIGHT * 0.42), CHROME, bevel=0.1)
        kit.torus('Pod', 2.5, 0.85, tuple(py), BODY, seg=28, ring=8, flat=True)
        kit.torus('PodRing', 1.9, 0.26, (py.x, py.y, py.z + 0.1), TRIM, seg=28, ring=6, flat=True)

# ---------------------------------------------------------------- gondola: the crew pod slung under the arch
GOND = [(-7.0, 1.5, HEIGHT * 0.70, HEIGHT * 0.62), (-3.0, 3.1, HEIGHT * 0.74, HEIGHT * 0.54),
        (3.0, 3.3, HEIGHT * 0.74, HEIGHT * 0.54), (7.5, 2.0, HEIGHT * 0.70, HEIGHT * 0.60)]
kit.loft('Gondola', GOND, BODY, n=18, power=3.2)
kit.box('GondolaBand', (13.0, 0.5, 0.34), (0, -2.9, HEIGHT * 0.645), TRIM)
kit.box('GondolaBand2', (13.0, 0.5, 0.34), (0, 2.9, HEIGHT * 0.645), TRIM)
# forward sensor face: dark glass behind a chrome brow
kit.box('Brow', (6.4, 0.6, 1.1), (0, -3.3, HEIGHT * 0.70), CHROME, bevel=0.1)
kit.box('SensorGlass', (5.6, 0.3, 1.5), (0, -3.25, HEIGHT * 0.655), LENS)
for sx in (-1, 1):
    kit.box('Lamp', (0.8, 0.5, 0.8), (sx * 3.6, -3.35, HEIGHT * 0.62), TRIM)
# hangers tying the gondola to the spine
for x in (-5.0, 0.0, 5.0):
    z = HEIGHT * 0.52 + HEIGHT * 0.34 * math.sin(math.pi * (x / SPAN + 0.5)) ** 0.8
    kit.box('Hanger', (0.55, 0.55, max(1.0, z - HEIGHT * 0.74)), (x, 0, (z + HEIGHT * 0.74) / 2), CHROME, bevel=0.08)

# ---------------------------------------------------------------- searchlight cone under the gondola
cone = kit.frustum('Beam', 1.1, 7.0, HEIGHT * 0.54, HEIGHT * 0.54 - 22.0, TRIM, sides=16)
cone.name = 'Beam'

kit.export(os.path.join(out, 'hauler.glb'), 'HAULER')
