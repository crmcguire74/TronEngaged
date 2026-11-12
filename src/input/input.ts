import type { Settings } from '../persistence/store';

/** Normalised, device-independent actions. Game code never reads keys, buttons or controllers directly. */
export interface Actions {
  moveX: number; moveY: number; lookX: number; lookY: number;
  throwHeld: boolean; shieldHeld: boolean; boost: boolean;
  steer: number; accel: number; brake: number;
  jump: boolean; dodge: boolean; recall: boolean; pause: boolean; ability: boolean; camera: boolean; confirm: boolean; back: boolean;
  turnLeft: boolean; turnRight: boolean; navX: number; navY: number;
  device: 'kbm' | 'pad' | 'xr';
}
export const blankActions = (): Actions => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, throwHeld: false, shieldHeld: false, boost: false, steer: 0, accel: 0, brake: 0, jump: false, dodge: false, recall: false, pause: false, ability: false, camera: false, confirm: false, back: false, turnLeft: false, turnRight: false, navX: 0, navY: 0, device: 'kbm' });

export const ACTION_LABELS: Record<string, string> = { moveUp: 'Forward / Accelerate', moveDown: 'Back / Brake', moveLeft: 'Left / Steer left', moveRight: 'Right / Steer right', jump: 'Jump / Platform hop', dodge: 'Dodge', recall: 'Recall discs', boost: 'Boost', ability: 'Special ability', camera: 'Change camera', pause: 'Pause' };
export function keyLabel(code: string) { return code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'L-Shift').replace('ShiftRight', 'R-Shift').replace('ControlLeft', 'L-Ctrl').replace('Arrow', '↑↓←→'.includes(code) ? '' : 'Arrow ').replace('Space', 'Space'); }

export class Input {
  readonly actions = blankActions();
  /** XR layer writes here each frame; merged into `actions` when a session is presenting. */
  xr: Partial<Actions> | null = null;
  private keys = new Set<string>(); private pressed = new Set<string>(); private mouseDX = 0; private mouseDY = 0; private buttons = 0; private settings!: Settings;
  private padPrev: boolean[] = []; private padAxisPrev = 0; private capture: ((code: string) => void) | null = null;
  locked = false; wantLock = false; lastPad = false; onAnyInput: () => void = () => {}; onLockLost: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      this.onAnyInput();
      if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c(e.code); return; }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code); this.keys.add(e.code); this.lastPad = false;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; });
    canvas.addEventListener('mousedown', (e) => { this.onAnyInput(); this.buttons |= 1 << e.button; if (this.wantLock && !this.locked) canvas.requestPointerLock?.(); this.lastPad = false; });
    addEventListener('mouseup', (e) => { this.buttons &= ~(1 << e.button); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    document.addEventListener('pointerlockchange', () => { const was = this.locked; this.locked = document.pointerLockElement === canvas; if (!this.locked) { this.buttons = 0; if (was && this.wantLock) this.onLockLost(); } });
  }
  setSettings(s: Settings) { this.settings = s; }
  /** Pointer lock is requested only while a mode that aims with the mouse is active. */
  setPointerLock(on: boolean) { this.wantLock = on; if (!on && this.locked) document.exitPointerLock?.(); }
  captureNext(cb: (code: string) => void) { this.capture = cb; }
  private b(action: string) { return this.keys.has(this.settings.bindings[action]); }
  private p(action: string) { return this.pressed.has(this.settings.bindings[action]); }

  rumble(strong: number, weak: number, ms: number) {
    if (!this.lastPad) return;
    for (const g of navigator.getGamepads?.() ?? []) { const a: any = g && (g as any).vibrationActuator; if (a?.playEffect) { a.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {}); return; } }
  }

  update(dt: number): Actions {
    const a = this.actions, s = this.settings, k = this.keys, pr = this.pressed;
    const L = this.b('moveLeft') || k.has('ArrowLeft'), R = this.b('moveRight') || k.has('ArrowRight'), U = this.b('moveUp') || k.has('ArrowUp'), D = this.b('moveDown') || k.has('ArrowDown');
    a.moveX = (R ? 1 : 0) - (L ? 1 : 0); a.moveY = (U ? 1 : 0) - (D ? 1 : 0);
    a.steer = a.moveX; a.accel = U ? 1 : 0; a.brake = D ? 1 : 0;
    const sens = 0.0022 * s.sensitivity; a.lookX = this.mouseDX * sens; a.lookY = this.mouseDY * sens * (s.invertY ? -1 : 1); this.mouseDX = this.mouseDY = 0;
    a.throwHeld = this.locked && (this.buttons & 1) !== 0; a.shieldHeld = (this.locked && (this.buttons & 4) !== 0) || k.has('KeyF');
    a.boost = this.b('boost');
    a.jump = this.p('jump'); a.dodge = this.p('dodge'); a.recall = this.p('recall'); a.pause = this.p('pause') || pr.has('KeyP'); a.ability = this.p('ability'); a.camera = this.p('camera');
    a.confirm = pr.has('Enter') || pr.has('Space'); a.back = pr.has('Escape') || pr.has('Backspace');
    a.turnLeft = pr.has(s.bindings.moveLeft) || pr.has('ArrowLeft'); a.turnRight = pr.has(s.bindings.moveRight) || pr.has('ArrowRight');
    a.navX = (pr.has('ArrowRight') || pr.has('KeyD') ? 1 : 0) - (pr.has('ArrowLeft') || pr.has('KeyA') ? 1 : 0); a.navY = (pr.has('ArrowDown') || pr.has('KeyS') ? 1 : 0) - (pr.has('ArrowUp') || pr.has('KeyW') ? 1 : 0);
    a.device = this.lastPad ? 'pad' : 'kbm';
    pr.clear();

    // gamepad (standard mapping) with tunable dead zone and sensitivity
    const gp = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected && g.mapping === 'standard');
    if (gp) {
      const dz = s.deadzone, ax = (i: number) => { const v = gp.axes[i] ?? 0; return Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz); };
      const bt = (i: number) => gp.buttons[i]?.pressed ?? false, val = (i: number) => gp.buttons[i]?.value ?? 0, edge = (i: number) => bt(i) && !this.padPrev[i];
      const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
      if (lx || ly || rx || ry || gp.buttons.some((b) => b.pressed)) { this.lastPad = true; this.onAnyInput(); }
      if (this.lastPad) {
        a.device = 'pad'; a.moveX = lx; a.moveY = -ly; a.steer = lx; a.accel = val(7); a.brake = val(6);
        a.lookX = rx * 2.6 * s.padSensitivity * dt; a.lookY = ry * 1.8 * s.padSensitivity * dt * (s.invertY ? -1 : 1);
        a.throwHeld = val(7) > 0.4; a.shieldHeld = val(6) > 0.4; a.boost = bt(0);
        a.jump = edge(0); a.dodge = edge(1); a.recall = edge(5); a.ability = edge(1); a.camera = edge(5); a.pause = edge(9); a.confirm = edge(0); a.back = edge(1);
        const dl = edge(14), dr = edge(15), fl = lx < -0.6 && this.padAxisPrev >= -0.6, fr = lx > 0.6 && this.padAxisPrev <= 0.6;
        a.turnLeft = dl || fl; a.turnRight = dr || fr; a.navX = (dr || fr ? 1 : 0) - (dl || fl ? 1 : 0);
        const yPrev = (this as any)._yPrev ?? 0; a.navY = (edge(13) || (ly > 0.6 && yPrev <= 0.6) ? 1 : 0) - (edge(12) || (ly < -0.6 && yPrev >= -0.6) ? 1 : 0); (this as any)._yPrev = ly;
      }
      this.padAxisPrev = lx; this.padPrev = gp.buttons.map((b) => b.pressed);
    }
    if (this.xr) { Object.assign(a, this.xr); a.device = 'xr'; }
    return a;
  }
}
