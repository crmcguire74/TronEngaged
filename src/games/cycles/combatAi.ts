import { DIRS, type CombatSim, type Cycle, type CycleIntent } from './combat';

/** Tactical profiles (PRD 12.2): aggressive trapping, evasive survival, coordinated containment, opportunistic interception. */
export interface CycleAi { profile: 'aggressor' | 'evader' | 'container' | 'opportunist' | 'champion'; skill: number; thinkT: number; slot: number; lastTurn: number; intent: CycleIntent; warned?: boolean }

const qx = new Int16Array(4096), qz = new Int16Array(4096);
/** Bounded flood fill over the occupancy map: how much room is reachable from a cell. */
export function floodSpace(sim: CombatSim, x: number, z: number, cap: number): number {
  if (sim.solid(x, z)) return 0;
  const id = ++sim.stampId; let head = 0, tail = 0, n = 0;
  const push = (cx: number, cz: number) => { const i = sim.cell(cx, cz); if (i < 0 || sim.stamp[i] === id || sim.solid(cx, cz)) return; sim.stamp[i] = id; qx[tail & 4095] = cx; qz[tail & 4095] = cz; tail++; };
  push(Math.floor(x), Math.floor(z));
  while (head < tail && n < cap) { const cx = qx[head & 4095], cz = qz[head & 4095]; head++; n++; push(cx + 1, cz); push(cx - 1, cz); push(cx, cz + 1); push(cx, cz - 1); }
  return n;
}

/** Other riders are moving walls: clamp a ray where it would cross a rider's path over the next moments. */
function riderClamp(sim: CombatSim, c: Cycle, dir: number, free: number): number {
  const [dx, dz] = DIRS[dir];
  for (const o of sim.cycles) {
    if (o === c || !o.alive) continue;
    const [ox, oz] = DIRS[o.dir], reach = o.speed * 0.55 + 2;
    // other rider's swept box over the look-ahead window, padded
    const minx = Math.min(o.x, o.x + ox * reach) - 1.6, maxx = Math.max(o.x, o.x + ox * reach) + 1.6, minz = Math.min(o.z, o.z + oz * reach) - 1.6, maxz = Math.max(o.z, o.z + oz * reach) + 1.6;
    let t = -1;
    if (dx !== 0) { if (c.z > minz && c.z < maxz) { const hit = dx > 0 ? minx - c.x : c.x - maxx; if (hit >= -3.2) t = Math.max(0, hit); } }
    else if (c.x > minx && c.x < maxx) { const hit = dz > 0 ? minz - c.z : c.z - maxz; if (hit >= -3.2) t = Math.max(0, hit); }
    if (t >= 0 && t < free) free = Math.floor(t);
  }
  return free;
}

export function aiDrive(sim: CombatSim, c: Cycle, dt: number): CycleIntent {
  const ai = c.ai!, intent = ai.intent; intent.turn = 0; intent.ability = false;
  ai.thinkT -= dt; ai.lastTurn += dt;
  if (ai.thinkT > 0) return intent;
  ai.thinkT = 0.15 - 0.1 * ai.skill;
  const P = sim.player, sk = ai.skill;
  const L = (c.dir + 3) % 4, R = (c.dir + 1) % 4;
  const ahead = riderClamp(sim, c, c.dir, sim.freeDist(c.x, c.z, c.dir, 70)), left = riderClamp(sim, c, L, sim.freeDist(c.x, c.z, L, 50)), right = riderClamp(sim, c, R, sim.freeDist(c.x, c.z, R, 50));
  // skilled riders commit to a turn with room to spare; weaker ones react late
  const need = c.speed * (0.1 + 0.07 * sk) + 1.6 + 1.6 * sk;
  // after a turn, hold the new line for a few metres unless a wall is imminent (keeps corridors rideable)
  const must = ahead < need && (c.sinceTurn > 3.2 || ahead < c.speed * 0.09 + 1.2);

  // novice riders sometimes see a wall too late. This is what makes the opening tiers winnable by simply surviving.
  if (!must) ai.warned = false; else if (!ai.warned) { ai.warned = true; if (sk < 0.3 && sim.time > 9 && sim.rng.chance(Math.min(0.22, (0.3 - sk) * 0.7))) { ai.thinkT = 0.5; return intent; } }

  // tactical target by profile
  let tx = c.x, tz = c.z, w = 0;
  const [pdx, pdz] = DIRS[P.dir];
  const pd = Math.hypot(P.x - c.x, P.z - c.z);
  if (P.alive) {
    if (ai.profile === 'aggressor' || ai.profile === 'champion') { const lead = 7 + 12 * sk; tx = P.x + pdx * lead; tz = P.z + pdz * lead; w = 1.6; }
    else if (ai.profile === 'container') { const side = ai.slot % 2 ? 1 : -1, lead = 12; tx = P.x + pdx * lead - pdz * side * 11; tz = P.z + pdz * lead + pdx * side * 11; w = 1.3; }
    else if (ai.profile === 'opportunist') { const pressed = sim.freeDist(P.x, P.z, P.dir, 30) < 16; tx = P.x + pdx * (pressed ? 9 : -6); tz = P.z + pdz * (pressed ? 9 : -6); w = pressed ? 2 : 0.7; }
  }
  for (const pk of sim.pickups) if (pk.alive && Math.hypot(pk.x - c.x, pk.z - c.z) < 22 && sk > 0.35) { tx = pk.x; tz = pk.z; w = Math.max(w, 1.2); break; }

  const cap = Math.round(140 + 700 * sk);
  const space = (dir: number, free: number) => { if (free < 2) return -1; const [dx, dz] = DIRS[dir]; return floodSpace(sim, c.x + dx * 2, c.z + dz * 2, cap); };
  const toward = (dir: number, free: number) => { const [dx, dz] = DIRS[dir], k = Math.min(free, 8); return -Math.hypot(tx - (c.x + dx * k), tz - (c.z + dz * k)); };
  const spS = space(c.dir, ahead), spL = space(L, left), spR = space(R, right);
  const sL = spL < 0 ? -1e9 : spL + Math.min(left, 30) * 2 + (left < need ? -60 : 0) + toward(L, left) * w * (0.4 + sk);
  const sR = spR < 0 ? -1e9 : spR + Math.min(right, 30) * 2 + (right < need ? -60 : 0) + toward(R, right) * w * (0.4 + sk);
  const sS = spS;
  let turn: -1 | 0 | 1 = 0;
  if (must || spS < 0) {
    if (sk < 0.35 && sim.rng.chance(0.25) && left > 3 && right > 3) turn = sim.rng.chance(0.5) ? -1 : 1;
    else turn = sL >= sR ? -1 : 1;
    if (spL < 0 && spR < 0) { turn = 0; if (c.power === 'phase') intent.ability = true; }
  } else if (ai.lastTurn > 0.5) {
    const bestSide = spL >= spR ? L : R, bestSp = Math.max(spL, spR), bestFree = bestSide === L ? left : right;
    // leave a closing pocket while there is still a way out
    if (spS < cap * 0.9 && bestSp > spS * 1.5 + 25 && bestFree > 6 && sim.rng.chance(0.3 + 0.6 * sk)) turn = bestSide === L ? -1 : 1;
    else if (w > 0 && ai.lastTurn > 0.7) {
      // tactical turn: only when it gains real ground on the target and does not give up room
      const gS = toward(c.dir, ahead), gL = spL >= spS * 0.8 && left > 14 ? toward(L, left) : -1e9, gR = spR >= spS * 0.8 && right > 14 ? toward(R, right) : -1e9;
      const g = Math.max(gL, gR); if (g > gS + 6 && sim.rng.chance(0.25 + 0.5 * sk)) turn = gL >= gR ? -1 : 1;
    } else if (w === 0 && ai.lastTurn > 2.5 && sim.rng.chance(0.04)) { const side = left >= right ? L : R, fr = Math.max(left, right); if (fr > 28) turn = side === L ? -1 : 1; }
  }
  if (turn !== 0 && (c.sinceTurn > 3.2 || must)) { intent.turn = turn; ai.lastTurn = 0; }

  // speed management
  const tight = sS < cap * 0.35;
  const hunter = ai.profile === 'aggressor' || ai.profile === 'champion' || ai.profile === 'container';
  intent.accel = tight ? -1 : ahead > 22 ? 1 : 0;
  intent.boost = hunter && !tight && ahead > 34 && pd > 8 && pd < 60 && c.boost > 0.25 && sk > 0.3;
  if (c.power === 'shock' && pd < 22) intent.ability = true;
  if (c.power === 'purge' && tight) intent.ability = true;
  if (c.power === 'phase' && ahead < 3 && left < 3 && right < 3) intent.ability = true;
  return intent;
}
