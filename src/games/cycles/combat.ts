import { Rng, clamp, approach } from '../../engine/math';
import type { SimEvent } from '../../engine/events';
import { CYCLE_POINTS, type CycleStats } from '../../progression/scoring';
import { aiDrive, type CycleAi } from './combatAi';

/** Heading index: 0 = +x, 1 = +z, 2 = -x, 3 = -z. Left turn = dir-1, right turn = dir+1. */
export const DIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export interface CycleIntent { turn: -1 | 0 | 1; accel: number; boost: boolean; ability: boolean; /** disc tiers: hurl a disc straight ahead */ disc?: boolean }
export interface RivalDef { profile: CycleAi['profile']; skill: number; model: string }
export interface CombatConfig {
  half: number; seed: number; speed: number; rivals: readonly RivalDef[]; modifiers: readonly string[];
  pillars: number; aiSkill: number; hazardMul: number; resources: number;
}
/**
 * Jump ramp ('ramps' tiers): riding up it in its launch direction throws the cycle into the air for AIR_TIME seconds.
 * In the air no wall is laid (the trail has a gap, marked by a NaN vertex pair) and walls are flown over; the arena
 * edge and pillars still count, and landing on a wall is a crash, so a jump is both an escape and a gamble.
 */
export interface Ramp { x: number; z: number; dir: number; hw: number; len: number }
export const AIR_TIME = 0.85, AIR_APEX = 3.2;
/**
 * Raised deck ('decks' tiers): a platform DECK_H above the grid in the middle of the arena, reached by jumping onto
 * it from the inward ramps. Walls are laid on the level they are ridden on and only stop riders on that level; riding
 * off a deck edge drops a rider back to the grid (a gap in the trail, like a jump).
 */
export interface Deck { x: number; z: number; hx: number; hz: number }
export const DECK_H = 3.2;
/** Boost arrows: a strip on the approach to a ramp that throws a rider riding along it up to full surge speed. */
export interface Arrow { x: number; z: number; dir: number; hw: number; len: number }
/** A disc thrown along the grid ('discs' tiers): straight, fast, stopped by any wall, fatal to a rider it reaches. */
export interface GridDisc { id: number; owner: number; x: number; z: number; px: number; pz: number; dx: number; dz: number; lvl: number; life: number }
export const CDISC_SPEED = 46, CDISC_COOLDOWN = 7;
/** The ramp's footprint: len along its launch direction, 2 * hw across it. */
export function rampContains(rp: Ramp, x: number, z: number) { const alongX = DIRS[rp.dir][0] !== 0; return Math.abs(x - rp.x) < (alongX ? rp.len / 2 : rp.hw) && Math.abs(z - rp.z) < (alongX ? rp.hw : rp.len / 2); }
/** True for a vertex that marks a gap in a trail (written while a cycle is in the air). */
export const isGap = (v: number) => v !== v;
/** Height of a cycle above the grid, from its time in the air. */
export const airHeight = (c: { airT: number; airDur: number; airFrom: number; airTo: number; lvl: number }) => {
  if (c.airT <= 0) return c.lvl * DECK_H; const u = 1 - c.airT / c.airDur; return c.airFrom + (c.airTo - c.airFrom) * u + 4 * (c.airTo < c.airFrom ? 0.4 : AIR_APEX) * u * (1 - u);
};
/** True when (x, z) is over a deck (with a small margin inward, so a rider is never balanced on the very edge). */
export const onDeck = (d: Deck, x: number, z: number, m = 0) => Math.abs(x - d.x) < d.hx - m && Math.abs(z - d.z) < d.hz - m;
export interface Cycle {
  id: number; isPlayer: boolean; model: string; alive: boolean; /** seconds of flight left after a ramp */ airT: number;
  /** flight shape: total time, start and end height */ airDur: number; airFrom: number; airTo: number;
  /** 0 on the grid, 1 on a raised deck; trailLvl holds the level each trail vertex was laid on */ lvl: number; trailLvl: number[]; discCd: number;
  x: number; z: number; px: number; pz: number; dir: number; speed: number; boost: number; boosting: boolean;
  queue: number[]; sinceTurn: number; turnT: number;
  /** Flat [x,z,...] trail vertices; the live segment runs from the last vertex to (x,z). */
  trail: number[]; trailGone: boolean; deathT: number;
  power: PowerKind | null; phaseT: number; shockT: number; grind: boolean; ion?: boolean;
  ai: CycleAi | null;
}
export type PowerKind = 'phase' | 'purge' | 'shock' | 'boost';
/** Ion lane: a long floor strip. Riding along it (not across) speeds you up and charges boost — for anyone. */
export interface IonLane { x: number; z: number; len: number; hw: number; axis: 0 | 1 }
export interface Obstacle { x: number; z: number; hx: number; hz: number; state: 'solid' | 'warn' | 'off'; t: number; dyn: boolean; kind: 'pillar' | 'pit' }
export interface Pickup { x: number; z: number; kind: PowerKind; alive: boolean; id: number }

const MIN_TURN = 0.9, TRAIL_HW = 0.14, BODY_HW = 0.22;

export class CombatSim {
  readonly cfg: CombatConfig; readonly rng: Rng;
  ramps: Ramp[] = []; arrows: Arrow[] = []; decks: Deck[] = []; discs: GridDisc[] = []; readonly discsOn: boolean; private discId = 1; private rivalDiscT = 8; cycles: Cycle[] = []; obstacles: Obstacle[] = []; pickups: Pickup[] = []; lanes: IonLane[] = []; events: SimEvent[] = [];
  time = 0; state: 'active' | 'won' | 'lost' = 'active';
  half: number; readonly half0: number; readonly gw: number; grid: Uint8Array; stamp: Uint32Array; stampId = 0;
  stats: CycleStats = { trapKills: 0, rivalsDown: 0, grindMeters: 0, nearMisses: 0, time: 0, score: 0, pickups: 0 };
  player!: Cycle;
  private shrinkOn: boolean; private shrinkWarned = false; private powerT = 5; private dynT = 6; private pid = 1; private nearCd = 0;

  constructor(cfg: CombatConfig) {
    this.cfg = cfg; this.rng = new Rng(cfg.seed); this.half = this.half0 = cfg.half; this.gw = Math.ceil(cfg.half * 2);
    this.grid = new Uint8Array(this.gw * this.gw); this.stamp = new Uint32Array(this.gw * this.gw);
    this.shrinkOn = cfg.modifiers.includes('shrink');
    const n = cfg.rivals.length + 1, H = cfg.half;
    // spawn ring: everyone faces inward-ish along an axis with clear run-up
    // classic face-off: player at one end, rivals at the other on offset lanes (never a head-on lane)
    const spots: [number, number, number][] = [[0, H * 0.72, 3]];
    for (let i = 0; i < cfg.rivals.length; i++) { const lane = (i % 2 ? 1 : -1) * (H * 0.16 + Math.floor(i / 2) * H * 0.2); spots.push([Math.round(lane), -H * 0.72, 1]); }
    for (let i = 0; i < n; i++) {
      const [x, z, dir] = spots[i % spots.length]; const r = i === 0 ? null : cfg.rivals[i - 1];
      const c: Cycle = { id: i + 1, isPlayer: i === 0, model: r ? r.model : 'azure', alive: true, airT: 0, airDur: AIR_TIME, airFrom: 0, airTo: 0, lvl: 0, trailLvl: [], discCd: i === 0 ? 0 : 6 + i, x, z, px: x, pz: z, dir, speed: cfg.speed * 0.6, boost: i === 0 ? clamp(0.6 * cfg.resources, 0, 1) : 0.5, boosting: false, queue: [], sinceTurn: 99, turnT: 1, trail: [x, z], trailGone: false, deathT: 0, power: null, phaseT: 0, shockT: 0, grind: false, ai: null };
      if (r) c.ai = { profile: r.profile, skill: clamp(r.skill + cfg.aiSkill, 0.05, 1), thinkT: this.rng.range(0, 0.1), slot: i, lastTurn: 0, intent: { turn: 0, accel: 0, boost: false, ability: false } };
      this.cycles.push(c);
    }
    this.player = this.cycles[0];
    for (const c of this.cycles) c.trailLvl = c.trail.map(() => 0).slice(0, c.trail.length / 2);
    this.discsOn = cfg.modifiers.includes('discs');
    // raised deck: a square in the middle, with four ramps facing it from the four sides
    if (cfg.modifiers.includes('decks')) {
      const hs = Math.round(H * 0.2), off = hs + 9; this.decks.push({ x: 0, z: 0, hx: hs, hz: hs });
      // no arrows on these: at surge speed a rider would fly clean over the deck
      for (const [rx, rz, dir] of [[-off, 3, 0], [off, -3, 2], [3, off, 3], [-3, -off, 1]] as const) this.ramps.push({ x: rx, z: rz, dir, hw: 2.6, len: 6 });
    }
    // jump ramps: a pinwheel of four round the centre, each launching along the circle, clear of the spawn lanes
    if (cfg.modifiers.includes('ramps')) { const o = Math.round(H * 0.42); this.ramps.push({ x: o, z: o, dir: 2, hw: 2.6, len: 6 }, { x: -o, z: o, dir: 3, hw: 2.6, len: 6 }, { x: -o, z: -o, dir: 0, hw: 2.6, len: 6 }, { x: o, z: -o, dir: 1, hw: 2.6, len: 6 });
      for (const rp of this.ramps.slice(-4)) { const [ddx, ddz] = DIRS[rp.dir]; this.arrows.push({ x: rp.x - ddx * 9, z: rp.z - ddz * 9, dir: rp.dir, hw: 2.2, len: 9 }); } }
    // ion lanes: a cross of fast strips (offset so they do not run down the spawn lanes)
    if (cfg.modifiers.includes('ion-lanes')) { const o = Math.round(H * 0.34); this.lanes.push({ x: 0, z: o, len: H * 0.82, hw: 2.2, axis: 0 }, { x: 0, z: -o, len: H * 0.82, hw: 2.2, axis: 0 }); if (cfg.modifiers.includes('ion-grid')) this.lanes.push({ x: o + 6, z: 0, len: H * 0.6, hw: 2.2, axis: 1 }, { x: -o - 6, z: 0, len: H * 0.6, hw: 2.2, axis: 1 }); }
    // static pillars, kept clear of spawn lanes
    for (let i = 0; i < cfg.pillars; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const x = Math.round(this.rng.range(-H * 0.8, H * 0.8)), z = Math.round(this.rng.range(-H * 0.8, H * 0.8)), hx = this.rng.int(2, 5), hz = this.rng.int(2, 5);
        if (this.clearOfSpawns(x, z, hx + 8, hz + 8) && !this.obstacles.some((o) => Math.abs(o.x - x) < o.hx + hx + 6 && Math.abs(o.z - z) < o.hz + hz + 6)) { this.addObstacle({ x, z, hx, hz, state: 'solid', t: 0, dyn: false, kind: 'pillar' }); break; }
      }
    }
  }

  private clearOfSpawns(x: number, z: number, hx: number, hz: number) {
    for (const c of this.cycles) { const [dx, dz] = DIRS[c.dir]; for (let s = 0; s <= 40; s += 4) if (Math.abs(c.x + dx * s - x) < hx && Math.abs(c.z + dz * s - z) < hz) return false; }
    return true;
  }
  private addObstacle(o: Obstacle) { this.obstacles.push(o); if (o.state === 'solid') this.fill(o, 255); }
  private fill(o: Obstacle, v: number) { for (let x = Math.floor(o.x - o.hx); x < Math.ceil(o.x + o.hx); x++) for (let z = Math.floor(o.z - o.hz); z < Math.ceil(o.z + o.hz); z++) { const i = this.cell(x, z); if (i >= 0 && (v !== 0 || this.grid[i] === 255)) this.grid[i] = v; } }

  cell(x: number, z: number) { const gx = Math.floor(x + this.half0), gz = Math.floor(z + this.half0); return gx < 0 || gz < 0 || gx >= this.gw || gz >= this.gw ? -1 : gz * this.gw + gx; }
  /** Occupancy lookup shared by AI and HUD: true when the 1 m cell is blocked or outside the live boundary. */
  solid(x: number, z: number) { if (Math.abs(x) >= this.half - 0.4 || Math.abs(z) >= this.half - 0.4) return true; const i = this.cell(x, z); return i < 0 || this.grid[i] !== 0; }
  freeDist(x: number, z: number, dir: number, max: number) { const [dx, dz] = DIRS[dir]; for (let s = 1; s <= max; s++) if (this.solid(x + dx * s, z + dz * s)) return s - 1; return max; }
  aliveRivals() { let n = 0; for (const c of this.cycles) if (!c.isPlayer && c.alive) n++; return n; }

  step(dt: number, intent: CycleIntent) {
    // finished: freeze in place (prev = current), or the view keeps blending between the last two steps and everything shakes
    if (this.state !== 'active') { for (const c of this.cycles) { c.px = c.x; c.pz = c.z; } return; }
    this.time += dt; this.stats.time = this.time; this.nearCd -= dt;
    this.stepArena(dt);
    for (const c of this.cycles) {
      if (!c.alive) { if (!c.trailGone && this.time - c.deathT > 1.3) { c.trailGone = true; for (let i = 0; i < this.grid.length; i++) if (this.grid[i] === c.id) this.grid[i] = 0; this.events.push({ type: 'trailGone', id: c.id }); } continue; }
      this.stepCycle(c, c.isPlayer ? intent : aiDrive(this, c, dt), dt);
    }
    if (this.discsOn) this.stepGridDiscs(dt);
    // head-on contact
    for (let i = 0; i < this.cycles.length; i++) for (let j = i + 1; j < this.cycles.length; j++) { const a = this.cycles[i], b = this.cycles[j]; if (a.alive && b.alive && a.phaseT <= 0 && b.phaseT <= 0 && a.airT <= 0 && b.airT <= 0 && a.lvl === b.lvl && Math.abs(a.x - b.x) < 0.9 && Math.abs(a.z - b.z) < 0.9) { this.crash(a, 'head', b.id); this.crash(b, 'head', a.id); } }
    if (!this.player.alive) { this.state = 'lost'; this.events.push({ type: 'lose' }); }
    else if (this.aliveRivals() === 0) { this.state = 'won'; this.events.push({ type: 'win' }); }
  }

  /** Every trail vertex goes through here, so the level it was laid on is always recorded beside it. */
  private vtx(c: Cycle, x: number, z: number) { c.trail.push(x, z); c.trailLvl.push(c.lvl); }
  private stepCycle(c: Cycle, it: CycleIntent, dt: number) {
    c.px = c.x; c.pz = c.z; c.turnT += dt;
    if (it.turn !== 0 && c.queue.length < 2) c.queue.push(it.turn);
    if (c.queue.length && c.sinceTurn >= MIN_TURN && c.airT <= 0) {
      const t = c.queue.shift()!, prev = c.dir; this.vtx(c, c.x, c.z); c.dir = (c.dir + t + 4) % 4; c.sinceTurn = 0; c.turnT = 0; this.noteTurn(c, prev);
      this.events.push({ type: 'turn', id: c.id, dir: c.dir, turn: t, x: c.x, z: c.z });
    }
    c.phaseT = Math.max(0, c.phaseT - dt); c.shockT = Math.max(0, c.shockT - dt);
    if (it.ability && c.power) this.usePower(c);
    // tactical speed control
    const canBoost = it.boost && c.boost > 0.02;
    if (canBoost !== c.boosting) { c.boosting = canBoost; this.events.push({ type: 'boost', id: c.id, on: canBoost }); }
    if (c.boosting) c.boost = Math.max(0, c.boost - 0.46 * dt); else c.boost = Math.min(1, c.boost + 0.06 * dt);
    let ion = false; for (const ln of this.lanes) if (c.dir % 2 === ln.axis && (ln.axis === 0 ? Math.abs(c.z - ln.z) < ln.hw && Math.abs(c.x - ln.x) < ln.len : Math.abs(c.x - ln.x) < ln.hw && Math.abs(c.z - ln.z) < ln.len)) ion = true;
    if (ion !== c.ion) { c.ion = ion; if (c.isPlayer) this.events.push({ type: 'ion', on: ion }); }
    if (ion) c.boost = Math.min(1, c.boost + 0.22 * dt);
    const target = this.cfg.speed * (it.accel > 0.2 ? 1.28 : it.accel < -0.2 ? 0.66 : 1) * (c.boosting ? 1.8 : 1) * (c.shockT > 0 ? 0.6 : 1) * (ion ? 1.35 : 1);
    c.speed = approach(c.speed, target, 34 * dt);
    const [dx, dz] = DIRS[c.dir]; const dist = c.speed * dt;
    const nx = c.x + dx * dist, nz = c.z + dz * dist;
    // ramps: up one in its launch direction and the cycle leaves the grid; the trail breaks here and resumes on landing
    // boost arrows: riding along one throws the rider up to full surge speed (the jump off the ramp after it goes further)
    if (c.airT <= 0 && c.lvl === 0) for (const ar of this.arrows) if (ar.dir === c.dir && rampContains(ar, nx, nz)) { const surge = this.cfg.speed * 1.75; if (c.speed < surge - 1) { c.speed = surge; this.events.push({ type: 'arrow', id: c.id, x: nx, z: nz, player: c.isPlayer }); } break; }
    const takeoff = (dur: number, from: number, to: number, kind: string) => { c.airT = c.airDur = dur; c.airFrom = from; c.airTo = to; c.queue.length = 0; this.vtx(c, c.x, c.z); this.vtx(c, NaN, NaN); this.events.push({ type: kind, id: c.id, x: c.x, z: c.z, player: c.isPlayer }); };
    if (c.airT <= 0 && c.lvl === 0) for (const rp of this.ramps) if (rp.dir === c.dir && rampContains(rp, nx, nz)) {
      // flight time grows with speed: off the arrows a rider flies about half as far again
      const dur = AIR_TIME * clamp(c.speed / this.cfg.speed, 0.85, 1.6), lx = c.x + DIRS[c.dir][0] * c.speed * dur, lz = c.z + DIRS[c.dir][1] * c.speed * dur;
      takeoff(dur, 0, this.decks.some((d) => onDeck(d, lx, lz, 0.6)) ? DECK_H : 0, 'jump'); break;
    }
    // off the edge of a deck: a short drop back to the grid
    if (c.airT <= 0 && c.lvl === 1 && !this.decks.some((d) => onDeck(d, nx, nz))) { takeoff(0.5, DECK_H, 0, 'drop'); c.lvl = 0; }
    if (c.airT > 0) { c.airT -= dt; if (c.airT <= 0) { c.airT = 0; c.lvl = c.airTo > 0 && this.decks.some((d) => onDeck(d, nx, nz)) ? 1 : 0; if (c.airTo > 0 && c.lvl === 0) c.airTo = 0; c.trail.push(nx, nz); c.trailLvl.push(c.lvl); c.sinceTurn = 0; this.events.push({ type: 'land', id: c.id, x: nx, z: nz, player: c.isPlayer, deck: c.lvl === 1 }); } }
    // continuous (swept) collision of the travelled segment
    const cause = this.sweep(c, c.x, c.z, nx, nz);
    c.x = nx; c.z = nz; c.sinceTurn += dist;
    if (cause) { this.crash(c, cause.kind, cause.by); return; }
    const ci = this.cell(c.x, c.z); if (ci >= 0 && this.grid[ci] === 0 && c.airT <= 0 && c.lvl === 0) this.grid[ci] = c.id;
    if (this.discsOn) { c.discCd = Math.max(0, c.discCd - dt); if (c.isPlayer ? it.disc : this.rivalWantsDisc(c)) this.throwGridDisc(c); }
    // wall-riding: hugging a wall within ~2 m charges boost and scores
    const l = (c.dir + 3) % 4, r = (c.dir + 1) % 4; let grind = false;
    for (const sd of [l, r]) { const [sx, sz] = DIRS[sd]; if (this.solid(c.x + sx * 1.2, c.z + sz * 1.2) || this.solid(c.x + sx * 2.2, c.z + sz * 2.2)) grind = true; }
    if (grind !== c.grind) { c.grind = grind; if (c.isPlayer) this.events.push({ type: 'grind', on: grind }); }
    if (grind) { c.boost = Math.min(1, c.boost + 0.2 * dt); if (c.isPlayer) { this.stats.grindMeters += dist; this.stats.score += dist * CYCLE_POINTS.grindPerMeter; } }
    for (const p of this.pickups) if (p.alive && Math.abs(p.x - c.x) < 2.6 && Math.abs(p.z - c.z) < 2.6) {
      p.alive = false; if (p.kind === 'boost') c.boost = 1; else c.power = p.kind;
      if (c.isPlayer) { this.stats.pickups++; this.stats.score += 50; }
      this.events.push({ type: 'pickup', id: c.id, kind: p.kind, pid: p.id, x: p.x, z: p.z });
    }
  }

  // ---------------------------------------------------------------- discs along the grid
  /** A rival throws when the player is in front of it, within 45 m, close to its line, and its turn has come round. */
  private rivalWantsDisc(c: Cycle) {
    const P = this.player; if (c.discCd > 0 || this.rivalDiscT > 0 || !P.alive || P.lvl !== c.lvl || this.time < 5) return false;
    const [dx, dz] = DIRS[c.dir], rx = P.x - c.x, rz = P.z - c.z, along = rx * dx + rz * dz, across = Math.abs(rx * dz - rz * dx);
    return along > 6 && along < 45 && across < 3 + along * 0.08;
  }
  throwGridDisc(c: Cycle) {
    if (c.discCd > 0 || !c.alive || c.airT > 0) return; c.discCd = c.isPlayer ? CDISC_COOLDOWN : 9; if (!c.isPlayer) this.rivalDiscT = 5 / Math.max(0.7, this.cfg.hazardMul);
    const [dx, dz] = DIRS[c.dir]; const d: GridDisc = { id: this.discId++, owner: c.id, x: c.x + dx * 1.6, z: c.z + dz * 1.6, px: c.x, pz: c.z, dx, dz, lvl: c.lvl, life: 2.2 };
    this.discs.push(d); this.events.push({ type: 'cdiscThrow', id: c.id, disc: d.id, x: d.x, z: d.z, player: c.isPlayer, atPlayer: !c.isPlayer });
  }
  private stepGridDiscs(dt: number) {
    this.rivalDiscT = Math.max(0, this.rivalDiscT - dt);
    for (const d of this.discs) {
      d.life -= dt; d.px = d.x; d.pz = d.z; const nx = d.x + d.dx * CDISC_SPEED * dt, nz = d.z + d.dz * CDISC_SPEED * dt;
      // walls on its own level stop it (yours included: a wall is also a shield), and so do the arena edge and pillars
      // riders first: a rider's own wall starts at its body, so a disc that reaches the rider this step hits the rider,
      // not the wall just behind it
      let victim: Cycle | null = null;
      for (const o of this.cycles) {
        if (!o.alive || o.id === d.owner || o.airT > 0 || o.lvl !== d.lvl || o.phaseT > 0) continue;
        const along = (o.x - d.x) * d.dx + (o.z - d.z) * d.dz, across = Math.abs((o.x - d.x) * d.dz - (o.z - d.z) * d.dx);
        if (along > -1.1 && along < CDISC_SPEED * dt + 1.1 && across < 1.1) { victim = o; break; }
      }
      if (victim) { d.life = 0; d.x = victim.x; d.z = victim.z; this.events.push({ type: 'cdiscHit', id: victim.id, by: d.owner, disc: d.id, x: victim.x, z: victim.z, player: victim.isPlayer }); this.crash(victim, 'disc', d.owner); continue; }
      const hitWall = Math.abs(nx) > this.half - 0.4 || Math.abs(nz) > this.half - 0.4 || this.segBlocked(d.x, d.z, nx, nz, d.lvl);
      if (hitWall) { d.life = 0; this.events.push({ type: 'cdiscSpent', disc: d.id, x: d.x, z: d.z }); continue; }
      d.x = nx; d.z = nz;
      if (d.life <= 0 && !(this.events as any[]).some((e) => e.disc === d.id)) this.events.push({ type: 'cdiscSpent', disc: d.id, x: d.x, z: d.z });
    }
    if (this.discs.some((d) => d.life <= 0)) this.discs = this.discs.filter((d) => d.life > 0);
  }
  /** True when the segment crosses a solid obstacle or any trail laid on the given level. */
  private segBlocked(x0: number, z0: number, x1: number, z1: number, lvl: number) {
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), minz = Math.min(z0, z1), maxz = Math.max(z0, z1), e = TRAIL_HW + 0.2;
    if (lvl === 0) for (const o of this.obstacles) if (o.state === 'solid' && maxx > o.x - o.hx && minx < o.x + o.hx && maxz > o.z - o.hz && minz < o.z + o.hz) return true;
    for (const o of this.cycles) {
      if (o.trailGone) continue; const t = o.trail, segs = t.length / 2;
      for (let i = 0; i < segs; i++) {
        const ax = t[i * 2], az = t[i * 2 + 1]; let bx: number, bz: number;
        if (i + 1 < segs) { bx = t[i * 2 + 2]; bz = t[i * 2 + 3]; } else { if (o.airT > 0 || !o.alive) continue; bx = o.x; bz = o.z; }
        if (isGap(ax) || isGap(bx) || (o.trailLvl[i] ?? 0) !== lvl) continue;
        if (maxx > Math.min(ax, bx) - e && minx < Math.max(ax, bx) + e && maxz > Math.min(az, bz) - e && minz < Math.max(az, bz) + e) return true;
      }
    }
    return false;
  }
  /** Registers a close call when the player turns with a wall very near ahead. */
  private noteTurn(c: Cycle, prevDir: number) {
    if (!c.isPlayer || this.nearCd > 0) return;
    if (this.freeDist(c.x, c.z, prevDir, 4) <= 2) { this.nearCd = 1.5; this.stats.nearMisses++; this.stats.score += CYCLE_POINTS.boostNearMiss; c.boost = Math.min(1, c.boost + 0.12); this.events.push({ type: 'nearMiss' }); }
  }

  private sweep(c: Cycle, x0: number, z0: number, x1: number, z1: number): { kind: string; by: number } | null {
    if (Math.abs(x1) > this.half - 0.35 || Math.abs(z1) > this.half - 0.35) return { kind: 'wall', by: 0 };
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), minz = Math.min(z0, z1), maxz = Math.max(z0, z1);
    for (const o of this.obstacles) if (o.state === 'solid' && maxx > o.x - o.hx - BODY_HW && minx < o.x + o.hx + BODY_HW && maxz > o.z - o.hz - BODY_HW && minz < o.z + o.hz + BODY_HW) return { kind: o.kind, by: 0 };
    if (c.phaseT > 0 || c.airT > 0) return null;
    const e = TRAIL_HW + BODY_HW;
    for (const o of this.cycles) {
      if (o.trailGone) continue;
      const t = o.trail, own = o === c; const segs = t.length / 2; // segment i: vertex i -> vertex i+1 (or live head)
      const last = own ? segs - 2 : segs;
      for (let i = 0; i < last; i++) {
        const ax = t[i * 2], az = t[i * 2 + 1]; let bx: number, bz: number;
        if (i + 1 < segs) { bx = t[i * 2 + 2]; bz = t[i * 2 + 3]; } else { if (o.airT > 0) continue; bx = o.alive ? o.px : o.x; bz = o.alive ? o.pz : o.z; }
        if (isGap(ax) || isGap(bx) || (o.trailLvl[i] ?? 0) !== c.lvl) continue;
        if (maxx > Math.min(ax, bx) - e && minx < Math.max(ax, bx) + e && maxz > Math.min(az, bz) - e && minz < Math.max(az, bz) + e) return { kind: 'trail', by: o.id };
      }
    }
    return null;
  }

  private crash(c: Cycle, kind: string, by: number) {
    if (!c.alive) return; c.alive = false; c.deathT = this.time; if (c.airT <= 0) this.vtx(c, c.x, c.z); c.boosting = false;
    this.events.push({ type: 'crash', id: c.id, kind, by, x: c.x, z: c.z, dir: c.dir, player: c.isPlayer, speed: c.speed });
    if (!c.isPlayer) {
      this.stats.rivalsDown++;
      if (by === this.player.id && kind === 'trail') { this.stats.trapKills++; this.stats.score += CYCLE_POINTS.trapKill; this.events.push({ type: 'trap', id: c.id }); }
      else this.stats.score += CYCLE_POINTS.rivalDown;
      if (this.aliveRivals() === 1 && this.player.alive) this.events.push({ type: 'lastEnemy' });
    }
  }

  private usePower(c: Cycle) {
    const k = c.power!; c.power = null;
    if (k === 'phase') c.phaseT = 1.3;
    else if (k === 'purge') { c.trail = [c.x, c.z]; c.trailLvl = [c.lvl]; for (let i = 0; i < this.grid.length; i++) if (this.grid[i] === c.id) this.grid[i] = 0; }
    else if (k === 'shock') for (const o of this.cycles) if (o !== c && o.alive && Math.hypot(o.x - c.x, o.z - c.z) < 45) o.shockT = 3;
    this.events.push({ type: 'power', id: c.id, kind: k, x: c.x, z: c.z });
  }

  private stepArena(dt: number) {
    const hz = this.cfg.hazardMul, H0 = this.half0;
    if (this.shrinkOn) {
      const start = 14 / hz;
      if (!this.shrinkWarned && this.time > start - 3) { this.shrinkWarned = true; this.events.push({ type: 'shrinkWarn' }); }
      if (this.time > start) this.half = Math.max(H0 * 0.45, this.half - 1.1 * hz * dt);
    }
    if (this.cfg.modifiers.includes('power-ups')) {
      this.powerT -= dt;
      if (this.powerT <= 0 && this.pickups.filter((p) => p.alive).length < 4) {
        this.powerT = this.rng.range(5, 8);
        for (let tries = 0; tries < 20; tries++) { const x = Math.round(this.rng.range(-this.half * 0.8, this.half * 0.8)), z = Math.round(this.rng.range(-this.half * 0.8, this.half * 0.8)); if (!this.solid(x, z) && !this.solid(x + 2, z) && !this.solid(x - 2, z) && !this.solid(x, z + 2) && !this.solid(x, z - 2)) { const p: Pickup = { x, z, kind: this.rng.pick(['phase', 'purge', 'shock', 'boost'] as const), alive: true, id: this.pid++ }; this.pickups.push(p); this.events.push({ type: 'pickupSpawn', pid: p.id, kind: p.kind, x, z }); break; } }
      }
    }
    // telegraphed dynamic geometry (rising pillars / collapsing floor)
    const dyn = this.cfg.modifiers.includes('anomaly') ? 'pillar' : this.cfg.modifiers.includes('collapse') ? 'pit' : null;
    if (dyn) {
      this.dynT -= dt * hz;
      if (this.dynT <= 0) {
        this.dynT = this.rng.range(3.5, 5.5);
        for (let tries = 0; tries < 20; tries++) {
          const hx = this.rng.int(3, 7), hzz = this.rng.int(3, 7), x = Math.round(this.rng.range(-this.half + hx + 4, this.half - hx - 4)), z = Math.round(this.rng.range(-this.half + hzz + 4, this.half - hzz - 4));
          if (this.cycles.every((c) => !c.alive || Math.abs(c.x - x) > hx + 14 || Math.abs(c.z - z) > hzz + 14) && !this.obstacles.some((o) => o.state !== 'off' && Math.abs(o.x - x) < o.hx + hx + 3 && Math.abs(o.z - z) < o.hz + hzz + 3)) { const o: Obstacle = { x, z, hx, hz: hzz, state: 'warn', t: 2.4, dyn: true, kind: dyn }; this.obstacles.push(o); this.events.push({ type: 'obstacleWarn', index: this.obstacles.length - 1 }); break; }
        }
      }
      for (let i = 0; i < this.obstacles.length; i++) {
        const o = this.obstacles[i]; if (!o.dyn || o.state === 'off') continue; o.t -= dt;
        if (o.state === 'warn' && o.t <= 0) {
          // never materialise on top of a rider: extend the warning instead
          if (this.cycles.some((c) => c.alive && Math.abs(c.x - o.x) < o.hx + 3 && Math.abs(c.z - o.z) < o.hz + 3)) { o.t = 0.4; continue; }
          o.state = 'solid'; o.t = this.rng.range(9, 14); this.fill(o, 255); this.events.push({ type: 'obstacleUp', index: i });
        } else if (o.state === 'solid' && o.t <= 0) { o.state = 'off'; this.fill(o, 0); this.events.push({ type: 'obstacleDown', index: i }); }
      }
    }
  }
}
