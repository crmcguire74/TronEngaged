import { Rng, TAU } from '../../engine/math';

export interface PlatformDef {
  x: number; y: number; z: number; r: number;
  /** 0 = player side, 1 = rival side. Fighters only traverse platforms of their own side. */
  side: 0 | 1;
  move?: { ax: number; ay: number; az: number; period: number; phase: number };
  collapse?: { interval: number; down: number; phase: number };
  /** Alternate anchor used by topology shifts. */
  alt?: { x: number; y: number; z: number };
}
export interface BarrierDef {
  x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number;
  /** 0 = indestructible. */
  hp: number;
  volatile?: boolean;
  orbit?: { r: number; speed: number; phase: number };
  spin?: number;
}
export interface ArenaDef {
  sides: number; radius: number; ceiling: number; floor: number;
  platforms: PlatformDef[]; barriers: BarrierDef[];
}
export interface ArenaSpec {
  playerPlatforms: number; enemyPlatforms: number;
  heights: 'flat' | 'steps' | 'vertical';
  moving?: boolean; movingBoth?: boolean; collapsing?: boolean; shifting?: boolean;
  barriers?: number; rotating?: number; volatile?: number; cover?: number; midwall?: boolean;
  sides?: number;
}

export const HOP_GAP = 6.5;
export const HOP_RISE = 3.7;

const H: Record<string, number[]> = { flat: [0, 0, 0, 0, 0, 0], steps: [0, 1.4, 0, 2.6, 1.4, 2.6], vertical: [0, 3, 1.5, 5.2, 3, 6] };

/** Assembles a playable disc arena from validated reusable components (PRD 8.4). */
export function buildArena(spec: ArenaSpec, rng: Rng): ArenaDef {
  const platforms: PlatformDef[] = [];
  const pr = 4.6, er = 4.1, arcR = 11.5;
  const arc = (n: number, r: number, radius: number, centre: number) => {
    const chord = 2 * r + 2.6; const step = 2 * Math.asin(Math.min(0.95, chord / (2 * radius)));
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) { const a = centre + (i - (n - 1) / 2) * step; out.push([Math.cos(a) * radius, Math.sin(a) * radius]); }
    return out;
  };
  const hs = H[spec.heights];
  const np = Math.max(1, Math.min(3, spec.playerPlatforms));
  arc(np, pr, arcR, Math.PI / 2).forEach(([x, z], i) => platforms.push({ x, y: spec.heights === 'flat' ? 0 : hs[(i * 2) % hs.length] * 0.5, z, r: pr, side: 0 }));
  const ne = Math.max(1, Math.min(6, spec.enemyPlatforms));
  const front = Math.min(3, ne), back = ne - front;
  arc(front, er, arcR, -Math.PI / 2).forEach(([x, z], i) => platforms.push({ x, y: hs[i % hs.length], z, r: er, side: 1 }));
  arc(back, er, arcR + 9.6, -Math.PI / 2).forEach(([x, z], i) => platforms.push({ x, y: hs[(i + 3) % hs.length] + (spec.heights === 'flat' ? 0 : 0.8), z, r: er, side: 1 }));

  if (spec.moving) for (const p of platforms) if (p.side === 1 || spec.movingBoth) p.move = { ax: p.side === 1 ? 3.2 : 2.2, ay: 0, az: 0, period: p.side === 1 ? 9 : 11, phase: p.side * 0.5 };
  if (spec.collapsing) {
    for (const side of [0, 1] as const) {
      const list = platforms.filter((p) => p.side === side);
      if (list.length < 2) continue;
      list.forEach((p, i) => { p.collapse = { interval: 6.5 * list.length, down: 4, phase: (i / list.length) }; });
    }
  }
  if (spec.shifting) for (const p of platforms) p.alt = { x: p.x + (p.side === 0 ? -4 : 4), y: Math.max(0, p.y + (p.side === 0 ? 1.2 : -0.8) + (Math.abs(p.x) > 1 ? 1 : 0)), z: p.z * 0.92 };

  const barriers: BarrierDef[] = [];
  const nb = spec.barriers ?? 0;
  for (let i = 0; i < nb; i++) {
    const x = nb === 1 ? 0 : (i - (nb - 1) / 2) * 7;
    barriers.push({ x, y: 2.2 + (i % 2) * 1.2, z: (i % 2 ? -1.6 : 1.6), hx: 2.4, hy: 1.5, hz: 0.25, yaw: rng.range(-0.25, 0.25), hp: 3 });
  }
  // a blocking wall plus two angled deflector panels: short, learnable bank shots around it
  if (spec.midwall) { barriers.push({ x: 0, y: 2.4, z: 0, hx: 5.2, hy: 2.6, hz: 0.3, yaw: 0, hp: 0 }); for (const sx of [-1, 1]) barriers.push({ x: sx * 12.5, y: 2.3, z: 0, hx: 3.6, hy: 2.3, hz: 0.25, yaw: Math.PI / 2, hp: 0 }); }
  for (let i = 0; i < (spec.cover ?? 0); i++) {
    const x = (i - ((spec.cover ?? 1) - 1) / 2) * 9;
    barriers.push({ x, y: 1.6, z: 5.6, hx: 1.6, hy: 1.1, hz: 0.22, yaw: 0, hp: 0 });
  }
  for (let i = 0; i < (spec.rotating ?? 0); i++) barriers.push({ x: 0, y: 2.4 + i * 1.3, z: 0, hx: 2.6, hy: 1.3, hz: 0.22, yaw: 0, hp: 0, orbit: { r: 5.5 + i * 2.2, speed: (i % 2 ? -0.5 : 0.62), phase: i * 2.1 } });
  for (let i = 0; i < (spec.volatile ?? 0); i++) {
    const nv = spec.volatile ?? 1, x = nv === 1 ? 0 : (i - (nv - 1) / 2) * 5;
    barriers.push({ x: x + rng.range(-0.4, 0.4), y: 1.8 + (i % 2) * 1.1, z: -1.4 + (i % 2) * 2.8, hx: 0.8, hy: 0.8, hz: 0.8, yaw: Math.PI / 4, hp: 1, volatile: true, spin: 0.7 });
  }
  return { sides: spec.sides ?? 8, radius: 29, ceiling: 18, floor: -9, platforms, barriers };
}

function gapOk(a: PlatformDef, b: PlatformDef, ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z) {
  return Math.hypot(ax - bx, az - bz) - a.r - b.r <= HOP_GAP && Math.abs(ay - by) <= HOP_RISE;
}

/** A generated arena must pass this before the player enters it: reachability, clearance and safe spawns. */
export function validateArena(a: ArenaDef): string[] {
  const issues: string[] = [];
  for (const side of [0, 1] as const) {
    const list = a.platforms.filter((p) => p.side === side);
    if (!list.length) { issues.push(`side ${side} has no platform`); continue; }
    for (const useAlt of [false, true]) {
      const pos = (p: PlatformDef) => (useAlt && p.alt ? p.alt : p);
      const seen = new Set<number>([0]); const q = [0];
      while (q.length) { const i = q.pop()!; for (let j = 0; j < list.length; j++) if (!seen.has(j)) { const A = pos(list[i]), B = pos(list[j]); if (gapOk(list[i], list[j], A.x, A.y, A.z, B.x, B.y, B.z)) { seen.add(j); q.push(j); } } }
      if (seen.size !== list.length) issues.push(`side ${side} platforms not all reachable${useAlt ? ' (shifted)' : ''}`);
    }
  }
  for (let i = 0; i < a.platforms.length; i++) for (let j = i + 1; j < a.platforms.length; j++) {
    const p = a.platforms[i], q = a.platforms[j];
    if (Math.hypot(p.x - q.x, p.z - q.z) < p.r + q.r + 0.3 && Math.abs(p.y - q.y) < 1) issues.push(`platforms ${i}/${j} overlap`);
  }
  const apothemLimit = a.radius - 1.5;
  for (const p of a.platforms) { const m = p.move; if (Math.hypot(Math.abs(p.x) + (m?.ax ?? 0), Math.abs(p.z) + (m?.az ?? 0)) + p.r > apothemLimit) issues.push('platform outside arena bounds'); }
  for (const b of a.barriers) for (const p of a.platforms) {
    if (!b.orbit && Math.hypot(b.x - p.x, b.z - p.z) < p.r - 1 && b.y - b.hy < p.y + 2 && b.y + b.hy > p.y) issues.push('barrier blocks a spawn platform');
  }
  if (a.sides < 4 || a.sides > 12) issues.push('unsupported wall count');
  return issues;
}

/** Inward wall planes of the regular-polygon chamber: outward normal (nx,nz) at distance `radius`. */
export function wallNormals(a: ArenaDef): { nx: number; nz: number }[] {
  const out = [];
  for (let i = 0; i < a.sides; i++) { const ang = ((i + 0.5) / a.sides) * TAU; out.push({ nx: Math.cos(ang), nz: Math.sin(ang) }); }
  return out;
}
