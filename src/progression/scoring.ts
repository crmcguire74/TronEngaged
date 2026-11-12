/** All scoring formulas are deterministic and versioned so saved records can be re-balanced later. */
export const SCORING_VERSION = 1;

export const DISC_POINTS = { hit: 100, ricochetPerBounce: 75, kill: 500, fallKill: 650, envKill: 600, parry: 150, clash: 40, comboStep: 0.25, comboMax: 3, comboWindow: 4 };
export function discHitScore(bounces: number, combo: number): number {
  const mult = Math.min(DISC_POINTS.comboMax, 1 + DISC_POINTS.comboStep * Math.max(0, combo - 1));
  return Math.round((DISC_POINTS.hit + DISC_POINTS.ricochetPerBounce * bounces) * mult);
}
export interface DiscStats { throws: number; hits: number; ricochetHits: number; parries: number; kills: number; fallKills: number; damageTaken: number; time: number; maxCombo: number; score: number }
export function discFinalScore(s: DiscStats, won: boolean, tierMul: number, diffMul: number): { total: number; lines: [string, number][] } {
  const lines: [string, number][] = [['Combat', s.score]];
  if (won) {
    const acc = s.throws > 0 ? s.hits / s.throws : 0;
    lines.push(['Accuracy ' + Math.round(acc * 100) + '%', Math.round(acc * 600)]);
    lines.push(['Efficiency', Math.max(0, 400 - s.throws * 8)]);
    lines.push(['Integrity', Math.max(0, Math.round(500 - s.damageTaken * 5))]);
    lines.push(['Tempo', Math.max(0, Math.round(600 - s.time * 5))]);
  }
  const base = lines.reduce((a, l) => a + l[1], 0);
  return { total: Math.round(base * tierMul * diffMul), lines };
}

export const CYCLE_POINTS = { trapKill: 400, rivalDown: 150, grindPerMeter: 1.5, survivalPerSec: 6, boostNearMiss: 60, win: 600 };
export interface CycleStats { trapKills: number; rivalsDown: number; grindMeters: number; nearMisses: number; time: number; score: number; pickups: number }
export function cycleFinalScore(s: CycleStats, won: boolean, tierMul: number, diffMul: number): { total: number; lines: [string, number][] } {
  const lines: [string, number][] = [
    ['Traps ×' + s.trapKills, s.trapKills * CYCLE_POINTS.trapKill],
    ['Rivals down ×' + s.rivalsDown, s.rivalsDown * CYCLE_POINTS.rivalDown],
    ['Wall riding ' + Math.round(s.grindMeters) + ' m', Math.round(s.grindMeters * CYCLE_POINTS.grindPerMeter)],
    ['Close calls ×' + s.nearMisses, s.nearMisses * CYCLE_POINTS.boostNearMiss],
    ['Survival', Math.round(Math.min(s.time, 120) * CYCLE_POINTS.survivalPerSec)],
  ];
  if (won) lines.push(['Arena cleared', CYCLE_POINTS.win]);
  const base = lines.reduce((a, l) => a + l[1], 0);
  return { total: Math.round(base * tierMul * diffMul), lines };
}

export interface RaceStats { place: number; field: number; time: number; parTime: number; overtakes: number; cleanSections: number; sections: number; scrapes: number; driftMeters: number; bestLap: number; takedowns?: number }
export const RACE_PLACE_POINTS = [1000, 700, 500, 350, 250, 180, 120, 80];
export function raceFinalScore(s: RaceStats, passed: boolean, tierMul: number, diffMul: number): { total: number; lines: [string, number][] } {
  const lines: [string, number][] = [
    ['Placement P' + s.place, RACE_PLACE_POINTS[Math.min(s.place - 1, RACE_PLACE_POINTS.length - 1)] ?? 0],
    ['Pace', Math.max(0, Math.round((s.parTime - s.time) * 12) + 300)],
    ['Clean sectors ' + s.cleanSections + '/' + s.sections, s.cleanSections * 60],
    ['Overtakes ×' + s.overtakes, s.overtakes * 90],
    ['Drift ' + Math.round(s.driftMeters) + ' m', Math.round(s.driftMeters * 0.8)],
    ['Takedowns ×' + (s.takedowns ?? 0), (s.takedowns ?? 0) * 220],
  ];
  const base = lines.reduce((a, l) => a + l[1], 0) * (passed ? 1 : 0.5);
  return { total: Math.round(base * tierMul * diffMul), lines };
}
