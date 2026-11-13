import { describe, expect, it } from 'vitest';
import { CombatSim, DIRS, type CombatConfig, type CycleIntent } from '../games/cycles/combat';
import { RaceSim } from '../games/cycles/race';
import { buildTrack, lateral, nearestIdx, validateTrack } from '../games/cycles/track';
import { COMBAT_TIERS, RACE_TIERS } from '../progression/tiers/cycles';
import { buildCombatConfig, buildRaceConfig } from '../progression/build';
import { DT, runRaceBot } from './bots';

const base = (over: Partial<CombatConfig> = {}): CombatConfig => ({ half: 60, seed: 3, speed: 24, rivals: [{ profile: 'evader', skill: 0.5, model: 'ember' }], modifiers: [], pillars: 0, aiSkill: 0, hazardMul: 1, resources: 1, ...over });
const idle: CycleIntent = { turn: 0, accel: 0, boost: false, ability: false };

describe('cycle combat rules', () => {
  it('turns are exact 90° and take effect immediately', () => {
    const sim = new CombatSim(base()); const P = sim.player, d0 = P.dir; sim.step(DT, { ...idle, turn: 1 }); expect(P.dir).toBe((d0 + 1) % 4); const [dx, dz] = DIRS[P.dir]; expect(Math.abs(dx) + Math.abs(dz)).toBe(1);
    const x = P.x, z = P.z; sim.step(DT, idle); expect(Math.sign(P.x - x) || 0).toBe(dx); expect(Math.sign(P.z - z) || 0).toBe(dz);
  });
  it('a rider crashes into a wall trail at maximum speed, even with coarse time steps (swept test)', () => {
    for (const step of [1 / 120, 1 / 30, 1 / 10]) {
      const sim = new CombatSim(base({ rivals: [] })); const P = sim.player; (sim as any).state = 'active';
      // lay a wall across the player's path, far thinner than one coarse step of travel
      const other = { ...P, id: 9, isPlayer: false, alive: false, trailGone: false, trail: [-30, P.z - 25, 30, P.z - 25], x: 30, z: P.z - 25, px: 30, pz: P.z - 25 }; sim.cycles.push(other as any);
      P.speed = 200; let crashed = false; for (let i = 0; i < 200 && !crashed; i++) { (sim as any).stepCycle(P, { ...idle, accel: 1, boost: true }, step); P.speed = 200; crashed = !P.alive; }
      expect(crashed, `dt=${step}`).toBe(true); expect(sim.events.find((e) => e.type === 'crash')!.kind).toBe('trail');
    }
  });
  it('riders cannot leave the arena and rivals obey the same collision rules', () => {
    const sim = new CombatSim(base({ rivals: [] })); const P = sim.player; (sim as any).state = 'active'; for (let i = 0; i < 2000 && P.alive; i++) (sim as any).stepCycle(P, idle, DT);
    expect(P.alive).toBe(false); expect(Math.abs(P.z)).toBeLessThanOrEqual(sim.half);
    const s2 = new CombatSim(base()); for (let i = 0; i < 120 * 240 && s2.state === 'active'; i++) { s2.step(DT, idle); s2.events.length = 0; }
    for (const c of s2.cycles) { expect(Math.abs(c.x)).toBeLessThanOrEqual(s2.half0); expect(Math.abs(c.z)).toBeLessThanOrEqual(s2.half0); }
  });
  it('a rival that hits the player\'s wall is credited as a trap', () => {
    const sim = new CombatSim(base()); const P = sim.player, R = sim.cycles[1]; R.ai = null; P.trail = [-40, 0, 40, 0]; P.x = 40; P.z = 0.0001; P.px = 40; P.pz = 0; P.dir = 0; R.x = 0; R.z = -6; R.dir = 1; R.trail = [0, -6];
    for (let i = 0; i < 200 && R.alive; i++) (sim as any).stepCycle(R, idle, DT); expect(R.alive).toBe(false); expect(sim.stats.trapKills).toBe(1); expect(sim.stats.score).toBeGreaterThan(0);
  });
  it('all combat tiers build with safe spawns and terminate', () => {
    for (const t of COMBAT_TIERS) { const sim = new CombatSim(buildCombatConfig(t, 'standard')); for (const c of sim.cycles) expect(sim.freeDist(c.x, c.z, c.dir, 30), `tier ${t.id}`).toBeGreaterThan(20); for (let i = 0; i < 120 * 400 && sim.state === 'active'; i++) { sim.step(DT, idle); sim.events.length = 0; } expect(sim.state).not.toBe('active'); }
  });
  it('is deterministic for a given seed', () => {
    const run = () => { const s = new CombatSim(buildCombatConfig(COMBAT_TIERS[4], 'standard')); for (let i = 0; i < 1500; i++) { s.step(DT, i === 200 ? { ...idle, turn: 1 } : idle); s.events.length = 0; } return s.cycles.map((c) => [c.x, c.z, c.dir, c.alive]); };
    expect(run()).toEqual(run());
  });
});

describe('racing', () => {
  it('every authored and staged track validates and keeps racers on the ribbon', () => {
    for (const t of RACE_TIERS) for (let stage = 0; stage < Number(t.params.stages ?? 1); stage++) { const cfg = buildRaceConfig(t, 'standard', 'azure', stage); expect(validateTrack(cfg.track), `tier ${t.id} stage ${stage}`).toEqual([]); }
  });
  it('rails are a hard constraint at any speed', () => {
    const cfg = buildRaceConfig(RACE_TIERS[2], 'standard', 'azure'); const sim = new RaceSim(cfg), P = sim.player, T = cfg.track;
    for (let i = 0; i < 120 * 12; i++) { sim.step(DT, { steer: 1, accel: 1, brake: 0, boost: true, ability: false }); const idx = nearestIdx(T, P.x, P.z, P.idx, 40); expect(Math.abs(lateral(T, idx, P.x, P.z))).toBeLessThanOrEqual(T.width / 2 + 0.05); sim.events.length = 0; }
    expect(sim.stats.scrapes).toBeGreaterThan(0);
  });
  it('fluid steering turns the heading continuously (not in 90° steps)', () => {
    const sim = new RaceSim(buildRaceConfig(RACE_TIERS[0], 'standard', 'azure')), P = sim.player; for (let i = 0; i < 240; i++) sim.step(DT, { steer: 0, accel: 1, brake: 0, boost: false, ability: false });
    const h0 = P.h; sim.step(DT, { steer: 1, accel: 1, brake: 0, boost: false, ability: false }); const d = Math.abs(P.h - h0); expect(d).toBeGreaterThan(0); expect(d).toBeLessThan(0.05);
  });
  it('a scripted rider can complete every race tier and laps are counted', () => {
    for (const t of RACE_TIERS) { const sim = new RaceSim(buildRaceConfig(t, 'apprentice', 'azure')); const r = runRaceBot(sim, 600); expect(r, `tier ${t.id} ${t.name}`).toBe('won'); if (sim.track.closed && sim.cfg.format === 'circuit') expect(sim.player.lap).toBe(sim.cfg.laps); }
  }, 120000);
  it('generated tracks relax until valid', () => { for (let s = 1; s < 40; s++) expect(validateTrack(buildTrack({ seed: s, closed: true, radius: 180, wobble: 0.9, elevation: 20, width: 16, knots: 12 }))).toEqual([]); });
});

describe('new tier mechanics', () => {
  it('riding through a charge gate recharges the light wall', () => {
    const t = RACE_TIERS.find((x) => x.modifiers.includes('charge-gates'))!; const sim = new RaceSim(buildRaceConfig(t, 'standard', 'azure'));
    expect(sim.gates.length).toBeGreaterThan(0); const g = sim.gates[0], P = sim.player; P.wallCd = 6; P.idx = g.idx; P.d = g.d;
    (sim as any).zones(P, DT); expect(P.wallCd).toBe(0); expect(sim.events.some((e) => e.type === 'charge' && e.mine)).toBe(true);
    P.wallCd = 6; P.d = g.d + g.r + 1; (sim as any).zones(P, DT); expect(P.wallCd).toBe(6);
  });
  it('an ion lane speeds up a rider travelling along it, not across it', () => {
    const sim = new CombatSim(base({ rivals: [], modifiers: ['ion-lanes'] })); const P = sim.player, ln = sim.lanes[0]; (sim as any).state = 'active';
    const speedAt = (dir: number) => { P.alive = true; P.x = ln.x; P.z = ln.z; P.dir = dir; P.speed = 24; for (let i = 0; i < 60; i++) { P.x = ln.x; P.z = ln.z; (sim as any).stepCycle(P, idle, DT); } return P.speed; };
    expect(speedAt(0)).toBeGreaterThan(30); expect(speedAt(1)).toBeLessThan(25);
  });
});
