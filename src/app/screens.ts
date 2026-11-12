import type { App } from './app';
import type { Item, Screen } from '../ui/menu';
import { ACTION_LABELS, keyLabel } from '../input/input';
import { DEFAULT_BINDINGS, defaultSave } from '../persistence/store';
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId, type GameMode, type TierDefinition } from '../progression/types';
import { ACHIEVEMENTS, COSMETICS, TRACKS, endlessUnlocked, isComplete, tierKey, unlockedCount, type TrackId } from '../progression/rewards';
import { VEHICLES } from '../games/cycles/race';
import { ARCHETYPES } from '../games/discs/archetypes';
import { fmtTime, type SessionResult } from './context';
import { howToScreen } from './howto';

const pct = (v: number) => Math.round(v * 100) + '%';
const MODE_ICON: Record<GameMode, string> = { discs: '◎', 'cycle-combat': '▚', 'cycle-race': '»' };
const MODE_LABEL: Record<GameMode, string> = { discs: 'Disc Arena', 'cycle-combat': 'Cycle Combat', 'cycle-race': 'Cycle Racing' };

export function mainScreen(app: App): Screen {
  const s = app.store.data, done = (t: TrackId) => TRACKS[t].tiers.filter((x) => isComplete(s, x)).length;
  const next = (t: TrackId) => { const list = TRACKS[t].tiers, n = list[Math.min(unlockedCount(s, t), list.length) - 1]; return `Tier ${String(n.id).padStart(2, '0')} · ${n.name}`; };
  return {
    id: 'main', layout: 'home', kicker: 'VANTA ARC', title: 'Choose a game', noBack: true,
    items: [
      { kind: 'button', label: 'Disc Arena', sub: 'Throw, bank and parry across suspended platforms.', card: { done: done('discs'), total: 30, next: next('discs'), glyph: 'disc' }, action: () => app.playNext('discs') },
      { kind: 'button', label: 'Arc Cycles', sub: 'Wall-laying combat and circuit racing.', card: { done: done('cycles'), total: 30, next: next('cycles'), glyph: 'cycle' }, action: () => app.menu.open(() => cycleScreen(app)) },
      { kind: 'button', label: 'Tier select', link: true, action: () => app.menu.open(() => trackPick(app)) },
      { kind: 'button', label: 'Loadout', link: true, action: () => app.menu.open(() => loadoutScreen(app)) },
      { kind: 'button', label: 'Records', link: true, action: () => app.menu.open(() => recordsScreen(app)) },
      { kind: 'button', label: 'Settings', link: true, action: () => app.menu.open(() => settingsScreen(app)) },
      { kind: 'button', label: 'Credits', link: true, action: () => app.menu.open(() => creditsScreen()) },
    ],
    foot: `<span>${DIFFICULTIES[s.settings.difficulty].label} difficulty</span><span>${s.achievements.length} of ${ACHIEVEMENTS.length} achievements</span>`,
  };
}

export function cycleScreen(app: App): Screen {
  const s = app.store.data, n = (t: TrackId) => `${TRACKS[t].tiers.filter((x) => isComplete(s, x)).length}/${TRACKS[t].tiers.length}`;
  return {
    id: 'cycles', kicker: 'Arc Cycles', title: 'Combat or Racing', text: 'Combat is classic: exact 90° turns and permanent hardlight walls. Racing is fluid: steering, drifting, boost and checkpoints. Each keeps its own progress.',
    items: [
      { kind: 'button', label: 'Campaign', sub: 'All 30 tiers, alternating Combat and Racing', tag: n('cycles'), primary: true, action: () => app.playNext('cycles') },
      { kind: 'button', label: 'Combat', sub: 'Last rider standing — 15 tiers', tag: n('combat'), action: () => app.playNext('combat') },
      { kind: 'button', label: 'Racing', sub: 'Circuits, sprints, eliminations — 15 tiers', tag: n('race'), action: () => app.playNext('race') },
      { kind: 'button', label: 'Tier Select', action: () => app.menu.open(() => tierScreen(app, 'cycles')) },
      { kind: 'button', label: 'Endless Combat', sub: endlessUnlocked(s, 'cycle-combat') ? 'Seeded, escalating arenas' : 'Clear all Combat tiers to unlock', disabled: !endlessUnlocked(s, 'cycle-combat'), action: () => app.startEndless('cycle-combat') },
      { kind: 'button', label: 'Endless Racing', sub: endlessUnlocked(s, 'cycle-race') ? 'Seeded events without a final tier' : 'Clear all Racing tiers to unlock', disabled: !endlessUnlocked(s, 'cycle-race'), action: () => app.startEndless('cycle-race') },
    ],
  };
}

function trackPick(app: App): Screen {
  return { id: 'trackpick', kicker: 'Tier Select', title: 'Choose a Track', items: (['discs', 'cycles', 'combat', 'race'] as TrackId[]).map((t) => ({ kind: 'button' as const, label: TRACKS[t].label, tag: `${unlockedCount(app.store.data, t)} unlocked`, action: () => app.menu.open(() => tierScreen(app, t)) })) };
}

export function tierScreen(app: App, track: TrackId): Screen {
  const s = app.store.data, T = TRACKS[track], open = unlockedCount(s, track);
  const tiles: Item[] = T.tiers.map((t, i) => { const rec = s.completed[tierKey(t)]; return { kind: 'tile' as const, no: String(t.id).padStart(2, '0'), label: t.name, icon: MODE_ICON[t.mode], tag: rec ? rec.best.toLocaleString() : i < open ? 'OPEN' : 'LOCKED', state: rec ? 'done' : i < open ? 'open' : 'locked', boss: !!t.boss, action: () => app.startTier(track, t) }; });
  for (const m of T.endless) { const ok = endlessUnlocked(s, m), e = s.endless[m]; tiles.push({ kind: 'tile', no: '∞', label: 'Endless ' + MODE_LABEL[m].replace('Cycle ', ''), icon: MODE_ICON[m], tag: ok ? (e ? 'WAVE ' + e.bestWave : 'OPEN') : 'LOCKED', state: ok ? 'open' : 'locked', action: () => app.startEndless(m) }); }
  return { id: 'tiers-' + track, kicker: 'Tier Select', title: T.label, wide: true, text: 'Every fifth tier changes the rules. Clear a tier to open the next; clear them all to unlock Endless.', items: [difficultyItem(app)], tiles,
    side: { title: 'Legend', rows: [['◎', 'Disc Arena'], ['▚', 'Cycle Combat'], ['»', 'Cycle Racing'], ['Red frame', 'Boss encounter'], ['∞', 'Endless (seeded)']] } };
}

const difficultyItem = (app: App): Item => ({ kind: 'choice', label: 'Difficulty', get: () => app.store.data.settings.difficulty, set: (v) => { app.store.data.settings.difficulty = v as DifficultyId; app.applySettings(); }, options: DIFFICULTY_ORDER.map((d) => [d, DIFFICULTIES[d].label] as [string, string]) });

export function briefingScreen(app: App, track: TrackId | 'endless', t: TierDefinition): Screen {
  const mode = MODE_LABEL[t.mode]; const rows: [string, string][] = [['Mode', mode], ['Environment', t.environment.replace(/-/g, ' ')]];
  if (t.mode === 'discs') { const names = [t.enemies, ...(t.waves ?? [])].flat().map((e) => `${e.count > 1 ? e.count + '× ' : ''}${ARCHETYPES[e.type]?.label ?? e.type}`); rows.push(['Opposition', names.join(', ')]); }
  else if (t.mode === 'cycle-combat') rows.push(['Rivals', String(t.enemies.reduce((a, e) => a + e.count, 0))]);
  else rows.push(['Format', String(t.params.format)], ['Field', String((t.enemies[0]?.count ?? 0) + 1)]);
  if (t.modifiers.length) rows.push(['Modifiers', t.modifiers.join(', ').replace(/-/g, ' ')]);
  rows.push(['Score multiplier', '×' + (t.scoreMul * DIFFICULTIES[app.store.data.settings.difficulty].scoreMul).toFixed(2)]);
  return { id: 'brief', kicker: `${track === 'endless' ? 'Endless' : TRACKS[track].label} · Tier ${t.endless ? t.id - 1000 : String(t.id).padStart(2, '0')}`, title: t.name, text: t.brief,
    items: [{ kind: 'button', label: 'Initialise', primary: true, sub: mode, action: () => app.launch() }, { kind: 'button', label: 'How to play', sub: 'Goal, controls and what this tier adds', action: () => app.menu.open(() => howToScreen(app, t)) }, difficultyItem(app), { kind: 'button', label: 'Back', action: () => app.menu.back() }], side: { title: 'Briefing', rows } };
}

export function loadoutScreen(app: App): Screen {
  const s = app.store.data, st = s.settings, opts = (kind: string) => COSMETICS.filter((c) => c.kind === kind && s.unlocks.includes(c.id)).map((c) => [c.id.split(':')[1], c.label] as [string, string]);
  const veh = VEHICLES[st.cycle] ?? VEHICLES.azure;
  return { id: 'loadout', kicker: 'Loadout', title: 'Runner & Cycle', text: 'Finishes unlock as you clear tiers. Cycles differ in top speed, acceleration and handling during races.',
    items: [
      { kind: 'choice', label: 'Runner', get: () => st.skin, set: (v) => { st.skin = v; app.applySettings(); }, options: opts('skin') },
      { kind: 'choice', label: 'Cycle', get: () => st.cycle, set: (v) => { st.cycle = v; app.applySettings(); }, options: opts('cycle') },
      { kind: 'choice', label: 'Trail finish', get: () => st.trail, set: (v) => { st.trail = v; app.applySettings(); }, options: opts('trail') },
      { kind: 'row', label: 'Top speed', value: Math.round(veh.top * 3.6) + ' km/h' }, { kind: 'row', label: 'Acceleration', value: veh.accel.toFixed(0) }, { kind: 'row', label: 'Handling', value: veh.handling.toFixed(2) },
      { kind: 'title', label: `Locked: ${COSMETICS.filter((c) => !s.unlocks.includes(c.id)).map((c) => c.label).join(' · ') || 'nothing — all finishes unlocked'}` },
    ] };
}

export function recordsScreen(app: App): Screen {
  const s = app.store.data; const items: Item[] = [{ kind: 'title', label: 'Top scores' }];
  for (const e of s.scores.slice(0, 8)) items.push({ kind: 'row', label: `${MODE_ICON[e.mode]} ${e.name} · ${DIFFICULTIES[e.difficulty].label}`, value: e.score.toLocaleString() });
  if (!s.scores.length) items.push({ kind: 'row', label: 'No runs recorded yet', value: '—' });
  items.push({ kind: 'title', label: 'Endless bests' });
  for (const m of ['discs', 'cycle-combat', 'cycle-race'] as GameMode[]) items.push({ kind: 'row', label: MODE_LABEL[m], value: s.endless[m] ? `Wave ${s.endless[m].bestWave} · ${s.endless[m].bestScore.toLocaleString()}` : endlessUnlocked(s, m) ? 'Not attempted' : 'Locked' });
  items.push({ kind: 'title', label: 'Achievements' });
  for (const a of ACHIEVEMENTS) items.push({ kind: 'row', label: (s.achievements.includes(a.id) ? '◆ ' : '◇ ') + a.label, value: a.hint });
  return { id: 'records', kicker: 'Records', title: 'Runner Archive', wide: true, items };
}

/** Where the overhead arena / track map sits while riding (headset and desktop). */
function mapItem(app: App): Item {
  const st = app.store.data.settings;
  return { kind: 'choice', label: 'Overhead map', get: () => st.vr.map ?? 'left', set: (v) => { st.vr.map = v as typeof st.vr.map; app.applySettings(); }, options: [['left', 'Left'], ['right', 'Right'], ['far-left', 'Far left'], ['far-right', 'Far right'], ['top', 'Top'], ['off', 'Hidden']] };
}

/** Attribution for third-party work (required by its licences) and what was made for this game. Mirrors CREDITS.md. */
function creditsScreen(): Screen {
  const row = (label: string, value: string): Item => ({ kind: 'row', label, value });
  return { id: 'credits', kicker: 'Credits', title: 'Made with', wide: true,
    text: 'Third-party models are used under Creative Commons Attribution 4.0 (creativecommons.org/licenses/by/4.0) and were re-exported and scaled for this game.',
    items: [
      { kind: 'title', label: 'Third-party models · CC BY 4.0' },
      row('"Tron Light cycle Arena" — cycle arena skyline', 'ImWillows · Sketchfab'),
      { kind: 'title', label: 'Third-party audio' },
      row('"Free Crowd Cheering Sounds" — crowd', 'Gregor Quendel · CC BY 4.0'),
      row('"Voiceover Pack: Fighter" — announcer and rival voices', 'Kenney · CC0'),
      { kind: 'title', label: 'Made for this game' },
      row('Runners, cycles, discs, gloves, platforms, disc stadium', 'The game\'s author'),
      row('Cockpit, cycle-grid stadium, ring-wheel cycle', 'Modelled in Blender'),
      row('Cockpit console and hands · Wraith rival cycle', 'Generated for this game'),
      row('City backdrops', 'AI-generated by the author'),
      row('Effects and music', 'Author\'s recordings + runtime synthesis'),
      { kind: 'title', label: 'Software and type' },
      row('three.js', 'MIT'), row('Syncopate', 'Apache 2.0'), row('Saira Condensed · Share Tech Mono', 'SIL OFL 1.1'),
    ] };
}

export function settingsScreen(app: App, inGame = false): Screen {
  const st = app.store.data.settings, ap = () => app.applySettings();
  const vol = (label: string, k: keyof typeof st.volume): Item => ({ kind: 'slider', label, get: () => st.volume[k], set: (v) => { st.volume[k] = v; ap(); }, min: 0, max: 1, step: 0.05, fmt: pct });
  const tog = (label: string, get: () => boolean, set: (v: boolean) => void, sub?: string): Item => ({ kind: 'toggle', label, sub, get, set: (v) => { set(v); ap(); } });
  const items: Item[] = [
    { kind: 'button', label: 'Controls', sub: 'Key bindings and the control reference for every device', action: () => app.menu.open(() => controlsScreen(app, inGame)) },
    tog('Left-handed controls', () => st.vr.leftHanded, (v) => (st.vr.leftHanded = v), 'VR: swaps throwing hand, sticks and buttons to the other side'),
    mapItem(app),
    { kind: 'title', label: 'Audio' }, vol('Master volume', 'master'), vol('Music', 'music'), vol('Effects', 'sfx'), vol('Announcer voice', 'voice'), vol('Crowd', 'crowd'),
    tog('Mute all', () => st.mute, (v) => (st.mute = v)), tog('Subtitles', () => st.subtitles, (v) => (st.subtitles = v)),
    { kind: 'title', label: 'Video' },
    { kind: 'choice', label: 'Quality', get: () => st.quality, set: (v) => { st.quality = v as any; ap(); }, options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
    { kind: 'slider', label: 'Bloom', get: () => st.bloom, set: (v) => { st.bloom = v; ap(); }, min: 0, max: 1.5, step: 0.1, fmt: pct },
    tog('Reduced flashes', () => st.reducedFlashes, (v) => (st.reducedFlashes = v), 'Softens impact flashes and screen pulses'), tog('Reduced motion', () => st.reducedMotion, (v) => (st.reducedMotion = v), 'No camera shake or speed FOV kick'),
    { kind: 'title', label: 'Gameplay & assists' },
  ];
  if (!inGame) items.push(difficultyItem(app));
  items.push(tog('Threat shapes', () => st.threatShapes, (v) => (st.threatShapes = v), 'Hazards also use distinct shapes, not just colour'), tog('Gamepad aim friction', () => st.aimAssist, (v) => (st.aimAssist = v), 'Steadies the reticle near a target; never redirects a throw'),
    tog('Auto-recall discs', () => st.autoRecall, (v) => (st.autoRecall = v), 'Recalls spent discs when your hand is empty'), tog('Race steering assist', () => st.steerAssist, (v) => (st.steerAssist = v), 'Gently eases you away from the rails'),
    { kind: 'choice', label: 'Cycle camera', get: () => st.cycleCamera, set: (v) => { st.cycleCamera = v as any; ap(); }, options: [['chase', 'Chase'], ['cockpit', 'Cockpit']] },
    { kind: 'title', label: 'Virtual reality comfort' },
    tog('Snap turning', () => st.vr.snapTurn, (v) => (st.vr.snapTurn = v), 'Off = smooth turning'),
    { kind: 'slider', label: 'Snap angle', get: () => st.vr.snapAngle, set: (v) => { st.vr.snapAngle = v; ap(); }, min: 15, max: 60, step: 15, fmt: (v) => v + '°' },
    tog('Seated play', () => st.vr.seated, (v) => (st.vr.seated = v)),
    { kind: 'slider', label: 'Comfort vignette', get: () => st.vr.vignette, set: (v) => { st.vr.vignette = v; ap(); }, min: 0, max: 1, step: 0.1, fmt: pct },
    { kind: 'slider', label: 'Movement speed', get: () => st.vr.moveSpeed, set: (v) => { st.vr.moveSpeed = v; ap(); }, min: 0.5, max: 1.5, step: 0.1, fmt: pct },
    { kind: 'slider', label: 'Height offset', get: () => st.vr.height, set: (v) => { st.vr.height = v; ap(); }, min: -0.5, max: 0.5, step: 0.05, fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + ' m' },
    { kind: 'choice', label: 'VR cycle view', get: () => st.vr.cycleView, set: (v) => { st.vr.cycleView = v as any; ap(); }, options: [['auto', 'Auto (chase in combat)'], ['chase', 'Chase'], ['cockpit', 'Cockpit']] });
  if (!inGame) items.push({ kind: 'title', label: 'Data' }, { kind: 'button', label: 'Replay intro sequence', action: () => app.replaySplash() }, { kind: 'button', label: 'Reset all progress', sub: 'Clears tiers, scores and unlocks on this device', action: () => app.menu.open(() => ({ id: 'reset', kicker: 'Data', title: 'Reset progress?', text: 'This permanently erases saved tiers, scores, unlocks and settings on this device.', items: [{ kind: 'button', label: 'Cancel', primary: true, action: () => app.menu.back() }, { kind: 'button', label: 'Erase everything', action: () => { app.store.data = defaultSave(); app.store.data.seenSplash = true; app.applySettings(); app.menu.reset(() => mainScreen(app)); } }] })) });
  return { id: 'settings', kicker: 'Settings', title: 'System Configuration', items, dim: inGame };
}

export function controlsScreen(app: App, inGame = false): Screen {
  const st = app.store.data.settings, ap = () => app.applySettings();
  const items: Item[] = [
    { kind: 'title', label: 'Sensitivity' },
    { kind: 'slider', label: 'Mouse sensitivity', get: () => st.sensitivity, set: (v) => { st.sensitivity = v; ap(); }, min: 0.3, max: 2.5, step: 0.1, fmt: (v) => v.toFixed(1) + '×' },
    { kind: 'toggle', label: 'Invert vertical look', get: () => st.invertY, set: (v) => { st.invertY = v; ap(); } },
    { kind: 'slider', label: 'Gamepad dead zone', get: () => st.deadzone, set: (v) => { st.deadzone = v; ap(); }, min: 0.05, max: 0.4, step: 0.05, fmt: pct },
    { kind: 'slider', label: 'Gamepad look speed', get: () => st.padSensitivity, set: (v) => { st.padSensitivity = v; ap(); }, min: 0.4, max: 2, step: 0.1, fmt: (v) => v.toFixed(1) + '×' },
    { kind: 'title', label: 'Keyboard bindings — select to remap' },
  ];
  for (const a of Object.keys(DEFAULT_BINDINGS)) items.push({ kind: 'bind', label: ACTION_LABELS[a] ?? a, get: () => keyLabel(st.bindings[a]), listen: (done) => app.input.captureNext((code) => { if (code !== 'Escape' || a === 'pause') st.bindings[a] = code; ap(); done(); }) });
  items.push({ kind: 'button', label: 'Restore default bindings', action: () => { st.bindings = { ...DEFAULT_BINDINGS }; ap(); app.menu.refresh(); } });
  return { id: 'controls', kicker: 'Controls', title: 'Input Mapping', items, wide: true, dim: inGame,
    side: { title: 'Reference', rows: [['Disc · aim', 'Mouse / right stick'], ['Disc · throw', 'Hold + release LMB / RT'], ['Disc · shield, parry', 'RMB / LT (tap late to parry)'], ['Disc · hop', 'Jump + direction'], ['Combat · turn', 'A D / ← → / stick flick'], ['Combat · speed', 'W faster · S slower'], ['Race · drift', 'Brake + steer'], ['VR · throw', 'Trigger hold, release'], ['VR · shield', 'Off-hand grip'], ['VR · menu / exit', 'Left Y or X'], ['VR · cycle view', 'Right stick click']] } };
}

export function pauseScreen(app: App): Screen {
  const st = app.store.data.settings, cyc = app.session?.mode !== 'discs', view = () => ((app.session as any)?.[app.xr.presenting ? 'vrFirst' : 'cockpit'] ? 'cockpit' : 'chase');
  return { id: 'pause', kicker: 'Paused', title: app.current?.tier.name ?? 'Paused', dim: true, back: () => app.resume(),
    items: [{ kind: 'button', label: 'Resume', primary: true, action: () => app.resume() }, { kind: 'button', label: 'Restart tier', action: () => app.launch() }, ...(cyc ? [{ kind: 'choice' as const, label: 'Rider view', get: () => view(), set: (v: string) => { st.cycleCamera = v as 'chase' | 'cockpit'; st.vr.cycleView = v as 'chase' | 'cockpit'; const ses: any = app.session; if (ses) { ses.cockpit = v === 'cockpit'; ses.vrFirst = v === 'cockpit'; } app.store.save(); }, options: [['cockpit', 'Cockpit'], ['chase', 'Chase']] as [string, string][] }] : []),
      ...(cyc ? [mapItem(app)] : []),
      { kind: 'button', label: 'How to play', action: () => app.menu.open(() => howToScreen(app, app.current!.tier)) },
      { kind: 'button', label: 'Settings', action: () => app.menu.open(() => settingsScreen(app, true)) }, { kind: 'button', label: 'Quit to main menu', action: () => app.toMenu() }] };
}

export function resultsScreen(app: App, r: SessionResult, info: { unlocks: string[]; next: (() => void) | null; nextLabel: string; nextSub?: string; extra: [string, string][]; best: number; kicker: string }): Screen {
  const items: Item[] = [];
  if (info.next) items.push({ kind: 'button', label: info.nextLabel, sub: info.nextSub, primary: true, action: info.next });
  items.push({ kind: 'button', label: r.won ? 'Replay tier' : 'Retry', primary: !info.next, action: () => app.launch(true) }, { kind: 'button', label: 'Change mode', action: () => app.toMenu(true) }, { kind: 'button', label: 'Main menu', action: () => app.toMenu() });
  items.push({ kind: 'title', label: 'Score' }); for (const [l, v] of r.lines) items.push({ kind: 'row', label: l, value: (v >= 0 ? '+' : '') + v.toLocaleString() });
  items.push({ kind: 'row', label: 'Total', value: r.score.toLocaleString(), total: true });
  return { id: 'results', kicker: info.kicker, head: { cls: r.won ? 'win' : 'lose', text: r.headline }, title: r.won ? r.detail : 'What happened', text: r.won ? undefined : r.detail, items, dim: true, wide: true, noBack: true, unlocks: info.unlocks,
    side: { title: 'Run statistics', rows: [...r.stats, ...info.extra, ['Personal best', info.best ? info.best.toLocaleString() : '—']] } };
}
