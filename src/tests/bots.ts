// Scripted players used by automated playtests: they drive the same intents a human does.
import { DiscSim, emptyIntent, type DiscIntent } from '../games/discs/sim';
import { planBank } from '../games/discs/ai';
import { CombatSim, type CycleIntent } from '../games/cycles/combat';
import { aiDrive } from '../games/cycles/combatAi';
import { RaceSim } from '../games/cycles/race';

export const DT = 1 / 120;

export function runDiscBot(sim: DiscSim, maxSeconds: number, skill = 1) {
  const it: DiscIntent = emptyIntent(); let hold = 0, gap = 0, strafe = 0, sd = 1, shieldT = 0;
  const steps = Math.round(maxSeconds / DT);
  for (let i = 0; i < steps && sim.state === 'active'; i++) {
    const P = sim.player; it.jump = false; it.dodge = false; it.recall = false;
    let tgt = null as any, bd = 1e9;
    for (const f of sim.fighters) if (f.team === 1 && f.alive && f.spawnT <= 0) { const d = Math.hypot(f.x - P.x, f.z - P.z) + (f.shieldUp ? 15 : 0); if (d < bd) { bd = d; tgt = f; } }
    if (tgt) {
      const tt = bd / 26; let tx = tgt.x + tgt.vx * tt * 0.8, ty = tgt.y + 1.1, tz = tgt.z + tgt.vz * tt * 0.8;
      const ox = P.x, oy = P.y + 1.4, oz = P.z;
      if (sim.blocked(ox, oy, oz, tx, ty, tz) || tgt.arch.shieldUse > 0.8) { const b = planBank(sim, ox, oy, oz, tx, ty, tz); if (b) { tx = b.x; ty = b.y; tz = b.z; } }
      const l = Math.hypot(tx - ox, ty - oy, tz - oz) || 1; it.ax = (tx - ox) / l; it.ay = (ty - oy) / l; it.az = (tz - oz) / l;
    }
    // throw cadence
    gap -= DT;
    if (it.throwHeld) { hold += DT; if (hold > 0.3) { it.throwHeld = false; gap = 0.5 / skill; } }
    else if (gap <= 0 && tgt && sim.heldDiscs(P) > 0 && P.stagger <= 0) { it.throwHeld = true; hold = 0; }
    // defend
    shieldT -= DT; let threat = false;
    for (const d of sim.discs) if (d.state === 'flying' && d.team === 1) { const rx = P.x - d.x, ry = P.y + 1.1 - d.y, rz = P.z - d.z, dist = Math.hypot(rx, ry, rz), sp = Math.hypot(d.vx, d.vy, d.vz) || 1; if ((d.vx * rx + d.vy * ry + d.vz * rz) / (sp * dist) > 0.95 && dist / sp < 0.2 * skill + 0.05) threat = true; }
    if (threat && shieldT <= -0.3) shieldT = 0.3;
    it.shield = shieldT > 0 && !it.throwHeld;
    strafe -= DT; if (strafe <= 0) { strafe = 0.9; sd = -sd; }
    it.mx = sd * 0.8; it.mz = 0;
    const p = sim.platforms[P.platform];
    if (p && p.surgeArmed && p.surge < 0.25) it.jump = true;
    if (p && p.state === 'warn') { it.jump = true; it.mx = sd; }
    if (sim.heldDiscs(P) === 0 && sim.discs.some((d) => d.owner === P.id && d.state === 'flying' && d.age > 1.4)) it.recall = true;
    sim.step(DT, it);
    sim.events.length = 0;
  }
  return sim.state;
}

export function runCombatBot(sim: CombatSim, maxSeconds: number, skill = 0.95) {
  const P = sim.player; const ai = { profile: 'evader' as const, skill, thinkT: 0, slot: 0, lastTurn: 0, intent: { turn: 0, accel: 0, boost: false, ability: false } as CycleIntent };
  const steps = Math.round(maxSeconds / DT);
  for (let i = 0; i < steps && sim.state === 'active'; i++) { P.ai = ai; const it = aiDrive(sim, P, DT); const copy = { ...it }; P.ai = null; sim.step(DT, copy); sim.events.length = 0; }
  return sim.state;
}

export function runRaceBot(sim: RaceSim, maxSeconds: number, skill = 1) {
  const P = sim.player; const steps = Math.round(maxSeconds / DT);
  for (let i = 0; i < steps && sim.state === 'active'; i++) {
    const s = P.skill; P.skill = skill; sim.drive(P, DT); P.skill = s;
    // disc tiers: a player throws whenever a disc is ready (the scripted line is not taught to dodge: a hard swerve at
    // sprint speed costs more than the occasional stall, which is a fair test that a stall never decides a race alone)
    if (sim.discsOn) P.intent.disc = true;
    sim.step(DT, P.intent); sim.events.length = 0;
  }
  return sim.state;
}
