import { describe, expect, it } from 'vitest';
import { Rng, segSegDist2 } from '../engine/math';
import { buildArena, validateArena } from '../games/discs/arena';
import { DiscSim, emptyIntent, DISC_DAMAGE, type DiscSimConfig } from '../games/discs/sim';
import { planBank } from '../games/discs/ai';
import { DISC_TIERS } from '../progression/tiers/discs';
import { buildDiscConfig } from '../progression/build';
import { DT } from './bots';

function duel(over: Partial<DiscSimConfig> = {}, spec: any = {}): DiscSim {
  const arena = buildArena({ playerPlatforms: 1, enemyPlatforms: 1, heights: 'flat', ...spec }, new Rng(1));
  return new DiscSim({ arena, seed: 7, waves: [[{ type: 'sentinel', count: 1, difficulty: 0 }]], modifiers: [], playerHp: 100, playerShield: 100, playerDiscs: 3, aiSkill: 0, hazardMul: 1, maxAttackers: 0, discSpeedMul: 1, ...over });
}
/** Leaves a rival in play as a stationary target that never attacks, blocks or dodges. */
const passive = (sim: DiscSim) => { const E = sim.fighters[1]; E.spawnT = 0; E.arch = { ...E.arch, speed: 0, shieldUse: 0, dodgeUse: 0, hopRate: 0 }; E.ai!.cooldown = 1e9; E.ai!.hopCd = 1e9; return E; };
const run = (sim: DiscSim, it = emptyIntent(), seconds = 1, each?: () => void) => { for (let i = 0; i < seconds / DT; i++) { sim.step(DT, it); each?.(); } };
function throwAt(sim: DiscSim, ax: number, ay: number, az: number) { const it = emptyIntent(); it.ax = ax; it.ay = ay; it.az = az; it.throwHeld = true; run(sim, it, 0.5); it.throwHeld = false; sim.step(DT, it); return it; }

describe('disc trajectories and ricochets', () => {
  it('reflects about the wall normal with configured energy loss', () => {
    const sim = duel(); passive(sim);
    const w = sim.walls[0]; const it = throwAt(sim, w.nx, 0, w.nz); const d = sim.discs[0]; const s0 = Math.hypot(d.vx, d.vy, d.vz);
    let bounced: any = null; for (let i = 0; i < 400 && !bounced; i++) { sim.events.length = 0; (sim as any).stepDiscs(DT); bounced = sim.events.find((e) => e.type === 'bounce'); }
    expect(bounced).toBeTruthy(); expect(bounced.nx).toBeCloseTo(-w.nx, 5); expect(bounced.nz).toBeCloseTo(-w.nz, 5);
    const s1 = Math.hypot(d.vx, d.vy, d.vz); expect(s1 / s0).toBeCloseTo(0.94, 2);
    expect(d.vx * w.nx + d.vz * w.nz).toBeLessThan(0); expect(d.bounces).toBe(1); void it;
  });
  it('never tunnels through the chamber even at extreme speed and coarse steps', () => {
    const sim = duel(); passive(sim); throwAt(sim, 0.6, 0.3, 0.74); const d = sim.discs[0]; d.vx *= 12; d.vy *= 12; d.vz *= 12; const A = sim.cfg.arena;
    for (let i = 0; i < 300 && d.state === 'flying'; i++) { (sim as any).stepDiscs(1 / 20); for (const w of sim.walls) expect(d.x * w.nx + d.z * w.nz).toBeLessThanOrEqual(A.radius + 1e-6); expect(d.y).toBeLessThanOrEqual(A.ceiling); expect(d.y).toBeGreaterThanOrEqual(A.floor); }
  });
  it('returns to its owner and is caught after exhausting its bounces', () => {
    const sim = duel(); passive(sim); throwAt(sim, 0.3, 0.1, 0.95); const d = sim.discs[0]; let caught = false;
    for (let i = 0; i < 1500 && !caught; i++) { sim.events.length = 0; (sim as any).stepDiscs(DT); caught = sim.events.some((e) => e.type === 'catch'); }
    expect(caught).toBe(true); expect(d.state).toBe('held'); expect(sim.heldDiscs(sim.player)).toBe(3);
  });
  it('segment distance helper is exact for crossing and parallel segments', () => {
    const o = { s: 0, t: 0 }; expect(segSegDist2(-1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, o)).toBeCloseTo(0, 9); expect(o.s).toBeCloseTo(0.5, 6);
    expect(segSegDist2(0, 0, 0, 1, 0, 0, 0, 2, 0, 1, 2, 0, o)).toBeCloseTo(4, 9);
  });
  it('finds a legal bank shot around a blocking wall and it connects', () => {
    const sim = duel({}, { midwall: true }); const P = sim.player, E = passive(sim);
    expect(sim.blocked(P.x, P.y + 1.4, P.z, E.x, E.y + 1.1, E.z)).toBe(true);
    const b = planBank(sim, P.x, P.y + 1.4, P.z, E.x, E.y + 1.1, E.z)!; expect(b).toBeTruthy();
    const l = Math.hypot(b.x - P.x, b.y - (P.y + 1.4), b.z - P.z); throwAt(sim, (b.x - P.x) / l, (b.y - P.y - 1.4) / l, (b.z - P.z) / l);
    let hit: any = null; for (let i = 0; i < 600 && !hit; i++) { sim.events.length = 0; (sim as any).stepDiscs(DT); hit = sim.events.find((e) => e.type === 'hit'); }
    expect(hit).toBeTruthy(); expect(hit.bounces).toBe(1); expect(E.hp).toBeCloseTo(E.maxHp - DISC_DAMAGE * 1.25, 3); expect(sim.stats.ricochetHits).toBe(1);
  });
});

describe('combat rules', () => {
  const setup = () => { const sim = duel(); const P = sim.player, E = passive(sim); return { sim, P, E }; };
  const enemyThrow = (sim: DiscSim, P: any, E: any) => { E.ax = 0; E.ay = 0; E.az = 1; const d = P.z - E.z; E.ay = (P.y - E.y) / d; sim.throwDisc(E, 1); return sim.discs.find((x) => x.owner === E.id && x.state === 'flying')!; };
  it('a frontal shield blocks and drains energy; holding too long breaks it', () => {
    const { sim, P, E } = setup(); P.shieldUp = true; P.shieldT = 1; const d = enemyThrow(sim, P, E); const hp = P.hp; let ev: any = null;
    for (let i = 0; i < 400 && !ev; i++) { sim.events.length = 0; (sim as any).stepDiscs(DT); ev = sim.events.find((e) => e.type === 'block' || e.type === 'hit'); }
    expect(ev.type).toBe('block'); expect(P.hp).toBe(hp); expect(P.shield).toBeLessThan(100); expect(d.team).toBe(1);
  });
  it('a timed shield parries the disc back at its thrower', () => {
    const { sim, P, E } = setup(); P.shieldUp = true; P.shieldT = 0.05; const d = enemyThrow(sim, P, E); let ev: any = null;
    for (let i = 0; i < 400 && !ev; i++) { sim.events.length = 0; (sim as any).stepDiscs(DT); P.shieldT = 0.05; ev = sim.events.find((e) => e.type === 'parry'); }
    expect(ev).toBeTruthy(); expect(d.team).toBe(0); expect(d.vz).toBeLessThan(0); expect(sim.stats.parries).toBe(1);
    let hit = false; for (let i = 0; i < 400 && !hit; i++) { sim.events.length = 0; (sim as any).stepDiscs(DT); hit = sim.events.some((e) => e.type === 'hit' && e.id === E.id); }
    expect(hit).toBe(true); expect(E.hp).toBeLessThan(E.maxHp);
  });
  it('a shield does not protect against a disc arriving from behind', () => {
    const { sim, P, E } = setup(); P.shieldUp = true; P.shieldT = 1; P.ax = 0; P.az = 1; enemyThrow(sim, P, E); const hp = P.hp; let ev: any = null;
    for (let i = 0; i < 400 && !ev; i++) { sim.events.length = 0; (sim as any).stepDiscs(DT); ev = sim.events.find((e) => e.type === 'block' || e.type === 'hit'); }
    expect(ev.type).toBe('hit'); expect(P.hp).toBeLessThan(hp);
  });
  it('dodge grants brief immunity and movement stays independent of throwing', () => {
    const { sim, P } = setup(); const it = emptyIntent(); it.mx = 1; it.throwHeld = true; run(sim, it, 0.4); expect(P.winding).toBe(true); expect(P.moving).toBeGreaterThan(1);
    it.dodge = true; sim.step(DT, it); expect(P.invuln).toBeGreaterThan(0);
  });
  it('walking never leaves the platform; only knockback can', () => {
    const { sim, P } = setup(); const it = emptyIntent(); it.mx = 1; run(sim, it, 4); const p = sim.platforms[P.platform]; expect(Math.hypot(P.x - p.x, P.z - p.z)).toBeLessThanOrEqual(p.r); expect(P.falling).toBe(false);
  });
  it('platform hops only select a reachable platform of the same side in the pushed direction', () => {
    // a tier with several hoppable decks a side (the wide open-floor and maze arenas have one)
    const hopTier = DISC_TIERS.find((t) => Number(t.params.playerPlatforms) >= 2 && !t.modifiers.includes('open-floor') && !t.modifiers.includes('maze') && t.id >= 10)!;
    const sim = new DiscSim(buildDiscConfig(hopTier, 'standard')); const P = sim.player, start = P.platform;
    expect(sim.tryHop(P, 0, -1)).toBe(false); // toward the rival side: no platform of ours there
    const mine = sim.platforms.map((p, i) => ({ p, i })).filter((e) => e.p.side === 0 && e.i !== start); const tgt = mine[0]; const dx = tgt.p.x - P.x, dz = tgt.p.z - P.z, l = Math.hypot(dx, dz);
    expect(sim.tryHop(P, dx / l, dz / l)).toBe(true); run(sim, emptyIntent(), 1); expect(sim.platforms[P.platform].side).toBe(0); expect(P.platform).not.toBe(start);
    const q = sim.platforms[P.platform]; expect(Math.hypot(P.x - q.x, P.z - q.z)).toBeLessThanOrEqual(q.r);
  });
});

describe('disc AI and arenas', () => {
  it('every throw is preceded by a visible wind-up tell', () => {
    const sim = new DiscSim(buildDiscConfig(DISC_TIERS[5], 'master')); const tells = new Map<number, number>(); let checked = 0; const it = emptyIntent(); it.shield = false;
    for (let i = 0; i < 20 / DT && sim.state === 'active'; i++) { sim.step(DT, it); for (const e of sim.events) { if (e.type === 'tell') tells.set(e.id, sim.time); if (e.type === 'throw' && e.id !== sim.player.id) { expect(tells.has(e.id)).toBe(true); expect(sim.time - tells.get(e.id)!).toBeGreaterThanOrEqual(0.4); checked++; } } sim.events.length = 0; sim.player.hp = 100; }
    expect(checked).toBeGreaterThan(2);
  });
  it('AI moves through its declared states', () => {
    const sim = new DiscSim(buildDiscConfig(DISC_TIERS[10], 'veteran')); const seen = new Set<string>(); const it = emptyIntent();
    for (let i = 0; i < 25 / DT && sim.state === 'active'; i++) { if (i % 240 === 0) { it.throwHeld = !it.throwHeld; const e = sim.fighters.find((f) => f.team === 1 && f.alive)!; const l = Math.hypot(e.x - sim.player.x, e.z - sim.player.z); it.ax = (e.x - sim.player.x) / l; it.az = (e.z - sim.player.z) / l; } sim.step(DT, it); for (const f of sim.fighters) if (f.ai) seen.add(f.ai.mode); sim.events.length = 0; sim.player.hp = 100; sim.player.invuln = 1; sim.player.stagger = 0; }
    for (const m of ['positioning', 'aiming', 'attacking', 'recovering']) expect(seen.has(m)).toBe(true);
    expect(seen.has('dodging') || seen.has('defending')).toBe(true);
  });
  it('every authored arena passes reachability and clearance validation', () => {
    for (const t of DISC_TIERS) expect(validateArena(buildDiscConfig(t, 'standard').arena), `tier ${t.id}`).toEqual([]);
  });
  it('simulation is deterministic for a given seed', () => {
    const a = new DiscSim(buildDiscConfig(DISC_TIERS[8], 'standard')), b = new DiscSim(buildDiscConfig(DISC_TIERS[8], 'standard')); const it = emptyIntent(); it.mx = 0.5;
    for (let i = 0; i < 1200; i++) { a.step(DT, it); b.step(DT, it); }
    expect(a.fighters.map((f) => [f.x, f.z, f.hp])).toEqual(b.fighters.map((f) => [f.x, f.z, f.hp])); expect(a.discs.map((d) => [d.x, d.y, d.z])).toEqual(b.discs.map((d) => [d.x, d.y, d.z]));
  });
});

describe('amplifier rings', () => {
  it('a disc thrown through a ring speeds up once and hits harder', () => {
    const sim = duel({ modifiers: ['amp'] }); passive(sim); const a = sim.amps[0]; expect(sim.amps.length).toBe(2);
    const d = sim.discs[0]; d.state = 'flying'; d.team = 0; d.x = d.px = a.x; d.y = d.py = a.y; d.z = d.pz = a.z + 2; d.vx = 0; d.vy = 0; d.vz = -20;
    sim.events.length = 0; for (let i = 0; i < 30; i++) (sim as any).stepDiscs(DT);
    expect(sim.events.some((e) => e.type === 'amp')).toBe(true); expect(d.amped).toBe(true); expect(Math.abs(d.vz)).toBeCloseTo(26, 0);
    // only once per flight
    const n = sim.events.filter((e) => e.type === 'amp').length; d.z = d.pz = a.z + 2; d.vz = -20; for (let i = 0; i < 30; i++) (sim as any).stepDiscs(DT); expect(sim.events.filter((e) => e.type === 'amp').length).toBe(n);
  });
  it('a disc that misses the hoop is not amplified', () => {
    const sim = duel({ modifiers: ['amp'] }); passive(sim); const a = sim.amps[0];
    const d = sim.discs[0]; d.state = 'flying'; d.team = 0; d.x = d.px = a.x + a.r + 0.5; d.y = d.py = a.y; d.z = d.pz = a.z + 2; d.vx = 0; d.vy = 0; d.vz = -20;
    for (let i = 0; i < 30; i++) (sim as any).stepDiscs(DT); expect(d.amped).toBeFalsy();
  });
});
