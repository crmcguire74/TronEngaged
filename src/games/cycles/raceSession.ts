import * as THREE from 'three';
import { BaseSession, ctl, fmtTime, type Ctx, type SessionResult } from '../../app/context';
import type { Actions } from '../../input/input';
import type { SimEvent } from '../../engine/events';
import { CITY_PANO, tuneEmissive } from '../../engine/assets';
import { TONE, edgeBlock, gridFloor, hardlight, lights, skyDome, suppliedSky, skyline, theme, type Theme } from '../../engine/env';
import { Ribbon } from '../../engine/vfx';
import { Ambient } from '../../engine/ambient';
import { Carrier, Drones, Patrol } from '../../engine/patrol';
import { angleLerp, clamp, damp, lerp, smooth, wrapAngle } from '../../engine/math';
import { buildRaceConfig, raceRivalModels } from '../../progression/build';
import { raceFinalScore } from '../../progression/scoring';
import { DIFFICULTIES, type DifficultyId, type TierDefinition } from '../../progression/types';
import { INTERCEPTOR_ID, RaceSim, WALL_COOLDOWN, WALL_LAY, type RaceIntent } from './race';
import { inFeature, wrapIdx, type Track } from './track';
import { buildScenery } from './scenery';
import { CYCLE_INTRO, introCamera, StartSequence, CYCLE_COLORS, CycleView, EYE, SpeedLines, css, cycleAssets, playerTrail } from './view';

const GATE = 0xffc23a;
/** Barriers the interceptor drops belong to no rider, so they get their own warning colour. */
const JET_WALL = 0xff9a2e;
const FORMAT_LABEL: Record<string, string> = { circuit: 'CIRCUIT', sprint: 'SPRINT', elimination: 'ELIMINATION', timetrial: 'TIME TRIAL', pursuit: 'PURSUIT', gauntlet: 'GAUNTLET' };

function ribbonGeo(t: Track, d0: number, d1: number, y0: number, y1: number, i0 = 0, i1 = t.n) {
  const n = i1 - i0 + (t.closed && i1 === t.n ? 1 : 0), pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx: number[] = [];
  // the surface carries the corner's cross-slope, so the road the rider sees is the one the rider is standing on
  for (let k = 0; k < n; k++) { const i = wrapIdx(t, i0 + k), nx = -t.tz[i], nz = t.tx[i], b = t.bank[i], o = k * 6; pos[o] = t.x[i] + nx * d0; pos[o + 1] = t.y[i] + y0 + b * d0; pos[o + 2] = t.z[i] + nz * d0; pos[o + 3] = t.x[i] + nx * d1; pos[o + 4] = t.y[i] + y1 + b * d1; pos[o + 5] = t.z[i] + nz * d1; uv[k * 4] = 0; uv[k * 4 + 1] = (i0 + k) * t.step; uv[k * 4 + 2] = 1; uv[k * 4 + 3] = (i0 + k) * t.step; if (k < n - 1) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

/** Cycle Racing: fluid steering on spline circuits. Presentation over the shared RaceSim. */
let signTex: THREE.CanvasTexture | null = null;
/** A red warning triangle that floats over each hazard, so it reads as "avoid" from a distance. */
/** Recolours a supplied model's emissive detail to one accent, leaving its base metal alone. */
function accentTintJet(root: THREE.Object3D, color: number) {
  const c = new THREE.Color(color);
  root.traverse((o: any) => {
    if (!o.isMesh) return; o.castShadow = false; o.frustumCulled = false;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      if (m.emissive && m.emissive.getHex() !== 0) { m.emissive.copy(c); m.emissiveIntensity = 1.4; }
      else if (m.color) { m.color.multiplyScalar(0.3); if ('metalness' in m) { m.metalness = 0.9; m.roughness = 0.3; } }
    }
  });
}

function warnSign(): THREE.CanvasTexture {
  if (signTex) return signTex; const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
  x.lineJoin = 'round'; x.beginPath(); x.moveTo(64, 12); x.lineTo(118, 108); x.lineTo(10, 108); x.closePath(); x.fillStyle = '#1a0503'; x.fill(); x.lineWidth = 10; x.strokeStyle = '#ff3a1c'; x.stroke();
  x.fillStyle = '#ff3a1c'; x.fillRect(58, 42, 12, 36); x.fillRect(58, 86, 12, 12); return (signTex = new THREE.CanvasTexture(c));
}

export class RaceSession extends BaseSession {
  readonly mode = 'cycle-race' as const; sim: RaceSim; private th: Theme; private intent: RaceIntent = { steer: 0, accel: 0, brake: 0, boost: false, ability: false };
  private cv: CycleView[] = []; private tails: Ribbon[] = []; private colors: number[] = []; private hz: THREE.Object3D[] = []; private timed: THREE.ShaderMaterial[] = []; private lines: SpeedLines; private fog: THREE.FogExp2;
  private patrol!: Patrol; private drones!: Drones; private carrier!: Carrier; private look = new THREE.Vector3(); private downCam = 0; private camYaw = 0; private camPos = new THREE.Vector3(); private v = new THREE.Vector3(); private v2 = new THREE.Vector3(); private cockpit: boolean; private offset = new THREE.Vector3(); private recentred = false; private radarPts: number[] = []; private ext = { cx: 0, cz: 0, r: 1 }; private storm = false; private padT = 0; private format: string; private yawPrev = 0; private vrFirst: boolean; private vrYaw = 0; private start!: StartSequence; private wallMesh: THREE.InstancedMesh | null = null; private m4 = new THREE.Matrix4(); private q4 = new THREE.Quaternion(); private s4 = new THREE.Vector3(); private col4 = new THREE.Color(); private walled = false; private surgeT = 0; private boostPrev = false; private seatDirty = false; private early: boolean; private moved = false; private kills = 0; private seen = { hazard: 0, pad: 0, slow: 0, gate: 0 }; private gv: { g: THREE.Group; spin: THREE.Group; fill: THREE.MeshBasicMaterial }[] = []; private jet: THREE.Object3D | null = null; private jetTrail: Ribbon | null = null; private inTunnel = false; private noteT = 0; private note = ''; /** per-rider damped nose attitude, so rolling ground never judders the frame */ private pitchS: number[] = [];

  static assets(tier: TierDefinition, cycle: string): string[] { return [...cycleAssets([cycle, ...raceRivalModels(tier, cycle), 'azure'], 'azure'), ...(['metropolis', 'neon-circuit'].includes(tier.environment) ? ['city'] : []), ...(tier.modifiers.includes('interceptor') ? ['jet'] : []), 'craft', 'drone', tier.environment === 'outlands' ? 'hauler' : 'recognizer']; }

  constructor(ctx: Ctx, tier: TierDefinition, diff: DifficultyId, salt = 0, stage = 0) {
    super(ctx, tier, diff);
    const cfg = buildRaceConfig(tier, diff, ctx.settings.cycle, stage, tier.endless ? salt : 0), sim = (this.sim = new RaceSim(cfg)), t = cfg.track, th = (this.th = theme(tier.environment)), W = this.world, eng = ctx.engine, hw = t.width / 2;
    this.introDur = CYCLE_INTRO; this.format = cfg.format; this.cockpit = ctx.settings.cycleCamera === 'cockpit'; this.vrFirst = ctx.settings.vr.cycleView !== 'chase'; this.early = !tier.endless && tier.id <= 4;
    this.fog = new THREE.FogExp2(th.fog, th.fogDensity); eng.scene.fog = this.fog;
    const sky = suppliedSky(th, ctx.assets, tier.environment) ?? skyDome(th, ctx.assets.texture(CITY_PANO.wire), 1500, { lo: -30, hi: 46, gain: ctx.xr.presenting ? 0.5 : 0.6, mix: 0.9, tint: 0.7 }); W.add(sky); this.timed.push(sky.material as THREE.ShaderMaterial); lights(W, th, false);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9; for (let i = 0; i < t.n; i++) { minX = Math.min(minX, t.x[i]); maxX = Math.max(maxX, t.x[i]); minZ = Math.min(minZ, t.z[i]); maxZ = Math.max(maxZ, t.z[i]); minY = Math.min(minY, t.y[i]); if (i % 3 === 0) this.radarPts.push(t.x[i], t.z[i]); }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, R = Math.max(maxX - minX, maxZ - minZ) / 2; this.ext = { cx, cz, r: R + 10 }; const groundY = minY - 26;
    // patrol skimmers circle the circuit, sweeping it with searchlights
    this.patrol = new Patrol(ctx.assets, { cx, cz, radius: R * 0.75, height: minY + 72, floorY: minY, count: ctx.settings.quality === 'low' ? 2 : 3, color: th.accent }); W.add(this.patrol.group);
    // a camera drone paces the player, and a heavy carrier crosses the sky beyond the circuit
    this.drones = new Drones(ctx.assets, ctx.settings.quality === 'low' ? 1 : 2, th.accent); W.add(this.drones.group);
    this.carrier = new Carrier(ctx.assets, th.accent, { cx, cz, offset: R + 160, alt: minY + (tier.environment === 'outlands' ? 140 : 78), heading: 0.7, len: R * 2 + 1500, key: tier.environment === 'outlands' ? 'hauler' : 'recognizer', speed: tier.environment === 'outlands' ? 7 : 9 }); W.add(this.carrier.group);
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
          // energy runs down the road edges ahead of the riders: bright pulses every 70 m, travelling at speed
          float run = smoothstep(0.86, 1.0, fract(v / 70.0 - uTime * 1.15)) + 0.6 * smoothstep(0.93, 1.0, fract(v / 23.0 - uTime * 2.3));
          vec3 col = vec3(0.012, 0.016, 0.026) + uLine * (edge * (1.6 + run * 1.6) + lane * (0.3 + run * 0.5) * fade + bar * 0.06 * fade) + vec3(0.85) * dash * 0.5 * fade + vec3(1.0) * start * 0.7;
          vec3 vd = normalize(cameraPosition - vW); col += uLine * pow(1.0 - max(vd.y, 0.0), 6.0) * 0.08;
          gl_FragColor = vec4(col, 1.0); ${TONE} }` });
    W.add(new THREE.Mesh(ribbonGeo(t, -hw, hw, 0, 0), road)); this.timed.push(road);
    const under = new THREE.Mesh(ribbonGeo(t, -hw - 0.6, hw + 0.6, -0.35, -0.35), new THREE.MeshStandardMaterial({ color: 0x06080d, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide })); W.add(under);
    const railTop = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent).multiplyScalar(1.15), side: THREE.DoubleSide });
    for (const s of [-1, 1]) { const m = hardlight(th.accent, 0.1, 0.5, 0.05); this.timed.push(m); const rail = new THREE.Mesh(ribbonGeo(t, s * hw, s * hw, 0, 0.8), m); W.add(rail, new THREE.Mesh(ribbonGeo(t, s * hw - 0.05, s * hw + 0.05, 0.8, 0.8), railTop)); }
    // trackside world: tunnels, bridge spans, city canyons, light posts and supports, all driven by the track's own
    // feature list so every circuit is laid out differently (see track.ts placeFeatures)
    const scen = buildScenery(t, th, { groundY, seed: cfg.seed, quality: ctx.settings.quality });
    W.add(scen.group); this.timed.push(...scen.timed);
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
    this.ambient = new Ambient(th, { cx, cz, groundY, rMin: R + 40, rMax: R + 240, hMin: 40, hMax: 150, seed: tier.id * 31 + stage, xr: ctx.xr.presenting, quality: ctx.settings.quality }); W.add(this.ambient.group);
    sim.racers.forEach((r) => { const col = r.isPlayer ? playerTrail(ctx) : CYCLE_COLORS[r.model] ?? 0xff5a36; this.colors.push(col); const v = new CycleView(ctx, r.model, col, r.isPlayer ? 'char:' + ctx.settings.skin : undefined); v.reveal.value = r.y - 1; v.parked = true; W.add(v.root); this.cv.push(v); const tail = new Ribbon(col, 16, 0.22); (tail.mesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.45; tail.reset(r.x, r.y + 0.5, r.z); W.add(tail.mesh); this.tails.push(tail); });
    // air interceptor: the supplied light jet, scaled and turned nose-forward, with a short exhaust ribbon
    if (sim.jet && ctx.assets.has('jet')) {
      const inst = ctx.assets.instance('jet', { cloneMaterials: true }), g = new THREE.Group();
      // the model is 22 m down its own +Y with the nose at -Y: lay it flat and shrink it to about eight metres
      inst.root.rotation.set(Math.PI / 2, 0, 0); inst.root.scale.setScalar(0.36); inst.root.position.set(-1.2, 0, 0);
      tuneEmissive(inst.root, 1.6); accentTintJet(inst.root, JET_WALL);
      g.add(inst.root); W.add(g); this.jet = g;
      this.jetTrail = new Ribbon(JET_WALL, 26, 0.5); W.add(this.jetTrail.mesh);
    }
    this.lines = new SpeedLines(th.accent); W.add(this.lines.mesh);
    W.add(ctx.vfx.group); ctx.vfx.clear(); eng.setWorld(W); eng.scene.fog = this.fog;
    ctx.hud.show('race'); ctx.audio.playMusic('race'); ctx.audio.ambience(tier.environment); ctx.audio.intensity = 0.3; ctx.audio.setCrowdBed(0);
    const stages = Number(tier.params.stages ?? 1);
    ctx.hud.banner(`TIER ${tier.endless ? '∞' : String(tier.id).padStart(2, '0')} — ${tier.name.toUpperCase()}${stages > 1 ? ` · STAGE ${stage + 1}/${stages}` : ''}`, `${FORMAT_LABEL[cfg.format]} — ${this.goal()}`, this.introDur * 1000 - 400);
    ctx.xr.discGesture = sim.discsOn; this.cv[sim.racers.indexOf(sim.player)].prepareCockpit(); this.camYaw = this.yawPrev = sim.player.h; this.view(0, 1, ctx.input.actions); this.start = new StartSequence(ctx, this.cv, this.colors, sim.racers.indexOf(sim.player));
  }
  private goal() { const c = this.sim.cfg; return c.format === 'timetrial' ? `beat ${fmtTime(this.sim.parTime)}` : c.format === 'pursuit' ? 'catch the runner before it finishes' : c.format === 'gauntlet' ? 'finish with integrity remaining' : c.format === 'elimination' ? 'last place is cut at intervals — survive' : `finish in the top ${c.passPlace}`; }

  protected intro(k: number, dt: number) {
    const P = this.sim.player, cam = this.ctx.engine.camera, vfx = this.ctx.vfx;
    // machines are hidden by the ignition build until their rider lands, so the floor reveal is not used here
    for (const v of this.cv) v.reveal.value = 1e4; void k;
    this.start.update(this.t, dt, this.xr ? (this.ctx.xr.actions.accel ?? 0) : 0);
    if (this.xr) return;
    introCamera(cam, this.t, P.x, P.y, P.z, P.h, this.cockpit); this.camPos.copy(cam.position);
  }
  protected onCountdown() { this.start.finish(); for (const v of this.cv) { v.reveal.value = 1e4; v.seal(); } this.ctx.audio.engine(true); this.ctx.audio.sfx('spawn'); }
  protected onStart() { this.ctx.audio.intensity = 0.8; for (const v of this.cv) v.launch(); this.ctx.audio.sfx('boost'); }

  protected step(dt: number, a: Actions, first: boolean) {
    const it = this.intent, P = this.sim.player; it.steer = a.steer; it.accel = a.accel; it.brake = a.brake; it.ability = first && a.ability; it.disc = first && a.disc;
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
      case 'hazardHit': vfx.shatter(e.x, e.y, e.z, 0xff3b4e, 40, 1.2); audio.sfx('hit', mine ? undefined : e); if (mine) { hud.flash('hurt'); engine.hurt(0.85, e); audio.sfx('grunt'); engine.addShake(0.8); xr.pulse('both', 1, 200); input.rumble(1, 1, 250); hud.toast('IMPACT', 'danger'); } break;
      case 'bump': {
        // contact scales with how hard the two met: a brush throws a few sparks, a proper hit shakes the frame
        const f = Math.min(1, (e.force ?? 2) / 12);
        vfx.sparks(e.x, e.y + 0.6, e.z, e.hard ? 0xffd9a0 : 0xffffff, 8 + Math.round(f * 40), 6 + f * 9, 0.3 + f * 0.3);
        audio.sfx(e.hard ? 'crash' : 'block', e); engine.addShake(0.12 + f * 0.65); input.rumble(0.4 + f * 0.6, 0.4 + f * 0.6, 80 + f * 140);
        if (e.hard) { xr.pulse('both', 0.9, 150); hud.flash('hurt'); }
        break;
      }
      case 'slam': vfx.sparks(e.x, e.y + 0.5, e.z, 0xffd9a0, 70, 14, 0.6); vfx.ring(e.x, e.y + 0.2, e.z, 0xffb62e, 0.4, 6, 0.4); audio.sfx('crash'); audio.sfx('railSlam'); audio.sfx('grunt'); engine.hurt(1, e); audio.say('Rail impact.'); hud.flash('hurt'); hud.toast('SLAMMED INTO THE RAIL', 'danger'); engine.addShake(1.1); xr.pulse('both', 1, 300); input.rumble(1, 1, 320); break;
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
        if (mine) { engine.hurt(1); audio.sfx('grunt'); this.downCam = 0; hud.banner('DEREZZED', 'You rode into a light wall — re-forming', 1500); audio.say('Derezzed.'); engine.addShake(1); engine.derez = 0.45; xr.pulse('both', 1, 400); input.rumble(1, 1, 450); }
        else if (e.cause === 'wall' && e.by !== this.sim.player.id && this.sim.racers[e.id - 1].progress > this.sim.player.progress - 3) hud.toast('RIVAL DEREZZED', 'info'); audio.sfx('shatter', e); audio.sfx('explosion', e);
        // a takedown mid-race never takes the camera: the player is still steering at speed. It gets a short, light
        // slow-down (control stays usable) on top of the banner, sound and rumble below.
        if (mineKill) this.slowmo(0.55, 0.6);
        if (mineKill) { this.kills++; hud.banner('TAKEDOWN', e.cause === 'wall' ? 'A rival derezzed on your light wall' : 'A rival was thrown off the road', 1700); hud.toast('TAKEDOWN  +220', 'score'); audio.say('Trap confirmed.'); audio.cheer(1.2); xr.pulse('both', 0.9, 160); input.rumble(0.8, 0.8, 200); engine.addShake(0.4); }
        break;
      }
      case 'reform': { if (mine) { hud.toast('RE-FORMED — GO', 'good'); audio.sfx('go'); } const v = this.cv[e.id - 1]; v.root.visible = true; this.tails[e.id - 1].mesh.visible = true; this.tails[e.id - 1].reset(e.x, e.y + 0.5, e.z); vfx.motes(e.x, e.y, e.z, col, 1.4, 1.6, 40); vfx.ring(e.x, e.y + 0.1, e.z, col, 0.4, 5, 0.5); audio.sfx('spawn', e); break; }
      case 'caught': vfx.shatter(e.x, e.y, e.z, col, 120, 1.3); audio.sfx('shatter'); this.cv[e.id - 1].root.visible = false; break;
      case 'shunt': {
        const f = Math.min(1, (e.force ?? 6) / 16);
        vfx.sparks(e.x, e.y + 0.6, e.z, 0xffffff, 34 + Math.round(f * 50), 11 + f * 10, 0.5 + f * 0.3);
        vfx.ring(e.x, e.y + 0.3, e.z, 0xffffff, 0.35, 4 + f * 3, 0.35);
        audio.sfx('crash', e.player ? undefined : e);
        // a shove the player lands is felt: a hit-stop, metal on metal, sparks thrown off the side and a kick through the bars
        if (e.by === this.sim.player.id) { this.slowmo(f > 0.6 ? 0.4 : 0.22, f > 0.6 ? 0.3 : 0.45); vfx.sparks(e.x, e.y + 0.7, e.z, 0xffd9a0, 60, 14, 0.5); vfx.ring(e.x, e.y + 0.6, e.z, 0xffb62e, 0.3, 6, 0.3); audio.sfx('railSlam', e); hud.toast(f > 0.6 ? 'BIG HIT' : 'SHUNT', 'good'); if (f > 0.6) audio.say('Rider shunted.'); xr.pulse('both', 0.8, 120); engine.addShake(0.35 + f * 0.4); input.rumble(0.8, 0.8, 160); }
        else if (e.player) { hud.toast('RAMMED', 'danger'); hud.flash('hurt'); engine.hurt(0.9, e); audio.sfx('grunt'); engine.addShake(0.6 + f * 0.6); xr.pulse('both', 1, 200); input.rumble(1, 1, 260); }
        break;
      }
      case 'wall': audio.sfx('boost', mine ? undefined : this.pos(e.id)); if (mine) { this.walled = true; hud.toast('LIGHT WALL ON', 'good'); xr.pulse('both', 0.5, 80); } else { const r = this.sim.racers[e.id - 1], P = this.sim.player; if (r.progress > P.progress && (r.progress - P.progress) * this.sim.track.step < 60) hud.toast('LIGHT WALL AHEAD — STEER ROUND IT', 'warn'); } break;
      case 'wallHit': audio.sfx('crash'); hud.flash('hurt'); hud.toast('DEREZZED ON A LIGHT WALL', 'danger'); break;
      case 'pulse': vfx.ring(e.x, e.y + 0.4, e.z, col, 0.5, 13, 0.5); audio.sfx('power', mine ? undefined : e); if (!mine && this.sim.player.stun > 0) hud.toast('PULSED', 'danger'); break;
      case 'integrity': hud.toast(`INTEGRITY ${e.left}`, 'danger'); break;
      case 'discThrow': audio.sfx('throw', mine ? undefined : e); if (e.atPlayer) { hud.toast('DISC INCOMING — STEER OUT OF ITS LANE', 'danger'); hud.flash('warn'); audio.sfx('tellHoming'); xr.pulse('both', 0.4, 60); } break;
      case 'discHit': {
        vfx.shatter(e.x, e.y, e.z, e.player ? 0xff2a14 : this.colors[e.id - 1], 40, 1, undefined, 6); vfx.ring(e.x, e.y, e.z, 0xffffff, 0.3, 4, 0.35); audio.sfx('hit', e.player ? undefined : e);
        if (e.player) { hud.toast('DISC HIT — STALLED', 'danger'); hud.flash('hurt'); engine.hurt(0.9, e); audio.sfx('grunt'); engine.addShake(0.6); xr.pulse('both', 1, 220); input.rumble(1, 0.8, 240); }
        else if (e.by === this.sim.player.id) { hud.toast('DISC HIT — RIVAL STALLED', 'score'); audio.cheer(0.7); this.slowmo(0.35, 0.7); xr.pulse('both', 0.6, 100); }
        break;
      }
      case 'discSpent': vfx.sparks(e.x, e.y, e.z, 0xffffff, 10, 4, 0.3); break;
      case 'interceptorDrop': {
        // the drop is always survivable, so the coaching says which way to go rather than just warning
        vfx.ring(e.x, e.y + 0.3, e.z, JET_WALL, 0.5, 7, 0.45); audio.sfx('interfere'); audio.sfx('barrierDrop', e); audio.sfx('interceptorPass', e);
        const d = (e.idx - this.sim.player.idx + this.sim.track.n) % this.sim.track.n * this.sim.track.step;
        if (d < 190) { hud.toast(`INTERCEPTOR BARRIER — GO ${e.side < 0 ? 'RIGHT' : 'LEFT'}`, 'danger'); hud.flash('warn'); xr.pulse('both', 0.6, 110); audio.say('Barrier ahead.'); }
        break;
      }
    }
  }
  private pos(id: number) { const r = this.sim.racers[id - 1]; return { x: r.x, y: r.y + 0.8, z: r.z }; }

  protected view(dt: number, alpha: number, a: Actions) {
    const { engine, hud, audio, vfx, xr } = this.ctx, sim = this.sim, P = sim.player, T = sim.track, t = engine.elapsed, cam = engine.camera;
    for (const m of this.timed) m.uniforms.uTime.value = t; this.patrol.update(dt); this.ambient.update(t, this.phase === 'play' ? clamp(this.sim.player.speed / this.sim.player.veh.top, 0, 1) : 0.2); vfx.update(dt); this.padT -= dt; this.sim.gates.forEach((gt, k) => { const v = this.gv[k]; if (!v) return; v.spin.rotation.z = t * 1.4 + k; const f = gt.flash / 0.6; v.fill.opacity = 0.06 + 0.03 * Math.sin(t * 4 + k) + 0.45 * f; v.g.scale.setScalar(1 + 0.15 * f); });
    if (a.camera && !this.xr && this.phase !== 'intro') { this.cockpit = !this.cockpit; this.ctx.settings.cycleCamera = this.cockpit ? 'cockpit' : 'chase'; }
    this.fog.density = damp(this.fog.density, this.th.fogDensity * (this.storm ? 7 : 1), 3, dt);
    const hums: { x: number; y: number; z: number; pitch: number; gain: number }[] = [];
    sim.racers.forEach((r, i) => {
      const v = this.cv[i]; if (r.out || r.downT > 0) { v.root.visible = false; this.tails[i].mesh.visible = false; return; }
      const x = lerp(r.px, r.x, alpha), y = lerp(r.py, r.y, alpha), z = lerp(r.pz, r.z, alpha), yaw = r.ph + wrapAngle(r.h - r.ph) * alpha;
      // Nose attitude is read over a 40 m baseline and then damped. A short baseline over rolling ground made the
      // machine — and in cockpit view the whole frame — judder on every elevation sample it crossed.
      const span = Math.max(4, Math.round(20 / T.step)), ja = wrapIdx(T, r.idx - span), jb = wrapIdx(T, r.idx + span);
      const wantPitch = -Math.atan2(T.y[jb] - T.y[ja], 2 * span * T.step);
      this.pitchS[i] = damp(this.pitchS[i] ?? wantPitch, wantPitch, 5, dt);
      // the machine also rolls with the corner's cross-slope, so a banked turn is ridden, not skated across
      const roll = Math.atan(T.bank[r.idx]);
      v.lean = damp(v.lean, clamp(r.steer * 0.42 * clamp(r.speed / 30, 0, 1) + r.slip * 0.5 - roll, -0.85, 0.85), 9, dt);
      v.pose(x, y, z, yaw, dt, r.speed / r.veh.top, false, this.pitchS[i]);
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
    const live = this.phase === 'play'; me.drive(live ? this.intent.steer : 0, live ? this.intent.accel : 0, live ? this.intent.brake : 0, sp01, P.boosting, dt, P.speed * 3.6);
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
      hud.vrSeat = this.offset; xr.showHands = !first || !!this.start?.handsFree;
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
      for (let i = 0; i < n; i++) { const w = sim.walls[i], dx = w.x1 - w.x0, dz = w.z1 - w.z0, len = Math.hypot(dx, dz), life = w.until - sim.time; this.s4.set(0.14, 1.5 * clamp(life / 0.6, 0, 1), len + 0.05); this.q4.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(dx, dz)); this.v.set((w.x0 + w.x1) / 2, w.y, (w.z0 + w.z1) / 2); wm.setMatrixAt(i, this.m4.compose(this.v, this.q4, this.s4)); wm.setColorAt(i, this.col4.setHex(w.owner === INTERCEPTOR_ID ? JET_WALL : this.colors[w.owner - 1] ?? JET_WALL).multiplyScalar(1.3)); }
      wm.count = n; wm.instanceMatrix.needsUpdate = true; if (wm.instanceColor) wm.instanceColor.needsUpdate = true;
    }
    // entering and leaving a bore gets its own cue, so the change in acoustics is heard as well as seen
    const inBore = inFeature(T, P.idx, 'tunnel');
    if (inBore !== this.inTunnel) { this.inTunnel = inBore; audio.sfx(inBore ? 'tunnelEnter' : 'tunnelExit'); }
    if (this.jet && sim.jet) {
      const j = sim.jet, T2 = sim.track, i = j.idx, head = Math.atan2(T2.tx[i], T2.tz[i]);
      this.jet.position.set(j.x, j.y, j.z); this.jet.rotation.y = head; this.jet.rotation.z = Math.sin(t * 1.1) * 0.22 - (j.runT > 0 ? 0.35 : 0);
      this.jetTrail?.push(j.x - Math.sin(head) * 3, j.y - 0.4, j.z - Math.cos(head) * 3);
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
      if (sim.discsOn && !tip && sim.time > 3 && this.discTip < 2) { const key = ctl(dev, 'Q', 'Y', 'REACH OVER YOUR SHOULDER, SQUEEZE, SWING AND LET GO'); tip = `DISCS LIVE: ${key} — HURL A DISC AT THE RIDER AHEAD · THEIRS STALL YOU, SO STEER OUT OF THEIR LANE`; if (sim.time > 14) this.discTip = 2; }
      hud.coach(tip);
    }
    cam.getWorldPosition(this.v); cam.getWorldDirection(this.v2); audio.listener(this.v.x, this.v.y, this.v.z, this.v2.x, this.v2.y, this.v2.z);
    if (this.phase === 'play' || this.phase === 'countdown') audio.engineSet(this.phase === 'play' ? sp01 * 1.1 + 0.05 : 0.1, P.boosting, sp01);
    if (this.phase === 'play') audio.intensity = damp(audio.intensity, clamp(0.6 + sp01 * 0.25 + (P.lap >= sim.totalLaps() - 1 ? 0.15 : 0), 0, 1), 2, dt);
    const laps = sim.totalLaps(), solo = this.format === 'timetrial' || this.format === 'gauntlet', active = sim.racers.filter((r) => !r.out).length;
    const tgt = sim.racers[0]; const data: Record<string, any> = { tier: this.tier, speed: P.speed, boost: P.boost, boosting: P.boosting, drift: P.drifting, draft: P.draft, pulse: sim.lightwalls ? P.wallCd : P.pulseCd, abilityName: sim.lightwalls ? 'LIGHT WALL' : 'PULSE', abilityKey: ctl(dev, 'E', 'B', xr.labels.ability), wallOn: sim.lightwalls ? P.wallT : 0, wallLay: WALL_LAY, wallMax: sim.lightwalls ? WALL_COOLDOWN : 0, takedowns: this.kills, place: P.place, field: active, active, solo, time: sim.time, best: sim.stats.bestLap, par: this.format === 'timetrial' ? sim.parTime : 0, score: 0, format: FORMAT_LABEL[this.format], storm: this.storm,
      lapLabel: T.closed ? `LAP ${clamp(P.lap + 1, 1, laps)}/${laps}` : `${Math.round((P.idx / T.n) * 100)}%`, radar: this.radarFn ??= () => { const sim = this.sim, T = sim.track; return { kind: 'track', pts: this.radarPts, closed: T.closed, extent: this.ext.r, cx: this.ext.cx, cz: this.ext.cz, hazards: sim.hazards, discs: sim.discsOn ? sim.flying.map((d) => ({ x: d.x, z: d.z, mine: d.owner === sim.player.id, atMe: d.target === sim.player.id })) : null, walls: sim.walls.length ? sim.walls.filter((_, i) => i % 2 === 0).map((w) => ({ x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1, color: css(this.colors[w.owner - 1]) })) : null, racers: sim.racers.map((r, i) => ({ x: r.x, z: r.z, h: r.h, color: css(this.colors[i]), player: r.isPlayer, out: r.out || r.downT > 0 })) }; } };
    if (this.format === 'gauntlet') data.integrity = P.integrity; if (this.format === 'elimination' && this.phase === 'play') data.elim = sim.elimT; if (this.format === 'pursuit' && !tgt.out) data.gap = Math.max(0, Math.round((tgt.progress - P.progress) * T.step));
    hud.update(data); this.viewDiscs(dt, t); this.applyKillCam(dt);
  }
  private radarFn: (() => any) | null = null; private ambient!: Ambient;
  // ---------------------------------------------------------------- race discs (view)
  private discPool: { g: THREE.Group; rim: THREE.MeshBasicMaterial; id: number }[] = []; private handDisc: THREE.Group | null = null; private discReadyShown = true; private discTip = 0; private lockT = 0;
  /** A thrown disc: a dark core in a lit rim, in the thrower's colour (rivals' always red, so a threat reads at once). */
  private makeDisc(color: number) {
    const g = new THREE.Group(), rim = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6) });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 24), new THREE.MeshBasicMaterial({ color: 0x05070a })), ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 8, 32), rim); ring.rotation.x = Math.PI / 2; g.add(core, ring);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); glow.rotation.x = -Math.PI / 2; g.add(glow);
    g.scale.setScalar(1.25); return { g, rim };
  }
  private viewDiscs(dt: number, t: number) {
    const sim = this.sim; if (!sim.discsOn) return;
    for (const d of sim.flying) {
      let v = this.discPool.find((p) => p.id === d.id);
      if (!v) { v = this.discPool.find((p) => p.id === 0) ?? (() => { const m = this.makeDisc(0xffffff); this.world.add(m.g); const e = { ...m, id: 0 }; this.discPool.push(e); return e; })(); v.id = d.id; v.rim.color.setHex(d.owner === sim.player.id ? this.colors[d.owner - 1] : 0xff2a14).multiplyScalar(1.6); }
      v.g.visible = true; v.g.position.set(d.x, d.y, d.z); v.g.rotation.set(0.18 * Math.sin(t * 3 + d.id), t * 22, 0);
      if (Math.random() < 0.5) this.ctx.vfx.sparks(d.x, d.y, d.z, d.owner === sim.player.id ? this.colors[d.owner - 1] : 0xff2a14, 1, 2, 0.25, undefined, 0, 0.35);
    }
    for (const v of this.discPool) if (v.id && !sim.flying.some((d) => d.id === v.id)) { v.id = 0; v.g.visible = false; }
    // in a headset the disc is in the hand from the moment it is taken off the back until it is thrown
    const xr = this.ctx.xr; if (this.xr && xr.discHeld) { if (!this.handDisc) { this.handDisc = this.makeDisc(this.colors[sim.racers.indexOf(sim.player)]).g; this.handDisc.scale.setScalar(0.85); } const anchor = xr.handAnchor(xr.dominant); if (this.handDisc.parent !== anchor) anchor.add(this.handDisc); this.handDisc.visible = true; this.handDisc.rotation.y += dt * 4; }
    else if (this.handDisc) this.handDisc.visible = false;
    // lock-on alarm: while a rival's disc is coming for the player it beeps, faster and higher the closer it gets
    const P = sim.player; let nearest = Infinity; for (const d of sim.flying) if (d.target === P.id) nearest = Math.min(nearest, (P.progress - d.p) * sim.track.step);
    if (nearest < Infinity && nearest > -2) { this.lockT -= dt; if (this.lockT <= 0) { this.lockT = clamp(nearest / 120, 0.08, 0.4); this.ctx.audio.sfx('prox'); } this.ctx.hud.coach(`⚠ DISC LOCKED ON — ${Math.max(0, Math.round(nearest))} m BEHIND — STEER OUT OF ITS LANE`); } else this.lockT = 0;
    if (P.discCd <= 0 && !this.discReadyShown && this.phase === 'play') { this.discReadyShown = true; this.ctx.hud.toast('DISC READY', 'good'); } if (P.discCd > 0) this.discReadyShown = false;
  }
  dispose() { this.ctx.xr.discGesture = false; this.handDisc?.removeFromParent(); const { audio, engine } = this.ctx; if (this.seatDirty) this.ctx.store.save(); engine.fadeTo(0); this.ctx.xr.showHands = true; this.ctx.hud.vrSeat = null; audio.engine(false); audio.hums([]); engine.vignetteAmount = 0; engine.camera.fov = 62; engine.camera.updateProjectionMatrix(); this.world.remove(this.ctx.vfx.group); }
}
