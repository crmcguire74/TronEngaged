import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DISC_TIERS } from '../progression/tiers/discs';
import { COMBAT_TIERS, CYCLE_TIERS, RACE_TIERS } from '../progression/tiers/cycles';
import { ARCHETYPES } from '../games/discs/archetypes';
import { THEMES } from '../engine/env';
import { endlessSkill, endlessTier } from '../progression/director';
import { buildCombatConfig, buildDiscConfig, buildRaceConfig } from '../progression/build';
import { validateArena } from '../games/discs/arena';
import { validateTrack } from '../games/cycles/track';
import { SCORING_VERSION, cycleFinalScore, discFinalScore, discHitScore, raceFinalScore } from '../progression/scoring';
import { ACHIEVEMENTS, TRACKS, endlessUnlocked, tierKey, unlockedCount } from '../progression/rewards';
import { SaveStore, defaultSave, migrate } from '../persistence/store';
import { DiscSim } from '../games/discs/sim';
import { CombatSim } from '../games/cycles/combat';
import { runCombatBot, runDiscBot } from './bots';

describe('tier configuration', () => {
  it('ships the authored tiers for each game with sequential ids', () => {
    expect(DISC_TIERS.length).toBe(42); expect(CYCLE_TIERS.length).toBe(42); expect(COMBAT_TIERS.length).toBe(21); expect(RACE_TIERS.length).toBe(21);
    DISC_TIERS.forEach((t, i) => { expect(t.id).toBe(i + 1); expect(t.mode).toBe('discs'); }); CYCLE_TIERS.forEach((t, i) => { expect(t.id).toBe(i + 1); expect(t.mode).toBe(i % 2 ? 'cycle-race' : 'cycle-combat'); });
  });
  it('every enemy type referenced by a tier exists, and bosses have authored phases', () => {
    for (const t of DISC_TIERS) for (const e of [t.enemies, ...(t.waves ?? [])].flat()) expect(ARCHETYPES[e.type], e.type).toBeTruthy();
    const bosses = DISC_TIERS.filter((t) => t.boss); expect(bosses.map((t) => t.id)).toEqual([5, 10, 20, 25, 30, 36]);
    for (const t of bosses) expect(ARCHETYPES[t.boss!].boss!.phases.length).toBeGreaterThanOrEqual(2);
  });
  it('every tier names an environment that has a theme', () => {
    for (const t of [...DISC_TIERS, ...CYCLE_TIERS]) expect(THEMES[t.environment], `${t.mode} ${t.id} ${t.name} -> ${t.environment}`).toBeTruthy();
  });
  it('every fifth tier introduces a new environment, mechanic or boss', () => {
    for (let i = 5; i < 31; i += 5) expect(DISC_TIERS[i].environment).not.toBe(DISC_TIERS[i - 1].environment);
    for (const t of DISC_TIERS) expect(t.environment, `tier ${t.id}`).toBeTruthy();
    const seen = new Set<string>(); for (let block = 0; block < 7; block++) { const mods = new Set(DISC_TIERS.slice(block * 5, block === 6 ? 36 : block * 5 + 5).flatMap((t) => [...t.modifiers, ...t.enemies.map((e) => e.type)])); const fresh = [...mods].filter((m) => !seen.has(m)); expect(fresh.length, `block ${block}`).toBeGreaterThan(0); mods.forEach((m) => seen.add(m)); }
  });
});

describe('scoring', () => {
  it('is deterministic and versioned', () => {
    expect(SCORING_VERSION).toBe(1); expect(discHitScore(0, 1)).toBe(100); expect(discHitScore(2, 1)).toBe(250); expect(discHitScore(0, 3)).toBe(150); expect(discHitScore(0, 99)).toBe(300);
    const s = { throws: 10, hits: 5, ricochetHits: 2, parries: 1, kills: 2, fallKills: 0, damageTaken: 25, time: 40, maxCombo: 2, score: 1500 };
    expect(discFinalScore(s, true, 1, 1)).toEqual(discFinalScore(s, true, 1, 1)); expect(discFinalScore(s, true, 2, 1).total).toBe(discFinalScore(s, true, 1, 1).total * 2); expect(discFinalScore(s, false, 1, 1).total).toBe(1500);
    expect(cycleFinalScore({ trapKills: 2, rivalsDown: 3, grindMeters: 100, nearMisses: 1, time: 30, score: 0, pickups: 0 }, true, 1, 1).total).toBe(800 + 450 + 150 + 60 + 180 + 600);
    const r = { place: 1, field: 5, time: 80, parTime: 90, overtakes: 4, cleanSections: 6, sections: 8, scrapes: 2, driftMeters: 100, bestLap: 30 }; expect(raceFinalScore(r, true, 1, 1).total).toBeGreaterThan(raceFinalScore({ ...r, place: 3 }, true, 1, 1).total);
  });
});

describe('unlock progression', () => {
  it('opens tiers one at a time and unlocks endless after the last tier', () => {
    const s = defaultSave(); expect(unlockedCount(s, 'discs')).toBe(1); expect(endlessUnlocked(s, 'discs')).toBe(false);
    for (let i = 0; i < DISC_TIERS.length - 1; i++) { s.completed[tierKey(DISC_TIERS[i])] = { best: 1, difficulty: 'standard', time: 1, clears: 1, scoring: 1 }; expect(unlockedCount(s, 'discs')).toBe(i + 2); }
    s.completed[tierKey(DISC_TIERS[DISC_TIERS.length - 1])] = { best: 1, difficulty: 'master', time: 1, clears: 1, scoring: 1 }; expect(endlessUnlocked(s, 'discs')).toBe(true);
    expect(ACHIEVEMENTS.find((a) => a.id === 'disc-30')!.test(s)).toBe(true); expect(ACHIEVEMENTS.find((a) => a.id === 'master')!.test(s)).toBe(true);
  });
  it('combat and racing keep independent progress', () => {
    const s = defaultSave(); s.completed[tierKey(COMBAT_TIERS[0])] = { best: 1, difficulty: 'standard', time: 1, clears: 1, scoring: 1 };
    expect(unlockedCount(s, 'combat')).toBe(2); expect(unlockedCount(s, 'race')).toBe(1); expect(unlockedCount(s, 'cycles')).toBe(2); expect(TRACKS.combat.tiers[1].id).toBe(3);
  });
});

describe('endless director', () => {
  it('is deterministic per seed and differs across seeds', () => {
    for (const m of ['discs', 'cycle-combat', 'cycle-race'] as const) { expect(endlessTier(m, 7, 1234)).toEqual(endlessTier(m, 7, 1234)); expect(JSON.stringify([1, 2, 3, 4, 5, 6].map((w) => endlessTier(m, w, 1)))).not.toBe(JSON.stringify([1, 2, 3, 4, 5, 6].map((w) => endlessTier(m, w, 2)))); }
  });
  it('never terminates, saturates difficulty and inserts recovery waves', () => {
    expect(endlessSkill(1e6)).toBeLessThan(1); expect(endlessSkill(40)).toBeGreaterThan(endlessSkill(2));
    for (const w of [1, 50, 500, 5000]) expect(endlessTier('discs', w, 9).enemies.length).toBeGreaterThan(0);
    const d = (w: number) => endlessTier('discs', w, 5).enemies[0].difficulty; expect(d(4)).toBeLessThan(d(3)); expect(d(9)).toBeLessThan(d(8));
    for (let w = 1; w <= 200; w++) { const t = endlessTier('cycle-combat', w, 3); expect(Number(t.params.speed)).toBeLessThanOrEqual(30); expect(t.enemies.length).toBeLessThanOrEqual(6); }
  });
  it('only produces validated levels', () => {
    for (let w = 1; w <= 60; w++) { expect(validateArena(buildDiscConfig(endlessTier('discs', w, 77), 'standard').arena), `disc wave ${w}`).toEqual([]); expect(validateTrack(buildRaceConfig(endlessTier('cycle-race', w, 77), 'standard', 'azure').track), `race wave ${w}`).toEqual([]); const c = new CombatSim(buildCombatConfig(endlessTier('cycle-combat', w, 77), 'standard')); for (const cy of c.cycles) expect(c.freeDist(cy.x, cy.z, cy.dir, 30)).toBeGreaterThan(20); }
  });
});

describe('persistence', () => {
  it('saved progress survives a reload', async () => {
    const a = new SaveStore(); await a.load(); a.recordTier('discs:1', 1234, 20, 'veteran'); a.data.settings.volume.music = 0.25; a.data.settings.bindings.jump = 'KeyJ'; a.unlock(['skin:cobalt']); a.data.endless.discs = { bestWave: 7, bestScore: 9000, seed: 42 }; await a.flush();
    const b = new SaveStore(); const d = await b.load(); expect(d.completed['discs:1'].best).toBe(1234); expect(d.completed['discs:1'].difficulty).toBe('veteran'); expect(d.settings.volume.music).toBe(0.25); expect(d.settings.bindings.jump).toBe('KeyJ'); expect(d.unlocks).toContain('skin:cobalt'); expect(d.endless.discs.bestWave).toBe(7);
  });
  it('moves players on the old default machine onto the Blade once, and leaves a chosen machine alone', () => {
    expect(migrate({ version: 1, settings: { cycle: 'azure' } }).settings.cycle).toBe('blade');
    expect(migrate({ version: 1, settings: { cycle: 'ember' } }).settings.cycle).toBe('ember');
    expect(migrate({ version: 2, settings: { cycle: 'azure' } }).settings.cycle).toBe('azure');
    expect(migrate({ version: 1, unlocks: ['skin:azure'] }).unlocks).toContain('cycle:blade');
  });
  it('keeps the best score and migrates older saves onto current defaults', () => {
    const s = new SaveStore(); s.recordTier('k', 500, 30, 'standard'); s.recordTier('k', 300, 10, 'master'); expect(s.data.completed.k.best).toBe(500); expect(s.data.completed.k.time).toBe(10); expect(s.data.completed.k.clears).toBe(2);
    const m = migrate({ settings: { volume: { master: 0.1 } }, completed: { x: { best: 1 } } }); expect(m.settings.volume.master).toBe(0.1); expect(m.settings.volume.music).toBeGreaterThan(0); expect(m.settings.vr.snapTurn).toBe(true); expect(m.completed.x.best).toBe(1); expect(migrate(null).unlocks.length).toBe(4);
  });
});

describe('bot playtest: every authored tier is completable', () => {
  it('disc tiers', () => { for (const t of DISC_TIERS) { let won = false; for (let s = 0; s < 6 && !won; s++) won = runDiscBot(new DiscSim(buildDiscConfig(t, 'apprentice', s)), 300) === 'won'; expect(won, `disc tier ${t.id} ${t.name}`).toBe(true); } }, 240000);
  it('combat tiers', () => { for (const t of COMBAT_TIERS) { let won = false; for (let s = 0; s < 12 && !won; s++) won = runCombatBot(new CombatSim(buildCombatConfig(t, 'apprentice', s)), 300) === 'won'; expect(won, `combat tier ${t.id} ${t.name}`).toBe(true); } }, 240000);
});
