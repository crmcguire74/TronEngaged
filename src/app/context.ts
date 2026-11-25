import * as THREE from 'three';
import type { Engine } from '../engine/engine';
import type { Assets } from '../engine/assets';
import type { AudioEngine } from '../engine/audio';
import type { Input, Actions } from '../input/input';
import type { XRManager } from '../engine/xr';
import type { Vfx } from '../engine/vfx';
import type { SaveStore, Settings } from '../persistence/store';
import type { DifficultyId, GameMode, TierDefinition } from '../progression/types';
import { FIXED_DT } from '../engine/engine';

export interface HudApi {
  show(mode: 'discs' | 'combat' | 'race' | null): void; update(data: Record<string, any>): void;
  toast(text: string, kind?: string): void; banner(title: string, sub?: string, ms?: number): void; count(text: string | null): void;
  flash(kind: 'hurt' | 'good' | 'warn'): void; subtitle(text: string): void;
  /** Persistent goal/controls line; null clears it. */ coach(text: string | null): void;
  /** Where the in-headset HUD lives: 'dash' = on the cockpit screen, 'belt' = a low panel that follows the head. */ vrMode: 'belt' | 'dash'; menuHint: string;
  drawVR(dt: number): boolean; readonly vrTexture: import('three').CanvasTexture;
  /** VR: the head's seated position in rig space. The overhead map panel hangs beside it; null hides the panel. */ vrSeat: { x: number; y: number; z: number } | null; mapPlace: string;
}
export interface Ctx { engine: Engine; assets: Assets; audio: AudioEngine; input: Input; xr: XRManager; vfx: Vfx; store: SaveStore; hud: HudApi; settings: Settings }
export interface SessionResult { won: boolean; score: number; lines: [string, number][]; stats: [string, string][]; time: number; headline: string; detail: string }

/** Shared encounter lifecycle: intro → countdown → fixed-timestep play → outro. Simulation never depends on display refresh rate. */
export abstract class BaseSession {
  phase: 'intro' | 'countdown' | 'play' | 'outro' | 'done' = 'intro'; t = 0; result: SessionResult | null = null;
  readonly world = new THREE.Group(); protected acc = 0; protected introDur = 4.2; protected outroDur = 2.6; private lastCount = 4; timeScale = 1;
  abstract readonly mode: GameMode;
  constructor(readonly ctx: Ctx, readonly tier: TierDefinition, readonly diff: DifficultyId) {}
  get xr() { return this.ctx.xr.presenting; }

  // ---------------------------------------------------------------- kill-cam
  private kcSlowT = 0; private kcSlowDur = 0; private kcSlowMin = 1; private kc: { x: number; y: number; z: number; t: number; dur: number; a0: number } | null = null;
  private kcV = new THREE.Vector3(); private kcL = new THREE.Vector3(); private kcD = new THREE.Vector3();
  /**
   * A beat of slow motion that holds, then eases back to full speed over its second half. In a headset the world slows
   * but the view never moves (time dilation is comfortable; a camera the player did not move is not).
   */
  slowmo(dur: number, min: number) { if (this.kcSlowT > 0 && this.kcSlowMin <= min) return; this.kcSlowT = this.kcSlowDur = dur; this.kcSlowMin = min; }
  /** Desktop kill-cam: for `dur` seconds the camera swings round the point where a rival fell, then hands back. */
  killCam(x: number, y: number, z: number, dur = 1.3) { if (this.xr) return; this.kc = { x, y, z, t: 0, dur, a0: Math.atan2(this.ctx.engine.camera.position.x - x, this.ctx.engine.camera.position.z - z) }; }
  /** Call at the end of view(), after the session has placed its own camera: blends the kill-cam over it. */
  protected applyKillCam(dt: number) {
    const kc = this.kc; if (!kc) return; kc.t += dt; const k = kc.t / kc.dur; if (k >= 1 || this.xr) { this.kc = null; return; }
    const sm = (v: number) => { const c = Math.min(1, Math.max(0, v)); return c * c * (3 - 2 * c); }, w = sm(k / 0.14) * (1 - sm((k - 0.72) / 0.28));
    const cam = this.ctx.engine.camera; cam.getWorldDirection(this.kcD); this.kcL.copy(cam.position).addScaledVector(this.kcD, 10);
    const a = kc.a0 + 0.35 + k * 0.9, r = 6.5 - k * 1.5; this.kcV.set(kc.x + Math.sin(a) * r, kc.y + 2 + k * 0.6, kc.z + Math.cos(a) * r);
    cam.position.lerp(this.kcV, w); cam.lookAt(this.kcL.lerp(this.kcV.set(kc.x, kc.y + 0.8, kc.z), w));
  }
  update(dt: number, a: Actions) {
    this.t += dt;
    if (this.kcSlowT > 0) { this.kcSlowT -= dt; const k = 1 - this.kcSlowT / this.kcSlowDur, e = Math.min(1, Math.max(0, (k - 0.5) / 0.5)); this.timeScale = this.kcSlowT <= 0 ? 1 : this.kcSlowMin + (1 - this.kcSlowMin) * e * e * (3 - 2 * e); }
    if (this.phase === 'intro') {
      const k = Math.min(1, this.t / this.introDur); this.intro(k, dt);
      if (k >= 1 || (this.t > 0.5 && (a.confirm || a.jump))) { this.phase = 'countdown'; this.t = 0; this.lastCount = 4; this.intro(1, dt); this.onCountdown(); this.ctx.audio.vo('ready'); }
    } else if (this.phase === 'countdown') {
      const n = 3 - Math.floor(this.t / 0.8);
      if (n !== this.lastCount) { this.lastCount = n; if (n > 0) { this.ctx.hud.count(String(n)); this.ctx.audio.sfx('beep'); } else { this.ctx.hud.count('GO'); this.ctx.audio.sfx('go'); this.ctx.audio.vo(this.mode === 'discs' ? 'fight' : 'begin'); this.phase = 'play'; this.t = 0; this.onStart(); setTimeout(() => this.ctx.hud.count(null), 700); } }
    } else if (this.phase === 'play') {
      this.acc += Math.min(dt, 0.1) * this.timeScale; let first = true;
      while (this.acc >= FIXED_DT) { this.step(FIXED_DT, a, first); first = false; this.acc -= FIXED_DT; if (this.ended()) break; }
      if (this.ended()) { this.phase = 'outro'; this.t = 0; this.acc = 0; this.result = this.finish(); }
    } else if (this.phase === 'outro') {
      this.acc += Math.min(dt, 0.1) * 0.5; while (this.acc >= FIXED_DT) { this.step(FIXED_DT, a, false); this.acc -= FIXED_DT; }
      if (this.t > this.outroDur) this.phase = 'done';
    }
    this.view(dt, this.phase === 'play' || this.phase === 'outro' ? this.acc / FIXED_DT : 1, a);
  }
  protected onCountdown() {} protected onStart() {}
  protected abstract intro(k: number, dt: number): void;
  protected abstract step(dt: number, a: Actions, first: boolean): void;
  protected abstract ended(): boolean;
  protected abstract finish(): SessionResult;
  protected abstract view(dt: number, alpha: number, a: Actions): void;
  dispose() {}
}

/** Picks the control label for the active input device. */
export const ctl = (device: string, kbm: string, pad: string, xr: string) => (device === 'xr' ? xr : device === 'pad' ? pad : kbm);
export const fmtTime = (s: number) => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`; };
