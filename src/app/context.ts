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

  update(dt: number, a: Actions) {
    this.t += dt;
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
