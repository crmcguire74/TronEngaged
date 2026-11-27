import { DISC_TIERS } from './tiers/discs';
import { COMBAT_TIERS, CYCLE_TIERS, RACE_TIERS } from './tiers/cycles';
import type { GameMode, TierDefinition } from './types';
import type { SaveData } from '../persistence/store';

export type TrackId = 'discs' | 'cycles' | 'combat' | 'race';
export const TRACKS: Record<TrackId, { label: string; tiers: readonly TierDefinition[]; endless: GameMode[] }> = {
  discs: { label: 'Disc Arena', tiers: DISC_TIERS, endless: ['discs'] },
  cycles: { label: 'Cycle Campaign', tiers: CYCLE_TIERS, endless: ['cycle-combat', 'cycle-race'] },
  combat: { label: 'Cycle Combat', tiers: COMBAT_TIERS, endless: ['cycle-combat'] },
  race: { label: 'Cycle Racing', tiers: RACE_TIERS, endless: ['cycle-race'] },
};
const key = (t: TierDefinition) => `${t.mode === 'discs' ? 'discs' : 'cycles'}:${t.id}`;
export const tierKey = key;
export const isComplete = (s: SaveData, t: TierDefinition) => !!s.completed[key(t)];
/** Number of tiers selectable in a track: everything up to and including the first incomplete one. */
export function unlockedCount(s: SaveData, track: TrackId): number {
  const list = TRACKS[track].tiers; let i = 0; while (i < list.length && isComplete(s, list[i])) i++; return Math.min(list.length, i + 1);
}
export const trackComplete = (s: SaveData, track: TrackId) => TRACKS[track].tiers.every((t) => isComplete(s, t));
export const endlessUnlocked = (s: SaveData, mode: GameMode) => (mode === 'discs' ? trackComplete(s, 'discs') : mode === 'cycle-combat' ? trackComplete(s, 'combat') : trackComplete(s, 'race'));

export interface Cosmetic { id: string; kind: 'skin' | 'cycle' | 'trail' | 'disc' | 'arena' | 'endless'; label: string; color?: number }
export const COSMETICS: Cosmetic[] = [
  { id: 'skin:azure', kind: 'skin', label: 'Azure Runner' }, { id: 'skin:cobalt', kind: 'skin', label: 'Cobalt Runner' }, { id: 'skin:ivory', kind: 'skin', label: 'Ivory Runner' }, { id: 'skin:crimson', kind: 'skin', label: 'Crimson Runner' },
  { id: 'cycle:blade', kind: 'cycle', label: 'Blade' }, { id: 'cycle:azure', kind: 'cycle', label: 'Azure Mk I' }, { id: 'cycle:jade', kind: 'cycle', label: 'Jade Lancer' }, { id: 'cycle:ember', kind: 'cycle', label: 'Ember Rush' }, { id: 'cycle:violet', kind: 'cycle', label: 'Violet Apex' }, { id: 'cycle:argon', kind: 'cycle', label: 'Argon Runner' }, { id: 'cycle:moto', kind: 'cycle', label: 'Moto Bulk' }, { id: 'cycle:agile', kind: 'cycle', label: 'Agile' }, { id: 'cycle:monolith', kind: 'cycle', label: 'Monolith' }, { id: 'cycle:flynn', kind: 'cycle', label: "Flynn's" },
  { id: 'disc:azure', kind: 'disc', label: 'Standard Disc' }, { id: 'disc:identity', kind: 'disc', label: 'Identity Disc' },
  { id: 'trail:ion', kind: 'trail', label: 'Ion', color: 0x4fe3ff }, { id: 'trail:amber', kind: 'trail', label: 'Amber', color: 0xffb62e }, { id: 'trail:violet', kind: 'trail', label: 'Violet', color: 0xb56bff }, { id: 'trail:jade', kind: 'trail', label: 'Jade', color: 0x45ff9a }, { id: 'trail:prism', kind: 'trail', label: 'Prism', color: 0xffffff }, { id: 'trail:nullwave', kind: 'trail', label: 'Nullwave', color: 0xff6a1f },
];
export const DEFAULT_UNLOCKS = ['skin:azure', 'cycle:blade', 'cycle:azure', 'trail:ion', 'disc:azure'];
export const cosmetic = (id: string) => COSMETICS.find((c) => c.id === id);

export interface Achievement { id: string; label: string; hint: string; test: (s: SaveData) => boolean }
const done = (s: SaveData, track: TrackId, n: number) => TRACKS[track].tiers.filter((t) => isComplete(s, t)).length >= n;
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-disc', label: 'First Throw', hint: 'Clear a Disc Arena tier', test: (s) => done(s, 'discs', 1) },
  { id: 'first-cycle', label: 'First Ribbon', hint: 'Clear a Cycle tier', test: (s) => done(s, 'cycles', 1) },
  { id: 'guardian', label: 'Shieldbreaker', hint: 'Defeat the First Guardian', test: (s) => done(s, 'discs', 5) },
  { id: 'disc-10', label: 'Enforced', hint: 'Clear Disc tier 10', test: (s) => done(s, 'discs', 10) },
  { id: 'disc-30', label: 'Kernel Panic', hint: 'Clear Disc tier 30', test: (s) => done(s, 'discs', 30) },
  { id: 'disc-42', label: 'Last Program Standing', hint: 'Clear all 42 Disc tiers', test: (s) => done(s, 'discs', 42) },
  { id: 'cycle-30', label: 'Apex Rider', hint: 'Clear all 30 Cycle tiers', test: (s) => done(s, 'cycles', 30) },
  { id: 'parry-25', label: 'Return to Sender', hint: 'Parry 25 discs', test: (s) => s.totals.parries >= 25 },
  { id: 'bank-25', label: 'Geometer', hint: 'Land 25 ricochet hits', test: (s) => s.totals.ricochets >= 25 },
  { id: 'trap-25', label: 'Boxed In', hint: 'Trap 25 rivals with your ribbon', test: (s) => s.totals.traps >= 25 },
  { id: 'podium-10', label: 'Podium Regular', hint: 'Win 10 races', test: (s) => s.totals.raceWins >= 10 },
  { id: 'endless-10', label: 'No Final Tier', hint: 'Reach endless wave 10 in any mode', test: (s) => Object.values(s.endless).some((e) => e.bestWave >= 10) },
  { id: 'master', label: 'Master Class', hint: 'Clear any tier on Master', test: (s) => Object.values(s.completed).some((c) => c.difficulty === 'master') },
];
