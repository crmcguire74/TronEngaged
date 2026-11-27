import { clamp } from '../../engine/math';
import type { DiscIntent, DiscSim, Fighter } from './sim';

/** States required by PRD 12.1: positioning, aiming, attacking, defending, dodging, recovering, retreating. */
export type AiMode = 'positioning' | 'aiming' | 'attacking' | 'defending' | 'dodging' | 'recovering' | 'retreating';
export interface AiState {
  skill: number; mode: AiMode; cooldown: number; burstLeft: number; burstGap: number; windT: number; throwHeld: boolean;
  moveT: number; tx: number; tz: number; aimX: number; aimY: number; aimZ: number;
  seen: Set<number>; shieldHold: number; hopCd: number; specialT: number; commanded: number; recoverT: number;
  intent: DiscIntent;
}

export function initAi(sim: DiscSim, f: Fighter, skill: number): AiState {
  return {
    skill, mode: 'positioning', cooldown: sim.rng.range(1.4, 2.6), burstLeft: 0, burstGap: 0, windT: 0, throwHeld: false,
    moveT: 0, tx: 0, tz: 0, aimX: 0, aimY: 0, aimZ: 1, seen: new Set(), shieldHold: 0, hopCd: sim.rng.range(2, 5), specialT: sim.rng.range(7, 10), commanded: 0, recoverT: 0,
    intent: { mx: 0, mz: 0, ax: 0, ay: 0, az: 1, throwHeld: false, shield: false, jump: false, dodge: false, recall: false },
  };
}

/**
 * Evaluates ricochet opportunities: mirrors the target across each chamber wall and each fixed deflector panel,
 * keeps the bounce points that are really on the surface with both legs unobstructed, and returns the shortest.
 */
export function planBank(sim: DiscSim, ox: number, oy: number, oz: number, tx: number, ty: number, tz: number, jitter = 0): { x: number; y: number; z: number } | null {
  const A = sim.cfg.arena; let best = Infinity, bx = 0, by = 0, bz = 0;
  const consider = (nx: number, nz: number, off: number, ok: (hx: number, hy: number, hz: number) => boolean, ignore?: any) => {
    // plane: dot(p, n) = off, with the origin on the negative side
    const so = ox * nx + oz * nz - off, st = tx * nx + tz * nz - off; if (so >= -0.01 || st >= -0.01) return;
    const mx = tx - 2 * st * nx, mz = tz - 2 * st * nz, dx = mx - ox, dz = mz - oz, den = dx * nx + dz * nz; if (den <= 0.01) return;
    const t = -so / den; if (t <= 0 || t >= 1) return;
    const hx = ox + dx * t, hz = oz + dz * t, hy = oy + (ty - oy) * t;
    if (!ok(hx, hy, hz) || sim.blocked(ox, oy, oz, hx, hy, hz, ignore) || sim.blocked(hx, hy, hz, tx, ty, tz, ignore)) return;
    const len = Math.hypot(dx, dz) + (jitter ? sim.rng.range(0, jitter) : 0);
    if (len < best) { best = len; bx = mx; by = ty; bz = mz; }
  };
  for (const w of sim.walls) consider(w.nx, w.nz, A.radius - 0.2, (hx, _hy, hz) => { for (const o of sim.walls) if (o !== w && hx * o.nx + hz * o.nz > A.radius + 0.01) return false; return true; });
  for (const b of sim.barriers) {
    if (!b.alive || b.def.hp > 0 || b.def.orbit || b.def.spin || b.def.hz > 0.6) continue;
    const s = Math.sin(b.yaw), c = Math.cos(b.yaw);
    for (const sg of [1, -1]) {
      // face normal points away from the panel; the thrower must be in front of that face, so use the inward plane (-n)
      const nx = -s * sg, nz = -c * sg, off = b.x * nx + b.z * nz - b.def.hz - 0.2;
      consider(nx, nz, off, (hx, hy, hz) => { const lx = (hx - b.x) * c - (hz - b.z) * s; return Math.abs(lx) < b.def.hx - 0.3 && Math.abs(hy - b.y) < b.def.hy - 0.2; }, b);
    }
  }
  return best < Infinity ? { x: bx, y: by, z: bz } : null;
}

/** Plans a throw: direct with target lead, or a bank shot when the line is blocked or the archetype favours angles. */
export function planThrow(sim: DiscSim, f: Fighter, ai: AiState): { x: number; y: number; z: number; bank: boolean } {
  const P = sim.player, arch = f.arch;
  const ox = f.x, oy = f.y + 1.4, oz = f.z;
  const dist = Math.hypot(P.x - ox, P.z - oz), tt = dist / arch.throwSpeed, lead = arch.lead * (0.5 + 0.5 * ai.skill);
  let tx = P.x + P.vx * tt * lead, ty = P.y + 1.15, tz = P.z + P.vz * tt * lead;
  const direct = !sim.blocked(ox, oy, oz, tx, ty, tz);
  let bank = false;
  if (!direct || sim.rng.chance(arch.bankShot * (0.6 + 0.4 * ai.skill))) { const b = planBank(sim, ox, oy, oz, tx, ty, tz, 6); if (b) { tx = b.x; ty = b.y; tz = b.z; bank = true; } }
  let dx = tx - ox, dy = ty - oy, dz = tz - oz; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
  // aim error shrinks with skill but never vanishes
  const err = arch.aimError * (1.6 - ai.skill), yaw = sim.rng.range(-err, err), c = Math.cos(yaw), s = Math.sin(yaw);
  const rx = dx * c - dz * s, rz = dx * s + dz * c;
  return { x: rx, y: dy + sim.rng.range(-err, err) * 0.5, z: rz, bank };
}

export function aiThink(sim: DiscSim, f: Fighter, dt: number): DiscIntent {
  const ai = f.ai!, it = ai.intent, P = sim.player, arch = f.arch, p = sim.platforms[f.platform];
  it.jump = false; it.dodge = false; it.recall = false; it.mx = 0; it.mz = 0;
  if (f.spawnT > 0 || f.falling) { it.throwHeld = false; it.shield = false; return it; }
  ai.cooldown -= dt; ai.hopCd -= dt; ai.shieldHold -= dt; ai.commanded -= dt; ai.recoverT -= dt;

  // --- perception: incoming discs (learnable reactions, fixed reaction window)
  if (ai.seen.size > 24) ai.seen.clear();
  for (const d of sim.discs) {
    if (d.state !== 'flying' || d.team === f.team || ai.seen.has(d.id * 100 + d.bounces)) continue;
    const rx = f.x - d.x, ry = f.y + 1.1 - d.y, rz = f.z - d.z, dist = Math.hypot(rx, ry, rz), sp = Math.hypot(d.vx, d.vy, d.vz) || 1;
    const closing = (d.vx * rx + d.vy * ry + d.vz * rz) / (sp * (dist || 1));
    if (closing > 0.955 && dist / sp < 0.42) {
      ai.seen.add(d.id * 100 + d.bounces);
      const q = 0.45 + 0.55 * ai.skill; const fromFront = -(d.vx / sp * f.ax + d.vz / sp * f.az) > 0.34;
      if (fromFront && f.shield > 26 && f.shieldLock <= 0 && sim.rng.chance(arch.shieldUse * q)) { ai.shieldHold = 0.55; ai.mode = 'defending'; }
      else if (f.dodgeCd <= 0 && sim.rng.chance(arch.dodgeUse * q)) { const side = sim.rng.sign(); it.mx = (-d.vz / sp) * side; it.mz = (d.vx / sp) * side; it.dodge = true; ai.mode = 'dodging'; }
    }
  }
  // guardians pre-raise against an aimed wind-up (which drains their shield: bait them)
  if (arch.shieldUse > 0.8 && P.winding && f.shield > 30 && f.shieldLock <= 0) {
    const tx = f.x - P.x, tz = f.z - P.z, tl = Math.hypot(tx, tz) || 1;
    if ((tx / tl) * P.ax + (tz / tl) * P.az > 0.965) ai.shieldHold = Math.max(ai.shieldHold, 0.25);
  }
  it.shield = ai.shieldHold > 0 && !f.winding;

  // --- hazards & repositioning
  const others = sim.platforms.map((q, i) => i).filter((i) => i !== f.platform && sim.platforms[i].side === 1 && sim.platforms[i].state === 'up');
  const danger = p.state === 'warn' || (p.surgeArmed && p.surge < 0.9);
  if (!f.hop && !f.winding) {
    if (danger && others.length && sim.rng.chance(0.06 + 0.2 * ai.skill)) { for (const i of others) if (sim.tryHop(f, 0, 0, i)) break; }
    else if (p.surgeArmed && p.surge < 0.28 && f.jumpT <= 0 && sim.rng.chance(0.3 + 0.6 * ai.skill)) it.jump = true;
    else if (ai.hopCd <= 0 && others.length) {
      ai.hopCd = sim.rng.range(3, 7) / (0.4 + arch.hopRate * 2);
      const retreat = f.hp < f.maxHp * 0.3 && sim.enemiesAlive() > 1;
      if (retreat || sim.rng.chance(arch.hopRate + 0.1)) {
        // retreat picks the platform farthest from the player; otherwise any reachable one
        const order = others.slice().sort((a, b) => { const A = sim.platforms[a], B = sim.platforms[b]; return (retreat ? -1 : sim.rng.sign()) * (Math.hypot(A.x - P.x, A.z - P.z) - Math.hypot(B.x - P.x, B.z - P.z)); });
        for (const i of order) if (sim.tryHop(f, 0, 0, i)) { if (retreat) ai.mode = 'retreating'; break; }
      }
    }
  }
  // --- positioning on the platform
  ai.moveT -= dt;
  if (ai.moveT <= 0) {
    const a = sim.rng.range(0, Math.PI * 2), r = sim.rng.range(0, p.r * 0.62); ai.tx = Math.cos(a) * r; ai.tz = Math.sin(a) * r; ai.moveT = sim.rng.range(0.7, 2.2) / (0.6 + arch.speed * 0.12);
    // free roam: hold a fighting range from the player (8-16 m, closer for the skilled), work round to flank, and
    // keep clear of other rivals, so the pack spreads out across the floor instead of walking up in a line
    if (sim.roam) { const P = sim.player; let best = -1e9;
      for (let k = 0; k < 10; k++) { const aa = sim.rng.range(0, Math.PI * 2), rr = sim.rng.range(0, p.r * 0.85), hx = p.x + Math.cos(aa) * rr, hz = p.z + Math.sin(aa) * rr, dp = Math.hypot(hx - P.x, hz - P.z);
        let sc = -Math.abs(dp - (15 - 5 * ai.skill)) - Math.hypot(hx - f.x, hz - f.z) * 0.15;
        for (const o of sim.fighters) if (o !== f && o.alive && o.team === 1) sc -= Math.max(0, 6 - Math.hypot(hx - o.x, hz - o.z)) * 1.2;
        if (sc > best) { best = sc; ai.tx = hx - p.x; ai.tz = hz - p.z; } } }
    // in a maze a rival hides between throws: of a few spots on its deck, it takes one the player cannot see, and
    // steps out of it to throw (attacking clears the hold below)
    if (sim.maze && ai.cooldown > 0.6) { const P = sim.player; for (let k = 0; k < 6; k++) { const aa = sim.rng.range(0, Math.PI * 2), rr = sim.rng.range(p.r * 0.2, p.r * 0.8), hx = Math.cos(aa) * rr, hz = Math.sin(aa) * rr; if (sim.blocked(P.x, P.y + 1.3, P.z, p.x + hx, p.y + 1.3, p.z + hz)) { ai.tx = hx; ai.tz = hz; ai.moveT *= 1.6; break; } } }
  }
  if (!it.dodge) { const gx = p.x + ai.tx - f.x, gz = p.z + ai.tz - f.z, gl = Math.hypot(gx, gz); if (gl > 0.25) { const k = Math.min(1, gl); it.mx = (gx / gl) * k; it.mz = (gz / gl) * k; } }

  // --- specials
  if (arch.special) {
    ai.specialT -= dt;
    if (arch.special === 'disrupt') {
      if (ai.specialT <= 1.2 && ai.specialT + dt > 1.2) sim.events.push({ type: 'disruptTell', id: f.id });
      if (ai.specialT <= 0) { ai.specialT = sim.rng.range(11, 15); sim.interfere(4); }
    } else if (ai.specialT <= 0) {
      ai.specialT = sim.rng.range(8, 11); sim.events.push({ type: 'command', id: f.id });
      for (const o of sim.fighters) if (o.alive && o.team === 1 && o.ai) { o.ai.cooldown = Math.min(o.ai.cooldown, o === f ? 0.2 : 0.5); o.ai.commanded = 2.5; }
    }
  }

  // --- attack: visible wind-up tell, then throw (bursts for strikers/bosses)
  const tx = P.x - f.x, ty = P.y - f.y, tz = P.z - f.z, tl = Math.hypot(tx, ty, tz) || 1;
  if (f.winding) {
    ai.windT += dt; ai.mode = 'aiming';
    it.ax = ai.aimX; it.ay = ai.aimY; it.az = ai.aimZ;
    if (ai.windT >= arch.windup) {
      ai.throwHeld = false; ai.burstLeft--; ai.mode = 'attacking';
      if (ai.burstLeft > 0) ai.burstGap = 0.3; else { ai.cooldown = sim.rng.range(arch.cooldown[0], arch.cooldown[1]) * (1.2 - 0.4 * ai.skill); ai.recoverT = 0.5; }
    }
  } else {
    it.ax = tx / tl; it.ay = ty / tl; it.az = tz / tl;
    if (ai.burstLeft > 0 && !ai.throwHeld) {
      ai.burstGap -= dt;
      if (sim.heldDiscs(f) === 0) { ai.burstLeft = 0; ai.cooldown = sim.rng.range(arch.cooldown[0], arch.cooldown[1]); }
      else if (ai.burstGap <= 0 && f.throwCd <= 0) startWind(sim, f, ai, Math.max(0.42, arch.windup * 0.6));
    } else if (!ai.throwHeld && f.stagger <= 0 && !f.hop && sim.heldDiscs(f) > 0 && f.throwCd <= 0) {
      // advanced rivals punish an empty-handed player
      const punish = ai.skill > 0.6 && sim.heldDiscs(P) === 0 && ai.cooldown < 1.2;
      if ((ai.cooldown <= 0 || punish) && (sim.activeAttackers() < sim.cfg.maxAttackers || ai.commanded > 0) && P.spawnT <= 0 && !P.falling) { ai.burstLeft = Math.min(arch.burst, sim.heldDiscs(f)); startWind(sim, f, ai, arch.windup); }
      else if (ai.recoverT > 0) ai.mode = 'recovering'; else if (ai.shieldHold <= 0 && ai.mode !== 'retreating') ai.mode = 'positioning';
    }
  }
  it.throwHeld = ai.throwHeld;
  return it;
}

function startWind(sim: DiscSim, f: Fighter, ai: AiState, windup: number) {
  const plan = planThrow(sim, f, ai);
  ai.aimX = plan.x; ai.aimY = plan.y; ai.aimZ = plan.z; ai.windT = f.arch.windup - windup; ai.throwHeld = true; ai.shieldHold = 0;
  sim.events.push({ type: 'tell', id: f.id, dur: windup, bank: plan.bank, homing: f.arch.homing > 0 });
}
