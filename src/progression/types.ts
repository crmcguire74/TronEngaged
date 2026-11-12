export type GameMode = 'discs' | 'cycle-combat' | 'cycle-race';
export type DifficultyId = 'apprentice' | 'standard' | 'veteran' | 'master';

export interface EnemySpawn { readonly type: string; readonly count: number; readonly difficulty: number }

/** Declarative tier schema (PRD 9.5) extended with typed tuning params. */
export type TierDefinition = Readonly<{
  id: number;
  mode: GameMode;
  name: string;
  brief: string;
  environment: string;
  enemies: readonly EnemySpawn[];
  /** Extra waves that materialise after the first group is cleared (disc gauntlets). */
  waves?: readonly (readonly EnemySpawn[])[];
  modifiers: readonly string[];
  objective: string;
  unlocks: readonly string[];
  params: Readonly<Record<string, number | string>>;
  scoreMul: number;
  boss?: string;
  endless?: boolean;
}>;

export interface DifficultyDef {
  id: DifficultyId; label: string; blurb: string;
  /** Added to every enemy difficulty value (AI decision quality). */
  aiSkill: number;
  /** Player defensive resources multiplier (health / shield / boost). */
  resources: number;
  /** Hazard frequency multiplier. */
  hazards: number;
  scoreMul: number;
}
export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  apprentice: { id: 'apprentice', label: 'Apprentice', blurb: 'Forgiving rivals, generous reserves.', aiSkill: -0.22, resources: 1.35, hazards: 0.7, scoreMul: 0.75 },
  standard: { id: 'standard', label: 'Standard', blurb: 'The intended challenge.', aiSkill: 0, resources: 1, hazards: 1, scoreMul: 1 },
  veteran: { id: 'veteran', label: 'Veteran', blurb: 'Sharper tactics, thinner margins.', aiSkill: 0.14, resources: 0.85, hazards: 1.25, scoreMul: 1.4 },
  master: { id: 'master', label: 'Master', blurb: 'Rivals plan, bait and punish.', aiSkill: 0.28, resources: 0.7, hazards: 1.5, scoreMul: 2 },
};
export const DIFFICULTY_ORDER: DifficultyId[] = ['apprentice', 'standard', 'veteran', 'master'];
