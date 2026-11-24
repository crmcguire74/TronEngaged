import * as THREE from 'three';
import { Rng } from './math';

export const TONE = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';
export interface Theme { label: string; top: number; horizon: number; accent: number; accent2: number; fog: number; fogDensity: number; pano: number; line: number; floor: number }
const T = (label: string, top: number, horizon: number, accent: number, accent2: number, fog: number, fogDensity: number, pano: number, line = accent, floor = 0x05070c): Theme => ({ label, top, horizon, accent, accent2, fog, fogDensity, pano, line, floor });

/** Environment looks. Player ion-cyan is reserved for the player in every theme; rivals read warm. */
export const THEMES: Record<string, Theme> = {
  'classic-stadium': T('Classic Stadium', 0x020409, 0x0a1a2a, 0x4fe3ff, 0xff8a3c, 0x03060c, 0.006, 0.9),
  'vertical-chamber': T('Vertical Chamber', 0x03030a, 0x141433, 0x8fa8ff, 0xffb62e, 0x04040c, 0.007, 0.55),
  'data-core': T('Data Core', 0x02070a, 0x06302f, 0x3dffd0, 0xff5a8a, 0x020a0b, 0.008, 0.4),
  'fractured-lattice': T('Fractured Lattice', 0x05030a, 0x24103a, 0xb57bff, 0xffd166, 0x07040d, 0.008, 0.35),
  'corruption-zone': T('Corruption Zone', 0x090203, 0x3a0d0d, 0xff4d3d, 0xffc04d, 0x0c0303, 0.01, 0.3),
  'grand-colosseum': T('Grand Colosseum', 0x040407, 0x2a2416, 0xffe3a6, 0x4fe3ff, 0x060608, 0.005, 0.8),
  'null-sector': T('Null Sector', 0x010203, 0x0b1c2e, 0x7fe9ff, 0xff6a1f, 0x010305, 0.0075, 0.45),
  'classic-grid': T('Classic Grid', 0x010308, 0x07182c, 0x4fe3ff, 0xff8a3c, 0x02050b, 0.0035, 0),
  'neon-circuit': T('Neon Circuit', 0x020209, 0x1a0f3a, 0x7c9cff, 0xff5fd2, 0x04030d, 0.0028, 0),
  skyway: T('Skyway', 0x02040c, 0x12305a, 0x7fe9ff, 0xffd166, 0x050a16, 0.0022, 0),
  'data-tunnel': T('Data Tunnel', 0x010506, 0x063a36, 0x3dffd0, 0xc8ff5a, 0x020908, 0.0045, 0),
  metropolis: T('Digital Metropolis', 0x030208, 0x2a1436, 0xff7ae0, 0x5ad1ff, 0x06030b, 0.003, 0),
  championship: T('Championship Stadium', 0x030305, 0x2b2413, 0xffe3a6, 0x4fe3ff, 0x060607, 0.0026, 0),
  'core-reactor': T('Core Reactor', 0x050302, 0x3a1c06, 0xffa53d, 0x5af0ff, 0x0b0603, 0.0036, 0),
  'red-sector': T('Red Sector', 0x070102, 0x400a10, 0xff3b4e, 0xffd9a0, 0x0c0204, 0.0034, 0),
  'fractured-grid': T('Fractured Grid', 0x040209, 0x211040, 0xb57bff, 0x5affc8, 0x06030c, 0.0036, 0),
  'infinite-grid': T('Infinite Grid', 0x000205, 0x04121e, 0xdff6ff, 0x4fe3ff, 0x01040a, 0.002, 0),
  'outlands': T('The Outlands', 0x030206, 0x1d0a24, 0xff6a1f, 0x5af0ff, 0x05030a, 0.004, 0),
};
export const theme = (id: string) => THEMES[id] ?? THEMES['classic-grid'];

/** Procedural sky dome: gradient, stars, horizon glow, far skyline silhouettes, with an optional equirect panorama blend. */
export interface PanoBand { /** elevation (degrees) of the image's bottom and top edge */ lo: number; hi: number; gain?: number; mix?: number; /** rotates the band about the vertical axis (turns) */ turn?: number; /** true: the picture is a full 360° × 180° equirectangular image, not a band */ full?: boolean; /** 0..1: recolour the picture toward the theme accent */ tint?: number }
export function skyDome(th: Theme, pano?: THREE.Texture, radius = 1500, band?: PanoBand): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(th.top) }, uHor: { value: new THREE.Color(th.horizon) }, uAcc: { value: new THREE.Color(th.accent) }, uAcc2: { value: new THREE.Color(th.accent2) }, uPano: { value: pano ?? null }, uMix: { value: pano ? band?.mix ?? th.pano : 0 }, uTime: { value: 0 }, uDim: { value: 1 }, uBand: { value: new THREE.Vector4(band ? THREE.MathUtils.degToRad(band.lo) : 0, band ? THREE.MathUtils.degToRad(band.hi) : 0, band && !band.full ? 1 : 0, band?.gain ?? 0.8) }, uTurn: { value: band?.turn ?? 0 }, uTint: { value: band?.tint ?? 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w * 0.9999; }',
    fragmentShader: `
      uniform vec3 uTop, uHor, uAcc, uAcc2; uniform sampler2D uPano; uniform float uMix, uTime, uDim, uTurn, uTint; uniform vec4 uBand; varying vec3 vD;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main(){
        vec3 d = normalize(vD); float h = d.y; float a = atan(d.z, d.x);
        vec3 col = mix(uHor, uTop, smoothstep(-0.02, 0.55, h));
        col = mix(col, uTop * 0.4, smoothstep(0.0, -0.35, h));
        // stars
        vec2 sp = vec2(a * 90.0, h * 140.0); vec2 cell = floor(sp); float st = h21(cell); vec2 so = fract(sp) - 0.5 - (vec2(h21(cell + 3.1), h21(cell + 7.7)) - 0.5) * 0.6;
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + st * 3.0) + st * 40.0);
        col += vec3(0.8, 0.9, 1.0) * step(0.965, st) * smoothstep(0.11, 0.0, length(so)) * smoothstep(0.1, 0.4, h) * tw * 0.9;
        // horizon glow
        col += uAcc * exp(-abs(h) * 22.0) * 0.5 + uAcc2 * exp(-abs(h - 0.02) * 60.0) * 0.18;
        // distant skyline
        float seg = floor(a * 46.0); float bh = (0.02 + 0.11 * pow(h21(vec2(seg, 3.0)), 2.2)) * (0.6 + 0.4 * h21(vec2(floor(a * 7.0), 9.0)));
        if (h < bh && h > -0.02 && uBand.z < 0.5) {
          vec2 w = vec2(fract(a * 46.0) * 6.0, h * 420.0); float lit = step(0.72, h21(floor(w) + seg)) * step(0.2, fract(w.x)) * step(0.3, fract(w.y));
          vec3 b = uTop * 0.35 + uAcc * lit * 0.55 + uAcc2 * step(0.985, h21(floor(w) + seg * 1.7)) * 0.9;
          b += uAcc * smoothstep(bh - 0.004, bh, h) * 0.5;
          col = mix(col, b, 0.92);
        }
        if (uBand.z > 0.5) {
          // city band: the picture spans half the horizon and is mirrored across the other half, so it never shows a seam
          float el = asin(clamp(h, -1.0, 1.0)), v = (el - uBand.x) / (uBand.y - uBand.x), u = 1.0 - abs(2.0 * fract(a / 6.2831853 + 0.5 + uTurn) - 1.0);
          float w = smoothstep(0.0, 0.1, v) * smoothstep(1.0, 0.8, v) * uMix;
          vec3 p = texture2D(uPano, vec2(u, clamp(v, 0.0, 1.0))).rgb; p = pow(p, vec3(1.25)); p = mix(p, dot(p, vec3(0.3, 0.5, 0.2)) * 1.5 * (uAcc + 0.08), uTint) * uBand.w;
          col = mix(col, p, w);
        } else if (uMix > 0.001) { vec2 uv = vec2(1.0 - (a / 6.2831853 + 0.5), asin(clamp(h, -1.0, 1.0)) / 3.14159265 + 0.5); vec3 p = texture2D(uPano, uv).rgb; p = pow(p, vec3(1.5)) * 0.42 * (0.55 + 0.45 * smoothstep(0.55, -0.1, h)); col = mix(col, p * mix(vec3(1.0), uAcc * 1.6 + 0.25, 0.35), uMix); }
        gl_FragColor = vec4(col * uDim, 1.0); ${TONE}
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat); m.frustumCulled = false; m.renderOrder = -100; m.name = 'sky';
  m.onBeforeRender = (_r, _s, cam) => { m.position.setFromMatrixPosition(cam.matrixWorld); m.updateMatrixWorld(); };
  return m;
}

/**
 * A sky built from a picture the owner supplied for this environment, if there is one. `<env>` is a true 360° × 180°
 * image; `<env>-band` is any wide skyline picture, wrapped round the horizon and mirrored so it has no seam.
 */
export function suppliedSky(th: Theme, assets: { envPano(env: string): string | null; texture(path: string): THREE.Texture }, env: string): THREE.Mesh | null {
  const full = assets.envPano(env); if (full) return skyDome(th, assets.texture(full), 1500, { lo: 0, hi: 0, full: true, mix: env === 'menu' ? 1 : 0.9 });
  const band = assets.envPano(env + '-band'); return band ? skyDome(th, assets.texture(band), 1500, { lo: -28, hi: 42, gain: env === 'menu' ? 0.95 : 0.7, mix: 0.95 }) : null;
}

/** Glossy dark floor with anti-aliased grid lines, distance fade and a travelling scan pulse. */
export function gridFloor(size: number, th: Theme, cell = 4, opts: { fade?: number; glow?: number; offset?: number } = {}): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOffset: { value: opts.offset ?? 0 }, uReveal: { value: 1e6 }, uOrigin: { value: new THREE.Vector2() }, uLine: { value: new THREE.Color(th.line) }, uBase: { value: new THREE.Color(th.floor) }, uCell: { value: cell }, uFade: { value: opts.fade ?? size * 0.5 }, uTime: { value: 0 }, uGlow: { value: opts.glow ?? 1 }, uHalf: { value: size / 2 }, uPulse: { value: new THREE.Vector4(0, 0, -10, 0) } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform vec3 uLine, uBase; uniform float uCell, uFade, uTime, uGlow, uHalf, uOffset, uReveal; uniform vec2 uOrigin; uniform vec4 uPulse; varying vec3 vW;
      // anti-aliased lines that fade out (rather than smear into a haze) once a cell is smaller than a few pixels
      float grid(vec2 p, float c, float w){ vec2 g = abs(fract(p / c - 0.5) - 0.5) * c; vec2 fw = fwidth(p) * 1.2; vec2 l = 1.0 - smoothstep(vec2(w), vec2(w) + fw, g); l *= 1.0 - smoothstep(c * 0.12, c * 0.45, fw); return max(l.x, l.y); }
      void main(){
        vec2 p = vW.xz; float dist = length(p - cameraPosition.xz);
        // uOffset shifts the lattice so a rider starting on the centre line is not sitting on a bright line
        float minor = grid(p + uOffset, uCell, 0.03);
        float major = grid(p + uOffset, uCell * 5.0, 0.05);
        // radial reveal with a bright travelling wavefront (splash)
        float rl = length(p - uOrigin); float shown = 1.0 - smoothstep(uReveal - 14.0, uReveal, rl); float front = exp(-abs(rl - uReveal) * 0.12) * step(uReveal, 9.0e5) * smoothstep(0.0, 6.0, uReveal);
        float fade = 1.0 - smoothstep(uFade * 0.5, uFade, dist);
        float scan = smoothstep(0.985, 1.0, sin(length(p) * 0.045 - uTime * 0.9) * 0.5 + 0.5);
        float edge = smoothstep(uHalf - 3.0, uHalf, max(abs(p.x), abs(p.y)));
        float pr = length(p - uPulse.xy); float pulse = uPulse.w * exp(-abs(pr - uPulse.z) * 0.6);
        vec3 col = uBase + uLine * ((minor * 0.2 + major * 0.5 + scan * 0.05) * shown + pulse * 0.8 + front * (0.35 + minor + major)) * uGlow * fade;
        col += uLine * edge * 0.6 * shown;
        // cheap sheen so the floor reads glossy without a reflection pass
        vec3 v = normalize(cameraPosition - vW); float fr = pow(1.0 - max(v.y, 0.0), 5.0); col += uLine * fr * 0.06 * fade;
        gl_FragColor = vec4(col, 1.0); ${TONE}
        #include <fog_fragment>
      }`.replace('#include <fog_fragment>', ''),
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat); m.rotation.x = -Math.PI / 2; m.name = 'floor';
  return m;
}

/** Translucent hardlight surface (arena walls, barriers, rails): rim-bright, scan-lined, additive. */
export function hardlight(color: number, opacity = 0.5, scan = 6, rim = 0.06, opts: { radial?: boolean; body?: number } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uTime: { value: 0 }, uScan: { value: scan }, uFlash: { value: 0 }, uRim: { value: rim }, uRadial: { value: opts.radial ? 1 : 0 }, uBody: { value: opts.body ?? 0.045 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uTime, uScan, uFlash, uRim, uRadial, uBody; varying vec2 vUv;
      void main(){ float ex = min(vUv.x, 1.0 - vUv.x), ey = min(vUv.y, 1.0 - vUv.y); float e = mix(min(ex, ey), (1.0 - length(vUv - 0.5) * 2.0) * 0.5, uRadial); float rim = 1.0 - smoothstep(0.0, uRim, e);
        float top = smoothstep(1.0 - uRim * 3.0, 1.0, vUv.y) * (1.0 - uRadial); float sc = 0.5 + 0.5 * sin(vUv.y * uScan * 40.0 - uTime * 3.0);
        float a = (uBody + 0.035 * sc + rim * 0.85 + top * 0.3) * uOpacity + uFlash;
        gl_FragColor = vec4(uColor * (0.8 + rim * 1.6 + top * 0.8 + uFlash * 3.0), a); ${TONE} }`,
  });
}

/**
 * Arena boundary: a tall lattice barrier that reads as a solid wall with or without bloom (VR has none).
 * `uDanger` heats it toward white-red as a rider closes on it.
 */
export function boundaryWall(color: number, width: number, height: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uSize: { value: new THREE.Vector2(width, height) }, uTime: { value: 0 }, uDanger: { value: 0 }, uFlash: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform vec2 uSize; uniform float uTime, uDanger, uFlash; varying vec2 vUv;
      void main(){ vec2 m = vUv * uSize; float y = m.y; vec2 fw = fwidth(m) * 1.3;
        float post = 1.0 - smoothstep(0.07, 0.07 + fw.x, abs(fract(m.x / 4.0 + 0.5) - 0.5) * 4.0);
        float band = 1.0 - smoothstep(0.05, 0.05 + fw.y, abs(fract(y / 2.0 + 0.5) - 0.5) * 2.0);
        float lattice = max(post, band) * (1.0 - smoothstep(4.0, 9.0, fw.x));
        float base = 1.0 - smoothstep(0.0, 0.5, y); float top = smoothstep(uSize.y - 0.35, uSize.y - 0.1, y);
        float body = 0.34 * (1.0 - smoothstep(0.0, uSize.y, y) * 0.55) + 0.05 * sin(y * 5.0 - uTime * 2.0);
        vec3 hot = mix(uColor, vec3(1.0, 0.25, 0.2), uDanger);
        float a = clamp(body + lattice * 0.5 + base * 0.6 + top * 0.6 + uDanger * 0.25 * (0.6 + 0.4 * sin(uTime * 14.0)) + uFlash, 0.0, 0.95);
        gl_FragColor = vec4(hot * (0.55 + lattice * 1.3 + base * 1.6 + top * 1.4 + uDanger * 0.8), a); ${TONE} }`,
  });
}

/** Emissive edge-lit dark block (pillars, structures): dark body plus luminous outline. */
export function edgeBlock(w: number, h: number, d: number, color: number, body = 0x070a10): THREE.Group {
  const g = new THREE.Group(); const geo = new THREE.BoxGeometry(w, h, d);
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: body, roughness: 0.35, metalness: 0.7 })));
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color })); (lines.material as THREE.LineBasicMaterial).color.multiplyScalar(2.2); g.add(lines);
  return g;
}

export function lights(group: THREE.Group, th: Theme, shadows = true, span = 40) {
  const hemi = new THREE.HemisphereLight(new THREE.Color(th.horizon).lerp(new THREE.Color(0xffffff), 0.6), 0x0a0c12, 1.25);
  const key = new THREE.DirectionalLight(0xe8f0ff, 2.0); key.position.set(18, 42, 22);
  if (shadows) { key.castShadow = true; key.shadow.mapSize.set(2048, 2048); const c = key.shadow.camera; c.left = -span; c.right = span; c.top = span; c.bottom = -span; c.near = 1; c.far = 140; key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03; }
  const rim = new THREE.DirectionalLight(th.accent, 2.2); rim.position.set(-20, 14, -30);
  const fill = new THREE.DirectionalLight(th.accent2, 0.45); fill.position.set(26, 8, -6);
  group.add(hemi, key, key.target, rim, fill);
  return { hemi, key, rim, fill };
}

let windowTex: THREE.CanvasTexture | null = null;
function windows(): THREE.CanvasTexture {
  if (windowTex) return windowTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const x = c.getContext('2d')!; x.fillStyle = '#000'; x.fillRect(0, 0, 64, 256);
  const r = new Rng(7);
  for (let j = 0; j < 42; j++) for (let i = 0; i < 6; i++) if (r.chance(0.34)) { const v = Math.round(r.range(90, 255)); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(4 + i * 10, 3 + j * 6, 6, 3); }
  for (let j = 0; j < 4; j++) { x.fillStyle = '#fff'; x.fillRect(0, r.int(10, 240), 64, 1); }
  windowTex = new THREE.CanvasTexture(c); windowTex.wrapS = windowTex.wrapT = THREE.RepeatWrapping; windowTex.userData.shared = true; return windowTex;
}
/** Instanced architectural towers with lit windows, arranged in a ring outside the play space. */
export function skyline(count: number, rMin: number, rMax: number, th: Theme, seed = 1, baseY = 0, hMax = 110): THREE.InstancedMesh {
  const rng = new Rng(seed); const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x06080d, roughness: 0.4, metalness: 0.75, emissive: new THREE.Color(th.accent), emissiveMap: windows(), emissiveIntensity: 1.5 });
  const m = new THREE.InstancedMesh(geo, mat, count); const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.05, 0.05), r = rng.range(rMin, rMax), w = rng.range(10, 30), d = rng.range(10, 30), h = rng.range(18, hMax) * (0.5 + 0.5 * rng.next());
    q.setFromEuler(e.set(0, rng.range(0, Math.PI), 0)); mx.compose(new THREE.Vector3(Math.cos(a) * r, baseY, Math.sin(a) * r), q, new THREE.Vector3(w, h, d)); m.setMatrixAt(i, mx);
    col.setHex(rng.chance(0.25) ? th.accent2 : 0xffffff).multiplyScalar(rng.range(0.5, 1)); m.setColorAt(i, col);
  }
  m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; m.name = 'skyline';
  return m;
}

/** Stadium audience rendered as instanced light points; `excite` drives situational crowd reactions. */
export class Crowd {
  readonly mesh: THREE.InstancedMesh; private mat: THREE.MeshBasicMaterial; level = 0.35; private target = 0.35;
  constructor(radius: number, y0: number, rows: number, perRow: number, th: Theme, sides = 0) {
    const geo = new THREE.PlaneGeometry(0.3, 0.42); this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const n = rows * perRow; this.mesh = new THREE.InstancedMesh(geo, this.mat, n); const rng = new Rng(11), mx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color(); let k = 0;
    for (let r = 0; r < rows; r++) for (let i = 0; i < perRow; i++) {
      const a = ((i + rng.range(-0.3, 0.3)) / perRow) * Math.PI * 2; let rad = radius + r * 2.2;
      if (sides > 2) { const seg = Math.PI * 2 / sides, la = ((a % seg) + seg) % seg - seg / 2; rad = rad / Math.cos(la); }
      q.setFromEuler(e.set(0, -a + Math.PI / 2, 0)); mx.compose(new THREE.Vector3(Math.cos(a) * rad, y0 + r * 1.5 + rng.range(-0.1, 0.1), Math.sin(a) * rad), q, new THREE.Vector3(1, 1, 1)); this.mesh.setMatrixAt(k, mx);
      c.setHex(rng.chance(0.15) ? th.accent2 : rng.chance(0.4) ? th.accent : 0x9fb4d0).multiplyScalar(rng.range(0.15, 0.9)); this.mesh.setColorAt(k, c); k++;
    }
    this.mesh.frustumCulled = false; this.mesh.name = 'crowd';
  }
  excite(v: number) { this.target = Math.min(1.6, Math.max(this.target, v)); }
  update(dt: number, t: number) { this.level += (this.target - this.level) * Math.min(1, dt * 5); this.target += (0.35 - this.target) * Math.min(1, dt * 0.7); this.mat.color.setScalar(this.level * (0.9 + 0.1 * Math.sin(t * 9))); }
}

/** Updates time uniforms on every shader material in a tree. */
export function tickUniforms(root: THREE.Object3D, t: number) { root.traverse((o: any) => { const u = o.material?.uniforms; if (u?.uTime) u.uTime.value = t; }); }

/**
 * Reflection environment for every gloss-black and chrome surface in the game.
 *
 * three's stock RoomEnvironment is a white photographic studio: on a lacquered black cockpit it reads as grey plastic
 * with a milky sheen, which is the single thing that makes an otherwise good model look cheap. This builds a night
 * grid instead — a near-black room, a dim horizon band, and a handful of long neon strips at raking angles. Those
 * strips are what a clear-coat actually shows: hard, thin, coloured streaks that slide across the bodywork as the
 * rider turns, with true black everywhere between them.
 */
export function gridEnvironment(): THREE.Scene {
  const s = new THREE.Scene();
  const lit = (c: number, i: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.set(0, ry, rz); s.add(o); return o;
  };
  // the room: near-black, lifted a touch toward blue at the floor so undersides are not dead
  const room = new THREE.Mesh(new THREE.BoxGeometry(22, 12, 22), new THREE.MeshBasicMaterial({ color: 0x03050a, side: THREE.BackSide })); s.add(room);
  box(22, 0.02, 22, new THREE.MeshBasicMaterial({ color: 0x060a14, side: THREE.DoubleSide }), 0, -5.9, 0);
  // horizon band: the city glow the machine sits inside
  const band = new THREE.Mesh(new THREE.CylinderGeometry(10.6, 10.6, 1.5, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x0e2b45, side: THREE.BackSide })); band.position.y = -1.2; s.add(band);
  // raking neon strips: the streak highlights a clear-coat lives on
  const ion = lit(0x4fe3ff, 2.4), ionDim = lit(0x2a7fa8, 1.1), ember = lit(0xff6a1f, 1.9), white = lit(0xdff4ff, 2.0);
  box(17, 0.22, 0.22, ion, 0, 3.4, -7.4, 0, 0.07);
  box(17, 0.16, 0.16, ion, 0, 1.1, -7.8, 0, -0.05);
  box(0.18, 0.18, 16, ionDim, -7.6, 2.3, 0, 0, 0);
  box(0.18, 0.18, 16, ionDim, 7.6, 2.3, 0, 0, 0);
  box(13, 0.14, 0.14, ember, 2.2, -0.6, 7.6, 0, 0.1);
  box(9, 0.1, 0.1, ember, -3.4, 2.9, 7.2, 0, -0.12);
  // overhead key: a long soft panel that gives the top surfaces one clean falloff
  box(7.5, 0.05, 2.2, white, 0, 5.4, -0.6);
  box(3.2, 0.05, 1.2, lit(0x9fd8ff, 1.2), -3.6, 5.2, 3.4);
  // a few floor strips so reflections carry under the machine too
  for (let i = -2; i <= 2; i++) box(15, 0.04, 0.12, ionDim, 0, -5.8, i * 3.1);
  return s;
}
