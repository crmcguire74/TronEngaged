import * as THREE from 'three';
import { BaseSession, ctl, type Ctx, type SessionResult } from '../../app/context';
import type { Actions } from '../../input/input';
import type { Instance } from '../../engine/assets';
import { CITY_PANO, PANORAMA, lodChar, tuneEmissive } from '../../engine/assets';
import { Crowd, edgeBlock, gridFloor, hardlight, lights, skyDome, suppliedSky, theme, type Theme } from '../../engine/env';
import { Ribbon } from '../../engine/vfx';
import { Ambient } from '../../engine/ambient';
import { ArenaFrames } from './setpieces';
import { Drones } from '../../engine/patrol';
import { angleLerp, clamp, damp, lerp, smooth } from '../../engine/math';
import { buildDiscConfig } from '../../progression/build';
import { discFinalScore } from '../../progression/scoring';
import { DIFFICULTIES, type DifficultyId, type TierDefinition } from '../../progression/types';
import { DiscSim, emptyIntent, type Fighter } from './sim';
import type { SimEvent } from '../../engine/events';

const ION = 0x4fe3ff;
const GLYPH: Record<string, string> = { sentinel: '▲', guardian: '■', striker: '◆', ricochet: '◣', hunter: '◎', disruptor: '✕', commander: '★' };

/** Injects a world-height reveal into a model's materials: used for materialise / de-materialise sequences. */
/**
 * Materialise-from-the-floor effect, plus an optional fresnel rim in the glow colour (`rim` > 0): the rim lets a dark
 * rider read against a dark machine at a distance, at no extra draw call or skinning pass.
 */
export function revealMaterials(root: THREE.Object3D, uni: { value: number }, glow = new THREE.Color(0.4, 0.9, 1), rim = 0) {
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      // chained, not replaced: a hook set earlier (the cycles' crisp light lines, cleanLines in view.ts) used to be
      // silently dropped here, so those machines rendered their soft painted glow instead
      const prev = m.onBeforeCompile, prevKey = prev && m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
      m.onBeforeCompile = (sh: any, r: any) => {
        prev?.call(m, sh, r);
        sh.uniforms.uReveal = uni; sh.uniforms.uRevealGlow = { value: glow }; sh.uniforms.uRim = { value: rim };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vRY;').replace('#include <project_vertex>', '#include <project_vertex>\nvRY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRY; uniform float uReveal, uRim; uniform vec3 uRevealGlow;').replace('#include <dithering_fragment>', 'if (vRY > uReveal) discard; gl_FragColor.rgb += uRevealGlow * smoothstep(0.22, 0.0, uReveal - vRY) * 3.0;\n' + (rim > 0 ? '#ifdef STANDARD\n gl_FragColor.rgb += uRevealGlow * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.5) * uRim;\n#endif\n' : '') + '#include <dithering_fragment>');
      };
      m.customProgramCacheKey = () => (prevKey ? prevKey() + '+' : '') + (rim > 0 ? 'reveal-rim' : 'reveal'); m.needsUpdate = true;
    }
  });
}

interface FighterView { hitShell?: THREE.Mesh; hitFlash?: number; travel?: boolean; id: number; inst: Instance; root: THREE.Group; reveal: { value: number }; marker: THREE.Sprite | null; markerCtx: CanvasRenderingContext2D | null; markerTex: THREE.CanvasTexture | null; hpShown: number; shield: THREE.Mesh; tell: THREE.Mesh; tellT: number; tellDur: number; throwT: number; hitT: number; props: { hand?: THREE.Object3D; back?: THREE.Object3D; shield?: THREE.Object3D }; ring: THREE.Mesh; height: number; late: boolean; hold: number; greeted: boolean; yaw?: number; dead?: boolean; deathT: number; deathDur?: number; burst?: boolean; baseY?: number; hx?: number; hz?: number; popT?: number; scrub?: boolean; run?: boolean; lean?: number }
interface DiscView { id: number; root: THREE.Group; model: THREE.Object3D; /** alternate bodies for re-armed rivals */ lance: THREE.Object3D | null; arc: THREE.Object3D | null; ribbon: Ribbon; rise: Ribbon | null; glow: THREE.Mesh; rim: THREE.MeshBasicMaterial | null; mark: THREE.Sprite | null; color: number; hostile: boolean; shown: number }
/** Rival discs are always this colour, whatever the rival's own colour: red means "this one can hurt you". */
const HOSTILE = 0xff4018, HOMING = 0xff2bd0, AMP = 0xffc23a;
let reticleTex: THREE.CanvasTexture | null = null;
/** A camera-facing bracket drawn round a rival disc, so it still reads when the disc itself is edge-on to you. */
function reticle(): THREE.CanvasTexture {
  if (reticleTex) return reticleTex; const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!; x.translate(64, 64); x.strokeStyle = '#fff'; x.lineCap = 'butt';
  x.lineWidth = 7; for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(0, 0, 50, i * Math.PI / 2 + 0.3, (i + 1) * Math.PI / 2 - 0.3); x.stroke(); }
  x.lineWidth = 9; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; x.beginPath(); x.moveTo(Math.cos(a) * 60, Math.sin(a) * 60); x.lineTo(Math.cos(a) * 38, Math.sin(a) * 38); x.stroke(); }
  return (reticleTex = new THREE.CanvasTexture(c));
}
/** A rival's disc: a black core in a bright serrated rim, so it reads as a coloured ring rather than a white glow. */
/**
 * A rival's disc: a black core in a bright rim, so it reads as a coloured shape rather than a white glow. The shape
 * escalates with the tier: a serrated ring early, a triangle from tier 11, a four-point star from tier 21 and on
 * every boss. Geometry is built once per form and shared.
 */
/**
 * A wide hexagonal deck: a dark slab with a bevelled lit rim, two inset hex rings and spokes of light from the centre,
 * so a wide arena reads as a different kind of place from the floating discs. A few hundred triangles.
 */
function hexDeck(r: number, color: number): THREE.Group {
  const g = new THREE.Group(), lit = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4) }), dim = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) });
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.9, 6, 1), new THREE.MeshStandardMaterial({ color: 0x06080c, metalness: 0.6, roughness: 0.4 })); slab.position.y = -0.47; slab.rotation.y = Math.PI / 6; g.add(slab);
  const ring = (rr: number, w: number, m: THREE.Material, y: number) => { const t = new THREE.Mesh(new THREE.TorusGeometry(rr, w, 4, 6), m); t.rotation.x = Math.PI / 2; t.rotation.z = Math.PI / 6; t.position.y = y; g.add(t); };
  ring(r - 0.06, 0.07, lit, 0.0); ring(r * 0.66, 0.035, dim, 0.01); ring(r * 0.33, 0.035, dim, 0.01);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2, sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, r * 0.94), dim); sp.position.set(Math.sin(a) * r * 0.47, 0.012, Math.cos(a) * r * 0.47); sp.rotation.y = a; g.add(sp); }
  return g;
}
let hazardTex: THREE.CanvasTexture | null = null;
/** Hazard sign for a failing deck: a red-rimmed warning triangle with a down arrow. */
function hazardSign(): THREE.CanvasTexture {
  if (hazardTex) return hazardTex; const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
  x.lineJoin = 'round'; x.beginPath(); x.moveTo(64, 10); x.lineTo(120, 110); x.lineTo(8, 110); x.closePath(); x.fillStyle = 'rgba(30,4,2,0.9)'; x.fill(); x.lineWidth = 9; x.strokeStyle = '#ff3a1c'; x.stroke();
  x.fillStyle = '#ffd23c'; x.beginPath(); x.moveTo(64, 96); x.lineTo(44, 66); x.lineTo(56, 66); x.lineTo(56, 40); x.lineTo(72, 40); x.lineTo(72, 66); x.lineTo(84, 66); x.closePath(); x.fill();
  return (hazardTex = new THREE.CanvasTexture(c));
}
export type DiscForm = 'ring' | 'tri' | 'star';
export const discForm = (tierId: number, boss: boolean): DiscForm => (boss || tierId > 20 ? 'star' : tierId > 10 ? 'tri' : 'ring');
const formGeo = new Map<DiscForm, { rim: THREE.BufferGeometry; core: THREE.BufferGeometry }>();
function formShapes(form: DiscForm) {
  let f = formGeo.get(form); if (f) return f;
  const outline = (r: number, pts: number, inner: number, round: number) => { const sh = new THREE.Shape(); const n = pts * (inner < 1 ? 2 : 1); for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2 + Math.PI / 2, rr = inner < 1 && i % 2 ? r * inner : r; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y); } void round; return sh; };
  const make = (sh: THREE.Shape, depth: number) => { const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 4 }); g.translate(0, 0, -depth / 2); g.rotateX(-Math.PI / 2); return g; };
  const shape = form === 'tri' ? (r: number) => outline(r, 3, 1, 0) : (r: number) => outline(r, 4, 0.48, 0);
  const rimSh = shape(0.5); rimSh.holes.push(new THREE.Path(shape(0.36).getPoints()));
  f = { rim: make(rimSh, 0.06), core: make(shape(0.37), 0.045) }; formGeo.set(form, f); return f;
}
function hostileDisc(form: DiscForm = 'ring'): { group: THREE.Group; rim: THREE.MeshBasicMaterial } {
  const g = new THREE.Group(), rim = new THREE.MeshBasicMaterial({ color: HOSTILE }), dark = new THREE.MeshBasicMaterial({ color: 0x06080b });
  if (form !== 'ring') { const f = formShapes(form); g.add(new THREE.Mesh(f.core, dark), new THREE.Mesh(f.rim, rim)); const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 12), rim); g.add(hub); return { group: g, rim }; }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 24), dark), ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.055, 8, 36), rim); ring.rotation.x = Math.PI / 2; g.add(core, ring);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 12), rim); g.add(hub);
  const tooth = new THREE.ConeGeometry(0.075, 0.2, 3); tooth.rotateZ(-Math.PI / 2); tooth.scale(1, 0.35, 1);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, t = new THREE.Mesh(tooth, rim); t.position.set(Math.cos(a) * 0.43, 0, -Math.sin(a) * 0.43); t.rotation.y = a + 0.5; g.add(t); }
  return { group: g, rim };
}
/**
 * Every live cutter beam in one mesh: each beam point becomes a short upright blade of light, joined into a ribbon
 * that fades toward its tail. Rebuilt each frame from the sim's points (a few dozen at most), one draw call.
 */
class BeamView {
  readonly mesh: THREE.Mesh; private pos: Float32Array; private al: Float32Array; private idx: Uint16Array; private max = 400;
  constructor() {
    this.pos = new Float32Array(this.max * 2 * 3); this.al = new Float32Array(this.max * 2); this.idx = new Uint16Array(this.max * 6);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aA', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage)); g.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage)); g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(0xff2a14) } },
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * 2.2, vA); }' });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
  }
  /** Each beam is its own strip: quads join consecutive points of one beam only, never one beam to the next. */
  update(discs: readonly { beam?: number[] }[], now: number) {
    let v = 0, n6 = 0; const P = this.pos, A = this.al, I = this.idx;
    for (const d of discs) {
      const b = d.beam; if (!b || b.length < 8) continue; const n = b.length / 4; if (v + n > this.max) break;
      for (let i = 0; i < n; i++) {
        const k = (v + i) * 2, a = Math.max(0, 1 - (now - b[i * 4 + 3]) / 1.1) * 0.85; P.set([b[i * 4], b[i * 4 + 1] - 0.13, b[i * 4 + 2], b[i * 4], b[i * 4 + 1] + 0.13, b[i * 4 + 2]], k * 3); A[k] = a * 0.6; A[k + 1] = a;
        if (i > 0) { const q = k - 2; I.set([q, q + 1, q + 2, q + 1, q + 3, q + 2], n6); n6 += 6; }
      }
      v += n;
    }
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.aA.needsUpdate = true; g.index!.needsUpdate = true; g.setDrawRange(0, n6); this.mesh.visible = n6 > 0;
  }
}
interface PlatView { sign?: THREE.Sprite; klaxon?: number; root: THREE.Group; ring: THREE.Mesh; surge: THREE.Mesh; sink: number; beam: THREE.Mesh }

export class DiscSession extends BaseSession {
  readonly mode = 'discs' as const; sim: DiscSim; private th: Theme; private intent = emptyIntent();
  private fv = new Map<number, FighterView>(); private dv = new Map<number, DiscView>(); private pv: PlatView[] = []; private bv: THREE.Object3D[] = []; private av: { g: THREE.Group; fill: THREE.MeshBasicMaterial; mast: THREE.Mesh }[] = []; private ampSeen = false;
  private yaw = Math.PI; private pitch = -0.06; private crowd: Crowd; private drones!: Drones; private look = new THREE.Vector3(); private sky: THREE.Mesh; private floor: THREE.Mesh; private wallMats: THREE.ShaderMaterial[] = []; private timed: THREE.ShaderMaterial[] = [];
  private v = new THREE.Vector3(); private v2 = new THREE.Vector3(); private camPos = new THREE.Vector3(); private camLook = new THREE.Vector3();
  private hopFade = false; private offset = new THREE.Vector3(); private recentred = false; private vrDisc: THREE.Object3D | null = null; private introDone = false; private bossName = ''; private totalEnemies: number; private interfere = false; private lastHp: number; private early: boolean; private threw = false; private shielded = false; private drawT = 9; private called = false; private eye = new THREE.Vector3(); private arrows: THREE.Mesh[] = []; private slowT = 0; private slowDur = 1; private slowMin = 1; private tickAt = 0;

  static assets(tier: TierDefinition, skin: string): string[] { return ['char:' + skin, 'char:ivory', 'char:crimson', 'lodchar:ivory', 'lodchar:crimson', 'disc:azure', 'disc:ivory', 'disc:crimson', 'disc:identity', 'sword', 'pedestal', 'coliseum', 'frame', 'drone']; }

  constructor(ctx: Ctx, tier: TierDefinition, diff: DifficultyId, seedSalt = 0) {
    super(ctx, tier, diff);
    this.sim = new DiscSim(buildDiscConfig(tier, diff, seedSalt)); this.th = theme(tier.environment);
    this.totalEnemies = this.sim.enemiesRemaining(); this.lastHp = this.sim.player.hp; this.early = !tier.endless && tier.id <= 4; ctx.hud.vrMode = 'belt';
    const A = this.sim.cfg.arena, W = this.world, th = this.th, eng = ctx.engine;
    eng.scene.fog = new THREE.FogExp2(th.fog, th.fogDensity);
    // alternate arenas sit under the supplied domed-city panorama instead of the original stadium sphere
    const city = ['vertical-chamber', 'fractured-lattice', 'grand-colosseum'].includes(tier.environment);
    this.sky = suppliedSky(th, ctx.assets, tier.environment) ?? (city ? skyDome(th, ctx.assets.texture(CITY_PANO.dome), 1500, { lo: -34, hi: 52, gain: 0.6, mix: 0.9, tint: 0.6 }) : skyDome(th, ctx.assets.texture(PANORAMA))); W.add(this.sky); this.timed.push(this.sky.material as THREE.ShaderMaterial);
    const L = lights(W, th, ctx.settings.quality === 'high' && !ctx.xr.presenting, 34); L.key.position.set(10, 34, 16);
    // pit floor far below the platforms
    this.floor = gridFloor(220, th, 3, { fade: 120, glow: 0.4 }); this.floor.position.y = A.floor; W.add(this.floor); this.timed.push(this.floor.material as THREE.ShaderMaterial);
    // chamber: translucent hardlight walls on a structural frame — every ricochet surface is real, visible geometry
    const H = A.ceiling - A.floor, side = 2 * A.radius * Math.tan(Math.PI / A.sides), R = A.radius;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x070a11, roughness: 0.32, metalness: 0.85 });
    const trim = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent).multiplyScalar(1.8) });
    for (let i = 0; i < A.sides; i++) {
      const a = ((i + 0.5) / A.sides) * Math.PI * 2, m = hardlight(th.accent, 0.5, 1.2, 0.01); this.wallMats.push(m); this.timed.push(m);
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(side, H), m); wall.position.set(Math.cos(a) * R, A.floor + H / 2, Math.sin(a) * R); wall.lookAt(0, wall.position.y, 0); W.add(wall);
      const ca = (i / A.sides) * Math.PI * 2, cr = R / Math.cos(Math.PI / A.sides);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, H + 6, 0.9), frameMat); post.position.set(Math.cos(ca) * cr, A.floor + H / 2, Math.sin(ca) * cr); post.rotation.y = -ca; W.add(post);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, H, 0.08), trim); strip.position.set(Math.cos(ca) * (cr - 0.5), A.floor + H / 2, Math.sin(ca) * (cr - 0.5)); W.add(strip);
      for (const [y, t] of [[A.ceiling, 0.5], [A.floor + 0.2, 0.3], [2.5, 0.12]] as const) { const beam = new THREE.Mesh(new THREE.BoxGeometry(side + 0.6, t, 0.5), y === 2.5 ? trim : frameMat); beam.position.set(Math.cos(a) * (R + 0.2), y, Math.sin(a) * (R + 0.2)); beam.lookAt(0, y, 0); W.add(beam); }
    }
    // ceiling halo and light shafts
    const halo = new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.22, 8, A.sides * 8), trim); halo.rotation.x = Math.PI / 2; halo.position.y = A.ceiling - 0.6; W.add(halo);
    const halo2 = new THREE.Mesh(new THREE.TorusGeometry(R * 0.2, 0.12, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent2).multiplyScalar(1.6) })); halo2.rotation.x = Math.PI / 2; halo2.position.y = A.ceiling - 0.4; W.add(halo2);
    // outer stadium: supplied coliseum shell + audience lights behind the hardlight walls
    if (ctx.assets.has('coliseum')) { const c = ctx.assets.instance('coliseum').root; c.scale.setScalar(0.42); c.position.y = A.floor - 3; c.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; } }); W.add(c); }
    this.crowd = new Crowd(R + 7, -1, 9, 150, th, A.sides); W.add(this.crowd.mesh);
    // broadcast drones circle just outside the hardlight walls, lenses on the player
    this.drones = new Drones(ctx.assets, ctx.settings.quality === 'low' ? 2 : 3, th.accent, 1.1); W.add(this.drones.group);
    // platforms: supplied pedestal model sized to each analytic collision disc
    this.sim.platforms.forEach((p) => {
      const root = new THREE.Group(); const col = p.side === 0 ? ION : th.accent2 === ION ? 0xff8a3c : th.accent2;
      // wide arenas stand on hexagonal slabs, not the round pedestals: a different place, not a bigger copy of the same one
      if (p.r > 8) root.add(hexDeck(p.r, p.side === 0 ? ION : th.accent2));
      else if (ctx.assets.has('pedestal')) { const m = ctx.assets.instance('pedestal', { cloneMaterials: true }).root; tuneEmissive(m, 0.09); m.traverse((o: any) => { if (o.isMesh) { o.material.color.multiplyScalar(0.22); o.material.roughness = Math.max(0.35, o.material.roughness ?? 0.5); } }); m.scale.setScalar(p.r / 12.39 * 1.04); m.traverse((o: any) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = false; } }); root.add(m); }
      else { const m = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 0.8, 0.8, 40), frameMat); m.position.y = -0.4; m.receiveShadow = true; root.add(m); }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(p.r - 0.12, 0.06, 6, 72), new THREE.MeshBasicMaterial({ color: col })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.04; root.add(ring);
      const surge = new THREE.Mesh(new THREE.CircleGeometry(p.r - 0.3, 48), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); surge.rotation.x = -Math.PI / 2; surge.position.y = 0.06; root.add(surge);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.9, 30, 12, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false })); beam.position.y = -17; root.add(beam);
      W.add(root); this.pv.push({ root, ring, surge, sink: 0, beam });
    });
    this.sim.barriers.forEach((_, i) => this.addBarrierView(i));
    this.sim.amps.forEach(() => this.addAmpView());
    if (this.sim.core) this.buildCore();
    if (this.tier.modifiers.includes('cutter')) { this.beams = new BeamView(); this.world.add(this.beams.mesh); }
    for (const f of this.sim.fighters) this.addFighter(f);
    // VR: the held disc sits in the tracked throwing hand
    this.vrDisc = ctx.assets.instance('disc:azure').root; this.vrDisc.visible = false; this.vrDisc.userData.shared = true;
    this.frames = new ArenaFrames(ctx.assets.has('frame') ? ctx.assets.instance('frame').root : null, tier.environment, th, A.floor, tier.id * 13, ctx.xr.presenting); W.add(this.frames.group);
    this.ambient = new Ambient(th, { cx: 0, cz: 0, groundY: A.floor, rMin: 55, rMax: 150, hMin: 25, hMax: 70, seed: tier.id * 37, xr: ctx.xr.presenting, quality: ctx.settings.quality }); W.add(this.ambient.group);
    W.add(ctx.vfx.group); ctx.vfx.clear();
    eng.setWorld(W);
    ctx.hud.show('discs'); ctx.input.setPointerLock(true);
    ctx.audio.playMusic(tier.boss ? 'boss' : 'discs'); ctx.audio.ambience(tier.environment); ctx.audio.intensity = 0.3; ctx.audio.setCrowdBed(0.015);
    this.introDur = tier.boss ? 5.5 : 4.2; this.outroDur = tier.boss ? 4.2 : 3.2;
    ctx.hud.banner(`TIER ${tier.endless ? '∞' : String(tier.id).padStart(2, '0')} — ${tier.name.toUpperCase()}`, tier.brief, this.introDur * 1000 - 400); if (tier.boss) ctx.audio.say('Warning. Prime opponent detected.'); if (tier.boss) setTimeout(() => ctx.audio.vo('final_round'), 1400);
    if (tier.boss) ctx.audio.sfx('boss');
    this.view(0, 1, ctx.input.actions);
  }

  /** Amplifier ring: a gold hoop with inward chevrons and a faint membrane, so it reads as "throw through here". */
  private addAmpView() {
    const g = new THREE.Group(), gold = new THREE.MeshBasicMaterial({ color: AMP }), dim = new THREE.MeshBasicMaterial({ color: new THREE.Color(AMP).multiplyScalar(0.45) });
    g.add(new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.07, 10, 56), gold), new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.025, 6, 56), dim));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshBasicMaterial({ color: AMP, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); g.add(fill);
    const chev = new THREE.Shape(); chev.moveTo(0, 0); chev.lineTo(-0.16, 0.2); chev.lineTo(-0.09, 0.2); chev.lineTo(0, 0.09); chev.lineTo(0.09, 0.2); chev.lineTo(0.16, 0.2); chev.closePath();
    const cg = new THREE.ShapeGeometry(chev); cg.translate(0, 0.98, 0);
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(cg, gold); m.rotation.z = (i / 6) * Math.PI * 2; m.material = new THREE.MeshBasicMaterial({ color: AMP, side: THREE.DoubleSide }); g.add(m); }
    // a slim mast down to the floor so the ring is anchored in space, not floating trivia
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), dim);
    this.world.add(g, mast); this.av.push({ g, fill: fill.material as THREE.MeshBasicMaterial, mast });
  }
  private addBarrierView(i: number) {
    const b = this.sim.barriers[i], d = b.def; let obj: THREE.Object3D;
    if (d.pillar) obj = edgeBlock(d.hx * 2, d.hy * 2, d.hz * 2, this.th.accent);
    else if (d.volatile) {
      const g = new THREE.Group(); const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.75), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5533).multiplyScalar(2) }));
      const shell = new THREE.Mesh(new THREE.OctahedronGeometry(1.15), new THREE.MeshBasicMaterial({ color: 0xffd0a0, wireframe: true, transparent: true, opacity: 0.8 })); g.add(core, shell); obj = g;
    } else {
      const col = d.hp > 0 ? 0xffb62e : d.orbit ? this.th.accent2 : 0xbfe9ff; const mat = hardlight(col, d.hp > 0 ? 0.5 : 0.3, 1.5, 0.035); this.timed.push(mat);
      const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(d.hx * 2, d.hy * 2, d.hz * 2), mat); g.add(m);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.6) })); g.add(edges); obj = g;
    }
    obj.position.set(b.x, b.y, b.z); obj.rotation.y = b.yaw; this.world.add(obj); this.bv[i] = obj;
  }

  private addFighter(f: Fighter) {
    // ordinary rivals stand 10-25 m off and use the light rider; bosses and the player keep full detail
    const key = f.isPlayer ? 'char:' + this.ctx.settings.skin : f.arch.boss ? 'char:' + f.arch.model : lodChar(this.ctx.assets, 'char:' + f.arch.model);
    const inst = this.ctx.assets.instance(key, { cloneMaterials: true }); const root = new THREE.Group(); root.add(inst.root); inst.root.scale.setScalar(f.arch.scale);
    const reveal = { value: f.isPlayer ? 50 : -5 }; if (!inst.missing) revealMaterials(inst.root, reveal, new THREE.Color(f.isPlayer ? ION : f.arch.tint).multiplyScalar(0.8));
    // rivals built on the pale runner carry their archetype colour in their circuit lines, so each type reads at a glance
    if (!f.isPlayer && f.arch.model === 'ivory' && !inst.missing) inst.root.traverse((o: any) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.emissive && (m.emissiveMap || m.emissive.getHex() !== 0)) { m.emissive.set(f.arch.tint); m.emissiveIntensity = Math.max(m.emissiveIntensity, 3); } else if (m.color) m.color.lerp(new THREE.Color(f.arch.tint), 0.14); });
    const props: FighterView['props'] = {}; inst.root.traverse((o) => { if (o.name === 'PropDiscMesh') props.hand = o; else if (o.name === 'PropDiscBackMesh') props.back = o; else if (o.name === 'PropShieldMesh') props.shield = o; });
    const col = f.isPlayer ? ION : f.arch.tint;
    const shield = new THREE.Mesh(new THREE.CircleGeometry(1.05, 6), hardlight(col, 0.9, 3, 0.07, { radial: true, body: 0.2 })); shield.visible = false; root.add(shield); this.timed.push(shield.material as THREE.ShaderMaterial);
    const tell = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 4, 1, 0.25, Math.PI * 2 - 0.5), new THREE.MeshBasicMaterial({ color: HOSTILE, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })); tell.visible = false; root.add(tell);
    const ring = new THREE.Mesh(new THREE.RingGeometry(f.isPlayer ? 0.62 : 0.82, f.isPlayer ? 0.72 : 1.0, f.isPlayer ? 40 : f.arch.boss ? 6 : 3 + (Object.keys(GLYPH).indexOf(f.kind) % 4)), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07; root.add(ring);
    let marker: THREE.Sprite | null = null, markerCtx: CanvasRenderingContext2D | null = null, markerTex: THREE.CanvasTexture | null = null;
    if (!f.isPlayer) { const c = document.createElement('canvas'); c.width = 256; c.height = 96; markerCtx = c.getContext('2d')!; markerTex = new THREE.CanvasTexture(c); marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false })); marker.scale.set(0.16, 0.06, 1); marker.position.y = 2.15 * f.arch.scale + 0.35; marker.renderOrder = 50; root.add(marker); }
    this.world.add(root);
    // the player's hit shell: a red glow that wraps the body for a beat when a disc lands, so the blow is seen on the body
    let hitShell: THREE.Mesh | undefined; if (f.isPlayer) { hitShell = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); hitShell.scale.set(0.55, 1.05, 0.55); hitShell.position.y = 1.0; hitShell.visible = false; root.add(hitShell); }
    const fvv: FighterView = { hitShell, hitFlash: 0, id: f.id, inst, root, reveal, marker, markerCtx, markerTex, hpShown: -1, shield, tell, tellT: 0, tellDur: 1, throwT: 0, hitT: 0, props, ring, height: 1.85 * f.arch.scale, late: false, hold: 0, greeted: false, deathT: 0 };
    this.fv.set(f.id, fvv); inst.play('Idle', 0);
    for (const id of f.discIds) this.addDisc(id, f);
  }
  // ---------------------------------------------------------------- core breach and power nodes
  private seenNode = false; private fallFrom = new THREE.Vector3(); /** >0 while the player is falling: seconds since they went over the edge */ private fallCam = 0; private frames!: ArenaFrames; private beams: BeamView | null = null; private seenCut = false; private locked = new Set<number>(); private ambient!: Ambient;
  private coreV: { root: THREE.Group; shell: THREE.Group; core: THREE.Mesh; coreMat: THREE.MeshBasicMaterial; halo: THREE.Mesh; pips: THREE.MeshBasicMaterial[] } | null = null;
  private nodeV = new Map<number, { g: THREE.Group; kind: string }>();
  /**
   * The core: a white-hot sphere inside a ring shield of hardlight slats with one open gap, turning slowly. A beam drops
   * from it, and six pips under it count down what is left.
   */
  private buildCore() {
    const c = this.sim.core!, root = new THREE.Group(), shell = new THREE.Group(), col = this.th.accent2;
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff) }); const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 2), coreMat);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.7, 20, 14), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })); root.add(core, halo);
    // slats fill the circle except the gap, which is centred on local +X (the sim measures the gap from +X)
    const slat = hardlight(col, 0.42, 1.4, 0.03); this.timed.push(slat); const N = 26, gap = c.gap;
    for (let i = 0; i < N; i++) { const a = gap / 2 + (i + 0.5) * ((Math.PI * 2 - gap) / N); const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.6, ((Math.PI * 2 - gap) / N) * 2.5 * 0.86), slat); m.position.set(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5); m.rotation.y = -a; shell.add(m); }
    for (const y of [-1.85, 1.85]) { const r = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.05, 6, 64, Math.PI * 2 - gap), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.4) })); r.rotation.x = Math.PI / 2; r.rotation.z = gap / 2; r.position.y = y; shell.add(r); }
    // gap markers: two bright posts either side of the opening, so it reads as a doorway at any distance
    for (const sgn of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.2, 0.16), new THREE.MeshBasicMaterial({ color: 0xffffff })); post.position.set(Math.cos(sgn * gap / 2) * 2.5, 0, Math.sin(sgn * gap / 2) * 2.5); shell.add(post); }
    root.add(shell);
    const pips: THREE.MeshBasicMaterial[] = []; for (let i = 0; i < c.max; i++) { const m = new THREE.MeshBasicMaterial({ color: col }); const p = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), m); p.position.set((i - (c.max - 1) / 2) * 0.65, -3, 0); root.add(p); pips.push(m); }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.9, 30, 12, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false })); beam.position.y = -16; root.add(beam);
    root.position.set(c.x, c.y, c.z); this.world.add(root); this.coreV = { root, shell, core, coreMat, halo, pips };
  }
  private animateObjectives(dt: number, _a: Actions) {
    const t = this.ctx.engine.elapsed, c = this.sim.core, cv = this.coreV;
    // three's rotation.y turns +X towards -Z, the sim's angle turns +X towards +Z: hence the minus
    if (c && cv) { cv.shell.rotation.y = -c.rot; cv.core.rotation.y = t * 0.8; cv.core.scale.setScalar(1 + 0.06 * Math.sin(t * 5) + c.flash * 0.5); cv.coreMat.color.setScalar(1 + c.flash * 2); (cv.halo.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.08 * Math.sin(t * 3) + c.flash; }
    for (const n of this.sim.nodes) { const v = this.nodeV.get(n.id); if (!v) continue; v.g.position.set(n.x, n.y, n.z); v.g.children[0].rotation.y = t * 2.4; v.g.children[0].position.y = 1.2 + Math.sin(t * 3 + n.id) * 0.12; v.g.visible = n.life > 3 || Math.sin(t * 18) > 0; }
  }
  private nodeMesh(kind: string): THREE.Group {
    const col = kind === 'split' ? 0x6dffb0 : kind === 'pierce' ? 0xff4fd8 : 0xffd23c, g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.4) });
    const gem = new THREE.Mesh(kind === 'split' ? new THREE.TetrahedronGeometry(0.42) : kind === 'pierce' ? new THREE.ConeGeometry(0.22, 0.8, 4) : new THREE.OctahedronGeometry(0.4), m); gem.position.y = 1.2; g.add(gem);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
    const col2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); col2.position.y = 1.2; g.add(col2);
    return g;
  }
  private addDisc(id: number, f: Fighter) {
    const d = this.sim.disc(id)!; const hostile = !f.isPlayer, color = hostile ? HOSTILE : ION; const root = new THREE.Group();
    // yours keeps the supplied model and a cool blue trail; a rival's is a red serrated ring with a cross-shaped trail and a bracket that faces you
    let model: THREE.Object3D, rim: THREE.MeshBasicMaterial | null = null, mark: THREE.Sprite | null = null, rise: Ribbon | null = null;
    if (hostile) { const h = hostileDisc(discForm(this.tier.id, !!f.arch.boss)); model = h.group; rim = h.rim; mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticle(), color: HOSTILE, transparent: true, opacity: 0, depthWrite: false })); mark.renderOrder = 40; root.add(mark); rise = new Ribbon(color, 18, 0.5, true, 0.25); }
    else {
      // the player throws whichever disc is equipped; rivals keep their own kind
      const key = 'disc:' + (f.isPlayer ? this.ctx.settings.disc || d.kind : d.kind);
      model = this.ctx.assets.instance(this.ctx.assets.has(key) ? key : 'disc:' + d.kind).root; model.scale.setScalar(1.7);
    }
    root.add(model);
    // Rivals can re-arm mid-fight, so each projectile carries all three bodies and shows whichever is in flight: the
    // ring, a slim lance bolt, or the arc blade. Swapping visibility costs nothing next to rebuilding the node.
    let lance: THREE.Object3D | null = null, arc: THREE.Object3D | null = null;
    if (hostile) {
      const lg = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 1.5, 8), new THREE.MeshBasicMaterial({ color: 0xcfe9ff }));
      shaft.rotation.x = Math.PI / 2; lg.add(shaft);
      const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.03, 1.1, 8, 1, true), new THREE.MeshBasicMaterial({ color: HOSTILE, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      halo.rotation.x = Math.PI / 2; halo.position.z = -0.2; lg.add(halo);
      lance = lg; lg.visible = false; root.add(lg);
      if (this.ctx.assets.has('sword')) {
        const sw = this.ctx.assets.instance('sword', { cloneMaterials: true }).root;
        // the blade file is four units long down +X: lay it across the flight path and bring it to about a metre
        sw.scale.setScalar(0.26); sw.rotation.set(0, 0, Math.PI / 2); sw.position.set(0, 0, 0);
        tuneEmissive(sw, 2.2); arc = new THREE.Group(); arc.add(sw); arc.visible = false; root.add(arc);
      }
    }
    const glow = new THREE.Mesh(new THREE.RingGeometry(hostile ? 0.4 : 0.22, hostile ? 0.52 : 0.34, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: hostile ? 0.4 : 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); glow.rotation.x = -Math.PI / 2; root.add(glow);
    const ribbon = new Ribbon(color, 26, hostile ? 0.46 : 0.3, false, 0.3); this.world.add(root, ribbon.mesh); if (rise) this.world.add(rise.mesh); root.visible = false; ribbon.mesh.visible = false; if (rise) rise.mesh.visible = false;
    this.dv.set(id, { id, root, model, lance, arc, ribbon, rise, glow, rim, mark, color, hostile, shown: 0 });
  }
  /**
   * In a headset there is no screen edge to put a warning on, so a disc bearing down from outside your view gets a red
   * chevron floating at the edge of vision on that side. Discs you can already see are marked by their own bracket.
   */
  private drawIncoming(list: { x: number; y: number; z: number; tca: number; homing: boolean }[], t: number) {
    const cam = this.ctx.engine.camera, { audio } = this.ctx; let soonest = 9;
    for (const d of list) soonest = Math.min(soonest, d.tca);
    // a quickening tick as the nearest one closes, so you can hear it without looking
    if (soonest < 1.1 && this.phase === 'play' && t > this.tickAt) { this.tickAt = t + 0.09 + soonest * 0.28; audio.sfx('prox'); }
    if (!this.xr) { for (const m of this.arrows) m.visible = false; return; }
    while (this.arrows.length < 3) { const sh = new THREE.Shape(); sh.moveTo(0, 0.05); sh.lineTo(0.034, -0.012); sh.lineTo(0.014, -0.012); sh.lineTo(0, 0.018); sh.lineTo(-0.014, -0.012); sh.lineTo(-0.034, -0.012); sh.closePath(); const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: HOSTILE, transparent: true, depthTest: false, depthWrite: false })); m.renderOrder = 9000; m.visible = false; cam.add(m); this.arrows.push(m); }
    list.sort((a, b) => a.tca - b.tca); const inv = this.v2;
    this.arrows.forEach((m, i) => {
      const d = list[i]; if (!d) { m.visible = false; return; }
      inv.set(d.x, d.y, d.z); cam.worldToLocal(inv); const off = Math.atan2(Math.hypot(inv.x, inv.y), -inv.z); if (off < 0.5) { m.visible = false; return; } // in view: its bracket does the job
      const a = Math.atan2(inv.y, inv.x), urge = clamp(1 - d.tca / 1.5, 0, 1); m.visible = true; m.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.24, -0.85); m.rotation.z = a - Math.PI / 2; m.scale.setScalar(1 + urge * 1.3);
      const mm = m.material as THREE.MeshBasicMaterial; mm.color.setHex(d.homing ? HOMING : HOSTILE); mm.opacity = 0.55 + 0.45 * Math.abs(Math.sin(t * (6 + urge * 16)));
    });
  }
  /** A held beat: play slows to `min` speed, then eases back over `dur` seconds. Kills use it so the eye can find them. */
  private slow(dur: number, min: number) { if (min <= this.slowMin || this.slowT <= 0) { this.slowT = dur; this.slowDur = dur; this.slowMin = min; } }
  private drawMarker(v: FighterView, f: Fighter) {
    const x = v.markerCtx!; x.clearRect(0, 0, 256, 96); const hex = '#' + new THREE.Color(f.arch.tint).getHexString();
    x.font = '600 34px "Saira Condensed", sans-serif'; x.textAlign = 'center'; x.fillStyle = hex; x.fillText(f.arch.boss ? '♛' : GLYPH[f.kind] ?? '▲', 128, 36);
    const w = f.arch.boss ? 220 : 130, x0 = 128 - w / 2; x.fillStyle = 'rgba(8,12,18,0.8)'; x.fillRect(x0 - 2, 50, w + 4, 14); x.fillStyle = hex; x.fillRect(x0, 52, w * clamp(f.hp / f.maxHp, 0, 1), 10);
    x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 1; x.strokeRect(x0 - 2.5, 49.5, w + 5, 15);
    if (f.shieldLock > 0) { x.fillStyle = '#fff'; x.font = '600 18px "Saira Condensed", sans-serif'; x.fillText('SHIELD DOWN', 128, 86); }
    v.markerTex!.needsUpdate = true; v.hpShown = f.hp + (f.shieldLock > 0 ? 0.5 : 0);
  }

  // ------------------------------------------------------------ lifecycle
  protected intro(k: number, dt: number) {
    const P = this.sim.player, cam = this.ctx.engine.camera;
    for (const f of this.sim.fighters) { const v = this.fv.get(f.id); if (!v || f.isPlayer) continue; const t = clamp((k - 0.5) / 0.4, 0, 1); v.reveal.value = f.y - 0.2 + t * 2.8 * f.arch.scale; if (t > 0 && t < 1 && Math.random() < 0.5) this.ctx.vfx.motes(f.x, f.y, f.z, f.arch.tint, 0.6, 2, 3); if (t >= 1) v.reveal.value = 50;
      // once formed, each rival draws its disc; the first one calls the player out
      if (t >= 1 && !v.greeted) { v.greeted = true; v.inst.play('GrabDisc', 0.15, true); v.hold = 1.5; if (!this.called) { this.called = true; this.ctx.audio.vo('jeer_intro', `${f.arch.label}: "Prepare yourself."`, { x: f.x, y: f.y + 1.6, z: f.z }, 1, 'jeer_intro_' + f.kind); } }
    }
    if (this.xr) return;
    // camera travels through the stadium, reveals the layout, then settles behind the player
    const e = smooth(k), a = lerp(Math.PI * 0.85, 0, e), r = lerp(30, 4.6, e), h = lerp(13, 2.3, e);
    this.camPos.set(P.x + Math.sin(a) * r + 0.9 * e, P.y + h, P.z + Math.cos(a) * r);
    this.camLook.set(lerp(0, P.x, e), lerp(2, P.y + 1.6, e), lerp(-4, P.z - 8, e));
    cam.position.copy(this.camPos); cam.lookAt(this.camLook);
  }
  protected onCountdown() { this.introDone = true; for (const v of this.fv.values()) v.reveal.value = 50; this.ctx.audio.sfx('spawn'); const P = this.sim.player; this.ctx.vfx.ring(P.x, P.y + 1.3, P.z, ION, 0.1, 1, 0.5); }
  protected onStart() { this.ctx.audio.intensity = 0.6; }

  protected step(dt: number, a: Actions, first: boolean) {
    const it = this.intent, P = this.sim.player, xr = this.ctx.xr;
    let fy: number, mx = a.moveX, my = a.moveY;
    if (this.xr) {
      fy = xr.headYaw(); const s = this.ctx.settings.vr;
      // aim is settled once per rendered frame; the frame the hand opens is the throw
      if (first) {
        const releasing = this.wasHeld && !a.throwHeld && P.winding; this.wasHeld = a.throwHeld;
        if (releasing) this.throwAim(); else { this.aim.copy(xr.aimDir); this.aimPower = 1; }
      }
      // while only shielding, defence faces where the head faces; while throwing, the hand aims
      const guard = a.shieldHeld && !a.throwHeld && !P.winding, dir = this.aim;
      // the shield rides the off-hand forearm, so it blocks where that arm presents it (head direction if it is held flat)
      let gx = Math.sin(fy), gz = Math.cos(fy);
      if (guard) { const n = this.v2.set(xr.offhand === 'left' ? -1 : 1, 0, 0).applyQuaternion(xr.handAnchor(xr.offhand).getWorldQuaternion(this.qa)), hl = Math.hypot(n.x, n.z); if (hl > 0.4) { gx = n.x / hl; gz = n.z / hl; } }
      it.ax = guard ? gx : dir.x; it.ay = guard ? 0 : dir.y; it.az = guard ? gz : dir.z; it.power = this.aimPower; it.ox = xr.aimOrigin.x; it.oy = xr.aimOrigin.y; it.oz = xr.aimOrigin.z;
      mx *= s.moveSpeed; my *= s.moveSpeed;
    } else {
      fy = this.yaw; const cp = Math.cos(this.pitch);
      // aim converges on the reticle point so the throw goes where the crosshair is
      const fx = Math.sin(this.yaw) * cp, fyv = Math.sin(this.pitch), fz = Math.cos(this.yaw) * cp;
      const tx = this.camPos.x + fx * 55 - P.x, ty = this.camPos.y + fyv * 55 - (P.y + 1.4), tz = this.camPos.z + fz * 55 - P.z, l = Math.hypot(tx, ty, tz) || 1;
      it.ax = tx / l; it.ay = ty / l; it.az = tz / l; it.power = 1; it.ox = undefined;
    }
    const sx = Math.sin(fy), sz = Math.cos(fy); it.mx = sx * my + -sz * mx; it.mz = sz * my + sx * mx;
    const ml = Math.hypot(it.mx, it.mz); if (ml > 1) { it.mx /= ml; it.mz /= ml; }
    // hop target: the platform in the direction pushed, or with the stick at rest the one being looked at
    if (first) {
      let gx = it.mx, gz = it.mz; if (ml < 0.3) { if (this.xr) { const g = xr.headForward(this.v2); gx = g.x; gz = g.z; } else { gx = Math.sin(this.yaw); gz = Math.cos(this.yaw); } }
      const gl = Math.hypot(gx, gz) || 1; this.hopTo = this.sim.hopTarget(P, gx / gl, gz / gl); this.hopDir.set(gx / gl, 0, gz / gl);
    }
    if (first && a.jump && ml < 0.3 && this.hopTo >= 0) { it.mx = this.hopDir.x; it.mz = this.hopDir.z; }
    // in a headset the same squeeze that grips the next disc would also recall one in flight, so recall waits for an empty hand
    it.throwHeld = a.throwHeld; it.shield = a.shieldHeld; it.jump = first && a.jump; it.dodge = first && a.dodge; it.recall = first && a.recall && (!this.xr || this.sim.heldDiscs(P) === 0);
    if (this.ctx.settings.autoRecall && first && this.sim.heldDiscs(P) === 0 && this.sim.discs.some((d) => d.owner === P.id && d.state === 'flying' && d.age > 1.8)) it.recall = true;
    this.sim.step(dt, it);
    for (const e of this.sim.events) this.onEvent(e); this.sim.events.length = 0;
  }
  private qa = new THREE.Quaternion(); private qb = new THREE.Quaternion(); private releaseTimes = new Map<THREE.AnimationClip, number>();
  /** Time in a Throw clip at which the disc leaves the hand: where its hand prop is scaled away. */
  private releaseAt(I: Instance) {
    const clip = I.actions.Throw?.getClip(); if (!clip) return 0; let t = this.releaseTimes.get(clip);
    if (t === undefined) { t = clip.duration * 0.45; const tr = clip.tracks.find((k) => /PropDisc(?!Back)/.test(k.name) && k.name.endsWith('.scale')); if (tr) for (let i = 0; i < tr.times.length; i++) if (tr.values[i * 3] < 0.5) { t = tr.times[i]; break; } this.releaseTimes.set(clip, t); }
    return t;
  }
  private hopTo = -1; private hopDir = new THREE.Vector3();
  private aim = new THREE.Vector3(0, 0, -1); private aimPower = 1; private wasHeld = false;
  /**
   * Direction and strength of a VR throw. A real swing throws along the hand's peak velocity; a release with no swing
   * throws where the hand points. Either way the line is flattened (a disc flies flat), leaned toward where the player
   * is looking, and then steered onto a rival if it already passes close to one. Wide throws are left alone, so a
   * deliberate bank shot stays the player's own.
   */
  private throwAim() {
    const xr = this.ctx.xr, dir = this.aim, vel = xr.releaseVelocity(this.v), speed = vel.length();
    if (speed > 1) dir.copy(vel).divideScalar(speed); else dir.copy(xr.aimDir);
    dir.y *= 0.55; dir.normalize();
    const gaze = xr.headForward(this.v2); gaze.y *= 0.4; gaze.normalize(); dir.lerp(gaze, speed > 1 ? 0.3 : 0.12).normalize();
    const FULL = 0.314, EDGE = 0.61; let angle = Math.PI; const to = this.camLook;
    for (const f of this.sim.fighters) {
      if (f.team !== 1 || !f.alive || f.falling) continue;
      this.v2.set(f.x - xr.aimOrigin.x, f.y + 1.15 - xr.aimOrigin.y, f.z - xr.aimOrigin.z).normalize(); const k = Math.acos(clamp(dir.dot(this.v2), -1, 1));
      if (k < angle) { angle = k; to.copy(this.v2); }
    }
    const help = angle <= FULL ? 0.85 : angle >= EDGE ? 0 : 0.85 * (1 - (angle - FULL) / (EDGE - FULL));
    if (help > 0) dir.lerp(to, help).normalize();
    this.aimPower = speed > 1 ? clamp(0.82 + speed * 0.09, 0.82, 1.3) : 1;
  }
  protected ended() { return this.sim.state !== 'active'; }
  protected finish(): SessionResult {
    const s = this.sim.stats, won = this.sim.state === 'won', fs = discFinalScore(s, won, this.tier.scoreMul, DIFFICULTIES[this.diff].scoreMul);
    this.ctx.audio.intensity = 0.2; this.ctx.input.setPointerLock(false); this.ctx.hud.coach(null);
    if (won) { this.ctx.audio.sfx('win'); this.ctx.audio.cheer(1.6); this.crowd.excite(1.6); this.ctx.audio.vo(s.damageTaken < 1 ? 'flawless' : 'you_win', s.damageTaken < 1 ? 'Flawless.' : 'Sector complete.'); } else { this.ctx.audio.sfx('lose'); this.ctx.audio.vo('you_lose', 'Runner offline.'); const e = this.sim.fighters.find((f) => f.team === 1 && f.alive); if (e && this.tier.id > 4) setTimeout(() => this.ctx.audio.vo('jeer_win', '', { x: e.x, y: e.y + 1.6, z: e.z }, 0.9), 1500); }
    return { won, score: fs.total, lines: fs.lines, time: s.time, headline: won ? 'SECTOR COMPLETE' : 'RUNNER OFFLINE', detail: won ? this.tier.name : 'Integrity lost — recompile and try again.',
      stats: [['Accuracy', s.throws ? Math.round((s.hits / s.throws) * 100) + '%' : '—'], ['Ricochet hits', String(s.ricochetHits)], ['Parries', String(s.parries)], ['Best combo', '×' + s.maxCombo], ['Damage taken', String(Math.round(s.damageTaken))], ['Time', s.time.toFixed(1) + ' s']] };
  }

  private onEvent(e: any) {
    const { vfx, audio, hud, xr, input, engine } = this.ctx, P = this.sim.player, f = e.id ? this.sim.fighter(e.id) : undefined, v = e.id ? this.fv.get(e.id) : undefined;
    const pos = f ? { x: f.x, y: f.y + 1.2, z: f.z } : undefined, mine = f?.isPlayer;
    switch (e.type) {
      case 'spawn': if (f && !this.fv.has(f.id)) { this.addFighter(f); const nv = this.fv.get(f.id)!; nv.late = true; nv.reveal.value = f.y - 0.2; audio.sfx('spawn', pos); if (e.summoned) this.totalEnemies++; } break;
      case 'ready': if (mine) { this.threw = true; audio.sfx('ready'); xr.pulse(xr.dominant, 0.2, 30); } break;
      case 'tell': if (v) { v.tell.visible = true; v.tellT = 0; v.tellDur = e.dur; (v.tell.material as THREE.MeshBasicMaterial).color.setHex(e.homing ? HOMING : HOSTILE); audio.sfx(e.homing ? 'tellHoming' : 'tell', pos, e.dur / 0.6); } break;
      case 'throw': { if (v) { v.throwT = 0.45; v.tell.visible = false; } audio.sfx(e.weapon === 'lance' ? 'lanceFire' : e.weapon === 'arc' ? 'arcBlade' : 'throw', pos); if (e.weapon && e.weapon !== 'disc') audio.sfx('throw', pos, 0.5); if (mine) { xr.pulse(xr.dominant, 0.7, 60); input.rumble(0.3, 0.6, 80); this.drawT = 0; } const dvv = this.dv.get(e.disc); if (dvv) { dvv.ribbon.reset(e.x, e.y, e.z); dvv.rise?.reset(e.x, e.y, e.z); const hc = e.homing ? HOMING : dvv.color; dvv.ribbon.setColor(hc); dvv.rise?.setColor(hc); } break; }
      case 'bounce': audio.sfx('ricochet', e, e.kind === 'barrier' ? 1.3 : e.kind === 'platform' ? 0.8 : 1); vfx.sparks(e.x, e.y, e.z, this.dv.get(e.disc)?.color ?? ION, 18, 8, 0.4, e); vfx.ring(e.x + e.nx * 0.05, e.y + e.ny * 0.05, e.z + e.nz * 0.05, this.th.accent, 0.2, 2.2, 0.4, e); for (const m of this.wallMats) m.uniforms.uFlash.value = Math.max(m.uniforms.uFlash.value, e.kind === 'wall' ? 0.05 : 0); break;
      case 'catch': if (mine) { audio.sfx('catch'); xr.pulse(xr.dominant, 0.5, 50); input.rumble(0.2, 0.4, 60); } break;
      case 'recall': if (mine) audio.sfx('recall'); break;
      case 'hit': vfx.sparks(e.x, e.y, e.z, mine ? HOSTILE : ION, 30, 10, 0.5, { x: e.dx, y: 0.4, z: e.dz }); vfx.ring(e.x, e.y, e.z, mine ? HOSTILE : ION, 0.1, 1.4, 0.25, { x: e.dx, y: 0, z: e.dz }); audio.sfx(mine ? 'hurt' : 'hit', e); if (mine) { audio.sfx('grunt'); engine.hurt(0.95, { x: -e.dx, y: 0, z: -e.dz }, true); if (v) v.hitFlash = 1; vfx.sparks(e.x, e.y, e.z, 0xffffff, 50, 12, 0.35, { x: e.dx, y: 0.3, z: e.dz }); vfx.ring(e.x, e.y, e.z, 0xff3020, 0.2, 2.6, 0.35, { x: e.dx, y: 0, z: e.dz }); this.slow(0.2, 0.15); engine.addShake(0.8); } if (v) { v.hitT = 0.4; v.hx = e.dx; v.hz = e.dz; } if (!mine) { this.crowd.excite(e.bounces > 0 ? 1 : 0.7); if (e.bounces > 0) audio.cheer(0.6); } break;
      case 'damage': if (mine) { if (e.cause !== 'disc') { audio.sfx('grunt'); engine.hurt(0.8); } hud.flash('hurt'); engine.addShake(0.6); xr.pulse('both', 0.9, 160); input.rumble(1, 0.8, 220); audio.intensity = Math.min(1, audio.intensity + 0.15); } break;
      case 'block': audio.sfx('block', e); vfx.sparks(e.x, e.y, e.z, 0xbfe9ff, 14, 6, 0.3); vfx.ring(e.x, e.y, e.z, 0xbfe9ff, 0.2, 1.4, 0.3, f ? { x: f.ax, y: 0, z: f.az } : undefined); if (mine) { xr.pulse(xr.offhand, 0.8, 90); input.rumble(0.6, 0.3, 100); } break;
      case 'parry': audio.sfx('parry', e); vfx.sparks(e.x, e.y, e.z, 0xffffff, 40, 13, 0.6); vfx.ring(e.x, e.y, e.z, 0xffffff, 0.3, 3.4, 0.45, f ? { x: f.ax, y: 0, z: f.az } : undefined); vfx.flash(e.x, e.y, e.z, 0xffffff, 14); if (mine) { hud.flash('good'); xr.pulse(xr.offhand, 1, 140); input.rumble(0.9, 0.9, 140); this.crowd.excite(1.2); audio.cheer(0.9); } break;
      case 'shieldUp': if (mine) this.shielded = true; audio.sfx('shieldUp', pos); if (mine) xr.pulse(xr.offhand, 0.3, 40); break;
      case 'shieldDown': if (mine) audio.sfx('shieldDown'); break;
      case 'shieldBreak': audio.sfx('shieldBreak', pos); if (f) vfx.sparks(f.x, f.y + 1.2, f.z, 0xbfe9ff, 40, 9, 0.7); if (mine) hud.toast('SHIELD BROKEN', 'danger'); else hud.toast('SHIELD BROKEN — STRIKE NOW', 'good'); break;
      case 'clash': audio.sfx('clash', e); vfx.sparks(e.x, e.y, e.z, 0xffffff, 26, 10, 0.4); vfx.ring(e.x, e.y, e.z, 0xffffff, 0.1, 1.6, 0.3); break;
      case 'jump': audio.sfx('jump', pos); break;
      case 'hop': audio.sfx('jump', pos); if (mine) { audio.sfx('whoosh', undefined, 0.8); xr.pulse('both', 0.5, 90); } break;
      case 'land': audio.sfx('land', pos); if (f) { vfx.ring(f.x, f.y + 0.05, f.z, mine ? ION : f.arch.tint, 0.3, mine ? 2.6 : 1.6, 0.4); if (v && !mine && v.inst.actions.Land) { v.inst.play('Land', 0.06, true); v.hold = 0.28; } } if (mine) { vfx.motes(P.x, P.y, P.z, ION, 1.6, 0.6, 30); xr.pulse('both', 0.7, 70); } break;
      case 'dodge': audio.sfx('dodge', pos); break;
      case 'evade': if (mine) hud.toast('EVADED', 'good'); break;
      case 'fall': audio.sfx('platformDown', pos); audio.sfx('scream', mine ? undefined : pos); if (mine) { hud.toast('FALLING', 'danger'); this.fallCam = 0.001; if (this.xr) engine.fadeTo(1, 1.4); xr.pulse('both', 0.8, 700); input.rumble(0.8, 0.6, 700); } break;
      case 'respawn': if (mine) { this.fallCam = 0; engine.fadeTo(0, 2.5); } if (f) { vfx.motes(f.x, f.y, f.z, mine ? ION : f.arch.tint, 0.7, 2, 40); audio.sfx('spawn', pos); } if (mine) engine.derezTo(0, 2.2); break;
      case 'shatter': {
        // the blow lands first: a white flash and a held beat. The body overloads and bursts a moment later (see the fighter view).
        vfx.sparks(e.x, e.y + 1.1, e.z, 0xffffff, 40, 13, 0.3); vfx.flash(e.x, e.y + 1.2, e.z, e.player ? ION : e.tint, 36); engine.addShake(e.boss ? 0.9 : e.player ? 0.8 : 0.4);
        this.slow(e.player ? 1.6 : e.boss ? 1.5 : 0.55, e.player ? 0.12 : e.boss ? 0.1 : 0.2);
        // a fall already screamed on the way down; only a disc kill screams here
        if (!e.player) { this.crowd.excite(e.boss ? 1.6 : 1.1); audio.cheer(e.boss ? 1.6 : e.cause === 'fall' ? 1.2 : 0.8); } else { if (e.cause !== 'fall') audio.sfx('scream'); xr.pulse('both', 1, 900); input.rumble(1, 1, 900); }
        break;
      }
      case 'score': hud.toast(`${e.label}  +${e.points}`, 'score'); break;
      case 'lastEnemy': audio.say('Final opponent remaining.'); break;
      case 'split': { const P = this.sim.player; for (const id of e.discs) if (!this.dv.has(id)) this.addDisc(id, P); hud.toast('SPLIT THROW', 'good'); audio.sfx('throw', pos); break; }
      case 'discGone': { const v = this.dv.get(e.disc); if (v && !this.sim.disc(e.disc)) { this.world.remove(v.root, v.ribbon.mesh); if (v.rise) this.world.remove(v.rise.mesh); this.dv.delete(e.disc); vfx.sparks(e.x ?? 0, e.y ?? 0, e.z ?? 0, ION, 14, 5, 0.35); } break; }
      case 'nodeSpawn': { const g = this.nodeMesh(e.kind); g.position.set(e.x, e.y, e.z); this.world.add(g); this.nodeV.set(e.node, { g, kind: e.kind }); vfx.motes(e.x, e.y, e.z, 0xffffff, 0.8, 2, 12); audio.sfx('pickup', e); if (!this.seenNode) { this.seenNode = true; hud.toast('POWER NODE ON YOUR SIDE — HOP TO IT', 'info'); } break; }
      case 'node': { const v = this.nodeV.get(e.node); if (v) { this.world.remove(v.g); this.nodeV.delete(e.node); } vfx.ring(e.x, e.y + 0.1, e.z, 0xffffff, 0.3, 3, 0.4); vfx.sparks(e.x, e.y + 1, e.z, 0xffffff, 30, 6, 0.5); audio.sfx('power'); xr.pulse('both', 0.5, 80);
        hud.toast(e.kind === 'split' ? 'SPLIT CHARGED — NEXT THROW FANS INTO THREE' : e.kind === 'pierce' ? 'PIERCE CHARGED — NEXT THROW GOES THROUGH SHIELDS' : 'MENDED  +30', 'good'); break; }
      case 'nodeGone': { const v = this.nodeV.get(e.node); if (v) { this.world.remove(v.g); this.nodeV.delete(e.node); } break; }
      case 'rally': if (e.broken) hud.toast('RALLY BROKEN', 'danger'); else if (e.value >= 1.15) { hud.toast(`RALLY ×${e.value.toFixed(1)}`, 'score'); if (e.value >= 1.59) audio.cheer(0.8); } break;
      case 'coreHit': { const cv = this.coreV; if (cv) cv.pips.forEach((m, i) => m.color.setHex(i < e.hp ? this.th.accent2 : 0x222831)); vfx.shatter(e.x, e.y, e.z, 0xffffff, 30, 1, undefined, 6); vfx.ring(this.sim.core!.x, this.sim.core!.y, this.sim.core!.z, 0xffffff, 1, 6, 0.5); audio.sfx('shatter', e); audio.cheer(0.6);
        hud.toast(e.hp > 0 ? `CORE HIT — ${e.hp} LEFT` : 'CORE BREACHED', 'score'); xr.pulse('both', 0.7, 120); break; }
      case 'coreDown': { const cv = this.coreV; if (cv) { vfx.derez(e.x, e.y - 2, e.z, this.th.accent2, { height: 4, count: 500, power: 12, big: true }); this.world.remove(cv.root); this.coreV = null; } hud.banner('CORE BREACHED', 'The rival side is wired to it', 2200); audio.sfx('explosion'); audio.cheer(1.4); engine.addShake(0.8); break; }
      case 'beamCut': vfx.sparks(e.x, e.y, e.z, 0xff2a14, 26, 7, 0.4); audio.sfx('shieldBreak'); hud.toast('CUT BY A BEAM — HOP OR DODGE ACROSS IT', 'danger'); if (!this.seenCut) { this.seenCut = true; audio.say('Beam contact.'); } break;
      case 'wave': hud.banner(`WAVE ${e.index + 1} / ${e.total}`, 'Reinforcements materialising', 2000); audio.say('Reinforcements inbound.'); break;
      case 'bossIntro': this.bossName = e.title; break;
      case 'bossPhase': if (!e.first) { hud.banner(`PHASE ${e.index + 1} — ${String(e.name).toUpperCase()}`, this.bossName, 2200); audio.sfx('boss'); audio.intensity = 1; if (f) { vfx.ring(f.x, f.y + 1, f.z, f.arch.tint, 0.5, 9, 0.9); vfx.flash(f.x, f.y + 1, f.z, f.arch.tint, 30); } this.crowd.excite(1.3); audio.cheer(1); } break;
      case 'command': if (f) { vfx.ring(f.x, f.y + 0.2, f.z, 0xffb62e, 0.5, 12, 0.8); audio.sfx('warn', pos); hud.toast('VOLLEY CALLED', 'danger'); } break;
      case 'disruptTell': if (f) { vfx.ring(f.x, f.y + 1.2, f.z, 0xb77bff, 0.3, 5, 1.1); audio.sfx('warn', pos); } break;
      case 'interference': this.interfere = e.on; if (e.on) { audio.sfx('interfere'); hud.toast('PLATFORM TRANSFER JAMMED', 'danger'); } else hud.toast('Transfer restored', 'good'); break;
      case 'platformWarn': audio.sfx('warn', this.platPos(e.index)); if (this.sim.platforms[e.index].side === 0) hud.toast(e.breaking ? 'DECK FAILING — HOP OFF' : 'PLATFORM UNSTABLE — MOVE', 'danger'); break;
      // breakable decks: every hit chips the deck, and the last one takes it out of the fight for good
      case 'deckHit': { vfx.sparks(e.x, e.y + 0.1, e.z, 0xffd9a0, 10, 5, 0.3); audio.sfx('scrape', e); audio.sfx('deckCrack', e); if (e.left <= 1 && this.sim.platforms[e.index].side === 0) hud.toast('DECK CRACKING', 'warn'); break; }
      case 'platformBreak': { const p = this.sim.platforms[e.index]; vfx.shatter(e.x, e.y, e.z, 0x9ad8ff, 90, p.r * 0.5); vfx.ring(e.x, e.y, e.z, 0x9ad8ff, 0.5, p.r * 2, 0.6); audio.sfx('shatter', e); audio.sfx('platformDown', e); audio.sfx('deckBreak', e); engine.addShake(0.5); if (p.side === 0) { hud.toast('DECK DESTROYED', 'danger'); audio.say('Deck destroyed.'); } else { hud.toast('ENEMY DECK DESTROYED', 'score'); audio.say('Their footing is gone.'); } break; }
      // a rival re-arming: the weapon change is announced so the counter-play can change with it
      case 'rearm': { vfx.ring(e.x, e.y + 1, e.z, e.tint, 0.5, 4.5, 0.6); vfx.flash(e.x, e.y + 1.2, e.z, e.tint, 18); audio.sfx('power', e); audio.sfx('rearm', e); hud.toast(`${String(e.name).toUpperCase()} — ${e.weapon === 'lance' ? 'UNBLOCKABLE BOLTS' : e.weapon === 'arc' ? 'DECK-BREAKING BLADES' : 'RE-ARMED'}`, 'danger'); audio.say(e.weapon === 'lance' ? 'Lance array online.' : e.weapon === 'arc' ? 'Arc blades online.' : 'Opponent re-armed.'); break; }
      case 'pierce': { vfx.sparks(e.x, e.y, e.z, 0x9fd8ff, 22, 9, 0.35); audio.sfx('hit', e); audio.sfx('lanceImpact', e); if (e.id === 0) { hud.flash('hurt'); hud.toast('LANCE PIERCED YOUR SHIELD — DODGE IT', 'danger'); engine.addShake(0.4); } break; }
      case 'platformDown': audio.sfx('platformDown', this.platPos(e.index)); break;
      case 'platformUp': audio.sfx('platformUp', this.platPos(e.index)); break;
      case 'surgeWarn': audio.sfx('warn', this.platPos(e.index)); if (P.platform === e.index) hud.toast('SURGE — JUMP', 'danger'); break;
      case 'surge': { const p = this.sim.platforms[e.index]; audio.sfx('surge', this.platPos(e.index)); vfx.sparks(p.x, p.y + 0.2, p.z, 0xffe14a, 60, 7, 0.5, { x: 0, y: 1.5, z: 0 }); vfx.ring(p.x, p.y + 0.1, p.z, 0xffe14a, 0.5, p.r, 0.35); break; }
      case 'shift': audio.sfx('shift'); hud.toast('ARENA RECONFIGURING', 'warn'); break;
      case 'barrierBreak': { audio.sfx(e.volatile ? 'explosion' : 'shieldBreak', e); vfx.shatter(e.x, e.y, e.z, e.volatile ? 0xff5533 : 0xffb62e, 40, 0.5); break; }
      case 'barrierAdd': this.addBarrierView(e.index); break;
      case 'amp': audio.sfx('boost', e, 1.2); vfx.ring(e.x, e.y, e.z, AMP, 0.6, 2.4, 0.35, { x: 0, y: 0, z: 1 }); vfx.sparks(e.x, e.y, e.z, AMP, 26, 9, 0.4); if (e.team === 0) { xr.pulse(xr.dominant, 0.4, 40); if (!this.ampSeen) { this.ampSeen = true; hud.toast('AMPLIFIED — FASTER, HARDER HIT', 'score'); } } else hud.toast('RIVAL DISC AMPLIFIED', 'danger'); break;
      case 'explosion': vfx.ring(e.x, e.y, e.z, 0xff8844, 0.5, e.r, 0.5); vfx.sparks(e.x, e.y, e.z, 0xffaa55, 90, 16, 0.9); vfx.flash(e.x, e.y, e.z, 0xff8844, 60); engine.addShake(0.8); break;
    }
  }
  private platPos(i: number) { const p = this.sim.platforms[i]; return { x: p.x, y: p.y, z: p.z }; }

  // ------------------------------------------------------------ presentation
  protected view(dt: number, alpha: number, a: Actions) {
    this.animateObjectives(dt, a); this.beams?.update(this.sim.discs, this.sim.time);
    const { engine, hud, audio, vfx, xr } = this.ctx, sim = this.sim, P = sim.player, t = engine.elapsed, cam = engine.camera;
    this.ambient.update(t, this.phase === 'play' ? clamp(0.35 + this.sim.activeAttackers() * 0.2 + (this.sim.rally - 1), 0, 1) : 0.2); this.frames.update(t, this.ambient.beatLevel);
    for (const m of this.timed) { m.uniforms.uTime.value = t; if (m.uniforms.uFlash) m.uniforms.uFlash.value *= Math.exp(-6 * dt); }
    if (this.slowT > 0) { this.slowT -= dt; const k = clamp(1 - this.slowT / this.slowDur, 0, 1); this.timeScale = this.slowT <= 0 ? 1 : lerp(this.slowMin, 1, smooth(clamp((k - 0.45) / 0.55, 0, 1))); if (this.slowT <= 0) this.slowMin = 1; }
    this.crowd.update(dt, t); this.drones.orbit(dt, 0, 4, 0, sim.cfg.arena.radius + 3.5, this.look.set(P.x, P.y + 1.2, P.z)); vfx.update(dt); if (!this.xr && this.vrDisc) this.vrDisc.visible = false;
    // platforms
    sim.platforms.forEach((p, i) => {
      const v = this.pv[i]; v.sink = damp(v.sink, p.state === 'down' ? 1 : 0, 5, dt);
      // intro: the arena assembles round the player. Their own deck is already there; every other deck rises out of the
      // void in turn and locks in with a ring of light, before the rivals form on them
      let rise = 0; if (this.phase === 'intro' && i !== this.sim.player.platform) { const order = this.pv.length > 1 ? i / (this.pv.length - 1) : 0, k = clamp((this.t - 0.25 - order * 1.1) / 0.9, 0, 1), e = 1 - Math.pow(1 - k, 3); rise = (1 - e) * 22;
        if (k >= 1 && !this.locked.has(i)) { this.locked.add(i); this.ctx.vfx.ring(p.x, p.y + 0.05, p.z, this.th.accent, p.r * 0.6, p.r * 1.6, 0.5); this.ctx.audio.sfx('platformUp', { x: p.x, y: p.y, z: p.z }); } }
      v.root.position.set(p.x, p.y - v.sink * 16 - rise, p.z); v.root.visible = v.sink < 0.97;
      const rm = v.ring.material as THREE.MeshBasicMaterial, warn = p.state === 'warn';
      // a deck about to go carries a hazard sign over it, pulsing, and the player's own deck sounds a klaxon
      if (warn && !v.sign) { v.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: hazardSign(), transparent: true, depthWrite: false, depthTest: false })); v.sign.scale.set(2.4, 2.4, 1); v.sign.renderOrder = 30; v.root.add(v.sign); }
      if (v.sign) { v.sign.visible = warn; if (warn) { v.sign.position.y = 3.4 + 0.25 * Math.sin(t * 6); (v.sign.material as THREE.SpriteMaterial).opacity = 0.6 + 0.4 * Math.abs(Math.sin(t * 8)); if (i === P.platform && Math.floor(t * 2.5) !== v.klaxon) { v.klaxon = Math.floor(t * 2.5); this.ctx.audio.sfx('warn'); } } }
      v.ring.scale.setScalar(warn ? 1 + 0.03 * Math.sin(t * 28) : 1); rm.color.setHex(warn ? (Math.sin(t * 28) > 0 ? 0xffffff : 0xff3b30) : p.side === 0 ? (this.interfere ? 0xb77bff : ION) : this.th.accent2 === ION ? 0xff8a3c : this.th.accent2);
      const sm = v.surge.material as THREE.MeshBasicMaterial, target = i === this.hopTo && !P.hop && !P.falling;
      // deck wash: red and quickening = this platform is about to drop; yellow = a surge is charging; soft blue = your hop target
      if (warn) { sm.color.setHex(0xff2a2a); sm.opacity = 0.2 + 0.3 * Math.abs(Math.sin(t * 9)); } else if (p.surgeArmed) { sm.color.setHex(0xffe14a); sm.opacity = 0.18 + 0.3 * Math.abs(Math.sin(t * (10 + (1.5 - p.surge) * 14))); } else if (target) { sm.color.setHex(ION); sm.opacity = 0.1 + 0.07 * Math.sin(t * 5); } else sm.opacity = 0;
      (v.beam.material as THREE.MeshBasicMaterial).opacity = target ? 0.3 : 0.07; if (target) rm.color.setHex(0xffffff);
    });
    sim.amps.forEach((a, i) => { const v = this.av[i]; if (!v) return; v.g.position.set(a.x, a.y, a.z); v.g.rotation.z = t * 0.6 + i; const k = a.flash / 0.5; v.g.scale.setScalar(1 + 0.25 * k); v.fill.opacity = 0.07 + 0.04 * Math.sin(t * 3 + i) + 0.4 * k; const base = sim.cfg.arena.floor, h = a.y - 1.25 - base; v.mast.scale.y = Math.max(0.01, h); v.mast.position.set(a.x, base + h / 2, a.z); });
    sim.barriers.forEach((b, i) => { const o = this.bv[i]; if (!o) return; o.visible = b.alive; if (!b.alive) return; o.position.set(b.x, b.y, b.z); o.rotation.y = b.yaw; if (b.def.volatile) { o.rotation.x = t * 0.9; o.scale.setScalar(1 + 0.12 * Math.sin(t * 7)); } else if (!b.def.pillar) { const m = (o.children[0] as THREE.Mesh).material as THREE.ShaderMaterial; m.uniforms.uFlash.value = Math.max(m.uniforms.uFlash.value, b.flash > 0 ? 0.5 : 0); if (b.def.hp > 0) m.uniforms.uOpacity.value = 0.2 + 0.35 * (b.hp / b.def.hp); } });
    // fighters
    for (const f of sim.fighters) {
      const v = this.fv.get(f.id); if (!v) continue;
      if (!f.alive) {
        const boss = !!f.arch.boss, col = f.isPlayer ? ION : f.arch.tint, fell = f.y < (sim.platforms[f.platform]?.y ?? f.y) - 1.5;
        if (!v.dead) { v.dead = true; v.deathT = fell ? 0.01 : f.isPlayer ? 0.6 : boss ? 1.25 : 0.3; v.deathDur = v.deathT; v.baseY = v.root.position.y; v.popT = 0; v.inst.play('HitFall', 0.05, true); v.shield.visible = false; v.tell.visible = false; v.ring.visible = false; if (v.marker) v.marker.visible = false; if (v.hx === undefined) { const l = Math.hypot(f.x - P.x, f.z - P.z) || 1; v.hx = f.isPlayer ? 0 : (f.x - P.x) / l; v.hz = f.isPlayer ? 0 : (f.z - P.z) / l; } }
        if (v.deathT > 0) {
          // overload: the body locks, lifts off the deck and shudders while it comes apart from the head down
          v.deathT -= dt; const k = clamp(1 - v.deathT / (v.deathDur || 0.3), 0, 1), lift = (boss ? 0.9 : 0.4) * smooth(k), jit = 0.05 * k; v.root.visible = true;
          v.root.position.y = v.baseY! + lift; v.inst.root.position.set((Math.random() - 0.5) * jit, 0, (Math.random() - 0.5) * jit); v.inst.root.scale.setScalar(f.arch.scale * (1 + 0.05 * k * Math.sin(k * 50)));
          v.reveal.value = v.baseY! + lift + v.height * (1.2 - 0.5 * k); v.inst.mixer?.update(dt * 0.35);
          vfx.motes(v.root.position.x, v.reveal.value - 0.1, v.root.position.z, col, 0.4, 0.2, 4);
          if (Math.random() < 0.5) vfx.sparks(v.root.position.x, v.baseY! + lift + Math.random() * v.height, v.root.position.z, Math.random() < 0.5 ? 0xffffff : col, 6, 6, 0.3);
          // a boss cracks apart in stages before it goes
          if (boss) { v.popT! -= dt; if (v.popT! <= 0) { v.popT = 0.2 - 0.12 * k; const a = Math.random() * 6.283, hy = v.baseY! + lift + (0.3 + Math.random() * 0.7) * v.height; vfx.sparks(v.root.position.x, hy, v.root.position.z, col, 26, 11, 0.5, { x: Math.cos(a), y: 0.2, z: Math.sin(a) }); vfx.ring(v.root.position.x, hy, v.root.position.z, 0xffffff, 0.2, 2.4 + k * 2, 0.3, { x: Math.cos(a), y: 0, z: Math.sin(a) }); vfx.flash(v.root.position.x, hy, v.root.position.z, col, 22); audio.sfx('hit', { x: f.x, y: hy, z: f.z }); engine.addShake(0.2); } }
        } else if (!v.burst) {
          v.burst = true; v.root.visible = false; const plat = sim.platforms[f.platform], x = v.root.position.x, z = v.root.position.z;
          // in a headset this is your own body going: keep the pieces below eye level and start them clear of your face
          const own = f.isPlayer && this.xr;
          vfx.derez(x, fell ? v.root.position.y : v.baseY!, z, col, { height: own ? 1.25 : v.height, dir: { x: (v.hx ?? 0) * (f.isPlayer ? 0.5 : 1), z: (v.hz ?? 0) * (f.isPlayer ? 0.5 : 1) }, count: boss ? 620 : f.isPlayer ? 420 : 240, power: boss ? 12 : f.isPlayer ? 9 : 7.5, floorR: fell ? 0 : plat?.r ?? 5, big: boss || f.isPlayer, inner: own ? 0.3 : 0 });
          audio.sfx('shatter', { x, y: v.baseY!, z }); if (boss || f.isPlayer) audio.sfx('explosion', { x, y: v.baseY!, z }); engine.addShake(boss ? 1 : f.isPlayer ? 0.9 : 0.5); if (f.isPlayer) { xr.pulse('both', 1, 500); this.ctx.input.rumble(1, 1, 500); }
        }
        continue;
      }
      const x = lerp(f.px, f.x, alpha), y = lerp(f.py, f.y, alpha), z = lerp(f.pz, f.z, alpha);
      const self = f.isPlayer && this.xr; v.root.position.set(x, y, z);
      // anyone on the move, player or rival, turns to run the way they are going, then turns back to face the target
      // to throw or guard (hysteresis keeps a fighter from flicking between the two at walking pace)
      const travel = !f.winding && v.throwT <= 0 && !f.shieldUp && f.dodgeT <= 0 && f.moving > (v.travel ? 1.3 : 2), face = travel ? Math.atan2(f.vx, f.vz) : f.yaw; v.travel = travel;
      v.yaw = angleLerp(v.yaw ?? f.yaw, face, 1 - Math.exp(-(travel ? 10 : 14) * dt)); v.inst.root.rotation.y = v.yaw;
      v.run = f.moving > (v.run ? 3 : 3.8); v.lean = damp(v.lean ?? 0, v.run && travel ? 0.09 : 0, 6, dt); v.inst.root.rotation.x = v.lean; v.inst.root.visible = !self; v.ring.visible = !self;
      if (f.spawnT > 0 && this.introDone && v.late) { v.reveal.value = f.y - 0.2 + (1 - f.spawnT / 1.4) * 2.8 * f.arch.scale; if (Math.random() < 0.6) vfx.motes(f.x, f.y, f.z, f.arch.tint, 0.6, 2, 2); } else if (this.introDone) v.reveal.value = 50;
      // animation state from simulation state
      v.throwT -= dt; v.hitT -= dt; v.hold -= dt; const I = v.inst;
      if (v.hitShell) { v.hitFlash = Math.max(0, (v.hitFlash ?? 0) - dt * 3.2); v.hitShell.visible = v.hitFlash > 0.01; (v.hitShell.material as THREE.MeshBasicMaterial).opacity = 0.55 * v.hitFlash; v.hitShell.scale.set(0.55 + 0.15 * (1 - v.hitFlash), 1.05 + 0.1 * (1 - v.hitFlash), 0.55 + 0.15 * (1 - v.hitFlash)); }
      if (v.hold > 0) { /* a staged one-shot is playing */ } else if (f.falling) I.play('Fall'); else if (f.hop || f.jumpT > 0) I.play('Jump'); else if (v.hitT > 0.12) I.play('HitAir', 0.1); else if (f.dodgeT > 0) I.play('Dodge', 0.06); else if (f.winding && I.actions.Throw) {
        // the wind-up scrubs the throw clip, so the arm reaches its release pose exactly as the disc leaves
        const a = I.actions.Throw; if (!v.scrub) { I.play('Throw', 0.12, true); v.scrub = true; } a.paused = true; a.time = this.releaseAt(I) * clamp(f.wind / Math.max(0.2, f.isPlayer ? 0.5 : f.arch.windup), 0, 1);
      } else if (v.throwT > 0 && I.actions.Throw) { const a = I.actions.Throw; if (I.current !== 'Throw') { I.play('Throw', 0.05, true); a.time = this.releaseAt(I); } a.paused = false; a.timeScale = 1.2; v.scrub = false; }
      else if (f.shieldUp) I.play('Block', 0.08);
      else if (f.moving > 1.2) { const run = !!v.run, n = run ? 'Run' : 'Walk'; I.play(n, 0.28); if (I.actions[n]) I.actions[n].timeScale = clamp(f.moving / (run ? 4.8 : 2), 0.65, 1.6); }
      else I.play(sim.heldDiscs(f) > 0 && !f.isPlayer && f.throwCd <= 0.6 ? 'HoldDisc' : 'Idle', 0.35);
      if (!f.winding && v.throwT <= 0) v.scrub = false;
      I.mixer?.update(dt);
      const held = sim.heldDiscs(f); if (v.props.hand) v.props.hand.visible = f.winding; if (v.props.back) v.props.back.visible = held > (f.winding ? 1 : 0); if (v.props.shield) v.props.shield.visible = false;
      v.shield.visible = f.shieldUp; if (f.shieldUp) { if (self) {
          // strapped to the off-hand forearm: its face lies along the arm and it goes wherever the arm goes
          const an = xr.handAnchor(xr.offhand), sg = xr.offhand === 'left' ? -1 : 1; an.updateWorldMatrix(true, false);
          v.shield.position.copy(this.v2.set(sg * 0.08, 0.02, 0.11).applyMatrix4(an.matrixWorld)).sub(v.root.position); v.shield.scale.setScalar(0.4);
          v.shield.quaternion.copy(an.getWorldQuaternion(this.qa)).multiply(this.qb.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, sg * Math.PI / 2)).multiply(this.qb.setFromAxisAngle(this.v2.set(0, 0, 1), t * 0.7));
        } else { v.shield.position.set(f.ax * 0.8, 1.25, f.az * 0.8); v.shield.scale.setScalar(1); v.shield.rotation.set(0, f.yaw, t * 0.7, 'YXZ'); } const u = (v.shield.material as THREE.ShaderMaterial).uniforms; u.uOpacity.value = 0.5 + 0.5 * (f.shield / f.maxShield); u.uFlash.value = f.shieldT < 0.22 ? 0.6 : 0; }
      if (v.tell.visible) { v.tellT += dt; const k = clamp(v.tellT / v.tellDur, 0, 1); v.tell.position.set(f.ax * 0.5, 1.5, f.az * 0.5); v.tell.lookAt(cam.getWorldPosition(this.v)); v.tell.scale.setScalar(3.2 - 2.4 * k); v.tell.rotateZ(k * 3); (v.tell.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.7 * k; if (!f.winding && v.tellT > 0.1) v.tell.visible = false; }
      v.ring.visible = !self && !f.falling && !f.hop && f.jumpT <= 0; (v.ring.material as THREE.MeshBasicMaterial).opacity = f.invuln > 0 ? 0.3 + 0.5 * Math.abs(Math.sin(t * 20)) : 0.85;
      if (v.marker && Math.abs(v.hpShown - (f.hp + (f.shieldLock > 0 ? 0.5 : 0))) > 0.01) this.drawMarker(v, f);
    }
    // discs
    const hums: { x: number; y: number; z: number; pitch: number; gain: number }[] = [], incoming: { x: number; y: number; z: number; tca: number; homing: boolean }[] = [];
    cam.getWorldPosition(this.eye);
    for (const d of sim.discs) {
      const v = this.dv.get(d.id); if (!v) continue; const fly = d.state !== 'held';
      v.root.visible = fly; v.ribbon.mesh.visible = fly; if (v.rise) v.rise.mesh.visible = fly; if (!fly) { v.shown = 0; continue; }
      // show the body that matches what was actually thrown
      if (v.lance || v.arc) { const w = d.weapon ?? 'disc'; v.model.visible = w === 'disc'; if (v.lance) v.lance.visible = w === 'lance'; if (v.arc) v.arc.visible = w === 'arc'; }
      const x = lerp(d.px, d.x, alpha), y = lerp(d.py, d.y, alpha), z = lerp(d.pz, d.z, alpha);
      v.root.position.set(x, y, z); v.model.rotation.y = t * (v.hostile ? 22 : 30); v.ribbon.push(x, y, z); v.rise?.push(x, y, z);
      const homing = d.homing > 0 && d.age < 1.7, gm = v.glow.material as THREE.MeshBasicMaterial;
      if (v.hostile) {
        // live = still able to hurt you. A parried or spent disc goes dull so it stops asking for attention.
        const live = d.state === 'flying' && !d.parried, col = !live ? 0x6a3a30 : homing ? HOMING : HOSTILE; v.rim!.color.setHex(col); gm.color.setHex(col); gm.opacity = live ? 0.4 : 0.12; v.glow.scale.setScalar(homing ? 1.2 + 0.25 * Math.sin(t * 24) : 1);
        // bracket: steady and small while the disc is loose, then large and closing as it bears down on you
        const ex = this.eye.x - x, ey = this.eye.y - 0.35 - y, ez = this.eye.z - z, sp2 = d.vx * d.vx + d.vy * d.vy + d.vz * d.vz || 1, tca = (ex * d.vx + ey * d.vy + ez * d.vz) / sp2;
        const miss = Math.hypot(ex - d.vx * tca, ey - d.vy * tca, ez - d.vz * tca), bearing = live && tca > 0 && tca < 1.5 && (miss < 1.5 || homing), mm = v.mark!.material as THREE.SpriteMaterial;
        v.shown = damp(v.shown, bearing ? 1 : 0, bearing ? 30 : 8, dt); const urge = clamp(1 - tca / 1.5, 0, 1);
        mm.color.setHex(homing ? HOMING : bearing && urge > 0.6 && Math.sin(t * 40) > 0 ? 0xffe9c0 : HOSTILE); mm.opacity = live ? 0.3 + 0.7 * v.shown : 0; mm.rotation = t * (bearing ? 5 : 1.2);
        v.mark!.scale.setScalar(lerp(1.05, lerp(3.4, 1.15, urge), v.shown));
        if (bearing) incoming.push({ x, y, z, tca, homing });
      } else { v.glow.scale.setScalar(1.1); gm.color.setHex(d.parried ? 0xffffff : v.color); }
      // amplified: a gold corona that throbs, whichever side threw it
      if (d.amped && d.state === 'flying') { gm.color.setHex(AMP); gm.opacity = 0.55; v.glow.scale.setScalar(1.6 + 0.3 * Math.sin(t * 30)); }
      if (d.team === 1 && d.state === 'flying') hums.push({ x, y, z, pitch: homing ? 330 : 220, gain: 0.05 });
    }
    audio.hums(hums.slice(0, 4));
    this.drawIncoming(incoming, t);
    // camera
    if (this.xr) {
      xr.showRays = false;
      // the held disc sits in the glove, edge-forward. A throw empties the hand; the next disc is drawn a beat later.
      const palm = xr.handAnchor(xr.dominant), vd = this.vrDisc!; if (vd.parent !== palm) palm.add(vd); this.drawT += dt;
      const draw = clamp((this.drawT - 0.55) / 0.22, 0, 1); vd.visible = sim.heldDiscs(P) > 0 && draw > 0; vd.scale.setScalar(0.25 + 0.75 * draw);
      vd.position.set(xr.dominant === 'left' ? 0.02 : -0.02, 0.05, -0.19); vd.rotation.set(P.winding ? t * 24 : 0, 0, Math.PI / 2); xr.showHands = true;
      if (!this.recentred) { this.recentred = true; this.offset.copy(cam.position).setY(0); engine.rig.rotation.set(0, 0, 0); }
      const rig = engine.rig, off = this.v.copy(this.offset).applyQuaternion(rig.quaternion);
      const px = lerp(P.px, P.x, alpha), pz = lerp(P.pz, P.z, alpha), plat = sim.platforms[P.platform];
      const seatY = (this.ctx.settings.vr.seated ? 0.45 : 0) + this.ctx.settings.vr.height;
      const fy = P.hop || P.falling ? rig.position.y : (P.jumpT > 0 ? plat?.y ?? P.y : P.y) + (this.ctx.settings.vr.seated ? 0.45 : 0) + this.ctx.settings.vr.height;
      // comfort: hops and falls are a fade + relocation, never an arc or an uncontrolled drop
      // a hop is a quick level glide to the next platform under a comfort vignette: no arc, and never a blackout
      if (P.hop) { const h = P.hop, q = sim.platforms[h.to]; const k = clamp(h.t, 0, 1); rig.position.set(px - off.x, lerp(h.sy, q.y, smooth(k)) + Math.sin(Math.PI * k) * 0.45 + seatY, pz - off.z); if (Math.random() < 0.8) vfx.motes(px, lerp(h.sy, q.y, k) + 0.2, pz, ION, 0.5, 0.3, 3); }
      else if (!P.falling) rig.position.set(px - off.x, fy, pz - off.z);
      xr.update(dt, true); engine.vignetteAmount = P.hop ? this.ctx.settings.vr.vignette * 0.9 : 0;
    } else if (this.phase !== 'intro') {
      const pad = a.device === 'pad'; let k = 1;
      if (pad && this.ctx.settings.aimAssist) for (const f of sim.fighters) if (f.team === 1 && f.alive) { const tx = f.x - this.camPos.x, ty = f.y + 1.1 - this.camPos.y, tz = f.z - this.camPos.z, l = Math.hypot(tx, ty, tz) || 1, cp = Math.cos(this.pitch); if ((tx / l) * Math.sin(this.yaw) * cp + (ty / l) * Math.sin(this.pitch) + (tz / l) * Math.cos(this.yaw) * cp > 0.9985) k = 0.55; }
      this.yaw -= a.lookX * k; this.pitch = clamp(this.pitch - a.lookY * k, -0.75, 0.9);
      const px = lerp(P.px, P.x, alpha), py = lerp(P.py, P.y, alpha), pz = lerp(P.pz, P.z, alpha), cp = Math.cos(this.pitch);
      const fx = Math.sin(this.yaw) * cp, fyv = Math.sin(this.pitch), fz = Math.cos(this.yaw) * cp, rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
      const out = this.phase === 'outro' ? 1 + this.t * 0.5 : 1, dist = 4.7 * out;
      this.v.set(px - fx * dist + rx * 0.95, py + 2.05 - fyv * dist * 0.8, pz - fz * dist + rz * 0.95);
      if (this.v.y < py + 0.5) this.v.y = py + 0.5;
      this.camPos.x = this.v.x; this.camPos.z = this.v.z; this.camPos.y = damp(this.camPos.y, this.v.y, 14, dt);
      cam.position.copy(this.camPos); cam.lookAt(this.camPos.x + fx * 20, this.camPos.y + fyv * 20, this.camPos.z + fz * 20);
      // falling: the camera stays at the rim and watches the body drop away into the void
      if (this.fallCam > 0) { this.fallCam += dt; if (this.fallCam < 0.05) this.fallFrom.copy(cam.position); cam.position.copy(this.fallFrom); cam.lookAt(P.x, P.y + 0.9, P.z); }
      const tf = P.winding ? 50 : 56; if (Math.abs(cam.fov - tf) > 0.1) { cam.fov = damp(cam.fov, tf, 8, dt); cam.updateProjectionMatrix(); }
    }
    if (this.phase === 'outro' && sim.state === 'lost') { this.outroDur = 3.6; engine.derez = Math.max(0.22 * Math.exp(-this.t * 5) , smooth(clamp((this.t - 1.7) / 1.5, 0, 1)) * 0.97); engine.derezTarget = engine.derez; }
    cam.getWorldPosition(this.v); cam.getWorldDirection(this.v2); audio.listener(this.v.x, this.v.y, this.v.z, this.v2.x, this.v2.y, this.v2.z);
    // music follows risk: more attackers / low integrity raise the percussion layers
    if (this.phase === 'play') audio.intensity = damp(audio.intensity, clamp(0.45 + sim.enemiesAlive() * 0.1 + (P.hp < P.maxHp * 0.4 ? 0.25 : 0) + (this.tier.boss ? 0.2 : 0), 0, 1), 1.5, dt);
    if (P.hp < this.lastHp - 0.5) this.lastHp = P.hp; else this.lastHp = P.hp;
    // coaching for the opening tiers: the goal, then each core control until it has been used
    const dev = a.device; hud.menuHint = ctl(dev, 'ESC — MENU', 'START — MENU', `HOLD ${xr.labels.menu} — MENU / EXIT`); hud.drawVR(dt);
    const failing = this.phase === 'play' && sim.platforms[P.platform]?.state === 'warn' && !P.hop;
    if (failing) hud.coach('THIS PLATFORM IS ABOUT TO DROP — ' + ctl(dev, 'MOVE TOWARD ANOTHER AND PRESS SPACE', 'PUSH TOWARD ANOTHER AND PRESS A', 'LOOK AT ANOTHER AND PRESS ' + xr.labels.jump));
    else if (this.phase === 'play' && this.early) hud.coach(sim.time < 4 ? 'GOAL: HIT EVERY RIVAL WITH YOUR DISC — DISCS BOUNCE OFF WALLS AND RETURN TO YOU' : !this.threw ? 'THROW:  ' + ctl(dev, 'aim with the MOUSE · hold and release LEFT CLICK', 'aim RIGHT STICK · hold and release RT', 'close your hand on the TRIGGER, swing or point at a rival, and let go') : !this.shielded && sim.time > 9 ? 'SHIELD:  ' + ctl(dev, 'hold RIGHT CLICK — raise it late to parry', 'hold LT — raise it late to parry', 'hold the other hand\'s TRIGGER — raise it late to parry') : (this.tier.id === 2 || this.tier.id === 4) && sim.time < 24 ? 'HOP PLATFORMS:  ' + ctl(dev, 'SPACE + a direction (the lit platform is where you will land)', 'A + a direction', 'look at a platform (it lights up) and press ' + xr.labels.jump) : null);
    else if (this.phase === 'play') hud.coach(null);
    // HUD model
    const threats: { a: number; homing: boolean; near: number }[] = [], cy = this.xr ? xr.headYaw() : this.yaw;
    for (const d of sim.discs) if (d.state === 'flying' && d.team === 1) { const rx = P.x - d.x, rz = P.z - d.z, dist = Math.hypot(rx, rz), sp = Math.hypot(d.vx, d.vz) || 1; if ((d.vx * rx + d.vz * rz) / (sp * (dist || 1)) > 0.8 && dist < 40) threats.push({ a: Math.atan2(-rx, -rz) - cy, homing: d.homing > 0, near: clamp(1 - dist / 40, 0, 1) }); }
    let boss: any = null; for (const f of sim.fighters) if (f.arch.boss && f.alive) boss = { name: f.arch.boss.title, frac: f.hp / f.maxHp, phase: f.phase + 1, phases: f.arch.boss.phases.length, phaseName: f.arch.boss.phases[Math.max(0, f.phase)].name };
    hud.update({ tier: this.tier, hp: P.hp, maxHp: P.maxHp, shield: P.shield, maxShield: P.maxShield, shieldLock: P.shieldLock > 0, shieldUp: P.shieldUp, discs: P.discIds.map((id) => sim.disc(id)!.state), enemies: sim.enemiesRemaining(), score: Math.round(sim.stats.score), combo: sim.combo, charge: P.winding ? clamp(P.wind / 0.5, 0, 1) : 0, interfere: this.interfere, threats, boss, locked: this.ctx.input.locked || this.xr || a.device === 'pad', phase: this.phase, wave: sim.cfg.waves.length > 1 ? `${sim.wave + 1}/${sim.cfg.waves.length}` : '' });
  }

  dispose() { this.vrDisc?.removeFromParent(); this.vrDisc?.scale.setScalar(1); for (const m of this.arrows) { m.removeFromParent(); m.geometry.dispose(); } this.ctx.xr.showRays = false; this.ctx.input.setPointerLock(false); this.ctx.audio.hums([]); this.ctx.engine.fadeTo(0); this.ctx.engine.derez = 0; this.ctx.engine.derezTo(0); const c = this.ctx.engine.camera; c.fov = 62; c.updateProjectionMatrix(); this.world.remove(this.ctx.vfx.group); }
}
