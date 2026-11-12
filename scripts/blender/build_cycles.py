# Builds two original rival cycles. Both are enclosed machines (no visible rider), so they need no rider rig.
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_cycles.py -- assets/generated
# Blender axes: X right, -Y forward, Z up. Wheels are separate objects named Wheel*, with a `radius` property the game
# uses to spin them at road speed. The `Trim` material is recoloured per rider at runtime.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit

out = sys.argv[sys.argv.index('--') + 1]

def materials():
    return dict(
        body=kit.mat('Body', (0.02, 0.025, 0.035), 0.85, 0.3),
        armor=kit.mat('Armor', (0.11, 0.12, 0.14), 0.9, 0.36),
        tire=kit.mat('Tire', (0.012, 0.012, 0.014), 0.0, 0.85),
        glass=kit.mat('Glass', (0.004, 0.006, 0.01), 0.2, 0.06),
        metal=kit.mat('Metal', (0.4, 0.44, 0.5), 1.0, 0.3),
        trim=kit.mat('Trim', (0, 0, 0), 0.0, 0.4, (0.31, 0.89, 1.0), 4.0),
    )

def wheel(name, M, R, y, half_w, hub=0.0, marks=3):
    """Tyre, rim lights and rotation marks, joined into one object pivoting on its axle."""
    t = 0.085 if R < 0.6 else 0.1; parts = [kit.torus(name + 'Tyre', R - t, t, (0, y, R), M['tire'], width=half_w / t)]
    for sx in (-1, 1):
        parts.append(kit.torus(name + 'Rim', R - 2 * t - 0.015, 0.014, (sx * half_w * 0.86, y, R), M['trim'], seg=40, ring=5))
        for k in range(marks):
            a = 2 * math.pi * k / marks
            if hub > 0:   # spokes from hub to rim
                r0, r1 = hub - 0.01, R - 2 * t - 0.01; rm = (r0 + r1) / 2
                parts.append(kit.box(name + 'Spoke', (0.016, r1 - r0, 0.034), (sx * (half_w * 0.8 + 0.006), y + math.cos(a) * rm, R + math.sin(a) * rm), M['trim'], rot=(a, 0, 0)))
            else:         # dashes on the sidewall of a hubless ring
                parts.append(kit.box(name + 'Dash', (0.012, 0.035, 0.2), (sx * (half_w + 0.004), y + math.cos(a) * (R - t), R + math.sin(a) * (R - t)), M['trim'], rot=(a, 0, 0)))
    if hub > 0: parts.append(kit.disc(name + 'Hub', hub, half_w * 1.6, (0, y, R), M['body']))
    o = kit.join(parts, name, origin_to_bounds=True); o['radius'] = R; return o

def lines(name, M, pts, radius=0.012):
    for sx in (-1, 1): kit.tube(name, [(sx * x, y, z) for x, y, z in pts], radius, M['trim'], res=6, bevel_res=1)

# ---------------------------------------------------------------- Lancer: long, low, a blade over each wheel
kit.reset(); M = materials()
wheel('WheelRear', M, 0.50, 1.0, 0.1, hub=0.17)
wheel('WheelFront', M, 0.40, -1.02, 0.09, hub=0.13)
kit.loft('Pod', [(0.48, 0.11, 0.74, 0.34), (0.25, 0.22, 0.98, 0.24), (-0.10, 0.25, 1.00, 0.20), (-0.40, 0.19, 0.84, 0.24), (-0.60, 0.09, 0.66, 0.34)], M['body'])
kit.loft('Canopy', [(0.30, 0.13, 1.09, 0.9), (0.0, 0.165, 1.15, 0.9), (-0.32, 0.12, 1.02, 0.84)], M['glass'], n=14)
kit.loft('Lance', [(-0.30, 0.115, 0.93, 0.81), (-0.80, 0.088, 0.955, 0.865), (-1.25, 0.056, 0.905, 0.845), (-1.74, 0.012, 0.745, 0.73)], M['armor'], n=12)
kit.loft('Tail', [(0.26, 0.10, 0.99, 0.87), (0.75, 0.088, 1.115, 1.03), (1.2, 0.06, 1.095, 1.04), (1.64, 0.012, 0.93, 0.915)], M['armor'], n=12)
lines('LanceLine', M, [(0.118, -0.30, 0.87), (0.092, -0.80, 0.91), (0.06, -1.25, 0.875), (0.014, -1.74, 0.738)])
lines('TailLine', M, [(0.104, 0.26, 0.93), (0.092, 0.75, 1.07), (0.064, 1.2, 1.068), (0.014, 1.64, 0.922)])
lines('FlankLine', M, [(0.205, 0.42, 0.6), (0.262, 0.0, 0.62), (0.205, -0.45, 0.55)], 0.014)
for sx in (-1, 1):
    kit.tube('ArmRear', [(sx * 0.135, 0.38, 0.5), (sx * 0.135, 1.0, 0.5)], 0.03, M['metal'], res=1)
    kit.tube('ArmFront', [(sx * 0.115, -0.5, 0.48), (sx * 0.115, -1.02, 0.40)], 0.028, M['metal'], res=1)
kit.export(os.path.join(out, 'cycle-lancer.glb'), 'LANCER', keep_prefix='Wheel')

# ---------------------------------------------------------------- Bulwark: one great ring wheel around an armoured pod
kit.reset(); M = materials()
wheel('WheelMain', M, 0.70, 0.0, 0.17, marks=8)
wheel('WheelRear', M, 0.20, 1.34, 0.06, hub=0.08)
kit.loft('Pod', [(0.40, 0.20, 0.86, 0.54), (0.18, 0.30, 1.06, 0.34), (-0.12, 0.31, 1.07, 0.32), (-0.40, 0.21, 0.86, 0.52)], M['body'])
kit.loft('Visor', [(-0.13, 0.318, 0.99, 0.83), (-0.29, 0.278, 0.95, 0.79), (-0.415, 0.218, 0.86, 0.75)], M['glass'], n=14)
for sx in (-1, 1):
    x0, x1 = (0.2, 0.262) if sx > 0 else (-0.262, -0.2)
    kit.prism('Shield', [(-0.55, 0.25), (-0.3, 0.95), (0.45, 1.0), (0.7, 0.4), (0.3, 0.18), (-0.3, 0.16)], x0, x1, M['armor'], bevel=0.012)
    kit.prism('Prong', [(-0.5, 0.3), (-0.5, 0.62), (-1.25, 0.345), (-1.25, 0.27)], x0, x1, M['armor'], bevel=0.008)
    kit.tube('Boom', [(sx * 0.235, 0.6, 0.6), (sx * 0.2, 1.0, 0.36), (sx * 0.1, 1.34, 0.2)], 0.034, M['metal'], res=6)
lines('ShieldLine', M, [(0.27, -0.42, 0.62), (0.27, -0.28, 0.93), (0.27, 0.44, 0.98), (0.27, 0.66, 0.44)], 0.014)
lines('ProngLine', M, [(0.27, -0.5, 0.625), (0.27, -1.25, 0.35)])
kit.box('Lamp', (0.4, 0.035, 0.035), (0, -1.24, 0.31), M['trim'])
kit.export(os.path.join(out, 'cycle-bulwark.glb'), 'BULWARK', keep_prefix='Wheel')
