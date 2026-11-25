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
  it('leaning into a rival alongside lands a ram on either side: one impact, a shunt, and a rail takedown', () => {
    const tier = RACE_TIERS.find((t) => t.id === 6)!;
    for (const steer of [1, -1]) {
      const sim = new RaceSim(buildRaceConfig(tier, 'standard', 'blade')), P = sim.player, t = sim.track;
      for (let i = 0; i < 120 * 6; i++) { sim.step(DT, { steer: 0, accel: 1, brake: 0, boost: false, ability: false }); sim.events.length = 0; }
      const R = sim.racers.find((r) => !r.isPlayer && !r.out && r.downT <= 0)!; for (const o of sim.racers) if (o !== P && o !== R) o.out = true;
      (sim as any).drive = (r: any) => { r.intent = { steer: 0, accel: 1, brake: 0, boost: false, ability: false }; };
      P.x -= -t.tz[P.idx] * P.d; P.z -= t.tx[P.idx] * P.d; P.d = 0;
      R.x = P.x - Math.cos(P.h) * steer * 2.6; R.z = P.z + Math.sin(P.h) * steer * 2.6; R.vx = P.vx; R.vz = P.vz; R.speed = P.speed; R.h = P.h; R.idx = P.idx; R.graceT = R.shoveT = 0;
      const ev: any[] = []; for (let i = 0; i < 240; i++) { sim.step(DT, { steer, accel: 1, brake: 0, boost: false, ability: false }); ev.push(...sim.events); sim.events.length = 0; }
      const bumps = ev.filter((e) => e.type === 'bump'); expect(bumps.length, `steer ${steer}`).toBeGreaterThanOrEqual(1); expect(bumps.length).toBeLessThan(4); expect(Math.max(...bumps.map((e) => e.force))).toBeGreaterThan(5);
      expect(ev.some((e) => e.type === 'shunt' && e.by === P.id && e.id === R.id), `steer ${steer}`).toBe(true);
      expect(ev.some((e) => e.type === 'takedown' && e.id === R.id && e.cause === 'rail')).toBe(true);
    }
  });
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

describe('race discs', () => {
  const discTier = () => RACE_TIERS.find((t) => t.modifiers.includes('discs') && t.params.format !== 'pursuit')!;
  /** Puts rival 1 a set distance ahead of the player, in a chosen lane, and lets them both cruise. */
  function setup(ahead: number, laneGap: number) {
    const sim = new RaceSim(buildRaceConfig(discTier(), 'standard', 'azure')); const P = sim.player, R = sim.racers.find((r) => !r.isPlayer)!;
    for (const r of sim.racers) if (r !== P && r !== R) r.out = true;
    const t = sim.track, place = (r: typeof P, idx: number, d: number) => { r.idx = idx; r.d = d; r.lap = 0; r.progress = idx; r.x = t.x[idx] - t.tz[idx] * d; r.z = t.z[idx] + t.tx[idx] * d; r.speed = 30; };
    place(P, 40, 0); place(R, 40 + Math.round(ahead / t.step), laneGap); sim.time = 10; return { sim, P, R };
  }
  it('a disc thrown by the player stalls the rider ahead in its lane', () => {
    const { sim, P, R } = setup(25, 0.5); sim.throwDisc(P); expect(sim.flying).toHaveLength(1);
    let hit: any = null; for (let i = 0; i < 2 / DT && !hit; i++) { R.progress = R.progress; sim.events.length = 0; (sim as any).stepDiscs(DT); hit = sim.events.find((e: any) => e.type === 'discHit'); }
    expect(hit?.id).toBe(R.id); expect(R.stun).toBeGreaterThan(0.9); expect(sim.stats.discHits).toBe(1); expect(P.discCd).toBeGreaterThan(0);
  });
  it('misses a rider who is well out of its lane', () => {
    const { sim, P, R } = setup(25, 6); sim.throwDisc(P); (sim as any).flying[0].target = 0; // a straight throw, no homing
    for (let i = 0; i < 2 / DT; i++) { sim.events.length = 0; (sim as any).stepDiscs(DT); expect(sim.events.some((e: any) => e.type === 'discHit')).toBe(false); }
    void R;
  });
  it('rivals take turns: one disc at the player at a time, at least five seconds apart', () => {
    const { sim, P, R } = setup(-20, 0); void P; (sim as any).rivalDiscT = 0; R.discCd = 0; sim.throwDisc(R); expect(sim.flying).toHaveLength(1);
    R.discCd = 0; sim.throwDisc(R); expect(sim.flying).toHaveLength(1);
    sim.flying.length = 0; R.discCd = 0; sim.throwDisc(R); expect(sim.flying).toHaveLength(0); // the shared timer is still running
  });
});

describe('combat jump ramps', () => {
  /** One player, one far-off rival, four ramps; the player is put just short of the ramp that launches along +X. */
  function rampSim() {
    // two rivals: R carries whatever wall a test needs; the other stays alive far off, so the round stays open
    const cfg: CombatConfig = { half: 70, seed: 3, speed: 24, rivals: [{ profile: 'evader', skill: 0.1, model: 'ember' }, { profile: 'evader', skill: 0.1, model: 'jade' }], modifiers: ['ramps'], pillars: 0, aiSkill: 0, hazardMul: 1, resources: 1 } as any;
    const sim = new CombatSim(cfg); const P = sim.player, rp = sim.ramps.find((r) => DIRS[r.dir][0] === 1)!, R = sim.cycles[1], far = sim.cycles[2];
    for (const c of [R, far]) { c.x = -60; c.z = -62; c.px = c.x; c.pz = c.z; c.trail = [c.x, c.z]; c.dir = 1; } far.x = far.px = -50; far.trail = [far.x, far.z];
    sim.arrows.length = 0; // the base jump; arrows are tested on their own below
    P.dir = rp.dir; P.x = rp.x - rp.len / 2 - 2; P.z = rp.z; P.px = P.x; P.pz = P.z; P.trail = [P.x, P.z]; P.speed = 24;
    return { sim, P, rp, R };
  }
  const idle: CycleIntent = { turn: 0, accel: 0, boost: false, ability: false };
  it('launches a rider who rides up a ramp in its direction, and leaves a gap in the trail', () => {
    const { sim, P } = rampSim(); let jumped = false, landed = false;
    for (let i = 0; i < 2 / DT && !landed; i++) { sim.events.length = 0; sim.step(DT, idle); for (const e of sim.events as any[]) { if (e.type === 'jump' && e.player) jumped = true; if (e.type === 'land' && e.player) landed = true; } }
    expect(jumped).toBe(true); expect(landed).toBe(true); expect(P.alive).toBe(true);
    const gaps = P.trail.filter((v) => v !== v).length; expect(gaps).toBe(2);
  });
  it('flies over a wall in its path, but a landing on one is a crash', () => {
    /** A finished wall from a rider that stopped at its far end (a dead rider's wall runs on to where it stopped). */
    const wall = (o: ReturnType<typeof rampSim>, x0: number, z0: number, x1: number, z1: number) => { o.R.trail = [x0, z0]; o.R.x = o.R.px = x1; o.R.z = o.R.pz = z1; o.R.alive = false; o.R.trailGone = false; o.R.deathT = 1e9; };
    const over = rampSim(); const wx = over.rp.x + 6; wall(over, wx, over.rp.z - 10, wx, over.rp.z + 10);
    for (let i = 0; i < 1.5 / DT; i++) over.sim.step(DT, idle); expect(over.P.alive).toBe(true);
    const onto = rampSim(); const land = onto.rp.x + onto.rp.len / 2 + 24 * 0.85; wall(onto, land - 3, onto.rp.z, land + 3, onto.rp.z);
    let crashed = false; for (let i = 0; i < 2 / DT && !crashed; i++) { onto.sim.events.length = 0; onto.sim.step(DT, idle); crashed = (onto.sim.events as any[]).some((e) => e.type === 'crash' && e.player); }
    expect(crashed).toBe(true);
  });
  it('does not launch a rider crossing a ramp sideways, and has no ramps on other tiers', () => {
    const { sim, P, rp } = rampSim(); P.dir = 1; P.x = rp.x; P.z = rp.z - 8; P.px = P.x; P.pz = P.z; P.trail = [P.x, P.z];
    let jumped = false; for (let i = 0; i < 0.8 / DT; i++) { sim.events.length = 0; sim.step(DT, idle); jumped ||= (sim.events as any[]).some((e) => e.type === 'jump' && e.player); }
    expect(jumped).toBe(false); expect(new CombatSim(buildCombatConfig(COMBAT_TIERS[0], 'standard')).ramps).toHaveLength(0);
  });
});

describe('race balance', () => {
  it('locks every light wall for the opening seconds, so the start cannot take the grid out', () => {
    const t = RACE_TIERS.find((x) => x.modifiers.includes('lightwalls'))!; const sim = new RaceSim(buildRaceConfig(t, 'standard', 'azure'));
    for (const r of sim.racers) expect(r.wallCd).toBeGreaterThanOrEqual(10);
  });
  it('gives early-tier rivals a skill floor that fades out by tier 14', () => {
    const early = RACE_TIERS.find((x) => x.id === 2)!, late = RACE_TIERS.find((x) => x.id >= 16)!;
    const e = buildRaceConfig(early, 'standard', 'azure'), l = buildRaceConfig(late, 'standard', 'azure');
    expect(e.rivals[0].skill).toBeGreaterThan(early.enemies[0].difficulty + 0.15);
    expect(l.rivals[0].skill).toBeCloseTo(late.enemies[0].difficulty, 5);
  });
});

describe('combat arrows, decks and discs', () => {
  const base = (mods: string[]) => ({ half: 70, seed: 3, speed: 24, rivals: [{ profile: 'evader', skill: 0.1, model: 'ember' }, { profile: 'evader', skill: 0.1, model: 'jade' }], modifiers: mods, pillars: 0, aiSkill: 0, hazardMul: 1, resources: 1 }) as any as CombatConfig;
  const idle: CycleIntent = { turn: 0, accel: 0, boost: false, ability: false };
  const park = (sim: CombatSim) => { for (const c of sim.cycles.slice(1)) { c.x = c.px = -60; c.z = c.pz = -62 + c.id; c.trail = [c.x, c.z]; c.trailLvl = [0]; c.dir = 1; c.discCd = 1e9; } };
  it('boost arrows throw a rider to surge speed, and the jump after them flies further', () => {
    const sim = new CombatSim(base(['ramps'])); park(sim); const P = sim.player, ar = sim.arrows.find((a) => DIRS[a.dir][0] === 1)!;
    P.dir = ar.dir; P.x = P.px = ar.x - ar.len / 2 - 1; P.z = P.pz = ar.z; P.trail = [P.x, P.z]; P.trailLvl = [0]; P.speed = 24;
    let arrow = false, dur = 0; for (let i = 0; i < 2 / DT && !dur; i++) { sim.events.length = 0; sim.step(DT, idle); for (const e of sim.events as any[]) { if (e.type === 'arrow' && e.player) arrow = true; if (e.type === 'jump' && e.player) dur = P.airDur; } }
    expect(arrow).toBe(true); expect(dur).toBeGreaterThan(1.2);
  });
  it('a jump off a deck ramp lands the rider on the deck, where walls on the grid below do not touch it', () => {
    const sim = new CombatSim(base(['decks'])); park(sim); const P = sim.player, rp = sim.ramps.find((r) => r.dir === 0)!, d = sim.decks[0];
    P.dir = 0; P.x = P.px = rp.x - 6; P.z = P.pz = rp.z; P.trail = [P.x, P.z]; P.trailLvl = [0]; P.speed = 24;
    // a wall on the grid right across the deck, which a rider on the deck passes over
    const R = sim.cycles[1]; R.trail = [d.x + 4, d.z - 10]; R.trailLvl = [0]; R.x = R.px = d.x + 4; R.z = R.pz = d.z + 10; R.alive = false; R.trailGone = false; R.deathT = 1e9;
    let onDeck = false; for (let i = 0; i < 2.2 / DT && P.alive; i++) { sim.step(DT, idle); if (P.lvl === 1) onDeck = true; }
    expect(onDeck).toBe(true); expect(P.alive).toBe(true);
  });
  it('a disc from the player crashes a rival in its line, and is stopped by a wall', () => {
    const sim = new CombatSim(base(['discs'])); park(sim); const P = sim.player, R = sim.cycles[1];
    P.dir = 0; P.x = P.px = -20; P.z = P.pz = 0; P.trail = [P.x, P.z]; P.trailLvl = [0]; R.x = R.px = 8; R.z = R.pz = 0; R.dir = 2; R.trail = [R.x + 0.5, 0]; R.trailLvl = [0]; R.ai!.thinkT = 1e9; R.ai!.intent.turn = 0; // coming head-on down the disc's line, its wall behind it, not turning
    sim.throwGridDisc(P); let hit = false; for (let i = 0; i < 1 / DT && !hit; i++) { sim.events.length = 0; sim.step(DT, idle); hit = (sim.events as any[]).some((e) => e.type === 'cdiscHit' && e.id === R.id); }
    expect(hit).toBe(true); expect(R.alive).toBe(false);
    const s2 = new CombatSim(base(['discs'])); park(s2); const P2 = s2.player, W = s2.cycles[1];
    P2.dir = 0; P2.x = P2.px = -20; P2.z = P2.pz = 0; P2.trail = [P2.x, P2.z]; P2.trailLvl = [0]; W.trail = [-5, -8, -5, 8]; W.trailLvl = [0, 0]; W.x = W.px = -5; W.z = W.pz = 8; W.alive = false; W.trailGone = false; W.deathT = 1e9;
    s2.throwGridDisc(P2); let spent = false; for (let i = 0; i < 1 / DT && !spent; i++) { s2.events.length = 0; s2.step(DT, idle); spent = (s2.events as any[]).some((e) => e.type === 'cdiscSpent'); }
    expect(spent).toBe(true);
  });
});
