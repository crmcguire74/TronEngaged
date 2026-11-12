import { Rng, clamp, lerp, segSegDist2, smooth } from '../../engine/math';
import type { SimEvent } from '../../engine/events';
import type { EnemySpawn } from '../../progression/types';
import { DISC_POINTS, discHitScore, type DiscStats } from '../../progression/scoring';
import { ARCHETYPES, type Archetype } from './archetypes';
import { HOP_GAP, HOP_RISE, wallNormals, type ArenaDef, type BarrierDef, type PlatformDef } from './arena';
import { aiThink, initAi, type AiState } from './ai';

export interface DiscIntent {
  mx: number; mz: number;
  /** Normalised aim / throw direction in world space. */
  ax: number; ay: number; az: number;
  throwHeld: boolean; shield: boolean; jump: boolean; dodge: boolean; recall: boolean;
  /** Optional throw speed multiplier (VR gesture throws). */
  power?: number;
  /** Optional world-space release point (tracked hand in VR); clamped to arm's reach. */
  ox?: number; oy?: number; oz?: number;
}
export const emptyIntent = (): DiscIntent => ({ mx: 0, mz: 0, ax: 0, ay: 0, az: -1, throwHeld: false, shield: false, jump: false, dodge: false, recall: false });

export interface Platform { def: PlatformDef; x: number; y: number; z: number; dx: number; dy: number; dz: number; bx: number; by: number; bz: number; tx: number; ty: number; tz: number; state: 'up' | 'warn' | 'down'; surge: number; surgeArmed: boolean; r: number; side: 0 | 1 }
export interface Barrier { def: BarrierDef; x: number; y: number; z: number; yaw: number; hp: number; alive: boolean; flash: number }
export interface Fighter {
  id: number; team: 0 | 1; kind: string; arch: Archetype; isPlayer: boolean;
  x: number; y: number; z: number; px: number; py: number; pz: number;
  vx: number; vz: number; kx: number; kz: number; yaw: number; ax: number; ay: number; az: number;
  platform: number; hp: number; maxHp: number; shield: number; maxShield: number; shieldUp: boolean; shieldT: number; shieldLock: number; shieldRest: number;
  stagger: number; dodgeT: number; dodgeCd: number; ddx: number; ddz: number; jumpT: number; invuln: number;
  hop: { to: number; t: number; dur: number; sx: number; sy: number; sz: number; ox: number; oz: number } | null;
  alive: boolean; falling: boolean; fallT: number; spawnT: number; /** seconds until the shield can be raised again after a throw */ guardLock: number;
  winding: boolean; wind: number; throwCd: number; lastThrowHeld: boolean;
  discIds: number[]; ai: AiState | null; phase: number; moving: number;
}
export interface Disc {
  id: number; owner: number; team: 0 | 1; kind: string; state: 'held' | 'flying' | 'returning';
  x: number; y: number; z: number; px: number; py: number; pz: number; vx: number; vy: number; vz: number;
  bounces: number; age: number; homing: number; target: number; hit: Set<number>; parried: boolean;
}
export interface DiscSimConfig {
  arena: ArenaDef; seed: number; waves: readonly (readonly EnemySpawn[])[]; modifiers: readonly string[];
  playerHp: number; playerShield: number; playerDiscs: number;
  aiSkill: number; hazardMul: number; maxAttackers: number; discSpeedMul: number;
}

const FIGHTER_R = 0.5, DISC_R = 0.2, MAX_BOUNCES = 3, RETURN_SPEED = 34, ENERGY_LOSS = 0.06;
export const DISC_DAMAGE = 25;
const seg = { s: 0, t: 0 };

/** How long after a throw the shield stays down. */
export const THROW_GUARD_LOCK = 0.55;
export class DiscSim {
  readonly cfg: DiscSimConfig; readonly rng: Rng;
  platforms: Platform[] = []; barriers: Barrier[] = []; fighters: Fighter[] = []; discs: Disc[] = [];
  events: SimEvent[] = [];
  time = 0; state: 'active' | 'won' | 'lost' = 'active';
  stats: DiscStats = { throws: 0, hits: 0, ricochetHits: 0, parries: 0, kills: 0, fallKills: 0, damageTaken: 0, time: 0, maxCombo: 0, score: 0 };
  combo = 0; comboT = 0; wave = 0; waveDelay = 0;
  interfereT = 0; surgeOn = false; surgeTimer = 6; shiftTimer = 0; shiftIdx = 0; shiftAuto = 0; collapseOn: boolean;
  walls: { nx: number; nz: number }[];
  private nextId = 1; private ambientInterfere = 0;
  player!: Fighter;

  constructor(cfg: DiscSimConfig) {
    this.cfg = cfg; this.rng = new Rng(cfg.seed);
    this.walls = wallNormals(cfg.arena);
    for (const def of cfg.arena.platforms) this.platforms.push({ def, x: def.x, y: def.y, z: def.z, dx: 0, dy: 0, dz: 0, bx: def.x, by: def.y, bz: def.z, tx: def.x, ty: def.y, tz: def.z, state: 'up', surge: 0, surgeArmed: false, r: def.r, side: def.side });
    for (const def of cfg.arena.barriers) this.addBarrier(def);
    this.collapseOn = cfg.arena.platforms.some((p) => p.collapse) && !cfg.modifiers.includes('collapse-later');
    this.surgeOn = cfg.modifiers.includes('energy-surge');
    this.shiftAuto = cfg.modifiers.includes('rapid-shift') ? 10 : cfg.modifiers.includes('shifting') ? 20 : 0;
    this.shiftTimer = this.shiftAuto;
    this.ambientInterfere = cfg.modifiers.includes('interference') ? 14 : 0;
    const home = this.platforms.findIndex((p) => p.side === 0);
    const P = this.platforms[home];
    this.player = this.makeFighter(0, 'player', { ...ARCHETYPES.sentinel, label: 'Runner', hp: cfg.playerHp, speed: 6.2, throwSpeed: 32, discs: cfg.playerDiscs }, P.x, P.y, P.z, home);
    this.player.isPlayer = true; this.player.maxShield = this.player.shield = cfg.playerShield; this.player.spawnT = 0;
    this.player.az = -1; this.player.yaw = Math.PI;
    this.spawnWave(0);
  }

  private addBarrier(def: BarrierDef) { const b: Barrier = { def, x: def.x, y: def.y, z: def.z, yaw: def.yaw, hp: def.hp, alive: true, flash: 0 }; this.barriers.push(b); return b; }

  private makeFighter(team: 0 | 1, kind: string, arch: Archetype, x: number, y: number, z: number, platform: number): Fighter {
    const f: Fighter = {
      id: this.nextId++, team, kind, arch, isPlayer: false, x, y, z, px: x, py: y, pz: z, vx: 0, vz: 0, kx: 0, kz: 0, yaw: 0, ax: 0, ay: 0, az: 1,
      platform, hp: arch.hp, maxHp: arch.hp, shield: 100, maxShield: 100, shieldUp: false, shieldT: 0, shieldLock: 0, shieldRest: 0,
      stagger: 0, dodgeT: 0, dodgeCd: 0, ddx: 0, ddz: 0, jumpT: 0, invuln: 0, hop: null, alive: true, falling: false, fallT: 0, spawnT: 1.4, guardLock: 0,
      winding: false, wind: 0, throwCd: 0, lastThrowHeld: false, discIds: [], ai: null, phase: -1, moving: 0,
    };
    for (let i = 0; i < arch.discs; i++) {
      const d: Disc = { id: this.nextId++, owner: f.id, team, kind: team === 0 ? 'azure' : arch.disc, state: 'held', x, y, z, px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0, bounces: 0, age: 0, homing: 0, target: 0, hit: new Set(), parried: false };
      this.discs.push(d); f.discIds.push(d.id);
    }
    this.fighters.push(f);
    return f;
  }

  spawnEnemy(type: string, difficulty: number, summoned = false): Fighter | null {
    const arch = ARCHETYPES[type] ?? ARCHETYPES.sentinel;
    const side = this.platforms.map((p, i) => ({ p, i })).filter((e) => e.p.side === 1 && e.p.state !== 'down');
    if (!side.length) return null;
    const counts = side.map((e) => this.fighters.filter((f) => f.alive && f.team === 1 && f.platform === e.i).length);
    let best = 0; for (let i = 1; i < side.length; i++) if (counts[i] < counts[best]) best = i;
    const { p, i } = side[best];
    const a = this.rng.range(0, Math.PI * 2), rr = counts[best] ? p.r * 0.5 : 0;
    const f = this.makeFighter(1, type, arch, p.x + Math.cos(a) * rr, p.y, p.z + Math.sin(a) * rr, i);
    f.ai = initAi(this, f, clamp(difficulty + this.cfg.aiSkill, 0, 1));
    this.events.push({ type: 'spawn', id: f.id, kind: type, boss: !!arch.boss, summoned });
    if (arch.boss) this.events.push({ type: 'bossIntro', id: f.id, title: arch.boss.title });
    return f;
  }

  private spawnWave(i: number) {
    this.wave = i;
    for (const s of this.cfg.waves[i] ?? []) for (let n = 0; n < s.count; n++) this.spawnEnemy(s.type, s.difficulty);
    if (i > 0) { this.events.push({ type: 'wave', index: i, total: this.cfg.waves.length }); this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20); }
  }

  fighter(id: number) { return this.fighters.find((f) => f.id === id); }
  enemiesAlive() { let n = 0; for (const f of this.fighters) if (f.team === 1 && f.alive) n++; return n; }
  enemiesRemaining() { let n = this.enemiesAlive(); for (let w = this.wave + 1; w < this.cfg.waves.length; w++) for (const s of this.cfg.waves[w]) n += s.count; return n; }
  heldDiscs(f: Fighter) { let n = 0; for (const id of f.discIds) if (this.disc(id)?.state === 'held') n++; return n; }
  disc(id: number) { return this.discs.find((d) => d.id === id); }
  activeAttackers() { let n = 0; for (const f of this.fighters) if (f.team === 1 && f.alive && (f.winding || (f.ai && f.ai.burstLeft > 0))) n++; return n; }

  // ---------------------------------------------------------------- step
  step(dt: number, playerIntent: DiscIntent) {
    if (this.state !== 'active') { this.stepDiscs(dt); return; }
    this.time += dt; this.stats.time = this.time;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    this.stepArena(dt);
    for (const f of this.fighters) {
      if (!f.alive) continue;
      f.px = f.x; f.py = f.y; f.pz = f.z;
      const intent = f.isPlayer ? playerIntent : aiThink(this, f, dt);
      this.stepFighter(f, intent, dt);
    }
    this.stepDiscs(dt);
    this.checkBoss();
    // waves / end state
    if (this.player.hp <= 0 && this.player.alive) this.eliminate(this.player, 'disc');
    if (!this.player.alive) { this.state = 'lost'; this.events.push({ type: 'lose' }); return; }
    if (this.enemiesAlive() === 0) {
      if (this.wave + 1 < this.cfg.waves.length) { this.waveDelay += dt; if (this.waveDelay > 1.6) { this.waveDelay = 0; this.spawnWave(this.wave + 1); } }
      else { this.state = 'won'; this.events.push({ type: 'win' }); }
    }
  }

  private stepArena(dt: number) {
    const hz = this.cfg.hazardMul;
    // topology shifts
    if (this.shiftAuto > 0) { this.shiftTimer -= dt * hz; if (this.shiftTimer <= 0) { this.shiftTimer = this.shiftAuto; this.triggerShift(); } }
    for (let i = 0; i < this.platforms.length; i++) {
      const p = this.platforms[i], d = p.def;
      const ox = p.x, oy = p.y, oz = p.z;
      p.bx += clamp(p.tx - p.bx, -3 * dt, 3 * dt); p.by += clamp(p.ty - p.by, -2 * dt, 2 * dt); p.bz += clamp(p.tz - p.bz, -3 * dt, 3 * dt);
      let mx = 0, my = 0, mz = 0;
      if (d.move) { const s = Math.sin((this.time / d.move.period + d.move.phase) * Math.PI * 2); mx = d.move.ax * s; my = d.move.ay * s; mz = d.move.az * s; }
      p.x = p.bx + mx; p.y = p.by + my; p.z = p.bz + mz;
      p.dx = p.x - ox; p.dy = p.y - oy; p.dz = p.z - oz;
      if (d.collapse && this.collapseOn) {
        const c = d.collapse, ph = ((this.time / c.interval + c.phase) % 1) * c.interval;
        const warnAt = c.interval - c.down - 1.6, downAt = c.interval - c.down;
        const ns: Platform['state'] = ph >= downAt ? 'down' : ph >= warnAt ? 'warn' : 'up';
        if (ns !== p.state) { p.state = ns; this.events.push({ type: ns === 'warn' ? 'platformWarn' : ns === 'down' ? 'platformDown' : 'platformUp', index: i }); }
      } else if (p.state !== 'up') { p.state = 'up'; this.events.push({ type: 'platformUp', index: i }); }
      if (p.surge > 0) {
        p.surge -= dt;
        if (p.surge <= 0 && p.surgeArmed) {
          p.surgeArmed = false; this.events.push({ type: 'surge', index: i });
          for (const f of this.fighters) if (f.alive && f.platform === i && !f.hop && f.jumpT <= 0 && !f.falling) this.damage(f, 20, 0, 0, 'surge');
        }
      }
    }
    if (this.surgeOn) {
      this.surgeTimer -= dt * hz;
      if (this.surgeTimer <= 0) { this.surgeTimer = this.rng.range(6, 9); const i = this.player.platform >= 0 ? this.player.platform : this.platforms.findIndex((p) => p.side === 0); if (i >= 0) { const p = this.platforms[i]; p.surge = 1.5; p.surgeArmed = true; this.events.push({ type: 'surgeWarn', index: i }); } }
    }
    if (this.ambientInterfere > 0) { this.ambientInterfere -= dt * hz; if (this.ambientInterfere <= 0) { this.ambientInterfere = this.rng.range(15, 20); this.interfere(4); } }
    if (this.interfereT > 0) { this.interfereT -= dt; if (this.interfereT <= 0) this.events.push({ type: 'interference', on: false }); }
    for (const b of this.barriers) {
      if (!b.alive) continue;
      if (b.flash > 0) b.flash -= dt;
      const o = b.def.orbit;
      if (o) { const a = o.phase + o.speed * this.time; b.x = Math.cos(a) * o.r; b.z = Math.sin(a) * o.r; b.yaw = Math.PI / 2 - a; }
      else if (b.def.spin) b.yaw = b.def.yaw + b.def.spin * this.time;
    }
  }

  interfere(dur: number) { this.interfereT = dur; this.events.push({ type: 'interference', on: true, dur }); }
  triggerShift() {
    this.shiftIdx ^= 1;
    for (const p of this.platforms) { const a = this.shiftIdx && p.def.alt ? p.def.alt : p.def; p.tx = a.x; p.ty = a.y; p.tz = a.z; }
    this.events.push({ type: 'shift', index: this.shiftIdx });
  }

  private stepFighter(f: Fighter, it: DiscIntent, dt: number) {
    if (f.spawnT > 0) { f.spawnT -= dt; f.invuln = Math.max(f.invuln, 0.05); const sp = this.platforms[f.platform]; if (sp) { f.x += sp.dx; f.z += sp.dz; f.y = sp.y; } return; }
    f.invuln = Math.max(0, f.invuln - dt); f.throwCd = Math.max(0, f.throwCd - dt); f.dodgeCd = Math.max(0, f.dodgeCd - dt);
    const al = Math.hypot(it.ax, it.ay, it.az) || 1; f.ax = it.ax / al; f.ay = it.ay / al; f.az = it.az / al; f.yaw = Math.atan2(f.ax, f.az);

    if (f.falling) {
      f.fallT += dt; f.y -= (4 + 26 * f.fallT) * dt; f.x += f.kx * dt; f.z += f.kz * dt;
      if (f.fallT > 0.95) this.resolveFall(f);
      return;
    }
    const p = this.platforms[f.platform];
    // hop between platforms
    if (f.hop) {
      const h = f.hop, q = this.platforms[h.to]; h.t += dt / h.dur; const t = Math.min(1, h.t), e = smooth(t);
      f.x = lerp(h.sx, q.x + h.ox, e); f.z = lerp(h.sz, q.z + h.oz, e); f.y = lerp(h.sy, q.y, e) + Math.sin(Math.PI * t) * 1.7;
      if (t >= 1) { f.hop = null; f.platform = h.to; f.y = q.y; f.vx = f.vz = 0; this.events.push({ type: 'land', id: f.id }); if (q.state === 'down') this.startFall(f, 'collapse'); }
      this.stepHands(f, it, dt);
      return;
    }
    if (p.state === 'down') { this.startFall(f, 'collapse'); return; }
    if (f.stagger > 0) f.stagger -= dt;
    const stunned = f.stagger > 0;
    // carried by platform
    f.x += p.dx; f.z += p.dz; f.y = p.y;
    if (f.jumpT > 0) { f.jumpT -= dt; f.y = p.y + Math.sin(Math.PI * clamp(1 - f.jumpT / 0.55, 0, 1)) * 1.55; }

    // jump / hop / dodge
    const ml = Math.hypot(it.mx, it.mz);
    if (!stunned && it.jump && f.jumpT <= 0) {
      let hopped = false;
      if (ml > 0.3 && !(f.isPlayer && this.interfereT > 0)) hopped = this.tryHop(f, it.mx / ml, it.mz / ml);
      if (!hopped) { f.jumpT = 0.55; this.events.push({ type: 'jump', id: f.id }); }
      else return;
    }
    if (!stunned && it.dodge && f.dodgeCd <= 0 && f.dodgeT <= 0) {
      let dx = it.mx, dz = it.mz; if (ml < 0.3) { dx = -f.ax; dz = -f.az; }
      const l = Math.hypot(dx, dz) || 1; f.ddx = dx / l; f.ddz = dz / l; f.dodgeT = 0.24; f.dodgeCd = 0.85; f.invuln = Math.max(f.invuln, 0.2);
      this.events.push({ type: 'dodge', id: f.id });
    }
    // movement: acceleration-smoothed
    let speed = f.arch.speed * (f.shieldUp ? 0.55 : 1) * (f.winding ? 0.8 : 1);
    let tvx = stunned ? 0 : it.mx * speed, tvz = stunned ? 0 : it.mz * speed;
    if (f.dodgeT > 0) { f.dodgeT -= dt; tvx = f.ddx * 17; tvz = f.ddz * 17; f.vx = tvx; f.vz = tvz; }
    const acc = 46 * dt;
    f.vx += clamp(tvx - f.vx, -acc, acc); f.vz += clamp(tvz - f.vz, -acc, acc);
    f.moving = Math.hypot(f.vx, f.vz);
    f.x += (f.vx + f.kx) * dt; f.z += (f.vz + f.kz) * dt;
    const kd = Math.exp(-7 * dt); f.kx *= kd; f.kz *= kd;
    // keep on platform (walking never falls; knockback can)
    const ox = f.x - p.x, oz = f.z - p.z, od = Math.hypot(ox, oz), lim = p.r - FIGHTER_R;
    const knocked = Math.hypot(f.kx, f.kz) > 2.2;
    if (od > lim) {
      if (knocked && od > p.r + 0.15 && !f.arch.boss) { this.startFall(f, 'knock'); return; }
      if (!knocked || f.arch.boss) { f.x = p.x + (ox / od) * lim; f.z = p.z + (oz / od) * lim; }
    }
    // gentle separation between allies sharing a platform
    if (!f.isPlayer) for (const o of this.fighters) if (o !== f && o.alive && o.team === f.team && o.platform === f.platform) { const sx = f.x - o.x, sz = f.z - o.z, sd = Math.hypot(sx, sz); if (sd < 1.3 && sd > 0.001) { f.x += (sx / sd) * (1.3 - sd) * 0.5; f.z += (sz / sd) * (1.3 - sd) * 0.5; } }
    this.stepHands(f, it, dt);
  }

  /** Shield, throw and recall are independent of movement so defence stays responsive mid-attack. */
  private stepHands(f: Fighter, it: DiscIntent, dt: number) {
    const stunned = f.stagger > 0;
    // shield
    f.shieldLock = Math.max(0, f.shieldLock - dt);
    // a fighter committing to a throw is open: no shield during the wind-up or for a moment after release
    f.guardLock = Math.max(0, f.guardLock - dt);
    const want = it.shield && !stunned && f.shieldLock <= 0 && f.shield > 0 && !f.winding && f.guardLock <= 0;
    if (want && !f.shieldUp) { f.shieldUp = true; f.shieldT = 0; this.events.push({ type: 'shieldUp', id: f.id }); }
    else if (!want && f.shieldUp) { f.shieldUp = false; f.shieldRest = 0; this.events.push({ type: 'shieldDown', id: f.id }); }
    if (f.shieldUp) { f.shieldT += dt; f.shield -= 20 * dt; if (f.shield <= 0) this.breakShield(f); }
    else { f.shieldRest += dt; if (f.shieldRest > 0.9) f.shield = Math.min(f.maxShield, f.shield + 16 * dt); }
    // throw: press to ready, release to throw
    if (stunned) { f.winding = false; f.wind = 0; }
    else {
      if (it.throwHeld && !f.lastThrowHeld && !f.winding && f.throwCd <= 0 && this.heldDiscs(f) > 0) { f.winding = true; f.wind = 0; this.events.push({ type: 'ready', id: f.id, dur: f.arch.windup, ai: !f.isPlayer }); }
      if (f.winding) {
        f.wind += dt;
        if (!it.throwHeld) { this.throwDisc(f, clamp(f.wind / 0.5, 0, 1), it.power ?? 1, it); f.winding = false; f.wind = 0; f.guardLock = THROW_GUARD_LOCK; }
      }
    }
    f.lastThrowHeld = it.throwHeld;
    if (it.recall) { let any = false; for (const id of f.discIds) { const d = this.disc(id)!; if (d.state === 'flying') { d.state = 'returning'; any = true; } } if (any) this.events.push({ type: 'recall', id: f.id }); }
  }

  private breakShield(f: Fighter) { f.shield = 0; f.shieldUp = false; f.shieldLock = 2.2; f.shieldRest = 0; f.stagger = Math.max(f.stagger, 0.5); this.events.push({ type: 'shieldBreak', id: f.id }); }

  /** Assisted platform transfer: only ever selects a reachable platform in the pushed direction. */
  /** The platform a hop in direction (dx, dz) would reach, or -1. Used for the on-screen hop target as well as the hop itself. */
  hopTarget(f: Fighter, dx: number, dz: number): number {
    const p = this.platforms[f.platform]; if (!p || f.hop || f.falling) return -1; let best = -1, bestDot = 0.55;
    for (let i = 0; i < this.platforms.length; i++) {
      const q = this.platforms[i]; if (i === f.platform || q.side !== p.side || q.state === 'down') continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) - p.r - q.r > HOP_GAP || Math.abs(q.y - p.y) > HOP_RISE) continue;
      const tx = q.x - f.x, tz = q.z - f.z, tl = Math.hypot(tx, tz) || 1, dot = (tx / tl) * dx + (tz / tl) * dz;
      if (dot > bestDot) { bestDot = dot; best = i; }
    }
    return best;
  }
  tryHop(f: Fighter, dx: number, dz: number, exact = -1): boolean {
    const p = this.platforms[f.platform]; let best = -1, bestDot = 0.55;
    for (let i = 0; i < this.platforms.length; i++) {
      const q = this.platforms[i]; if (i === f.platform || q.side !== p.side || q.state === 'down') continue;
      const gx = q.x - p.x, gz = q.z - p.z, gd = Math.hypot(gx, gz);
      if (gd - p.r - q.r > HOP_GAP || Math.abs(q.y - p.y) > HOP_RISE) continue;
      if (exact >= 0) { if (i === exact) best = i; continue; }
      const tx = q.x - f.x, tz = q.z - f.z, tl = Math.hypot(tx, tz) || 1, dot = (tx / tl) * dx + (tz / tl) * dz;
      if (dot > bestDot) { bestDot = dot; best = i; }
    }
    if (best < 0) return false;
    const q = this.platforms[best]; const gx = p.x - q.x, gz = p.z - q.z, gl = Math.hypot(gx, gz) || 1, inset = q.r - 1.4;
    const dur = 0.5 + Math.min(0.25, (Math.hypot(q.x - f.x, q.z - f.z) - q.r) * 0.02);
    f.hop = { to: best, t: 0, dur, sx: f.x, sy: f.y, sz: f.z, ox: (gx / gl) * inset, oz: (gz / gl) * inset };
    f.jumpT = 0; f.dodgeT = 0; f.platform = f.platform;
    this.events.push({ type: 'hop', id: f.id, to: best });
    return true;
  }

  private startFall(f: Fighter, cause: string) {
    if (f.falling) return; f.falling = true; f.fallT = 0; f.hop = null; f.winding = false; f.shieldUp = false;
    this.events.push({ type: 'fall', id: f.id, cause });
  }
  private resolveFall(f: Fighter) {
    f.falling = false; f.kx = f.kz = 0;
    if (f.isPlayer) {
      this.stats.damageTaken += 30; f.hp -= 30;
      if (f.hp <= 0) { this.eliminate(f, 'fall'); return; }
      this.respawn(f);
    } else if (f.arch.boss) { f.hp -= f.maxHp * 0.12; if (f.hp <= 0) this.eliminate(f, 'fall'); else this.respawn(f); }
    else { this.eliminate(f, 'fall'); }
  }
  private respawn(f: Fighter) {
    let idx = -1; for (let i = 0; i < this.platforms.length; i++) { const p = this.platforms[i]; if (p.side === f.team && p.state === 'up') { idx = i; break; } }
    if (idx < 0) idx = this.platforms.findIndex((p) => p.side === f.team);
    const p = this.platforms[idx]; f.platform = idx; f.x = p.x; f.y = p.y; f.z = p.z; f.px = f.x; f.py = f.y; f.pz = f.z; f.vx = f.vz = 0; f.invuln = 1.6; f.stagger = 0;
    this.events.push({ type: 'respawn', id: f.id });
  }

  throwDisc(f: Fighter, charge: number, power = 1, it?: DiscIntent) {
    let d: Disc | undefined; for (const id of f.discIds) { const c = this.disc(id)!; if (c.state === 'held') { d = c; break; } }
    if (!d) return;
    const speed = (f.arch.throwSpeed * (0.82 + 0.3 * charge)) * power * (f.isPlayer ? 1 : this.cfg.discSpeedMul);
    const a = this.cfg.arena;
    d.state = 'flying'; d.team = f.team; d.parried = false; d.bounces = 0; d.age = 0; d.hit.clear();
    d.x = f.x + f.ax * 0.75; d.y = clamp(f.y + 1.4 + f.ay * 0.3, a.floor + 0.5, a.ceiling - 0.5); d.z = f.z + f.az * 0.75;
    if (it && it.ox !== undefined) { const rx = it.ox - f.x, ry = it.oy! - (f.y + 1.3), rz = it.oz! - f.z, rl = Math.hypot(rx, ry, rz), k = rl > 1.3 ? 1.3 / rl : 1; d.x = f.x + rx * k; d.y = clamp(f.y + 1.3 + ry * k, a.floor + 0.5, a.ceiling - 0.5); d.z = f.z + rz * k; }
    d.px = d.x; d.py = d.y; d.pz = d.z;
    d.vx = f.ax * speed; d.vy = f.ay * speed; d.vz = f.az * speed;
    d.homing = f.arch.homing; d.target = f.isPlayer ? 0 : this.player.id;
    f.throwCd = 0.22;
    if (f.isPlayer) this.stats.throws++;
    this.events.push({ type: 'throw', id: f.id, disc: d.id, x: d.x, y: d.y, z: d.z, homing: d.homing > 0, charge });
  }

  // ---------------------------------------------------------------- discs
  private stepDiscs(dt: number) {
    const A = this.cfg.arena;
    for (const d of this.discs) {
      const owner = this.fighter(d.owner);
      d.px = d.x; d.py = d.y; d.pz = d.z;
      if (!owner || !owner.alive) { if (d.state !== 'held') { d.state = 'held'; this.events.push({ type: 'discGone', disc: d.id }); } continue; }
      if (d.state === 'held') { d.x = owner.x; d.y = owner.y + 1.2; d.z = owner.z; continue; }
      d.age += dt;
      if (d.state === 'returning') {
        const tx = owner.x - d.x, ty = owner.y + 1.3 - d.y, tz = owner.z - d.z, l = Math.hypot(tx, ty, tz);
        if (l < 0.8 || l < RETURN_SPEED * dt) { d.state = 'held'; d.team = owner.team; d.parried = false; this.events.push({ type: 'catch', id: owner.id, disc: d.id }); continue; }
        d.vx = (tx / l) * RETURN_SPEED; d.vy = (ty / l) * RETURN_SPEED; d.vz = (tz / l) * RETURN_SPEED;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; continue;
      }
      // tracking discs steer toward their target for a limited window (visible, evadable)
      if (d.homing > 0 && d.age < 1.7 && !d.parried) {
        const t = this.fighter(d.target);
        if (t && t.alive) {
          const sp = Math.hypot(d.vx, d.vy, d.vz), tx = t.x - d.x, ty = t.y + 1.1 - d.y, tz = t.z - d.z, tl = Math.hypot(tx, ty, tz) || 1, k = Math.min(1, d.homing * dt);
          let nx = d.vx / sp + (tx / tl - d.vx / sp) * k, ny = d.vy / sp + (ty / tl - d.vy / sp) * k, nz = d.vz / sp + (tz / tl - d.vz / sp) * k; const nl = Math.hypot(nx, ny, nz) || 1;
          d.vx = (nx / nl) * sp; d.vy = (ny / nl) * sp; d.vz = (nz / nl) * sp;
        }
      }
      let remaining = dt;
      for (let iter = 0; iter < 4 && remaining > 1e-6 && d.state === 'flying'; iter++) {
        const ex = d.x + d.vx * remaining, ey = d.y + d.vy * remaining, ez = d.z + d.vz * remaining;
        let tHit = 1, nx = 0, ny = 0, nz = 0, kind = '', bHit: Barrier | null = null;
        // chamber walls (regular polygon), ceiling and pit floor
        for (const w of this.walls) {
          const lim = A.radius - DISC_R, s0 = d.x * w.nx + d.z * w.nz, s1 = ex * w.nx + ez * w.nz;
          if (s1 > lim && s1 > s0) { const t = clamp((lim - s0) / (s1 - s0), 0, 1); if (t < tHit) { tHit = t; nx = -w.nx; ny = 0; nz = -w.nz; kind = 'wall'; bHit = null; } }
        }
        if (ey > A.ceiling - DISC_R && d.vy > 0) { const t = clamp((A.ceiling - DISC_R - d.y) / (ey - d.y), 0, 1); if (t < tHit) { tHit = t; nx = 0; ny = -1; nz = 0; kind = 'wall'; bHit = null; } }
        if (ey < A.floor + DISC_R && d.vy < 0) { const t = clamp((A.floor + DISC_R - d.y) / (ey - d.y), 0, 1); if (t < tHit) { tHit = t; nx = 0; ny = 1; nz = 0; kind = 'wall'; bHit = null; } }
        // platform decks (two-sided)
        for (const p of this.platforms) {
          if (p.state === 'down') continue;
          const top = p.y - 0.02, y0 = d.y - top, y1 = ey - top;
          if ((y0 > DISC_R && y1 <= DISC_R) || (y0 < -0.5 - DISC_R && y1 >= -0.5 - DISC_R)) {
            const down = y0 > 0, plane = down ? DISC_R : -0.5 - DISC_R, t = clamp((plane - y0) / (y1 - y0), 0, 1);
            const hx = d.x + (ex - d.x) * t - p.x, hz = d.z + (ez - d.z) * t - p.z;
            if (hx * hx + hz * hz < p.r * p.r && t < tHit) { tHit = t; nx = 0; ny = down ? 1 : -1; nz = 0; kind = 'platform'; bHit = null; }
          }
        }
        // barriers (oriented boxes)
        for (const b of this.barriers) {
          if (!b.alive) continue;
          const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
          const rx0 = d.x - b.x, rz0 = d.z - b.z, rx1 = ex - b.x, rz1 = ez - b.z;
          const l0x = rx0 * c - rz0 * s, l0z = rx0 * s + rz0 * c, l1x = rx1 * c - rz1 * s, l1z = rx1 * s + rz1 * c, l0y = d.y - b.y, l1y = ey - b.y;
          const hx = b.def.hx + DISC_R, hy = b.def.hy + DISC_R, hz = b.def.hz + DISC_R;
          let t0 = 0, t1 = 1, axis = -1, sign = 0, ok = true;
          const o = [l0x, l0y, l0z], e = [l1x, l1y, l1z], h = [hx, hy, hz];
          for (let i = 0; i < 3 && ok; i++) {
            const dd = e[i] - o[i];
            if (Math.abs(dd) < 1e-9) { if (o[i] < -h[i] || o[i] > h[i]) ok = false; continue; }
            let ta = (-h[i] - o[i]) / dd, tb = (h[i] - o[i]) / dd, sg = -1; if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; sg = 1; }
            if (ta > t0) { t0 = ta; axis = i; sign = sg; } if (tb < t1) t1 = tb; if (t0 > t1) ok = false;
          }
          if (ok && axis >= 0 && t0 < tHit) {
            tHit = t0; kind = 'barrier'; bHit = b;
            if (axis === 1) { nx = 0; ny = sign; nz = 0; } else { const lx = axis === 0 ? sign : 0, lz = axis === 2 ? sign : 0; nx = lx * c + lz * s; ny = 0; nz = -lx * s + lz * c; }
          }
        }
        // fighters along the travelled part of the segment
        const hx1 = d.x + (ex - d.x) * tHit, hy1 = d.y + (ey - d.y) * tHit, hz1 = d.z + (ez - d.z) * tHit;
        let victim: Fighter | null = null, vs = 2;
        for (const f of this.fighters) {
          if (!f.alive || f.team === d.team || f.falling || f.spawnT > 0 || d.hit.has(f.id)) continue;
          const rr = FIGHTER_R + DISC_R;
          const d2 = segSegDist2(d.x, d.y, d.z, hx1, hy1, hz1, f.x, f.y + 0.3, f.z, f.x, f.y + 1.6, f.z, seg);
          if (d2 < rr * rr && seg.s < vs) { victim = f; vs = seg.s; }
        }
        if (victim) {
          d.x += (hx1 - d.x) * vs; d.y += (hy1 - d.y) * vs; d.z += (hz1 - d.z) * vs;
          this.hitFighter(d, victim); remaining *= 1 - tHit * vs; if (d.state !== 'flying') break; continue;
        }
        d.x = hx1; d.y = hy1; d.z = hz1;
        if (tHit >= 1) break;
        // ricochet: reflect about the surface normal with configurable energy loss
        const dot = d.vx * nx + d.vy * ny + d.vz * nz;
        d.vx = (d.vx - 2 * dot * nx) * (1 - ENERGY_LOSS); d.vy = (d.vy - 2 * dot * ny) * (1 - ENERGY_LOSS); d.vz = (d.vz - 2 * dot * nz) * (1 - ENERGY_LOSS);
        d.x += nx * 0.01; d.y += ny * 0.01; d.z += nz * 0.01;
        d.bounces++; remaining *= 1 - tHit;
        this.events.push({ type: 'bounce', disc: d.id, kind, x: d.x, y: d.y, z: d.z, nx, ny, nz, team: d.team });
        if (bHit && bHit.def.hp > 0) { bHit.hp--; bHit.flash = 0.25; if (bHit.hp <= 0) this.breakBarrier(bHit, d.team); }
        if (d.bounces > MAX_BOUNCES) { d.state = 'returning'; this.events.push({ type: 'spent', disc: d.id }); }
      }
      if (d.state === 'flying' && d.age > 3.6) d.state = 'returning';
    }
    // disc-on-disc deflection
    for (let i = 0; i < this.discs.length; i++) {
      const a = this.discs[i]; if (a.state !== 'flying') continue;
      for (let j = i + 1; j < this.discs.length; j++) {
        const b = this.discs[j]; if (b.state !== 'flying' || b.team === a.team) continue;
        const d2 = segSegDist2(a.px, a.py, a.pz, a.x, a.y, a.z, b.px, b.py, b.pz, b.x, b.y, b.z, seg);
        if (d2 < 0.5 * 0.5) {
          const nx = a.x - b.x, ny = a.y - b.y, nz = a.z - b.z, nl = Math.hypot(nx, ny, nz) || 1;
          for (const [dd, sgn] of [[a, 1], [b, -1]] as const) { const ux = (nx / nl) * sgn, uy = (ny / nl) * sgn, uz = (nz / nl) * sgn, dot = dd.vx * ux + dd.vy * uy + dd.vz * uz; if (dot < 0) { dd.vx -= 2 * dot * ux; dd.vy -= 2 * dot * uy; dd.vz -= 2 * dot * uz; } dd.bounces++; dd.homing = 0; }
          this.events.push({ type: 'clash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
          if (this.fighter(a.owner)?.isPlayer || this.fighter(b.owner)?.isPlayer) this.addScore(DISC_POINTS.clash, 'Deflection');
        }
      }
    }
  }

  private hitFighter(d: Disc, f: Fighter) {
    const sp = Math.hypot(d.vx, d.vy, d.vz) || 1, dx = d.vx / sp, dz = d.vz / sp;
    if (f.invuln > 0) { d.hit.add(f.id); if (f.dodgeT > 0 || f.dodgeCd > 0.5) this.events.push({ type: 'evade', id: f.id }); return; }
    const frontal = -(dx * f.ax + dz * f.az) > 0.5;
    if (f.shieldUp && frontal) {
      d.hit.clear();
      if (f.shieldT < 0.22) {
        // parry: disc is turned against its thrower
        const o = this.fighter(d.owner)!; const tx = o.x - d.x, ty = o.y + 1.2 - d.y, tz = o.z - d.z, tl = Math.hypot(tx, ty, tz) || 1, ns = sp * 1.2;
        d.vx = (tx / tl) * ns; d.vy = (ty / tl) * ns; d.vz = (tz / tl) * ns; d.team = f.team; d.parried = true; d.bounces = 0; d.age = 0; d.homing = 0;
        f.shield = Math.min(f.maxShield, f.shield + 15);
        this.events.push({ type: 'parry', id: f.id, x: d.x, y: d.y, z: d.z });
        if (f.isPlayer) { this.stats.parries++; this.addScore(DISC_POINTS.parry, 'Parry'); }
      } else {
        const dot = d.vx * f.ax + d.vy * f.ay + d.vz * f.az; d.vx -= 2 * dot * f.ax; d.vy -= 2 * dot * f.ay; d.vz -= 2 * dot * f.az; d.bounces++; d.homing = 0;
        f.shield -= 26; this.events.push({ type: 'block', id: f.id, x: d.x, y: d.y, z: d.z });
        if (f.shield <= 0) this.breakShield(f);
        if (d.bounces > MAX_BOUNCES) d.state = 'returning';
      }
      d.x += d.vx / sp * 0.6; d.z += d.vz / sp * 0.6;
      return;
    }
    d.hit.add(f.id);
    const owner = this.fighter(d.owner);
    const dmg = DISC_DAMAGE * (1 + 0.25 * d.bounces) * (d.parried ? 1.3 : 1);
    this.events.push({ type: 'hit', id: f.id, by: d.owner, x: d.x, y: d.y, z: d.z, dx, dz, bounces: d.bounces, parried: d.parried });
    const byPlayer = (owner?.isPlayer && !d.parried) || (d.parried && d.team === 0);
    if (byPlayer && f.team === 1) {
      this.stats.hits++; if (d.bounces > 0) this.stats.ricochetHits++;
      this.combo++; this.comboT = DISC_POINTS.comboWindow; this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
      this.addScore(discHitScore(d.bounces, this.combo), d.bounces > 0 ? `Ricochet ×${d.bounces}` : 'Direct hit');
    }
    this.damage(f, dmg, dx * 6.5, dz * 6.5, 'disc');
    d.state = 'returning';
  }

  damage(f: Fighter, amount: number, kx: number, kz: number, cause: string) {
    if (!f.alive || f.invuln > 0 && cause !== 'surge') return;
    f.hp -= amount; f.stagger = Math.max(f.stagger, cause === 'surge' ? 0.3 : 0.38); f.kx += kx; f.kz += kz; f.winding = false; f.wind = 0;
    if (f.isPlayer) { this.stats.damageTaken += amount; this.combo = 0; }
    this.events.push({ type: 'damage', id: f.id, amount, cause, hp: f.hp });
    if (f.hp <= 0) this.eliminate(f, cause);
  }

  private eliminate(f: Fighter, cause: string) {
    if (!f.alive) return; f.alive = false; f.hp = 0;
    this.events.push({ type: 'shatter', id: f.id, x: f.x, y: f.y, z: f.z, cause, boss: !!f.arch.boss, player: f.isPlayer, tint: f.arch.tint });
    if (f.team === 1) {
      this.stats.kills++;
      if (cause === 'fall') { this.stats.fallKills++; this.addScore(DISC_POINTS.fallKill, 'Platform fall'); }
      else if (cause === 'explosion' || cause === 'surge') this.addScore(DISC_POINTS.envKill, 'Environmental');
      else this.addScore(DISC_POINTS.kill * (f.arch.boss ? 4 : 1), f.arch.boss ? 'Boss down' : 'Eliminated');
      const left = this.enemiesRemaining(); if (left === 1) this.events.push({ type: 'lastEnemy' });
    }
  }

  private breakBarrier(b: Barrier, team: number) {
    b.alive = false; this.events.push({ type: 'barrierBreak', x: b.x, y: b.y, z: b.z, volatile: !!b.def.volatile });
    if (!b.def.volatile) return;
    const R = 7.5;
    this.events.push({ type: 'explosion', x: b.x, y: b.y, z: b.z, r: R });
    for (const f of this.fighters) {
      if (!f.alive) continue; const dx = f.x - b.x, dz = f.z - b.z, dy = f.y + 1 - b.y, dist = Math.hypot(dx, dy, dz);
      if (dist < R) { const k = 1 - dist / R, l = Math.hypot(dx, dz) || 1; this.damage(f, 34 * k + 8, (dx / l) * 11 * k, (dz / l) * 11 * k, 'explosion'); }
    }
    for (const o of this.barriers) if (o.alive && o !== b && o.def.hp > 0 && Math.hypot(o.x - b.x, o.y - b.y, o.z - b.z) < R) { o.hp = 0; this.breakBarrier(o, team); }
  }

  private addScore(points: number, label: string) { this.stats.score += points; this.events.push({ type: 'score', points, label, combo: this.combo }); }

  // ---------------------------------------------------------------- bosses
  private checkBoss() {
    for (const f of this.fighters) {
      const boss = f.arch.boss; if (!boss || !f.alive) continue;
      const frac = f.hp / f.maxHp; let idx = boss.phases.length - 1;
      for (let i = 0; i < boss.phases.length; i++) if (frac > boss.phases[i].hpAbove) { idx = i; break; }
      if (idx <= f.phase) continue;
      const first = f.phase < 0; f.phase = idx; const ph = boss.phases[idx];
      const baseArch = ARCHETYPES[f.kind]; f.arch = { ...baseArch, ...ph.over };
      if (!first) { f.invuln = 1.8; f.stagger = 0; f.winding = false; if (f.ai) { f.ai.cooldown = 1.8; f.ai.burstLeft = 0; } }
      this.events.push({ type: 'bossPhase', id: f.id, index: idx, name: ph.name, total: boss.phases.length, first });
      for (const act of ph.onEnter) this.bossAction(f, act);
    }
  }
  private bossAction(f: Fighter, act: string) {
    const [cmd, a, b] = act.split(':');
    if (cmd === 'summon') { for (let i = 0; i < Number(b ?? 1); i++) this.spawnEnemy(a, clamp((f.ai?.skill ?? 0.5) - 0.1, 0, 1), true); }
    else if (cmd === 'shift') this.triggerShift();
    else if (cmd === 'surge') { this.surgeOn = true; this.surgeTimer = 3; }
    else if (cmd === 'collapse') { this.collapseOn = true; }
    else if (cmd === 'interfere') this.interfere(5);
    else if (cmd === 'orbit') { const n = Number(a ?? 1), have = this.barriers.filter((x) => x.def.orbit).length; for (let i = 0; i < n; i++) { const bb = this.addBarrier({ x: 0, y: 2.6 + (have + i) * 1.2, z: 0, hx: 2.6, hy: 1.3, hz: 0.22, yaw: 0, hp: 0, orbit: { r: 5.5 + (have + i) * 2.2, speed: (have + i) % 2 ? -0.55 : 0.65, phase: this.rng.range(0, 6) } }); this.events.push({ type: 'barrierAdd', index: this.barriers.indexOf(bb) }); } }
  }

  /** True when the straight segment between two points is blocked by a live barrier (used by AI line-of-fire checks). */
  blocked(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, ignore?: Barrier): boolean {
    for (const b of this.barriers) {
      if (!b.alive || b === ignore) continue; const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const o = [(x0 - b.x) * c - (z0 - b.z) * s, y0 - b.y, (x0 - b.x) * s + (z0 - b.z) * c], e = [(x1 - b.x) * c - (z1 - b.z) * s, y1 - b.y, (x1 - b.x) * s + (z1 - b.z) * c], h = [b.def.hx + 0.25, b.def.hy + 0.25, b.def.hz + 0.25];
      let t0 = 0, t1 = 1, ok = true;
      for (let i = 0; i < 3 && ok; i++) { const dd = e[i] - o[i]; if (Math.abs(dd) < 1e-9) { if (o[i] < -h[i] || o[i] > h[i]) ok = false; continue; } let ta = (-h[i] - o[i]) / dd, tb = (h[i] - o[i]) / dd; if (ta > tb) { const t = ta; ta = tb; tb = t; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) ok = false; }
      if (ok) return true;
    }
    return false;
  }
}
