import * as THREE from 'three';
import { BaseSession, ctl, type Ctx, type SessionResult } from '../../app/context';
import type { Actions } from '../../input/input';
import type { SimEvent } from '../../engine/events';
import { Carrier, Drones, Patrol } from '../../engine/patrol';
import { TONE, Crowd, boundaryWall, edgeBlock, gridFloor, lights, skyDome, suppliedSky, theme, type Theme } from '../../engine/env';
import { CITY_PANO } from '../../engine/assets';
import { angleLerp, clamp, damp, lerp, smooth } from '../../engine/math';
import { buildCombatConfig } from '../../progression/build';
import { cycleFinalScore } from '../../progression/scoring';
import { DIFFICULTIES, type DifficultyId, type TierDefinition } from '../../progression/types';
import { CombatSim, DIRS, type Cycle, type CycleIntent } from './combat';
import { RIVAL_MODELS, StartSequence, CYCLE_COLORS, CycleView, EYE, SpeedLines, WallTrail, css, cycleAssets, playerTrail } from './view';

const yawOf = (dir: number) => Math.atan2(DIRS[dir][0], DIRS[dir][1]);
const TAUNTS = ['Too slow.', 'Flatlined.', 'Loser.', 'Boxed in.', 'Recompile and return.'];
const ION_LANE = 0xffc23a;
const POWER_COLOR: Record<string, number> = { phase: 0xb57bff, purge: 0xffffff, shock: 0xffe14a, boost: 0x4fe3ff };

/** Cycle Combat: classic 90° hardlight-wall duels. Presentation over the shared CombatSim. */
export class CombatSession extends BaseSession {
  readonly mode = 'cycle-combat' as const; sim: CombatSim; private th: Theme; private intent: CycleIntent = { turn: 0, accel: 0, boost: false, ability: false };
  private cv: CycleView[] = []; private trails: WallTrail[] = []; private colors: number[] = []; private walls: THREE.Mesh[] = []; private obs: (THREE.Object3D | null)[] = []; private pick = new Map<number, THREE.Object3D>();
  private timed: THREE.ShaderMaterial[] = []; private floor: THREE.Mesh; private crowd: Crowd | null = null; private patrol: Patrol; private drones: Drones; private carrier: Carrier; private look = new THREE.Vector3(); private yokeYaw = 0; private ionSeen = false; private yokeKick = 0; private lines: SpeedLines;
  private camYaw = Math.PI; private camPos = new THREE.Vector3(); private v = new THREE.Vector3(); private v2 = new THREE.Vector3(); private cockpit: boolean; private offset = new THREE.Vector3(); private recentred = false; private shrinking = false; private deadT = 0; private vrFirst: boolean; private vrYaw = 0; private start!: StartSequence; private surgeT = 0; private boostPrev = false; private seatDirty = false; private turned = false; private proxT = 0; private early: boolean;

  static assets(tier: TierDefinition, cycle: string): string[] { return [...cycleAssets([cycle, ...RIVAL_MODELS], 'azure'), 'stand', 'pylon', 'craft', 'drone', 'carrier']; }

  constructor(ctx: Ctx, tier: TierDefinition, diff: DifficultyId, salt = 0) {
    super(ctx, tier, diff);
    const sim = (this.sim = new CombatSim(buildCombatConfig(tier, diff, salt))); const th = (this.th = theme(tier.environment)), W = this.world, H = sim.half0, eng = ctx.engine;
    this.cockpit = ctx.settings.cycleCamera === 'cockpit'; this.vrFirst = ctx.settings.vr.cycleView !== 'chase'; this.early = !tier.endless && tier.id <= 5;
    eng.scene.fog = new THREE.FogExp2(th.fog, th.fogDensity * (ctx.xr.presenting ? 1.5 : 1));
    // far backdrop: the supplied city panorama, kept dim so riders and walls stay the brightest things in view
    const sky = suppliedSky(th, ctx.assets, tier.environment) ?? skyDome(th, ctx.assets.texture(CITY_PANO.arteries), 1500, { lo: -28, hi: 42, gain: ctx.xr.presenting ? 0.4 : 0.5, mix: 0.92, tint: 0.7 }); W.add(sky); this.timed.push(sky.material as THREE.ShaderMaterial); lights(W, th, ctx.settings.quality === 'high' && !ctx.xr.presenting, 70);
    // the floor outside the arena is dropped and dimmed so the play space reads as a bounded deck
    const outer = gridFloor(3000, th, 12, { fade: 700, glow: 0.1 }); outer.position.y = -5; W.add(outer); this.timed.push(outer.material as THREE.ShaderMaterial);
    this.floor = gridFloor(H * 2, th, 4, { fade: H * 3, glow: 1, offset: 2 }); W.add(this.floor); this.timed.push(this.floor.material as THREE.ShaderMaterial);
    // boundary: a tall lattice barrier that is unmistakable with or without bloom
    for (let i = 0; i < 4; i++) { const m = boundaryWall(th.accent, H * 2, 9); this.timed.push(m); const w = new THREE.Mesh(new THREE.PlaneGeometry(1, 9), m); w.rotation.y = i >= 2 ? Math.PI / 2 : 0; W.add(w); this.walls.push(w); }
    // the grid sits in a stadium: grandstand modules along each side, a pylon at each corner (scripts/blender/build_arena_kit.py)
    this.buildStadium(H);
    // patrol skimmers circle above the stadium, sweeping the grid with searchlights
    this.patrol = new Patrol(ctx.assets, { cx: 0, cz: 0, radius: H * 1.1 + 20, height: 48, floorY: 0, count: ctx.settings.quality === 'low' ? 2 : 3, color: th.accent }); W.add(this.patrol.group);
    this.drones = new Drones(ctx.assets, 2, th.accent); W.add(this.drones.group);
    this.carrier = new Carrier(ctx.assets, th.accent, { cx: 0, cz: 0, offset: H + 260, alt: 150, heading: 2.3, len: 1800 }); W.add(this.carrier.group);
    if (tier.environment === 'championship') { this.crowd = new Crowd(H * 1.5 + 14, 4, 8, 260, th, 4); W.add(this.crowd.mesh); }
    // riders
    sim.cycles.forEach((c) => {
      const col = c.isPlayer ? playerTrail(ctx) : CYCLE_COLORS[c.model] ?? 0xff5a36; this.colors.push(col);
      const v = new CycleView(ctx, c.isPlayer ? ctx.settings.cycle : c.model, col, c.isPlayer ? 'char:' + ctx.settings.skin : undefined); v.reveal.value = -1; W.add(v.root); this.cv.push(v);
      v.parked = true; const t = new WallTrail(col); W.add(t.mesh); this.trails.push(t);

    });
    sim.obstacles.forEach((_, i) => this.addObstacle(i));
    // ion lanes: gold strips with light pulsing outward from the middle (either direction is fast), lit edge rails and end posts
    for (const ln of sim.lanes) {
      const L = ln.len * 2, Wd = ln.hw * 2, m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(ION_LANE) }, uLen: { value: L } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uLen; varying vec2 vUv; void main(){ float along = abs(vUv.x - 0.5) * uLen; float c = fract(along / 5.0 - abs(vUv.y - 0.5) * 0.6 - uTime * 1.4); float bar = smoothstep(0.6, 0.85, c) * (1.0 - smoothstep(0.85, 1.0, c)); float edge = smoothstep(0.42, 0.5, abs(vUv.y - 0.5)); float fade = 1.0 - smoothstep(0.9, 1.0, abs(vUv.x - 0.5) * 2.0); gl_FragColor = vec4(uColor * 2.0, (bar * 0.8 + edge * 0.95 + 0.12) * fade); ${TONE} }` });
      this.timed.push(m); const strip = new THREE.Mesh(new THREE.PlaneGeometry(L, Wd), m); strip.rotation.x = -Math.PI / 2; if (ln.axis === 1) strip.rotation.z = Math.PI / 2; strip.position.set(ln.x, 0.04, ln.z); strip.renderOrder = 1; W.add(strip);
      for (const e of [-1, 1]) for (const s2 of [-1, 1]) { const post = edgeBlock(0.35, 1.4, 0.35, ION_LANE); const a = e * ln.len, b = s2 * (ln.hw + 0.5); post.position.set(ln.x + (ln.axis === 0 ? a : b), 0.7, ln.z + (ln.axis === 0 ? b : a)); W.add(post); }
    }
    this.lines = new SpeedLines(th.accent); W.add(this.lines.mesh);
    W.add(ctx.vfx.group); ctx.vfx.clear(); eng.setWorld(W);
    ctx.hud.show('combat'); ctx.audio.playMusic('cycles'); ctx.audio.ambience(tier.environment); ctx.audio.intensity = 0.3; ctx.audio.setCrowdBed(this.crowd ? 0.02 : 0);
    ctx.hud.banner(`TIER ${tier.endless ? '∞' : String(tier.id).padStart(2, '0')} — ${tier.name.toUpperCase()}`, tier.brief, this.introDur * 1000 - 400);
    this.camYaw = yawOf(sim.player.dir); this.view(0, 1, ctx.input.actions); this.start = new StartSequence(ctx, this.cv, this.colors, 0);
  }

  private buildStadium(H: number) {
    const { assets } = this.ctx, th = this.th, W = this.world; if (!assets.has('stand') || !assets.has('pylon')) return;
    const trim = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent).multiplyScalar(1.35) }), glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent).lerp(new THREE.Color(th.accent2), 0.25).multiplyScalar(0.14) });
    const skin = (m: THREE.Material) => (m.name === 'Trim' ? trim : m.name === 'Window' ? glass : m);
    // one instanced draw per material for all grandstand modules
    const stand = assets.instance('stand').root; stand.updateMatrixWorld(true);
    const n = Math.max(2, Math.round((2 * H + 8) / 16)), step = (2 * H + 8) / n, mats: THREE.Matrix4[] = [], p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(step / 16, 1, 1);
    for (const [nx, nz] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) for (let k = 0; k < n; k++) {
      const t = -H - 4 + step * (k + 0.5); p.set(nx * (H + 6) + (nx ? 0 : t), 0, nz * (H + 6) + (nz ? 0 : t)); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(-nx, -nz)); mats.push(new THREE.Matrix4().compose(p, q, sc));
    }
    stand.traverse((o: any) => { if (!o.isMesh) return; const im = new THREE.InstancedMesh(o.geometry, skin(o.material), mats.length); mats.forEach((m, k) => im.setMatrixAt(k, new THREE.Matrix4().multiplyMatrices(m, o.matrixWorld))); im.frustumCulled = false; im.castShadow = false; W.add(im); });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const py = assets.instance('pylon').root; py.traverse((o: any) => { if (o.isMesh) { o.material = skin(o.material); o.castShadow = false; } }); py.position.set(sx * (H + 13), 0, sz * (H + 13)); W.add(py); }
  }

  private addObstacle(i: number) {
    const o = this.sim.obstacles[i]; let obj: THREE.Object3D;
    if (o.kind === 'pit') { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.PlaneGeometry(o.hx * 2, o.hz * 2), new THREE.MeshBasicMaterial({ color: 0x1a0306 })); m.rotation.x = -Math.PI / 2; m.position.y = 0.04; const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(o.hx * 2, 0.5, o.hz * 2)), new THREE.LineBasicMaterial({ color: new THREE.Color(0xff3b4e).multiplyScalar(2) })); e.position.y = 0.25; const x1 = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(o.hx, o.hz) * 2, 0.5), new THREE.MeshBasicMaterial({ color: 0xff3b4e })); x1.rotation.set(-Math.PI / 2, 0, Math.atan2(o.hz, o.hx)); x1.position.y = 0.06; const x2 = x1.clone(); x2.rotation.z = -x1.rotation.z; g.add(m, e, x1, x2); obj = g; obj.position.set(o.x, 0, o.z); }
    else { obj = edgeBlock(o.hx * 2, 6, o.hz * 2, this.th.accent2); obj.position.set(o.x, 3, o.z); obj.traverse((m: any) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }
    this.world.add(obj); this.obs[i] = obj;
  }

  protected intro(k: number, dt: number) {
    const P = this.sim.player, cam = this.ctx.engine.camera, vfx = this.ctx.vfx;
    // vehicles assemble from particles, then their systems light up
    this.sim.cycles.forEach((c, i) => { const t = clamp((k - 0.12 - i * 0.05) / 0.45, 0, 1); this.cv[i].reveal.value = -0.1 + t * 1.6; if (t > 0 && t < 1 && Math.random() < 0.7) vfx.motes(c.x, 0, c.z, this.colors[i], 1.4, 1.4, 4); if (t >= 1) this.cv[i].reveal.value = 50; });
    this.start.update(this.t, dt);
    if (this.xr) return;
    const e = smooth(k), yaw = yawOf(P.dir), a = yaw + Math.PI + lerp(2.2, 0, e), r = lerp(22, this.cockpit ? 0.4 : 10, e), h = lerp(9, this.cockpit ? 1.3 : 4.6, e);
    this.camPos.set(P.x + Math.sin(a) * r, h, P.z + Math.cos(a) * r); cam.position.copy(this.camPos); cam.lookAt(P.x + Math.sin(yaw) * 8 * e, 1 + 0.3 * e, P.z + Math.cos(yaw) * 8 * e);
  }
  protected onCountdown() { this.start.finish(); for (const v of this.cv) { v.reveal.value = 50; v.seal(); } this.ctx.audio.engine(true); this.ctx.audio.sfx('spawn'); if (this.early) this.ctx.hud.coach('GOAL: OUTLAST EVERY RIVAL — YOUR CYCLE LEAVES A WALL, MAKE THEM HIT IT'); }
  protected onStart() { this.ctx.audio.intensity = 0.7; this.sim.cycles.forEach((c, i) => { this.cv[i].launch(); const [dx, dz] = DIRS[c.dir]; this.ctx.vfx.sparks(c.x - dx * 1.4, 0.4, c.z - dz * 1.4, this.colors[i], 26, 9, 0.5, { x: -dx, y: 0.3, z: -dz }); }); this.ctx.audio.sfx('boost'); }

  protected step(dt: number, a: Actions, first: boolean) {
    const it = this.intent; it.turn = first ? (a.turnLeft ? -1 : a.turnRight ? 1 : 0) : 0; it.accel = a.accel - a.brake; it.ability = first && a.ability;
    // a press of boost is a timed surge of super speed; holding it keeps it open while the reserve lasts
    if (first) { if (a.boost && !this.boostPrev) this.surgeT = 1.15; this.boostPrev = a.boost; } this.surgeT -= dt; it.boost = a.boost || this.surgeT > 0;
    this.sim.step(dt, it); for (const e of this.sim.events) this.onEvent(e); this.sim.events.length = 0;
  }
  protected ended() { if (this.sim.state === 'lost') { this.deadT += 1 / 120; return this.deadT > 0.05; } return this.sim.state !== 'active'; }
  protected finish(): SessionResult {
    const s = this.sim.stats, won = this.sim.state === 'won', fs = cycleFinalScore(s, won, this.tier.scoreMul, DIFFICULTIES[this.diff].scoreMul), { audio } = this.ctx;
    audio.engine(false); audio.intensity = 0.2;
    if (won) { audio.sfx('win'); audio.cheer(1.5); this.crowd?.excite(1.6); audio.vo('winner', 'Arena cleared.'); } else { audio.sfx('lose'); audio.vo('game_over', this.tier.id > 4 ? TAUNTS[Math.floor(this.sim.time * 7) % TAUNTS.length] : 'Ribbon severed. Try again.'); }
    this.ctx.hud.coach(null);
    return { won, score: fs.total, lines: fs.lines, time: s.time, headline: won ? 'ARENA CLEARED' : 'RIBBON SEVERED', detail: won ? this.tier.name : this.crashCause(),
      stats: [['Traps', String(s.trapKills)], ['Rivals down', String(s.rivalsDown)], ['Wall riding', Math.round(s.grindMeters) + ' m'], ['Close calls', String(s.nearMisses)], ['Survived', s.time.toFixed(1) + ' s']] };
  }

  private lastCrash = ''; private crashCause() { return this.lastCrash === 'wall' ? 'You hit the arena boundary. Turn before the lattice wall.' : this.lastCrash === 'trail' ? 'You hit a light wall. Every cycle leaves one, including yours.' : this.lastCrash === 'head' ? 'Head-on collision with a rival.' : 'You hit an obstacle.'; }
  private onEvent(e: any) {
    const { vfx, audio, hud, engine, xr, input } = this.ctx, c = e.id ? this.sim.cycles[e.id - 1] : undefined, pos = c ? { x: c.x, y: 0.8, z: c.z } : undefined, mine = c?.isPlayer, col = e.id ? this.colors[e.id - 1] : 0xffffff;
    switch (e.type) {
      case 'turn': if (mine) this.turned = true; audio.sfx('turn', mine ? undefined : pos); this.cv[e.id - 1].lean = e.turn * 0.5; vfx.sparks(e.x, 0.2, e.z, col, 8, 5, 0.25); if (mine) { xr.pulse('both', 0.25, 20); input.rumble(0.15, 0.3, 40); } break;
      case 'crash': {
        audio.sfx('crash', e); const [dx, dz] = DIRS[e.dir]; vfx.shatter(e.x, 0, e.z, col, 120, 1.3, { x: dx * 0.6, z: dz * 0.6 }, 9 + e.speed * 0.15); vfx.ring(e.x, 0.1, e.z, col, 0.5, 14, 0.7); const u = (this.floor.material as THREE.ShaderMaterial).uniforms.uPulse.value as THREE.Vector4; u.set(e.x, e.z, 0, 1);
        engine.addShake(e.player ? 1 : clamp(1 - Math.hypot(e.x - this.sim.player.x, e.z - this.sim.player.z) / 80, 0, 0.6));
        if (e.player) { this.lastCrash = e.kind; hud.flash('hurt'); xr.pulse('both', 1, 400); input.rumble(1, 1, 500); } else { this.crowd?.excite(1.2); audio.cheer(e.by === 1 ? 1 : 0.5); hud.toast(e.by === 1 && e.kind === 'trail' ? 'TRAPPED  +400' : 'RIVAL DOWN  +150', 'score'); }
        break;
      }
      case 'trap': audio.say('Trap confirmed.', { quiet: true }); break;
      case 'nearMiss': audio.sfx('nearMiss'); hud.toast('CLOSE CALL  +60', 'good'); break;
      case 'boost': if (e.on) audio.sfx('boost', mine ? undefined : pos); break;
      case 'grind': break;
      case 'ion': if (e.on) { audio.sfx('pad'); xr.pulse('both', 0.3, 50); if (!this.ionSeen) { this.ionSeen = true; hud.toast('ION LANE — RIDE ALONG IT FOR SPEED + BOOST', 'good'); } } break;
      case 'pickupSpawn': { const g = new THREE.Group(), cc = POWER_COLOR[e.kind]; const geo = e.kind === 'phase' ? new THREE.OctahedronGeometry(1.1) : e.kind === 'purge' ? new THREE.TorusGeometry(0.9, 0.22, 8, 24) : e.kind === 'shock' ? new THREE.TetrahedronGeometry(1.2) : new THREE.ConeGeometry(0.8, 1.8, 4); const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(cc).multiplyScalar(1.6), wireframe: e.kind === 'phase' })); m.position.y = 1.6; const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 14, 6, 1, true), new THREE.MeshBasicMaterial({ color: cc, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })); beam.position.y = 7; g.add(m, beam); g.position.set(e.x, 0, e.z); this.world.add(g); this.pick.set(e.pid, g); break; }
      case 'pickup': { const g = this.pick.get(e.pid); if (g) { this.world.remove(g); this.pick.delete(e.pid); } audio.sfx('pickup', mine ? undefined : e); vfx.ring(e.x, 0.3, e.z, POWER_COLOR[e.kind], 0.4, 4, 0.4); if (mine) hud.toast(e.kind === 'boost' ? 'BOOST REFILLED' : `${String(e.kind).toUpperCase()} READY — PRESS ABILITY`, 'good'); break; }
      case 'power': audio.sfx('power', mine ? undefined : e); vfx.ring(e.x, 0.4, e.z, POWER_COLOR[e.kind], 0.5, e.kind === 'shock' ? 45 : 6, 0.7); if (e.kind === 'shock' && !mine && this.sim.player.shockT > 0) hud.toast('SHOCKED — SPEED CUT', 'danger'); break;
      case 'shrinkWarn': this.shrinking = true; audio.sfx('warn'); audio.say('Boundary collapsing.'); hud.flash('warn'); break;
      case 'obstacleWarn': this.addObstacle(e.index); audio.sfx('warn', this.sim.obstacles[e.index]); break;
      case 'obstacleUp': audio.sfx('platformUp', this.sim.obstacles[e.index]); break;
      case 'obstacleDown': audio.sfx('platformDown', this.sim.obstacles[e.index]); break;
      case 'lastEnemy': audio.say('Final runner remaining.'); break;
    }
  }

  protected view(dt: number, alpha: number, a: Actions) {
    const { engine, hud, audio, vfx, xr } = this.ctx, sim = this.sim, P = sim.player, t = engine.elapsed, cam = engine.camera, H = sim.half;
    for (const m of this.timed) m.uniforms.uTime.value = t;
    const pu = (this.floor.material as THREE.ShaderMaterial).uniforms.uPulse.value as THREE.Vector4; if (pu.w > 0.01) { pu.z += dt * 60; pu.w *= Math.exp(-1.6 * dt); }
    this.crowd?.update(dt, t); this.patrol.update(dt); vfx.update(dt);
    if (a.camera && !this.xr && this.phase !== 'intro') { this.cockpit = !this.cockpit; this.ctx.settings.cycleCamera = this.cockpit ? 'cockpit' : 'chase'; }
    // live boundary
    const wall = P.alive ? sim.freeDist(P.x, P.z, P.dir, 60) : 60, [hdx, hdz] = DIRS[P.dir];
    // walls: 0 = -z, 1 = +z, 2 = +x, 3 = -x. The one the player is closing on heats up.
    const pulse = this.shrinking && H > sim.half0 * 0.451;
    this.walls.forEach((w, i) => {
      const u = (w.material as THREE.ShaderMaterial).uniforms, nx = i === 2 ? 1 : i === 3 ? -1 : 0, nz = i === 0 ? -1 : i === 1 ? 1 : 0;
      w.position.set(nx * H, 4.5, nz * H); w.scale.x = H * 2; (u.uSize.value as THREE.Vector2).x = H * 2;
      const toward = nx * hdx + nz * hdz > 0.5, d = H - (nx * P.x + nz * P.z);
      u.uDanger.value = damp(u.uDanger.value, toward && P.alive ? clamp(1 - d / 34, 0, 1) : 0, 8, dt); u.uFlash.value = pulse ? 0.06 + 0.06 * Math.sin(t * 9) : 0;
    });
    // proximity alarm: beeps and haptics accelerate as any wall ahead closes in
    if (this.phase === 'play' && P.alive && wall < 30) { this.proxT -= dt; if (this.proxT <= 0) { const k = 1 - wall / 30; this.proxT = 0.5 - 0.4 * k; audio.sfx('prox', undefined, 1 + k * 0.8); xr.pulse('both', 0.15 + 0.5 * k, 25); this.ctx.input.rumble(0.2 + 0.5 * k, 0.1, 40); } } else this.proxT = 0;
    const hums: { x: number; y: number; z: number; pitch: number; gain: number }[] = [];
    sim.cycles.forEach((c, i) => {
      const v = this.cv[i], tr = this.trails[i]; v.root.visible = c.alive;
      const x = c.alive ? lerp(c.px, c.x, alpha) : c.x, z = c.alive ? lerp(c.pz, c.z, alpha) : c.z, [dx, dz] = DIRS[c.dir];
      if (c.alive) { v.pose(x, 0, z, yawOf(c.dir), dt, c.speed / (sim.cfg.speed * 1.5), true); (v.glow.material as THREE.MeshBasicMaterial).opacity = c.boosting ? 0.6 : c.phaseT > 0 ? 0.1 + 0.3 * Math.abs(Math.sin(t * 30)) : 0.28; v.body.visible = c.phaseT <= 0 || Math.sin(t * 40) > 0; if (c.boosting && Math.random() < 0.6) vfx.sparks(x - dx * 1.3, 0.4, z - dz * 1.3, this.colors[i], 2, 4, 0.3, { x: -dx, y: 0.3, z: -dz }, 2, 0.35); if (c.grind && Math.random() < 0.5) vfx.sparks(x, 0.15, z, 0xffffff, 1, 3, 0.2, undefined, 6, 0.3); if (!c.isPlayer) hums.push({ x, y: 0.8, z, pitch: 70 + c.speed * 2.2, gain: 0.06 }); }
      // no wall exists until the machines are released
      tr.mesh.visible = (this.phase === 'play' || this.phase === 'outro' || this.phase === 'done') && (!c.trailGone || tr.mat.uniforms.uOpacity.value > 0.02); tr.mat.uniforms.uOpacity.value = damp(tr.mat.uniforms.uOpacity.value, c.alive ? 1 : c.trailGone ? 0 : 0.5 + 0.5 * Math.sin(t * 40), c.trailGone ? 6 : 30, dt);
      if (!c.trailGone) tr.update(c.trail, c.alive ? x - dx * 1.25 : c.x, c.alive ? z - dz * 1.25 : c.z, t);
    });
    hums.sort((p, q) => Math.hypot(p.x - P.x, p.z - P.z) - Math.hypot(q.x - P.x, q.z - P.z)); audio.hums(hums.slice(0, 3));
    sim.obstacles.forEach((o, i) => { const g = this.obs[i]; if (!g) return; if (o.kind === 'pit') { g.visible = o.state !== 'off' && (o.state === 'solid' || Math.sin(t * 16) > -0.2); } else { const k = o.state === 'solid' ? 1 : o.state === 'warn' ? 0.04 + 0.03 * Math.sin(t * 18) : 0; g.scale.y = damp(g.scale.y, Math.max(0.001, k), 8, dt); g.position.y = 3 * g.scale.y; g.visible = g.scale.y > 0.004; } });
    for (const g of this.pick.values()) { g.children[0].rotation.y = t * 2.4; g.children[0].position.y = 1.6 + Math.sin(t * 3) * 0.25; }
    // camera
    this.drones.orbit(dt, 0, 13, 0, sim.half0 * 0.7, this.look.set(lerp(P.px, P.x, alpha), 0.8, lerp(P.pz, P.z, alpha))); this.carrier.update(dt);
    const px = lerp(P.px, P.x, alpha), pz = lerp(P.pz, P.z, alpha), yaw = yawOf(P.dir), sp01 = P.speed / (sim.cfg.speed * 1.55);
    const dev = a.device; hud.menuHint = ctl(dev, 'ESC — MENU   ·   C — VIEW', 'START — MENU   ·   RB — VIEW', `HOLD ${xr.labels.menu} — MENU   ·   ${xr.labels.view} — VIEW   ·   ${xr.labels.turn} ↕ — SEAT`);
    if (!this.xr) hud.vrSeat = null;
    // in a headset the view never changes on its own: it is only switched from the pause menu
    this.start?.tick(dt); const seated = !this.start || this.start.seated;
    if (a.camera && this.xr && seated && this.phase !== 'intro') { this.vrFirst = !this.vrFirst; this.ctx.settings.vr.cycleView = this.vrFirst ? 'cockpit' : 'chase'; hud.toast(this.vrFirst ? 'COCKPIT VIEW' : 'CHASE VIEW', 'info'); }
    const first = this.xr ? this.vrFirst && seated : this.cockpit && this.phase !== 'intro' && P.alive;
    this.cv[0].firstPerson(first); this.cv[0].setPower(this.phase === 'intro' ? smooth(clamp(this.t / this.introDur * 1.4 - 0.2, 0, 1)) : 1);
    // cockpit: a 90° turn flicks the yoke over and back; the lamps glow steadily because the trail is always laying
    const dy = Math.atan2(Math.sin(yaw - this.yokeYaw), Math.cos(yaw - this.yokeYaw)); this.yokeYaw = yaw; this.yokeKick = clamp(this.yokeKick * Math.exp(-7 * dt) - dy * 0.9, -1, 1);
    this.cv[0].drive(this.yokeKick, this.phase === 'play' ? clamp(this.intent.accel + 0.5, 0, 1) : 0, this.phase === 'play' ? clamp(-this.intent.accel, 0, 1) : 0, sp01, P.boosting, dt); this.cv[0].setWall('charging', 1); if (this.phase === 'outro') this.cv[0].unseal(); hud.vrMode = first ? 'dash' : 'belt'; hud.drawVR(dt);
    if (this.xr && !seated) { if (!this.recentred) { this.recentred = true; this.offset.copy(cam.position); this.vrYaw = yaw; } this.start.placeBeside(px, 0, pz, yaw, this.offset); hud.vrSeat = null; xr.showHands = true; xr.update(dt, false); engine.vignetteAmount = 0; }
    else if (this.xr) {
      // head-tracked and never rolled; classic turns are snap turns. Chase view sits above and behind for readability.
      const rig = engine.rig; if (!this.recentred) { this.recentred = true; this.offset.copy(cam.position); this.vrYaw = yaw; }
      // a 90° turn is eased over a fraction of a second (the cockpit turns with the rider), not a hard cut
      const turning = Math.abs(Math.atan2(Math.sin(yaw - this.vrYaw), Math.cos(yaw - this.vrYaw))) / (Math.PI / 2);
      this.vrYaw = angleLerp(this.vrYaw, yaw, 1 - Math.exp(-(first ? 13 : 7.5) * dt)); if (first) this.cv[0].setYaw(this.vrYaw);
      rig.rotation.set(0, this.vrYaw + Math.PI, 0); const off = this.v.copy(this.offset).applyQuaternion(rig.quaternion), fx = Math.sin(this.vrYaw), fz = Math.cos(this.vrYaw);
      const back = first ? -EYE.z : 6.4, up = first ? EYE.y : 3.4;
      // right stick up / down trims the seat, so the dash sits where the rider wants it
      const vs = this.ctx.settings.vr; if (first && xr.dashAdjust && this.phase !== 'intro') { vs.seat = clamp((vs.seat ?? 0) + xr.dashAdjust * 0.3 * dt, -0.35, 0.35); this.seatDirty = true; }
      rig.position.set(px - fx * back - off.x, up + (first ? vs.seat ?? 0 : vs.height) - this.offset.y, pz - fz * back - off.z);
      hud.vrSeat = this.offset; xr.showHands = !first;
      xr.update(dt, false); engine.vignetteAmount = this.ctx.settings.vr.vignette * clamp(sp01 * (first ? 0.6 : 0.3) + (P.boosting ? 0.2 : 0) + turning * 0.5, 0, 1) * (this.phase === 'play' ? 1 : 0);
    } else if (this.phase !== 'intro') {
      this.camYaw = angleLerp(this.camYaw, yaw, 1 - Math.exp(-(first ? 60 : 7.5) * dt)); const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
      if (first) { cam.position.set(px + fx * EYE.z, EYE.y, pz + fz * EYE.z); cam.lookAt(px + fx * 30, 0.95, pz + fz * 30); }
      else { const out = P.alive ? 1 : 1.6, d = (9.5 + sp01 * 2.2) * out; this.camPos.set(px - fx * d, (4.4 + sp01 * 0.8) * out, pz - fz * d); cam.position.copy(this.camPos); cam.lookAt(px + fx * 9, 1.2, pz + fz * 9); }
      const tf = engine.reducedMotion ? 64 : (first ? 74 : 62) + sp01 * (first ? 8 : 16) + (P.boosting ? 6 : 0); if (Math.abs(cam.fov - tf) > 0.1) { cam.fov = damp(cam.fov, tf, 5, dt); cam.updateProjectionMatrix(); }
    }
    this.lines.update(px, 0, pz, yaw, P.speed, t, this.phase === 'play' && !engine.reducedMotion && !this.xr ? clamp((sp01 - 0.55) * 2.2, 0, 1) : 0);
    // coaching: goal first, then the one control that matters, until the player has used it
    if (this.phase === 'play' && this.early && P.alive) {
      const st = sim.time;
      hud.coach(st < 4 ? 'GOAL: OUTLAST EVERY RIVAL — YOUR CYCLE LEAVES A WALL, MAKE THEM HIT IT' : !this.turned ? 'TURN 90°:  ' + ctl(dev, 'A / D   or   ← →', 'LEFT STICK or D-PAD  ◄ ►', 'FLICK EITHER STICK  ◄ ►') : st < 20 && this.tier.id === 1 ? ctl(dev, 'W faster · S slower · SHIFT boost', 'RT faster · LT slower · A boost', 'ANY TRIGGER or GRIP faster · ' + xr.labels.move + ' BACK slower · ' + xr.labels.surge + ' = SUPER SPEED') : null);
    } else if (this.phase === 'play') hud.coach(null);
    cam.getWorldPosition(this.v); cam.getWorldDirection(this.v2); audio.listener(this.v.x, this.v.y, this.v.z, this.v2.x, this.v2.y, this.v2.z);
    if (this.phase === 'play' || this.phase === 'countdown') audio.engineSet(this.phase === 'play' ? sp01 * 1.5 : 0.1, P.boosting, sp01);
    if (this.phase === 'play') audio.intensity = damp(audio.intensity, clamp(0.55 + (wall < 14 ? 0.25 : 0) + sim.aliveRivals() * 0.05 + (P.boosting ? 0.1 : 0), 0, 1), 2, dt);
    hud.update({ tier: this.tier, speed: P.speed, boost: P.boost, boosting: P.boosting, grind: P.grind, power: P.power, rivals: sim.aliveRivals(), score: Math.round(sim.stats.score), wall, traps: sim.stats.trapKills, shrinking: pulse,
      radar: { kind: 'grid', half: H, half0: sim.half0, obstacles: sim.obstacles, pickups: sim.pickups, cycles: sim.cycles.map((c, i) => ({ x: c.x, z: c.z, h: yawOf(c.dir), color: css(this.colors[i]), player: c.isPlayer, alive: c.alive, gone: c.trailGone, trail: c.trail })) } });
  }
  dispose() { const { audio, engine } = this.ctx; if (this.seatDirty) this.ctx.store.save(); engine.fadeTo(0); this.ctx.xr.showHands = true; this.ctx.hud.vrSeat = null; audio.engine(false); audio.hums([]); engine.vignetteAmount = 0; engine.camera.fov = 62; engine.camera.updateProjectionMatrix(); this.world.remove(this.ctx.vfx.group); }
}
