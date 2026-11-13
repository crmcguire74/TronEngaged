import * as THREE from 'three';
import { BaseSession, ctl, fmtTime, type Ctx, type SessionResult } from '../../app/context';
import type { Actions } from '../../input/input';
import type { SimEvent } from '../../engine/events';
import { CITY_PANO } from '../../engine/assets';
import { TONE, edgeBlock, gridFloor, hardlight, lights, skyDome, suppliedSky, skyline, theme, type Theme } from '../../engine/env';
import { Ribbon } from '../../engine/vfx';
import { Carrier, Drones, Patrol } from '../../engine/patrol';
import { angleLerp, clamp, damp, lerp, smooth, wrapAngle } from '../../engine/math';
import { buildRaceConfig } from '../../progression/build';
import { raceFinalScore } from '../../progression/scoring';
import { DIFFICULTIES, type DifficultyId, type TierDefinition } from '../../progression/types';
import { RaceSim, WALL_COOLDOWN, WALL_LAY, type RaceIntent } from './race';
import { wrapIdx, type Track } from './track';
import { RIVAL_MODELS, StartSequence, CYCLE_COLORS, CycleView, EYE, SpeedLines, css, cycleAssets, playerTrail } from './view';

const GATE = 0xffc23a;
const FORMAT_LABEL: Record<string, string> = { circuit: 'CIRCUIT', sprint: 'SPRINT', elimination: 'ELIMINATION', timetrial: 'TIME TRIAL', pursuit: 'PURSUIT', gauntlet: 'GAUNTLET' };

function ribbonGeo(t: Track, d0: number, d1: number, y0: number, y1: number, i0 = 0, i1 = t.n) {
  const n = i1 - i0 + (t.closed && i1 === t.n ? 1 : 0), pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx: number[] = [];
  for (let k = 0; k < n; k++) { const i = wrapIdx(t, i0 + k), nx = -t.tz[i], nz = t.tx[i], o = k * 6; pos[o] = t.x[i] + nx * d0; pos[o + 1] = t.y[i] + y0; pos[o + 2] = t.z[i] + nz * d0; pos[o + 3] = t.x[i] + nx * d1; pos[o + 4] = t.y[i] + y1; pos[o + 5] = t.z[i] + nz * d1; uv[k * 4] = 0; uv[k * 4 + 1] = (i0 + k) * t.step; uv[k * 4 + 2] = 1; uv[k * 4 + 3] = (i0 + k) * t.step; if (k < n - 1) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

/** Cycle Racing: fluid steering on spline circuits. Presentation over the shared RaceSim. */
let signTex: THREE.CanvasTexture | null = null;
/** A red warning triangle that floats over each hazard, so it reads as "avoid" from a distance. */
function warnSign(): THREE.CanvasTexture {
  if (signTex) return signTex; const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
  x.lineJoin = 'round'; x.beginPath(); x.moveTo(64, 12); x.lineTo(118, 108); x.lineTo(10, 108); x.closePath(); x.fillStyle = '#1a0503'; x.fill(); x.lineWidth = 10; x.strokeStyle = '#ff3a1c'; x.stroke();
  x.fillStyle = '#ff3a1c'; x.fillRect(58, 42, 12, 36); x.fillRect(58, 86, 12, 12); return (signTex = new THREE.CanvasTexture(c));
}

export class RaceSession extends BaseSession {
  readonly mode = 'cycle-race' as const; sim: RaceSim; private th: Theme; private intent: RaceIntent = { steer: 0, accel: 0, brake: 0, boost: false, ability: false };
  private cv: CycleView[] = []; private tails: Ribbon[] = []; private colors: number[] = []; private hz: THREE.Object3D[] = []; private timed: THREE.ShaderMaterial[] = []; private lines: SpeedLines; private fog: THREE.FogExp2;
  private patrol!: Patrol; private drones!: Drones; private carrier!: Carrier; private look = new THREE.Vector3(); private downCam = 0; private camYaw = 0; private camPos = new THREE.Vector3(); private v = new THREE.Vector3(); private v2 = new THREE.Vector3(); private cockpit: boolean; private offset = new THREE.Vector3(); private recentred = false; private radarPts: number[] = []; private ext = { cx: 0, cz: 0, r: 1 }; private storm = false; private padT = 0; private format: string; private yawPrev = 0; private vrFirst: boolean; private vrYaw = 0; private start!: StartSequence; private wallMesh: THREE.InstancedMesh | null = null; private m4 = new THREE.Matrix4(); private q4 = new THREE.Quaternion(); private s4 = new THREE.Vector3(); private col4 = new THREE.Color(); private walled = false; private surgeT = 0; private boostPrev = false; private seatDirty = false; private early: boolean; private moved = false; private kills = 0; private seen = { hazard: 0, pad: 0, slow: 0, gate: 0 }; private gv: { g: THREE.Group; spin: THREE.Group; fill: THREE.MeshBasicMaterial }[] = []; private noteT = 0; private note = '';

  static assets(tier: TierDefinition, cycle: string): string[] { return [...cycleAssets([cycle, ...RIVAL_MODELS, 'azure'], 'azure'), ...(['metropolis', 'neon-circuit'].includes(tier.environment) ? ['city'] : []), 'craft', 'drone', 'carrier']; }

  constructor(ctx: Ctx, tier: TierDefinition, diff: DifficultyId, salt = 0, stage = 0) {
    super(ctx, tier, diff);
    const cfg = buildRaceConfig(tier, diff, ctx.settings.cycle, stage, tier.endless ? salt : 0), sim = (this.sim = new RaceSim(cfg)), t = cfg.track, th = (this.th = theme(tier.environment)), W = this.world, eng = ctx.engine, hw = t.width / 2;
    this.format = cfg.format; this.cockpit = ctx.settings.cycleCamera === 'cockpit'; this.vrFirst = ctx.settings.vr.cycleView !== 'chase'; this.early = !tier.endless && tier.id <= 4;
    this.fog = new THREE.FogExp2(th.fog, th.fogDensity); eng.scene.fog = this.fog;
    const sky = suppliedSky(th, ctx.assets, tier.environment) ?? skyDome(th, ctx.assets.texture(CITY_PANO.wire), 1500, { lo: -30, hi: 46, gain: ctx.xr.presenting ? 0.5 : 0.6, mix: 0.9, tint: 0.7 }); W.add(sky); this.timed.push(sky.material as THREE.ShaderMaterial); lights(W, th, false);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9; for (let i = 0; i < t.n; i++) { minX = Math.min(minX, t.x[i]); maxX = Math.max(maxX, t.x[i]); minZ = Math.min(minZ, t.z[i]); maxZ = Math.max(maxZ, t.z[i]); minY = Math.min(minY, t.y[i]); if (i % 3 === 0) this.radarPts.push(t.x[i], t.z[i]); }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, R = Math.max(maxX - minX, maxZ - minZ) / 2; this.ext = { cx, cz, r: R + 10 }; const groundY = minY - 26;
    // patrol skimmers circle the circuit, sweeping it with searchlights
    this.patrol = new Patrol(ctx.assets, { cx, cz, radius: R * 0.75, height: minY + 72, floorY: minY, count: ctx.settings.quality === 'low' ? 2 : 3, color: th.accent }); W.add(this.patrol.group);
    // a camera drone paces the player, and a heavy carrier crosses the sky beyond the circuit
    this.drones = new Drones(ctx.assets, ctx.settings.quality === 'low' ? 1 : 2, th.accent); W.add(this.drones.group);
    this.carrier = new Carrier(ctx.assets, th.accent, { cx, cz, offset: R + 160, alt: minY + 140, heading: 0.7, len: R * 2 + 1500 }); W.add(this.carrier.group);
    const ground = gridFloor(6000, th, 10, { fade: 1400, glow: 0.5 }); ground.position.set(cx, groundY, cz); W.add(ground); this.timed.push(ground.material as THREE.ShaderMaterial);
    // road ribbon: real geometry matching the simulated width exactly
    const road = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { uLine: { value: new THREE.Color(th.accent) }, uAcc: { value: new THREE.Color(th.accent2) }, uTime: { value: 0 }, uW: { value: t.width } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 uLine, uAcc; uniform float uTime, uW; varying vec2 vUv; varying vec3 vW;
        void main(){ float x = (vUv.x - 0.5) * uW, v = vUv.y; float aw = fwidth(x) * 1.5;
          float edge = smoothstep(uW * 0.5 - 0.55, uW * 0.5 - 0.25, abs(x)); float lane = 1.0 - smoothstep(0.06, 0.06 + aw, abs(abs(x) - uW * 0.25));
          float dash = (1.0 - smoothstep(0.09, 0.09 + aw, abs(x))) * step(0.5, fract(v / 8.0)); float bar = 1.0 - smoothstep(0.03, 0.03 + fwidth(v) * 1.5, abs(fract(v / 16.0) - 0.5) * 16.0);
          float start = step(v, 3.0) * step(0.5, fract(x * 0.5) + step(1.5, v) * 0.5 - floor(fract(x * 0.5) + step(1.5, v) * 0.5));
          float dist = length(vW - cameraPosition); float fade = 1.0 - smoothstep(180.0, 520.0, dist);
          vec3 col = vec3(0.012, 0.016, 0.026) + uLine * (edge * 1.6 + lane * 0.3 * fade + bar * 0.06 * fade) + vec3(0.85) * dash * 0.5 * fade + vec3(1.0) * start * 0.7;
          vec3 vd = normalize(cameraPosition - vW); col += uLine * pow(1.0 - max(vd.y, 0.0), 6.0) * 0.08;
          gl_FragColor = vec4(col, 1.0); ${TONE} }` });
    W.add(new THREE.Mesh(ribbonGeo(t, -hw, hw, 0, 0), road)); this.timed.push(road);
    const under = new THREE.Mesh(ribbonGeo(t, -hw - 0.6, hw + 0.6, -0.35, -0.35), new THREE.MeshStandardMaterial({ color: 0x06080d, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide })); W.add(under);
    const railTop = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent).multiplyScalar(1.15), side: THREE.DoubleSide });
    for (const s of [-1, 1]) { const m = hardlight(th.accent, 0.1, 0.5, 0.05); this.timed.push(m); const rail = new THREE.Mesh(ribbonGeo(t, s * hw, s * hw, 0, 0.8), m); W.add(rail, new THREE.Mesh(ribbonGeo(t, s * hw - 0.05, s * hw + 0.05, 0.8, 0.8), railTop)); }
    // supports, trackside light posts / tunnel frames (instanced)
    const tunnel = tier.environment === 'data-tunnel', every = tunnel ? 5 : 9, count = Math.floor(t.n / every), mx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const frameGeo = tunnel ? new THREE.TorusGeometry(1, 0.03, 4, 4) : new THREE.BoxGeometry(0.16, 1, 0.16);
    const frames = new THREE.InstancedMesh(frameGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(tunnel ? th.accent : th.accent2).multiplyScalar(1.5) }), tunnel ? count : count * 2);
    const cols = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x070a10, roughness: 0.4, metalness: 0.8 }), Math.floor(t.n / 26) + 1);
    for (let k = 0; k < count; k++) { const i = k * every, yaw = Math.atan2(t.tx[i], t.tz[i]);
      if (tunnel) { q.setFromEuler(e.set(0, yaw, Math.PI / 4)); mx.compose(this.v.set(t.x[i], t.y[i] + 2.6, t.z[i]), q, this.v2.set(hw * 1.5, hw * 1.5, 1)); frames.setMatrixAt(k, mx); }
      else for (const s of [-1, 1]) { q.setFromEuler(e.set(0, yaw, 0)); mx.compose(this.v.set(t.x[i] - t.tz[i] * s * (hw + 0.9), t.y[i] + 2.2, t.z[i] + t.tx[i] * s * (hw + 0.9)), q, this.v2.set(1, 4.4, 1)); frames.setMatrixAt(k * 2 + (s > 0 ? 1 : 0), mx); } }
    for (let k = 0; k < cols.count; k++) { const i = Math.min(t.n - 1, k * 26), h = t.y[i] - groundY; q.identity(); mx.compose(this.v.set(t.x[i], groundY + h / 2 - 0.4, t.z[i]), q, this.v2.set(1.6, h, 1.6)); cols.setMatrixAt(k, mx); }
    frames.frustumCulled = cols.frustumCulled = false; W.add(frames, cols);
    // checkpoint gates and the start gantry
    const gate = (i: number, col: number, big: boolean) => { const g = new THREE.Group(), hgt = big ? 8 : 6; for (const s of [-1, 1]) { const p = edgeBlock(0.7, hgt, 0.7, col); p.position.set(s * (hw + 1), hgt / 2, 0); g.add(p); } const top = edgeBlock(t.width + 2.7, big ? 1.6 : 0.6, 0.7, col); top.position.y = hgt; g.add(top); g.position.set(t.x[i], t.y[i], t.z[i]); g.rotation.y = Math.atan2(t.tx[i], t.tz[i]); W.add(g); };
    gate(0, th.accent2, true); for (const c of sim.checkpoints) if (c !== 0) gate(c, th.accent, false); if (!t.closed) gate(t.n - 4, th.accent2, true);
    for (const p of sim.pads) { const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x6dffb0) } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }', fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv; void main(){ float c = fract((vUv.y - abs(vUv.x - 0.5) * 6.0) / 4.0 - uTime * 2.5); float a = smoothstep(0.55, 0.9, c); gl_FragColor = vec4(uColor * 2.0, a * 0.85); ${TONE} }` }); this.timed.push(m); const mesh = new THREE.Mesh(ribbonGeo(t, p.d - p.hw, p.d + p.hw, 0.04, 0.04, p.i0, p.i1 + 1), m); W.add(mesh); }
    // charge gates: a gold hoop standing on the road with spinning chevrons; ride through the middle to recharge the light wall
    for (const gt of sim.gates) {
      const g = new THREE.Group(), spin = new THREE.Group(), gold = new THREE.MeshBasicMaterial({ color: GATE }), dim = new THREE.MeshBasicMaterial({ color: new THREE.Color(GATE).multiplyScalar(0.4) }), r = gt.r;
      g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.16, 10, 64), gold), new THREE.Mesh(new THREE.TorusGeometry(r + 0.42, 0.05, 6, 64), dim));
      const fill = new THREE.MeshBasicMaterial({ color: GATE, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }); g.add(new THREE.Mesh(new THREE.CircleGeometry(r - 0.1, 48), fill));
      const chev = new THREE.Shape(); chev.moveTo(0, 0); chev.lineTo(-0.42, 0.5); chev.lineTo(-0.22, 0.5); chev.lineTo(0, 0.24); chev.lineTo(0.22, 0.5); chev.lineTo(0.42, 0.5); chev.closePath();
      const cg = new THREE.ShapeGeometry(chev); cg.translate(0, r - 0.85, 0); const cm = new THREE.MeshBasicMaterial({ color: GATE, side: THREE.DoubleSide });
      for (let k = 0; k < 8; k++) { const m = new THREE.Mesh(cg, cm); m.rotation.z = (k / 8) * Math.PI * 2; spin.add(m); } g.add(spin);
      // two feet on the road so it stands, not floats
      for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x0a0d12, metalness: 0.9, roughness: 0.3 })); leg.position.set(sx * r * 0.62, -r * 0.82, 0); g.add(leg); }
      const i = wrapIdx(t, gt.idx); g.position.set(t.x[i] - t.tz[i] * gt.d, t.y[i] + r + 0.35, t.z[i] + t.tx[i] * gt.d); g.rotation.y = Math.atan2(t.tx[i], t.tz[i]);
      W.add(g); this.gv.push({ g, spin, fill });
    }
    const signTex = warnSign(); for (const h of sim.hazards) { const g = new THREE.Group(); const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.15), new THREE.MeshBasicMaterial({ color: 0xff2a14 })); core.position.y = 1.3; const shell = new THREE.Mesh(new THREE.OctahedronGeometry(1.5), new THREE.MeshBasicMaterial({ color: 0xff7a3c, wireframe: true })); shell.position.y = 1.3; const pad = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.1, 6), new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.06; const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, transparent: true, depthWrite: false })); sign.scale.set(2.6, 2.6, 1); sign.position.y = 4.6; const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); beam.position.y = 4.5; g.add(core, shell, beam, pad, sign); W.add(g); this.hz.push(g); }
    for (const s of sim.slows) { const mid = wrapIdx(t, Math.round((s.i0 + s.i1) / 2)), len = (s.i1 - s.i0) * t.step; const box = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: 0x8a5cff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); box.scale.set(len * 0.55, 12, len * 0.55); box.position.set(t.x[mid], t.y[mid] + 3, t.z[mid]); W.add(box); }
    if (ctx.assets.has('city') && ['metropolis', 'neon-circuit'].includes(tier.environment) && t.closed) { const c = ctx.assets.instance('city').root; let rmin = 1e9; for (let i = 0; i < t.n; i++) rmin = Math.min(rmin, Math.hypot(t.x[i] - cx, t.z[i] - cz)); const box = new THREE.Box3().setFromObject(c), half = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 || 50, k = Math.max(0, rmin - hw - 16) / half; c.visible = k * half > 40; c.scale.setScalar(k); c.position.set(cx - ((box.min.x + box.max.x) / 2) * k, groundY + 8.4 * k, cz - ((box.min.z + box.max.z) / 2) * k); c.traverse((o: any) => { if (o.isMesh) o.castShadow = false; }); W.add(c); }
    const sl = skyline(90, R + 160, R + 620, th, tier.id * 5 + stage, groundY, 220); sl.position.set(cx, 0, cz); W.add(sl);
    sim.racers.forEach((r) => { const col = r.isPlayer ? playerTrail(ctx) : CYCLE_COLORS[r.model] ?? 0xff5a36; this.colors.push(col); const v = new CycleView(ctx, r.model, col, r.isPlayer ? 'char:' + ctx.settings.skin : undefined); v.reveal.value = r.y - 1; v.parked = true; W.add(v.root); this.cv.push(v); const tail = new Ribbon(col, 16, 0.22); (tail.mesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.45; tail.reset(r.x, r.y + 0.5, r.z); W.add(tail.mesh); this.tails.push(tail); });
    this.lines = new SpeedLines(th.accent); W.add(this.lines.mesh);
    W.add(ctx.vfx.group); ctx.vfx.clear(); eng.setWorld(W); eng.scene.fog = this.fog;
    ctx.hud.show('race'); ctx.audio.playMusic('race'); ctx.audio.ambience(tier.environment); ctx.audio.intensity = 0.3; ctx.audio.setCrowdBed(0);
    const stages = Number(tier.params.stages ?? 1);
    ctx.hud.banner(`TIER ${tier.endless ? '∞' : String(tier.id).padStart(2, '0')} — ${tier.name.toUpperCase()}${stages > 1 ? ` · STAGE ${stage + 1}/${stages}` : ''}`, `${FORMAT_LABEL[cfg.format]} — ${this.goal()}`, this.introDur * 1000 - 400);
    this.camYaw = this.yawPrev = sim.player.h; this.view(0, 1, ctx.input.actions); this.start = new StartSequence(ctx, this.cv, this.colors, sim.racers.indexOf(sim.player));
  }
  private goal() { const c = this.sim.cfg; return c.format === 'timetrial' ? `beat ${fmtTime(this.sim.parTime)}` : c.format === 'pursuit' ? 'catch the runner before it finishes' : c.format === 'gauntlet' ? 'finish with integrity remaining' : c.format === 'elimination' ? 'last place is cut at intervals — survive' : `finish in the top ${c.passPlace}`; }

  protected intro(k: number, dt: number) {
    const P = this.sim.player, cam = this.ctx.engine.camera, vfx = this.ctx.vfx;
    this.sim.racers.forEach((r, i) => { const t = clamp((k - 0.1 - i * 0.04) / 0.45, 0, 1); this.cv[i].reveal.value = r.y - 0.1 + t * 1.6; if (t > 0 && t < 1 && Math.random() < 0.7) vfx.motes(r.x, r.y, r.z, this.colors[i], 1.4, 1.4, 4); if (t >= 1) this.cv[i].reveal.value = 1e4; });
    this.start.update(this.t, dt);
    if (this.xr) return;
    const e = smooth(k), a = P.h + Math.PI + lerp(2.4, 0, e), r = lerp(26, this.cockpit ? 0.4 : 9, e), h = lerp(11, this.cockpit ? 1.3 : 3.6, e);
    this.camPos.set(P.x + Math.sin(a) * r, P.y + h, P.z + Math.cos(a) * r); cam.position.copy(this.camPos); cam.lookAt(P.x + Math.sin(P.h) * 10 * e, P.y + 1, P.z + Math.cos(P.h) * 10 * e);
  }
  protected onCountdown() { this.start.finish(); for (const v of this.cv) { v.reveal.value = 1e4; v.seal(); } this.ctx.audio.engine(true); this.ctx.audio.sfx('spawn'); }
  protected onStart() { this.ctx.audio.intensity = 0.8; for (const v of this.cv) v.launch(); this.ctx.audio.sfx('boost'); }

  protected step(dt: number, a: Actions, first: boolean) {
    const it = this.intent, P = this.sim.player; it.steer = a.steer; it.accel = a.accel; it.brake = a.brake; it.ability = first && a.ability;
    if (first) { if (a.boost && !this.boostPrev) this.surgeT = 1.15; this.boostPrev = a.boost; } this.surgeT -= dt; it.boost = a.boost || this.surgeT > 0;
    if (this.ctx.settings.steerAssist) { const hw = this.sim.track.width / 2, k = Math.abs(P.d) / hw; if (k > 0.68) it.steer = clamp(it.steer - Math.sign(P.d) * (k - 0.68) * 2.2, -1, 1); }
    this.sim.step(dt, it); for (const e of this.sim.events) this.onEvent(e); this.sim.events.length = 0;
  }
  protected ended() { return this.sim.state !== 'active'; }
  protected finish(): SessionResult {
    const sim = this.sim, s = sim.stats, won = sim.state === 'won', fs = raceFinalScore(s, won, this.tier.scoreMul, DIFFICULTIES[this.diff].scoreMul), { audio } = this.ctx, f = this.format;
    audio.engine(false); audio.intensity = 0.25; this.ctx.hud.coach(null); if (won) { audio.sfx('win'); audio.cheer(1.4); audio.vo(s.place === 1 ? 'winner' : 'you_win', s.place === 1 ? 'First across the line.' : 'Event complete.'); } else { audio.sfx('lose'); audio.vo('you_lose', 'Event failed.'); }
    const detail = f === 'timetrial' ? `${fmtTime(s.time)} against ${fmtTime(sim.parTime)}` : f === 'pursuit' ? (won ? 'Runner intercepted' : 'The runner escaped') : f === 'gauntlet' ? (won ? 'Integrity held' : 'Integrity lost') : f === 'elimination' ? (won ? 'Last rider running' : 'Cut from the field') : `P${s.place} of ${s.field}${won ? '' : ` — top ${sim.cfg.passPlace} required`}`;
    return { won, score: fs.total, lines: fs.lines, time: s.time, headline: won ? 'EVENT WON' : 'EVENT LOST', detail,
      stats: [['Position', `P${s.place} / ${s.field}`], ['Time', fmtTime(s.time)], ['Best lap', s.bestLap ? fmtTime(s.bestLap) : '—'], ['Overtakes', String(s.overtakes)], ['Takedowns', String(s.takedowns ?? 0)], ['Clean sectors', `${s.cleanSections} / ${s.sections}`], ['Rail contacts', String(s.scrapes)]] };
  }

  private onEvent(e: any) {
    const { vfx, audio, hud, engine, xr, input } = this.ctx, mine = e.id === this.sim.player.id || e.player, col = e.id ? this.colors[e.id - 1] : 0xffffff;
    switch (e.type) {
      case 'scrape': vfx.sparks(e.x, e.y + 0.4, e.z, 0xffe9c0, e.hard ? 30 : 12, 9, 0.35); if (mine) { audio.sfx('scrape'); engine.addShake(e.hard ? 0.5 : 0.2); xr.pulse('both', e.hard ? 0.9 : 0.4, 80); input.rumble(0.7, 0.4, 120); } else audio.sfx('scrape', e); break;
      case 'hazardHit': vfx.shatter(e.x, e.y, e.z, 0xff3b4e, 40, 1.2); audio.sfx('hit', mine ? undefined : e); if (mine) { hud.flash('hurt'); engine.addShake(0.8); xr.pulse('both', 1, 200); input.rumble(1, 1, 250); hud.toast('IMPACT', 'danger'); } break;
      case 'bump': vfx.sparks(e.x, e.y + 0.6, e.z, 0xffffff, 10, 6, 0.3); audio.sfx('block', e); input.rumble(0.5, 0.5, 80); break;
      case 'boost': if (e.on) audio.sfx('boost', mine ? undefined : this.pos(e.id)); break;
      case 'drift': if (e.on) audio.sfx('drift'); break;
      case 'driftBoost': hud.toast('DRIFT BOOST', 'good'); audio.sfx('pad'); break;
      case 'charge': if (e.mine) { audio.sfx('pad'); audio.sfx('ready'); hud.toast('LIGHT WALL RECHARGED', 'good'); hud.flash('good'); xr.pulse('both', 0.5, 70); } break;
      case 'pad': if (this.padT <= 0) { this.padT = 0.6; audio.sfx('pad'); hud.toast('BOOST PAD', 'good'); } break;
      case 'storm': this.storm = e.on; if (e.on) { audio.sfx('interfere'); hud.toast('STORM CELL — SPEED CUT', 'warn'); } break;
      case 'checkpoint': audio.sfx('checkpoint'); hud.toast(`CHECKPOINT ${e.index}  ${fmtTime(e.time)}`, 'info'); break;
      case 'lap': audio.sfx('lap'); hud.toast(`LAP ${fmtTime(e.time)}`, 'score'); if (e.final) { hud.banner('FINAL LAP', '', 1600); audio.say('Final lap.'); } break;
      case 'overtake': hud.toast(`OVERTAKE — P${e.place}`, 'good'); if (e.place === 1) audio.cheer(0.8); break;
      case 'finish': if (!mine) hud.toast(`RIVAL FINISHED — P${e.place}`, 'warn'); break;
      case 'eliminated': vfx.shatter(e.x, e.y, e.z, col, 100, 1.3); audio.sfx('shatter', mine ? undefined : e); this.cv[e.id - 1].root.visible = false; if (!mine && e.rail) { hud.toast('RIVAL OFF THE ROAD', 'score'); audio.cheer(0.9); } else if (!mine && e.wall) { hud.toast(e.by === this.sim.player.id ? 'RIVAL DESTROYED ON YOUR WALL' : 'RIVAL DESTROYED', e.by === this.sim.player.id ? 'score' : 'warn'); if (e.by === this.sim.player.id) audio.cheer(1); } else if (!mine) { hud.toast(`RIDER CUT — ${e.left} LEFT`, 'warn'); if (e.left === 2) audio.say('Final runner remaining.'); } break;
      case 'takedown': {
        // a rival derezzes on your wall (or off the road): big, unmissable, and counted
        const v = this.cv[e.id - 1], mineKill = e.by === this.sim.player.id && !mine; v.root.visible = false; this.tails[e.id - 1].mesh.visible = false;
        vfx.derez(e.x, e.y, e.z, col, { height: 1.5, count: mine ? 420 : 260, power: mine ? 11 : 9, floorR: this.sim.track.width / 2, big: mineKill || mine });
        if (mine) { this.downCam = 0; hud.banner('DEREZZED', 'You rode into a light wall — re-forming', 1500); audio.say('Derezzed.'); engine.addShake(1); engine.derez = 0.45; xr.pulse('both', 1, 400); input.rumble(1, 1, 450); }
        else if (e.cause === 'wall' && e.by !== this.sim.player.id && this.sim.racers[e.id - 1].progress > this.sim.player.progress - 3) hud.toast('RIVAL DEREZZED', 'info'); audio.sfx('shatter', e); audio.sfx('explosion', e);
        if (mineKill) { this.kills++; hud.banner('TAKEDOWN', e.cause === 'wall' ? 'A rival derezzed on your light wall' : 'A rival was thrown off the road', 1700); hud.toast('TAKEDOWN  +220', 'score'); audio.say('Trap confirmed.'); audio.cheer(1.2); xr.pulse('both', 0.9, 160); input.rumble(0.8, 0.8, 200); engine.addShake(0.4); }
        break;
      }
      case 'reform': { if (mine) { hud.toast('RE-FORMED — GO', 'good'); audio.sfx('go'); } const v = this.cv[e.id - 1]; v.root.visible = true; this.tails[e.id - 1].mesh.visible = true; this.tails[e.id - 1].reset(e.x, e.y + 0.5, e.z); vfx.motes(e.x, e.y, e.z, col, 1.4, 1.6, 40); vfx.ring(e.x, e.y + 0.1, e.z, col, 0.4, 5, 0.5); audio.sfx('spawn', e); break; }
      case 'caught': vfx.shatter(e.x, e.y, e.z, col, 120, 1.3); audio.sfx('shatter'); this.cv[e.id - 1].root.visible = false; break;
      case 'shunt': vfx.sparks(e.x, e.y + 0.6, e.z, 0xffffff, 34, 11, 0.5); audio.sfx('block', e.player ? undefined : e); if (e.by === this.sim.player.id) { hud.toast('SHUNT', 'good'); xr.pulse('both', 0.8, 120); } else if (e.player) { hud.toast('RAMMED', 'danger'); hud.flash('hurt'); engine.addShake(0.6); xr.pulse('both', 1, 200); } break;
      case 'wall': audio.sfx('boost', mine ? undefined : this.pos(e.id)); if (mine) { this.walled = true; hud.toast('LIGHT WALL ON', 'good'); xr.pulse('both', 0.5, 80); } else { const r = this.sim.racers[e.id - 1], P = this.sim.player; if (r.progress > P.progress && (r.progress - P.progress) * this.sim.track.step < 60) hud.toast('LIGHT WALL AHEAD — STEER ROUND IT', 'warn'); } break;
      case 'wallHit': audio.sfx('crash'); hud.flash('hurt'); hud.toast('DEREZZED ON A LIGHT WALL', 'danger'); break;
      case 'pulse': vfx.ring(e.x, e.y + 0.4, e.z, col, 0.5, 13, 0.5); audio.sfx('power', mine ? undefined : e); if (!mine && this.sim.player.stun > 0) hud.toast('PULSED', 'danger'); break;
      case 'integrity': hud.toast(`INTEGRITY ${e.left}`, 'danger'); break;
    }
  }
  private pos(id: number) { const r = this.sim.racers[id - 1]; return { x: r.x, y: r.y + 0.8, z: r.z }; }

  protected view(dt: number, alpha: number, a: Actions) {
    const { engine, hud, audio, vfx, xr } = this.ctx, sim = this.sim, P = sim.player, T = sim.track, t = engine.elapsed, cam = engine.camera;
    for (const m of this.timed) m.uniforms.uTime.value = t; this.patrol.update(dt); vfx.update(dt); this.padT -= dt; this.sim.gates.forEach((gt, k) => { const v = this.gv[k]; if (!v) return; v.spin.rotation.z = t * 1.4 + k; const f = gt.flash / 0.6; v.fill.opacity = 0.06 + 0.03 * Math.sin(t * 4 + k) + 0.45 * f; v.g.scale.setScalar(1 + 0.15 * f); });
    if (a.camera && !this.xr && this.phase !== 'intro') { this.cockpit = !this.cockpit; this.ctx.settings.cycleCamera = this.cockpit ? 'cockpit' : 'chase'; }
    this.fog.density = damp(this.fog.density, this.th.fogDensity * (this.storm ? 7 : 1), 3, dt);
    const hums: { x: number; y: number; z: number; pitch: number; gain: number }[] = [];
    sim.racers.forEach((r, i) => {
      const v = this.cv[i]; if (r.out || r.downT > 0) { v.root.visible = false; this.tails[i].mesh.visible = false; return; }
      const x = lerp(r.px, r.x, alpha), y = lerp(r.py, r.y, alpha), z = lerp(r.pz, r.z, alpha), yaw = r.ph + wrapAngle(r.h - r.ph) * alpha, j = wrapIdx(T, r.idx + 3), pitch = -Math.atan2(T.y[j] - T.y[r.idx], 3 * T.step);
      v.lean = damp(v.lean, clamp(r.steer * 0.42 * clamp(r.speed / 30, 0, 1) + r.slip * 0.5, -0.75, 0.75), 9, dt); v.pose(x, y, z, yaw, dt, r.speed / r.veh.top, false, pitch);
      (v.glow.material as THREE.MeshBasicMaterial).opacity = r.boosting ? 0.65 : 0.25; v.body.visible = r.stun <= 0 || Math.sin(t * 40) > 0;
      this.tails[i].push(x - Math.sin(yaw) * 1.3, y + 0.45, z - Math.cos(yaw) * 1.3);
      if (r.boosting && Math.random() < 0.7) vfx.sparks(x - Math.sin(yaw) * 1.4, y + 0.4, z - Math.cos(yaw) * 1.4, this.colors[i], 2, 4, 0.3, { x: -Math.sin(yaw), y: 0.3, z: -Math.cos(yaw) }, 2, 0.4);
      if (r.drifting && Math.random() < 0.8) vfx.sparks(x, y + 0.1, z, 0xffffff, 1, 3, 0.25, undefined, 5, 0.3);
      if (!r.isPlayer) hums.push({ x, y: y + 0.8, z, pitch: 60 + r.speed * 1.8, gain: 0.06 });
    });
    hums.sort((p, q) => Math.hypot(p.x - P.x, p.z - P.z) - Math.hypot(q.x - P.x, q.z - P.z)); audio.hums(hums.slice(0, 3));
    sim.hazards.forEach((h, i) => { const g = this.hz[i]; g.position.set(h.x, h.y, h.z); g.children[0].rotation.y = t * 2; g.children[1].rotation.y = -t * 1.3; g.children[0].scale.setScalar(1 + 0.12 * Math.sin(t * 8 + i)); });
    const px = lerp(P.px, P.x, alpha), py = lerp(P.py, P.y, alpha), pz = lerp(P.pz, P.z, alpha), yaw = P.ph + wrapAngle(P.h - P.ph) * alpha, sp01 = P.speed / P.veh.top;
    this.drones.follow(dt, px, py, pz, yaw, this.look.set(px, py + 0.9, pz)); this.carrier.update(dt);
    const yawRate = Math.abs(wrapAngle(yaw - this.yawPrev)) / Math.max(dt, 1e-3); this.yawPrev = yaw;
    const dev = a.device, pi = sim.racers.indexOf(P); hud.menuHint = ctl(dev, 'ESC — MENU   ·   C — VIEW', 'START — MENU   ·   RB — VIEW', `HOLD ${xr.labels.menu} — MENU   ·   ${xr.labels.view} — VIEW   ·   ${xr.labels.turn} ↕ — SEAT`);
    if (!this.xr) hud.vrSeat = null;
    this.start?.tick(dt); const seated = !this.start || this.start.seated;
    if (a.camera && this.xr && seated && this.phase !== 'intro') { this.vrFirst = !this.vrFirst; this.ctx.settings.vr.cycleView = this.vrFirst ? 'cockpit' : 'chase'; hud.toast(this.vrFirst ? 'COCKPIT VIEW' : 'CHASE VIEW', 'info'); }
    const down = P.downT > 0; if (down) this.downCam += dt; const first = this.xr ? this.vrFirst && seated : this.cockpit && this.phase !== 'intro' && !down;
    const me = this.cv[pi]; me.firstPerson(first); me.setPower(this.phase === 'intro' ? smooth(clamp(this.t / this.introDur * 1.4 - 0.2, 0, 1)) : 1);
    // cockpit: the yoke and hands follow the controls, and the lamps beside the display show the light wall's state
    const live = this.phase === 'play'; me.drive(live ? this.intent.steer : 0, live ? this.intent.accel : 0, live ? this.intent.brake : 0, sp01, P.boosting, dt);
    me.setWall(!sim.lightwalls ? 'none' : P.wallT > 0 ? 'on' : P.wallCd <= 0 ? 'ready' : 'charging', 1 - P.wallCd / WALL_COOLDOWN); if (this.phase === 'outro') me.unseal(); hud.vrMode = first ? 'dash' : 'belt'; hud.drawVR(dt);
    if (this.xr && !seated) { if (!this.recentred) { this.recentred = true; this.offset.copy(cam.position); this.vrYaw = yaw; } this.start.placeBeside(px, py, pz, yaw, this.offset); hud.vrSeat = null; xr.showHands = true; xr.update(dt, false); engine.vignetteAmount = 0; }
    else if (this.xr) {
      // rider-relative frame: follows heading in yaw only (horizon stabilised), with a speed/turn-scaled comfort vignette
      const rig = engine.rig; if (!this.recentred) { this.recentred = true; this.offset.copy(cam.position); this.vrYaw = yaw; }
      // the view frame follows a lightly filtered heading, so small steering corrections do not shake the whole world
      this.vrYaw = angleLerp(this.vrYaw, yaw, 1 - Math.exp(-(first ? 12 : 6) * dt)); if (first) this.cv[pi].setYaw(this.vrYaw);
      rig.rotation.set(0, this.vrYaw + Math.PI, 0); const off = this.v.copy(this.offset).applyQuaternion(rig.quaternion), back = first ? -EYE.z : 5.6, up = first ? EYE.y : 2.9;
      const vs = this.ctx.settings.vr; if (first && xr.dashAdjust && this.phase !== 'intro') { vs.seat = clamp((vs.seat ?? 0) + xr.dashAdjust * 0.3 * dt, -0.35, 0.35); this.seatDirty = true; }
      rig.position.set(px - Math.sin(this.vrYaw) * back - off.x, py + up + (first ? vs.seat ?? 0 : vs.height) - this.offset.y, pz - Math.cos(this.vrYaw) * back - off.z);
      hud.vrSeat = this.offset; xr.showHands = !first;
      xr.update(dt, false); engine.vignetteAmount = this.phase === 'play' ? this.ctx.settings.vr.vignette * clamp(sp01 * 0.5 + yawRate * 0.5, 0, 1) : 0;
    } else if (this.phase !== 'intro') {
      this.camYaw = angleLerp(this.camYaw, yaw, 1 - Math.exp(-(first ? 60 : 6) * dt)); const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
      if (first) { cam.position.set(px + fx * EYE.z, py + EYE.y, pz + fz * EYE.z); cam.lookAt(px + fx * 30, py + 0.95, pz + fz * 30); }
      else { const lift = down ? smooth(clamp(this.downCam / 1.2, 0, 1)) : 0, d = 7.6 + sp01 * 2.4 + lift * 9; this.v.set(px - fx * d, py + 3.1 + sp01 * 0.5 + lift * 7, pz - fz * d); this.camPos.x = this.v.x; this.camPos.z = this.v.z; this.camPos.y = damp(this.camPos.y, this.v.y, 8, dt); cam.position.copy(this.camPos); cam.lookAt(px + fx * 10, py + 1.1, pz + fz * 10); }
      const tf = engine.reducedMotion ? 66 : (first ? 74 : 62) + sp01 * (first ? 10 : 18) + (P.boosting ? 7 : 0); if (Math.abs(cam.fov - tf) > 0.1) { cam.fov = damp(cam.fov, tf, 4, dt); cam.updateProjectionMatrix(); }
    }
    // light walls: one instanced slab per piece, in its owner's colour, sinking away as it expires
    if (sim.lightwalls) {
      if (!this.wallMesh) { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); this.wallMesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }), 420); this.wallMesh.frustumCulled = false; this.world.add(this.wallMesh); }
      const wm = this.wallMesh, n = Math.min(420, sim.walls.length);
      for (let i = 0; i < n; i++) { const w = sim.walls[i], dx = w.x1 - w.x0, dz = w.z1 - w.z0, len = Math.hypot(dx, dz), life = w.until - sim.time; this.s4.set(0.14, 1.5 * clamp(life / 0.6, 0, 1), len + 0.05); this.q4.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(dx, dz)); this.v.set((w.x0 + w.x1) / 2, w.y, (w.z0 + w.z1) / 2); wm.setMatrixAt(i, this.m4.compose(this.v, this.q4, this.s4)); wm.setColorAt(i, this.col4.setHex(this.colors[w.owner - 1]).multiplyScalar(1.3)); }
      wm.count = n; wm.instanceMatrix.needsUpdate = true; if (wm.instanceColor) wm.instanceColor.needsUpdate = true;
    }
    this.lines.update(px, py, pz, yaw, P.speed, t, this.phase === 'play' && !engine.reducedMotion && !this.xr ? clamp((sp01 - 0.6) * 2, 0, 1) : 0);
    if (P.speed > 25) this.moved = true;
    if (this.phase === 'play') {
      const key = ctl(dev, 'E', 'B', xr.labels.ability); let tip: string | null = null;
      if (this.early) tip = sim.time < 4 ? 'GOAL: ' + this.goal().toUpperCase() : !this.moved ? ctl(dev, 'W throttle · A / D steer', 'RT throttle · LEFT STICK steer', 'ANY TRIGGER or GRIP throttle · EITHER STICK steers') : sim.time < 22 && this.tier.id === 2 ? ctl(dev, 'S + steer to DRIFT · SHIFT boost', 'LT + steer to DRIFT · A boost', xr.labels.move + ' BACK + steer to DRIFT · ' + xr.labels.surge + ' = SUPER SPEED') : null;
      // first sight of each thing on the road: say what it is, once or twice, as it comes up
      this.noteT -= dt; const ahead = (idx: number) => { let k = idx - P.idx; if (T.closed && k < -T.n / 2) k += T.n; return k * T.step; };
      const flag = (kind: 'hazard' | 'pad' | 'slow' | 'gate', text: string) => { if (this.noteT > -3 || this.seen[kind] >= 2) return; this.seen[kind]++; this.note = text; this.noteT = 4.5; };
      for (const h of sim.hazards) { const d = ahead(h.idx); if (d > 10 && d < 110) { flag('hazard', 'RED CRYSTAL AHEAD = HAZARD · HITTING ONE STALLS YOU · STEER ROUND IT'); break; } }
      for (const p of sim.pads) { const d = ahead(p.i0); if (d > 10 && d < 90) { flag('pad', 'GREEN ARROWS = SPEED STRIP · RIDE OVER THEM FOR FREE SPEED'); break; } }
      for (const g of sim.gates) { const d = ahead(g.idx); if (d > 10 && d < 110) { flag('gate', 'GOLD HOOP = CHARGE GATE · RIDE THROUGH IT TO RECHARGE YOUR LIGHT WALL'); break; } }
      for (const z of sim.slows) { const d = ahead(z.i0); if (d > 10 && d < 120) { flag('slow', 'PURPLE HAZE = STORM CELL · IT CUTS YOUR SPEED UNTIL YOU ARE THROUGH'); break; } }
      if (this.noteT > 0) tip = this.note; if (P.downT > 0) tip = `DEREZZED — RE-FORMING IN ${Math.ceil(P.downT)}`;
      if (sim.lightwalls) {
        // the light wall only matters with someone on your tail, so that is when it is offered
        let tail = false; for (const r of sim.racers) { if (r.isPlayer || r.out || r.downT > 0) continue; const back = (P.progress - r.progress) * T.step; if (back > 3 && back < 26 && Math.abs(r.d - P.d) < 6) { tail = true; break; } }
        if (P.wallT > 0) tip = 'LIGHT WALL ON — IT TRAILS BEHIND YOU'; else if (tail && P.wallCd <= 0 && (this.tier.id <= 12 || !this.walled)) tip = `RIVAL ON YOUR TAIL — PRESS ${key} TO DROP YOUR LIGHT WALL`;
        else if (!this.walled && !tip && sim.time > 5 && sim.time < 16) tip = `LIGHT WALL (${key}): LAYS A WALL BEHIND YOU FOR 2 SECONDS · A RIVAL THAT HITS IT IS DEREZZED`;
      }
      hud.coach(tip);
    }
    cam.getWorldPosition(this.v); cam.getWorldDirection(this.v2); audio.listener(this.v.x, this.v.y, this.v.z, this.v2.x, this.v2.y, this.v2.z);
    if (this.phase === 'play' || this.phase === 'countdown') audio.engineSet(this.phase === 'play' ? sp01 * 1.1 + 0.05 : 0.1, P.boosting, sp01);
    if (this.phase === 'play') audio.intensity = damp(audio.intensity, clamp(0.6 + sp01 * 0.25 + (P.lap >= sim.totalLaps() - 1 ? 0.15 : 0), 0, 1), 2, dt);
    const laps = sim.totalLaps(), solo = this.format === 'timetrial' || this.format === 'gauntlet', active = sim.racers.filter((r) => !r.out).length;
    const tgt = sim.racers[0]; const data: Record<string, any> = { tier: this.tier, speed: P.speed, boost: P.boost, boosting: P.boosting, drift: P.drifting, draft: P.draft, pulse: sim.lightwalls ? P.wallCd : P.pulseCd, abilityName: sim.lightwalls ? 'LIGHT WALL' : 'PULSE', abilityKey: ctl(dev, 'E', 'B', xr.labels.ability), wallOn: sim.lightwalls ? P.wallT : 0, wallLay: WALL_LAY, wallMax: sim.lightwalls ? WALL_COOLDOWN : 0, takedowns: this.kills, place: P.place, field: active, active, solo, time: sim.time, best: sim.stats.bestLap, par: this.format === 'timetrial' ? sim.parTime : 0, score: 0, format: FORMAT_LABEL[this.format], storm: this.storm,
      lapLabel: T.closed ? `LAP ${clamp(P.lap + 1, 1, laps)}/${laps}` : `${Math.round((P.idx / T.n) * 100)}%`, radar: { kind: 'track', pts: this.radarPts, closed: T.closed, extent: this.ext.r, cx: this.ext.cx, cz: this.ext.cz, hazards: sim.hazards, walls: sim.walls.length ? sim.walls.filter((_, i) => i % 2 === 0).map((w) => ({ x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1, color: css(this.colors[w.owner - 1]) })) : null, racers: sim.racers.map((r, i) => ({ x: r.x, z: r.z, h: r.h, color: css(this.colors[i]), player: r.isPlayer, out: r.out || r.downT > 0 })) } };
    if (this.format === 'gauntlet') data.integrity = P.integrity; if (this.format === 'elimination' && this.phase === 'play') data.elim = sim.elimT; if (this.format === 'pursuit' && !tgt.out) data.gap = Math.max(0, Math.round((tgt.progress - P.progress) * T.step));
    hud.update(data);
  }
  dispose() { const { audio, engine } = this.ctx; if (this.seatDirty) this.ctx.store.save(); engine.fadeTo(0); this.ctx.xr.showHands = true; this.ctx.hud.vrSeat = null; audio.engine(false); audio.hums([]); engine.vignetteAmount = 0; engine.camera.fov = 62; engine.camera.updateProjectionMatrix(); this.world.remove(this.ctx.vfx.group); }
}
