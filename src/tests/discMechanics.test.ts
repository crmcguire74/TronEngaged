import { describe, expect, it } from 'vitest';
import { Rng } from '../engine/math';
import { buildArena } from '../games/discs/arena';
import { DiscSim, emptyIntent, type DiscSimConfig } from '../games/discs/sim';
import { DISC_TIERS } from '../progression/tiers/discs';
import { DT } from './bots';

/** One rival on one deck, with the given modifiers; the rival is frozen so only the mechanic under test acts. */
function arena(modifiers: string[], spec: any = {}, over: Partial<DiscSimConfig> = {}): DiscSim {
  const a = buildArena({ playerPlatforms: 1, enemyPlatforms: 1, heights: 'flat', ...spec }, new Rng(1));
  const sim = new DiscSim({ arena: a, seed: 7, waves: [[{ type: 'sentinel', count: 1, difficulty: 0 }]], modifiers, playerHp: 100, playerShield: 100, playerDiscs: 3, aiSkill: 0, hazardMul: 1, maxAttackers: 0, discSpeedMul: 1, ...over });
  const E = sim.fighters[1]; E.spawnT = 0; E.arch = { ...E.arch, speed: 0, shieldUse: 0, dodgeUse: 0, hopRate: 0 }; E.ai!.cooldown = 1e9; E.ai!.hopCd = 1e9;
  return sim;
}
const run = (sim: DiscSim, seconds: number, it = emptyIntent()) => { for (let i = 0; i < seconds / DT; i++) sim.step(DT, it); };
/** Throws the player's next disc straight along (ax, ay, az). */
function throwDir(sim: DiscSim, ax: number, ay: number, az: number) { const l = Math.hypot(ax, ay, az), it = emptyIntent(); it.ax = ax / l; it.ay = ay / l; it.az = az / l; it.throwHeld = true; run(sim, 0.4, it); it.throwHeld = false; sim.step(DT, it); }

describe('core breach', () => {
  it('blocks a disc that meets the shield away from the gap', () => {
    const sim = arena(['core']); const c = sim.core!; c.spin = 0; c.rot = -Math.PI / 2; // sim angles run +X towards +Z: -90 degrees faces away from the player
    const P = sim.player; throwDir(sim, c.x - P.x, c.y - (P.y + 1.4), c.z - P.z);
    let shell = false; for (let i = 0; i < 400 && !shell; i++) { sim.events.length = 0; sim.step(DT, emptyIntent()); shell = sim.events.some((e) => e.type === 'bounce' && e.kind === 'shell'); }
    expect(shell).toBe(true); expect(c.hp).toBe(c.max);
  });
  it('takes a hit through the gap, and six hits derez every rival and win', () => {
    const sim = arena(['core']); const c = sim.core!; c.spin = 0; c.rot = Math.atan2(sim.player.z - c.z, sim.player.x - c.x); // the gap faces the player
    for (let n = 0; n < 6 && sim.state === 'active'; n++) {
      const P = sim.player; throwDir(sim, c.x - P.x, c.y - (P.y + 1.4), c.z - P.z);
      for (let i = 0; i < 600 && sim.heldDiscs(P) < 3 && sim.state === 'active'; i++) sim.step(DT, emptyIntent());
    }
    expect(c.hp).toBe(0); expect(sim.state).toBe('won'); expect(sim.fighters.filter((f) => f.team === 1 && f.alive)).toHaveLength(0);
  });
});

describe('rally', () => {
  it('rises with hits, speeds throws, and resets when the player is hit', () => {
    const sim = arena(['rally']); (sim as any).raiseRally(0.3); expect(sim.rally).toBeCloseTo(1.3, 5);
    const P = sim.player, E = sim.fighters[1]; throwDir(sim, E.x - P.x, 0, E.z - P.z); const d = sim.discs.find((x) => x.state === 'flying')!;
    expect(Math.hypot(d.vx, d.vy, d.vz)).toBeGreaterThan(P.arch.throwSpeed * 1.1);
    sim.damage(P, 5, 0, 0, 'disc'); expect(sim.rally).toBe(1);
    (sim as any).raiseRally(5); expect(sim.rally).toBe(1.6);
  });
  it('does nothing on tiers without it', () => { const sim = arena([]); (sim as any).raiseRally(0.5); expect(sim.rally).toBe(1); });
});

describe('power nodes', () => {
  it('spawn on the player side, prefer another deck, and are taken by standing on them', () => {
    const sim = arena(['pickups'], { playerPlatforms: 2 }); sim.nodeT = 0; run(sim, 0.05);
    expect(sim.nodes).toHaveLength(1); const n = sim.nodes[0]; expect(sim.platforms[n.platform].side).toBe(0); expect(n.platform).not.toBe(sim.player.platform);
    const P = sim.player; P.platform = n.platform; P.x = n.x; P.y = n.y; P.z = n.z; P.hp = 50; sim.events.length = 0; sim.step(DT, emptyIntent());
    expect(sim.events.some((e) => e.type === 'node')).toBe(true); expect(sim.nodes).toHaveLength(0);
    expect(n.kind === 'mend' ? P.hp > 50 : sim.buff === n.kind).toBe(true);
  });
  it('a Split charge fans one throw into three, and the copies derez instead of returning', () => {
    const sim = arena(['pickups']); sim.buff = 'split'; const P = sim.player; throwDir(sim, 0.2, 0.05, -1);
    expect(sim.discs.filter((d) => d.state === 'flying')).toHaveLength(3); expect(sim.buff).toBe('');
    run(sim, 6); expect(sim.discs.filter((d) => d.temp)).toHaveLength(0); expect(sim.heldDiscs(P)).toBe(3);
  });
  it('a Pierce charge turns the next throw into a lance', () => {
    const sim = arena(['pickups']); sim.buff = 'pierce'; throwDir(sim, 0, 0, -1); expect(sim.discs.find((d) => d.state === 'flying')!.weapon).toBe('lance');
  });
});

describe('tier ladder variety', () => {
  it('rotates the three new systems through the ladder, never on a boss tier for the core', () => {
    for (const m of ['rally', 'core', 'pickups']) expect(DISC_TIERS.filter((t) => t.modifiers.includes(m)).length).toBeGreaterThanOrEqual(4);
    for (const t of DISC_TIERS) if (t.modifiers.includes('core')) expect(t.boss).toBeUndefined();
    // no two neighbouring tiers share the same new system
    const tag = (t: any) => ['rally', 'core', 'pickups'].find((m) => t.modifiers.includes(m)) ?? '';
    for (let i = 1; i < DISC_TIERS.length; i++) if (tag(DISC_TIERS[i])) expect(tag(DISC_TIERS[i])).not.toBe(tag(DISC_TIERS[i - 1]));
  });
});

describe('cutter beams', () => {
  /** A rival disc flown straight through where the player stands, laying its beam as it goes. */
  function flyThrough(sim: DiscSim) {
    const P = sim.player, E = sim.fighters[1], d = sim.discs.find((x) => x.owner === E.id)!;
    d.state = 'flying'; d.team = 1; d.x = P.x - 6; d.y = P.y + 1; d.z = P.z; d.vx = 12; d.vy = 0; d.vz = 0; d.homing = 0; d.hit.clear(); d.hit.add(P.id);
    return d;
  }
  it('lays a beam behind a rival disc and cuts the player once per window', () => {
    const sim = arena(['cutter']); const P = sim.player, hp = P.hp; flyThrough(sim);
    const cuts: number[] = []; for (let i = 0; i < 1.4 / DT; i++) { sim.events.length = 0; sim.step(DT, emptyIntent()); if (sim.events.some((e) => e.type === 'beamCut')) cuts.push(sim.time); }
    expect(cuts.length).toBeGreaterThanOrEqual(1); expect(P.hp).toBeLessThan(hp);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeGreaterThanOrEqual(0.79);
  });
  it('lets a dodge pass through unharmed, and lays no beam on tiers without it', () => {
    const sim = arena(['cutter']); const P = sim.player, hp = P.hp; flyThrough(sim);
    for (let i = 0; i < 1.4 / DT; i++) { P.invuln = 1; sim.step(DT, emptyIntent()); } expect(P.hp).toBe(hp);
    const plain = arena([]); flyThrough(plain); for (let i = 0; i < 0.6 / DT; i++) plain.step(DT, emptyIntent()); expect(plain.discs.every((d) => !d.beam?.length)).toBe(true);
  });
});

describe('wide arenas', () => {
  const mazeTier = () => DISC_TIERS.find((t) => t.modifiers.includes('maze'))!;
  it('builds one wide deck a side for open and maze tiers, with pillars only in the maze', async () => {
    const { buildDiscConfig } = await import('../progression/build');
    const open = buildDiscConfig(DISC_TIERS.find((t) => t.modifiers.includes('open-floor'))!, 'standard').arena, maze = buildDiscConfig(mazeTier(), 'standard').arena;
    for (const a of [open, maze]) { expect(a.platforms).toHaveLength(2); expect(a.platforms.every((p) => p.r > 8)).toBe(true); }
    expect(open.barriers.some((b) => b.pillar)).toBe(false); expect(maze.barriers.filter((b) => b.pillar).length).toBeGreaterThanOrEqual(10);
  });
  it('stops a fighter walking into a pillar', async () => {
    const { buildDiscConfig } = await import('../progression/build');
    const sim = new DiscSim(buildDiscConfig(mazeTier(), 'standard')); const P = sim.player, pil = sim.barriers.find((b) => b.def.pillar && Math.abs(b.z - P.z) < 11)!;
    P.x = pil.x - 3; P.z = pil.z; const it = emptyIntent(); it.mx = 1; it.mz = 0;
    for (let i = 0; i < 2 / DT; i++) { sim.step(DT, it); const c = Math.cos(pil.yaw), s = Math.sin(pil.yaw), rx = P.x - pil.x, rz = P.z - pil.z, lx = rx * c - rz * s, lz = rx * s + rz * c; expect(Math.abs(lx) < pil.def.hx && Math.abs(lz) < pil.def.hz).toBe(false); }
  });
  it('sends maze rivals to cover the player cannot see', async () => {
    const { buildDiscConfig } = await import('../progression/build');
    const sim = new DiscSim(buildDiscConfig(mazeTier(), 'standard')); expect(sim.maze).toBe(true);
    let hidden = 0, samples = 0; for (let i = 0; i < 12 / DT; i++) { sim.step(DT, emptyIntent()); if (i % 60 === 0) for (const f of sim.fighters) if (f.team === 1 && f.alive && f.ai && f.ai.cooldown > 0.6) { samples++; const p = sim.platforms[f.platform]; if (sim.blocked(sim.player.x, sim.player.y + 1.3, sim.player.z, p.x + f.ai.tx, p.y + 1.3, p.z + f.ai.tz)) hidden++; } }
    expect(samples).toBeGreaterThan(0); expect(hidden / samples).toBeGreaterThan(0.3);
  });
});
