import { Rng, clamp, lerp, segSegDist2, smooth } from '../../engine/math';
import type { SimEvent } from '../../engine/events';
import type { EnemySpawn } from '../../progression/types';
import { DISC_POINTS, discHitScore, type DiscStats } from '../../progression/scoring';
import { ARCHETYPES, type Archetype, type Weapon } from './archetypes';
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

export interface Platform {
  def: PlatformDef; x: number; y: number; z: number; dx: number; dy: number; dz: number; bx: number; by: number; bz: number; tx: number; ty: number; tz: number;
  state: 'up' | 'warn' | 'down'; surge: number; surgeArmed: boolean; r: number; side: 0 | 1;
  /** Breakable decks: hits left before the deck fails (0 = indestructible), and whether it has already gone. */
  integrity: number; gone: boolean; breakT: number;
}
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
  bounces: number; age: number; homing: number; target: number; hit: Set<number>; parried: boolean; /** passed through an amplifier ring this flight */ amped?: boolean;
  /** What was thrown: a ricocheting disc, an unparryable straight lance, or a heavy arc blade. */ weapon?: Weapon;
  /** A split-throw copy: it derezzes instead of returning, and is removed from the list. */ temp?: boolean; dead?: boolean;
  /** Cutter tiers: the hardlight beam a rival disc leaves behind it, flat [x, y, z, t, ...], newest last. */ beam?: number[];
}
/** Power node on one of the player's decks: stand on it to take it. Split and Pierce charge the next throw. */
export interface PowerNode { id: number; kind: 'split' | 'pierce' | 'mend'; platform: number; ox: number; oz: number; x: number; y: number; z: number; life: number }
/** Shielded core behind the rival line ('core' tiers). Six hits through the rotating gap derez the whole rival side. */
export interface Core { x: number; y: number; z: number; hp: number; max: number; rot: number; spin: number; gap: number; flash: number }
const CORE_R = 1.3, CORE_SHELL = 2.5;
/** Amplifier ring: a gold gate hanging over the gap. A disc thrown through it speeds up and hits harder — for either side. */
export interface AmpRing { x: number; y: number; z: number; r: number; bx: number; sway: number; phase: number; flash: number }
export interface DiscSimConfig {
  arena: ArenaDef; seed: number; waves: readonly (readonly EnemySpawn[])[]; modifiers: readonly string[];
  playerHp: number; playerShield: number; playerDiscs: number;
  aiSkill: number; hazardMul: number; maxAttackers: number; discSpeedMul: number; /** rival integrity scale (difficulty) */ enemyHpMul?: number; /** rival disc damage to the player (difficulty) */ enemyDmgMul?: number;
  /** Breakable decks: hits a platform survives before it fails. Only read with the 'fragile-platforms' modifier. */ platformHp?: number;
}

const AMP_SPEED = 1.3, AMP_DAMAGE = 1.6;
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
  walls: { nx: number; nz: number }[]; amps: AmpRing[] = [];
  /** Rally ('rally' tiers): parries and hits raise it (to 1.6); it speeds the player's throws and adds damage. A hit taken resets it. */ rally = 1;
  /** Power nodes ('pickups' tiers) and the charge the next throw carries. */ nodes: PowerNode[] = []; nodeT = 6; buff: '' | 'split' | 'pierce' = '';
  core: Core | null = null;
  /** Cutter tiers: rival discs leave a beam that cuts whoever crosses it; the player can only be cut once per window. */ private cutter = false; private cutCd = 0;
  /** Maze tiers: rivals take cover between throws (see ai.ts). */ maze = false;
  private nextId = 1; private ambientInterfere = 0;
  player!: Fighter;

  constructor(cfg: DiscSimConfig) {
    this.cfg = cfg; this.rng = new Rng(cfg.seed);
    this.walls = wallNormals(cfg.arena);
    const deckHp = cfg.modifiers.includes('fragile-platforms') ? Math.max(2, cfg.platformHp ?? 4) : 0;
    for (const def of cfg.arena.platforms) this.platforms.push({ def, x: def.x, y: def.y, z: def.z, dx: 0, dy: 0, dz: 0, bx: def.x, by: def.y, bz: def.z, tx: def.x, ty: def.y, tz: def.z, state: 'up', surge: 0, surgeArmed: false, r: def.r, side: def.side, integrity: deckHp, gone: false, breakT: 0 });
    for (const def of cfg.arena.barriers) this.addBarrier(def);
    this.collapseOn = cfg.arena.platforms.some((p) => p.collapse) && !cfg.modifiers.includes('collapse-later');
    this.surgeOn = cfg.modifiers.includes('energy-surge');
    this.shiftAuto = cfg.modifiers.includes('rapid-shift') ? 10 : cfg.modifiers.includes('shifting') ? 20 : 0;
    this.shiftTimer = this.shiftAuto;
    this.ambientInterfere = cfg.modifiers.includes('interference') ? 14 : 0;
    if (cfg.modifiers.includes('amp')) { const n = cfg.modifiers.includes('amp-3') ? 3 : 2; for (let i = 0; i < n; i++) { const bx = n === 3 ? (i - 1) * 7 : (i ? 4.5 : -4.5); this.amps.push({ x: bx, y: 2.3 + (i % 2) * 0.9, z: 3.2, r: 1.25, bx, sway: n === 3 ? 1.6 : 2.6, phase: i * 2.2, flash: 0 }); } }
    this.cutter = cfg.modifiers.includes('cutter'); this.maze = cfg.modifiers.includes('maze');
    if (cfg.modifiers.includes('core')) { const A = cfg.arena; this.core = { x: 0, y: 7.5, z: -(A.radius - 3.2), hp: 6, max: 6, rot: 0, spin: 0.6, gap: 1.5, flash: 0 }; }
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
    if (this.cfg.enemyHpMul && this.cfg.enemyHpMul !== 1) { f.maxHp = Math.round(f.maxHp * this.cfg.enemyHpMul); f.hp = f.maxHp; }
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
    if (this.state !== 'active') { for (const f of this.fighters) { f.px = f.x; f.py = f.y; f.pz = f.z; } this.stepDiscs(dt); return; }
    this.time += dt; this.stats.time = this.time;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    this.stepArena(dt);
    for (const a of this.amps) { a.x = a.bx + Math.sin(this.time * 0.42 + a.phase) * a.sway; a.flash = Math.max(0, a.flash - dt); }
    this.stepNodes(dt); if (this.core) { this.core.rot += this.core.spin * dt; this.core.flash = Math.max(0, this.core.flash - dt); }
    for (const f of this.fighters) {
      if (!f.alive) continue;
      f.px = f.x; f.py = f.y; f.pz = f.z;
      const intent = f.isPlayer ? playerIntent : aiThink(this, f, dt);
      this.stepFighter(f, intent, dt);
    }
    this.stepDiscs(dt); if (this.cutter) this.stepBeams(dt);
    if (this.discs.some((d) => d.dead)) this.discs = this.discs.filter((d) => !d.dead);
    this.stepUpgrades();
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
      if (p.gone) {
        // a broken deck warns for a moment, drops, and never comes back
        if (p.breakT > 0) { p.breakT -= dt; if (p.breakT <= 0 && p.state !== 'down') { p.state = 'down'; this.events.push({ type: 'platformBreak', index: i, x: p.x, y: p.y, z: p.z }); } }
        continue;
      }
      if (d.collapse && this.collapseOn) {
        const c = d.collapse, ph = ((this.time / c.interval + c.phase) % 1) * c.interval;
        // 2.6 s of warning before a deck drops: long enough to see the sign, hear the klaxon and hop clear
        const warnAt = c.interval - c.down - 2.6, downAt = c.interval - c.down;
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
    // maze pillars are solid to bodies: push a fighter out of any pillar it walks into (circle against the pillar's box)
    for (const b of this.barriers) {
      if (!b.alive || !b.def.pillar || f.y > b.y + b.def.hy || f.y + 1.8 < b.y - b.def.hy) continue;
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw), rx = f.x - b.x, rz = f.z - b.z, lx = rx * c - rz * s, lz = rx * s + rz * c;
      const qx = clamp(lx, -b.def.hx, b.def.hx), qz = clamp(lz, -b.def.hz, b.def.hz), dx = lx - qx, dz = lz - qz, d = Math.hypot(dx, dz);
      if (d < FIGHTER_R) { const nlx = d > 1e-5 ? dx / d : 1, nlz = d > 1e-5 ? dz / d : 0, pen = FIGHTER_R - d; f.x += (nlx * c + nlz * s) * pen; f.z += (-nlx * s + nlz * c) * pen; }
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
    const speed = (f.arch.throwSpeed * (0.82 + 0.3 * charge)) * power * (f.isPlayer ? 1 + (this.rally - 1) * 0.6 : this.cfg.discSpeedMul);
    const a = this.cfg.arena;
    d.state = 'flying'; d.team = f.team; d.parried = false; d.amped = false; d.bounces = 0; d.age = 0; d.hit.clear();
    d.x = f.x + f.ax * 0.75; d.y = clamp(f.y + 1.4 + f.ay * 0.3, a.floor + 0.5, a.ceiling - 0.5); d.z = f.z + f.az * 0.75;
    if (it && it.ox !== undefined) { const rx = it.ox - f.x, ry = it.oy! - (f.y + 1.3), rz = it.oz! - f.z, rl = Math.hypot(rx, ry, rz), k = rl > 1.3 ? 1.3 / rl : 1; d.x = f.x + rx * k; d.y = clamp(f.y + 1.3 + ry * k, a.floor + 0.5, a.ceiling - 0.5); d.z = f.z + rz * k; }
    d.px = d.x; d.py = d.y; d.pz = d.z;
    // weapon tuning: a lance is fast and flat, an arc blade is slow and heavy. The disc is unchanged.
    // a Pierce charge turns the player's next throw into a lance: straight, fast, and through a raised shield
    const pierce = f.isPlayer && this.buff === 'pierce'; if (pierce) this.buff = '';
    const w = (d.weapon = pierce ? 'lance' : f.arch.weapon ?? 'disc');
    const vk = w === 'lance' ? 1.55 : w === 'arc' ? 0.62 : 1;
    d.vx = f.ax * speed * vk; d.vy = f.ay * speed * vk; d.vz = f.az * speed * vk;
    d.homing = w === 'lance' ? 0 : f.arch.homing; d.target = f.isPlayer ? 0 : this.player.id;
    f.throwCd = 0.22;
    if (f.isPlayer) this.stats.throws++;
    this.events.push({ type: 'throw', id: f.id, disc: d.id, x: d.x, y: d.y, z: d.z, homing: d.homing > 0, charge, weapon: w });
    // a Split charge fans the throw into three: two copies 12 degrees either side, which derez when they are spent
    if (f.isPlayer && this.buff === 'split') {
      this.buff = ''; const ids: number[] = [];
      for (const a of [-0.21, 0.21]) {
        const c = Math.cos(a), sn = Math.sin(a), t: Disc = { ...d, id: this.nextId++, hit: new Set(), temp: true, vx: d.vx * c + d.vz * sn, vz: -d.vx * sn + d.vz * c };
        this.discs.push(t); ids.push(t.id);
      }
      this.events.push({ type: 'split', id: f.id, discs: ids, x: d.x, y: d.y, z: d.z });
    }
  }

  // ---------------------------------------------------------------- power nodes, rally, core
  private stepNodes(dt: number) {
    if (!this.cfg.modifiers.includes('pickups')) return;
    const P = this.player;
    for (const n of this.nodes) { const p = this.platforms[n.platform]; n.x = p.x + n.ox; n.y = p.y; n.z = p.z + n.oz; n.life -= dt; }
    for (const n of this.nodes) {
      if (n.life <= 0 || this.platforms[n.platform].state === 'down') { n.life = -1; this.events.push({ type: 'nodeGone', node: n.id }); continue; }
      if (P.alive && !P.hop && Math.hypot(P.x - n.x, P.z - n.z) < 1.3 && Math.abs(P.y - n.y) < 1.2) {
        n.life = -1; if (n.kind === 'mend') { P.hp = Math.min(P.maxHp, P.hp + 30); P.shield = Math.min(P.maxShield, P.shield + 40); } else this.buff = n.kind;
        this.events.push({ type: 'node', node: n.id, kind: n.kind, x: n.x, y: n.y, z: n.z }); this.addScore(40, 'Power node');
      }
    }
    this.nodes = this.nodes.filter((n) => n.life > 0);
    this.nodeT -= dt; if (this.nodeT > 0 || this.nodes.length) return; this.nodeT = this.rng.range(9, 13);
    // prefer a deck the player is not standing on: taking a node should mean making a hop
    const decks = this.platforms.map((p, i) => ({ p, i })).filter((e) => e.p.side === 0 && e.p.state === 'up' && !e.p.gone);
    if (!decks.length) return; const away = decks.filter((e) => e.i !== P.platform), pick = (away.length ? away : decks)[Math.floor(this.rng.next() * (away.length ? away : decks).length)];
    const kinds = ['split', 'pierce', 'mend'] as const, kind = P.hp < P.maxHp * 0.45 ? 'mend' : kinds[Math.floor(this.rng.next() * 3)];
    const a = this.rng.range(0, Math.PI * 2), r = pick.p.r * 0.45, n: PowerNode = { id: this.nextId++, kind, platform: pick.i, ox: Math.cos(a) * r, oz: Math.sin(a) * r, x: 0, y: 0, z: 0, life: 14 };
    n.x = pick.p.x + n.ox; n.y = pick.p.y; n.z = pick.p.z + n.oz; this.nodes.push(n); this.events.push({ type: 'nodeSpawn', node: n.id, kind, x: n.x, y: n.y, z: n.z });
  }
  /**
   * Cutter beams: while a rival disc flies it lays a point every 50 ms; points live 1.1 s, so each disc drags a short
   * blade of light behind it. Crossing one costs the player 10 (scaled by difficulty: 7 to 15) and a stagger. A dodge's immunity, or being in the air
   * over it, avoids the cut: the answer is to move or hop, not to block.
   */
  private stepBeams(dt: number) {
    const P = this.player, life = 1.1; this.cutCd = Math.max(0, this.cutCd - dt);
    for (const d of this.discs) {
      if (d.team !== 1 && !d.beam?.length) continue; const b = (d.beam ??= []);
      if (d.state === 'flying' && d.team === 1) { const n = b.length; if (!n || this.time - b[n - 1] >= 0.05) b.push(d.x, d.y, d.z, this.time); }
      let cut = 0; while (cut < b.length && this.time - b[cut + 3] > life) cut += 4; if (cut) b.splice(0, cut);
      if (!P.alive || P.invuln > 0 || P.falling || this.cutCd > 0 || b.length < 8) continue;
      for (let i = 0; i + 7 < b.length; i += 4) {
        const d2 = segSegDist2(b[i], b[i + 1], b[i + 2], b[i + 4], b[i + 5], b[i + 6], P.x, P.y + 0.3, P.z, P.x, P.y + 1.6, P.z, seg);
        if (d2 < 0.42 * 0.42) { this.cutCd = 0.8; this.events.push({ type: 'beamCut', x: P.x, y: P.y + 1, z: P.z }); this.damage(P, Math.round(10 * this.cfg.hazardMul), 0, 0, 'beam'); break; }
      }
    }
  }
  private raiseRally(by: number) {
    if (!this.cfg.modifiers.includes('rally')) return; const before = this.rally; this.rally = Math.min(1.6, this.rally + by);
    if (Math.floor(this.rally * 10) !== Math.floor(before * 10)) this.events.push({ type: 'rally', value: this.rally });
  }
  /** Segment vs sphere: entry parameter in [0, 1], or -1 (no entry, or already inside). */
  private static sphereT(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cx: number, cy: number, cz: number, r: number) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, fx = x0 - cx, fy = y0 - cy, fz = z0 - cz, a = dx * dx + dy * dy + dz * dz, b = 2 * (fx * dx + fy * dy + fz * dz), c = fx * fx + fy * fy + fz * fz - r * r;
    if (c <= 0 || a < 1e-12) return -1; const disc = b * b - 4 * a * c; if (disc < 0) return -1; const t = (-b - Math.sqrt(disc)) / (2 * a); return t >= 0 && t <= 1 ? t : -1;
  }
  private coreDown() {
    const c = this.core!; this.events.push({ type: 'coreDown', x: c.x, y: c.y, z: c.z }); this.addScore(600, 'Core breached');
    // the whole rival side is wired to it: every rival derezzes, and no further wave comes
    this.wave = this.cfg.waves.length - 1; for (const f of this.fighters) if (f.team === 1 && f.alive) this.eliminate(f, 'core');
  }

  // ---------------------------------------------------------------- discs
  private stepDiscs(dt: number) {
    const A = this.cfg.arena;
    for (const d of this.discs) {
      const owner = this.fighter(d.owner);
      d.px = d.x; d.py = d.y; d.pz = d.z;
      if (!owner || !owner.alive) { if (d.state !== 'held') { d.state = 'held'; this.events.push({ type: 'discGone', disc: d.id }); } continue; }
      if (d.temp && d.state !== 'flying') { d.dead = true; this.events.push({ type: 'discGone', disc: d.id, x: d.x, y: d.y, z: d.z }); continue; }
      if (d.state === 'held') { d.x = owner.x; d.y = owner.y + 1.2; d.z = owner.z; continue; }
      d.age += dt;
      if (d.state === 'returning') {
        const tx = owner.x - d.x, ty = owner.y + 1.3 - d.y, tz = owner.z - d.z, l = Math.hypot(tx, ty, tz);
        if (l < 0.8 || l < RETURN_SPEED * dt) { d.state = 'held'; d.team = owner.team; d.parried = false; d.amped = false; this.events.push({ type: 'catch', id: owner.id, disc: d.id }); continue; }
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
        // the core: its shell turns a disc away except through the rotating gap; through the gap, the core takes the hit
        let coreHit = false;
        if (this.core) {
          // the shell is only tested on the way in; a disc that came through the gap may reach the core several steps later
          const c = this.core, ts = DiscSim.sphereT(d.x, d.y, d.z, ex, ey, ez, c.x, c.y, c.z, CORE_SHELL + DISC_R); let blocked = false;
          if (ts >= 0 && ts < tHit) {
            const sx = d.x + (ex - d.x) * ts - c.x, sy = d.y + (ey - d.y) * ts - c.y, sz = d.z + (ez - d.z) * ts - c.z, az = Math.atan2(sz, sx);
            let rel = az - c.rot; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
            if (Math.abs(rel) >= c.gap / 2 || Math.abs(sy) >= CORE_SHELL * 0.8) { const l = CORE_SHELL + DISC_R; tHit = ts; nx = sx / l; ny = sy / l; nz = sz / l; kind = 'shell'; bHit = null; blocked = true; }
          }
          if (!blocked) { const tc = DiscSim.sphereT(d.x, d.y, d.z, ex, ey, ez, c.x, c.y, c.z, CORE_R + DISC_R); if (tc >= 0 && tc < tHit) { tHit = tc; coreHit = true; bHit = null; } }
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
        if (coreHit) {
          const c = this.core!; d.state = 'returning';
          if (d.team === 0 && c.hp > 0) { c.hp--; c.flash = 0.4; this.raiseRally(0.1); this.addScore(120, 'Core hit'); this.events.push({ type: 'coreHit', hp: c.hp, max: c.max, x: d.x, y: d.y, z: d.z }); if (c.hp <= 0) this.coreDown(); }
          break;
        }
        if (tHit >= 1) break;
        // an arc blade cuts a destructible barrier down and carries on through it; everything else ricochets
        const cut = d.weapon === 'arc' && !!bHit && bHit.def.hp > 0;
        const dot = d.vx * nx + d.vy * ny + d.vz * nz;
        if (!cut) {
          d.vx = (d.vx - 2 * dot * nx) * (1 - ENERGY_LOSS); d.vy = (d.vy - 2 * dot * ny) * (1 - ENERGY_LOSS); d.vz = (d.vz - 2 * dot * nz) * (1 - ENERGY_LOSS);
          d.x += nx * 0.01; d.y += ny * 0.01; d.z += nz * 0.01;
        } else { d.x -= nx * 0.01; d.y -= ny * 0.01; d.z -= nz * 0.01; }
        if (!cut) d.bounces++; remaining *= 1 - tHit;
        this.events.push({ type: 'bounce', disc: d.id, kind, cut, x: d.x, y: d.y, z: d.z, nx, ny, nz, team: d.team, weapon: d.weapon });
        // a lance does not ricochet: it spends itself where it lands
        if (d.weapon === 'lance') { d.state = 'returning'; this.events.push({ type: 'spent', disc: d.id }); }
        // an arc blade cuts a destructible barrier down in one pass instead of chipping it
        if (bHit && bHit.def.hp > 0) { bHit.hp -= d.weapon === 'arc' ? bHit.def.hp : 1; bHit.flash = 0.25; if (bHit.hp <= 0) this.breakBarrier(bHit, d.team); }
        if (kind === 'platform') this.strikeDeck(d);
        if (d.bounces > MAX_BOUNCES) { d.state = 'returning'; this.events.push({ type: 'spent', disc: d.id }); }
      }
      if (d.state === 'flying' && !d.amped) for (const a of this.amps) {
        // crossed the ring's plane this step, inside the hoop
        if ((d.pz - a.z) * (d.z - a.z) > 0 || d.pz === d.z) continue;
        const t = (a.z - d.pz) / (d.z - d.pz), hx = d.px + (d.x - d.px) * t - a.x, hy = d.py + (d.y - d.py) * t - a.y;
        if (hx * hx + hy * hy > a.r * a.r) continue;
        d.amped = true; d.vx *= AMP_SPEED; d.vy *= AMP_SPEED; d.vz *= AMP_SPEED; d.age = Math.min(d.age, 1.2); a.flash = 0.5;
        this.events.push({ type: 'amp', disc: d.id, team: d.team, x: a.x, y: a.y, z: a.z }); break;
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
    // a lance cannot be parried or blocked: the shield turns it aside into a graze, and that is all. Its long wind-up
    // is the tell, so the answer to it is to move, not to hold the shield up.
    if (f.shieldUp && frontal && d.weapon === 'lance') {
      d.hit.add(f.id); f.shield = Math.max(0, f.shield - 18);
      this.events.push({ type: 'pierce', id: f.id, x: d.x, y: d.y, z: d.z });
      this.damage(f, Math.round(DISC_DAMAGE * 0.55), dx, dz, 'disc');
      d.state = 'returning'; return;
    }
    if (f.shieldUp && frontal) {
      d.hit.clear();
      if (f.shieldT < 0.22) {
        // parry: disc is turned against its thrower
        const o = this.fighter(d.owner)!; const tx = o.x - d.x, ty = o.y + 1.2 - d.y, tz = o.z - d.z, tl = Math.hypot(tx, ty, tz) || 1, ns = sp * 1.2;
        d.vx = (tx / tl) * ns; d.vy = (ty / tl) * ns; d.vz = (tz / tl) * ns; d.team = f.team; d.parried = true; d.bounces = 0; d.age = 0; d.homing = 0;
        f.shield = Math.min(f.maxShield, f.shield + 15);
        this.events.push({ type: 'parry', id: f.id, x: d.x, y: d.y, z: d.z });
        if (f.isPlayer) { this.stats.parries++; this.addScore(DISC_POINTS.parry, 'Parry'); this.raiseRally(0.1); }
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
    const mine = d.team === 0 && f.team === 1;
    const dmg = DISC_DAMAGE * (1 + 0.25 * d.bounces) * (d.parried ? 1.3 : 1) * (d.amped ? AMP_DAMAGE : 1) * (mine ? this.rally : 1) * (f.isPlayer && !mine ? this.cfg.enemyDmgMul ?? 1 : 1);
    this.events.push({ type: 'hit', id: f.id, by: d.owner, x: d.x, y: d.y, z: d.z, dx, dz, bounces: d.bounces, parried: d.parried });
    const byPlayer = (owner?.isPlayer && !d.parried) || (d.parried && d.team === 0);
    if (byPlayer && f.team === 1) {
      this.stats.hits++; if (d.bounces > 0) this.stats.ricochetHits++;
      this.combo++; this.comboT = DISC_POINTS.comboWindow; this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
      this.addScore(Math.round(discHitScore(d.bounces, this.combo) * (d.amped ? 1.5 : 1)), d.amped ? 'Amplified hit' : d.bounces > 0 ? `Ricochet ×${d.bounces}` : 'Direct hit'); this.raiseRally(0.07);
    }
    this.damage(f, dmg, dx * 6.5, dz * 6.5, 'disc');
    d.state = 'returning';
  }

  damage(f: Fighter, amount: number, kx: number, kz: number, cause: string) {
    if (!f.alive || f.invuln > 0 && cause !== 'surge') return;
    f.hp -= amount; f.stagger = Math.max(f.stagger, cause === 'surge' ? 0.3 : 0.38); f.kx += kx; f.kz += kz; f.winding = false; f.wind = 0;
    if (f.isPlayer) { this.stats.damageTaken += amount; this.combo = 0; if (this.rally > 1) { this.rally = 1; this.events.push({ type: 'rally', value: 1, broken: true }); } }
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

  /**
   * A disc landing on a breakable deck chips it; an arc blade takes a chunk. A deck is only ever allowed to fail
   * while its side still has somewhere to stand and every remaining deck on that side is still hoppable, so the
   * mechanic can take the floor out from under a fight without ever stranding anyone.
   */
  private strikeDeck(d: Disc) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.platforms.length; i++) {
      const p = this.platforms[i]; if (p.integrity <= 0 || p.gone) continue;
      const dd = (p.x - d.x) ** 2 + (p.z - d.z) ** 2; if (dd < p.r * p.r && dd < bd) { bd = dd; best = i; }
    }
    if (best < 0) return;
    const p = this.platforms[best];
    p.integrity -= d.weapon === 'arc' ? 3 : 1;
    this.events.push({ type: 'deckHit', index: best, left: Math.max(0, p.integrity), x: d.x, y: p.y, z: d.z, team: d.team });
    if (p.integrity > 0 || !this.canDrop(best)) return;
    p.gone = true; p.breakT = 2.0; p.state = 'warn';
    this.events.push({ type: 'platformWarn', index: best, breaking: true });
  }

  /** True when dropping platform `i` leaves its side with at least two decks that are all still reachable. */
  private canDrop(i: number): boolean {
    const side = this.platforms[i].side;
    const live: number[] = [];
    for (let k = 0; k < this.platforms.length; k++) { const q = this.platforms[k]; if (k !== i && q.side === side && !q.gone) live.push(k); }
    if (live.length < 2) return false;
    const reach = (a: number, b: number) => {
      const A = this.platforms[a], B = this.platforms[b];
      return Math.hypot(A.bx - B.bx, A.bz - B.bz) - A.r - B.r <= HOP_GAP && Math.abs(A.by - B.by) <= HOP_RISE;
    };
    const seen = new Set([live[0]]); const q = [live[0]];
    while (q.length) { const a = q.pop()!; for (const b of live) if (!seen.has(b) && reach(a, b)) { seen.add(b); q.push(b); } }
    return seen.size === live.length;
  }

  /**
   * Rivals with an escalation ladder re-arm as the fight wears on: a Vanguard that started throwing discs comes back
   * with lances, then with arc blades. Each step is announced so the player can see the weapon change coming.
   */
  private stepUpgrades() {
    for (const f of this.fighters) {
      const ups = f.arch.upgrades; if (!ups || !f.alive || f.isPlayer) continue;
      const frac = f.hp / f.maxHp;
      let idx = -1; for (let i = 0; i < ups.length; i++) if (frac <= ups[i].hpAbove) idx = i;
      if (idx < 0 || idx <= f.phase) continue;
      f.phase = idx; const u = ups[idx]; const baseArch = ARCHETYPES[f.kind];
      f.arch = { ...baseArch, ...u.over, upgrades: ups, weapon: u.weapon ?? baseArch.weapon };
      this.events.push({ type: 'rearm', id: f.id, name: u.name, weapon: f.arch.weapon ?? 'disc', x: f.x, y: f.y, z: f.z, tint: f.arch.tint });
    }
  }

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
