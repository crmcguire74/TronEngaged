import * as THREE from 'three';
import type { Assets } from './assets';

let beamTex: THREE.Texture | null = null, poolTex: THREE.Texture | null = null;
function grad(radial: boolean) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!;
  const g = radial ? x.createRadialGradient(32, 32, 1, 32, 32, 32) : x.createLinearGradient(0, 64, 0, 0);
  g.addColorStop(0, radial ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)'); if (!radial) g.addColorStop(0.75, 'rgba(90,90,90,1)'); g.addColorStop(1, radial ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,1)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.userData.shared = true; return t;
}

interface Craft { o: THREE.Object3D; beam: THREE.Mesh; pool: THREE.Mesh; r: number; h: number; w: number; a: number; nav: { m: THREE.MeshBasicMaterial; c: THREE.Color }[] }

/**
 * Patrol skimmers (scripts/blender/build_craft.py) circling high above an arena or circuit: banked orbits, blinking
 * nav lights and a searchlight that sweeps the floor. Pure set dressing — they never touch the simulation, and every
 * light is an unlit mesh so they read the same in VR, where there is no bloom.
 */
export class Patrol {
  readonly group = new THREE.Group(); private craft: Craft[] = []; private t = 0; private up = new THREE.Vector3(0, -1, 0); private v = new THREE.Vector3(); private tgt = new THREE.Vector3();
  constructor(assets: Assets, private o: { cx: number; cz: number; radius: number; height: number; floorY: number; count: number; color: number; scale?: number }) {
    if (!assets.has('craft')) return;
    beamTex ??= grad(false); poolTex ??= grad(true);
    const geo = new THREE.CylinderGeometry(0.04, 1, 1, 24, 1, true); geo.translate(0, -0.5, 0);
    for (let i = 0; i < o.count; i++) {
      const root = assets.instance('craft', { cloneMaterials: true }).root, nav: Craft['nav'] = [];
      root.traverse((m: any) => {
        if (!m.isMesh) return; m.castShadow = false; const n = m.material?.name;
        if (n === 'Trim') m.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color).multiplyScalar(1.3) });
        else if (n === 'Lens') m.material = new THREE.MeshBasicMaterial({ color: 0xfff4e0 });
        else if (n === 'NavRed' || n === 'NavGreen') { const c = new THREE.Color(n === 'NavRed' ? 0xff2a14 : 0x2aff6a); m.material = new THREE.MeshBasicMaterial({ color: c.clone() }); nav.push({ m: m.material, c }); }
      });
      root.scale.setScalar(o.scale ?? 1.8); root.rotation.order = 'YXZ';
      const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe6f2ff, map: beamTex, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xe6f2ff, map: poolTex, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2; beam.frustumCulled = false; beam.renderOrder = 2; pool.renderOrder = 2;
      const dir = i % 2 ? -1 : 1, r = o.radius * (0.8 + 0.25 * ((i * 0.37) % 1));
      this.craft.push({ o: root, beam, pool, r, h: o.height + i * 7, w: (dir * 13) / r, a: (i / o.count) * Math.PI * 2, nav });
      this.group.add(root, beam, pool);
    }
  }
  update(dt: number) {
    this.t += dt; const { cx, cz, floorY } = this.o;
    for (let i = 0; i < this.craft.length; i++) {
      const c = this.craft[i]; c.a += c.w * dt;
      const x = cx + Math.cos(c.a) * c.r, z = cz + Math.sin(c.a) * c.r, y = c.h + Math.sin(this.t * 0.4 + i * 2) * 2.5;
      // nose along the orbit, banked into the turn
      c.o.position.set(x, y, z); c.o.rotation.y = Math.atan2(-Math.sin(c.a) * c.w, Math.cos(c.a) * c.w); c.o.rotation.z = Math.sign(c.w) * 0.3; c.o.rotation.x = Math.sin(this.t * 0.4 + i * 2) * 0.04;
      // the searchlight sweeps the floor inside the orbit
      const s = this.t * 0.45 + i * 1.7; this.tgt.set(cx + Math.cos(c.a) * c.r * 0.45 + Math.sin(s) * c.r * 0.25, floorY + 0.05, cz + Math.sin(c.a) * c.r * 0.45 + Math.cos(s * 0.8) * c.r * 0.25);
      c.beam.position.set(x, y - 1.4, z); this.v.copy(this.tgt).sub(c.beam.position); const len = this.v.length();
      c.beam.quaternion.setFromUnitVectors(this.up, this.v.divideScalar(len)); const spread = len * 0.09; c.beam.scale.set(spread, len, spread);
      c.pool.position.copy(this.tgt); c.pool.scale.setScalar(spread * 2.6);
      // nav lights: a short double blink every 1.4 s
      const ph = (this.t / 1.4 + i * 0.31) % 1, on = ph < 0.06 || (ph > 0.12 && ph < 0.18);
      for (const n of c.nav) n.m.color.copy(n.c).multiplyScalar(on ? 2.2 : 0.35);
    }
  }
}

/** Re-skins a fleet model's light materials (unlit, so they read without bloom); returns its blinking nav lights. */
function skinFleet(root: THREE.Object3D, color: number) {
  const nav: { m: THREE.MeshBasicMaterial; c: THREE.Color }[] = [];
  root.traverse((m: any) => {
    if (!m.isMesh) return; m.castShadow = false; const n = m.material?.name;
    if (n === 'Trim') m.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.3) });
    else if (n === 'Lens') m.material = new THREE.MeshBasicMaterial({ color: 0xfff4e0 });
    else if (n === 'Window') m.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fc4ff).multiplyScalar(0.75) });
    else if (n === 'NavRed' || n === 'NavGreen') { const c = new THREE.Color(n === 'NavRed' ? 0xff2a14 : 0x2aff6a); m.material = new THREE.MeshBasicMaterial({ color: c.clone() }); nav.push({ m: m.material, c }); }
  });
  return nav;
}

/**
 * Broadcast camera drones (scripts/blender/build_fleet.py): they hover round the action with their lenses on it —
 * circling an arena, or pacing a rider down the track. Set dressing only.
 */
export class Drones {
  readonly group = new THREE.Group(); private d: { o: THREE.Object3D; a: number; nav: { m: THREE.MeshBasicMaterial; c: THREE.Color }[] }[] = []; private t = 0; private v = new THREE.Vector3();
  constructor(assets: Assets, count: number, color: number, scale = 1.3) {
    if (!assets.has('drone')) return;
    for (let i = 0; i < count; i++) { const o = assets.instance('drone', { cloneMaterials: true }).root, nav = skinFleet(o, color); o.scale.setScalar(scale); this.d.push({ o, a: (i / count) * Math.PI * 2, nav }); this.group.add(o); }
  }
  private settle(i: number, x: number, y: number, z: number, look: THREE.Vector3, dt: number, k: number) {
    const d = this.d[i], o = d.o; this.v.set(x, y + Math.sin(this.t * 1.3 + i * 2.1) * 0.35, z);
    if (o.userData.placed) o.position.lerp(this.v, 1 - Math.exp(-k * dt)); else { o.position.copy(this.v); o.userData.placed = true; }
    o.lookAt(look); o.rotateZ(Math.sin(this.t * 0.9 + i) * 0.06);
    const on = (this.t / 1.1 + i * 0.37) % 1 < 0.1; for (const n of d.nav) n.m.color.copy(n.c).multiplyScalar(on ? 2 : 0.3);
  }
  /** Circle a point (cx, cy, cz) at radius r, each drone at its own height, lenses on `look`. */
  orbit(dt: number, cx: number, cy: number, cz: number, r: number, look: THREE.Vector3) {
    this.t += dt; this.d.forEach((d, i) => { d.a += (dt * (i % 2 ? -1 : 1) * 4) / r; this.settle(i, cx + Math.cos(d.a) * r, cy + i * 1.6, cz + Math.sin(d.a) * r, look, dt, 3); });
  }
  /** Pace a rider: off to one side and a little behind, filming them. */
  follow(dt: number, x: number, y: number, z: number, yaw: number, look: THREE.Vector3) {
    this.t += dt; const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // the first drone leads (lens back on the rider, so it is in shot from the chase camera and the cockpit); the second flanks
    this.d.forEach((_, i) => { const side = i % 2 ? -1 : 1, sw = Math.sin(this.t * 0.35 + i * 2) * 3, along = i === 0 ? 16 + Math.sin(this.t * 0.22) * 4 : -3; this.settle(i, x - fz * side * (8 + sw) + fx * along, y + 4 + i * 1.5, z + fx * side * (8 + sw) + fz * along, look, dt, 7); });
  }
}

/** A heavy carrier (scripts/blender/build_fleet.py) crossing the sky far above, on a long straight pass that repeats. */
export class Carrier {
  readonly group = new THREE.Group(); private o: THREE.Object3D | null = null; private s = 0; private nav: { m: THREE.MeshBasicMaterial; c: THREE.Color }[] = []; private t = 0;
  /**
   * `key` picks the model: the standard carrier, the heavy Overwatch Hauler over the Outlands, or the Recognizer.
   * The Recognizer arrives about two units tall and standing on its own feet, so it is scaled up to a seventy-metre
   * gantry and flown lower than the others: `alt` is where its feet hang, and it is meant to loom over the grid
   * rather than pass as a speck overhead.
   */
  constructor(assets: Assets, color: number, private p: { cx: number; cz: number; offset: number; alt: number; heading: number; len: number; speed?: number; key?: string }) {
    const key = p.key && assets.has(p.key) ? p.key : 'carrier';
    if (!assets.has(key)) return; this.o = assets.instance(key, { cloneMaterials: true }).root;
    // update() rewrites position every frame, so a height offset has to live on the scale/alt, not on the model
    if (key === 'recognizer') this.o.scale.setScalar(32);
    this.nav = skinFleet(this.o, color);
    this.o.rotation.y = p.heading; this.group.add(this.o); this.s = p.len * 0.35;
  }
  update(dt: number) {
    const o = this.o; if (!o) return; const p = this.p; this.t += dt; this.s = (this.s + dt * (p.speed ?? 11)) % p.len;
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading), d = this.s - p.len / 2;
    o.position.set(p.cx + fz * p.offset + fx * d, p.alt + Math.sin(this.t * 0.2) * 1.5, p.cz - fx * p.offset + fz * d);
    const on = (this.t / 1.8) % 1 < 0.08; for (const n of this.nav) n.m.color.copy(n.c).multiplyScalar(on ? 2.2 : 0.3);
  }
}
