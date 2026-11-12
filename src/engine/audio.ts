import type { Settings } from '../persistence/store';

type Pos = { x: number; y?: number; z: number };
interface Track { bpm: number; root: number; prog: number[][]; arp: number[]; bass: number[]; swing?: number }
// Original progressions (scale degrees as semitone offsets from the root), one chord per bar.
const TRACKS: Record<string, Track> = {
  menu: { bpm: 84, root: 45, prog: [[0, 7, 15], [-4, 3, 12], [-7, 5, 12], [-2, 5, 14]], arp: [0, 2, 1, 2, 0, 2, 1, 3], bass: [1, 0, 0, 0, 0, 0, 1, 0] },
  discs: { bpm: 112, root: 43, prog: [[0, 7, 15], [0, 8, 15], [-2, 5, 14], [-4, 3, 10]], arp: [0, 1, 2, 1, 3, 1, 2, 1], bass: [1, 0, 1, 0, 1, 0, 1, 1] },
  cycles: { bpm: 126, root: 40, prog: [[0, 7, 12], [3, 10, 15], [-2, 5, 10], [-4, 3, 8]], arp: [0, 2, 1, 2, 3, 2, 1, 2], bass: [1, 1, 0, 1, 1, 0, 1, 1] },
  race: { bpm: 138, root: 42, prog: [[0, 7, 15], [5, 12, 17], [3, 10, 15], [-2, 5, 14]], arp: [0, 1, 2, 3, 2, 1, 2, 3], bass: [1, 1, 1, 1, 1, 1, 1, 1] },
  boss: { bpm: 120, root: 38, prog: [[0, 6, 12], [1, 7, 13], [0, 6, 15], [-2, 4, 10]], arp: [0, 2, 0, 3, 0, 2, 1, 3], bass: [1, 0, 1, 1, 0, 1, 1, 0] },
};
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** All audio is synthesised at runtime with Web Audio: SFX, adaptive layered music, crowd swells and announcer speech. */
/** Minimum spacing for effects that can fire many times a second. */
const REPEAT_GAP: Record<string, number> = { scrape: 0.14, ricochet: 0.05, prox: 0.08, turn: 0.05, boot: 0.04, bump: 0.1, block: 0.06, drift: 0.2 };
const AUDIO_BASE = import.meta.env.BASE_URL + 'game-assets/audio/';
/** Recorded clips. Everything still works without them: the synthesiser underneath is the fallback. */
const SAMPLES: Record<string, string> = {
  throw: 'sfx_disc_throw.mp3', ricochet: 'sfx_ricochet.mp3', shatter: 'sfx_shatter.mp3', crash: 'sfx_crash.mp3', engine: 'sfx_cycle_engine.mp3',
  mus_hub: 'mus_hub.m4a', mus_combat: 'mus_combat.m4a',
  crowd_bed: 'crowd_bed_ambience.m4a', cheer_big: 'crowd_cheer_strong.m4a', cheer_long: 'crowd_cheer_strong2.m4a', cheer_soft: 'crowd_cheer_soft.m4a', chant: 'crowd_chant_rhythmic.m4a',
  vo_ready: 'vo_ready.m4a', vo_begin: 'vo_begin.m4a', vo_fight: 'vo_fight.m4a', vo_final_round: 'vo_final_round.m4a', vo_you_win: 'vo_you_win.m4a', vo_you_lose: 'vo_you_lose.m4a',
  vo_game_over: 'vo_game_over.m4a', vo_winner: 'vo_winner.m4a', vo_flawless: 'vo_flawless_victory.m4a', vo_round_1: 'vo_round_1.m4a', vo_round_2: 'vo_round_2.m4a', vo_round_3: 'vo_round_3.m4a',
  jeer_intro: 'jeer_prepare_yourself.m4a', jeer_win: 'jeer_loser.m4a',
};
/** Effects that have a recording: gain, and whether the synthesised version still plays underneath. */
const SFX_SAMPLE: Record<string, { gain: number; layer: boolean }> = { throw: { gain: 0.7, layer: false }, ricochet: { gain: 0.55, layer: true }, shatter: { gain: 0.8, layer: false }, crash: { gain: 0.9, layer: true } };

/** 'Final lap.' -> 'final_lap': how a caption becomes the name of its recording. */
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export class AudioEngine {
  private variants: Record<string, string[]> = {};
  private buf = new Map<string, AudioBuffer>(); private fetching = false; private voiceBus!: GainNode;
  private mus: { src: AudioBufferSourceNode; g: GainNode; f: BiquadFilterNode; key: string } | null = null;
  private engS: { src: AudioBufferSourceNode; g: GainNode } | null = null; private bedS: { src: AudioBufferSourceNode; g: GainNode } | null = null; private cheerS: { src: AudioBufferSourceNode; g: GainNode } | null = null;
  private loadSamples() {
    if (this.fetching || !this.ctx) return; this.fetching = true; const c = this.ctx;
    const load = (k: string, f: string) => fetch(AUDIO_BASE + f).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))).then((b) => c.decodeAudioData(b)).then((a) => {
      this.buf.set(k, a); const m = /^sfx_([a-z]+?)(_\d+)?$/i.exec(k); if (m && !(k in SAMPLES)) (this.variants[m[1].toLowerCase()] ??= []).push(k);
      if (k.startsWith('mus_')) this.startMusicSample(); if (k === 'crowd_bed') this.setCrowdBed(this.crowdBed); if (k === 'amb_' + this.ambWant) this.ambience(this.ambWant);
    }).catch(() => { /* missing or unreadable: the synthesiser covers it */ });
    // Owner-supplied files (see assets/ASSET-GUIDE.md): the file name without its extension is the key, and a supplied
    // file always wins over a built-in clip with the same key. `sfx_<effect>[_2…]` replaces a synthesised effect,
    // `vo_<caption_in_snake_case>` voices a caption, `mus_<track>` is a music bed, `amb_<environment>` an ambience loop.
    const builtIn = () => { for (const [k, f] of Object.entries(SAMPLES)) if (!this.buf.has(k) && !this.supplied.has(k)) void load(k, f); };
    void fetch(AUDIO_BASE + '../dropins.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
      // a supplied file that shares a built-in clip's name (any extension) takes that clip's place
      const known = new Set(Object.values(SAMPLES)), alias: Record<string, string> = {}; for (const [k, f] of Object.entries(SAMPLES)) alias[f.replace(/\.[^.]+$/, '').toLowerCase()] = k;
      for (const f of (d?.audio ?? []) as string[]) { if (known.has(f)) continue; const base = f.replace(/\.[^.]+$/, '').toLowerCase(), k = alias[base] ?? base; this.supplied.add(k); void load(k, f); }
      builtIn();
    }).catch(builtIn);
  }
  private supplied = new Set<string>(); private ambWant = ''; private ambS: { src: AudioBufferSourceNode; g: GainNode; key: string } | null = null;
  /** Background ambience for an environment: plays `amb_<environment>` on a loop if the owner has supplied one. */
  ambience(env: string) {
    this.ambWant = env; const c = this.ctx, key = 'amb_' + env; if (!c || this.ambS?.key === key) return;
    if (this.ambS) { const o = this.ambS; this.ambS = null; o.g.gain.setTargetAtTime(0, c.currentTime, 0.6); setTimeout(() => { try { o.src.stop(); } catch { /* stopped */ } }, 3000); }
    const s = this.source(key, true); if (!s) return; const g = c.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.4, c.currentTime, 1.2); s.connect(g); g.connect(this.crowdBus); s.start(); this.ambS = { src: s, g, key };
  }
  private source(key: string, loop = false): AudioBufferSourceNode | null { const b = this.buf.get(key), c = this.ctx; if (!b || !c || c.state !== 'running') return null; const s = c.createBufferSource(); s.buffer = b; s.loop = loop; return s; }
  /** Announcer / rival voice clip with its caption. Falls back to the caption alone if the clip is not loaded. */
  vo(key: string, text = '', pos?: Pos, gain = 1, alt = '') {
    if (text) this.onSubtitle(text); const c = this.ctx, own = text && !key.startsWith('jeer') ? this.source('vo_' + slug(text)) : null, s = (alt && this.source(alt)) || own || this.source(key.startsWith('jeer') ? key : 'vo_' + key); if (!s || !c) return;
    const g = c.createGain(); g.gain.value = gain; s.connect(g);
    if (pos) { const p = c.createPanner(); p.panningModel = 'equalpower'; p.refDistance = 12; p.rolloffFactor = 0.6; p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1.6; p.positionZ.value = pos.z; g.connect(p); p.connect(this.voiceBus); p.connect(this.wet); } else { g.connect(this.voiceBus); g.connect(this.wet); }
    s.start(); s.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
  }
  private startMusicSample() {
    const c = this.ctx; if (!c || !this.trackId) return; const key = this.buf.has('mus_' + this.trackId) ? 'mus_' + this.trackId : this.trackId === 'menu' ? 'mus_hub' : 'mus_combat'; if (this.mus?.key === key) return; const s = this.source(key, true); if (!s) return;
    const t = c.currentTime; if (this.mus) { const old = this.mus; old.g.gain.setTargetAtTime(0, t, 0.5); setTimeout(() => { try { old.src.stop(); } catch { /* stopped */ } }, 2500); }
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 6000; const g = c.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.9, t, 0.8); s.connect(f); f.connect(g); g.connect(this.music); s.start();
    this.mus = { src: s, g, f, key }; this.track = null; // the recorded bed replaces the sequenced one
  }

  ctx: AudioContext | null = null; private master!: GainNode; private music!: GainNode; private sfxBus!: GainNode; private crowdBus!: GainNode; private wet!: GainNode;
  private noise!: AudioBuffer; private settings: Settings | null = null;
  private track: Track | null = null; private trackId = ''; private step = 0; private nextT = 0; private timer: any = 0; intensity = 0.3; private intensityNow = 0.3;
  private eng: { o1: OscillatorNode; o2: OscillatorNode; sub: OscillatorNode; f: BiquadFilterNode; g: GainNode; n: GainNode; nf: BiquadFilterNode } | null = null;
  private voices: { o: OscillatorNode; g: GainNode; p: PannerNode; f: BiquadFilterNode }[] = [];
  private crowdG: GainNode | null = null; private crowdF: BiquadFilterNode | null = null; crowdBed = 0;
  onSubtitle: (text: string) => void = () => {};
  private lastPlayed = new Map<string, number>();

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = (window.AudioContext || (window as any).webkitAudioContext); if (!AC) return;
    const c = (this.ctx = new AC()); const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.connect(c.destination);
    this.master = c.createGain(); this.master.connect(comp);
    this.music = c.createGain(); this.sfxBus = c.createGain(); this.crowdBus = c.createGain(); this.voiceBus = c.createGain(); for (const b of [this.music, this.sfxBus, this.crowdBus, this.voiceBus]) b.connect(this.master);
    const len = c.sampleRate * 2; this.noise = c.createBuffer(1, len, c.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // small synthetic hall for space
    const ir = c.createBuffer(2, c.sampleRate * 1.8, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const r = ir.getChannelData(ch); for (let i = 0; i < r.length; i++) r[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / r.length, 2.6); }
    const conv = c.createConvolver(); conv.buffer = ir; this.wet = c.createGain(); this.wet.gain.value = 0.22; this.wet.connect(conv); conv.connect(this.master);
    if (this.settings) this.applySettings(this.settings);
    if (this.trackId) { const id = this.trackId; this.trackId = ''; this.playMusic(id); }
    this.timer = setInterval(() => this.schedule(), 40); this.loadSamples();
  }
  applySettings(s: Settings) {
    this.settings = s; if (!this.ctx) return; const t = this.ctx.currentTime, m = s.mute ? 0 : s.volume.master;
    this.master.gain.setTargetAtTime(m, t, 0.05); this.music.gain.setTargetAtTime(s.volume.music * 0.55, t, 0.05); this.sfxBus.gain.setTargetAtTime(s.volume.sfx, t, 0.05); this.crowdBus.gain.setTargetAtTime(s.volume.crowd, t, 0.05); this.voiceBus.gain.setTargetAtTime(s.volume.voice, t, 0.05);
  }
  suspend(on: boolean) { if (!this.ctx) return; if (on) void this.ctx.suspend(); else void this.ctx.resume(); }
  listener(px: number, py: number, pz: number, fx: number, fy: number, fz: number) {
    const c = this.ctx; if (!c) return; const l = c.listener as any;
    if (l.positionX) { l.positionX.value = px; l.positionY.value = py; l.positionZ.value = pz; l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; }
    else { l.setPosition?.(px, py, pz); l.setOrientation?.(fx, fy, fz, 0, 1, 0); }
  }

  // ------------------------------------------------------------ primitives
  /** One-shot voices currently wired into the graph. */
  private live = 0; private engAt = 0; private humAt = 0; private musAt = 0;
  private out(pos?: Pos, gain = 1, life = 3.6): { node: AudioNode; t: number } {
    const c = this.ctx!; const g = c.createGain(); g.gain.value = gain; let p: PannerNode | null = null;
    // equal-power panning: HRTF convolution per one-shot is far too heavy for a standalone headset
    if (pos) { p = c.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 6; p.rolloffFactor = 0.9; p.maxDistance = 400; p.positionX.value = pos.x; p.positionY.value = pos.y ?? 0; p.positionZ.value = pos.z; g.connect(p); p.connect(this.sfxBus); p.connect(this.wet); }
    else { g.connect(this.sfxBus); g.connect(this.wet); }
    // Finished voices are unhooked explicitly. Left connected they keep being processed, and over a long event the
    // graph grows until the output breaks up and then drops out.
    this.live++; setTimeout(() => { try { g.disconnect(); p?.disconnect(); } catch { /* already gone */ } this.live--; }, life * 1000);
    return { node: g, t: c.currentTime };
  }
  private tone(dst: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, attack = 0.005) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(Math.max(20, f0), t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(dst); o.start(t); o.stop(t + dur + 0.03);
  }
  private burst(dst: AudioNode, t: number, type: BiquadFilterType, f0: number, f1: number, q: number, dur: number, gain: number) {
    const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; s.loop = true; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(f); f.connect(g); g.connect(dst); s.start(t, Math.random()); s.stop(t + dur + 0.03);
  }

  /** One-shot effect by name; pass a position for spatialised playback. */
  sfx(name: string, pos?: Pos, k = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime, last = this.lastPlayed.get(name) ?? -1; if (now - last < (REPEAT_GAP[name] ?? 0.03) || this.live >= 28) return; this.lastPlayed.set(name, now);
    const { node: d, t } = this.out(pos, 0.9); const r = 0.94 + Math.random() * 0.12;
    // a supplied recording (any of its numbered variants, picked at random) takes the place of the synthesised effect
    const own = this.variants[name.toLowerCase()], rec = own ? { gain: 0.75, layer: false } : SFX_SAMPLE[name], smp = rec && this.source(own ? own[Math.floor(Math.random() * own.length)] : name);
    if (rec && smp) { const g = this.ctx.createGain(); g.gain.value = rec.gain * (name === 'ricochet' ? Math.min(1.2, k) : 1); smp.playbackRate.value = r; smp.connect(g); g.connect(d); smp.start(t); if (!rec.layer) return; }
    switch (name) {
      case 'throw': this.burst(d, t, 'bandpass', 500, 3200, 1.2, 0.28, 0.5); this.tone(d, t, 'sine', 320 * r, 980 * r, 0.22, 0.25); break;
      case 'ready': this.tone(d, t, 'triangle', 500, 760, 0.12, 0.12); break;
      case 'catch': this.tone(d, t, 'sine', 900 * r, 420, 0.16, 0.3); this.tone(d, t + 0.02, 'triangle', 1800, 1400, 0.06, 0.12); break;
      case 'recall': this.tone(d, t, 'sine', 300, 1200, 0.3, 0.2); this.burst(d, t, 'highpass', 2000, 6000, 0.7, 0.3, 0.12); break;
      case 'ricochet': { const f = 760 * r * k; this.tone(d, t, 'sine', f, f * 0.98, 0.5, 0.3); this.tone(d, t, 'sine', f * 2.76, f * 2.7, 0.32, 0.16); this.tone(d, t, 'sine', f * 5.4, f * 5.3, 0.18, 0.09); this.burst(d, t, 'highpass', 5000, 2500, 0.7, 0.06, 0.4); break; }
      case 'shieldUp': this.tone(d, t, 'sawtooth', 110, 420, 0.22, 0.14); this.burst(d, t, 'bandpass', 900, 2400, 3, 0.25, 0.18); break;
      case 'shieldDown': this.tone(d, t, 'sawtooth', 380, 120, 0.15, 0.08); break;
      case 'block': this.tone(d, t, 'sine', 150, 60, 0.25, 0.6); this.tone(d, t, 'square', 620 * r, 600, 0.12, 0.12); this.burst(d, t, 'bandpass', 2400, 900, 2, 0.15, 0.4); break;
      case 'shieldBreak': this.burst(d, t, 'bandpass', 3000, 300, 1, 0.5, 0.7); this.tone(d, t, 'sawtooth', 500, 70, 0.45, 0.3); break;
      case 'parry': for (const [i, f] of [1320, 1980, 2970].entries()) this.tone(d, t + i * 0.012, 'sine', f * r, f * r * 0.995, 0.7, 0.2); this.burst(d, t, 'highpass', 7000, 3000, 0.7, 0.12, 0.35); break;
      case 'hit': this.tone(d, t, 'square', 190 * r, 70, 0.2, 0.35); this.burst(d, t, 'lowpass', 2600, 300, 0.8, 0.22, 0.7); break;
      case 'hurt': this.tone(d, t, 'sawtooth', 240, 90, 0.3, 0.3); this.burst(d, t, 'lowpass', 1500, 200, 1, 0.3, 0.6); break;
      case 'shatter': for (let i = 0; i < 14; i++) this.tone(d, t + i * 0.035 + Math.random() * 0.02, 'square', (1800 - i * 105) * r, (900 - i * 50) * r, 0.07, 0.11); this.burst(d, t, 'lowpass', 6000, 200, 0.6, 0.75, 0.55); this.tone(d, t, 'sine', 140, 38, 0.6, 0.5); break;
      case 'tell': this.tone(d, t, 'triangle', 380, 880, 0.55 * k, 0.16, 0.2); break;
      case 'tellHoming': this.tone(d, t, 'sawtooth', 300, 300, 0.7 * k, 0.1, 0.1); this.tone(d, t, 'sine', 920, 1300, 0.7 * k, 0.12, 0.3); break;
      case 'clash': this.tone(d, t, 'sine', 1500 * r, 1480, 0.35, 0.25); this.burst(d, t, 'highpass', 6000, 2000, 0.7, 0.08, 0.5); break;
      case 'jump': this.tone(d, t, 'sine', 220, 520, 0.16, 0.18); break;
      case 'land': this.tone(d, t, 'sine', 120, 50, 0.14, 0.4); this.burst(d, t, 'lowpass', 900, 200, 0.7, 0.1, 0.3); break;
      case 'dodge': this.burst(d, t, 'bandpass', 800, 3000, 1, 0.2, 0.4); break;
      case 'scream': this.tone(d, t, 'sawtooth', 660, 140, 1.05, 0.3, 0.03); this.tone(d, t, 'square', 1330, 280, 0.95, 0.1, 0.03); this.burst(d, t, 'bandpass', 2000, 420, 3, 1.05, 0.34); for (let i = 0; i < 9; i++) this.tone(d, t + 0.3 + i * 0.075, 'square', 980 - i * 85, 180, 0.05, 0.1); break;
      case 'prox': this.tone(d, t, 'square', 700 * k, 700 * k, 0.07, 0.1); this.tone(d, t, 'sine', 350 * k, 350 * k, 0.09, 0.12); break;
      case 'warn': this.tone(d, t, 'square', 740, 740, 0.12, 0.1); this.tone(d, t + 0.16, 'square', 560, 560, 0.14, 0.1); break;
      case 'surge': { this.burst(d, t, 'bandpass', 1800, 5200, 6, 0.5, 0.6); for (let i = 0; i < 6; i++) this.tone(d, t + i * 0.05, 'sawtooth', 90 + Math.random() * 500, 60, 0.05, 0.25); break; }
      case 'explosion': this.tone(d, t, 'sine', 120, 28, 0.9, 0.9); this.burst(d, t, 'lowpass', 4000, 80, 0.5, 1, 0.9); break;
      case 'platformDown': this.tone(d, t, 'sawtooth', 300, 40, 0.7, 0.25); this.burst(d, t, 'lowpass', 1200, 100, 1, 0.6, 0.3); break;
      case 'platformUp': this.tone(d, t, 'sine', 180, 520, 0.4, 0.18); break;
      case 'shift': this.tone(d, t, 'sawtooth', 70, 140, 1.4, 0.2, 0.4); this.burst(d, t, 'bandpass', 300, 1800, 2, 1.4, 0.25); break;
      case 'interfere': for (let i = 0; i < 10; i++) this.burst(d, t + i * 0.05, 'bandpass', 400 + Math.random() * 4000, 500, 8, 0.04, 0.3); break;
      case 'spawn': this.tone(d, t, 'sine', 200, 1400, 0.5, 0.14, 0.2); this.burst(d, t, 'highpass', 3000, 9000, 0.7, 0.5, 0.1); break;
      case 'uiMove': this.tone(d, t, 'sine', 880, 920, 0.05, 0.08); break;
      case 'uiSelect': this.tone(d, t, 'triangle', 660, 660, 0.07, 0.14); this.tone(d, t + 0.06, 'triangle', 990, 990, 0.11, 0.14); break;
      case 'uiBack': this.tone(d, t, 'triangle', 620, 420, 0.12, 0.12); break;
      case 'beep': this.tone(d, t, 'square', 660, 660, 0.14, 0.14); this.tone(d, t, 'sine', 330, 330, 0.18, 0.2); break;
      case 'go': this.tone(d, t, 'square', 990, 990, 0.45, 0.14); this.tone(d, t, 'sine', 495, 495, 0.55, 0.25); this.burst(d, t, 'highpass', 4000, 9000, 0.7, 0.35, 0.15); break;
      case 'turn': this.tone(d, t, 'square', 1250 * r, 900, 0.045, 0.07); this.burst(d, t, 'highpass', 5000, 3000, 1, 0.04, 0.12); break;
      case 'crash': this.burst(d, t, 'lowpass', 7000, 120, 0.5, 0.9, 1); this.tone(d, t, 'sine', 210, 34, 0.7, 0.8); for (let i = 0; i < 10; i++) this.tone(d, t + 0.05 + i * 0.04, 'square', (1500 - i * 110) * r, 400, 0.06, 0.09); break;
      case 'boost': this.tone(d, t, 'sawtooth', 160, 720, 0.5, 0.16, 0.05); this.burst(d, t, 'bandpass', 600, 5000, 1.4, 0.55, 0.3); break;
      case 'pickup': for (const [i, n] of [72, 76, 79, 84].entries()) this.tone(d, t + i * 0.05, 'triangle', hz(n), hz(n), 0.14, 0.16); break;
      case 'power': this.tone(d, t, 'sawtooth', 900, 140, 0.4, 0.2); this.burst(d, t, 'bandpass', 4000, 500, 2, 0.4, 0.3); break;
      case 'nearMiss': this.burst(d, t, 'bandpass', 1400, 5000, 2, 0.22, 0.35); this.tone(d, t, 'sine', 1200, 1900, 0.14, 0.1); break;
      case 'scrape': this.burst(d, t, 'bandpass', 2600 * r, 1400, 4, 0.25, 0.55); this.tone(d, t, 'sawtooth', 180, 120, 0.2, 0.15); break;
      case 'pad': this.tone(d, t, 'sawtooth', 300, 1100, 0.3, 0.14); this.burst(d, t, 'highpass', 2500, 8000, 0.7, 0.3, 0.2); break;
      case 'checkpoint': this.tone(d, t, 'triangle', 880, 880, 0.09, 0.16); this.tone(d, t + 0.09, 'triangle', 1320, 1320, 0.14, 0.16); break;
      case 'lap': for (const [i, n] of [76, 79, 83].entries()) this.tone(d, t + i * 0.08, 'triangle', hz(n), hz(n), 0.18, 0.18); break;
      case 'drift': this.burst(d, t, 'bandpass', 1900, 1500, 5, 0.3, 0.25); break;
      case 'win': for (const [i, n] of [60, 64, 67, 72, 76, 79].entries()) { this.tone(d, t + i * 0.09, 'triangle', hz(n), hz(n), 0.9, 0.16); this.tone(d, t + i * 0.09, 'sine', hz(n + 12), hz(n + 12), 0.6, 0.06); } this.tone(d, t, 'sawtooth', hz(36), hz(36), 1.6, 0.14, 0.3); break;
      case 'lose': for (const [i, n] of [67, 63, 60].entries()) this.tone(d, t + i * 0.22, 'sine', hz(n), hz(n) * 0.99, 0.7, 0.16, 0.05); this.tone(d, t, 'sine', hz(36), hz(34), 1.2, 0.2, 0.2); break;
      case 'boss': this.tone(d, t, 'sawtooth', hz(26), hz(26), 2.4, 0.3, 0.8); this.tone(d, t, 'sawtooth', hz(33), hz(32), 2.4, 0.22, 0.8); this.tone(d, t + 0.4, 'sawtooth', hz(38), hz(39), 2, 0.16, 0.6); this.burst(d, t, 'lowpass', 200, 2400, 1, 2.2, 0.3); break;
      case 'motif': for (const [i, n] of [57, 64, 69, 71, 76].entries()) { this.tone(d, t + i * 0.26, 'sine', hz(n), hz(n), 1.6, 0.16, 0.02); this.tone(d, t + i * 0.26, 'triangle', hz(n + 12), hz(n + 12), 0.9, 0.06, 0.02); } this.tone(d, t, 'sine', hz(33), hz(33), 3.4, 0.3, 1.2); break;
      case 'boot': this.tone(d, t, 'square', 1400 + Math.random() * 1200, 1400, 0.03, 0.04); break;
      case 'whoosh': this.burst(d, t, 'bandpass', 300, 2600, 1, 0.7 * k, 0.5); break;
    }
  }

  // ------------------------------------------------------------ vehicle engine (layered synthetic motor)
  engine(on: boolean) {
    const c = this.ctx; if (!c) return;
    if (on && !this.eng) {
      const g = c.createGain(); g.gain.value = 0; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 4;
      const o1 = c.createOscillator(), o2 = c.createOscillator(), sub = c.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square'; sub.type = 'sine'; o2.detune.value = 9;
      const sg = c.createGain(); sg.gain.value = 0.7; o1.connect(f); o2.connect(f); sub.connect(sg); sg.connect(g); f.connect(g); g.connect(this.sfxBus);
      const ns = c.createBufferSource(); ns.buffer = this.noise; ns.loop = true; const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.8; const n = c.createGain(); n.gain.value = 0; ns.connect(nf); nf.connect(n); n.connect(this.sfxBus);
      o1.start(); o2.start(); sub.start(); ns.start(); this.eng = { o1, o2, sub, f, g, n, nf };
      const es = this.source('engine', true); if (es) { const eg = c.createGain(); eg.gain.value = 0; es.connect(eg); eg.connect(this.sfxBus); es.start(); this.engS = { src: es, g: eg }; }
    } else if (!on && this.eng) { const e = this.eng; this.eng = null; const t = c.currentTime; if (this.engS) { const x = this.engS; this.engS = null; x.g.gain.setTargetAtTime(0, t, 0.1); setTimeout(() => { try { x.src.stop(); } catch { /* stopped */ } }, 600); } e.g.gain.setTargetAtTime(0, t, 0.08); e.n.gain.setTargetAtTime(0, t, 0.08); setTimeout(() => { try { e.o1.stop(); e.o2.stop(); e.sub.stop(); } catch { /* stopped */ } }, 500); }
  }
  /** speed01: 0..~1.4 of nominal top speed. */
  engineSet(speed01: number, boosting: boolean, wind = 0) {
    const e = this.eng, c = this.ctx; if (!e || !c) return; const t = c.currentTime, f = 52 + speed01 * 150 + (boosting ? 26 : 0);
    if (t - this.engAt < 0.06) return; this.engAt = t; // automation at ~16 Hz is plenty for a smoothed parameter
    e.o1.frequency.setTargetAtTime(f, t, 0.06); e.o2.frequency.setTargetAtTime(f * 1.5, t, 0.06); e.sub.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    const k = this.engS ? 0.4 : 1; // with the recorded turbine running, the synthetic layer is only its low end
    e.f.frequency.setTargetAtTime(380 + speed01 * 2100 + (boosting ? 1200 : 0), t, 0.08); e.g.gain.setTargetAtTime((0.07 + speed01 * 0.07) * k, t, 0.1);
    if (this.engS) { this.engS.src.playbackRate.setTargetAtTime(0.72 + speed01 * 0.5 + (boosting ? 0.12 : 0), t, 0.08); this.engS.g.gain.setTargetAtTime(0.16 + speed01 * 0.2, t, 0.12); }
    e.nf.frequency.setTargetAtTime(700 + speed01 * 2600, t, 0.1); e.n.gain.setTargetAtTime(Math.min(0.2, speed01 * speed01 * 0.11 + wind * 0.1), t, 0.1);
  }
  /** Positional hum voices for nearby rivals / incoming projectiles so threats can be located by ear. */
  hums(list: { x: number; y: number; z: number; pitch: number; gain: number }[]) {
    const c = this.ctx; if (!c || c.state !== 'running') return; if (list.length && c.currentTime - this.humAt < 0.06) return; this.humAt = c.currentTime;
    while (this.voices.length < 4) { const o = c.createOscillator(), g = c.createGain(), p = c.createPanner(), f = c.createBiquadFilter(); o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0; p.panningModel = 'equalpower'; p.refDistance = 5; p.rolloffFactor = 1.4; o.connect(f); f.connect(g); g.connect(p); p.connect(this.sfxBus); o.start(); this.voices.push({ o, g, p, f }); }
    const t = c.currentTime;
    for (let i = 0; i < this.voices.length; i++) { const v = this.voices[i], s = list[i]; if (!s) { v.g.gain.setTargetAtTime(0, t, 0.05); continue; } v.o.frequency.setTargetAtTime(s.pitch, t, 0.05); v.f.frequency.setTargetAtTime(s.pitch * 6, t, 0.05); v.g.gain.setTargetAtTime(s.gain, t, 0.05); v.p.positionX.setTargetAtTime(s.x, t, 0.03); v.p.positionY.setTargetAtTime(s.y, t, 0.03); v.p.positionZ.setTargetAtTime(s.z, t, 0.03); }
  }

  // ------------------------------------------------------------ crowd (situational, never constant)
  cheer(amount = 1) {
    const c = this.ctx; if (!c || c.state !== 'running') return; const t = c.currentTime;
    if (amount > 0.05 && this.buf.has('cheer_soft')) {
      const s = this.source(amount > 1.3 ? 'cheer_long' : amount > 0.75 ? 'cheer_big' : 'cheer_soft'); if (!s) return;
      if (this.cheerS) { const o = this.cheerS; o.g.gain.setTargetAtTime(0, t, 0.25); setTimeout(() => { try { o.src.stop(); } catch { /* stopped */ } }, 1500); }
      const g = c.createGain(), len = Math.min(s.buffer!.duration, 3.5 + amount * 2.5); g.gain.value = 0; g.gain.setTargetAtTime(Math.min(0.85, 0.3 + 0.35 * amount), t, 0.12); g.gain.setTargetAtTime(0, t + len - 1.2, 0.5);
      s.connect(g); g.connect(this.crowdBus); g.connect(this.wet); s.start(t, Math.random() * Math.max(0, s.buffer!.duration - len - 0.5)); s.stop(t + len + 1.5); this.cheerS = { src: s, g }; return;
    }
    if (!this.crowdG) { const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true; const f = (this.crowdF = c.createBiquadFilter()); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.6; const g = (this.crowdG = c.createGain()); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.crowdBus); g.connect(this.wet); s.start(); }
    const g = this.crowdG!.gain, f = this.crowdF!.frequency, peak = Math.min(0.5, 0.2 * amount + this.crowdBed);
    g.cancelScheduledValues(t); g.setTargetAtTime(peak, t, 0.18); g.setTargetAtTime(this.crowdBed, t + 0.9 + amount * 0.6, 0.7);
    f.cancelScheduledValues(t); f.setTargetAtTime(1500 + 500 * amount, t, 0.2); f.setTargetAtTime(800, t + 1, 0.8);
  }
  setCrowdBed(v: number) {
    this.crowdBed = v; const c = this.ctx;
    if (c && this.buf.has('crowd_bed')) {
      // recorded arena ambience (the bed values were tuned for filtered noise, hence the scale)
      if (v > 0 && !this.bedS) { const s = this.source('crowd_bed', true); if (s) { const g = c.createGain(); g.gain.value = 0; s.connect(g); g.connect(this.crowdBus); s.start(); this.bedS = { src: s, g }; } }
      if (this.bedS) { this.bedS.g.gain.setTargetAtTime(Math.min(0.5, v * 14), c.currentTime, 0.8); if (v <= 0) { const o = this.bedS; this.bedS = null; setTimeout(() => { try { o.src.stop(); } catch { /* stopped */ } }, 4000); } }
      return;
    }
    this.setCrowdBedSynth(v);
  }
  private setCrowdBedSynth(v: number) { this.crowdBed = v; if (this.crowdG && this.ctx) this.crowdG.gain.setTargetAtTime(v, this.ctx.currentTime, 0.5); else if (v > 0) this.cheer(0); }

  // ------------------------------------------------------------ announcer
  say(text: string, opts: { quiet?: boolean } = {}) {
    this.onSubtitle(text); const c = this.ctx; if (opts.quiet || !c || c.state !== 'running') return;
    // a supplied recording named after the caption (vo_boundary_collapsing, …) is spoken instead of the tone
    const line = this.source('vo_' + slug(text)); if (line) { const lg = c.createGain(); lg.gain.value = 1; line.connect(lg); lg.connect(this.voiceBus); line.start(); line.onended = () => { try { lg.disconnect(); } catch { /* gone */ } }; return; }
    // a two-note comms tone marks the caption; spoken lines are recorded clips played through vo()
    const g = c.createGain(); g.gain.value = 0.5; g.connect(this.voiceBus); const t = c.currentTime; this.tone(g, t, 'sine', 1180, 1180, 0.07, 0.12); this.tone(g, t + 0.08, 'sine', 1570, 1570, 0.1, 0.12);
  }

  // ------------------------------------------------------------ adaptive music
  playMusic(id: string) { if (id === this.trackId) return; this.trackId = id; this.track = TRACKS[id] ?? null; this.step = 0; if (this.ctx) this.nextT = this.ctx.currentTime + 0.1; this.startMusicSample(); if (this.mus) this.track = null; }
  stopMusic() { this.trackId = ''; this.track = null; if (this.mus && this.ctx) { const o = this.mus; this.mus = null; o.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4); setTimeout(() => { try { o.src.stop(); } catch { /* stopped */ } }, 2000); } }
  private schedule() {
    const c = this.ctx, tr = this.track; if (!c || c.state !== 'running') return;
    this.intensityNow += (this.intensity - this.intensityNow) * 0.05;
    if (this.ambWant && !this.ambS && this.buf.has('amb_' + this.ambWant)) this.ambience(this.ambWant);
    // the recorded bed opens up with intensity: muffled while things are calm, full range in a fight
    if (this.mus && c.currentTime - this.musAt > 0.25) { this.musAt = c.currentTime; const k = this.intensityNow; this.mus.f.frequency.setTargetAtTime(700 + k * k * 15000, c.currentTime, 0.4); this.mus.g.gain.setTargetAtTime(0.55 + 0.45 * k, c.currentTime, 0.4); }
    if (!tr) return;
    const sp = 60 / tr.bpm / 4; if (this.nextT < c.currentTime - 0.5) this.nextT = c.currentTime + 0.05;
    while (this.nextT < c.currentTime + 0.18) { this.playStep(tr, this.step, this.nextT, sp); this.step++; this.nextT += sp; }
  }
  private mTone(t: number, type: OscillatorType, f: number, dur: number, gain: number, cutoff: number, attack = 0.01) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter(); o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.setValueAtTime(cutoff, t); fl.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.35), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(fl); fl.connect(g); g.connect(this.music); g.connect(this.wet); o.start(t); o.stop(t + dur + 0.05);
  }
  private playStep(tr: Track, step: number, t: number, sp: number) {
    const I = this.intensityNow, s16 = step % 16, bar = Math.floor(step / 16), chord = tr.prog[bar % tr.prog.length], lift = bar % 8 >= 4 ? 12 : 0;
    // pad: restrained between encounters
    if (s16 === 0) for (const n of chord) { this.mTone(t, 'sawtooth', hz(tr.root + 12 + n), sp * 16.5, 0.035, 700 + I * 1400, sp * 4); this.mTone(t, 'sawtooth', hz(tr.root + 12 + n) * 1.006, sp * 16.5, 0.03, 600 + I * 1200, sp * 4); }
    // bass
    if (I > 0.18 && s16 % 2 === 0 && tr.bass[(s16 / 2) % 8]) this.mTone(t, 'sawtooth', hz(tr.root - 12 + chord[0]), sp * 1.8, 0.16, 260 + I * 700);
    // arpeggio (extra synth layer for races / high intensity)
    if (I > 0.38 && s16 % 2 === 0) { const idx = tr.arp[(s16 / 2) % 8], n = chord[idx % chord.length] + (idx >= chord.length ? 12 : 0); this.mTone(t, 'triangle', hz(tr.root + 24 + n + lift), sp * 1.6, 0.055 * Math.min(1, I + 0.2), 2400 + I * 3000); }
    if (I > 0.72 && s16 % 4 === 2) this.mTone(t, 'square', hz(tr.root + 36 + chord[(bar + s16) % chord.length]), sp * 0.9, 0.022, 3600);
    // percussion enters with risk
    const c = this.ctx!;
    if (I > 0.5 && s16 % 4 === 0) { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); o.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.25); }
    if (I > 0.62 && s16 % 2 === 1) { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 7500; g.gain.setValueAtTime(0.07 * (s16 % 4 === 3 ? 1.4 : 1), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); s.connect(f); f.connect(g); g.connect(this.music); s.start(t, Math.random()); s.stop(t + 0.07); }
    if (I > 0.8 && s16 % 8 === 4) { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8; g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); s.connect(f); f.connect(g); g.connect(this.music); g.connect(this.wet); s.start(t, Math.random()); s.stop(t + 0.2); }
  }
}
