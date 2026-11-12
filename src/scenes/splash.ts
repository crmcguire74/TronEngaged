import type { Ctx } from '../app/context';
import type { Actions } from '../input/input';
import type { MenuScene } from './menuScene';

const BOOT = ['> uplink ………………… established', '> lattice kernel 7.3 ………… ok', '> hardlight emitters ……… ok', '> arena registry ………… 60 tiers', '> runner profile ………… loaded', '> drawing lattice'];
const TITLE = 'VANTA ARC';
/**
 * Opening cinematic (skippable): system initialisation over black, the lattice drawing itself outward under a
 * descending camera, architecture and searchlights rising, the title assembling letter by letter, two cycles laying
 * walls across the frame, then a disc thrown at the camera that cuts to the command centre.
 * After the first launch only a short title card plays.
 */
export class Splash {
  private el = document.createElement('div'); private boot: HTMLElement; private title: HTMLElement; private press: HTMLElement; private t = 0; private gate: boolean; private line = -1; private stage = 0; private finished = false;
  constructor(private ctx: Ctx, ui: HTMLElement, private scene: MenuScene, private full: boolean, private done: () => void) {
    const letters = [...TITLE].map((ch, i) => (ch === ' ' ? '<span class="sp"></span>' : `<span style="--i:${i}">${ch}</span>`)).join('');
    this.el.className = 'splash'; this.el.innerHTML = `<div class="veil"></div><div class="boot"></div><div class="title-lock"><div class="eyebrow">A LATTICE PROTOCOL SIMULATION</div><h1 aria-label="${TITLE}">${letters}</h1><div class="rule"><i></i></div><p>DISC ARENA &nbsp;·&nbsp; CYCLE COMBAT &nbsp;·&nbsp; CIRCUIT RACING</p></div><div class="press"></div><button class="chip skip">Skip ▸</button>`;
    this.boot = this.el.querySelector('.boot')!; this.title = this.el.querySelector('.title-lock')!; this.press = this.el.querySelector('.press')!;
    this.el.querySelector('.skip')!.addEventListener('click', (e) => { e.stopPropagation(); this.finish(); });
    ui.appendChild(this.el);
    // audio needs a gesture: the first launch waits on a deliberate start so the score can play
    this.gate = full; scene.reveal = full ? 0 : 1; scene.dolly = full ? 0 : 1; scene.cycles = !full;
    if (full) { this.el.classList.add('dark'); this.press.textContent = 'Click or press any key to initialise'; this.press.classList.add('on'); (this.el.querySelector('.skip') as HTMLElement).style.display = 'none'; const go = () => { if (!this.gate) return; this.gate = false; this.press.classList.remove('on'); (this.el.querySelector('.skip') as HTMLElement).style.display = ''; ctx.audio.unlock(); }; this.el.addEventListener('pointerdown', go); addEventListener('keydown', go, { once: true }); }
    else this.title.classList.add('on', 'quick');
  }
  private finish() { if (this.finished) return; this.finished = true; const s = this.scene; s.reveal = 1; s.dolly = 1; s.cycles = true; s.passT = -1; this.el.style.transition = 'opacity .6s'; this.el.style.opacity = '0'; setTimeout(() => this.el.remove(), 620); this.done(); }
  update(dt: number, a: Actions) {
    const s = this.scene; s.update(dt); if (this.finished || this.gate) return; this.t += dt; const t = this.t, au = this.ctx.audio;
    if (!this.full) { if (t > 1.8 || (t > 0.3 && (a.confirm || a.back))) this.finish(); return; }
    if (t > 1 && (a.confirm || a.back)) { this.finish(); return; }
    const ln = Math.min(BOOT.length - 1, Math.floor(t / 0.34)); if (ln !== this.line && t < 2.4) { this.line = ln; this.boot.textContent = BOOT.slice(0, ln + 1).join('\n'); au.sfx('boot'); }
    if (t > 2.2 && this.stage < 1) { this.stage = 1; this.el.classList.remove('dark'); au.sfx('motif'); au.sfx('whoosh', undefined, 2.2); au.playMusic('menu'); au.intensity = 0.25; }
    if (t > 2.2) { s.reveal = Math.min(1, (t - 2.2) / 4.6); s.dolly = Math.min(1, (t - 2.2) / 5.6); }
    if (t > 2.8) this.boot.style.opacity = String(Math.max(0, 0.85 - (t - 2.8) * 1.2));
    if (t > 4.6 && this.stage < 2) { this.stage = 2; this.title.classList.add('on'); au.sfx('shieldUp'); }
    if (t > 6 && this.stage < 3) { this.stage = 3; s.cycles = true; s.passDir = 1; s.passT = 0; au.sfx('boost'); au.intensity = 0.55; this.ctx.engine.addShake(0.25); }
    if (t > 7.3 && this.stage < 4) { this.stage = 4; s.passDir = -1; s.passT = 0; au.sfx('boost'); this.ctx.engine.addShake(0.25); }
    if (t > 8.8 && this.stage < 5) { this.stage = 5; s.discT = 0; au.sfx('throw'); this.title.classList.add('out'); }
    if (t > 9.75 && this.stage < 6) { this.stage = 6; au.sfx('parry'); this.ctx.engine.fadeTo(1, 14); setTimeout(() => this.ctx.engine.fadeTo(0, 2.2), 120); }
    if (t > 9.95) this.finish();
  }
}
