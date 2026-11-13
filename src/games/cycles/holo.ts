import * as THREE from 'three';

/**
 * Holographic line-art for the cockpit's black-glass instruments (cockpit v3). Drawn to canvases and shown with
 * additive blending, so the graphics glow from under the glass and its reflections; unlit, so they read the same in
 * VR, where there is no bloom.
 */
const FONT = '"Share Tech Mono", monospace';
const css = (c: THREE.Color, a: number) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
function holoMat(tex: THREE.Texture) { return new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }); }

/** A round black-glass dial: a segmented light arc that fills with the value, fine tick fans and a digital readout. */
export class HoloGauge {
  readonly mesh: THREE.Mesh; private x: CanvasRenderingContext2D; private tex: THREE.CanvasTexture; private key = ''; private col: THREE.Color; private hot: THREE.Color;
  constructor(radius: number, color: THREE.ColorRepresentation, private label: string) {
    const c = document.createElement('canvas'); c.width = c.height = 256; this.x = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.col = new THREE.Color(color); this.hot = this.col.clone().lerp(new THREE.Color(1, 1, 1), 0.55);
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), holoMat(this.tex)); this.mesh.renderOrder = 4; this.mesh.frustumCulled = false;
    this.set(0, '000');
  }
  /** v: 0..1 fill; text: the digital readout. Redraws only when what is shown changes. */
  set(v: number, text: string) {
    const n = Math.round(Math.min(1, Math.max(0, v)) * 40), key = n + '|' + text; if (key === this.key) return; this.key = key;
    const x = this.x, C = 128, A0 = Math.PI * 0.75, SPAN = Math.PI * 1.5; x.clearRect(0, 0, 256, 256); x.lineCap = 'butt';
    const ring = (r: number, w: number, a: number, a0 = 0, a1 = Math.PI * 2) => { x.strokeStyle = css(this.col, a); x.lineWidth = w; x.beginPath(); x.arc(C, C, r, a0, a1); x.stroke(); };
    ring(122, 2, 0.55); ring(74, 3, 0.85); ring(64, 1.2, 0.4);
    // 40 light segments sweeping 270° clockwise from bottom-left; lit up to the value, the leading one hottest
    for (let i = 0; i < 40; i++) {
      const a = A0 + (SPAN * i) / 40, lit = i < n; x.strokeStyle = lit ? (i === n - 1 ? css(this.hot, 1) : css(this.col, 0.95)) : css(this.col, 0.13);
      x.lineWidth = 17; x.beginPath(); x.arc(C, C, 103, a + 0.012, a + SPAN / 40 - 0.03); x.stroke();
    }
    // fine tick fan inside the arc, brighter where lit
    for (let i = 0; i <= 80; i++) {
      const a = A0 + (SPAN * i) / 80, lit = i / 80 <= n / 40, r0 = i % 10 === 0 ? 80 : 85; x.strokeStyle = css(lit ? this.hot : this.col, lit ? 0.7 : 0.22); x.lineWidth = i % 10 === 0 ? 2 : 1;
      x.beginPath(); x.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0); x.lineTo(C + Math.cos(a) * 91, C + Math.sin(a) * 91); x.stroke();
    }
    // notches on the outer ring at the cardinal points
    for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2 - Math.PI / 2; x.strokeStyle = css(this.col, 0.8); x.lineWidth = 3; x.beginPath(); x.moveTo(C + Math.cos(a) * 115, C + Math.sin(a) * 115); x.lineTo(C + Math.cos(a) * 126, C + Math.sin(a) * 126); x.stroke(); }
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = css(this.hot, 1); x.font = `600 46px ${FONT}`; x.fillText(text, C, C - 4);
    x.fillStyle = css(this.col, 0.75); x.font = `500 15px ${FONT}`; x.fillText(this.label, C, C + 34);
    x.fillStyle = css(this.col, 0.6); x.fillRect(C - 26, C + 196 - 128, 52, 2);
    this.tex.needsUpdate = true;
  }
}

/** Static line-art frame floated over the live display: an inset octagon, corner marks, tick rails and status chips. */
export function holoFrame(color: THREE.ColorRepresentation) {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d')!, col = new THREE.Color(color), warm = new THREE.Color(0xffc23a), mag = new THREE.Color(0xd36bff);
  // the octagon here matches the glass (0.18 x 0.09 half-size, 0.035 chamfer) mapped onto the 0.185 x 0.1 quad
  const sx = W / 2 / 0.185, sy = H / 2 / 0.1, oct = (hw: number, hh: number, ch: number) => [[-hw + ch, -hh], [hw - ch, -hh], [hw, -hh + ch], [hw, hh - ch], [hw - ch, hh], [-hw + ch, hh], [-hw, hh - ch], [-hw, -hh + ch]].map(([u, v]) => [W / 2 + u * sx, H / 2 + v * sy]);
  const poly = (p: number[][], a: number, w: number, cc = col) => { x.strokeStyle = css(cc, a); x.lineWidth = w; x.beginPath(); p.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.closePath(); x.stroke(); };
  poly(oct(0.176, 0.086, 0.033), 0.95, 4); poly(oct(0.168, 0.078, 0.029), 0.35, 1.5);
  // a tick rail along the bottom edge, kept clear of the readout in the middle
  x.fillStyle = css(col, 0.5); for (let i = 0; i < 12; i++) { x.fillRect(150 + i * 14, H - 40, 6, 9); x.fillRect(W - 150 - 6 - i * 14, H - 40, 6, 9); }
  // small octagon marks on the side edges
  for (const [u, v] of [[40, H / 2], [W - 40, H / 2]]) poly([[u - 12, v - 5], [u - 5, v - 12], [u + 5, v - 12], [u + 12, v - 5], [u + 12, v + 5], [u + 5, v + 12], [u - 5, v + 12], [u - 12, v + 5]], 0.8, 2);
  // status chips in the lower chamfers: a warm slanted tab left and a violet one right
  const chip = (u: number, v: number, w: number, cc: THREE.Color) => { x.fillStyle = css(cc, 0.75); x.beginPath(); x.moveTo(u, v); x.lineTo(u + w, v); x.lineTo(u + w - 10, v + 12); x.lineTo(u - 10, v + 12); x.closePath(); x.fill(); };
  chip(150, H - 62, 70, warm); chip(W - 220, H - 62, 70, mag);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return holoMat(tex);
}
