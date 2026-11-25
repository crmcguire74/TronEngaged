import * as THREE from 'three';
import { Rng } from '../../engine/math';
import type { Theme } from '../../engine/env';

/**
 * Disc Arena set pieces: one original Blender module (scripts/blender/build_arena_frame.py, a hexagonal portal frame)
 * arranged differently for each environment, so every five-tier block has its own architecture round the chamber:
 *
 *   classic-stadium    a ring of portals facing the fight
 *   vertical-chamber   stacked columns, three portals high
 *   data-core          three tilted rings of portals that turn round the arena at different speeds
 *   fractured-lattice  a broken ring: portals knocked off true, some sunk into the floor
 *   corruption-zone    half-drowned portals that heave slowly up and down
 *   grand-colosseum    a two-deep colonnade of tall portals
 *   null-sector        a sparse field of portals drifting in the void
 *
 * The frame's two materials become two InstancedMeshes, so a whole layout is two draw calls. Static layouts are placed
 * once; moving ones rewrite their matrices each frame (a few dozen at most). Fewer frames in a headset.
 */
interface Slot { x: number; y: number; z: number; yaw: number; tiltX: number; tiltZ: number; s: number; spin?: { ring: number; speed: number; r: number; a0: number; tilt: number }; bob?: { amp: number; speed: number; phase: number } }

export class ArenaFrames {
  readonly group = new THREE.Group(); private meshes: THREE.InstancedMesh[] = []; private slots: Slot[] = []; private trim: THREE.MeshBasicMaterial | null = null; private animated = false;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private sc = new THREE.Vector3(); private base = new THREE.Color();

  constructor(src: THREE.Object3D | null, env: string, th: Theme, floor: number, seed: number, xr: boolean) {
    if (!src) return;
    this.slots = layout(env, floor, new Rng(seed), xr); this.animated = this.slots.some((s) => s.spin || s.bob);
    this.base.set(th.accent).multiplyScalar(1.5);
    src.updateMatrixWorld(true);
    src.traverse((o: any) => {
      if (!o.isMesh) return; const isTrim = o.material?.name === 'Trim';
      const mat = isTrim ? (this.trim = new THREE.MeshBasicMaterial({ color: this.base.clone() })) : o.material;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      const im = new THREE.InstancedMesh(g, mat, this.slots.length); im.frustumCulled = false; im.castShadow = false; this.meshes.push(im); this.group.add(im);
    });
    this.place(0);
  }
  private place(t: number) {
    this.slots.forEach((s, i) => {
      let { x, y, z, yaw } = s; let tx = s.tiltX, tz = s.tiltZ;
      if (s.spin) { const a = s.spin.a0 + t * s.spin.speed; x = Math.cos(a) * s.spin.r; z = Math.sin(a) * s.spin.r; yaw = Math.atan2(-x, -z); tz = s.spin.tilt * Math.cos(a); tx = s.spin.tilt * Math.sin(a); }
      if (s.bob) y += Math.sin(t * s.bob.speed + s.bob.phase) * s.bob.amp;
      this.q.setFromEuler(this.e.set(tx, yaw, tz, 'YXZ')); this.m4.compose(this.v.set(x, y, z), this.q, this.sc.setScalar(s.s));
      for (const m of this.meshes) m.setMatrixAt(i, this.m4);
    });
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
  /** t: clock; beat: 0..1 pulse shared with the ambient layer, so the architecture breathes with the fight. */
  update(t: number, beat: number) {
    if (this.animated) this.place(t);
    if (this.trim) this.trim.color.copy(this.base).multiplyScalar(0.75 + 0.25 * Math.sin(t * 1.3) + 0.5 * beat);
  }
}

/** Every slot faces the arena centre unless a layout says otherwise. */
const facing = (x: number, z: number) => Math.atan2(-x, -z);

function layout(env: string, floor: number, rng: Rng, xr: boolean): Slot[] {
  const out: Slot[] = [], ring = (n: number, r: number, y: number, s: number, phase = 0) => { for (let i = 0; i < n; i++) { const a = phase + (i / n) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r; out.push({ x, y, z, yaw: facing(x, z), tiltX: 0, tiltZ: 0, s }); } };
  const k = xr ? 0.67 : 1, n = (v: number) => Math.max(4, Math.round(v * k));
  switch (env) {
    case 'vertical-chamber': for (let i = 0; i < n(8); i++) { const a = (i / n(8)) * Math.PI * 2 + 0.2, x = Math.cos(a) * 33, z = Math.sin(a) * 33; for (let h = 0; h < 3; h++) out.push({ x, y: floor + h * 8.6, z, yaw: facing(x, z), tiltX: 0, tiltZ: 0, s: 1 }); } break;
    case 'data-core': for (let r = 0; r < 3; r++) { const cnt = n(8); for (let i = 0; i < cnt; i++) out.push({ x: 0, y: floor + 4 + r * 7, z: 0, yaw: 0, tiltX: 0, tiltZ: 0, s: 0.9 + r * 0.15, spin: { ring: r, speed: (r % 2 ? -1 : 1) * (0.05 + r * 0.025), r: 34 + r * 6, a0: (i / cnt) * Math.PI * 2 + r * 0.4, tilt: 0.12 + r * 0.06 } }); } break;
    case 'fractured-lattice': for (let i = 0; i < n(14); i++) { const a = (i / n(14)) * Math.PI * 2 + rng.range(-0.1, 0.1), r = rng.range(32, 44), x = Math.cos(a) * r, z = Math.sin(a) * r; out.push({ x, y: floor - rng.range(0, 3.5), z, yaw: facing(x, z) + rng.range(-0.4, 0.4), tiltX: rng.range(-0.3, 0.3), tiltZ: rng.range(-0.35, 0.35), s: rng.range(0.85, 1.25) }); } break;
    case 'corruption-zone': for (let i = 0; i < n(12); i++) { const a = (i / n(12)) * Math.PI * 2, r = 34 + (i % 2) * 6, x = Math.cos(a) * r, z = Math.sin(a) * r; out.push({ x, y: floor - 4, z, yaw: facing(x, z), tiltX: rng.range(-0.15, 0.15), tiltZ: rng.range(-0.2, 0.2), s: 1.1, bob: { amp: 2.2, speed: 0.35 + rng.range(0, 0.2), phase: rng.range(0, 6.28) } }); } break;
    case 'grand-colosseum': ring(n(18), 35, floor, 1.25); ring(n(12), 47, floor - 1, 1.7, 0.13); break;
    case 'null-sector': for (let i = 0; i < n(10); i++) { const a = rng.range(0, Math.PI * 2), r = rng.range(36, 60), x = Math.cos(a) * r, z = Math.sin(a) * r; out.push({ x, y: floor + rng.range(-6, 10), z, yaw: rng.range(0, 6.28), tiltX: rng.range(-0.6, 0.6), tiltZ: rng.range(-0.6, 0.6), s: rng.range(0.8, 1.4), bob: { amp: 1.4, speed: 0.2 + rng.range(0, 0.15), phase: rng.range(0, 6.28) } }); } break;
    default: ring(n(12), 34, floor, 1);
  }
  return out;
}
