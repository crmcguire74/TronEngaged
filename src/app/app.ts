import * as THREE from 'three';
import { Engine } from '../engine/engine';
import { Assets } from '../engine/assets';
import { AudioEngine } from '../engine/audio';
import { Vfx } from '../engine/vfx';
import { XRManager } from '../engine/xr';
import { Input } from '../input/input';
import { SaveStore } from '../persistence/store';
import { Hud } from '../ui/hud';
import { Menu, MenuDom } from '../ui/menu';
import { VRPanels } from '../ui/vrpanel';
import { MenuScene } from '../scenes/menuScene';
import { Splash } from '../scenes/splash';
import { hashSeed } from '../engine/math';
import { DIFFICULTIES, type DifficultyId, type GameMode, type TierDefinition } from '../progression/types';
import { ACHIEVEMENTS, TRACKS, cosmetic, tierKey, unlockedCount, type TrackId } from '../progression/rewards';
import { endlessTier } from '../progression/director';
import { RACE_PLACE_POINTS } from '../progression/scoring';
import { medalResult, starCount, type Goal } from '../progression/medals';
import type { BaseSession, Ctx, SessionResult } from './context';
import { createSession, sessionAssets } from './sessions';
import { briefingScreen, cycleScreen, mainScreen, pauseScreen, resultsScreen } from './screens';

type State = 'boot' | 'splash' | 'menu' | 'loading' | 'play' | 'paused' | 'results';
export interface Current { track: TrackId | 'endless'; tier: TierDefinition; stage: number; stagePoints: number; salt: number; endless?: { mode: GameMode; wave: number; seed: number; score: number } }

/** Application shell: boot, state machine, save/progression bookkeeping and the frame loop shared by desktop and VR. */
/** A supplied logo usually sits in a wide empty canvas. This crops it to its visible pixels so it fills the space it is given. */
async function trimmed(url: string): Promise<string> {
  try {
    const img = new Image(); img.src = url; await img.decode(); const W = 512, H = Math.max(1, Math.round((W * img.naturalHeight) / img.naturalWidth));
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data;
    let x0 = W, x1 = -1, y0 = H, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0 || (x1 - x0 > W * 0.94 && y1 - y0 > H * 0.94)) return url; // empty, or already tight
    const k = img.naturalWidth / W, sx = Math.max(0, (x0 - 2) * k), sy = Math.max(0, (y0 - 2) * k), sw = Math.min(img.naturalWidth - sx, (x1 - x0 + 5) * k), sh = Math.min(img.naturalHeight - sy, (y1 - y0 + 5) * k), ow = Math.min(1400, Math.round(sw));
    const o = document.createElement('canvas'); o.width = ow; o.height = Math.round((ow * sh) / sw); o.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, o.width, o.height); return o.toDataURL('image/png');
  } catch { return url; }
}

export class App {
  readonly engine: Engine; readonly assets = new Assets(); readonly audio = new AudioEngine(); readonly vfx = new Vfx(); readonly store = new SaveStore(); readonly input: Input; readonly xr: XRManager;
  readonly hud: Hud; readonly menu = new Menu(); readonly menuDom: MenuDom; readonly vr: VRPanels; ctx!: Ctx;
  state: State = 'boot'; session: BaseSession | null = null; current: Current | null = null; private menuScene: MenuScene | null = null; private splash: Splash | null = null;
  /** QA hook: injected actions for scripted playtests. */ qaActions: Record<string, any> | null = null;
  private last = 0; private loadingEl: HTMLElement; private noteEl: HTMLElement | null = null; private playClock = 0; fps = 60;

  constructor(canvas: HTMLCanvasElement, private ui: HTMLElement) {
    this.engine = new Engine(canvas); this.input = new Input(canvas); this.xr = new XRManager(this.engine);
    this.hud = new Hud(ui); this.menuDom = new MenuDom(this.menu, ui); this.vr = new VRPanels(this.engine, this.xr, this.menu, this.hud);
    this.vfx.group.traverse((o) => (o.userData.shared = true));
    this.loadingEl = document.createElement('div'); this.loadingEl.className = 'loading'; this.loadingEl.innerHTML = '<div class="lbl">Initialising Lattice</div><div class="lbar"><i></i></div>'; ui.appendChild(this.loadingEl);
    this.menu.onSound = (n) => this.audio.sfx(n);
    this.menuDom.topRight = () => `${this.xr.supported ? '<button class="chip xr" data-top="vr">◈ Enter VR</button>' : '<span class="chip">VR: headset not detected</span>'}<button class="chip" data-top="fs">⛶ Fullscreen</button>`;
    this.menuDom.onTop = (id) => { if (id === 'vr') void this.xr.enter(); else if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}); };
    this.input.onAnyInput = () => this.audio.unlock();
    addEventListener('pointerdown', () => this.audio.unlock(), { capture: true }); // menu clicks are gestures too
    // Escape releases pointer lock before the page sees the key, so losing the lock is the pause signal
    this.input.onLockLost = () => this.pause();
    this.audio.onSubtitle = (t) => this.hud.subtitle(t);
    this.xr.onSupport = () => this.menuDom.render();
    this.xr.onError = (m) => this.note(m);
    this.xr.onStart = () => { this.audio.unlock(); this.ui.style.visibility = 'hidden'; this.vr.setActive(true); this.vfx.setFlashLight(false); this.perf = 0; this.applyPerf(); };
    this.xr.onEnd = () => { this.vfx.setFlashLight(true); this.ui.style.visibility = ''; this.vr.setActive(false); this.engine.rig.position.set(0, 0, 0); this.engine.rig.rotation.set(0, 0, 0); if (this.state === 'play') this.pause(); };
    const qa = new URLSearchParams(location.search).has('qa'); // QA runs drive frames manually in a background tab
    document.addEventListener('visibilitychange', () => { if (qa) return; if (document.hidden && this.state === 'play') this.pause(); this.audio.suspend(document.hidden); });
    addEventListener('pagehide', () => void this.store.flush());
    // surface runtime errors where a headset user can see them
    const report = (m: string) => { console.error('[tron-engaged]', m); this.vr.setMessage('ERROR: ' + m); if (this.xr.presenting) this.hud.subtitle('ERROR: ' + m.slice(0, 60)); };
    addEventListener('error', (e) => report(e.message || 'script error')); addEventListener('unhandledrejection', (e) => report(String((e as PromiseRejectionEvent).reason?.message ?? (e as PromiseRejectionEvent).reason)));
  }

  async boot() {
    await Promise.all([this.store.load(), this.assets.loadDropins()]); const s = this.store.data;
    this.ctx = { engine: this.engine, assets: this.assets, audio: this.audio, input: this.input, xr: this.xr, vfx: this.vfx, store: this.store, hud: this.hud, settings: s.settings };
    this.applySettings(false);
    // owner-supplied interface art: a logo replaces the lettered wordmark, key art sits behind the loading bar
    const logo = this.assets.ui('logo'); if (logo) void trimmed(logo).then((u) => { this.menuDom.logoUrl = u; this.menuDom.render(); }); const art = this.assets.ui('key-art'); if (art) { this.loadingEl.style.backgroundImage = `linear-gradient(rgba(3,5,9,0.72), rgba(3,5,9,0.9)), url("${art}")`; this.loadingEl.style.backgroundSize = 'cover'; this.loadingEl.style.backgroundPosition = 'center'; }
    this.engine.renderer.setAnimationLoop((t) => this.frame(t));
    await Promise.all([this.assets.load([...MenuScene.assets(s.settings.skin), 'hands'], (d, n) => this.progress(d / n)), (document as any).fonts?.ready ?? Promise.resolve()]);
    this.xr.attachGloves(this.assets);
    this.loadingEl.style.display = 'none';
    const q = new URLSearchParams(location.search), play = q.get('play');
    this.showMenuScene();
    if (play) { const [track, id] = play.split(':'); if (this.playTier(track, Number(id))) { s.seenSplash = true; return; } }
    this.splash = new Splash(this.ctx, this.ui, this.menuScene!, !s.seenSplash && !q.has('nosplash'), () => { this.splash = null; s.seenSplash = true; this.store.save(); this.enterMenu(); });
    this.state = 'splash';
  }
  private progress(k: number) { (this.loadingEl.querySelector('i') as HTMLElement).style.width = Math.round(k * 100) + '%'; }
  note(text: string, ms = 5000) { this.noteEl?.remove(); const n = (this.noteEl = document.createElement('div')); n.className = 'note'; n.textContent = text; this.ui.appendChild(n); setTimeout(() => n.remove(), ms); this.hud.subtitle(text); }

  applySettings(save = true) {
    const s = this.store.data.settings; this.ctx.settings = s; this.engine.applySettings(s); this.audio.applySettings(s); this.input.setSettings(s); this.xr.setSettings(s);
    this.hud.mapPlace = s.vr.map ?? 'left'; this.hud.subtitles = s.subtitles; this.hud.threatShapes = s.threatShapes; this.vfx.flashes = !s.reducedFlashes; this.engine.reducedFlashes = s.reducedFlashes; document.body.classList.toggle('reduced-flashes', s.reducedFlashes);
    if (save) this.store.save();
  }

  // ------------------------------------------------------------ navigation
  private showMenuScene() { if (this.menuScene) return; this.menuScene = new MenuScene(this.ctx); this.engine.setWorld(this.menuScene.world); this.engine.scene.fog = new THREE.FogExp2(0x02050b, 0.0016); this.engine.rig.position.set(0, 0, 0); this.engine.rig.rotation.set(0, 0, 0); }
  private enterMenu(cycles = false) {
    this.state = 'menu'; if (this.menuScene) this.menuScene.calm = true; this.hud.show(null); this.audio.engine(false); this.audio.playMusic('menu'); this.audio.ambience('menu'); this.audio.intensity = 0.45; this.audio.setCrowdBed(0);
    this.menu.reset(() => mainScreen(this)); if (cycles) this.menu.open(() => cycleScreen(this));
  }
  toMenu(modeSelect = false) {
    this.session?.dispose(); this.session = null; this.engine.derez = this.engine.derezTarget = 0; this.menuScene = null; this.showMenuScene();
    this.enterMenu(modeSelect && this.current?.tier.mode !== 'discs'); this.store.save();
  }
  replaySplash() { this.menu.close(); if (this.menuScene) this.menuScene.calm = false; this.splash = new Splash(this.ctx, this.ui, this.menuScene!, true, () => { this.splash = null; this.enterMenu(); }); this.state = 'splash'; }

  /** Starts the next unlocked tier of a track (or its briefing). */
  playNext(track: TrackId) { const list = TRACKS[track].tiers, n = unlockedCount(this.store.data, track); this.startTier(track, list[Math.min(n, list.length) - 1]); }
  startTier(track: TrackId, tier: TierDefinition) { this.current = { track, tier, stage: 0, stagePoints: 0, salt: 0 }; this.menu.open(() => briefingScreen(this, track, tier)); }
  startEndless(mode: GameMode, wave = 1, seed = hashSeed(Date.now(), Math.random()), score = 0) {
    const tier = endlessTier(mode, wave, seed); this.current = { track: 'endless', tier, stage: 0, stagePoints: 0, salt: seed, endless: { mode, wave, seed, score } };
    if (wave === 1) this.menu.open(() => briefingScreen(this, 'endless', tier)); else this.launch();
  }

  /** Loads scene-required assets, then builds the session. */
  /** Starts a tier directly (the ?play= link, and QA runs that enter VR from the menu first). */
  playTier(track: string, id: number) { const t = TRACKS[track as TrackId]?.tiers.find((x) => x.id === id); if (!t) return false; this.current = { track: track as TrackId, tier: t, stage: 0, stagePoints: 0, salt: 0 }; this.launch(); return true; }
  launch(retry = false) {
    const c = this.current; if (!c) return; if (retry) { c.salt++; if (c.stage > 0 && !c.endless) { c.stage = 0; c.stagePoints = 0; } }
    this.menu.close(); this.state = 'loading'; this.audio.unlock(); this.xr.clearEdges();
    this.loadingEl.className = 'loading thin'; this.loadingEl.style.display = ''; this.progress(0); (this.loadingEl.querySelector('.lbl') as HTMLElement).textContent = 'Compiling ' + c.tier.name;
    const s = this.store.data.settings, diff = s.difficulty;
    void this.assets.load(sessionAssets(c.tier, s), (d, n) => this.progress(d / n)).then(() => {
      this.session?.dispose(); this.session = null; this.engine.derez = this.engine.derezTarget = 0; this.menuScene = null;
      try { this.session = createSession(this.ctx, c.tier, diff, c.salt, c.stage); } catch (e) { console.error(e); this.note('This tier failed to initialise. Returning to the command centre.'); this.loadingEl.style.display = 'none'; this.toMenu(); return; }
      this.prewarm();
      this.loadingEl.style.display = 'none'; this.state = 'play'; this.playClock = 0;
      if (c.track !== 'endless') { this.store.data.last = { game: c.tier.mode === 'discs' ? 'discs' : 'cycles', track: c.track, tier: c.tier.id }; this.store.save(); }
      if (this.assets.errors.length) this.note('Some assets failed to load; placeholders are in use.');
    });
  }
  /**
   * Compiles every shader the new scene can use before the first frame, hidden objects included (cockpit, effects
   * pools, LOD copies). Otherwise each one compiles the first time it appears, mid-race, as a dropped frame: on a
   * headset that is a visible judder. Fire-and-forget: KHR_parallel_shader_compile finishes it off the main thread.
   */
  private prewarm() {
    const hidden: THREE.Object3D[] = []; this.engine.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try { void this.engine.renderer.compileAsync(this.engine.scene, this.engine.camera).catch(() => {}); } catch { /* older drivers: compile lazily */ }
    for (const o of hidden) o.visible = false;
  }
  pause() { if (this.state !== 'play' || !this.session || this.session.phase === 'done') return; this.state = 'paused'; this.xr.clearEdges(); this.xr.showHands = true; this.input.setPointerLock(false); this.audio.engine(false); this.menu.reset(() => pauseScreen(this)); }
  resume() { if (this.state !== 'paused') return; this.menu.close(); this.state = 'play'; this.xr.clearEdges(); if (this.session?.mode === 'discs') this.input.setPointerLock(true); }

  // ------------------------------------------------------------ results & progression
  private finishSession() {
    const c = this.current!, ses = this.session!, r = ses.result!, st = this.store, data = st.data, diff = data.settings.difficulty, tier = c.tier;
    // the loss derez is pinned near full at the end of the outro: dissolve it away so the results read clearly
    this.engine.derezTo(0, 1.6);
    this.state = 'results'; this.hud.show(null); this.input.setPointerLock(false); data.totals.playSeconds += this.playClock;
    const stages = Number(tier.params.stages ?? 1); let won = r.won; const extra: [string, string][] = []; let score = r.score, next: (() => void) | null = null, nextLabel = '', nextSub = '', kicker = c.track === 'endless' ? `Endless · wave ${c.endless!.wave}` : `${TRACKS[c.track].label} · tier ${tier.id}`;
    // multi-stage championships: placement points accumulate across stages
    if (tier.mode === 'cycle-race' && stages > 1) {
      const place = (ses as any).sim.player.place as number; c.stagePoints += RACE_PLACE_POINTS[Math.min(place - 1, RACE_PLACE_POINTS.length - 1)] ?? 0;
      const need = RACE_PLACE_POINTS[Number(tier.params.passPlace ?? 3) - 1] * stages; extra.push(['Stage', `${c.stage + 1} / ${stages}`], ['Championship points', `${c.stagePoints} / ${need}`]); kicker += ` · stage ${c.stage + 1}/${stages}`;
      if (c.stage + 1 < stages) { won = false; next = () => { c.stage++; this.launch(); }; nextLabel = 'Next stage'; nextSub = `Stage ${c.stage + 2} of ${stages}`; r.headline = 'STAGE COMPLETE'; r.detail = `P${place} — points carry forward`; r.won = true; }
      else { won = c.stagePoints >= need; r.won = won; r.headline = won ? 'CHAMPIONSHIP WON' : 'CHAMPIONSHIP LOST'; r.detail = won ? tier.name : `Needed ${need} points`; }
    }
    let unlocks: string[] = []; let best = 0;
    // mastery: read from this run's own stats (on a multi-stage event, the final stage decides)
    const medals: Goal[] = c.endless ? [] : medalResult(tier, won, (ses as any).sim?.stats); let prevStars = 0;
    if (c.endless) {
      const e = c.endless; e.score += score; const rec = data.endless[e.mode] ?? { bestWave: 0, bestScore: 0, seed: e.seed };
      if (won) { if (e.wave > rec.bestWave) { rec.bestWave = e.wave; rec.seed = e.seed; } next = () => this.startEndless(e.mode, e.wave + 1, e.seed, e.score); nextLabel = `Wave ${e.wave + 1}`; nextSub = endlessTier(e.mode, e.wave + 1, e.seed).name; }
      rec.bestScore = Math.max(rec.bestScore, e.score); data.endless[e.mode] = rec; best = rec.bestScore; extra.push(['Run total', e.score.toLocaleString()], ['Best wave', String(rec.bestWave)], ['Seed', String(e.seed)]);
      if (!won) st.recordScore({ mode: e.mode, tier: e.wave, name: `Endless wave ${e.wave}`, score: e.score, difficulty: diff, date: Date.now() });
    } else if (won) {
      prevStars = data.completed[tierKey(tier)]?.stars ?? 0; st.recordTier(tierKey(tier), score, r.time, diff, starCount(medals)); best = data.completed[tierKey(tier)].best; unlocks = st.unlock(tier.unlocks).map((u) => cosmetic(u)?.label ?? u.replace(':', ' · '));
      st.recordScore({ mode: tier.mode, tier: tier.id, name: tier.name, score, difficulty: diff, date: Date.now() });
      const track = c.track as TrackId, list = TRACKS[track].tiers, i = list.indexOf(tier);
      if (i + 1 < list.length) { const nt = list[i + 1]; next = () => { this.current = { track, tier: nt, stage: 0, stagePoints: 0, salt: 0 }; this.launch(); }; nextLabel = 'Continue'; nextSub = `Tier ${nt.id} · ${nt.name}`; }
      else { const m = TRACKS[track].endless[0]; next = () => this.startEndless(m); nextLabel = 'Enter Endless'; nextSub = 'No final tier: the director takes over'; }
    } else best = data.completed[tierKey(tier)]?.best ?? 0;
    // lifetime totals feed achievements
    const sim: any = (ses as any).sim; if (tier.mode === 'discs') { data.totals.parries += sim.stats.parries; data.totals.ricochets += sim.stats.ricochetHits; data.totals.shattered += sim.stats.kills; } else if (tier.mode === 'cycle-combat') data.totals.traps += sim.stats.trapKills; else if (won) data.totals.raceWins++;
    for (const a of ACHIEVEMENTS) if (!data.achievements.includes(a.id) && a.test(data)) { data.achievements.push(a.id); unlocks.push('Achievement — ' + a.label); }
    st.save();
    if (starCount(medals) > prevStars && prevStars > 0) unlocks.push(`New best: ${starCount(medals)} stars`);
    this.menu.reset(() => resultsScreen(this, r, { unlocks, next, nextLabel, nextSub, extra, best, kicker, medals }));
  }

  // ------------------------------------------------------------ frame
  private frame(time: number) {
    const dt = Math.min(0.1, Math.max(0.0005, (time - this.last) / 1000 || 0.016)); this.last = time; this.fps += (1 / dt - this.fps) * 0.05; this.govern(dt);
    const xr = this.xr.presenting; this.input.xr = xr ? this.xr.actions : this.qaActions;
    const a = this.input.update(dt);
    if (this.state === 'splash') this.splash?.update(dt, a);
    else if (this.state === 'menu') { this.menuScene?.update(dt); if (xr) this.xr.update(dt, true); this.menu.handle(a); }
    else if (this.state === 'loading') { /* keep last frame */ }
    else if (this.state === 'play' && this.session) {
      this.playClock += dt;
      if (a.pause && this.session.phase !== 'done') this.pause();
      else { this.session.update(dt, a); if (this.session.phase === 'done') this.finishSession(); }
    } else if (this.state === 'paused') { if (xr) this.xr.update(dt, false); this.menu.handle(a); if (a.pause) this.resume(); }
    else if (this.state === 'results' && this.session) { this.session.update(dt, a); this.menu.handle(a); }
    this.vr.showInput = this.state === 'paused'; this.vr.update(dt, this.state === 'play');
    this.engine.render(dt);
  }
  /**
   * Frame-time governor (headset only). When frames run long for about a second, detail is pulled in: LOD distances
   * shrink, effects thin out and foveation goes to maximum. It eases back once there is headroom again. Desktop keeps
   * its quality setting, since a dropped frame there is a stutter rather than discomfort.
   */
  private slowT = 0; private fastT = 0; perf = 0;
  private govern(dt: number) {
    const xr = this.xr.presenting, target = 1 / Math.max(60, (this.engine.renderer.xr.getSession() as any)?.frameRate ?? 72);
    if (!xr) {
      if (this.perf) { this.perf = 0; this.applyPerf(); }
      // desktop: under ~40 fps for two seconds sheds a level (shadows, then pixel ratio, then bloom); over ~55 fps for
      // ten seconds earns one back. Menus count too, so a slow machine is already stepped down when a game starts.
      if (dt > 1 / 40) { this.slowT += dt; this.fastT = 0; } else if (dt < 1 / 55) { this.fastT += dt; this.slowT = Math.max(0, this.slowT - dt * 0.5); }
      const L = this.engine.loadLevel; if (this.slowT > 2 && L < 3 && !this.hidden()) { this.engine.setLoad(L + 1); this.slowT = 0; } else if (this.fastT > 10 && L > 0) { this.engine.setLoad(L - 1); this.fastT = 0; }
      return;
    }
    if (dt > target * 1.18) { this.slowT += dt; this.fastT = 0; } else if (dt < target * 1.05) { this.fastT += dt; this.slowT = Math.max(0, this.slowT - dt * 0.5); }
    if (this.slowT > 1 && this.perf < 2) { this.perf++; this.slowT = 0; this.applyPerf(); } else if (this.fastT > 8 && this.perf > 0) { this.perf--; this.fastT = 0; this.applyPerf(); }
  }
  private hidden() { return document.hidden || new URLSearchParams(location.search).has('qa'); }
  private applyPerf() { this.engine.lodScale = [1, 0.7, 0.5][this.perf]; this.vfx.density = [1, 0.6, 0.35][this.perf]; try { this.engine.renderer.xr.setFoveation(this.perf ? 1 : this.store.data.settings.quality === 'high' ? 0.5 : 1); } catch { /* unsupported */ } }
  /** QA hook: steps the frame loop synchronously (background tabs throttle requestAnimationFrame). Not used by gameplay. */
  debugAdvance(seconds: number, step = 1 / 60) { let t = this.last; const n = Math.round(seconds / step); for (let i = 0; i < n; i++) { t += step * 1000; this.frame(t); } return this.state; }
  get difficulty(): DifficultyId { return this.store.data.settings.difficulty; }
  get diffDef() { return DIFFICULTIES[this.difficulty]; }
}
