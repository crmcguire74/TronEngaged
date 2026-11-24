import type { Ctx } from '../app/context';
import type { Actions } from '../input/input';
import type { MenuScene } from './menuScene';

const BOOT = [
  '> uplink ……………………… established',
  '> grid kernel 7.3 ………… ok',
  '> hardlight emitters … ok',
  '> arena registry ……… 72 tiers',
  '> rider profile ………… loaded',
  '> engaging',
];
const TITLE = 'TRON';
const WORD2 = 'ENGAGED';
/** Beat sheet, in seconds. Kept in one place so the audio, the 3D staging and the DOM stay in step. */
const B = { boot: 0.32, ignite: 2.1, ringOn: 3.0, lock: 4.25, pass1: 6.0, pass2: 7.3, throw: 8.8, cut: 9.75, end: 9.95 };

/**
 * Opening title sequence (skippable). Over black, the system boots; the grid ignites and draws itself outward under a
 * descending camera; a ring strokes itself on and the TRON wordmark slams in letter by letter with ENGAGED tracking
 * out beneath it; an ion cycle rips across the frame, then an ember rival the other way; a disc is thrown at the
 * camera and cuts to the command centre. After the first launch only a short title card plays.
 */
export class Splash {
  private el = document.createElement('div');
  private boot: HTMLElement; private title: HTMLElement; private press: HTMLElement; private flash: HTMLElement;
  private t = 0; private gate: boolean; private line = -1; private stage = 0; private finished = false;
  constructor(private ctx: Ctx, ui: HTMLElement, private scene: MenuScene, private full: boolean, private done: () => void) {
    const letters = [...TITLE].map((ch, i) => (ch === ' ' ? '<span class="sp"></span>' : `<span style="--i:${i}">${ch}</span>`)).join('');
    const streaks = Array.from({ length: 9 }, (_, i) => `<i class="${i % 3 === 2 ? 'warm' : ''}" style="--d:${i};top:${8 + i * 10.2}%"></i>`).join('');
    this.el.className = 'splash';
    this.el.innerHTML = `<div class="veil"></div><div class="grain"></div><div class="streaks">${streaks}</div>
      <div class="frame"><b></b><b></b><b></b><b></b><s></s><s></s></div>
      <div class="boot"></div>
      <div class="title-lock">
        <svg class="ring" viewBox="0 0 220 220" aria-hidden="true"><circle class="r-base" cx="110" cy="110" r="100"/><circle class="r-draw" cx="110" cy="110" r="100"/><circle class="r-head" cx="110" cy="110" r="100"/></svg>
        <div class="eyebrow">IDENTITY VERIFIED · ENTERING THE GRID</div>
        <h1 aria-label="${TITLE} ${WORD2}">${letters}</h1>
        <div class="word2" aria-hidden="true">${WORD2}</div>
        <div class="rule"><i></i></div>
        <p>A MODERN 3D TRON EXPERIENCE</p>
        <p class="modes">WEB<em>|</em>VR<em>|</em>IMMERSIVE GAMING</p>
      </div>
      <div class="press"></div><div class="flash"></div><button class="chip skip">Skip ▸</button>`;
    this.boot = this.el.querySelector('.boot')!; this.title = this.el.querySelector('.title-lock')!;
    this.press = this.el.querySelector('.press')!; this.flash = this.el.querySelector('.flash')!;
    this.el.querySelector('.skip')!.addEventListener('click', (e) => { e.stopPropagation(); this.finish(); });
    ui.appendChild(this.el);
    // audio needs a gesture: the first launch waits on a deliberate start so the score can play
    this.gate = full; scene.reveal = full ? 0 : 1; scene.dolly = full ? 0 : 1; scene.cycles = !full;
    if (full) {
      this.el.classList.add('dark');
      this.press.innerHTML = '<b>Enter the grid</b>'; this.press.classList.add('on');
      const skip = this.el.querySelector('.skip') as HTMLElement; skip.style.display = 'none';
      const go = () => { if (!this.gate) return; this.gate = false; this.press.classList.remove('on'); skip.style.display = ''; ctx.audio.unlock(); };
      this.el.addEventListener('pointerdown', go); addEventListener('keydown', go, { once: true });
    } else { this.el.classList.add('lit'); this.title.classList.add('on', 'quick'); }
  }

  /** One-frame white bleach, used on the hard beats. */
  private pop(a: number) { this.flash.style.transition = 'none'; this.flash.style.opacity = String(a); requestAnimationFrame(() => { this.flash.style.transition = ''; this.flash.style.opacity = '0'; }); }
  /** Rips the horizon streaks across the frame; dir -1 runs them the other way. */
  private rip(dir: number) { this.el.dataset.rip = ''; void this.el.offsetWidth; this.el.dataset.rip = dir > 0 ? '1' : '2'; }

  private finish() {
    if (this.finished) return; this.finished = true;
    const s = this.scene; s.reveal = 1; s.dolly = 1; s.cycles = true; s.passT = -1;
    this.el.style.transition = 'opacity .6s'; this.el.style.opacity = '0';
    setTimeout(() => this.el.remove(), 620); this.done();
  }

  update(dt: number, a: Actions) {
    const s = this.scene; s.update(dt); if (this.finished || this.gate) return;
    this.t += dt; const t = this.t, au = this.ctx.audio;
    if (!this.full) { if (t > 1.8 || (t > 0.3 && (a.confirm || a.back))) this.finish(); return; }
    if (t > 1 && (a.confirm || a.back)) { this.finish(); return; }

    const ln = Math.min(BOOT.length - 1, Math.floor(t / B.boot));
    if (ln !== this.line && t < B.ignite + 0.3) { this.line = ln; this.boot.textContent = BOOT.slice(0, ln + 1).join('\n'); au.sfx('boot'); }
    // grid ignition: the lattice draws outward, the frame and grain come up, the score starts
    if (t > B.ignite && this.stage < 1) {
      this.stage = 1; this.el.classList.remove('dark'); this.el.classList.add('lit'); this.pop(0.5);
      au.sfx('motif'); au.sfx('whoosh', undefined, 2.2); au.playMusic('menu'); au.intensity = 0.25; this.ctx.engine.addShake(0.12);
    }
    if (t > B.ignite) { s.reveal = Math.min(1, (t - B.ignite) / 4.4); s.dolly = Math.min(1, (t - B.ignite) / 5.4); }
    if (t > B.ignite + 0.6) this.boot.style.opacity = String(Math.max(0, 0.9 - (t - B.ignite - 0.6) * 1.2));
    // ring draw, then the wordmark locks on a beat of its own
    if (t > B.ringOn && this.stage < 2) { this.stage = 2; this.title.classList.add('ring-on'); au.sfx('shieldUp'); }
    if (t > B.lock && this.stage < 3) { this.stage = 3; this.title.classList.add('on'); this.pop(0.28); au.sfx('catch'); this.ctx.engine.addShake(0.16); }
    // two passes: the ion cycle one way, the ember rival back the other
    if (t > B.pass1 && this.stage < 4) { this.stage = 4; s.cycles = true; s.passDir = 1; s.passT = 0; this.rip(1); au.sfx('boost'); au.intensity = 0.55; this.ctx.engine.addShake(0.3); }
    if (t > B.pass2 && this.stage < 5) { this.stage = 5; s.passDir = -1; s.passT = 0; this.rip(-1); au.sfx('boost'); au.intensity = 0.72; this.ctx.engine.addShake(0.3); }
    if (t > B.throw && this.stage < 6) { this.stage = 6; s.discT = 0; au.sfx('throw'); this.title.classList.add('out'); }
    if (t > B.cut && this.stage < 7) { this.stage = 7; au.sfx('parry'); this.pop(0.9); this.ctx.engine.fadeTo(1, 14); setTimeout(() => this.ctx.engine.fadeTo(0, 2.2), 120); }
    if (t > B.end) this.finish();
  }
}
