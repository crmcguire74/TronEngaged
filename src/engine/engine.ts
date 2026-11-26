import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { gridEnvironment } from './env';
import type { Settings } from '../persistence/store';

export const FIXED_DT = 1 / 120;
const QUALITY = { low: { dpr: 1, bloom: false, shadows: false }, medium: { dpr: 1.5, bloom: true, shadows: false }, high: { dpr: 2, bloom: true, shadows: true } };

/** Owns the renderer, the persistent camera rig and the desktop post chain. VR renders directly (no composer). */
export class Engine {
  readonly renderer: THREE.WebGLRenderer; readonly scene = new THREE.Scene(); readonly rig = new THREE.Group();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.08, 2400);
  world = new THREE.Group();
  private composer: EffectComposer; private bloom: UnrealBloomPass; private useBloom = true;
  shake = 0; private shakeOff = new THREE.Vector3(); reducedMotion = false;
  /** Full-screen fade used for comfort transitions (works in VR: it is a mesh on the camera). */
  private fadeMesh: THREE.Mesh; fade = 0; fadeTarget = 0; fadeSpeed = 3;
  private vignette: THREE.Mesh; vignetteAmount = 0;
  /** 0..1: the view breaks up into squares of light that wink out. Works in VR (it is a mesh on the camera). */ derez = 0; derezTarget = 0; derezSpeed = 2; private derezMesh: THREE.Mesh;
  /** Eye position at the last render, for distance LODs (one frame stale, which nothing can see). */ readonly viewPos = new THREE.Vector3();
  /** Multiplies every LOD distance: below 1 pulls detail in sooner. Lowered by the frame-time governor under load. */ lodScale = 1;
  /** Damage flash: a red glow round the edge of the view, heaviest on the side the hit came from. A mesh on the camera, so it shows in a headset. */
  private hurtMesh: THREE.Mesh; private hurtAmt = 0; private hurtDir = new THREE.Vector3(); private hq = new THREE.Quaternion();
  elapsed = 0; private stats = { calls: 0, triangles: 0 } as { calls: number; triangles: number };

  constructor(canvas: HTMLCanvasElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false }));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.xr.enabled = true; r.info.autoReset = false;
    this.scene.background = new THREE.Color(0x020308);
    // a night-grid reflection probe, not a white studio: see gridEnvironment
    const pm = new THREE.PMREMGenerator(r); const envScene = gridEnvironment(); this.scene.environment = pm.fromScene(envScene, 0.03).texture; this.scene.environmentIntensity = 1.15; pm.dispose();
    envScene.traverse((o: any) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.rig.name = 'rig'; this.rig.add(this.camera); this.scene.add(this.rig, this.world);
    this.fadeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
    this.fadeMesh.renderOrder = 10000; this.fadeMesh.frustumCulled = false; this.fadeMesh.visible = false; this.camera.add(this.fadeMesh);
    // comfort vignette: an inward-facing tunnel ring that narrows peripheral vision during fast motion in VR
    const vg = new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, uniforms: { uAmt: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uAmt; varying vec3 vP; void main(){ vec3 d = normalize(vP); float a = acos(clamp(-d.z,-1.0,1.0)); float edge = mix(1.25, 0.5, uAmt); gl_FragColor = vec4(0.0,0.0,0.0, smoothstep(edge, edge + 0.28, a) * step(0.001, uAmt)); }' });
    this.vignette = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), vg); this.vignette.renderOrder = 9999; this.vignette.frustumCulled = false; this.vignette.visible = false; this.camera.add(this.vignette);

    const dz = new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, uniforms: { uAmt: { value: 0 }, uTime: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uAmt, uTime; varying vec3 vP;
        float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        void main(){ vec3 d = normalize(vP); vec2 uv = vec2(atan(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0))) * 24.0; vec2 c = floor(uv), f = abs(fract(uv) - 0.5); float n = h(c);
          float k = uAmt * 1.2 - n; float on = step(0.0, k); float sq = smoothstep(0.5, 0.42, max(f.x, f.y));
          float fresh = 1.0 - smoothstep(0.0, 0.16, k); // a cell flares as it switches, then goes dark
          vec3 col = mix(vec3(0.0), vec3(0.45, 0.95, 1.0) * (1.4 + 0.6 * sin(uTime * 40.0 + n * 50.0)), fresh);
          gl_FragColor = vec4(col, on * sq * mix(0.92, 1.0, fresh)); }` });
    this.derezMesh = new THREE.Mesh(new THREE.SphereGeometry(0.29, 24, 16), dz); this.derezMesh.renderOrder = 9998; this.derezMesh.frustumCulled = false; this.derezMesh.visible = false; this.camera.add(this.derezMesh);

    const hm = new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, uniforms: { uAmt: { value: 0 }, uDir: { value: new THREE.Vector3() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uAmt; uniform vec3 uDir; varying vec3 vP; void main(){
        vec3 d = normalize(vP); float a = acos(clamp(-d.z, -1.0, 1.0));
        // a ring round the edge of the view; with a direction, the side facing the hit burns and the far side fades
        float edge = smoothstep(0.42, 1.05, a); float side = length(uDir) > 0.01 ? 0.25 + 0.75 * max(dot(normalize(d.xy + 1e-4), normalize(uDir.xy + 1e-4)), 0.0) : 1.0;
        gl_FragColor = vec4(1.0, 0.08, 0.04, edge * side * uAmt * 0.85); }` });
    this.hurtMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 16), hm); this.hurtMesh.renderOrder = 9997; this.hurtMesh.frustumCulled = false; this.hurtMesh.visible = false; this.camera.add(this.hurtMesh);
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Guard: one NaN or infinite pixel (a shader edge case on some GPUs) is smeared by the bloom blur across the whole
    // frame, which turns the screen black and flickering. Any non-finite pixel is zeroed before bloom sees it.
    this.composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); bvec4 bad = bvec4(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b), isnan(c.a) || isinf(c.a)); gl_FragColor = any(bad) ? vec4(0.0, 0.0, 0.0, 1.0) : min(c, vec4(64.0)); }' }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.4, 0.55, 0.9); this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    addEventListener('resize', () => this.resize()); this.resize();
  }

  private base = { dpr: 1, bloom: true, shadows: true }; private load = 0;
  applySettings(s: Settings) {
    const q = QUALITY[s.quality]; this.base = { dpr: Math.min(devicePixelRatio, q.dpr), bloom: q.bloom && s.bloom > 0.01, shadows: q.shadows };
    this.bloom.strength = 0.38 * s.bloom; this.reducedMotion = s.reducedMotion; this.applyLoad();
  }
  /**
   * Desktop load shedding, driven by the app's frame-time governor: 0 = the chosen quality; 1 = no shadows; 2 = also
   * at most 1x pixel ratio; 3 = also no bloom and 0.75x. A laptop GPU that cannot hold the chosen quality steps down
   * instead of crawling, and steps back up once frames are quick again.
   */
  setLoad(level: number) { if (level !== this.load) { this.load = level; this.applyLoad(); } }
  get loadLevel() { return this.load; }
  private applyLoad() {
    const b = this.base, l = this.load; this.renderer.setPixelRatio(l >= 3 ? Math.min(b.dpr, 0.75) : l >= 2 ? Math.min(b.dpr, 1) : b.dpr);
    this.useBloom = b.bloom && l < 3; this.renderer.shadowMap.enabled = b.shadows && l < 1; this.resize();
  }
  resize() {
    if (this.renderer.xr.isPresenting) return;
    const w = innerWidth, h = innerHeight; this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  /** Swaps the world group, disposing GPU resources of the previous scene so tier changes do not leak. */
  setWorld(g: THREE.Group) {
    const old = this.world; this.scene.remove(old); disposeTree(old);
    this.world = g; this.scene.add(g); this.scene.fog = null;
  }
  addShake(v: number) { if (!this.reducedMotion && !this.renderer.xr.isPresenting) this.shake = Math.min(1, this.shake + v); }
  fadeTo(v: number, speed = 3) { this.fadeTarget = v; this.fadeSpeed = speed; }
  derezTo(v: number, speed = 2) { this.derezTarget = v; this.derezSpeed = speed; }
  /**
   * Shows a hit on the player. `from` is the world point (or direction) the hit came from; without it the whole edge
   * flashes. Strength 0..1. Honours reduced flashes.
   */
  hurt(strength = 1, from?: { x: number; y: number; z: number }, isDirection = false) {
    this.hurtAmt = Math.max(this.hurtAmt, Math.min(1, strength) * (this.reducedFlashes ? 0.45 : 1));
    if (!from) { this.hurtDir.set(0, 0, 0); return; }
    const cam = this.camera; cam.updateMatrixWorld(); const d = isDirection ? this.hurtDir.set(from.x, from.y, from.z) : this.hurtDir.set(from.x, from.y, from.z).sub(this.viewPos);
    d.applyQuaternion(cam.getWorldQuaternion(this.hq).invert()).setZ(0); if (d.lengthSq() < 1e-6) d.set(0, 0, 0); else d.normalize();
  }
  reducedFlashes = false;

  render(dt: number) {
    this.elapsed += dt; this.stats = { ...this.renderer.info.render }; this.renderer.info.reset();
    this.fade += Math.sign(this.fadeTarget - this.fade) * Math.min(Math.abs(this.fadeTarget - this.fade), dt * this.fadeSpeed);
    (this.fadeMesh.material as THREE.MeshBasicMaterial).opacity = this.fade; this.fadeMesh.visible = this.fade > 0.003;
    this.derez += Math.sign(this.derezTarget - this.derez) * Math.min(Math.abs(this.derezTarget - this.derez), dt * this.derezSpeed);
    const du = (this.derezMesh.material as THREE.ShaderMaterial).uniforms; du.uAmt.value = this.derez; du.uTime.value = this.elapsed; this.derezMesh.visible = this.derez > 0.004;
    this.hurtAmt = Math.max(0, this.hurtAmt - dt * 2.2); const hu = (this.hurtMesh.material as THREE.ShaderMaterial).uniforms; hu.uAmt.value = this.hurtAmt; hu.uDir.value.copy(this.hurtDir); this.hurtMesh.visible = this.hurtAmt > 0.01;
    const xr = this.renderer.xr.isPresenting;
    (this.vignette.material as THREE.ShaderMaterial).uniforms.uAmt.value = xr ? this.vignetteAmount : 0; this.vignette.visible = xr && this.vignetteAmount > 0.01;
    this.camera.position.sub(this.shakeOff); this.shakeOff.set(0, 0, 0);
    if (this.shake > 0.001 && !xr) { const s = this.shake * this.shake * 0.22; this.shakeOff.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0); this.camera.position.add(this.shakeOff); this.shake = Math.max(0, this.shake - dt * 2.4); }
    if (xr || !this.useBloom) this.renderer.render(this.scene, this.camera); else this.composer.render(dt);
    this.camera.getWorldPosition(this.viewPos);
  }
  info() { const i = this.renderer.info; return { calls: this.stats.calls, triangles: this.stats.triangles, geometries: i.memory.geometries, textures: i.memory.textures }; }
}

export function disposeTree(root: THREE.Object3D) {
  root.traverse((o: any) => {
    if (o.userData?.shared) return;
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { if (m.userData?.shared) continue; for (const k of Object.keys(m)) { const v = (m as any)[k]; if (v && v.isTexture && !v.userData?.shared) v.dispose(); } m.dispose?.(); }
  });
}
