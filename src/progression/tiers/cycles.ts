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
  race('Velocity Run', 'A circuit through the outer blocks against two riders. Finish in the top two. Your light wall derezzes a rival that rides into it; it re-forms a few seconds later, well behind you.', 2, 0.3, [], { laps: 2, wobble: 0.22, width: 18, passPlace: 2, lobes: 2, depth: 0.26, hills: 3.5, hillCount: 2, bank: 0.05, canyons: 1 }, 'neon-circuit'),
  combat('Twin Pursuit', 'Two rivals. Use speed control: slow down to let them overshoot.', [r('aggressor', 1, 0.28), r('evader', 1, 0.28)], [], { half: 70, speed: 22 }, 'classic-grid'),
  race('Skyway Sprint', 'Point-to-point over the skyway: long crests, two suspension spans and boost pads on the descents.', 3, 0.38, [], { format: 'sprint', length: 2000, knots: 11, wobble: 0.55, elevation: 3, hills: 9, hillCount: 4, pads: 5, passPlace: 2, bridges: 2, bank: 0.05 }, 'skyway', ['cycle:jade']),
  combat('Survival Protocol', 'Three rivals. Riding close to walls charges your boost.', [r('aggressor', 1, 0.35), r('evader', 1, 0.35), r('opportunist', 1, 0.3)], [], { half: 74, speed: 24 }, 'classic-grid', ['trail:amber']),

  race('Neon Circuit', 'Light-wall race. Your ability lays a wall behind you: rivals that ride into it are derezzed and lose places. Theirs will derez you. Gold charge gates recharge your wall the moment you ride through.', 4, 0.46, ['charge-gates', 'lightwalls'], { laps: 3, wobble: 0.34, passPlace: 3, lobes: 3, depth: 0.33, hills: 5, hillCount: 3, bank: 0.09, tunnels: 1, canyons: 1 }, 'neon-circuit'),
  combat('Confinement', 'A narrower arena and faster rivals.', [r('aggressor', 2, 0.45), r('opportunist', 1, 0.45)], [], { half: 50, speed: 27 }, 'data-tunnel'),
  race('Digital Metropolis', 'A technical street circuit walled in by towers, with sky-bridges overhead. Ramming is live: hit a rival at super speed to shove it into a rail or a wall.', 4, 0.52, [], { laps: 3, wobble: 0.42, width: 15, hazards: 7, pads: 4, passPlace: 3, lobes: 4, depth: 0.34, hills: 4, hillCount: 4, bank: 0.07, canyons: 3, tunnels: 1 }, 'metropolis'),
  combat('Trap Formation', 'Rivals coordinate to box you in. Break the formation early.', [r('container', 3, 0.5)], [], { half: 66, speed: 26, pillars: 3 }, 'classic-grid'),
  race('Sector Championship', 'Two-stage championship with light walls live. Points decide it.', 5, 0.5, ['lightwalls'], { laps: 3, wobble: 0.4, passPlace: 3, stages: 2, hazards: 4, hills: 6, hillCount: 3, bank: 0.08, bridges: 1, tunnels: 1, canyons: 1 }, 'championship', ['cycle:ember', 'arena:metropolis']),

  combat('Adaptive Grid', 'The boundary closes in. Space is the resource.', [r('aggressor', 1, 0.55), r('container', 2, 0.55)], ['shrink'], { half: 70, speed: 26 }, 'core-reactor'),
  race('Tunnel Rush', 'Time trial, most of it underground. Four bores, banked corners between them. Precision over power.', 0, 0.5, [], { format: 'timetrial', laps: 2, width: 12, wobble: 0.5, knots: 11, lobes: 4, depth: 0.36, hills: 5, hillCount: 4, bank: 0.12, tunnels: 4 }, 'data-tunnel'),
  combat('Hunter Cycles', 'Aggressive pursuit AI that cuts across your path. Gold ion lanes cross the grid: ride along one for speed and boost.', [r('aggressor', 3, 0.62)], ['ion-lanes'], { half: 66, speed: 28, pillars: 4 }, 'classic-grid'),
  race('Fractured Skyway', 'Elimination over a broken skyway: three suspension spans, big crests between them, and last place cut at intervals.', 5, 0.55, [], { format: 'elimination', laps: 4, elevation: 3, hills: 13, hillCount: 3, wobble: 0.45, knots: 10, pads: 5, lobes: 3, depth: 0.38, bank: 0.1, bridges: 3, canyons: 1 }, 'skyway'),
  combat('Arena Dominance', 'An elite squad: a champion with a containment team.', [r('champion', 1, 0.7), r('container', 2, 0.62), r('opportunist', 1, 0.62)], ['ion-lanes'], { half: 72, speed: 27, pillars: 4 }, 'championship', ['skin:ivory', 'trail:violet']),

  race('Data Storm', 'Storm cells cut visibility and speed, and every rider carries a light wall. Pick your line early.', 5, 0.6, ['charge-gates', 'storm', 'lightwalls'], { laps: 3, wobble: 0.42, hazards: 5, passPlace: 3, lobes: 3, depth: 0.35, hills: 6, hillCount: 4, bank: 0.08, tunnels: 2, canyons: 1 }, 'core-reactor'),
  combat('Power Grid', 'Power-ups on the floor: Phase, Purge, Shock, Boost. Press ability to use.', [r('aggressor', 2, 0.65), r('opportunist', 2, 0.65)], ['power-ups'], { half: 72, speed: 27, pillars: 3 }, 'classic-grid'),
  race('Red Sector', 'High-speed rivals on a tighter track. They will pulse you.', 5, 0.7, ['aggressive'], { laps: 3, width: 13, wobble: 0.46, pads: 4, passPlace: 3, lobes: 4, depth: 0.4, hills: 7, hillCount: 4, bank: 0.13, tunnels: 2, bridges: 1 }, 'red-sector'),
  combat('Double Encirclement', 'Four coordinated riders closing from two sides. Four ion lanes box the centre — so do they.', [r('container', 4, 0.7)], ['ion-lanes', 'ion-grid'], { half: 70, speed: 27, pillars: 2 }, 'core-reactor'),
  race('Grand Prix', 'Three-stage event across changing circuits, light walls live. Charge gates on every circuit.', 6, 0.68, ['charge-gates', 'lightwalls'], { laps: 2, wobble: 0.44, hazards: 5, pads: 4, passPlace: 3, stages: 3, hills: 8, hillCount: 3, bank: 0.1, tunnels: 1, bridges: 1, canyons: 2 }, 'championship', ['cycle:violet', 'arena:core-reactor']),

  combat('Collapse Protocol', 'Floor sections fall away and the boundary shrinks.', [r('aggressor', 2, 0.72), r('container', 2, 0.72)], ['collapse', 'shrink'], { half: 74, speed: 27 }, 'fractured-grid'),
  race('Skyline Pursuit', 'Catch the runner ahead before it finishes. Huge crests and three spans over the gap.', 1, 0.72, [], { format: 'pursuit', laps: 3, elevation: 3, hills: 17, hillCount: 3, wobble: 0.45, knots: 11, pads: 6, lobes: 3, depth: 0.36, bank: 0.09, bridges: 3, canyons: 1 }, 'skyway'),
  combat('Elite Swarm', 'Five advanced cycles.', [r('aggressor', 2, 0.76), r('container', 2, 0.76), r('opportunist', 1, 0.76)], ['power-ups'], { half: 76, speed: 28, pillars: 4 }, 'classic-grid'),
  race('Oblivion Circuit', 'Solo gauntlet: sweeping hazards, limited integrity.', 0, 0.7, ['sweepers'], { format: 'gauntlet', laps: 2, wobble: 0.5, knots: 12, radius: 240, hazards: 13, pads: 6, lobes: 3, depth: 0.32, hills: 7, hillCount: 4, bank: 0.08, tunnels: 2, bridges: 1 }, 'fractured-grid'),
  combat('Master Grid', 'The champion. It plans several moves ahead.', [r('champion', 1, 0.95), r('container', 2, 0.74)], ['ion-lanes', 'ion-grid'], { half: 66, speed: 29, pillars: 3 }, 'championship', ['skin:crimson', 'trail:jade']),

  race('Hypervelocity', 'Extreme speed sprint. Near-perfect handling required.', 5, 0.85, [], { format: 'sprint', length: 2600, knots: 13, wobble: 0.5, elevation: 2, hills: 11, hillCount: 5, pads: 9, width: 15, passPlace: 2, bank: 0.11, bridges: 2, tunnels: 1, canyons: 1 }, 'red-sector'),
  combat('Grid Anomaly', 'Pillars rise from the floor after a warning. Geometry is unpredictable.', [r('aggressor', 2, 0.82), r('opportunist', 2, 0.82)], ['anomaly', 'power-ups'], { half: 72, speed: 28 }, 'fractured-grid'),
  race('Infinite Highway', 'Three-stage endurance championship, light walls live. Four charge gates per lap: wall early, wall often.', 6, 0.85, ['charge-gates', 'charge-gates-4', 'lightwalls'], { laps: 3, wobble: 0.46, radius: 220, hazards: 6, pads: 5, passPlace: 3, stages: 3, lobes: 4, depth: 0.38, hills: 9, hillCount: 4, bank: 0.1, tunnels: 2, bridges: 2, canyons: 2 }, 'infinite-grid'),
  combat('Last Runner', 'Top-tier survival gauntlet: six riders, shrinking arena.', [r('champion', 1, 0.9), r('aggressor', 2, 0.86), r('container', 2, 0.86), r('opportunist', 1, 0.86)], ['shrink', 'power-ups'], { half: 78, speed: 29, pillars: 4 }, 'championship'),
  race('Apex Protocol', 'Final event: elimination through storm cells and sweepers, over bridges and through the bores.', 6, 0.92, ['storm', 'sweepers', 'aggressive'], { format: 'elimination', laps: 5, wobble: 0.48, knots: 11, radius: 225, hazards: 6, pads: 7, lobes: 3, depth: 0.36, hills: 10, hillCount: 4, bank: 0.13, tunnels: 2, bridges: 2, canyons: 2 }, 'championship', ['trail:prism']),

  // ---------------------------------------------------------------- Override: the Outlands, with air cover
  combat('Outland Breach', 'Beyond the city wall. Six riders, no boundary lights, and pillars that rise without warning.', [r('champion', 1, 0.9), r('aggressor', 2, 0.88), r('container', 2, 0.88)], ['anomaly', 'power-ups', 'ion-lanes'], { half: 80, speed: 29 }, 'outlands'),
  race('Air Cover', 'An interceptor shadows the leader and drops hardlight barriers across the lane ahead of it. There is always a way through — find the gap before you are on it.', 4, 0.8, ['interceptor', 'lightwalls'], { laps: 3, wobble: 0.4, passPlace: 3, lobes: 3, depth: 0.34, hills: 8, hillCount: 3, bank: 0.1, bridges: 1, tunnels: 1, canyons: 1 }, 'outlands', ['cycle:moto']),
  combat('Null Lattice', 'A shrinking arena that collapses in sections, with an elite squad inside it.', [r('champion', 1, 0.92), r('aggressor', 2, 0.9), r('opportunist', 2, 0.9)], ['shrink', 'collapse', 'power-ups'], { half: 82, speed: 30, pillars: 4 }, 'outlands'),
  race('Canyon Run', 'A tower canyon at full speed, with two bores and a span. The interceptor is up there too.', 5, 0.85, ['interceptor', 'charge-gates', 'lightwalls'], { laps: 3, wobble: 0.46, width: 14, passPlace: 3, lobes: 4, depth: 0.36, hills: 7, hillCount: 4, bank: 0.12, canyons: 3, tunnels: 2, bridges: 1, hazards: 5, pads: 5 }, 'outlands'),
  combat('Last Lattice', 'Seven riders. Shrinking floor, collapsing sections, ion lanes and power-ups. Nothing is held back.', [r('champion', 2, 0.95), r('aggressor', 2, 0.92), r('container', 2, 0.92)], ['shrink', 'collapse', 'ion-lanes', 'ion-grid', 'power-ups'], { half: 84, speed: 30, pillars: 5 }, 'outlands'),
  race('Override', 'The last event. Elimination through the Outlands under air cover: storms, sweepers, bores, spans and a canyon, with the interceptor hunting whoever leads.', 6, 0.94, ['interceptor', 'storm', 'sweepers', 'charge-gates', 'charge-gates-4', 'lightwalls'], { format: 'elimination', laps: 4, wobble: 0.48, knots: 12, radius: 235, hazards: 6, pads: 7, lobes: 3, depth: 0.36, hills: 11, hillCount: 4, bank: 0.13, tunnels: 2, bridges: 2, canyons: 2 }, 'outlands', ['endless:cycle-combat', 'endless:cycle-race', 'trail:nullwave']),
];
export const COMBAT_TIERS = CYCLE_TIERS.filter((t) => t.mode === 'cycle-combat');
export const RACE_TIERS = CYCLE_TIERS.filter((t) => t.mode === 'cycle-race');
