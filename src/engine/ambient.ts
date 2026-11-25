import * as THREE from 'three';
import { Rng } from './math';
import { TONE, type Theme } from './env';

/**
 * Living backdrop shared by every game: streams of light craft on banked lanes round the arena or circuit, and
 * searchlight beacons on the skyline that sweep and flare with the action.
 *
 * Both are one instanced draw each, animated entirely in the vertex shader from per-instance attributes and a clock,
 * so they cost no CPU per frame and nothing in the simulation knows they exist. Counts drop in a headset. Each tier
 * passes its own seed, so lane layout, traffic mix, beacon count and sweep differ from one tier to the next.
 */
export interface AmbientOpts { cx: number; cz: number; groundY: number; rMin: number; rMax: number; hMin: number; hMax: number; seed: number; xr: boolean; quality: string }

export class Ambient {
  readonly group = new THREE.Group(); private mats: THREE.ShaderMaterial[] = []; private beat = 0;
  /** The current pulse (0..1), for other set pieces that breathe with the scene. */ get beatLevel() { return this.beat; }

  constructor(th: Theme, o: AmbientOpts) {
    const rng = new Rng(o.seed ^ 0x5bd1e995), low = o.quality === 'low';
    this.group.add(this.traffic(th, o, rng, o.xr || low ? 70 : 160), this.beacons(th, o, rng, o.xr || low ? 6 : 10));
  }

  /** Streaks of light craft on 4-7 banked circular lanes, alternating direction, in the theme's two accents and white. */
  private traffic(th: Theme, o: AmbientOpts, rng: Rng, n: number): THREE.InstancedMesh {
    const lanes = rng.int(4, 7), lane = new Float32Array(n * 4), bank = new Float32Array(n * 2), col = new Float32Array(n * 3);
    const lanes0 = Array.from({ length: lanes }, (_, i) => ({ r: rng.range(o.rMin, o.rMax), h: o.groundY + rng.range(o.hMin, o.hMax), dir: i % 2 ? -1 : 1, speed: rng.range(26, 60), tilt: rng.range(-0.16, 0.16), yaw: rng.range(0, Math.PI * 2) }));
    const pal = [new THREE.Color(th.accent), new THREE.Color(th.accent2), new THREE.Color(0xdff4ff)];
    for (let i = 0; i < n; i++) {
      const L = lanes0[i % lanes], c = pal[rng.next() < 0.55 ? 0 : rng.next() < 0.6 ? 1 : 2];
      // a few craft travel in loose convoys: shared phase plus a small stagger
      const convoy = Math.floor(rng.next() * 6), ph = convoy * 1.05 + rng.range(-0.08, 0.08) + (i % lanes) * 0.37;
      lane.set([L.r + rng.range(-3, 3), L.h + rng.range(-2, 2), (L.speed * L.dir) / L.r, ph], i * 4); bank.set([L.tilt, L.yaw], i * 2); col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.InstancedBufferGeometry(); const base = new THREE.BoxGeometry(0.7, 0.28, 5.5, 1, 1, 2);
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('uv', base.getAttribute('uv'));
    g.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4)); g.setAttribute('aBank', new THREE.InstancedBufferAttribute(bank, 2)); g.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3)); g.instanceCount = n;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector2(o.cx, o.cz) }, uBeat: { value: 0 } },
      vertexShader: `attribute vec4 aLane; attribute vec2 aBank; attribute vec3 aCol; uniform float uTime; uniform vec2 uCenter; varying vec3 vCol; varying float vTail;
        void main(){
          float a = aLane.w + aLane.z * uTime, r = aLane.x, dir = sign(aLane.z);
          // tangent frame on a lane tilted by aBank.x about an axis at angle aBank.y
          vec3 p = vec3(cos(a) * r, 0.0, sin(a) * r), t = normalize(vec3(-sin(a), 0.0, cos(a)) * dir);
          float ct = cos(aBank.x), st = sin(aBank.x), cy = cos(aBank.y), sy = sin(aBank.y);
          vec3 ax = vec3(cy, 0.0, sy);
          // Rodrigues rotation of the lane plane: banked lanes rise on one side and dip on the other
          p = p * ct + cross(ax, p) * st + ax * dot(ax, p) * (1.0 - ct); t = t * ct + cross(ax, t) * st + ax * dot(ax, t) * (1.0 - ct);
          vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), t)), up = cross(t, side);
          vec3 w = vec3(uCenter.x, aLane.y, uCenter.y) + p + side * position.x + up * position.y + t * position.z;
          vCol = aCol; vTail = position.z / 5.5 + 0.5;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `uniform float uBeat; varying vec3 vCol; varying float vTail; void main(){ float k = pow(vTail, 2.2); gl_FragColor = vec4(vCol * (0.4 + 2.2 * k) * (1.0 + 0.35 * uBeat), 0.15 + 0.85 * k); ${TONE} }`,
    });
    this.mats.push(m); const mesh = new THREE.InstancedMesh(g, m, n); mesh.frustumCulled = false; mesh.renderOrder = 1; return mesh;
  }

  /** Tall searchlight cones standing on the skyline ring, sweeping on their own phase and flaring with the action. */
  private beacons(th: Theme, o: AmbientOpts, rng: Rng, n: number): THREE.InstancedMesh {
    const pos = new Float32Array(n * 4), col = new Float32Array(n * 3), white = rng.next() < 0.4, c0 = new THREE.Color(white ? 0xe8f4ff : th.accent), c1 = new THREE.Color(th.accent2);
    const sweep = rng.range(0.18, 0.42);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2), r = o.rMax + rng.range(10, 60), c = i % 3 === 2 ? c1 : c0;
      pos.set([o.cx + Math.cos(a) * r, o.cz + Math.sin(a) * r, rng.range(0, 6.28), sweep * rng.range(0.7, 1.3)], i * 4); col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.InstancedBufferGeometry(), base = new THREE.CylinderGeometry(7, 0.5, 260, 10, 1, true); base.translate(0, 130, 0);
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('uv', base.getAttribute('uv'));
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 4)); g.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3)); g.instanceCount = n;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uBeat: { value: 0 }, uGround: { value: o.groundY } },
      vertexShader: `attribute vec4 aPos; attribute vec3 aCol; uniform float uTime, uGround; varying vec3 vCol; varying float vH;
        void main(){
          float az = aPos.z + uTime * aPos.w, tilt = 0.32 + 0.18 * sin(uTime * aPos.w * 1.7 + aPos.z);
          vec3 p = position; float c = cos(tilt), s = sin(tilt);
          p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
          float ca = cos(az), sa = sin(az); p = vec3(p.x * ca - p.z * sa, p.y, p.x * sa + p.z * ca);
          vCol = aCol; vH = uv.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(vec3(aPos.x, uGround, aPos.y) + p, 1.0);
        }`,
      fragmentShader: `uniform float uBeat; varying vec3 vCol; varying float vH; void main(){ float a = pow(1.0 - vH, 1.6) * (0.07 + 0.09 * uBeat); gl_FragColor = vec4(vCol * 1.6, a); ${TONE} }`,
    });
    this.mats.push(m); const mesh = new THREE.InstancedMesh(g, m, n); mesh.frustumCulled = false; return mesh;
  }

  /**
   * t: clock; drive: 0..1 how hard the scene is going (speed, fight intensity). The beacons flare on a steady 126 bpm
   * pulse whose strength follows `drive`, so a calm moment glows and a flat-out one strobes.
   */
  update(t: number, drive: number) {
    const pulse = Math.pow(Math.max(0, Math.cos(t * Math.PI * 2 * 2.1)), 8); this.beat += (pulse * (0.25 + 0.75 * drive) - this.beat) * 0.5;
    for (const m of this.mats) { m.uniforms.uTime.value = t; m.uniforms.uBeat.value = this.beat; }
  }
}
