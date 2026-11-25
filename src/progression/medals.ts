import type { TierDefinition } from './types';

/**
 * Three-star mastery for every authored tier. Star one is the clear; stars two and three are skill goals that point at
 * what the mode rewards, so a cleared tier still has something to come back for:
 *   Disc Arena    - defend well (take little damage), and play the walls or the shield (ricochets and parries)
 *   Combat        - win by trapping rivals on your own wall, and ride close to danger (close calls)
 *   Racing        - win the race (or, alone on the track, ride it clean), and either take a rival down (light-wall
 *                   tiers) or keep off the rails
 * Goals are read from the simulation's own end-of-run stats, so they never disagree with what happened.
 */
export interface Goal { label: string; met: boolean }
type Test = (s: any) => boolean;

const rivals = (t: TierDefinition) => t.enemies.reduce((a, e) => a + e.count, 0);

function goals(t: TierDefinition): [string, Test][] {
  if (t.mode === 'discs') return [['Clear the arena', () => true], ['Take 35 damage or less', (s) => s.damageTaken <= 35], ['Land 3 ricochets or parries', (s) => s.ricochetHits + s.parries >= 3]];
  if (t.mode === 'cycle-combat') { const n = Math.max(1, Math.floor(rivals(t) / 2)); return [['Be the last rider standing', () => true], [`Trap ${n} rival${n > 1 ? 's' : ''} on your wall`, (s) => s.trapKills >= n], ['Ride 3 close calls', (s) => s.nearMisses >= 3]]; }
  const f = String(t.params.format ?? 'circuit'), solo = f === 'timetrial' || f === 'gauntlet' || f === 'pursuit';
  return [
    ['Complete the event', () => true],
    solo ? ['Ride 75% of sectors clean', (s) => s.sections > 0 && s.cleanSections / s.sections >= 0.75] : ['Finish first', (s) => s.place === 1],
    t.modifiers.includes('lightwalls') ? ['Take down a rival', (s) => (s.takedowns ?? 0) >= 1] : ['Two rail contacts or fewer', (s) => s.scrapes <= 2],
  ];
}

/** The three goals for a tier, for the briefing. Endless tiers have none. */
export function medalGoals(t: TierDefinition): string[] { return t.endless ? [] : goals(t).map(([l]) => l); }

/** Which goals a run met. Nothing is met on a lost run: the stars are for a clear. */
export function medalResult(t: TierDefinition, won: boolean, stats: any): Goal[] {
  if (t.endless) return [];
  return goals(t).map(([label, test]) => ({ label, met: won && !!stats && test(stats) }));
}
export const starCount = (g: Goal[]) => g.filter((x) => x.met).length;
/** Filled and hollow stars, e.g. ★★☆. */
export const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
