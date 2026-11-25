import { describe, expect, it } from 'vitest';
import { medalGoals, medalResult, starCount, starText } from '../progression/medals';
import { DISC_TIERS } from '../progression/tiers/discs';
import { COMBAT_TIERS, RACE_TIERS } from '../progression/tiers/cycles';
import { SaveStore } from '../persistence/store';

describe('three-star mastery', () => {
  it('gives every authored tier exactly three goals, the first being the clear', () => {
    for (const t of [...DISC_TIERS, ...COMBAT_TIERS, ...RACE_TIERS]) { const g = medalGoals(t); expect(g).toHaveLength(3); expect(new Set(g).size).toBe(3); }
  });
  it('awards nothing on a lost run, however well it went', () => {
    expect(starCount(medalResult(DISC_TIERS[0], false, { damageTaken: 0, ricochetHits: 9, parries: 9 }))).toBe(0);
  });
  it('reads disc goals from the run: damage taken, then ricochets plus parries', () => {
    const t = DISC_TIERS[4];
    expect(starCount(medalResult(t, true, { damageTaken: 80, ricochetHits: 0, parries: 0 }))).toBe(1);
    expect(starCount(medalResult(t, true, { damageTaken: 35, ricochetHits: 1, parries: 1 }))).toBe(2);
    expect(starCount(medalResult(t, true, { damageTaken: 10, ricochetHits: 2, parries: 1 }))).toBe(3);
  });
  it('scales the combat trap goal with the field, and counts close calls', () => {
    const big = COMBAT_TIERS.find((t) => t.enemies.reduce((a, e) => a + e.count, 0) >= 4)!;
    expect(medalGoals(big)[1]).toMatch(/Trap 2/);
    expect(starCount(medalResult(big, true, { trapKills: 1, nearMisses: 3 }))).toBe(2);
    expect(starCount(medalResult(big, true, { trapKills: 2, nearMisses: 3 }))).toBe(3);
  });
  it('asks racers to win (or ride clean when alone) and to take a rival down on light-wall tiers', () => {
    const wall = RACE_TIERS.find((t) => t.modifiers.includes('lightwalls') && t.params.format === 'circuit')!;
    expect(medalGoals(wall)).toEqual(['Complete the event', 'Finish first', 'Take down a rival']);
    expect(starCount(medalResult(wall, true, { place: 1, takedowns: 1, scrapes: 9 }))).toBe(3);
    const solo = RACE_TIERS.find((t) => t.params.format === 'timetrial')!;
    expect(medalGoals(solo)[1]).toMatch(/clean/);
    expect(starCount(medalResult(solo, true, { sections: 8, cleanSections: 6, scrapes: 1 }))).toBe(3);
  });
  it('keeps the best stars a tier has earned and totals them', () => {
    const s = new SaveStore(); s.recordTier('a', 100, 10, 'standard', 3); s.recordTier('a', 200, 9, 'standard', 1); s.recordTier('b', 50, 9, 'standard', 2);
    expect(s.data.completed.a.stars).toBe(3); expect(s.stars(['a', 'b', 'c'])).toBe(5); expect(starText(2)).toBe('★★☆');
  });
});
