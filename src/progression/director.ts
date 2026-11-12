import { Rng, hashSeed } from '../engine/math';
import type { EnemySpawn, GameMode, TierDefinition } from './types';

/**
 * Endless difficulty director. Deterministic for a given (mode, seed, wave), so runs are reproducible for
 * leaderboards and debugging. Difficulty rises through skill, density, arena variation, environmental pressure
 * and decision complexity — never unbounded speed or health — and cycles through recovery waves.
 */
export const ENDLESS_CYCLE = ['skirmish', 'pressure', 'squad', 'recovery', 'elite'] as const;
export type EndlessBeat = (typeof ENDLESS_CYCLE)[number];

/** Skill saturates: an endless run gets cleverer and denser, not arbitrarily faster. */
export function endlessSkill(wave: number): number { return Math.min(0.97, 0.55 + 0.42 * (1 - Math.exp(-wave / 14))); }

// Only combinations that have been validated to produce reachable, fair arenas are listed here.
const DISC_MODS: string[][] = [['cover'], ['cover', 'barriers'], ['moving-platforms', 'cover'], ['collapsing'], ['rotating-shields', 'cover'], ['energy-surge', 'cover'], ['volatile', 'barriers'], ['shifting', 'cover'], ['midwall', 'cover'], ['interference', 'cover'], ['rapid-shift', 'collapsing'], ['energy-surge', 'volatile']];
const DISC_SQUADS: string[][] = [['sentinel', 'striker'], ['striker', 'striker'], ['guardian', 'ricochet'], ['hunter', 'sentinel'], ['ricochet', 'ricochet', 'striker'], ['hunter', 'hunter', 'guardian'], ['commander', 'striker', 'guardian'], ['disruptor', 'striker', 'ricochet'], ['commander', 'hunter', 'striker', 'guardian'], ['commander', 'guardian', 'striker', 'hunter', 'ricochet']];
const DISC_BOSSES = ['boss-enforcer', 'boss-architect', 'boss-overseer', 'boss-prime'];
const DISC_ENVS = ['classic-stadium', 'vertical-chamber', 'data-core', 'fractured-lattice', 'corruption-zone', 'grand-colosseum'];
const COMBAT_MODS: string[][] = [[], ['power-ups'], ['shrink'], ['anomaly'], ['collapse'], ['power-ups', 'shrink'], ['anomaly', 'power-ups'], ['collapse', 'shrink']];
const COMBAT_ENVS = ['classic-grid', 'data-tunnel', 'core-reactor', 'fractured-grid', 'championship', 'infinite-grid'];
const RACE_FORMATS = ['circuit', 'sprint', 'elimination', 'timetrial', 'pursuit', 'gauntlet'];
const RACE_ENVS = ['neon-circuit', 'skyway', 'metropolis', 'core-reactor', 'red-sector', 'infinite-grid', 'championship'];

export function endlessTier(mode: GameMode, wave: number, runSeed: number): TierDefinition {
  const rng = new Rng(hashSeed('endless', mode, runSeed, wave));
  const beat = ENDLESS_CYCLE[(wave - 1) % ENDLESS_CYCLE.length], lap = Math.floor((wave - 1) / ENDLESS_CYCLE.length);
  const recovery = beat === 'recovery'; let skill = endlessSkill(wave) - (recovery ? 0.18 : 0) + (beat === 'elite' ? 0.04 : 0);
  skill = Math.max(0.3, Math.min(0.98, skill));
  const id = 1000 + wave, scoreMul = 3.4 + wave * 0.12, base = { id, endless: true, unlocks: [] as string[], scoreMul };
  if (mode === 'discs') {
    const density = Math.min(DISC_SQUADS.length - 1, Math.floor(lap * 0.9 + (beat === 'squad' ? 3 : beat === 'pressure' ? 1 : 0) + rng.int(0, 1)));
    const boss = beat === 'elite' && lap % 2 === 1;
    const squad = recovery ? DISC_SQUADS[Math.min(1, density)] : DISC_SQUADS[density];
    const enemies: EnemySpawn[] = boss ? [{ type: DISC_BOSSES[Math.floor(lap / 2) % DISC_BOSSES.length], count: 1, difficulty: skill }] : squad.map((type) => ({ type, count: 1, difficulty: skill }));
    const mods = recovery ? ['cover'] : beat === 'skirmish' ? DISC_MODS[rng.int(0, 4)] : DISC_MODS[rng.int(0, DISC_MODS.length - 1)];
    const ep = Math.min(6, Math.max(2, enemies.length + 1 + (boss ? 2 : 0)));
    return { ...base, mode, name: `Endless ${wave} · ${title(beat)}`, brief: boss ? 'A returning boss, re-tuned.' : recovery ? 'Recovery wave. Breathe, then go again.' : 'Procedurally configured encounter.', environment: DISC_ENVS[(lap + wave) % DISC_ENVS.length], enemies, modifiers: boss ? ['cover'] : mods, objective: boss ? 'defeat-boss' : 'eliminate-all-enemies', boss: boss ? enemies[0].type : undefined,
      params: { playerPlatforms: 3, enemyPlatforms: ep, heights: rng.pick(['flat', 'steps', 'steps', 'vertical']), maxAttackers: Math.min(3, 1 + Math.floor(enemies.length / 2)), discSpeed: 1 + Math.min(0.25, lap * 0.03), barriers: 2 + rng.int(0, 1), rotating: 1 + rng.int(0, 1), volatile: 2 + rng.int(0, 2), shiftCapable: boss ? 1 : 0, collapseLater: boss ? 1 : 0 } };
  }
  if (mode === 'cycle-combat') {
    const count = recovery ? 2 : Math.min(6, 2 + Math.floor(lap * 0.7) + (beat === 'squad' ? 2 : beat === 'elite' ? 1 : 0));
    const profiles = ['aggressor', 'container', 'opportunist', 'evader'];
    const enemies: EnemySpawn[] = []; for (let i = 0; i < count; i++) enemies.push({ type: beat === 'elite' && i === 0 ? 'champion' : beat === 'squad' ? 'container' : profiles[(i + wave) % (recovery ? 4 : 3)], count: 1, difficulty: skill });
    return { ...base, mode, name: `Endless ${wave} · ${title(beat)}`, brief: recovery ? 'Recovery wave: fewer riders, open floor.' : 'Procedurally configured arena.', environment: COMBAT_ENVS[(lap + wave) % COMBAT_ENVS.length], enemies, modifiers: recovery ? [] : COMBAT_MODS[rng.int(0, Math.min(COMBAT_MODS.length - 1, 2 + lap))], objective: 'last-rider-standing',
      params: { half: recovery ? 76 : beat === 'pressure' ? 54 : rng.int(62, 76), speed: Math.min(30, 25 + lap * 0.6), pillars: recovery ? 0 : rng.int(0, 5) } };
  }
  const format = recovery ? 'timetrial' : RACE_FORMATS[(wave + rng.int(0, 1)) % RACE_FORMATS.length];
  const mods: string[] = []; if (!recovery && lap > 0 && rng.chance(0.4)) mods.push('storm'); if (!recovery && lap > 1 && rng.chance(0.4)) mods.push('sweepers'); if (beat === 'elite') mods.push('aggressive');
  const solo = format === 'timetrial' || format === 'gauntlet';
  return { ...base, mode, name: `Endless ${wave} · ${title(beat)}`, brief: `Seeded ${format} event.`, environment: RACE_ENVS[(lap + wave) % RACE_ENVS.length], enemies: [{ type: 'racer', count: solo ? 0 : format === 'pursuit' ? 1 : Math.min(7, 3 + Math.floor(lap * 0.8)), difficulty: skill }], modifiers: mods, objective: format,
    params: { format, laps: format === 'elimination' ? 4 : 2 + (beat === 'elite' ? 1 : 0), radius: rng.int(170, 240), wobble: recovery ? 0.3 : rng.range(0.36, 0.52), elevation: rng.pick([0, 6, 12, 16]), width: recovery ? 17 : rng.pick([13, 15, 16]), knots: rng.int(9, 12), length: rng.int(1700, 2500), hazards: recovery ? 0 : format === 'gauntlet' ? 14 : rng.int(2, 7), pads: rng.int(3, 6), passPlace: 3, stages: 1, seed: hashSeed(runSeed, wave) % 100000 } };
}
function title(b: EndlessBeat) { return b[0].toUpperCase() + b.slice(1); }
