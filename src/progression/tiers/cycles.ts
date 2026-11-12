import type { EnemySpawn, TierDefinition } from '../types';

type P = Record<string, number | string>;
const r = (type: string, count: number, difficulty: number): EnemySpawn => ({ type, count, difficulty });
let n = 0;
function combat(name: string, brief: string, enemies: EnemySpawn[], modifiers: string[], params: P, env: string, unlocks: string[] = []): TierDefinition {
  n++; return { id: n, mode: 'cycle-combat', name, brief, environment: env, enemies, modifiers, objective: 'last-rider-standing', unlocks, params: { half: 70, speed: 24, pillars: 0, ...params }, scoreMul: 1 + (n - 1) * 0.08 };
}
function race(name: string, brief: string, rivals: number, skill: number, modifiers: string[], params: P, env: string, unlocks: string[] = []): TierDefinition {
  n++; const format = String(params.format ?? 'circuit');
  return { id: n, mode: 'cycle-race', name, brief, environment: env, enemies: [r('racer', rivals, skill)], modifiers, objective: format, unlocks, params: { format: 'circuit', laps: 2, radius: 190, wobble: 0.3, elevation: 0, width: 16, knots: 9, hazards: 0, pads: 3, passPlace: 3, stages: 1, seed: 1000 + n * 37, ...params }, scoreMul: 1 + (n - 1) * 0.08 };
}

/** 30 Cycle tiers alternating Combat and Racing. Combat and Racing also keep independent unlock progress. */
export const CYCLE_TIERS: readonly TierDefinition[] = [
  combat('Lattice Initiation', 'Your cycle never stops and leaves a solid wall behind it. Turn 90° to steer. Make the rival crash; do not hit any wall yourself.', [r('evader', 1, 0.12)], [], { half: 64, speed: 19 }, 'classic-grid'),
  race('Velocity Run', 'A circuit against two riders. Finish in the top two. Your light wall derezzes a rival that rides into it; it re-forms a few seconds later, well behind you.', 2, 0.3, [], { laps: 2, wobble: 0.22, width: 18, passPlace: 2 }, 'neon-circuit'),
  combat('Twin Pursuit', 'Two rivals. Use speed control: slow down to let them overshoot.', [r('aggressor', 1, 0.28), r('evader', 1, 0.28)], [], { half: 70, speed: 22 }, 'classic-grid'),
  race('Skyway Sprint', 'Point-to-point with long turns, ramps and boost pads.', 3, 0.38, [], { format: 'sprint', length: 1900, knots: 11, wobble: 0.55, elevation: 9, pads: 5, passPlace: 2 }, 'skyway', ['cycle:jade']),
  combat('Survival Protocol', 'Three rivals. Riding close to walls charges your boost.', [r('aggressor', 1, 0.35), r('evader', 1, 0.35), r('opportunist', 1, 0.3)], [], { half: 74, speed: 24 }, 'classic-grid', ['trail:amber']),

  race('Neon Circuit', 'Light-wall race. Your ability lays a wall behind you: rivals that ride into it are derezzed and lose places. Theirs will stall you.', 4, 0.46, ['lightwalls'], { laps: 3, wobble: 0.34, passPlace: 3 }, 'neon-circuit'),
  combat('Confinement', 'A narrower arena and faster rivals.', [r('aggressor', 2, 0.45), r('opportunist', 1, 0.45)], [], { half: 50, speed: 27 }, 'data-tunnel'),
  race('Digital Metropolis', 'Urban obstacles on a technical street circuit. Ramming is live: hit a rival at super speed to shove it into a rail or a wall.', 4, 0.52, [], { laps: 3, wobble: 0.42, width: 15, hazards: 7, pads: 4, passPlace: 3 }, 'metropolis'),
  combat('Trap Formation', 'Rivals coordinate to box you in. Break the formation early.', [r('container', 3, 0.5)], [], { half: 66, speed: 26, pillars: 3 }, 'classic-grid'),
  race('Sector Championship', 'Two-stage championship with light walls live. Points decide it.', 5, 0.5, ['lightwalls'], { laps: 3, wobble: 0.4, passPlace: 3, stages: 2, hazards: 4 }, 'championship', ['cycle:ember', 'arena:metropolis']),

  combat('Adaptive Grid', 'The boundary closes in. Space is the resource.', [r('aggressor', 1, 0.55), r('container', 2, 0.55)], ['shrink'], { half: 70, speed: 26 }, 'core-reactor'),
  race('Tunnel Rush', 'Time trial through narrow tunnels. Precision over power.', 0, 0.5, [], { format: 'timetrial', laps: 2, width: 12, wobble: 0.5, knots: 11 }, 'data-tunnel'),
  combat('Hunter Cycles', 'Aggressive pursuit AI that cuts across your path.', [r('aggressor', 3, 0.62)], [], { half: 66, speed: 28, pillars: 4 }, 'classic-grid'),
  race('Fractured Skyway', 'Elimination on an elevated course: last place is cut at intervals.', 5, 0.55, [], { format: 'elimination', laps: 4, elevation: 14, wobble: 0.45, knots: 10, pads: 5 }, 'skyway'),
  combat('Arena Dominance', 'An elite squad: a champion with a containment team.', [r('champion', 1, 0.7), r('container', 2, 0.62), r('opportunist', 1, 0.62)], [], { half: 72, speed: 27, pillars: 4 }, 'championship', ['skin:ivory', 'trail:violet']),

  race('Data Storm', 'Storm cells cut visibility and speed, and every rider carries a light wall. Pick your line early.', 5, 0.6, ['storm', 'lightwalls'], { laps: 3, wobble: 0.42, hazards: 5, passPlace: 3 }, 'core-reactor'),
  combat('Power Grid', 'Power-ups on the floor: Phase, Purge, Shock, Boost. Press ability to use.', [r('aggressor', 2, 0.65), r('opportunist', 2, 0.65)], ['power-ups'], { half: 72, speed: 27, pillars: 3 }, 'classic-grid'),
  race('Red Sector', 'High-speed rivals on a tighter track. They will pulse you.', 5, 0.7, ['aggressive'], { laps: 3, width: 13, wobble: 0.46, pads: 4, passPlace: 3 }, 'red-sector'),
  combat('Double Encirclement', 'Four coordinated riders closing from two sides.', [r('container', 4, 0.7)], [], { half: 70, speed: 27, pillars: 2 }, 'core-reactor'),
  race('Grand Prix', 'Three-stage event across changing circuits, light walls live.', 6, 0.68, ['lightwalls'], { laps: 2, wobble: 0.44, hazards: 5, pads: 4, passPlace: 3, stages: 3 }, 'championship', ['cycle:violet', 'arena:core-reactor']),

  combat('Collapse Protocol', 'Floor sections fall away and the boundary shrinks.', [r('aggressor', 2, 0.72), r('container', 2, 0.72)], ['collapse', 'shrink'], { half: 74, speed: 27 }, 'fractured-grid'),
  race('Skyline Pursuit', 'Catch the runner ahead before it finishes. Big elevation changes.', 1, 0.72, [], { format: 'pursuit', laps: 3, elevation: 18, wobble: 0.45, knots: 11, pads: 6 }, 'skyway'),
  combat('Elite Swarm', 'Five advanced cycles.', [r('aggressor', 2, 0.76), r('container', 2, 0.76), r('opportunist', 1, 0.76)], ['power-ups'], { half: 76, speed: 28, pillars: 4 }, 'classic-grid'),
  race('Oblivion Circuit', 'Solo gauntlet: sweeping hazards, limited integrity.', 0, 0.7, ['sweepers'], { format: 'gauntlet', laps: 2, wobble: 0.5, knots: 12, radius: 230, hazards: 16, pads: 5 }, 'fractured-grid'),
  combat('Master Grid', 'The champion. It plans several moves ahead.', [r('champion', 1, 0.95), r('container', 2, 0.74)], [], { half: 66, speed: 29, pillars: 3 }, 'championship', ['skin:crimson', 'trail:jade']),

  race('Hypervelocity', 'Extreme speed sprint. Near-perfect handling required.', 5, 0.85, [], { format: 'sprint', length: 2600, knots: 13, wobble: 0.5, elevation: 7, pads: 9, width: 15, passPlace: 2 }, 'red-sector'),
  combat('Grid Anomaly', 'Pillars rise from the floor after a warning. Geometry is unpredictable.', [r('aggressor', 2, 0.82), r('opportunist', 2, 0.82)], ['anomaly', 'power-ups'], { half: 72, speed: 28 }, 'fractured-grid'),
  race('Infinite Highway', 'Three-stage endurance championship, light walls live.', 6, 0.85, ['lightwalls'], { laps: 3, wobble: 0.46, radius: 220, hazards: 6, pads: 5, passPlace: 3, stages: 3 }, 'infinite-grid'),
  combat('Last Runner', 'Top-tier survival gauntlet: six riders, shrinking arena.', [r('champion', 1, 0.9), r('aggressor', 2, 0.86), r('container', 2, 0.86), r('opportunist', 1, 0.86)], ['shrink', 'power-ups'], { half: 78, speed: 29, pillars: 4 }, 'championship'),
  race('Apex Protocol', 'Final event: elimination through storm cells and sweepers.', 6, 0.92, ['storm', 'sweepers', 'aggressive'], { format: 'elimination', laps: 5, wobble: 0.48, knots: 11, radius: 210, hazards: 8, pads: 6 }, 'championship', ['endless:cycle-combat', 'endless:cycle-race', 'trail:prism']),
];
export const COMBAT_TIERS = CYCLE_TIERS.filter((t) => t.mode === 'cycle-combat');
export const RACE_TIERS = CYCLE_TIERS.filter((t) => t.mode === 'cycle-race');
