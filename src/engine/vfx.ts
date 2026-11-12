import * as THREE from 'three';

const MAX_P = 2400, MAX_SHARDS = 420, MAX_RINGS = 20, MAX_CUBES = 900, MAX_PILLARS = 4;
const TONE = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';

/** Pooled, bounded effects: additive spark particles, hardlight shards for shatter sequences, and shockwave rings. */
export class Vfx {
  readonly group = new THREE.Group();
  private pPos = new Float32Array(MAX_P * 3); private pVel = new Float32Array(MAX_P * 3); private pCol = new Float32Array(MAX_P * 3); private pLife = new Float32Array(MAX_P * 2); private pSize = new Float32Array(MAX_P);
  private pGeo = new THREE.BufferGeometry(); private pNext = 0; private pGrav = new Float32Array(MAX_P);
  private shards: THREE.InstancedMesh; private sPos = new Float32Array(MAX_SHARDS * 3); private sVel = new Float32Array(MAX_SHARDS * 3); private sRot = new Float32Array(MAX_SHARDS * 4); private sLife = new Float32Array(MAX_SHARDS * 2); private sNext = 0; private sScale = new Float32Array(MAX_SHARDS);
  private rings: { mesh: THREE.Mesh; t: number; dur: number; from: number; to: number }[] = []; private rNext = 0;
  private light = new THREE.PointLight(0xffffff, 0, 30, 2); private lightT = 0;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3(); private e = new THREE.Euler(); private c = new THREE.Color();
  flashes = true;
  // derez: solid cubes that burst, bounce on the deck, then lift back up their light pillar
  private cubes: THREE.InstancedMesh; private cPos = new Float32Array(MAX_CUBES * 3); private cVel = new Float32Array(MAX_CUBES * 3); private cRot = new Float32Array(MAX_CUBES * 4); private cLife = new Float32Array(MAX_CUBES * 2); private cScale = new Float32Array(MAX_CUBES); private cHome = new Float32Array(MAX_CUBES * 4); private cNext = 0;
  private pillars: { mesh: THREE.Mesh; t: number; dur: number; r: number; h: number }[] = []; private plNext = 0;
  private queue: { t: number; fn: () => void }[] = [];

  constructor() {
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.pGeo.setAttribute('life', new THREE.BufferAttribute(this.pLife, 2));
    this.pGeo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const pm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute vec3 color; attribute vec2 life; attribute float size; varying vec3 vC; varying float vA; void main(){ vC = color; float k = clamp(life.x / max(life.y, 0.001), 0.0, 1.0); vA = k; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * (0.35 + 0.65 * k) * (320.0 / max(0.5, -mv.z)); gl_Position = projectionMatrix * mv; if (life.x <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }',
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * (1.0 + 2.5 * vA), a * a * vA); ${TONE} }`,
    });
    const pts = new THREE.Points(this.pGeo, pm); pts.frustumCulled = false; this.group.add(pts);
    const sg = new THREE.TetrahedronGeometry(0.16); const sm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.shards = new THREE.InstancedMesh(sg, sm, MAX_SHARDS); this.shards.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHARDS * 3), 3); this.shards.frustumCulled = false; this.shards.count = MAX_SHARDS;
    this.m4.makeScale(0, 0, 0); for (let i = 0; i < MAX_SHARDS; i++) this.shards.setMatrixAt(i, this.m4);
    this.group.add(this.shards);
    const rg = new THREE.RingGeometry(0.93, 1, 64);
    for (let i = 0; i < MAX_RINGS; i++) { const mesh = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); mesh.visible = false; this.group.add(mesh); this.rings.push({ mesh, t: 0, dur: 1, from: 0, to: 1 }); }
    this.group.add(this.light);
    this.cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_CUBES); this.cubes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CUBES * 3), 3); this.cubes.frustumCulled = false;
    this.m4.makeScale(0, 0, 0); for (let i = 0; i < MAX_CUBES; i++) this.cubes.setMatrixAt(i, this.m4); this.group.add(this.cubes);
    const pg = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); pg.translate(0, 0.5, 0);
    for (let i = 0; i < MAX_PILLARS; i++) {
      const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color() }, uAmt: { value: 0 }, uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 uColor; uniform float uAmt, uTime; varying vec2 vUv; void main(){ float rise = fract(vUv.y * 9.0 - uTime * 2.6 + sin(vUv.x * 50.0) * 0.5); float streak = 0.45 + 0.55 * step(0.5, fract(vUv.x * 14.0)) * smoothstep(0.0, 0.4, rise); float a = pow(1.0 - vUv.y, 1.6) * uAmt * streak; gl_FragColor = vec4(uColor * (0.8 + 0.6 * uAmt), a); ${TONE} }` });
      const mesh = new THREE.Mesh(pg, mat); mesh.visible = false; mesh.frustumCulled = false; this.group.add(mesh); this.pillars.push({ mesh, t: 0, dur: 1, r: 1, h: 30 });
    }
  }

  /** Runs `fn` after `delay` seconds of effect time, so a sequence can be staged from one call. */
  later(delay: number, fn: () => void) { this.queue.push({ t: delay, fn }); }
  /** A column of rising light that thins to nothing. */
  pillar(x: number, y: number, z: number, color: number, height = 34, radius = 0.9, dur = 1.1) {
    const p = this.pillars[this.plNext]; this.plNext = (this.plNext + 1) % MAX_PILLARS; p.t = 0; p.dur = dur; p.r = radius; p.h = height; p.mesh.position.set(x, y, z); p.mesh.visible = true; ((p.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setHex(color);
  }
  /**
   * The kill: a body breaks into solid cubes that blast outward along `dir`, rattle across the deck, then lift back up a
   * pillar of light, with staggered shockwaves and embers. `floorR` is how far the deck reaches before cubes fall away.
   */
  derez(x: number, y: number, z: number, color: number, o: { height?: number; dir?: { x: number; z: number }; count?: number; power?: number; floorR?: number; big?: boolean; inner?: number } = {}) {
    const h = o.height ?? 1.8, n = Math.min(o.count ?? 220, MAX_CUBES), pw = o.power ?? 7, big = !!o.big, dx = o.dir?.x ?? 0, dz = o.dir?.z ?? 0, hot = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.75), dim = new THREE.Color(color).multiplyScalar(0.5); this.c.setHex(color);
    for (let i = 0; i < n; i++) {
      const k = this.cNext; this.cNext = (this.cNext + 1) % MAX_CUBES; const up = Math.random(), a = Math.random() * 6.283, body = 0.12 + 0.2 * Math.sin(Math.PI * Math.min(1, up * 1.15)), r = (o.inner ?? 0) + body * Math.sqrt(Math.random());
      this.cPos[k * 3] = x + Math.cos(a) * r; this.cPos[k * 3 + 1] = y + 0.1 + up * h; this.cPos[k * 3 + 2] = z + Math.sin(a) * r;
      const sp = pw * (0.2 + Math.random() * Math.random() * 1.5);
      this.cVel[k * 3] = Math.cos(a) * sp + dx * pw * (0.5 + Math.random() * 0.7); this.cVel[k * 3 + 1] = 1.2 + Math.random() * pw * 0.85 + up * 2; this.cVel[k * 3 + 2] = Math.sin(a) * sp + dz * pw * (0.5 + Math.random() * 0.7);
      this.cRot[k * 4] = Math.random() * 6; this.cRot[k * 4 + 1] = Math.random() * 6; this.cRot[k * 4 + 2] = (Math.random() - 0.5) * 18; this.cRot[k * 4 + 3] = (Math.random() - 0.5) * 18;
      const lf = (big ? 1.9 : 1.3) + Math.random() * 1.4; this.cLife[k * 2] = lf; this.cLife[k * 2 + 1] = lf; const q = Math.random(); this.cScale[k] = (0.045 + q * q * 0.14) * (big ? 1.35 : 1);
      this.cHome[k * 4] = x; this.cHome[k * 4 + 1] = y; this.cHome[k * 4 + 2] = z; this.cHome[k * 4 + 3] = o.floorR ?? 5;
      const pick = Math.random(); this.cubes.setColorAt(k, pick < 0.22 ? hot : pick < 0.5 ? dim : this.c);
    }
    this.cubes.instanceColor!.needsUpdate = true;
    // glassy slivers and sparks ride out with the cubes
    for (let i = 0; i < (big ? 90 : 45); i++) {
      const k = this.sNext; this.sNext = (this.sNext + 1) % MAX_SHARDS; const a = Math.random() * 6.283, sp = pw * (0.5 + Math.random());
      this.sPos[k * 3] = x; this.sPos[k * 3 + 1] = y + Math.random() * h; this.sPos[k * 3 + 2] = z; this.sVel[k * 3] = Math.cos(a) * sp + dx * pw; this.sVel[k * 3 + 1] = 2 + Math.random() * pw; this.sVel[k * 3 + 2] = Math.sin(a) * sp + dz * pw;
      this.sRot[k * 4] = Math.random() * 6; this.sRot[k * 4 + 1] = Math.random() * 6; this.sRot[k * 4 + 2] = (Math.random() - 0.5) * 20; this.sRot[k * 4 + 3] = (Math.random() - 0.5) * 20;
      const lf = 0.6 + Math.random() * 0.8; this.sLife[k * 2] = lf; this.sLife[k * 2 + 1] = lf; this.sScale[k] = 0.5 + Math.random() * 1.4; this.shards.setColorAt(k, this.c);
    }
    this.shards.instanceColor!.needsUpdate = true;
    this.sparks(x, y + h * 0.55, z, 0xffffff, big ? 110 : 60, pw * 2.2, 0.45, undefined, 4, 0.45); this.sparks(x, y + h * 0.5, z, color, big ? 140 : 80, pw * 1.3, 1.1, { x: dx, y: 0.4, z: dz }, 9, 0.6);
    this.flash(x, y + h * 0.6, z, color, big ? 70 : 44); this.pillar(x, y, z, color, big ? 70 : 36, big ? 1.7 : 0.95, big ? 1.8 : 1.15);
    this.ring(x, y + 0.08, z, 0xffffff, 0.3, big ? 9 : 5.5, 0.4); this.later(0.1, () => this.ring(x, y + 0.08, z, color, 0.3, big ? 16 : 9, 0.75)); this.later(0.24, () => this.ring(x, y + 0.08, z, color, 0.3, big ? 24 : 13, 1.1));
    if (dx || dz) this.ring(x, y + h * 0.6, z, color, 0.2, big ? 5 : 3, 0.4, { x: dx, y: 0, z: dz });
    for (let i = 1; i <= (big ? 7 : 4); i++) this.later(0.18 * i, () => this.motes(x, y, z, color, big ? 2 : 1.1, h + 0.6, big ? 34 : 20));
    if (big) { this.later(0.35, () => { this.sparks(x, y + h * 0.5, z, 0xffffff, 90, pw * 2.6, 0.6, undefined, 3, 0.5); this.flash(x, y + h, z, 0xffffff, 60); this.ring(x, y + h * 0.5, z, 0xffffff, 0.4, 20, 0.9); }); }
  }

  /** Burst of sparks. `dir` biases the cone (e.g. a surface normal for ricochets). */
  sparks(x: number, y: number, z: number, color: number, count = 24, speed = 9, life = 0.5, dir?: { x: number; y: number; z: number }, gravity = 9, size = 0.5) {
    this.c.setHex(color);
    for (let i = 0; i < count; i++) {
      const k = this.pNext; this.pNext = (this.pNext + 1) % MAX_P;
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1; const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
      if (dir) { vx = vx * 0.75 + dir.x; vy = vy * 0.75 + dir.y; vz = vz * 0.75 + dir.z; }
      const sp = speed * (0.35 + Math.random() * 0.9);
      this.pPos[k * 3] = x; this.pPos[k * 3 + 1] = y; this.pPos[k * 3 + 2] = z; this.pVel[k * 3] = vx * sp; this.pVel[k * 3 + 1] = vy * sp; this.pVel[k * 3 + 2] = vz * sp;
      this.pCol[k * 3] = this.c.r; this.pCol[k * 3 + 1] = this.c.g; this.pCol[k * 3 + 2] = this.c.b;
      const lf = life * (0.5 + Math.random() * 0.8); this.pLife[k * 2] = lf; this.pLife[k * 2 + 1] = lf; this.pSize[k] = size * (0.5 + Math.random()); this.pGrav[k] = gravity;
    }
  }
  /** Rising motes used when a model assembles from particles. */
  motes(x: number, y: number, z: number, color: number, radius: number, height: number, count = 30) {
    this.c.setHex(color);
    for (let i = 0; i < count; i++) {
      const k = this.pNext; this.pNext = (this.pNext + 1) % MAX_P; const a = Math.random() * 6.283, r = radius * Math.sqrt(Math.random());
      this.pPos[k * 3] = x + Math.cos(a) * r; this.pPos[k * 3 + 1] = y + Math.random() * height; this.pPos[k * 3 + 2] = z + Math.sin(a) * r;
      this.pVel[k * 3] = 0; this.pVel[k * 3 + 1] = 0.6 + Math.random() * 1.6; this.pVel[k * 3 + 2] = 0;
      this.pCol[k * 3] = this.c.r; this.pCol[k * 3 + 1] = this.c.g; this.pCol[k * 3 + 2] = this.c.b; const lf = 0.5 + Math.random() * 0.7; this.pLife[k * 2] = lf; this.pLife[k * 2 + 1] = lf; this.pSize[k] = 0.25 + Math.random() * 0.3; this.pGrav[k] = -1;
    }
  }
  /** Shatter: the body breaks into hardlight shards that scatter along `dir` and dissolve. */
  shatter(x: number, y: number, z: number, color: number, count = 70, height = 1.8, dir?: { x: number; z: number }, power = 7) {
    this.c.setHex(color);
    for (let i = 0; i < count; i++) {
      const k = this.sNext; this.sNext = (this.sNext + 1) % MAX_SHARDS; const a = Math.random() * 6.283, r = Math.random() * 0.4;
      this.sPos[k * 3] = x + Math.cos(a) * r; this.sPos[k * 3 + 1] = y + Math.random() * height; this.sPos[k * 3 + 2] = z + Math.sin(a) * r;
      const sp = power * (0.3 + Math.random());
      this.sVel[k * 3] = Math.cos(a) * sp * 0.6 + (dir?.x ?? 0) * power; this.sVel[k * 3 + 1] = 1 + Math.random() * power * 0.7; this.sVel[k * 3 + 2] = Math.sin(a) * sp * 0.6 + (dir?.z ?? 0) * power;
      this.sRot[k * 4] = Math.random() * 6; this.sRot[k * 4 + 1] = Math.random() * 6; this.sRot[k * 4 + 2] = (Math.random() - 0.5) * 14; this.sRot[k * 4 + 3] = (Math.random() - 0.5) * 14;
      const lf = 0.7 + Math.random() * 0.9; this.sLife[k * 2] = lf; this.sLife[k * 2 + 1] = lf; this.sScale[k] = 0.6 + Math.random() * 1.6;
      this.shards.setColorAt(k, this.c);
    }
    this.shards.instanceColor!.needsUpdate = true;
    this.sparks(x, y + height * 0.5, z, color, 50, power * 1.4, 0.8);
    this.ring(x, y + 0.1, z, color, 0.4, 6, 0.6);
    this.flash(x, y + 1, z, color, 26);
  }
  /** Expanding ring: horizontal by default, or oriented to a surface normal. */
  ring(x: number, y: number, z: number, color: number, from = 0.2, to = 3, dur = 0.45, normal?: { x: number; y: number; z: number }) {
    const r = this.rings[this.rNext]; this.rNext = (this.rNext + 1) % MAX_RINGS;
    r.mesh.position.set(x, y, z); r.t = 0; r.dur = dur; r.from = from; r.to = to; r.mesh.visible = true; (r.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    if (normal) r.mesh.quaternion.setFromUnitVectors(this.v.set(0, 0, 1), this.s.set(normal.x, normal.y, normal.z).normalize()); else r.mesh.rotation.set(-Math.PI / 2, 0, 0);
  }
  flash(x: number, y: number, z: number, color: number, intensity = 20) { if (!this.flashes) intensity *= 0.3; this.light.position.set(x, y, z); this.light.color.setHex(color); this.light.intensity = intensity; this.lightT = 0.22; }

  update(dt: number) {
    if (this.queue.length) { for (const q of this.queue) q.t -= dt; const due = this.queue.filter((q) => q.t <= 0); if (due.length) { this.queue = this.queue.filter((q) => q.t > 0); for (const q of due) q.fn(); } }
    let live = false;
    for (let k = 0; k < MAX_CUBES; k++) {
      const l = this.cLife[k * 2]; if (l <= 0) continue; live = true; const nl = l - dt, f = nl / this.cLife[k * 2 + 1]; this.cLife[k * 2] = nl; const i3 = k * 3, hx = this.cHome[k * 4], hy = this.cHome[k * 4 + 1], hz = this.cHome[k * 4 + 2], s0 = this.cScale[k];
      if (f < 0.34) { // the last third: gravity lets go and the pieces are drawn back up the pillar
        const pull = 5 * dt; this.cVel[i3] += (hx - this.cPos[i3]) * pull * 3 - this.cVel[i3] * 2.5 * dt; this.cVel[i3 + 2] += (hz - this.cPos[i3 + 2]) * pull * 3 - this.cVel[i3 + 2] * 2.5 * dt; this.cVel[i3 + 1] += 30 * dt;
      } else {
        this.cVel[i3 + 1] -= 15 * dt; const fl = hy + s0 * 0.5;
        if (this.cPos[i3 + 1] < fl && this.cVel[i3 + 1] < 0 && this.cPos[i3 + 1] > fl - 0.6 && Math.hypot(this.cPos[i3] - hx, this.cPos[i3 + 2] - hz) < this.cHome[k * 4 + 3]) { this.cPos[i3 + 1] = fl; this.cVel[i3 + 1] *= -0.42; this.cVel[i3] *= 0.72; this.cVel[i3 + 2] *= 0.72; this.cRot[k * 4 + 2] *= 0.6; this.cRot[k * 4 + 3] *= 0.6; }
      }
      this.cPos[i3] += this.cVel[i3] * dt; this.cPos[i3 + 1] += this.cVel[i3 + 1] * dt; this.cPos[i3 + 2] += this.cVel[i3 + 2] * dt; this.cRot[k * 4] += this.cRot[k * 4 + 2] * dt; this.cRot[k * 4 + 1] += this.cRot[k * 4 + 3] * dt;
      const sc = nl <= 0 ? 0 : s0 * Math.min(1, f / 0.2);
      this.q.setFromEuler(this.e.set(this.cRot[k * 4], this.cRot[k * 4 + 1], 0)); this.m4.compose(this.v.set(this.cPos[i3], this.cPos[i3 + 1], this.cPos[i3 + 2]), this.q, this.s.set(sc, sc, sc)); this.cubes.setMatrixAt(k, this.m4);
    }
    if (live) this.cubes.instanceMatrix.needsUpdate = true;
    for (const p of this.pillars) { if (!p.mesh.visible) continue; p.t += dt / p.dur; if (p.t >= 1) { p.mesh.visible = false; continue; } const u = (p.mesh.material as THREE.ShaderMaterial).uniforms; u.uAmt.value = Math.min(1, p.t * 14) * (1 - p.t) * (1 - p.t); u.uTime.value += dt; const r = p.r * (0.25 + 0.75 * (1 - p.t) * (1 - p.t)); p.mesh.scale.set(r, p.h * Math.min(1, p.t * 7), r); }
    for (let k = 0; k < MAX_P; k++) {
      const l = this.pLife[k * 2]; if (l <= 0) continue; this.pLife[k * 2] = l - dt;
      this.pVel[k * 3 + 1] -= this.pGrav[k] * dt; const d = 1 - 1.6 * dt; this.pVel[k * 3] *= d; this.pVel[k * 3 + 2] *= d;
      this.pPos[k * 3] += this.pVel[k * 3] * dt; this.pPos[k * 3 + 1] += this.pVel[k * 3 + 1] * dt; this.pPos[k * 3 + 2] += this.pVel[k * 3 + 2] * dt;
    }
    this.pGeo.attributes.position.needsUpdate = true; this.pGeo.attributes.life.needsUpdate = true; this.pGeo.attributes.color.needsUpdate = true; this.pGeo.attributes.size.needsUpdate = true;
    let any = false;
    for (let k = 0; k < MAX_SHARDS; k++) {
      const l = this.sLife[k * 2]; if (l <= 0) continue; any = true; const nl = l - dt; this.sLife[k * 2] = nl;
      this.sVel[k * 3 + 1] -= 13 * dt; this.sPos[k * 3] += this.sVel[k * 3] * dt; this.sPos[k * 3 + 1] += this.sVel[k * 3 + 1] * dt; this.sPos[k * 3 + 2] += this.sVel[k * 3 + 2] * dt;
      this.sRot[k * 4] += this.sRot[k * 4 + 2] * dt; this.sRot[k * 4 + 1] += this.sRot[k * 4 + 3] * dt;
      const sc = nl <= 0 ? 0 : this.sScale[k] * Math.min(1, nl / (this.sLife[k * 2 + 1] * 0.6));
      this.q.setFromEuler(this.e.set(this.sRot[k * 4], this.sRot[k * 4 + 1], 0)); this.m4.compose(this.v.set(this.sPos[k * 3], this.sPos[k * 3 + 1], this.sPos[k * 3 + 2]), this.q, this.s.set(sc, sc, sc)); this.shards.setMatrixAt(k, this.m4);
    }
    if (any) this.shards.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) { if (!r.mesh.visible) continue; r.t += dt / r.dur; if (r.t >= 1) { r.mesh.visible = false; continue; } const e = 1 - (1 - r.t) * (1 - r.t); r.mesh.scale.setScalar(r.from + (r.to - r.from) * e); (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - r.t) * 0.6; }
    if (this.lightT > 0) { this.lightT -= dt; this.light.intensity *= Math.exp(-14 * dt); if (this.lightT <= 0) this.light.intensity = 0; }
  }
  clear() { this.queue.length = 0; this.cLife.fill(0); for (let i = 0; i < MAX_CUBES; i++) this.cubes.setMatrixAt(i, this.m4.makeScale(0, 0, 0)); this.cubes.instanceMatrix.needsUpdate = true; for (const p of this.pillars) p.mesh.visible = false; this.pLife.fill(0); this.sLife.fill(0); this.m4.makeScale(0, 0, 0); for (let i = 0; i < MAX_SHARDS; i++) this.shards.setMatrixAt(i, this.m4); this.shards.instanceMatrix.needsUpdate = true; for (const r of this.rings) r.mesh.visible = false; this.light.intensity = 0; }
}

/** Fading luminous ribbon that follows a moving point (disc trails, racing light tails). */
export class Ribbon {
  readonly mesh: THREE.Mesh; private pos: Float32Array; private n: number; private pts: Float32Array; private head = 0; private count = 0; private up: boolean;
  constructor(color: number, segments = 28, private width = 0.3, vertical = false, gain = 2) {
    this.n = segments; this.up = vertical; this.pos = new Float32Array(segments * 2 * 3); this.pts = new Float32Array(segments * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const al = new Float32Array(segments * 2); for (let i = 0; i < segments; i++) al[i * 2] = al[i * 2 + 1] = 1 - i / (segments - 1); g.setAttribute('alpha', new THREE.BufferAttribute(al, 1));
    const idx: number[] = []; for (let i = 0; i < segments - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor * (1.0 + ${gain.toFixed(2)} * vA), vA * vA * uOpacity); ${TONE} }` });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false;
  }
  setColor(c: number) { ((this.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setHex(c); }
  reset(x: number, y: number, z: number) { for (let i = 0; i < this.n; i++) { this.pts[i * 3] = x; this.pts[i * 3 + 1] = y; this.pts[i * 3 + 2] = z; } this.count = this.n; this.rebuild(); }
  push(x: number, y: number, z: number) {
    const lx = this.pts[0], ly = this.pts[1], lz = this.pts[2];
    if (this.count && (x - lx) ** 2 + (y - ly) ** 2 + (z - lz) ** 2 < 0.02) { this.rebuild(x, y, z); return; }
    this.pts.copyWithin(3, 0, (this.n - 1) * 3); this.pts[0] = x; this.pts[1] = y; this.pts[2] = z; this.count = Math.min(this.n, this.count + 1); this.rebuild();
  }
  private rebuild(hx?: number, hy?: number, hz?: number) {
    const p = this.pts, w = this.width / 2;
    for (let i = 0; i < this.n; i++) {
      const a = Math.max(0, i - 1) * 3, b = Math.min(this.n - 1, i + 1) * 3; let dx = p[b] - p[a], dz = p[b + 2] - p[a + 2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      let x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]; if (i === 0 && hx !== undefined) { x = hx; y = hy!; z = hz!; }
      const o = i * 6;
      if (this.up) { this.pos[o] = x; this.pos[o + 1] = y - w; this.pos[o + 2] = z; this.pos[o + 3] = x; this.pos[o + 4] = y + w; this.pos[o + 5] = z; }
      else { this.pos[o] = x - dz * w; this.pos[o + 1] = y; this.pos[o + 2] = z + dx * w; this.pos[o + 3] = x + dz * w; this.pos[o + 4] = y; this.pos[o + 5] = z - dx * w; }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
