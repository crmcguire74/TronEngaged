import type { Settings } from '../persistence/store';
import type { DifficultyId, TierDefinition } from '../progression/types';
import type { BaseSession, Ctx } from './context';
import { DiscSession } from '../games/discs/session';
import { CombatSession } from '../games/cycles/combatSession';
import { RaceSession } from '../games/cycles/raceSession';

/** Only the assets a scene needs are requested; the loader caches them for later tiers. */
export function sessionAssets(tier: TierDefinition, s: Settings): string[] {
  if (tier.mode === 'discs') return DiscSession.assets(tier, s.skin);
  // the rider on the player's cycle wears the chosen skin, which may not be the default one
  if (tier.mode === 'cycle-combat') return [...CombatSession.assets(tier, s.cycle), 'char:' + s.skin];
  return [...RaceSession.assets(tier, s.cycle), 'char:' + s.skin];
}
export function createSession(ctx: Ctx, tier: TierDefinition, diff: DifficultyId, salt: number, stage: number): BaseSession {
  if (tier.mode === 'discs') return new DiscSession(ctx, tier, diff, salt);
  if (tier.mode === 'cycle-combat') return new CombatSession(ctx, tier, diff, salt);
  return new RaceSession(ctx, tier, diff, salt, stage);
}
