import { SCORING_VERSION } from '../progression/scoring';
import type { DifficultyId, GameMode } from '../progression/types';

export interface Settings {
  volume: { master: number; music: number; sfx: number; voice: number; crowd: number }; mute: boolean; subtitles: boolean;
  quality: 'low' | 'medium' | 'high'; bloom: number; reducedFlashes: boolean; reducedMotion: boolean; threatShapes: boolean;
  sensitivity: number; invertY: boolean; deadzone: number; padSensitivity: number; aimAssist: boolean; steerAssist: boolean; autoRecall: boolean;
  bindings: Record<string, string>;
  vr: { snapTurn: boolean; snapAngle: number; seated: boolean; vignette: number; throwMode: 'aim' | 'gesture'; moveSpeed: number; height: number; leftHanded: boolean; /** cockpit seat trim in metres, set with the right stick while riding */ seat: number; /** where the overhead map sits on a cycle */ map: 'left' | 'right' | 'far-left' | 'far-right' | 'top' | 'off'; cycleView: 'auto' | 'cockpit' | 'chase' };
  difficulty: DifficultyId; cycleCamera: 'chase' | 'cockpit'; skin: string; cycle: string; trail: string;
}
export interface TierRecord { best: number; difficulty: DifficultyId; time: number; clears: number; scoring: number }
export interface SaveData {
  version: 1; settings: Settings; completed: Record<string, TierRecord>;
  endless: Record<string, { bestWave: number; bestScore: number; seed: number }>;
  unlocks: string[]; achievements: string[]; seenSplash: boolean;
  last: { game: 'discs' | 'cycles'; track: string; tier: number } | null;
  totals: { parries: number; ricochets: number; traps: number; raceWins: number; shattered: number; playSeconds: number };
  scores: { mode: GameMode; tier: number; name: string; score: number; difficulty: DifficultyId; date: number }[];
}
export const DEFAULT_BINDINGS: Record<string, string> = {
  moveUp: 'KeyW', moveDown: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD', jump: 'Space', dodge: 'ShiftLeft', recall: 'KeyR',
  boost: 'ShiftLeft', ability: 'KeyE', camera: 'KeyC', pause: 'Escape',
};
export function defaultSettings(): Settings {
  return {
    volume: { master: 0.8, music: 0.6, sfx: 0.9, voice: 0.9, crowd: 0.6 }, mute: false, subtitles: true,
    quality: 'high', bloom: 1, reducedFlashes: false, reducedMotion: false, threatShapes: true,
    sensitivity: 1, invertY: false, deadzone: 0.15, padSensitivity: 1, aimAssist: true, steerAssist: false, autoRecall: false,
    bindings: { ...DEFAULT_BINDINGS },
    vr: { snapTurn: true, snapAngle: 30, seated: false, vignette: 0.6, throwMode: 'aim', moveSpeed: 1, height: 0, leftHanded: false, seat: 0, map: 'left', cycleView: 'auto' },
    difficulty: 'standard', cycleCamera: 'chase', skin: 'azure', cycle: 'azure', trail: 'ion',
  };
}
export function defaultSave(): SaveData {
  return { version: 1, settings: defaultSettings(), completed: {}, endless: {}, unlocks: ['skin:azure', 'cycle:azure', 'trail:ion'], achievements: [], seenSplash: false, last: null, totals: { parries: 0, ricochets: 0, traps: 0, raceWins: 0, shattered: 0, playSeconds: 0 }, scores: [] };
}
/** Merges a stored blob over current defaults so new settings appear after updates without wiping progress. */
export function migrate(raw: any): SaveData {
  const d = defaultSave(); if (!raw || typeof raw !== 'object') return d;
  const s: SaveData = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings ?? {}) }, totals: { ...d.totals, ...(raw.totals ?? {}) } };
  s.settings.volume = { ...d.settings.volume, ...(raw.settings?.volume ?? {}) }; s.settings.vr = { ...d.settings.vr, ...(raw.settings?.vr ?? {}) }; s.settings.bindings = { ...d.settings.bindings, ...(raw.settings?.bindings ?? {}) };
  for (const u of d.unlocks) if (!s.unlocks.includes(u)) s.unlocks.push(u);
  s.version = 1; return s;
}

const DB = 'vanta-arc', STORE = 'save', KEY = 'profile';
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
/** Local persistence: IndexedDB with a localStorage mirror as fallback (private windows, blocked storage). */
export class SaveStore {
  data: SaveData = defaultSave(); private db: IDBDatabase | null = null; private timer: any = 0;
  async load(): Promise<SaveData> {
    let raw: any = null;
    try { this.db = await openDb(); raw = await new Promise((res, rej) => { const r = this.db!.transaction(STORE).objectStore(STORE).get(KEY); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); } catch { this.db = null; }
    if (!raw) { try { const ls = globalThis.localStorage?.getItem(DB); if (ls) raw = JSON.parse(ls); } catch { /* unavailable */ } }
    this.data = migrate(raw); return this.data;
  }
  /** Debounced write. */
  save() { clearTimeout(this.timer); this.timer = setTimeout(() => void this.flush(), 250); }
  async flush(): Promise<void> {
    clearTimeout(this.timer); const snap = JSON.parse(JSON.stringify(this.data));
    try { globalThis.localStorage?.setItem(DB, JSON.stringify(snap)); } catch { /* unavailable */ }
    if (!this.db) return;
    await new Promise<void>((res) => { try { const tx = this.db!.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(snap, KEY); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch { res(); } });
  }
  recordTier(key: string, score: number, time: number, difficulty: DifficultyId) {
    const prev = this.data.completed[key];
    this.data.completed[key] = { best: Math.max(prev?.best ?? 0, score), difficulty: prev && prev.best > score ? prev.difficulty : difficulty, time: prev ? Math.min(prev.time, time) : time, clears: (prev?.clears ?? 0) + 1, scoring: SCORING_VERSION };
  }
  recordScore(entry: SaveData['scores'][number]) { const s = this.data.scores; s.push(entry); s.sort((a, b) => b.score - a.score); if (s.length > 40) s.length = 40; }
  unlock(ids: readonly string[]): string[] { const fresh: string[] = []; for (const id of ids) if (!this.data.unlocks.includes(id)) { this.data.unlocks.push(id); fresh.push(id); } return fresh; }
}
