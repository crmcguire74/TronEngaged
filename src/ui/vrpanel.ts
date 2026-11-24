import * as THREE from 'three';
import type { Engine } from '../engine/engine';
import type { XRManager } from '../engine/xr';
import type { Hud } from './hud';
import { itemValue, type Item, type Menu } from './menu';

const W = 1280, H = 960, PW = 1.7, PH = PW * (H / W);
/** Overhead-map positions relative to the seated head (rig space: -Z ahead, +X right), in metres. */
const MAP_OFFSET: Record<string, [number, number, number] | undefined> = { left: [-0.52, -0.2, -0.66], right: [0.52, -0.2, -0.66], 'far-left': [-0.82, -0.28, -0.3], 'far-right': [0.82, -0.28, -0.3], top: [0, 0.4, -0.95], off: undefined };
interface Rect { x: number; y: number; w: number; h: number; i: number }
/**
 * In-headset UI. DOM overlays do not render inside an immersive session, so menus are drawn to a canvas panel placed in
 * 3D space and operated by controller ray; the HUD is a small panel low in the comfortable field of view.
 */
export class VRPanels {
  private canvas = document.createElement('canvas'); private tex: THREE.CanvasTexture; private panel: THREE.Mesh; private dot: THREE.Mesh; private hudMesh: THREE.Mesh; private mapMesh: THREE.Mesh; private m4 = new THREE.Matrix4(); private hudYaw = 0; private hudPlaced = false;
  private rects: Rect[] = []; private dirty = true; private active = false; private ray = new THREE.Raycaster(); private placedFor: object | null = null; private scroll = 0; private o = new THREE.Vector3(); private d = new THREE.Vector3(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  constructor(private engine: Engine, private xr: XRManager, private menu: Menu, private hud: Hud) {
    this.canvas.width = W; this.canvas.height = H; this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.userData.shared = true;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, toneMapped: false })); this.panel.renderOrder = 9000; this.panel.visible = false; this.panel.userData.shared = true; engine.rig.add(this.panel);
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, toneMapped: false })); this.dot.renderOrder = 9001; this.dot.visible = false; this.panel.add(this.dot);
    // belt HUD: a low panel that trails the head's yaw with a lag, so it is glanceable but never in the line of sight
    this.hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: hud.vrTexture, transparent: true, toneMapped: false, opacity: 0.96 })); this.hudMesh.renderOrder = 8999; this.hudMesh.visible = false; this.hudMesh.userData.shared = true; engine.rig.add(this.hudMesh);
    // overhead map: hangs to the left of the rider, below the sight line, so it is a glance away and never in front
    this.mapMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: hud.mapTexture, transparent: true, toneMapped: false, opacity: 0.97, side: THREE.DoubleSide })); this.mapMesh.renderOrder = 8998; this.mapMesh.visible = false; this.mapMesh.userData.shared = true; engine.rig.add(this.mapMesh);
    const prev = menu.onChange; menu.onChange = () => { prev(); this.dirty = true; };
  }
  setActive(on: boolean) { this.active = on; this.dirty = true; this.placedFor = null; if (!on) { this.panel.visible = false; this.hudMesh.visible = false; this.mapMesh.visible = false; this.xr.showRays = false; } }

  update(dt: number, playing: boolean) {
    if (!this.active) return; const s = this.menu.screen;
    this.hudMesh.visible = playing && !s && this.hud.vrMode === 'belt';
    if (this.hudMesh.visible) {
      const rig = this.engine.rig, head = this.xr.headWorld(this.o), yaw = this.xr.headYaw(); let dy = yaw - this.hudYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      if (!this.hudPlaced) { this.hudYaw = yaw; this.hudPlaced = true; } else if (Math.abs(dy) > 0.5) this.hudYaw += dy * Math.min(1, dt * 3);
      this.d.set(head.x + Math.sin(this.hudYaw) * 0.78, head.y - 0.62, head.z + Math.cos(this.hudYaw) * 0.78); rig.worldToLocal(this.d); this.hudMesh.position.copy(this.d);
      this.hudMesh.quaternion.setFromEuler(this.e.set(-0.85, this.hudYaw + Math.PI, 0, 'YXZ')).premultiply(this.q.copy(rig.quaternion).invert());
    } else this.hudPlaced = false;
    const seat = this.hud.vrSeat, where = this.hud.mapPlace, mo = MAP_OFFSET[where]; this.mapMesh.visible = playing && !s && !!seat && !!mo && this.hud.mode !== 'discs';
    if (this.mapMesh.visible && seat && mo) { this.d.set(seat.x + mo[0], seat.y + mo[1], seat.z + mo[2]); this.mapMesh.position.copy(this.d); this.o.set(seat.x, seat.y, seat.z); this.mapMesh.quaternion.setFromRotationMatrix(this.m4.lookAt(this.o, this.d, THREE.Object3D.DEFAULT_UP)); }
    this.panel.visible = !!s; this.xr.showRays = !!s; if (!s) { this.placedFor = null; this.dot.visible = false; return; }
    if (this.placedFor !== s && this.placedFor === null) {
      // place the panel at arm's-length-plus in front of where the user is looking, at eye height, in rig space
      const rig = this.engine.rig, head = this.xr.headWorld(this.o), yaw = this.xr.headYaw(), D = 1.45;
      this.d.set(head.x + Math.sin(yaw) * D, head.y - 0.08, head.z + Math.cos(yaw) * D); rig.worldToLocal(this.d); this.panel.position.copy(this.d);
      this.panel.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw + Math.PI).premultiply(this.q.copy(rig.quaternion).invert());
    }
    this.placedFor = s;
    // while paused the footer shows live stick readings, so a drifting controller can be seen for what it is
    if (this.showInput) { this.inputT -= dt; if (this.inputT <= 0) { this.inputT = 0.2; this.dirty = true; } }
    if (this.dirty) { this.draw(); this.dirty = false; }
    // controller ray → focus and select
    let hit: THREE.Intersection | null = null, side: 'left' | 'right' = 'right';
    for (const sd of ['right', 'left'] as const) { const h = this.xr.hands[sd]; if (!h.source) continue; h.ray.getWorldPosition(this.o); h.ray.getWorldQuaternion(this.q); this.d.set(0, 0, -1).applyQuaternion(this.q); this.ray.set(this.o, this.d); const r = this.ray.intersectObject(this.panel, false)[0]; if (r && (!hit || r.distance < hit.distance)) { hit = r; side = sd; } }
    this.dot.visible = !!hit; if (!hit || !hit.uv) return;
    const px = hit.uv.x * W, py = (1 - hit.uv.y) * H; this.dot.position.set((hit.uv.x - 0.5) * PW, (hit.uv.y - 0.5) * PH, 0.002);
    const r = this.rects.find((k) => px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h);
    if (r && r.i >= 0 && r.i !== this.menu.focus) { this.menu.setFocus(r.i); this.xr.pulse(side, 0.2, 15); }
    if (this.xr.uiTriggerEdge && r) {
      this.xr.pulse(side, 0.6, 30);
      if (r.i === -1) this.menu.back(); else if (r.i === -2) { this.scroll = Math.max(0, this.scroll - 5); this.dirty = true; } else if (r.i === -3) { this.scroll += 5; this.dirty = true; }
      else { const it = this.menu.all[r.i]; const adj = it && (it.kind === 'slider' || it.kind === 'choice'); this.menu.activate(r.i, adj ? (px > r.x + r.w * 0.78 ? 1 : px > r.x + r.w * 0.5 ? -1 : 1) : 0); }
    }
  }

  private draw() {
    const c = this.canvas.getContext('2d')!, m = this.menu, s = m.screen; this.rects = []; c.clearRect(0, 0, W, H); if (!s) { this.tex.needsUpdate = true; return; }
    c.fillStyle = 'rgba(4,8,14,0.94)'; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(150,215,255,0.45)'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, W - 3, H - 3);
    c.textBaseline = 'top'; c.textAlign = 'left';
    if (s.layout === 'home') { this.home(c, s); this.tex.needsUpdate = true; return; }
    c.fillStyle = '#4fe3ff'; c.font = '28px "Share Tech Mono", monospace'; c.fillText(s.kicker.toUpperCase(), 48, 34);
    let y = 76; if (s.head) { c.fillStyle = s.head.cls === 'win' ? '#fff' : '#ffb9c0'; c.font = '700 54px "Syncopate", sans-serif'; c.fillText(s.head.text, 48, y); y += 70; }
    c.fillStyle = '#e8f4ff'; c.font = '700 44px "Syncopate", sans-serif'; c.fillText(s.title.toUpperCase().slice(0, 30), 48, y); y += 62;
    if (s.text) { c.fillStyle = '#8fa6bd'; c.font = '500 30px "Saira Condensed", sans-serif'; y = this.wrap(c, s.text, 48, y, W - 96, 36, 2) + 10; }
    for (const u of s.unlocks ?? []) { c.fillStyle = '#ffb62e'; c.font = '600 28px "Saira Condensed", sans-serif'; c.fillText('◈ ' + u, 48, y); y += 34; }
    const all = m.all, nList = s.items.length, top = y + 8, bottom = H - 96; let idx = 0, yy = top;
    const rowH = 66, visible = Math.floor((bottom - top) / rowH); const maxScroll = Math.max(0, nList - visible); if (m.focus < nList) { if (m.focus < this.scroll) this.scroll = m.focus; if (m.focus >= this.scroll + visible) this.scroll = m.focus - visible + 1; } this.scroll = Math.min(this.scroll, maxScroll);
    const tiles = s.tiles ?? []; const listRows = tiles.length ? Math.min(nList, 1) : visible;
    for (let i = this.scroll; i < nList && idx < listRows; i++, idx++) { this.row(c, all[i], i, 48, yy, W - 96, rowH - 8, i === m.focus); yy += rowH; }
    if (tiles.length) { const cols = 8, tw = (W - 96 - (cols - 1) * 10) / cols, th = 96; tiles.forEach((t, k) => { const i = nList + k, x = 48 + (k % cols) * (tw + 10), ty = yy + 6 + Math.floor(k / cols) * (th + 10); if (ty + th > bottom + 60) return; this.tile(c, t, i, x, ty, tw, th, i === m.focus); }); m.gridCols = cols; }
    // footer controls
    const fy = H - 78; if (!s.noBack && (m.stack.length > 1 || s.back)) this.button(c, '‹ BACK', 48, fy, 220, 56, -1);
    if (!tiles.length && maxScroll > 0) { this.button(c, '▲', W - 48 - 250, fy, 120, 56, -2); this.button(c, '▼', W - 48 - 120, fy, 120, 56, -3); }
    if (this.showInput && !this.message) { const k = this.xr.sticks, f = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2); c.fillStyle = '#53657a'; c.font = '22px "Share Tech Mono", monospace'; c.textAlign = 'center'; c.fillText(`STICKS  L ${f(k.lx)} ${f(k.ly)}   R ${f(k.rx)} ${f(k.ry)}`, W / 2, H - 26); c.textAlign = 'left'; }
    if (this.message) { c.fillStyle = '#ffb62e'; c.font = '24px "Share Tech Mono", monospace'; c.textAlign = 'center'; c.fillText(this.message.slice(0, 84), W / 2, H - 26); c.textAlign = 'left'; }
    this.tex.needsUpdate = true;
  }
  /** Home screen: the same two game cards and link row as the desktop menu. */
  private home(c: CanvasRenderingContext2D, s: NonNullable<Menu['screen']>) {
    const m = this.menu, all = m.all; c.fillStyle = '#f4fbff'; c.font = '700 60px "Syncopate", sans-serif'; c.fillText('TRON', 48, 44); const w = c.measureText('TRON ').width; c.fillStyle = '#4fe3ff'; c.fillText('ENGAGED', 48 + w, 44);
    c.fillStyle = '#8fa6bd'; c.font = '26px "Share Tech Mono", monospace'; c.fillText('CHOOSE A GAME  ·  POINT AND PULL THE TRIGGER', 48, 126);
    const cards = all.filter((x) => x.kind === 'button' && x.card), cw = (W - 96 - 28) / 2, ch = 470, cy = 190;
    all.forEach((it, i) => {
      if (it.kind !== 'button') return; const focus = i === m.focus;
      if (it.card) {
        const k = cards.indexOf(it), x = 48 + k * (cw + 28), cd = it.card;
        c.fillStyle = focus ? 'rgba(79,227,255,0.16)' : 'rgba(150,215,255,0.05)'; c.fillRect(x, cy, cw, ch); c.strokeStyle = focus ? '#4fe3ff' : 'rgba(150,215,255,0.35)'; c.lineWidth = focus ? 4 : 2; c.strokeRect(x, cy, cw, ch);
        // glyph
        c.strokeStyle = focus ? '#4fe3ff' : '#8fa6bd'; c.lineWidth = 3; const gx = x + 70, gy = cy + 76;
        if (cd.glyph === 'disc') { for (const r of [38, 24]) { c.beginPath(); c.arc(gx, gy, r, 0, 6.3); c.stroke(); } c.fillStyle = c.strokeStyle; c.beginPath(); c.arc(gx, gy, 7, 0, 6.3); c.fill(); }
        else { for (const dx of [-26, 26]) { c.beginPath(); c.arc(gx + dx, gy + 14, 15, 0, 6.3); c.stroke(); } c.beginPath(); c.moveTo(gx - 26, gy + 14); c.lineTo(gx - 8, gy - 16); c.lineTo(gx + 16, gy - 16); c.lineTo(gx + 26, gy + 14); c.stroke(); }
        c.textAlign = 'right'; c.fillStyle = '#8fa6bd'; c.font = '26px "Share Tech Mono", monospace'; c.fillText(`${cd.done} / ${cd.total}`, x + cw - 30, cy + 34); c.textAlign = 'left';
        c.fillStyle = '#fff'; c.font = '700 44px "Syncopate", sans-serif'; c.fillText(it.label.toUpperCase(), x + 30, cy + 150);
        c.fillStyle = '#8fa6bd'; c.font = '500 30px "Saira Condensed", sans-serif'; this.wrap(c, it.sub ?? '', x + 30, cy + 212, cw - 60, 36, 2);
        c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x + 30, cy + 340, cw - 60, 5); c.fillStyle = '#4fe3ff'; c.fillRect(x + 30, cy + 340, Math.max(6, (cw - 60) * (cd.done / cd.total)), 5);
        c.fillStyle = '#e8f4ff'; c.font = '500 30px "Saira Condensed", sans-serif'; c.fillText(cd.next.slice(0, 30), x + 30, cy + 368);
        this.rects.push({ x, y: cy, w: cw, h: ch, i });
      }
    });
    const links = all.map((it, i) => ({ it, i })).filter((q) => q.it.kind === 'button' && !q.it.card), lw = (W - 96 - (links.length - 1) * 16) / links.length, ly = cy + ch + 40;
    for (const [k, q] of links.entries()) { const x = 48 + k * (lw + 16), focus = q.i === m.focus, it = q.it as any; c.fillStyle = focus ? 'rgba(79,227,255,0.2)' : 'rgba(150,215,255,0.06)'; c.fillRect(x, ly, lw, 84); c.strokeStyle = focus ? '#4fe3ff' : 'rgba(150,215,255,0.3)'; c.lineWidth = 2; c.strokeRect(x, ly, lw, 84); c.fillStyle = focus ? '#fff' : '#c9d8e6'; c.font = '500 32px "Saira Condensed", sans-serif'; c.textAlign = 'center'; c.fillText(String(it.label).toUpperCase(), x + lw / 2, ly + 24); c.textAlign = 'left'; this.rects.push({ x, y: ly, w: lw, h: 84, i: q.i }); }
    if (this.message) { c.fillStyle = '#ffb62e'; c.font = '24px "Share Tech Mono", monospace'; c.textAlign = 'center'; c.fillText(this.message.slice(0, 84), W / 2, H - 40); c.textAlign = 'left'; }
  }
  /** Shown at the foot of the panel: runtime errors are otherwise invisible inside a headset. */
  message = ''; setMessage(m: string) { this.message = m; this.dirty = true; }
  /** Set while a game is paused. */ showInput = false; private inputT = 0;
  private wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number, max: number) { const words = text.split(' '); let line = '', n = 0; for (const wd of words) { if (c.measureText(line + wd).width > w && line) { c.fillText(line, x, y); y += lh; line = ''; if (++n >= max) return y; } line += wd + ' '; } if (line) { c.fillText(line, x, y); y += lh; } return y; }
  private button(c: CanvasRenderingContext2D, label: string, x: number, y: number, w: number, h: number, i: number) { c.strokeStyle = 'rgba(150,215,255,0.6)'; c.lineWidth = 2; c.strokeRect(x, y, w, h); c.fillStyle = '#e8f4ff'; c.font = '600 30px "Saira Condensed", sans-serif'; c.textAlign = 'center'; c.fillText(label, x + w / 2, y + 12); c.textAlign = 'left'; this.rects.push({ x, y, w, h, i }); }
  private row(c: CanvasRenderingContext2D, it: Item, i: number, x: number, y: number, w: number, h: number, focus: boolean) {
    if (it.kind === 'title') { c.fillStyle = '#8fa6bd'; c.font = '24px "Share Tech Mono", monospace'; c.fillText(it.label.toUpperCase().slice(0, 70), x, y + 18); return; }
    if (it.kind === 'row') { c.fillStyle = '#8fa6bd'; c.font = '500 30px "Saira Condensed", sans-serif'; c.fillText(it.label.slice(0, it.value.length > 34 ? 22 : 44), x + 12, y + 10); c.fillStyle = it.total ? '#4fe3ff' : '#e8f4ff'; if (it.value.length > 34) { c.font = '500 25px "Saira Condensed", sans-serif'; this.wrap(c, it.value, x + w * 0.36, y + 1, w * 0.64 - 12, 27, 2); } else { c.textAlign = 'right'; c.font = '600 32px "Saira Condensed", sans-serif'; c.fillText(it.value, x + w - 12, y + 8); c.textAlign = 'left'; } c.fillStyle = 'rgba(150,215,255,0.2)'; c.fillRect(x, y + h, w, 1); return; }
    const dis = it.kind === 'button' && it.disabled; c.globalAlpha = dis ? 0.4 : 1;
    c.fillStyle = focus ? 'rgba(79,227,255,0.2)' : 'rgba(150,215,255,0.05)'; c.fillRect(x, y, w, h); if (focus) { c.strokeStyle = '#4fe3ff'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2); }
    c.fillStyle = '#e8f4ff'; c.font = '500 36px "Saira Condensed", sans-serif'; const label = 'label' in it ? it.label.toUpperCase() : ''; c.fillText(label.slice(0, 34), x + 26, y + 8);
    c.textAlign = 'right';
    if (it.kind === 'button') { if (it.tag) { c.fillStyle = '#ffb62e'; c.font = '26px "Share Tech Mono", monospace'; c.fillText(it.tag, x + w - 20, y + 16); } else if (it.sub) { c.fillStyle = '#8fa6bd'; c.font = '26px "Saira Condensed", sans-serif'; c.fillText(it.sub.slice(0, 44), x + w - 20, y + 15); } }
    else { c.fillStyle = '#4fe3ff'; c.font = '600 34px "Saira Condensed", sans-serif'; const adj = it.kind === 'slider' || it.kind === 'choice'; c.fillText((adj ? '‹   ' : '') + itemValue(it).toUpperCase() + (adj ? '   ›' : ''), x + w - 20, y + 10); }
    c.textAlign = 'left'; c.globalAlpha = 1; this.rects.push({ x, y, w, h, i });
  }
  private tile(c: CanvasRenderingContext2D, it: Item, i: number, x: number, y: number, w: number, h: number, focus: boolean) {
    if (it.kind !== 'tile') return; c.globalAlpha = it.state === 'locked' ? 0.35 : 1; c.fillStyle = focus ? 'rgba(79,227,255,0.25)' : 'rgba(150,215,255,0.07)'; c.fillRect(x, y, w, h); c.strokeStyle = focus ? '#4fe3ff' : it.boss ? 'rgba(255,77,94,0.7)' : 'rgba(150,215,255,0.3)'; c.lineWidth = 2; c.strokeRect(x, y, w, h);
    c.fillStyle = it.state === 'done' ? '#6dffb0' : it.boss ? '#ff4d5e' : '#8fa6bd'; c.font = '34px "Share Tech Mono", monospace'; c.fillText(it.no, x + 10, y + 8); c.fillStyle = '#8fa6bd'; c.font = '24px "Share Tech Mono", monospace'; c.textAlign = 'right'; c.fillText(it.icon ?? '', x + w - 10, y + 10); c.textAlign = 'left';
    c.fillStyle = '#e8f4ff'; c.font = '22px "Saira Condensed", sans-serif'; c.fillText(it.label.toUpperCase().slice(0, 15), x + 10, y + 54); c.globalAlpha = 1; this.rects.push({ x, y, w, h, i });
  }
}
