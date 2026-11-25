import { Rng, clamp, hashSeed } from '../engine/math';
import { buildArena, validateArena, type ArenaDef } from '../games/discs/arena';
import type { DiscSimConfig } from '../games/discs/sim';
import type { CombatConfig, RivalDef } from '../games/cycles/combat';
import type { RaceConfig, RaceFormat } from '../games/cycles/race';
import { buildTrack } from '../games/cycles/track';
import { DIFFICULTIES, type DifficultyId, type TierDefinition } from './types';

const num = (t: TierDefinition, k: string, d = 0) => (typeof t.params[k] === 'number' ? (t.params[k] as number) : d);
const has = (t: TierDefinition, m: string) => t.modifiers.includes(m);

export function buildDiscArena(t: TierDefinition, seed: number): ArenaDef {
  const mk = (relax: number) => buildArena({
    playerPlatforms: num(t, 'playerPlatforms', 1), enemyPlatforms: num(t, 'enemyPlatforms', 1), heights: (relax > 1 ? 'flat' : (t.params.heights as any)) ?? 'flat',
    moving: has(t, 'moving-platforms') || has(t, 'moving-both'), movingBoth: has(t, 'moving-both'),
    collapsing: has(t, 'collapsing') || !!t.params.collapseLater, shifting: (has(t, 'shifting') || has(t, 'rapid-shift') || !!t.params.shiftCapable) && relax < 1,
    barriers: has(t, 'barriers') ? num(t, 'barriers', 2) : 0, rotating: has(t, 'rotating-shields') ? num(t, 'rotating', 1) : 0,
    volatile: has(t, 'volatile') ? num(t, 'volatile', 2) : 0, cover: has(t, 'cover') ? 1 : 0, midwall: has(t, 'midwall'),
  }, new Rng(seed));
  // validated before the player enters; relax decorative complexity if a generated layout fails
  for (let relax = 0; relax < 3; relax++) { const a = mk(relax); if (!validateArena(a).length) return a; }
  return mk(2);
}

export function buildDiscConfig(t: TierDefinition, diff: DifficultyId, seedSalt = 0): DiscSimConfig {
  const D = DIFFICULTIES[diff], seed = hashSeed('discs', t.id, t.name, seedSalt);
  const mods = t.params.collapseLater ? [...t.modifiers, 'collapse-later'] : t.modifiers;
  return {
    arena: buildDiscArena(t, seed), seed, waves: [t.enemies, ...(t.waves ?? [])], modifiers: mods,
    playerHp: Math.round(100 * D.resources), playerShield: Math.round(100 * D.resources * num(t, 'shieldMul', 1)), playerDiscs: num(t, 'playerDiscs', 3),
    aiSkill: D.aiSkill, hazardMul: D.hazards, maxAttackers: num(t, 'maxAttackers', 1), discSpeedMul: num(t, 'discSpeed', 1), platformHp: num(t, 'platformHp', 4),
  };
}

const MODELS = ['ember', 'wraith', 'jade', 'bulwark', 'violet', 'agile', 'argon', 'flynn', 'moto'];
/** Machines a Combat tier fields, in the order riders are assigned them. */
export function combatRivalModels(t: TierDefinition): string[] {
  const out: string[] = []; for (const e of t.enemies) for (let i = 0; i < e.count; i++) out.push(MODELS[out.length % MODELS.length]);
  return out;
}
const RACE_POOL = ['ember', 'agile', 'argon', 'wraith', 'flynn', 'moto', 'jade', 'bulwark', 'violet', 'azure'];
/**
 * Machines a Race tier fields. The roster is large enough now that preloading all of it on every event would cost
 * tens of megabytes, so the sessions ask for exactly the models that will be on the grid.
 */
export function raceRivalModels(t: TierDefinition, playerModel: string): string[] {
  const e = t.enemies[0], others = RACE_POOL.filter((m) => m !== playerModel), out: string[] = [];
  for (let i = 0; i < (e?.count ?? 0); i++) out.push(others[i % others.length]);
  return out;
}
export function buildCombatConfig(t: TierDefinition, diff: DifficultyId, seedSalt = 0): CombatConfig {
  const D = DIFFICULTIES[diff]; const rivals: RivalDef[] = [];
  const models = combatRivalModels(t);
  for (const e of t.enemies) for (let i = 0; i < e.count; i++) rivals.push({ profile: e.type as RivalDef['profile'], skill: e.difficulty, model: models[rivals.length] });
  return { half: num(t, 'half', 70), seed: hashSeed('combat', t.id, t.name, seedSalt), speed: num(t, 'speed', 24) * (diff === 'apprentice' ? 0.9 : 1), rivals, modifiers: t.modifiers, pillars: num(t, 'pillars'), aiSkill: D.aiSkill, hazardMul: D.hazards, resources: D.resources };
}

export function buildRaceConfig(t: TierDefinition, diff: DifficultyId, playerModel: string, stage = 0, seedSalt = 0): RaceConfig {
  const D = DIFFICULTIES[diff], format = String(t.params.format ?? 'circuit') as RaceFormat, sprint = format === 'sprint';
  const seed = hashSeed('race', num(t, 'seed', t.id), stage, seedSalt);
  const track = buildTrack({ seed, closed: !sprint, radius: num(t, 'radius', 190) * (1 + stage * 0.06), wobble: num(t, 'wobble', 0.3), elevation: num(t, 'elevation'), width: num(t, 'width', 16), knots: num(t, 'knots', 9) + stage, length: num(t, 'length', 1600),
    // every circuit gets a distinct plan: two to four inward bends, cut deeper on later tiers
    lobes: num(t, 'lobes', 2 + ((t.id + stage) % 3)), depth: num(t, 'depth', 0.3 + Math.min(0.12, t.id * 0.006)), stretch: num(t, 'stretch', 1 + ((t.id * 7 + stage * 3) % 5) * 0.14),
    // terrain and built sections: rolling crests, banked corners, and tunnels / bridges / city canyons round the lap
    hills: num(t, 'hills'), hillCount: num(t, 'hillCount', 3) + (stage % 2), bank: num(t, 'bank'),
    tunnels: num(t, 'tunnels'), bridges: num(t, 'bridges'), canyons: num(t, 'canyons') });
  const e = t.enemies[0]; const rivals = []; const models = raceRivalModels(t, playerModel);
  // the early tiers (to 14) had rivals that a player could lap after one light wall: their skill gets a floor that
  // fades out by tier 14, so the first races are still beatable but are races
  const floor = t.endless ? 0 : clamp((15 - t.id) / 13, 0, 1) * 0.22;
  for (let i = 0; i < models.length; i++) rivals.push({ skill: Math.min(1, (e.difficulty + floor) * (1 - 0.06 * ((i * 7) % 4))), model: models[i] });
  // from the fourth tier on, riders can be rammed off the road
  return { track, seed, laps: num(t, 'laps', 2), format, rivals, modifiers: t.id >= 4 ? [...t.modifiers, 'ramming'] : t.modifiers, aiSkill: D.aiSkill, hazardMul: D.hazards, resources: D.resources, passPlace: num(t, 'passPlace', 3), playerModel, hazards: num(t, 'hazards'), pads: num(t, 'pads', 3) };
}
