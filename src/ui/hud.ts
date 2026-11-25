import * as THREE from 'three';
import type { HudApi } from '../app/context';
import { fmtTime } from '../app/context';

const el = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const POWER_ICON: Record<string, string> = { phase: '◇ PHASE', purge: '⌫ PURGE', shock: '⚡ SHOCK', boost: '» BOOST' };

/** Gameplay HUD. Reads a plain state object each frame; never owns game rules. Also renders a compact canvas version for VR. */
export class Hud implements HudApi {
  readonly root = el('div', 'hud'); mode: 'discs' | 'combat' | 'race' | null = null; data: Record<string, any> = {};
  private cache = new Map<string, string>(); private q: Record<string, HTMLElement> = {}; private toasts = el('div', 'hud-toasts'); private bannerEl = el('div', 'hud-banner'); private countEl = el('div', 'hud-count'); private subEl = el('div', 'hud-sub'); private flashEl = el('div', 'hud-flash'); private coachEl = el('div', 'hud-coach'); private coachText = '';
  /** Canvas HUD shared by the cockpit dash screen and the in-headset panel. */ readonly vrTexture: THREE.CanvasTexture; vrMode: 'belt' | 'dash' = 'belt';
  /** Aerial map (arena / track) as a texture for the in-headset side panel, and the seated head position it hangs beside. */ readonly mapTexture: THREE.CanvasTexture; vrSeat: { x: number; y: number; z: number } | null = null; private _mapPlace = 'left';
  /** Overhead map position: drives the headset panel and the desktop corner. */ get mapPlace() { return this._mapPlace; } set mapPlace(v: string) { this._mapPlace = v; this.root.dataset.map = v; }
  private radar = document.createElement('canvas'); private radarT = 0; private bannerTimer: any = 0; private subTimer: any = 0; subtitles = true; threatShapes = true;
  readonly vrCanvas = document.createElement('canvas'); private vrT = 0; private lastToast = ''; private lastToastT = 0; private bannerText = ''; private countText = '';

  constructor(parent: HTMLElement) {
    this.root.innerHTML = `
      <div class="hud-tl"><div class="hud-tier"><span data-q="tierNo"></span><b data-q="tierName"></b></div><div class="hud-obj"><span data-q="objLabel"></span><div class="pips" data-q="pips"></div></div><div class="hud-menuhint" data-q="menuHint"></div></div>
      <div class="hud-tc"><div class="boss" data-q="boss"><div class="boss-name"><b data-q="bossName"></b><span data-q="bossPhase"></span></div><div class="boss-bar"><i data-q="bossFill"></i></div></div>
        <div class="race-pos" data-q="racePos"><b data-q="pos"></b><span data-q="posOf"></span></div><div class="alert" data-q="alert"></div></div>
      <div class="hud-tr"><div class="score"><span data-q="scoreLabel">SCORE</span><b data-q="score">0</b></div><div class="combo" data-q="combo"></div><div class="laps" data-q="laps"></div></div>
      <div class="hud-bl"><div class="meter integrity"><label>INTEGRITY</label><div class="segs" data-q="hp"></div></div><div class="meter shield"><label data-q="shieldLabel">SHIELD</label><div class="bar"><i data-q="shield"></i></div></div><div class="ability" data-q="ability"></div></div>
      <div class="hud-bc"><div class="discs" data-q="discs"></div><div class="speedo" data-q="speedo"><b data-q="speed">0</b><span>KM/H</span><div class="bar boost"><i data-q="boost"></i></div><label data-q="boostLabel">BOOST</label></div></div>
      <div class="hud-br"><div class="radar"></div></div>
      <div class="hud-center"><svg class="reticle" viewBox="-40 -40 80 80" data-q="reticle"><circle r="15" class="r-ring"/><circle r="15" class="r-charge" data-q="charge" pathLength="100"/><circle r="1.6" class="r-dot"/><path d="M-26 0h-7M26 0h7M0 -26v-7M0 26v7" class="r-tick"/></svg><div class="threats" data-q="threats"></div><div class="hint" data-q="hint"></div></div>`;
    this.root.querySelectorAll<HTMLElement>('[data-q]').forEach((e) => (this.q[e.dataset.q!] = e));
    this.radar.width = this.radar.height = 320; this.root.querySelector('.radar')!.appendChild(this.radar); this.mapTexture = new THREE.CanvasTexture(this.radar); this.mapTexture.colorSpace = THREE.SRGBColorSpace; this.mapTexture.userData.shared = true;
    this.root.append(this.flashEl, this.toasts, this.bannerEl, this.countEl, this.subEl, this.coachEl); parent.appendChild(this.root);
    this.vrCanvas.width = 1024; this.vrCanvas.height = 512; this.vrTexture = new THREE.CanvasTexture(this.vrCanvas); this.vrTexture.colorSpace = THREE.SRGBColorSpace; this.vrTexture.userData.shared = true; this.show(null);
  }
  private set(k: string, v: string, attr?: string) { const key = k + (attr ?? ''); if (this.cache.get(key) === v) return; this.cache.set(key, v); const e = this.q[k]; if (!e) return; if (attr === 'html') e.innerHTML = v; else if (attr) e.setAttribute(attr, v); else e.textContent = v; }
  private style(k: string, prop: string, v: string) { const key = k + '|' + prop; if (this.cache.get(key) === v) return; this.cache.set(key, v); this.q[k]?.style.setProperty(prop, v); }

  show(mode: 'discs' | 'combat' | 'race' | null) { this.mode = mode; this.root.dataset.mode = mode ?? 'none'; this.root.style.display = mode ? '' : 'none'; this.cache.clear(); if (!mode) { this.toasts.innerHTML = ''; this.bannerEl.classList.remove('on'); this.count(null); this.coach(null); this.data = {}; this.vrSeat = null; } }

  update(d: Record<string, any>) {
    this.data = d; if (!this.mode) return; const tier = d.tier;
    this.set('tierNo', tier.endless ? 'ENDLESS ' + (tier.id - 1000) : 'TIER ' + String(tier.id).padStart(2, '0')); this.set('tierName', tier.endless ? tier.name.split('· ')[1] ?? '' : tier.name);
    this.set('score', String(d.score ?? 0).padStart(6, '0')); this.set('menuHint', this.menuHint);
    if (this.mode === 'discs') {
      const segs = 10, on = Math.ceil((Math.max(0, d.hp) / d.maxHp) * segs); let h = ''; for (let i = 0; i < segs; i++) h += `<i class="${i < on ? 'on' : ''}"></i>`; this.set('hp', h, 'html'); this.style('hp', '--low', on <= 3 ? '1' : '0');
      this.style('shield', 'width', Math.max(0, (d.shield / d.maxShield) * 100).toFixed(1) + '%'); this.set('shieldLabel', d.shieldLock ? 'SHIELD OFFLINE' : d.shieldUp ? 'SHIELD ▣ UP' : 'SHIELD'); this.set('shieldLabel', d.shieldLock ? 'lock' : d.shieldUp ? 'up' : '', 'data-s');
      this.set('discs', (d.discs as string[]).map((s) => `<i class="disc ${s}"><b></b></i>`).join(''), 'html');
      this.set('objLabel', d.wave ? `RIVALS · WAVE ${d.wave}` : 'RIVALS'); this.set('pips', '<i></i>'.repeat(Math.min(12, d.enemies)), 'html');
      this.set('combo', d.combo > 1 ? `×${Math.min(3, 1 + 0.25 * (d.combo - 1)).toFixed(2)} COMBO` : ''); this.set('laps', '');
      this.style('charge', 'stroke-dasharray', `${(d.charge * 100).toFixed(0)} 100`);
      this.set('hint', d.phase !== 'play' ? '' : d.interfere ? '⟂ TRANSFER JAMMED' : !d.locked ? 'CLICK TO AIM' : ''); this.set('alert', '');
      const th = (d.threats as any[]).slice(0, 5).map((t) => `<i class="${t.homing ? 'homing' : ''}" style="transform:rotate(${(-t.a * 57.2958).toFixed(0)}deg) translateY(-${118 - t.near * 30}px) scale(${(0.8 + t.near * 0.9).toFixed(2)})">${t.homing && this.threatShapes ? '◆' : '▲'}</i>`).join(''); this.set('threats', th, 'html');
      const b = d.boss; this.set('boss', b ? '1' : '0', 'data-on'); if (b) { this.set('bossName', b.name); this.set('bossPhase', `PHASE ${b.phase}/${b.phases} · ${b.phaseName}`); this.style('bossFill', 'width', (b.frac * 100).toFixed(1) + '%'); }
    } else {
      this.set('speed', String(Math.round(d.speed * 3.6)).padStart(3, '0')); this.style('boost', 'width', (d.boost * 100).toFixed(1) + '%'); this.set('boostLabel', d.boosting ? 'BOOST »»' : d.grind ? 'BOOST ▲ CHARGING' : d.draft ? 'SLIPSTREAM' : d.drift ? 'DRIFT ◢' : 'BOOST'); this.set('boostLabel', d.boosting ? 'on' : d.grind || d.draft || d.drift ? 'gain' : '', 'data-s');
      this.set('ability', d.power ? `<kbd>E</kbd> ${POWER_ICON[d.power] ?? d.power}` : d.pulse !== undefined ? `<kbd>${d.abilityKey ?? 'E'}</kbd> ${d.abilityName ?? 'PULSE'} ${d.wallOn > 0 ? '<b style="color:#4fe3ff">ACTIVE</b>' : d.pulse > 0 ? Math.ceil(d.pulse) + 's' : '<b style="color:#6dffb0">READY</b>'}${d.takedowns ? ` &nbsp;·&nbsp; TAKEDOWNS ${d.takedowns}` : ''}` : '', 'html');
      this.set('boss', '0', 'data-on'); this.set('threats', '', 'html'); this.set('hint', '');
      if (this.mode === 'combat') {
        this.set('objLabel', 'RIVALS'); this.set('pips', '<i></i>'.repeat(Math.min(12, d.rivals)), 'html'); this.set('combo', d.traps ? `TRAPS ×${d.traps}` : ''); this.set('laps', '');
        this.set('alert', d.wall < 18 ? `<b>${this.threatShapes ? '▲ ' : ''}WALL ${Math.round(d.wall)} m</b>` : d.shrinking ? '<b class="warn">◢ BOUNDARY CLOSING</b>' : '', 'html'); this.set('alert', d.wall < 7 ? 'crit' : d.wall < 18 ? 'warn' : '', 'data-s');
        this.set('racePos', '0', 'data-on');
      } else {
        this.set('racePos', '1', 'data-on'); this.set('pos', d.solo ? fmtTime(d.time) : 'P' + d.place); this.set('posOf', d.solo ? (d.par ? 'PAR ' + fmtTime(d.par) : '') : '/ ' + d.field);
        this.set('objLabel', d.format); this.set('pips', d.integrity !== undefined ? '<i class="sq"></i>'.repeat(Math.max(0, d.integrity)) : '', 'html');
        this.set('laps', `<b>${d.lapLabel}</b><span>${fmtTime(d.time)}</span>${d.best ? `<span class="dim">BEST ${fmtTime(d.best)}</span>` : ''}`, 'html'); this.set('combo', '');
        this.set('alert', d.elim !== undefined ? `<b>${this.threatShapes ? '✕ ' : ''}CUT IN ${Math.ceil(d.elim)}s${d.place === d.active ? ' — YOU ARE LAST' : ''}</b>` : d.storm ? '<b class="warn">≋ STORM CELL</b>' : d.gap ? `<b class="ok">TARGET ${d.gap} m</b>` : '', 'html'); this.set('alert', d.elim !== undefined && d.place === d.active ? 'crit' : 'warn', 'data-s');
      }
      this.radarT -= 1; if (this.radarT <= 0) { this.radarT = 3; this.drawRadar(typeof d.radar === 'function' ? d.radar() : d.radar); }
    }
  }

  /** Aerial map: fixed orientation (never rotates), every rider as a heading arrow in their trail colour. */
  private drawRadar(r: any) {
    const c = this.radar.getContext('2d')!, S = this.radar.width; c.clearRect(0, 0, S, S); this.mapTexture.needsUpdate = true; if (!r) return;
    c.fillStyle = 'rgba(3,7,12,0.86)'; c.fillRect(0, 0, S, S); c.strokeStyle = 'rgba(150,215,255,0.55)'; c.lineWidth = 2; c.strokeRect(1, 1, S - 2, S - 2);
    c.textBaseline = 'top'; c.textAlign = 'left'; c.fillStyle = '#8fa6bd'; c.font = '500 15px "Share Tech Mono", monospace'; c.fillText(r.kind === 'grid' ? 'ARENA · OVERHEAD' : 'TRACK · OVERHEAD', 10, 9);
    const arrow = (x: number, y: number, h: number, col: string, size: number, ring: boolean) => {
      const fx = Math.sin(h), fy = Math.cos(h), rx = fy, ry = -fx; c.beginPath(); c.moveTo(x + fx * size * 1.5, y + fy * size * 1.5); c.lineTo(x - fx * size + rx * size, y - fy * size + ry * size); c.lineTo(x - fx * size * 0.4, y - fy * size * 0.4); c.lineTo(x - fx * size - rx * size, y - fy * size - ry * size); c.closePath();
      c.fillStyle = col; c.fill(); if (ring) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); c.beginPath(); c.arc(x, y, size * 2.6, 0, 6.3); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.5; c.stroke(); }
    };
    c.save(); c.translate(S / 2, S / 2 + 10);
    if (r.kind === 'grid') {
      const k = (S / 2 - 26) / r.half0; c.fillStyle = 'rgba(79,227,255,0.05)'; c.fillRect(-r.half * k, -r.half * k, r.half * 2 * k, r.half * 2 * k); c.strokeStyle = 'rgba(160,220,255,0.75)'; c.lineWidth = 2; c.strokeRect(-r.half * k, -r.half * k, r.half * 2 * k, r.half * 2 * k);
      if (r.decks) for (const d of r.decks) { c.strokeStyle = 'rgba(255,220,140,0.85)'; c.lineWidth = 2; c.strokeRect((d.x - d.hx) * k, (d.z - d.hz) * k, d.hx * 2 * k, d.hz * 2 * k); }
      if (r.discs) for (const d of r.discs) { const sz = d.atMe ? 7 : 4; c.save(); c.translate(d.x * k, d.z * k); c.rotate(Math.PI / 4); c.fillStyle = d.mine ? '#9ff3ff' : Math.floor(performance.now() / 120) % 2 ? '#ffffff' : '#ff2a14'; c.fillRect(-sz / 2, -sz / 2, sz, sz); c.restore(); }
      c.fillStyle = 'rgba(160,220,255,0.3)'; for (const o of r.obstacles) { if (o.state === 'off') continue; c.globalAlpha = o.state === 'warn' ? 0.4 : 1; c.fillRect((o.x - o.hx) * k, (o.z - o.hz) * k, o.hx * 2 * k, o.hz * 2 * k); } c.globalAlpha = 1;
      for (const cy of r.cycles) { if (cy.gone) continue; c.strokeStyle = cy.color; c.lineWidth = cy.player ? 3 : 2; c.lineJoin = 'round'; c.beginPath(); const t = cy.trail; let pen = false; for (let i = 0; i < t.length; i += 2) { if (t[i] !== t[i]) { pen = false; continue; } if (pen) c.lineTo(t[i] * k, t[i + 1] * k); else { c.moveTo(t[i] * k, t[i + 1] * k); pen = true; } } if (pen && !cy.air) c.lineTo(cy.x * k, cy.z * k); c.stroke(); }
      for (const p of r.pickups) if (p.alive) { c.fillStyle = '#ffe14a'; c.save(); c.translate(p.x * k, p.z * k); c.rotate(0.785); c.fillRect(-3.5, -3.5, 7, 7); c.restore(); }
      for (const cy of r.cycles) if (cy.alive && !cy.player) arrow(cy.x * k, cy.z * k, cy.h ?? 0, cy.color, 5, false);
      for (const cy of r.cycles) if (cy.alive && cy.player) arrow(cy.x * k, cy.z * k, cy.h ?? 0, cy.color, 6, true);
    } else {
      const k = (S / 2 - 30) / r.extent; c.translate(-r.cx * k, -r.cz * k); c.lineJoin = 'round'; const p = r.pts;
      const path = () => { c.beginPath(); c.moveTo(p[0] * k, p[1] * k); for (let i = 2; i < p.length; i += 2) c.lineTo(p[i] * k, p[i + 1] * k); if (r.closed) c.closePath(); };
      path(); c.strokeStyle = 'rgba(79,227,255,0.22)'; c.lineWidth = 9; c.stroke(); path(); c.strokeStyle = 'rgba(190,235,255,0.9)'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#fff'; c.fillRect(p[0] * k - 1.5, p[1] * k - 8, 3, 16);
      for (const h of r.hazards) { c.fillStyle = '#ff4d5e'; c.fillRect(h.x * k - 2.5, h.z * k - 2.5, 5, 5); }
      // discs in flight: a hostile one aimed at the player is a large flashing red diamond, others small
      if (r.discs) for (const d of r.discs) { const s = d.atMe ? 7 : 4; c.save(); c.translate(d.x * k, d.z * k); c.rotate(Math.PI / 4); c.fillStyle = d.mine ? '#9ff3ff' : d.atMe && Math.floor(performance.now() / 120) % 2 ? '#ffffff' : '#ff2a14'; c.fillRect(-s / 2, -s / 2, s, s); c.restore(); }
      if (r.walls) { c.lineWidth = 3; c.lineCap = 'round'; for (const w of r.walls) { c.strokeStyle = w.color; c.beginPath(); c.moveTo(w.x0 * k, w.z0 * k); c.lineTo(w.x1 * k, w.z1 * k); c.stroke(); } }
      for (const q of r.racers) if (!q.out && !q.player) arrow(q.x * k, q.z * k, q.h ?? 0, q.color, 5, false);
      for (const q of r.racers) if (!q.out && q.player) arrow(q.x * k, q.z * k, q.h ?? 0, q.color, 6, true);
    }
    c.restore();
  }

  toast(text: string, kind = 'info') {
    this.lastToast = text; this.lastToastT = performance.now();
    const t = el('div', 'toast ' + kind); t.textContent = text; this.toasts.prepend(t); while (this.toasts.children.length > 4) this.toasts.lastChild!.remove(); setTimeout(() => t.classList.add('out'), 1300); setTimeout(() => t.remove(), 1750);
  }
  banner(title: string, sub = '', ms = 2600) { this.bannerText = title; this.bannerEl.innerHTML = `<b></b><span></span>`; this.bannerEl.children[0].textContent = title; this.bannerEl.children[1].textContent = sub; this.bannerEl.classList.add('on'); clearTimeout(this.bannerTimer); this.bannerTimer = setTimeout(() => { this.bannerEl.classList.remove('on'); this.bannerText = ''; }, ms); }
  count(text: string | null) { this.countText = text ?? ''; this.countEl.textContent = text ?? ''; this.countEl.classList.remove('pop'); if (text) { void this.countEl.offsetWidth; this.countEl.classList.add('pop'); } }
  flash(kind: 'hurt' | 'good' | 'warn') { this.flashEl.className = 'hud-flash'; void this.flashEl.offsetWidth; this.flashEl.className = 'hud-flash ' + kind; }
  subtitle(text: string) { if (!this.subtitles) return; this.subEl.textContent = '◈ ' + text; this.subEl.classList.add('on'); clearTimeout(this.subTimer); this.subTimer = setTimeout(() => this.subEl.classList.remove('on'), 2600); }

  /** Persistent coaching line (goal / controls) shown until the player has done the thing. */
  coach(text: string | null) { if (this.bannerText) text = null; /* a tip never sits on top of a banner */ if ((text ?? '') === this.coachText) return; this.coachText = text ?? ''; this.coachEl.textContent = this.coachText; this.coachEl.classList.toggle('on', !!text); }

  /**
   * Instrument-panel rendering of the HUD: shown on the cockpit dash screen and on the in-headset panel
   * (DOM overlays do not render inside a WebXR session). Redrawn at ~12 Hz.
   */
  drawVR(dt: number): boolean {
    this.root.classList.toggle('cockpit', this.vrMode === 'dash');
    this.vrT -= dt; if (this.vrT > 0) return false; this.vrT = 0.08;
    const c = this.vrCanvas.getContext('2d')!, W = 1024, H = 512, d = this.data; c.clearRect(0, 0, W, H); this.vrTexture.needsUpdate = true;
    c.fillStyle = 'rgba(3,7,12,0.94)'; c.fillRect(0, 0, W, H); if (!this.mode || !d.tier) return true;
    const F = (px: number, w = 600) => `${w} ${px}px "Saira Condensed", sans-serif`;
    c.textBaseline = 'top'; c.textAlign = 'left';
    const stat = (label: string, value: string, x: number, y: number, col = '#e8f4ff', size = 92) => { c.fillStyle = '#8fa6bd'; c.font = F(30, 500); c.fillText(label, x, y); c.fillStyle = col; c.font = F(size); c.fillText(value, x, y + 30); };
    const bar = (x: number, y: number, w: number, h: number, k: number, col: string) => { c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(x, y, w, h); c.fillStyle = col; c.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h); c.strokeStyle = 'rgba(150,215,255,0.45)'; c.lineWidth = 2; c.strokeRect(x, y, w, h); };
    // header: tier + headline message
    c.fillStyle = '#4fe3ff'; c.fillRect(0, 0, W, 6); c.fillStyle = '#8fa6bd'; c.font = F(28, 500); c.fillText((d.tier.endless ? 'ENDLESS ' + (d.tier.id - 1000) : 'TIER ' + String(d.tier.id).padStart(2, '0')) + ' · ' + String(d.tier.name).toUpperCase().slice(0, 26), 28, 20);
    const now = performance.now(), msg = this.countText || this.bannerText || (now - this.lastToastT < 1800 ? this.lastToast : '');
    let warn = '';
    if (this.mode === 'discs') {
      stat('INTEGRITY', String(Math.max(0, Math.round(d.hp))), 28, 76, d.hp < d.maxHp * 0.35 ? '#ff4d5e' : '#e8f4ff'); bar(28, 206, 300, 16, d.hp / d.maxHp, d.hp < d.maxHp * 0.35 ? '#ff4d5e' : '#4fe3ff');
      stat(d.shieldLock ? 'SHIELD OFFLINE' : 'SHIELD', String(Math.max(0, Math.round(d.shield))), 380, 76, d.shieldLock ? '#ff4d5e' : '#bfe9ff'); bar(380, 206, 260, 16, d.shield / d.maxShield, '#bfe9ff');
      stat('RIVALS', String(d.enemies), 700, 76, '#ffb62e');
      c.fillStyle = '#8fa6bd'; c.font = F(30, 500); c.fillText('DISCS', 28, 262);
      (d.discs as string[]).forEach((st, i) => { const x = 60 + i * 96, y = 350; c.lineWidth = 8; c.strokeStyle = st === 'held' ? '#4fe3ff' : st === 'returning' ? '#ffb62e' : '#53657a'; c.setLineDash(st === 'flying' ? [10, 8] : []); c.beginPath(); c.arc(x, y, 30, 0, 6.3); c.stroke(); c.setLineDash([]); if (st === 'held') { c.fillStyle = '#4fe3ff'; c.beginPath(); c.arc(x, y, 9, 0, 6.3); c.fill(); } });
      if (d.boss) { c.fillStyle = '#fff'; c.font = F(30); c.fillText(`${d.boss.name} · PHASE ${d.boss.phase}/${d.boss.phases}`, 380, 262); bar(380, 306, 600, 18, d.boss.frac, '#ff4d5e'); }
      if (d.interfere) warn = 'PLATFORM TRANSFER JAMMED';
    } else {
      stat('KM/H', String(Math.round(d.speed * 3.6)), 28, 76, '#e8f4ff', 130);
      c.fillStyle = d.boosting ? '#4fe3ff' : '#8fa6bd'; c.font = F(28, 500); c.fillText(d.boosting ? 'BOOST »»' : d.grind ? 'BOOST ▲ CHARGING' : d.draft ? 'SLIPSTREAM' : d.drift ? 'DRIFT' : 'BOOST', 28, 250); bar(28, 288, 330, 22, d.boost, '#4fe3ff');
      if (this.mode === 'combat') { stat('RIVALS', String(d.rivals), 400, 76, '#ffb62e'); stat('WALL AHEAD', d.wall < 60 ? Math.round(d.wall) + ' m' : 'CLEAR', 400, 232, d.wall < 12 ? '#ff4d5e' : d.wall < 28 ? '#ffb62e' : '#6dffb0', 64); if (d.wall < 28) warn = d.wall < 12 ? '▲ TURN NOW ▲' : '▲ WALL AHEAD — TURN'; else if (d.shrinking) warn = 'BOUNDARY CLOSING'; if (d.power) { c.fillStyle = '#ffb62e'; c.font = F(30); c.fillText('ABILITY: ' + String(d.power).toUpperCase(), 28, 330); } }
      else { stat(d.solo ? 'TIME' : 'PLACE', d.solo ? fmtTime(d.time) : `P${d.place}/${d.field}`, 400, 76, '#ffb62e', d.solo ? 64 : 92); stat(d.lapLabel.startsWith('LAP') ? 'LAP' : 'PROGRESS', d.lapLabel.replace('LAP ', ''), 400, 232, '#e8f4ff', 64); if (d.elim !== undefined) warn = `CUT IN ${Math.ceil(d.elim)}s${d.place === d.active ? ' — YOU ARE LAST' : ''}`; else if (d.storm) warn = 'STORM CELL'; if (d.integrity !== undefined) { c.fillStyle = '#4fe3ff'; c.font = F(30); c.fillText('INTEGRITY ' + '■ '.repeat(Math.max(0, d.integrity)), 28, 330); }
        // light wall: which button, and whether it is ready, laying or recharging
        if (d.wallMax) { const on = d.wallOn > 0, ready = !on && d.pulse <= 0, col = on ? (Math.floor(now / 140) % 2 ? '#ffffff' : '#4fe3ff') : ready ? '#6dffb0' : '#8fa6bd'; c.fillStyle = col; c.font = F(27, 600); c.fillText(`${d.abilityKey} · LIGHT WALL ${on ? 'ACTIVE' : ready ? 'READY' : Math.ceil(d.pulse) + 's'}${d.takedowns ? '   ✕' + d.takedowns : ''}`, 28, 324); bar(28, 362, 330, 14, on ? d.wallOn / d.wallLay : 1 - d.pulse / d.wallMax, on ? '#4fe3ff' : ready ? '#6dffb0' : '#53657a'); } }
      // light wall state, unmissable: a strobing frame and badge while laying, a green badge when ready
      if (this.mode === 'race' && d.wallMax) {
        const on = d.wallOn > 0, ready = !on && d.pulse <= 0, blink = Math.floor(now / 120) % 2 === 0;
        if (on) { c.strokeStyle = blink ? '#ffffff' : '#4fe3ff'; c.lineWidth = 16; c.strokeRect(8, 8, W - 16, H - 16); }
        if (on || ready) { c.fillStyle = on ? (blink ? '#4fe3ff' : '#ffffff') : 'rgba(42,255,138,0.18)'; c.fillRect(640, 14, 368, 50); if (!on) { c.strokeStyle = '#2aff8a'; c.lineWidth = 3; c.strokeRect(640, 14, 368, 50); }
          c.fillStyle = on ? '#03070c' : '#6dffb0'; c.font = F(38, 700); c.textAlign = 'center'; c.fillText(on ? '◼ LIGHT WALL ON' : `WALL READY · ${d.abilityKey}`, 824, 18); c.textAlign = 'left'; }
      }
      // radar / route map
      c.strokeStyle = 'rgba(150,215,255,0.45)'; c.lineWidth = 2; c.strokeRect(700, 70, 296, 296); c.drawImage(this.radar, 704, 74, 288, 288);
    }
    // footer: warning > message > coaching > subtitle
    const sub = this.subEl.classList.contains('on') ? this.subEl.textContent ?? '' : '';
    const line = warn || msg || this.coachText || sub; const hot = !!warn && (this.mode !== 'combat' || d.wall < 12 || Math.floor(now / 180) % 2 === 0);
    c.fillStyle = warn ? (hot ? '#ff4d5e' : '#3a0d12') : 'rgba(79,227,255,0.14)'; c.fillRect(0, 392, W, 78);
    c.textAlign = 'center'; c.fillStyle = '#fff'; c.font = F(line.length > 44 ? 34 : 46); c.fillText(line.slice(0, 64), W / 2, line.length > 44 ? 414 : 406);
    c.fillStyle = '#dbe9f6'; c.font = F(this.menuHint.length > 52 ? 25 : 30, 600); c.fillText(this.menuHint, W / 2, 474); c.textAlign = 'left';
    return true;
  }
  /** Small reminder of how to open the menu, set per input device. */ menuHint = '';
}
