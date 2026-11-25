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
