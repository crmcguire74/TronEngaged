import * as THREE from 'three';
import { Rng } from '../../engine/math';
import { TONE, type Theme } from '../../engine/env';
import { mergeStatic } from '../../engine/merge';
import { inFeature, surfaceY, wrapIdx, type Track, type TrackFeature } from './track';

/**
 * Trackside world built from the circuit's own feature list: enclosed tunnels, elevated bridge spans, tower-walled
 * city canyons, and light posts along everything else. Everything here is decoration — the simulation only knows the
 * ribbon — so it is all instanced or merged and never collides.
 */

/** Emissive panel material used for tower faces: dark glass with a scatter of lit windows. */
function towerMaterial(th: Theme, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uAcc: { value: new THREE.Color(th.accent) }, uAcc2: { value: new THREE.Color(th.accent2) }, uTime: { value: 0 }, uSeed: { value: seed } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; varying vec3 vN; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uAcc, uAcc2; uniform float uTime, uSeed; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main(){
        // window lattice: a cell grid up the face, a fraction of it lit, a few cells pulsing
        vec2 g = vec2(floor(vUv.x * 7.0), floor(vUv.y * 26.0));
        float r = h21(g), lit = step(0.62, r);
        float pulse = 0.65 + 0.35 * sin(uTime * (0.6 + r * 2.2) + r * 30.0);
        vec2 f = fract(vec2(vUv.x * 7.0, vUv.y * 26.0));
        float pane = step(0.14, f.x) * step(f.x, 0.86) * step(0.2, f.y) * step(f.y, 0.8);
        vec3 col = vec3(0.004, 0.006, 0.011);
        col += mix(uAcc, uAcc2, step(0.86, r)) * lit * pane * pulse * 0.9;
        // a bright band runs round the crown and the base of every block
        float band = smoothstep(0.985, 1.0, vUv.y) + smoothstep(0.02, 0.0, vUv.y);
        col += uAcc * band * 1.4;
        // edge sheen so the silhouette reads against the sky
        vec3 v = normalize(cameraPosition - vW); col += uAcc * pow(1.0 - abs(dot(v, vN)), 4.0) * 0.5;
        float fade = 1.0 - smoothstep(420.0, 1100.0, length(vW - cameraPosition)); col *= 0.25 + 0.75 * fade;
        gl_FragColor = vec4(col, 1.0); ${TONE} }`,
  });
}

/** Tunnel shell: a dark arch over the ribbon with lit ribs and a strip running the length of the crown. */
function tunnelShell(t: Track, f: TrackFeature, th: Theme, timed: THREE.ShaderMaterial[]): THREE.Object3D {
  const g = new THREE.Group(), hw = t.width / 2, R = hw * 1.42, H = 7.4;
  const SEG = 14, n = f.i1 - f.i0;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let k = 0; k <= n; k++) {
    const i = wrapIdx(t, f.i0 + k), nx = -t.tz[i], nz = t.tx[i];
    // taper the mouth open at each end so a rider is never swallowed by a flat wall
    const mouth = Math.min(1, Math.min(k, n - k) / 7), ry = H * (0.55 + 0.45 * mouth), rx = R * (1 + (1 - mouth) * 0.22);
    for (let s = 0; s <= SEG; s++) {
      const a = (s / SEG) * Math.PI; // half-ring from right rail, over the crown, to the left rail
      pos.push(t.x[i] + nx * Math.cos(a) * rx, t.y[i] + Math.sin(a) * ry, t.z[i] + nz * Math.cos(a) * rx);
      uv.push(s / SEG, (f.i0 + k) * t.step);
      if (k < n && s < SEG) { const a0 = k * (SEG + 1) + s; idx.push(a0, a0 + SEG + 1, a0 + 1, a0 + 1, a0 + SEG + 1, a0 + SEG + 2); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: { uAcc: { value: new THREE.Color(th.accent) }, uAcc2: { value: new THREE.Color(th.accent2) }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uAcc, uAcc2; uniform float uTime; varying vec2 vUv; varying vec3 vW;
      void main(){
        float along = vUv.y, round = vUv.x;
        // ribs every six metres, a crown strip, and a pulse that runs away down the bore
        float rib = 1.0 - smoothstep(0.08, 0.26, abs(fract(along / 6.0) - 0.5) * 6.0);
        float crown = 1.0 - smoothstep(0.02, 0.09, abs(round - 0.5));
        float haunch = (1.0 - smoothstep(0.015, 0.06, abs(round - 0.17))) + (1.0 - smoothstep(0.015, 0.06, abs(round - 0.83)));
        float run = smoothstep(0.86, 1.0, sin(along * 0.14 - uTime * 2.6) * 0.5 + 0.5);
        vec3 col = vec3(0.006, 0.009, 0.015) + uAcc * (rib * 0.85 + crown * 0.5 + haunch * 0.6) + uAcc2 * crown * run * 1.6;
        float fade = 1.0 - smoothstep(90.0, 320.0, length(vW - cameraPosition)); col *= 0.3 + 0.7 * fade;
        gl_FragColor = vec4(col, 1.0); ${TONE} }`,
  });
  timed.push(mat); g.add(new THREE.Mesh(geo, mat));
  return g;
}

/** Bridge span: paired towers at each end, catenary cables, and vertical hangers down to the deck. */
function bridgeSpan(t: Track, f: TrackFeature, th: Theme, groundY: number): THREE.Object3D {
  const g = new THREE.Group(), hw = t.width / 2;
  const steel = new THREE.MeshStandardMaterial({ color: 0x080b11, metalness: 0.95, roughness: 0.28 });
  const lit = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent).multiplyScalar(1.5) });
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent2).multiplyScalar(1.4) });
  const span = (f.i1 - f.i0) * t.step, towerH = Math.min(62, 22 + span * 0.16);
  // sample indices arrive fractional from the cable sweeps; a typed array needs a whole one or it reads undefined
  const at = (i: number, d: number, y: number) => { const j = wrapIdx(t, Math.round(i)); return new THREE.Vector3(t.x[j] - t.tz[j] * d, t.y[j] + t.bank[j] * d + y, t.z[j] + t.tx[j] * d); };
  const ends = [f.i0 + 3, f.i1 - 3];
  for (const ei of ends) for (const s of [-1, 1]) {
    const base = at(ei, s * (hw + 2.2), 0);
    // A-frame tower: two raked legs meeting under a lit crown
    for (const r of [-1, 1]) {
      const foot = at(ei + r * 5, s * (hw + 3.4), 0), top = base.clone().setY(base.y + towerH);
      const len = foot.distanceTo(top), leg = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.86, len, 6), steel);
      leg.position.copy(foot).lerp(top, 0.5); leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize()); g.add(leg);
    }
    const crown = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 2.4), lit); crown.position.copy(base).setY(base.y + towerH); g.add(crown);
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.4, Math.max(4, base.y - groundY), 6), steel);
    pier.position.copy(base).setY((base.y + groundY) / 2); g.add(pier);
  }
  // main cables, sagging between the tower crowns, with hangers dropping to the deck edge
  for (const s of [-1, 1]) {
    const a = at(ends[0], s * (hw + 2.2), towerH), b = at(ends[1], s * (hw + 2.2), towerH);
    const pts: THREE.Vector3[] = []; const STEPS = 26;
    for (let k = 0; k <= STEPS; k++) { const u = k / STEPS, p = at(f.i0 + 3 + (f.i1 - f.i0 - 6) * u, s * (hw + 2.2), 0); p.y += towerH - Math.sin(u * Math.PI) * towerH * 0.66; pts.push(p); }
    pts[0].copy(a); pts[STEPS].copy(b);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), STEPS * 2, 0.17, 5, false), lit));
    for (let k = 2; k < STEPS - 1; k += 2) {
      const p = pts[k], deck = at(f.i0 + 3 + (f.i1 - f.i0 - 6) * (k / STEPS), s * (hw + 1.1), 0.6), h = Math.max(1, p.y - deck.y);
      const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, h, 4), steel); hang.position.copy(deck).setY(deck.y + h / 2); g.add(hang);
    }
  }
  // deck truss under the span, and a warm marker light at each end
  for (const s of [-1, 1]) for (let k = 0; k < f.i1 - f.i0; k += 6) {
    const p = at(f.i0 + k, s * (hw + 0.5), -1.5), q = at(f.i0 + k + 6, 0, -3.2), len = p.distanceTo(q);
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, len, 4), steel);
    d.position.copy(p).lerp(q, 0.5); d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize()); g.add(d);
  }
  for (const ei of ends) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), warm); m.position.copy(at(ei, 0, towerH + 1.4)); g.add(m); }
  return g;
}

/** City canyon: blocks of towers walling both sides of the ribbon, with sky-bridges across the gap. */
function cityCanyon(t: Track, f: TrackFeature, th: Theme, groundY: number, rng: Rng, timed: THREE.ShaderMaterial[]): THREE.Object3D {
  const g = new THREE.Group(), hw = t.width / 2, mat = towerMaterial(th, rng.range(0, 50)); timed.push(mat);
  const boxes: THREE.Matrix4[] = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const step = Math.max(5, Math.round(26 / t.step));
  for (let k = 0; k < f.i1 - f.i0; k += step) {
    const i = wrapIdx(t, f.i0 + k), yaw = Math.atan2(t.tx[i], t.tz[i]);
    for (const s of [-1, 1]) for (let row = 0; row < 2; row++) {
      const off = hw + 15 + row * 29 + rng.range(-3, 3), w = rng.range(9, 17), dep = rng.range(9, 18);
      const h = (row === 0 ? rng.range(26, 62) : rng.range(44, 128)) * (1 - row * 0.05);
      const base = groundY + 1;
      q.setFromEuler(e.set(0, yaw + rng.range(-0.1, 0.1), 0));
      v.set(t.x[i] - t.tz[i] * s * off, base + h / 2, t.z[i] + t.tx[i] * s * off); sc.set(w, h, dep);
      boxes.push(m.clone().compose(v, q, sc));
    }
  }
  if (boxes.length) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, boxes.length);
    boxes.forEach((mm, k) => inst.setMatrixAt(k, mm)); inst.frustumCulled = false; g.add(inst);
  }
  // sky-bridges arcing over the road: dark spans with a lit underside, high enough to clear everything
  const beam = new THREE.MeshStandardMaterial({ color: 0x06090e, metalness: 0.9, roughness: 0.35 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent2).multiplyScalar(1.3) });
  for (let k = step; k < f.i1 - f.i0; k += step * 3) {
    const i = wrapIdx(t, f.i0 + k), yaw = Math.atan2(t.tx[i], t.tz[i]), y = t.y[i] + rng.range(26, 46), w = hw * 2 + 30;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, 7), beam); b.position.set(t.x[i], y, t.z[i]); b.rotation.y = yaw; g.add(b);
    const u = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, 1.1), glow); u.position.set(t.x[i], y - 1.3, t.z[i]); u.rotation.y = yaw; g.add(u);
  }
  return g;
}

export interface SceneryOpts { groundY: number; seed: number; quality: 'low' | 'medium' | 'high' | string }

/**
 * Builds every trackside structure for a circuit and returns the group plus the shader materials that need a clock.
 * Light posts, support columns and tunnel ribs are instanced; the rest is a handful of merged meshes per section.
 */
export function buildScenery(t: Track, th: Theme, opts: SceneryOpts): { group: THREE.Group; timed: THREE.ShaderMaterial[] } {
  const G = new THREE.Group(), timed: THREE.ShaderMaterial[] = [], rng = new Rng(opts.seed), hw = t.width / 2, low = opts.quality === 'low';
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();

  for (const f of t.features) {
    if (f.kind === 'tunnel') G.add(tunnelShell(t, f, th, timed));
    else if (f.kind === 'bridge') G.add(mergeStatic(bridgeSpan(t, f, th, opts.groundY)));
    else if (f.kind === 'canyon' && !low) G.add(mergeStatic(cityCanyon(t, f, th, opts.groundY, rng, timed)));
  }

  // light posts: paired masts along everything that is not a tunnel, skipped inside bridge spans where the towers lead
  const every = 9, slots: number[] = [];
  for (let i = 0; i < t.n; i += every) if (!inFeature(t, i, 'tunnel') && !inFeature(t, i, 'bridge')) slots.push(i);
  if (slots.length) {
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1, 0.16), new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent2).multiplyScalar(1.5) }), slots.length * 2);
    slots.forEach((i, k) => {
      const yaw = Math.atan2(t.tx[i], t.tz[i]); q.setFromEuler(e.set(0, yaw, 0));
      for (const s of [-1, 1]) {
        v.set(t.x[i] - t.tz[i] * s * (hw + 0.9), surfaceY(t, i, s * hw) + 2.2, t.z[i] + t.tx[i] * s * (hw + 0.9));
        posts.setMatrixAt(k * 2 + (s > 0 ? 1 : 0), mx.compose(v, q, sc.set(1, 4.4, 1)));
      }
    });
    posts.frustumCulled = false; G.add(posts);
  }
  // support columns down to the ground, left out under bridge spans so their piers carry the deck instead
  const colIdx: number[] = [];
  for (let i = 0; i < t.n; i += 26) if (!inFeature(t, i, 'bridge')) colIdx.push(i);
  if (colIdx.length) {
    const cols = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x070a10, roughness: 0.4, metalness: 0.8 }), colIdx.length);
    colIdx.forEach((i, k) => { const h = t.y[i] - opts.groundY; q.identity(); cols.setMatrixAt(k, mx.compose(v.set(t.x[i], opts.groundY + h / 2 - 0.4, t.z[i]), q, sc.set(1.6, h, 1.6))); });
    cols.frustumCulled = false; G.add(cols);
  }
  return { group: G, timed };
}
