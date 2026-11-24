import { Rng, approach, clamp, lerp, wrapAngle } from '../../engine/math';
import type { SimEvent } from '../../engine/events';
import type { RaceStats } from '../../progression/scoring';
import { lateral, nearestIdx, trackPoint, wrapIdx, type Track } from './track';

export type RaceFormat = 'circuit' | 'sprint' | 'elimination' | 'timetrial' | 'pursuit' | 'gauntlet';
export interface VehicleStats { top: number; accel: number; handling: number }
export const VEHICLES: Record<string, VehicleStats & { label: string; blurb: string }> = {
  azure: { label: 'Azure Mk I', blurb: 'Balanced all-rounder', top: 62, accel: 26, handling: 1 },
  jade: { label: 'Jade Lancer', blurb: 'Sharper handling, lower top end', top: 59.5, accel: 25, handling: 1.15 },
  ember: { label: 'Ember Rush', blurb: 'Explosive acceleration', top: 61, accel: 31, handling: 0.97 },
  violet: { label: 'Violet Apex', blurb: 'Highest top speed, heavy steering', top: 66, accel: 23, handling: 0.9 },
  argon: { label: 'Argon Runner', blurb: 'Light chassis, quick direction changes', top: 60.5, accel: 28, handling: 1.1 },
  moto: { label: 'Moto Bulk', blurb: 'Heavy: hard to shove, slow to turn', top: 63, accel: 24, handling: 0.84 },
  // Every machine has to give something up: Agile corners best and is the slowest in a straight line, Flynn's is
  // near the top end but lazy to turn and slow to build speed. Without the trade they were simply upgrades, and the
  // field they were dropped into got quicker across the board.
  agile: { label: 'Agile', blurb: 'Corners best on the grid, slowest down a straight', top: 57.5, accel: 27, handling: 1.2 },
  flynn: { label: "Flynn's", blurb: 'Big top end, heavy steering and a slow build', top: 64.5, accel: 23.5, handling: 0.88 },
};
export interface RaceIntent { steer: number; accel: number; brake: number; boost: boolean; ability: boolean; /** rivals only: fire a stun pulse */ pulse?: boolean }
export interface RaceRival { skill: number; model: string }
export interface RaceConfig {
  track: Track; seed: number; laps: number; format: RaceFormat; rivals: readonly RaceRival[]; modifiers: readonly string[];
  aiSkill: number; hazardMul: number; resources: number; passPlace: number; playerModel: string; hazards: number; pads: number;
}
export interface Racer {
  id: number; isPlayer: boolean; model: string; veh: VehicleStats; skill: number;
  x: number; y: number; z: number; px: number; py: number; pz: number; h: number; ph: number; vx: number; vz: number; speed: number; steer: number;
  idx: number; d: number; lap: number; cp: number; progress: number; place: number;
  boost: number; boosting: boolean; drifting: boolean; driftT: number; slip: number; stun: number; scrape: boolean; pulseCd: number;
  finished: boolean; finishT: number; out: boolean; integrity: number; slow: boolean; draft: boolean; intent: RaceIntent;
  /** Light-wall events: seconds of wall still to lay, cooldown, and where the last piece ended. */ wallT: number; wallCd: number; wx: number; wz: number;
  /** Ramming: time left as a shoved rider, and the sideways shove still carrying it. */ shoveT: number; shx: number; shz: number; /** grace after being walled or rammed, so a rider is never chain-stalled */ graceT: number;
  /** Taken down (derezzed on a wall or thrown off the road): seconds until this rider re-forms on the track. */ downT: number; /** Catch-up pacing: above 1 while a rival trails the player, a touch below while it leads. */ pace: number;
}
/** One piece of light wall laid behind a racer. It destroys rivals that ride into it and stuns the player. */
export interface WallSeg { owner: number; x0: number; z0: number; x1: number; z1: number; y: number; until: number }
export const WALL_LAY = 1.8, WALL_LIFE = 4.5, WALL_COOLDOWN = 8;
/** Owner id of a barrier dropped by the interceptor: no rider has it, so it is live for the whole field. */
export const INTERCEPTOR_ID = 0;
/**
 * Air interceptor: a light jet that shadows the circuit, runs down the leader and drops a hardlight barrier across
 * part of the lane ahead of it. The barrier is an ordinary light wall owned by nobody, so every rider has to read it
 * and go round. `lead` is how far ahead of its target the run is laid, in metres.
 */
export interface Interceptor { idx: number; d: number; y: number; x: number; z: number; target: number; cd: number; runT: number; lead: number }
export interface Hazard { idx: number; d: number; r: number; amp: number; w: number; phase: number; x: number; y: number; z: number }
export interface Pad { i0: number; i1: number; d: number; hw: number }
/** Charge gate: a hoop over part of the lane. Riding through it recharges your light wall at once. */
export interface ChargeGate { idx: number; d: number; r: number; flash: number }
export interface SlowZone { i0: number; i1: number }

const RACER_R = 0.85;
const pt = { x: 0, y: 0, z: 0 };

export class RaceSim {
  readonly cfg: RaceConfig; readonly rng: Rng; readonly track: Track;
  /** True in light-wall events: the ability lays a wall instead of firing a pulse. */ readonly lightwalls: boolean; walls: WallSeg[] = [];
  /** True where a rider at super speed can shove another off line; shoved into a rail or a wall, a rival is destroyed. */ readonly ramming: boolean;
  racers: Racer[] = []; hazards: Hazard[] = []; pads: Pad[] = []; gates: ChargeGate[] = []; slows: SlowZone[] = []; events: SimEvent[] = [];
  /** Present on tiers with the 'interceptor' modifier. */ jet: Interceptor | null = null;
  time = 0; state: 'active' | 'won' | 'lost' = 'active'; checkpoints: number[] = []; parTime: number;
  stats: RaceStats = { place: 1, field: 1, time: 0, parTime: 0, overtakes: 0, cleanSections: 0, sections: 0, scrapes: 0, driftMeters: 0, bestLap: 0, takedowns: 0 };
  /** The field shares one rhythm for laying walls, so a rider in the pack is not walled over and over. */ private rivalWallAt = 0;
  player!: Racer; elimT = 0; elimEvery = 0; private lapStart = 0; private sectorClean = true; private endT = -1; private lastPlace = 0;

  constructor(cfg: RaceConfig) {
    this.cfg = cfg; this.rng = new Rng(cfg.seed); const t = (this.track = cfg.track); // every race against other riders has the light wall; later tiers add ramming
    const hasJet = cfg.modifiers.includes('interceptor');
    // the interceptor drops light walls, so wall simulation is on for its events even where no rider carries one.
    // 'no-walls' turns them off for events that are meant to be a clean speed contest.
    this.lightwalls = hasJet || (cfg.rivals.length > 0 && cfg.format !== 'timetrial' && cfg.format !== 'gauntlet' && !cfg.modifiers.includes('no-walls'));
    this.ramming = this.lightwalls && cfg.rivals.length > 0 && cfg.modifiers.includes('ramming');
    if (hasJet) this.jet = { idx: 0, d: 0, y: 0, x: 0, z: 0, target: 0, cd: 7, runT: 0, lead: 95 };
    const solo = cfg.format === 'timetrial' || cfg.format === 'gauntlet';
    const rivals = solo ? [] : cfg.rivals;
    const n = rivals.length + 1;
    // starting grid: two columns behind the line, player at the back of the grid
    for (let i = 0; i < n; i++) {
      const isPlayer = i === n - 1, r = isPlayer ? null : rivals[i];
      const row = Math.floor(i / 2), col = i % 2 ? 1 : -1; let idx = wrapIdx(t, (t.closed ? t.n : 0) - 4 - row * 4 + (t.closed ? 0 : 20));
      if (cfg.format === 'pursuit' && !isPlayer) idx = wrapIdx(t, Math.round(t.n * 0.13));
      trackPoint(t, idx, col * t.width * 0.2, pt);
      const model = r ? r.model : cfg.playerModel, base = VEHICLES[model] ?? VEHICLES.azure, sk = r ? clamp(r.skill + cfg.aiSkill, 0.05, 1) : 1;
      const veh = r ? { top: base.top * (0.88 + 0.12 * sk) * (cfg.format === 'pursuit' ? 0.95 : 1), accel: base.accel * (0.9 + 0.1 * sk), handling: base.handling } : base;
      const h = Math.atan2(t.tx[idx], t.tz[idx]);
      const lapOff = t.closed && idx > t.n / 2 && !(cfg.format === 'pursuit' && !isPlayer) ? -1 : 0;
      this.racers.push({ id: i + 1, isPlayer, model, veh, skill: sk, x: pt.x, y: pt.y, z: pt.z, px: pt.x, py: pt.y, pz: pt.z, h, ph: h, vx: 0, vz: 0, speed: 0, steer: 0, idx, d: col * t.width * 0.2, lap: lapOff, cp: 0, progress: 0, place: i + 1, boost: isPlayer ? clamp(0.5 * cfg.resources, 0, 1) : 0.4, boosting: false, drifting: false, driftT: 0, slip: 0, stun: 0, scrape: false, pulseCd: 6, finished: false, finishT: 0, out: false, integrity: Math.max(2, Math.round(4 * cfg.resources)), slow: false, draft: false, wallT: 0, wallCd: 3, wx: pt.x, wz: pt.z, shoveT: 0, shx: 0, shz: 0, graceT: 0, downT: 0, pace: 1, intent: { steer: 0, accel: 0, brake: 0, boost: false, ability: false } });
    }
    this.player = this.racers[n - 1];
    const C = t.closed ? 4 : 5; for (let i = 1; i <= C; i++) this.checkpoints.push(Math.min(t.n - 2, Math.round((i * t.n) / (t.closed ? C : C + 0.02)) % (t.closed ? t.n : 1e9)));
    if (t.closed) this.checkpoints[C - 1] = 0;
    // hazards, boost pads and storm cells, kept off the start straight
    const free = (i: number) => i > 40 && i < t.n - 30;
    for (let k = 0; k < cfg.pads; k++) { const i0 = Math.round(((k + 0.5) / cfg.pads) * t.n + this.rng.range(-10, 10)); if (free(i0)) this.pads.push({ i0, i1: i0 + 7, d: this.rng.range(-0.5, 0.5) * (t.width / 2 - 3), hw: 2.6 }); }
    if (this.lightwalls && cfg.modifiers.includes('charge-gates')) { const ng = cfg.modifiers.includes('charge-gates-4') ? 4 : 3; for (let k = 0; k < ng; k++) { const idx = Math.round(((k + 0.3) / ng) * t.n + this.rng.range(-6, 6)); if (free(idx) && !this.pads.some((p) => Math.abs(p.i0 - idx) < 14)) this.gates.push({ idx, d: (k % 2 ? 1 : -1) * (t.width / 2 - 4.2) * this.rng.range(0.35, 0.8), r: 3.1, flash: 0 }); } }
    const hz = Math.round(cfg.hazards * cfg.hazardMul);
    for (let k = 0; k < hz; k++) {
      const idx = Math.round(((k + 0.7) / hz) * t.n + this.rng.range(-8, 8)); if (!free(idx)) continue;
      const sweep = cfg.modifiers.includes('sweepers') && k % 2 === 0, lim = t.width / 2 - 2;
      this.hazards.push({ idx, d: sweep ? 0 : this.rng.range(-lim, lim), r: 1.3, amp: sweep ? lim : 0, w: this.rng.range(0.9, 1.5), phase: this.rng.range(0, 6), x: 0, y: 0, z: 0 });
    }
    if (cfg.modifiers.includes('storm')) for (let k = 0; k < 3; k++) { const i0 = Math.round(((k + 0.45) / 3) * t.n); this.slows.push({ i0, i1: i0 + Math.round(70 / t.step) }); }
    this.updateHazards();
    const laps = t.closed ? cfg.laps : 1, pv = VEHICLES[cfg.playerModel] ?? VEHICLES.azure;
    this.parTime = this.stats.parTime = (t.length * laps) / (pv.top * (cfg.format === 'timetrial' ? 0.56 : 0.7));
    this.stats.field = n;
    if (cfg.format === 'elimination') { this.elimEvery = Math.max(14, (t.length * laps) / (pv.top * 0.72) / Math.max(1, n - 1)); this.elimT = this.elimEvery; }
    this.lastPlace = n;
  }

  totalLaps() { return this.track.closed ? this.cfg.laps : 1; }
  private updateHazards() { for (const h of this.hazards) { const d = h.amp ? Math.sin(this.time * h.w + h.phase) * h.amp : h.d; h.d = d; trackPoint(this.track, h.idx, d, pt); h.x = pt.x; h.y = pt.y; h.z = pt.z; } }

  step(dt: number, intent: RaceIntent) {
    // finished: freeze in place (prev = current), or the view keeps blending between the last two steps and everything shakes
    if (this.state !== 'active') { for (const r of this.racers) { r.px = r.x; r.py = r.y; r.pz = r.z; r.ph = r.h; } return; }
    this.time += dt; this.stats.time = this.time;
    this.updateHazards(); while (this.walls.length && this.walls[0].until < this.time) this.walls.shift();
    for (const g of this.gates) g.flash = Math.max(0, g.flash - dt);
    for (const r of this.racers) { if (r.out) continue; if (r.downT > 0) { this.reform(r, dt); continue; } if (!r.isPlayer) this.drive(r, dt); this.stepRacer(r, r.isPlayer ? intent : r.intent, dt); }
    if (this.jet) this.stepJet(dt);
    // rider contact
    for (let i = 0; i < this.racers.length; i++) for (let j = i + 1; j < this.racers.length; j++) {
      const a = this.racers[i], b = this.racers[j]; if (a.out || b.out || a.downT > 0 || b.downT > 0) continue;
      const dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz);
      if (dist < RACER_R * 2 && dist > 1e-4) this.contact(a, b, dx / dist, dz / dist, (RACER_R * 2 - dist) / 2);
    }
    this.rank();
    this.rules(dt);
  }

  /**
   * A rival that hits the player's wall, or is rammed off the road, is derezzed: it is out of the race for a few seconds
   * and then re-forms on the track where it fell. That costs it the places the player earned without emptying the field.
   */
  private takedown(r: Racer, cause: 'wall' | 'rail', by: number) {
    // In an elimination event the timed cut is the elimination mechanic; a wall or a rail only costs a rider the
    // places it takes to re-form. Making takedowns final as well used to empty the field inside the first lap and
    // then cut whoever was left at the back, whatever they had done.
    r.downT = r.isPlayer ? 3 : 3.4; r.vx = r.vz = 0; r.speed = 0; r.wallT = 0; r.shoveT = 0; r.stun = 0; r.boosting = false; r.drifting = false; if (by === this.player.id) this.stats.takedowns = (this.stats.takedowns ?? 0) + 1;
    this.events.push({ type: 'takedown', id: r.id, x: r.x, y: r.y, z: r.z, by, cause });
  }
  private reform(r: Racer, dt: number) {
    r.px = r.x; r.py = r.y; r.pz = r.z; r.ph = r.h; r.downT -= dt; if (r.downT > 0) return;
    const t = this.track; trackPoint(t, r.idx, 0, pt); r.x = r.px = pt.x; r.y = r.py = pt.y; r.z = r.pz = pt.z; r.d = 0; r.h = r.ph = Math.atan2(t.tx[r.idx], t.tz[r.idx]);
    const v = r.veh.top * 0.6; r.vx = Math.sin(r.h) * v; r.vz = Math.cos(r.h) * v; r.speed = v; r.graceT = 3; r.downT = 0; r.wallCd = Math.max(r.wallCd, 4);
    this.events.push({ type: 'reform', id: r.id, x: r.x, y: r.y, z: r.z });
  }

  /**
   * Machine-on-machine contact. Riders separate, trade momentum along the contact normal and scrub speed in
   * proportion to how hard they met, so a glancing touch costs a tenth and a proper hit costs the corner. Where
   * ramming is live, the rider that arrived faster also shoves the other one bodily across the road.
   */
  private contact(a: Racer, b: Racer, nx: number, nz: number, push: number) {
    a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
    // closing speed along the contact normal drives everything below
    const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (rel > 0) {
      // a mostly inelastic exchange: both are thrown apart sideways rather than passing through each other
      const j = rel * 0.62;
      a.vx -= j * nx; a.vz -= j * nz; b.vx += j * nx; b.vz += j * nz;
      // scrub costs the rider that closed the gap more than the one that was hit, so pack racing stays racing
      const scrub = Math.min(0.15, rel * 0.013);
      a.vx *= 1 - scrub; a.vz *= 1 - scrub; b.vx *= 1 - scrub * 0.6; b.vz *= 1 - scrub * 0.6;
      a.speed = Math.hypot(a.vx, a.vz); b.speed = Math.hypot(b.vx, b.vz);
      // a hard hit also knocks a rider off its line for a moment
      if (rel > 9) { const st = Math.min(0.45, rel * 0.03); a.stun = Math.max(a.stun, st * 0.4); b.stun = Math.max(b.stun, st); a.drifting = b.drifting = false; }
    }
    const force = Math.max(0, rel);
    if (a.isPlayer || b.isPlayer) this.events.push({ type: 'bump', x: (a.x + b.x) / 2, y: a.y, z: (a.z + b.z) / 2, force, hard: force > 7, mine: (a.isPlayer && rel > 0) || (b.isPlayer && rel > 0) });
    if (!this.ramming || this.time < 4) return;
    // only a side-on hit shoves: running into the back of someone slows you both, it does not throw them at a rail
    const t = this.track, i = a.idx, side = Math.abs(nx * -t.tz[i] + nz * t.tx[i]);
    if (side < 0.55) return;
    // whoever arrived faster does the shoving; super speed counts for an extra margin of its own
    const da = a.speed - b.speed + (a.boosting ? 8 : 0) - (b.boosting ? 8 : 0);
    if (Math.abs(da) < 7) return;
    if (da > 0) this.shunt(a, b, nx, nz, da); else this.shunt(b, a, -nx, -nz, -da);
  }

  /** A faster rider shoves the one it hits bodily across the road, hard enough to put it into a rail. */
  private shunt(by: Racer, r: Racer, nx: number, nz: number, force: number) {
    if (r.shoveT > 0 || r.finished || r.graceT > 0) return; r.graceT = 4; const t = this.track, side = Math.sign(nx * -t.tz[r.idx] + nz * t.tx[r.idx]) || 1;
    // push straight across the track, toward whichever rail the contact points at, harder the bigger the mismatch
    const p = Math.min(22, 9 + force * 0.7);
    r.shx = -t.tz[r.idx] * side * p; r.shz = t.tx[r.idx] * side * p; r.shoveT = 1.1 + Math.min(0.7, force * 0.05); r.stun = Math.max(r.stun, 0.4 + Math.min(0.35, force * 0.02)); r.drifting = false;
    by.speed *= 0.94; by.vx *= 0.94; by.vz *= 0.94; // the hit costs the rider that made it a little pace too
    this.events.push({ type: 'shunt', id: r.id, by: by.id, player: r.isPlayer, x: r.x, y: r.y, z: r.z, force });
  }

  private stepRacer(r: Racer, it: RaceIntent, dt: number) {
    const t = this.track, V = r.veh;
    r.px = r.x; r.py = r.y; r.pz = r.z; r.ph = r.h;
    r.stun = Math.max(0, r.stun - dt); r.pulseCd = Math.max(0, r.pulseCd - dt);
    const fin = r.finished, accelIn = fin ? 0 : r.stun > 0 ? 0 : it.accel, brakeIn = fin ? 0.6 : it.brake;
    r.steer = approach(r.steer, r.stun > 0 ? 0 : clamp(it.steer, -1, 1), 7 * dt);
    let sp = Math.hypot(r.vx, r.vz);
    const frac = clamp(sp / V.top, 0, 1.4);
    // controlled drift: brake + steer at speed breaks traction; holding it charges a mini-boost
    if (!r.drifting && brakeIn > 0.3 && Math.abs(r.steer) > 0.45 && frac > 0.45) { r.drifting = true; r.driftT = 0; if (r.isPlayer) this.events.push({ type: 'drift', on: true }); }
    else if (r.drifting && (Math.abs(r.steer) < 0.2 || frac < 0.3 || r.scrape)) {
      r.drifting = false; if (r.driftT > 0.45 && !r.scrape) { r.boost = Math.min(1, r.boost + Math.min(0.3, r.driftT * 0.16)); sp += 3.5; if (r.isPlayer) this.events.push({ type: 'driftBoost', t: r.driftT }); }
      if (r.isPlayer) this.events.push({ type: 'drift', on: false });
    }
    if (r.drifting) { r.driftT += dt; if (r.isPlayer) this.stats.driftMeters += sp * dt; }
    const boosting = !fin && it.boost && r.boost > 0.02 && r.stun <= 0;
    if (boosting !== r.boosting) { r.boosting = boosting; this.events.push({ type: 'boost', id: r.id, on: boosting }); }
    r.boost = boosting ? Math.max(0, r.boost - 0.34 * dt) : Math.min(1, r.boost + 0.02 * dt);
    // steering (positive steer = right = decreasing heading)
    const rate = V.handling * lerp(2.5, 1.2, clamp(frac, 0, 1)) * (r.drifting ? 1.5 : 1);
    r.h = wrapAngle(r.h - r.steer * rate * dt * clamp(sp / 7, 0, 1));
    const fx = Math.sin(r.h), fz = Math.cos(r.h);
    const top = V.top * r.pace * (boosting ? 1.27 : 1) * (r.slow ? 0.72 : 1) * (r.draft ? 1.05 : 1);
    sp += accelIn * V.accel * r.pace * (boosting ? 1.7 : 1) * Math.max(0, 1 - sp / top) * dt;
    sp -= (brakeIn * (r.drifting ? 14 : 40) + 1.2 + (sp > top ? (sp - top) * 1.6 : 0)) * dt;
    sp = Math.max(0, sp);
    // velocity direction eases toward heading by available grip
    let ux = sp > 0.5 ? r.vx / Math.hypot(r.vx, r.vz) : fx, uz = sp > 0.5 ? r.vz / Math.hypot(r.vx, r.vz) : fz;
    const g = 1 - Math.exp(-(r.drifting ? 2.4 : 9.5) * dt); ux += (fx - ux) * g; uz += (fz - uz) * g; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    r.slip = ux * fz - uz * fx; sp -= Math.abs(r.slip) * sp * (r.drifting ? 0.35 : 0.9) * dt;
    r.vx = ux * sp; r.vz = uz * sp; r.x += r.vx * dt; r.z += r.vz * dt;
    if (r.shoveT > 0) { r.shoveT -= dt; r.x += r.shx * dt; r.z += r.shz * dt; const k = Math.exp(-3.2 * dt); r.shx *= k; r.shz *= k; }
    // track constraint: energy rails at the ribbon edges are real geometry, never an invisible wall
    const prevIdx = r.idx; r.idx = nearestIdx(t, r.x, r.z, r.idx);
    r.d = lateral(t, r.idx, r.x, r.z); const lim = t.width / 2 - RACER_R; let scrape = false;
    if (Math.abs(r.d) > lim) {
      const sgn = Math.sign(r.d), nx = -t.tz[r.idx] * sgn, nz = t.tx[r.idx] * sgn, over = Math.abs(r.d) - lim; r.x -= nx * over; r.z -= nz * over; r.d = sgn * lim;
      // a shoved rival that reaches the rail is thrown off the road; the player takes a hard stall instead
      if (r.shoveT > 0 && r.shx * nx + r.shz * nz > 2) { r.shx = r.shz = 0; if (!r.isPlayer) { this.takedown(r, 'rail', this.player.id); return; } r.stun = Math.max(r.stun, 0.9); r.vx *= 0.35; r.vz *= 0.35; this.events.push({ type: 'slam', id: r.id, x: r.x, y: r.y, z: r.z, player: true }); }
      const vn = r.vx * nx + r.vz * nz; if (vn > 0) { r.vx -= vn * nx; r.vz -= vn * nz; const loss = clamp(vn / (sp + 0.01), 0, 1); const k = 1 - 0.55 * loss; r.vx *= k; r.vz *= k; if (vn > 5) { scrape = true; if (!r.scrape) this.events.push({ type: 'scrape', id: r.id, x: r.x, y: r.y, z: r.z, hard: vn > 12 }); } }
      const th = Math.atan2(t.tx[r.idx], t.tz[r.idx]); r.h = wrapAngle(r.h + wrapAngle(th - r.h) * Math.min(1, 5 * dt));
      r.vx *= 1 - 0.5 * dt; r.vz *= 1 - 0.5 * dt; scrape = scrape || over > 0.02;
    }
    if (scrape && !r.scrape && r.isPlayer) { this.stats.scrapes++; this.sectorClean = false; }
    r.scrape = scrape;
    r.speed = Math.hypot(r.vx, r.vz);
    // elevation follows the banked ribbon; a three-tap average keeps a rider from stepping between samples
    const jb = wrapIdx(t, r.idx + 1), ja = wrapIdx(t, r.idx - 1);
    r.y = (t.y[ja] + 2 * t.y[r.idx] + t.y[jb]) / 4 + t.bank[r.idx] * r.d;
    // lap / checkpoint bookkeeping
    if (t.closed) { if (prevIdx > t.n * 0.7 && r.idx < t.n * 0.3) r.lap++; else if (prevIdx < t.n * 0.3 && r.idx > t.n * 0.7) r.lap--; }
    r.progress = r.lap * t.n + r.idx;
    this.zones(r, dt);
    if (r.isPlayer && !r.finished) this.playerProgress(r, prevIdx);
    if (!r.finished && ((t.closed && r.lap >= this.cfg.laps) || (!t.closed && r.idx >= t.n - 4))) { r.finished = true; r.finishT = this.time; this.events.push({ type: 'finish', id: r.id, player: r.isPlayer, place: this.finishedCount() }); }
    if (this.lightwalls) this.stepWall(r, dt);
    if (r.isPlayer ? it.ability : r.intent.ability) { if (this.lightwalls) this.layWall(r); else this.pulse(r); }
    if (!r.isPlayer && r.intent.pulse) this.pulse(r);
  }

  private layWall(r: Racer) {
    if (r.wallCd > 0 || r.wallT > 0 || r.finished || r.stun > 0) return; r.wallT = WALL_LAY; r.wallCd = WALL_COOLDOWN;
    r.wx = r.x - Math.sin(r.h) * 1.4; r.wz = r.z - Math.cos(r.h) * 1.4; this.events.push({ type: 'wall', id: r.id, player: r.isPlayer });
  }
  private stepWall(r: Racer, dt: number) {
    r.wallCd = Math.max(0, r.wallCd - dt);
    if (r.wallT > 0) {
      r.wallT -= dt; const bx = r.x - Math.sin(r.h) * 1.4, bz = r.z - Math.cos(r.h) * 1.4;
      if (Math.hypot(bx - r.wx, bz - r.wz) > 1.5) { this.walls.push({ owner: r.id, x0: r.wx, z0: r.wz, x1: bx, z1: bz, y: r.y, until: this.time + WALL_LIFE }); r.wx = bx; r.wz = bz; }
    }
    r.graceT = Math.max(0, r.graceT - dt);
    if (r.finished || r.stun > 0.4 || r.graceT > 0) return;
    for (const w of this.walls) {
      if (w.owner === r.id || Math.abs(w.y - r.y) > 3) continue;
      const ex = w.x1 - w.x0, ez = w.z1 - w.z0, k = clamp(((r.x - w.x0) * ex + (r.z - w.z0) * ez) / (ex * ex + ez * ez || 1), 0, 1);
      if (Math.hypot(r.x - (w.x0 + ex * k), r.z - (w.z0 + ez * k)) > RACER_R + 0.15) continue;
      // a light wall derezzes whoever rides into it, player or rival: the rider re-forms on the road a few seconds later,
      // with the field gone past (in an elimination event a rival is out for good; the player still re-forms)
      if (r.isPlayer) {
        this.sectorClean = false; this.stats.scrapes++; this.events.push({ type: 'wallHit', id: r.id, player: true, x: r.x, y: r.y, z: r.z });
        if (this.cfg.format === 'gauntlet') { r.integrity--; this.events.push({ type: 'integrity', left: r.integrity }); }
      }
      this.takedown(r, 'wall', w.owner);
      return;
    }
  }

  /**
   * The interceptor shadows whoever is leading, then runs ahead and lays a barrier across part of the lane. It picks
   * the side with more room so the drop is always survivable: there is a way through, but only one.
   */
  private stepJet(dt: number) {
    const j = this.jet!, t = this.track;
    const live = this.racers.filter((r) => !r.out && !r.finished && r.downT <= 0);
    if (!live.length) return;
    // it hunts the leader, which keeps the pressure on whoever is winning rather than on whoever is struggling
    const lead = live.reduce((a, b) => (a.progress > b.progress ? a : b)); j.target = lead.id;
    const ahead = wrapIdx(t, lead.idx + Math.round(j.lead / t.step));
    trackPoint(t, ahead, j.d, pt); j.idx = ahead; j.x = pt.x; j.z = pt.z; j.y = pt.y + 16 + Math.sin(this.time * 0.8) * 2.5;
    j.cd -= dt;
    if (j.runT > 0) { j.runT -= dt; return; }
    if (j.cd > 0 || this.time < 9) return;
    // drop point: a barrier over roughly half the lane, on the side the leader is not using
    const side = lead.d > 0 ? -1 : 1, hw = t.width / 2;
    const d0 = side < 0 ? -hw + 0.4 : hw * 0.02, d1 = side < 0 ? -hw * 0.02 : hw - 0.4;
    const a = trackPoint(t, ahead, d0, { x: 0, y: 0, z: 0 }), b = trackPoint(t, ahead, d1, { x: 0, y: 0, z: 0 });
    this.walls.push({ owner: INTERCEPTOR_ID, x0: a.x, z0: a.z, x1: b.x, z1: b.z, y: a.y, until: this.time + 3.4 });
    j.cd = Math.max(5.5, 11 - this.cfg.aiSkill * 8); j.runT = 1.1; j.d = -j.d || (this.rng.chance(0.5) ? 4 : -4);
    this.events.push({ type: 'interceptorDrop', x: (a.x + b.x) / 2, y: a.y, z: (a.z + b.z) / 2, idx: ahead, side });
  }

  private finishedCount() { let n = 0; for (const r of this.racers) if (r.finished) n++; return n; }

  private zones(r: Racer, dt: number) {
    const t = this.track; const inRange = (i0: number, i1: number) => { let k = r.idx - i0; if (t.closed && k < 0) k += t.n; return k >= 0 && k <= i1 - i0; };
    for (const p of this.pads) if (inRange(p.i0, p.i1) && Math.abs(r.d - p.d) < p.hw) { if (r.speed < r.veh.top * 1.3) { const k = 1 + 16 * dt / Math.max(8, r.speed); r.vx *= k; r.vz *= k; } r.boost = Math.min(1, r.boost + 0.5 * dt); if (r.isPlayer && r.pulseCd >= 0) this.events.push({ type: 'pad' }); }
    if (r.wallCd > 0) for (const g of this.gates) if (inRange(g.idx, g.idx + 1) && Math.abs(r.d - g.d) < g.r - 0.6) { r.wallCd = 0; g.flash = 0.6; this.events.push({ type: 'charge', id: r.id, mine: r.isPlayer, idx: g.idx, d: g.d }); }
    let slow = false; for (const s of this.slows) if (inRange(s.i0, s.i1)) slow = true;
    if (slow !== r.slow) { r.slow = slow; if (r.isPlayer) this.events.push({ type: 'storm', on: slow }); }
    for (const h of this.hazards) {
      if (Math.abs(h.x - r.x) < h.r + RACER_R && Math.abs(h.z - r.z) < h.r + RACER_R && r.stun <= 0.4 && Math.hypot(h.x - r.x, h.z - r.z) < h.r + RACER_R) {
        r.stun = 1; r.vx *= 0.35; r.vz *= 0.35; r.drifting = false;
        this.events.push({ type: 'hazardHit', id: r.id, x: h.x, y: h.y, z: h.z, player: r.isPlayer });
        if (r.isPlayer) { this.sectorClean = false; this.stats.scrapes++; if (this.cfg.format === 'gauntlet') { r.integrity--; this.events.push({ type: 'integrity', left: r.integrity }); } }
      }
    }
    // slipstream behind another rider
    let draft = false;
    for (const o of this.racers) if (o !== r && !o.out) { const dp = o.progress - r.progress; if (dp > 1 && dp < 8 && Math.abs(o.d - r.d) < 1.6 && r.speed > 25) draft = true; }
    r.draft = draft; if (draft) r.boost = Math.min(1, r.boost + 0.07 * dt);
  }

  private playerProgress(r: Racer, prevIdx: number) {
    const t = this.track, target = this.checkpoints[r.cp % this.checkpoints.length];
    const crossed = target === 0 ? prevIdx > t.n * 0.7 && r.idx < t.n * 0.3 : prevIdx < target && r.idx >= target && r.idx - prevIdx < 40;
    if (!crossed) return;
    r.cp++; this.stats.sections++; if (this.sectorClean) this.stats.cleanSections++; this.sectorClean = true;
    const lapDone = t.closed && target === 0;
    if (lapDone) { const lt = this.time - this.lapStart; this.lapStart = this.time; if (!this.stats.bestLap || lt < this.stats.bestLap) this.stats.bestLap = lt; this.events.push({ type: 'lap', lap: r.lap, of: this.cfg.laps, time: lt, final: r.lap === this.cfg.laps - 1 }); }
    else this.events.push({ type: 'checkpoint', index: r.cp, time: this.time });
  }

  private pulse(r: Racer) {
    if (r.pulseCd > 0 || r.finished) return; r.pulseCd = 10;
    this.events.push({ type: 'pulse', id: r.id, x: r.x, y: r.y, z: r.z });
    for (const o of this.racers) if (o !== r && !o.out && Math.hypot(o.x - r.x, o.z - r.z) < 13) { o.stun = Math.max(o.stun, 0.6); o.vx *= 0.8; o.vz *= 0.8; }
  }

  private rank() {
    for (const r of this.racers) {
      let place = 1;
      for (const o of this.racers) { if (o === r) continue; if (r.out && !o.out) place++; else if (o.out) continue; else if (o.finished && (!r.finished || o.finishT < r.finishT)) place++; else if (!o.finished && !r.finished && o.progress > r.progress) place++; }
      r.place = place;
    }
    const p = this.player.place; if (p < this.lastPlace && this.time > 3) { this.stats.overtakes += this.lastPlace - p; this.events.push({ type: 'overtake', place: p }); }
    this.lastPlace = p; this.stats.place = p;
  }

  private rules(dt: number) {
    const f = this.cfg.format, P = this.player; let done: null | boolean = null;
    if (f === 'elimination') {
      this.elimT -= dt; const active = this.racers.filter((r) => !r.out);
      // the timed cut only fires while three or more are still running: once attrition (walls, rails) has thinned the
      // field to a head-to-head, it is settled at the line, not by the clock
      // nobody is cut until the leader has a lap in: an elimination decided on the opening lap is decided by the grid
      const opened = !this.track.closed || this.racers.some((r) => r.lap >= 1);
      if (this.elimT <= 0 && opened && active.length > 2) { this.elimT = this.elimEvery; const last = active.reduce((a, b) => (a.place > b.place ? a : b)); last.out = true; this.events.push({ type: 'eliminated', id: last.id, player: last.isPlayer, x: last.x, y: last.y, z: last.z, left: active.length - 1 }); }
      else if (this.elimT <= 0) this.elimT = opened ? this.elimEvery : 1;
      if (P.out) done = false; else if (this.racers.filter((r) => !r.out).length === 1 || P.finished) done = true;
    } else if (f === 'pursuit') {
      const tgt = this.racers[0];
      if (P.progress >= tgt.progress - 1 && this.time > 2) { done = true; this.events.push({ type: 'caught', x: tgt.x, y: tgt.y, z: tgt.z, id: tgt.id }); tgt.out = true; }
      else if (tgt.finished || P.finished) done = false;
    } else if (f === 'gauntlet') { if (P.integrity <= 0) done = false; else if (P.finished) done = true; }
    else if (f === 'timetrial') { if (P.finished) done = this.time <= this.parTime; else if (this.time > this.parTime * 1.6) done = false; }
    else {
      if (P.finished) done = P.place <= this.cfg.passPlace;
      else { const others = this.racers.filter((r) => !r.isPlayer); if (others.length && others.every((r) => r.finished)) { if (this.endT < 0) this.endT = this.time + 12; if (this.time > this.endT) done = false; } }
    }
    if (done !== null) { this.state = done ? 'won' : 'lost'; this.events.push({ type: done ? 'win' : 'lose' }); }
  }

  /** Rivals follow a curvature-derived racing line and brake for corners using the same physics as the player. */
  drive(r: Racer, dt: number) {
    const t = this.track, it = r.intent, sk = r.skill, hw = t.width / 2;
    const look = wrapIdx(t, r.idx + Math.round((7 + r.speed * 0.55) / t.step));
    let maxC = 1e-4; const span = Math.round((r.speed * 1.25 + 10) / t.step); for (let k = 0; k <= span; k += 2) maxC = Math.max(maxC, Math.abs(t.curv[wrapIdx(t, r.idx + k)]));
    const vmax = Math.sqrt((27 * r.veh.handling * (0.72 + 0.28 * sk)) / maxC);
    // catch-up pacing: a rival that has dropped behind the player finds more speed the further back it is, and one far
    // ahead eases a little. The race stays a race for all its laps instead of being settled in the first minute.
    const P = this.player, gap = (P.progress - r.progress) * t.step, band = clamp(0.3 + this.cfg.aiSkill * 0.4, 0.16, 0.42) * (this.cfg.format === 'elimination' ? 0 : 1); // elimination already punishes being passed
    const wantPace = r.isPlayer || P.finished || this.cfg.format === 'pursuit' ? 1 : gap > 0 ? 1 + clamp((gap - 6) / 30, 0, 1) * band : 1 - clamp((-gap - 45) / 220, 0, 1) * 0.07;
    r.pace = approach(r.pace, wantPace, 0.35 * dt);
    // extra pace never takes a rider past what the tyres can hold: corner speed is capped at the full-skill limit
    const target = Math.min(r.veh.top * 1.3 * (0.84 + 0.16 * sk) * r.pace, Math.min(vmax * (0.84 + 0.16 * sk) * r.pace, Math.sqrt((27 * r.veh.handling) / maxC) * 0.98));
    const c = t.curv[look]; let d = -Math.sign(c) * Math.min(1, Math.abs(c) * 45) * (hw - 2) * 0.7 * sk;
    d += Math.sin(r.id * 2.4 + r.progress * 0.004) * 1.4;
    for (const h of this.hazards) {
      let k = h.idx - r.idx; if (t.closed && k < -t.n / 2) k += t.n;
      const gap = k * t.step; if (k <= 0 || gap > 30 + r.speed * 0.5 || sk <= 0.15) continue;
      // a sweeper is somewhere else by the time the rider gets there, so the line is planned against where it will
      // be, not where it is. Steering at its current position is why sweeper tiers used to be unsurvivable.
      const tta = gap / Math.max(8, r.speed);
      const hd = h.amp ? Math.sin((this.time + tta) * h.w + h.phase) * h.amp : h.d;
      if (Math.abs(hd - d) > 2.6) continue;
      const hw2 = t.width / 2 - 1.6, clear = 3 + 0.5 * sk;
      d = hd + clear <= hw2 && (hd - clear < -hw2 || hd > 0) ? hd + clear : hd - clear;
      d = clamp(d, -hw2, hw2);
    }
    for (const o of this.racers) if (o !== r && !o.out && o.downT <= 0) { const dp = (o.progress - r.progress) * t.step; if (dp > 0 && dp < 12 && Math.abs(o.d - d) < 1.9 && o.speed < r.speed + 2) d = o.d + (o.d > 0 ? -2.3 : 2.3); }
    if (this.lightwalls) {
      // a rider steers round a wall it has noticed; whether it notices depends on its skill, decided once per wall
      const fx = Math.sin(r.h), fz = Math.cos(r.h), reach = 14 + r.speed * 1.1;
      for (const w of this.walls) {
        if (w.owner === r.id) continue; const mx = (w.x0 + w.x1) / 2 - r.x, mz = (w.z0 + w.z1) / 2 - r.z, ahead = mx * fx + mz * fz;
        // a barrier laid across the lane can be much wider than a rider's own trail, so the whole span is measured
        // and the line goes round the nearer end of it, not a fixed distance from its middle
        if (ahead < 0 || ahead > reach) continue;
        const wi = wrapIdx(t, r.idx + Math.round(ahead / t.step));
        const la = lateral(t, wi, w.x0, w.z0), lb = lateral(t, wi, w.x1, w.z1), lo = Math.min(la, lb), hi = Math.max(la, lb);
        if (d > hi + 2.4 || d < lo - 2.4) continue;                                  // the current line already clears it
        if (((w.owner * 7 + r.id * 13 + Math.floor(w.until)) % 10) / 10 > 0.45 + 0.5 * sk) continue;
        const hwl = t.width / 2 - 1.6, left = lo - 2.4, right = hi + 2.4;
        // take whichever side is on the road; if both are, take the one nearer the line being driven
        const leftOk = left >= -hwl, rightOk = right <= hwl;
        d = leftOk && rightOk ? (Math.abs(left - d) < Math.abs(right - d) ? left : right) : leftOk ? left : rightOk ? right : d;
        break;
      }
    }
    d = clamp(d, -(hw - 1.6), hw - 1.6);
    trackPoint(t, look, d, pt);
    const want = Math.atan2(pt.x - r.x, pt.z - r.z), err = wrapAngle(want - r.h);
    it.steer = clamp(-err * 2.6, -1, 1);
    it.accel = r.speed < target ? 1 : 0; it.brake = r.speed > target + 4 ? clamp((r.speed - target) / 12, 0.2, 1) : 0;
    it.boost = r.boost > 0.45 && maxC < 0.012 && sk > 0.3 && Math.abs(err) < 0.2;
    it.ability = this.cfg.modifiers.includes('aggressive') && sk > 0.6 && r.pulseCd <= 0 && Math.hypot(this.player.x - r.x, this.player.z - r.z) < 9 && this.time > 8;
    if (this.lightwalls) {
      // lay a wall when someone is close behind in the same lane; an aggressive rival still fires its pulse
      it.pulse = it.ability; it.ability = false;
      if (r.wallCd <= 0 && this.time > 7) for (const o of this.racers) { if (o === r || o.out || o.downT > 0) continue; const back = (r.progress - o.progress) * t.step; if (back > 4 && back < 18 && Math.abs(o.d - r.d) < 3 && this.time > this.rivalWallAt && this.rng.chance(dt * (0.14 + 0.45 * sk) * (this.cfg.modifiers.includes('aggressive') ? 0.5 : 1))) { it.ability = true; this.rivalWallAt = this.time + clamp(6 - this.cfg.aiSkill * 14, 3, 10); break; } }
    }
    void dt;
  }
}
