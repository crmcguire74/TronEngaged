import * as THREE from 'three';
import type { Ctx } from '../../app/context';
import type { Instance } from '../../engine/assets';
import { tuneEmissive } from '../../engine/assets';
import { TONE } from '../../engine/env';
import { angleLerp, clamp, damp } from '../../engine/math';
import { revealMaterials } from '../discs/session';
import { cosmetic } from '../../progression/rewards';
import { GloveHand } from '../../engine/hands';

export const CYCLE_COLORS: Record<string, number> = { azure: 0x4fe3ff, ember: 0xff5a36, jade: 0x45ff9a, violet: 0xb56bff, wraith: 0xffd23c, bulwark: 0xff4fa0 };
/** Every rival model, in the order riders are assigned them. */
export const RIVAL_MODELS = ['ember', 'wraith', 'jade', 'bulwark', 'violet'];
export const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
export const playerTrail = (ctx: Ctx) => cosmetic('trail:' + ctx.settings.trail)?.color ?? 0x4fe3ff;
/** Generated models arrive at their own scale and facing: uniform scale, lift so the tyres sit on the floor, half-turn. */
const FIT: Record<string, { s: number; y: number; turn: number }> = { wraith: { s: 2.9, y: 0.196, turn: Math.PI } };
const RIDER: Record<string, string> = { azure: 'char:azure', violet: 'char:cobalt', jade: 'char:ivory', ember: 'char:crimson' };
export const cycleAssets = (models: string[], skin: string) => [...new Set(models.flatMap((m) => ['cycle:' + m, RIDER[m]]).concat(['char:' + skin, 'cockpit', 'console', 'hands']).filter(Boolean))];
/** Rider eye point relative to the cycle origin (metres): x right-handed, y up, z forward. */
export const EYE = { y: 1.27, z: -0.2 };

/** A cycle with its rider: supplied vehicle model, materialise effect, wheel/drive animation and cosmetic lean. */
export class CycleView {
  readonly root = new THREE.Group(); readonly body = new THREE.Group(); readonly reveal = { value: 50 }; private inst: Instance; private rider: Instance | null = null; lean = 0; private yaw = 0; glow: THREE.Mesh; private cockpit: THREE.Object3D | null = null; private fp = false; private wheels: { o: THREE.Object3D; r: number }[] = []; private lastX = 0; private lastZ = 0; private placed = false; private trims: THREE.MeshStandardMaterial[] = []; private fireT = 0; private power = { value: 1 }; private riderKey = ''; private walker: Instance | null = null; private walkReveal = { value: -1 }; private walkT = 0; private wFrom = new THREE.Vector3(); private wTo = new THREE.Vector3();
  /** False while the rider is still on foot during the start sequence. */ mounted = true;
  /** Before the start: engine idling, canopy open where the model has one. */ parked = false;
  constructor(private ctx: Ctx, model: string, readonly color: number, riderKey?: string) {
    this.inst = ctx.assets.instance('cycle:' + model, { cloneMaterials: true }); tuneEmissive(this.inst.root, 1.5);
    // generated cycles: light lines take the rider's colour (unlit, so they read without bloom) and wheels are spun in code
    this.inst.root.traverse((o: any) => {
      if (o.isMesh && o.material?.name === 'Trim') o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.5) });
      if (o.name.startsWith('Wheel') && o.userData.radius) this.wheels.push({ o, r: o.userData.radius });
      // the supplied canopy closes over the empty rear cabin while the rider sits ahead of it, so it read as glass
      // floating behind the rider: these machines run open-top
      if (/^Canopy/.test(o.name)) o.visible = false;
    });
    if (!this.inst.missing && !FIT[model]) cleanLines(this.inst.root, color, this.power);
    if (!this.inst.missing) revealMaterials(this.inst.root, this.reveal, new THREE.Color(color).multiplyScalar(0.9));
    const fit = FIT[model];
    if (fit && !this.inst.missing) {
      const r = this.inst.root; r.scale.setScalar(fit.s); r.position.y = fit.y * fit.s; r.rotation.y = fit.turn;
      accentTint(r, color);
    }
    this.body.add(this.inst.root); this.inst.play('Drive', 0);
    // low quality (standalone headsets): rival riders are skipped to keep triangle counts down
    const rk = riderKey ?? (ctx.settings.quality === 'low' ? undefined : RIDER[model]);
    if (rk && ctx.assets.has(rk)) { this.riderKey = rk; this.rider = ctx.assets.instance(rk, { cloneMaterials: true }); revealMaterials(this.rider.root, this.reveal, new THREE.Color(color)); this.rider.play(this.inst.actions.CanopyClose ? 'RideClosed' : 'Ride', 0); this.rider.mixer?.update(0.3); for (const n of ['PropDiscMesh', 'PropShieldMesh']) { const o = this.rider.root.getObjectByName(n); if (o) o.visible = false; } this.body.add(this.rider.root); }
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, map: glowTex() })); this.glow.rotation.x = -Math.PI / 2; this.glow.position.y = 0.03;
    this.root.add(this.body, this.glow);
  }
  setRiderVisible(v: boolean) { if (this.rider) this.rider.root.visible = v && !this.fp && this.mounted; }
  /** Start sequence: the rider begins on foot, ahead of and beside the machine (call after the machine is posed). */
  dismount(side: number) {
    if (!this.rider || !this.riderKey || this.walker) return; this.mounted = false; this.rider.root.visible = false;
    const w = (this.walker = this.ctx.assets.instance(this.riderKey, { cloneMaterials: true })); revealMaterials(w.root, this.walkReveal, new THREE.Color(this.color));
    for (const n of ['PropDiscMesh', 'PropShieldMesh']) { const o = w.root.getObjectByName(n); if (o) o.visible = false; }
    const p = this.root.position, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), lx = fz * side, lz = -fx * side;
    this.wFrom.set(p.x + lx * 4.2 + fx * 1.6, p.y, p.z + lz * 4.2 + fz * 1.6); this.wTo.set(p.x + lx * 0.95, p.y, p.z + lz * 0.95);
    w.root.position.copy(this.wFrom); w.root.rotation.y = Math.atan2(this.wTo.x - this.wFrom.x, this.wTo.z - this.wFrom.z); w.play('Idle', 0); this.root.parent?.add(w.root);
  }
  /** Advances the walk to the machine (k: 0..1). Returns true on the frame the rider mounts. */
  walk(k: number, dt: number): boolean {
    const w = this.walker; if (!w || this.mounted) return false; if (!w.root.parent) this.root.parent?.add(w.root);
    this.walkT += dt; this.walkReveal.value = this.walkT > 0.6 ? 50 : this.wFrom.y - 0.2 + (this.walkT / 0.6) * 2.4;
    const e = k * k * (3 - 2 * k); w.root.position.lerpVectors(this.wFrom, this.wTo, e); const moving = k > 0.01 && k < 0.985;
    w.play(moving ? 'Walk' : 'Idle', 0.2); if (moving && w.actions.Walk) w.actions.Walk.timeScale = 0.6 + 2.4 * k * (1 - k) * 1.6; w.mixer?.update(dt);
    return k >= 1 ? this.finishWalk() : false;
  }
  /** Seats the rider at once (the walk finished, or the start sequence was skipped). */
  finishWalk(): boolean { if (this.mounted) return false; this.mounted = true; this.walker?.root.removeFromParent(); this.walker = null; if (this.rider) this.rider.root.visible = !this.fp; return true; }
  /**
   * First-person mode swaps the exterior model for the purpose-built cockpit: clean sight lines, no canopy glass in
   * front of the eyes, and the HUD rendered on the dash screen.
   */
  firstPerson(on: boolean) {
    if (on === this.fp) return; this.fp = on;
    if (on && !this.cockpit) {
      const assets = this.ctx.assets, c = assets.instance('cockpit', { cloneMaterials: true }).root, sculpted = assets.has('console');
      c.traverse((o: any) => {
        if (!o.isMesh) return; o.castShadow = false; const name = o.material?.name;
        // with the sculpted console fitted, the scripted model only supplies the bodywork around and ahead of it
        if (sculpted && name !== 'Body') { o.visible = false; return; }
        // ...sunk so the console sits on top of it, and darkened so the eye goes to the console and the road
        if (sculpted) { o.position.y -= 0.21; o.material.color.setScalar(0.012); o.material.roughness = 0.55; o.material.metalness = 0.6; o.material.envMapIntensity = 0.35; }
        if (name === 'Screen') o.material = new THREE.MeshBasicMaterial({ map: this.ctx.hud.vrTexture, toneMapped: false });
        else if (name === 'Trim') { o.material.emissive = new THREE.Color(this.color); o.material.emissiveIntensity = 2.2; this.trims.push(o.material); }
      });
      if (sculpted) {
        // dash, display, yoke, bars and the rider's armoured hands in one generated piece: model -X is forward
        const k = assets.instance('console', { cloneMaterials: true }).root; k.scale.setScalar(1.1); k.rotation.y = Math.PI / 2; k.position.set(0, 0.94, 0.253);
        k.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } }); accentTint(k, this.color, this.power, true); c.add(k); c.updateMatrixWorld(true);
        // the live instrument readout floats just above the console's display glass, found by sighting from the rider's eye
        const eye = new THREE.Vector3(0, EYE.y, EYE.z), hit = new THREE.Raycaster(eye, new THREE.Vector3(0, -0.25, 0.7).normalize(), 0.1, 2).intersectObject(k, true)[0];
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.175), new THREE.MeshBasicMaterial({ map: this.ctx.hud.vrTexture, toneMapped: false, transparent: true, opacity: 0.93, side: THREE.DoubleSide }));
        pane.position.copy(hit ? hit.point : new THREE.Vector3(0, 1.02, 0.5)).addScaledVector(eye.clone().sub(hit ? hit.point : pane.position).normalize(), 0.035); pane.position.y += 0.014; pane.lookAt(eye); pane.renderOrder = 5; c.add(pane);
      } else if (assets.has('hands')) for (const sx of [1, -1]) {
        // fallback: rigged gloves and forearms on the scripted bar grips
        const g = new GloveHand(assets, sx > 0 ? 'left' : 'right', this.color), a = new THREE.Vector3(sx * 0.33, 1.005, 0.17), b = new THREE.Vector3(sx * 0.4, 0.978, 0.075);
        const along = a.clone().sub(b).normalize(), fwd = new THREE.Vector3(0, 0.12, 1).normalize(), fingers = fwd.clone().addScaledVector(along, -fwd.dot(along)).normalize().add(fwd).normalize();
        g.gripBar(a.clone().lerp(b, 0.5), fingers, along); c.add(g.root);
        const wrist = g.root.position.clone().addScaledVector(fingers, -0.1), elbow = new THREE.Vector3(sx * 0.31, 0.93, -0.34), len = wrist.distanceTo(elbow);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.054, len, 14, 1, false), new THREE.MeshStandardMaterial({ color: 0x0b0e15, roughness: 0.5, metalness: 0.4 }));
        arm.position.copy(wrist).lerp(elbow, 0.5); arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), wrist.clone().sub(elbow).normalize()); arm.castShadow = false; c.add(arm);
      }
      this.cockpit = c; this.root.add(c);
    }
    if (this.cockpit) this.cockpit.visible = on;
    this.inst.root.visible = !on; this.glow.visible = !on; if (this.rider) this.rider.root.visible = !on && this.mounted;
  }
  /** Start sequence, step 1: the canopy closes over the rider (models that have one). */
  seal() { if (this.inst.actions.CanopyClose) { this.inst.play('CanopyClose', 0.1, true); this.fireT = this.inst.actions.CanopyClose.getClip().duration; } }
  /** Start sequence, step 2: the drive fires and the machine is released. */
  launch() { this.parked = false; if (this.inst.actions.Fire) { this.inst.play('Fire', 0.05, true); this.fireT = Math.min(0.6, this.inst.actions.Fire.getClip().duration); } }
  /** First-person cockpit lighting level, 0..1: the instruments power up during the start sequence. */
  setPower(k: number) { this.power.value = k; for (const m of this.trims) m.emissiveIntensity = 2.2 * k; }
  /** Overrides the heading for this frame (first-person eases through a turn with the rider). */
  setYaw(yaw: number) { this.yaw = yaw; this.root.rotation.y = yaw; }
  /** yaw: heading (0 = +z). snap=true applies heading instantly (classic 90° turns). */
  pose(x: number, y: number, z: number, yaw: number, dt: number, speed01: number, snap = false, pitch = 0) {
    if (this.wheels.length) { const d = this.placed ? Math.min(3, Math.hypot(x - this.lastX, z - this.lastZ)) : 0; for (const w of this.wheels) w.o.rotation.x += d / w.r; this.lastX = x; this.lastZ = z; this.placed = true; }
    this.root.position.set(x, y, z); this.yaw = snap ? yaw : angleLerp(this.yaw, yaw, 1 - Math.exp(-18 * dt)); this.root.rotation.y = this.yaw;
    this.lean = damp(this.lean, 0, snap ? 7 : 0, dt); this.body.rotation.z = this.lean; this.body.rotation.x = pitch; if (this.cockpit) this.cockpit.rotation.x = pitch;
    this.fireT -= dt;
    if (this.fireT <= 0) { const a = this.parked ? (this.inst.actions.CanopyOpenIdle ? 'CanopyOpenIdle' : 'Idle') : this.inst.actions.DriveFast && speed01 > 0.75 ? 'DriveFast' : 'Drive'; this.inst.play(a, 0.3); if (!this.parked && this.inst.actions[a]) this.inst.actions[a].timeScale = 0.4 + speed01 * 1.6; }
    this.inst.mixer?.update(dt);
  }
}
/**
 * Generated models carry their light accents painted in cyan. This re-keys them to a rider's colour and makes them
 * self-lit, so they read without bloom. `power` (0..1) scales the glow, for instruments that switch on.
 */
/**
 * The supplied cycles carry their light lines as a painted glow texture whose soft edges spread across the bodywork.
 * This keeps only the bright core of each line, as a crisp strip in the rider's colour, and renders everything else as
 * plain dark satin metal, so the machine reads as hard panels with inlaid light rather than a glowing smear.
 */
function cleanLines(root: THREE.Object3D, color: number, power: { value: number }) {
  const tint = { value: new THREE.Color(color) };
  root.traverse((o: any) => {
    if (!o.isMesh) return; const m = o.material as THREE.MeshStandardMaterial; if (!m?.emissiveMap || !/_Body$/.test(m.name)) return;
    m.metalness = 0.88; m.roughness = 0.36; m.metalnessMap = null; m.roughnessMap = null; m.envMapIntensity = 1.1; m.emissive.set(0xffffff); m.emissiveIntensity = 1;
    m.onBeforeCompile = (sh: any) => {
      sh.uniforms.uTint = tint; sh.uniforms.uPower = power;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uPower; float vLine;')
        .replace('#include <map_fragment>', 'vec3 emTex = texture2D(emissiveMap, vEmissiveMapUv).rgb; vLine = smoothstep(0.6, 0.8, max(emTex.r, max(emTex.g, emTex.b)));\ndiffuseColor.rgb = mix(vec3(0.02, 0.023, 0.03), uTint * 0.35, vLine);')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = uTint * vLine * 1.25 * uPower;');
    };
    m.customProgramCacheKey = () => 'clean-lines'; m.needsUpdate = true;
  });
}
function accentTint(root: THREE.Object3D, color: number, power: { value: number } = { value: 1 }, clean = false) {
  const tint = { value: new THREE.Color(color) };
  root.traverse((o: any) => {
    if (!o.isMesh) return; const m = o.material, prev = m.onBeforeCompile; m.metalness = Math.min(m.metalness ?? 1, 0.85);
    m.onBeforeCompile = (sh: any, rr: any) => {
      prev?.call(m, sh, rr); sh.uniforms.uTint = tint; sh.uniforms.uPower = power;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uPower; float vAccent;')
        .replace('#include <map_fragment>', clean
          // cockpit console: only the saturated core of a painted line glows, and the matt grey between the lines becomes dark gunmetal
          ? '#include <map_fragment>\nvAccent = smoothstep(0.2, 0.36, min(diffuseColor.g, diffuseColor.b) - diffuseColor.r); float lumC = dot(diffuseColor.rgb, vec3(0.33)); diffuseColor.rgb = mix(vec3(0.05, 0.056, 0.068) * (0.35 + 2.2 * lumC), uTint * 0.4, vAccent);'
          : '#include <map_fragment>\nvAccent = smoothstep(0.05, 0.22, min(diffuseColor.g, diffuseColor.b) - diffuseColor.r); diffuseColor.rgb = mix(diffuseColor.rgb, uTint * (0.35 + dot(diffuseColor.rgb, vec3(0.4))), vAccent);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uTint * vAccent * ' + (clean ? '0.95' : '1.7') + ' * uPower;');
    };
    if (clean) { m.roughness = 0.5; m.envMapIntensity = 1.2; } m.customProgramCacheKey = () => (prev ? 'reveal-accent' : 'accent') + (clean ? '-clean' : ''); m.needsUpdate = true;
  });
}
let gt: THREE.Texture | null = null;
function glowTex() { if (gt) return gt; const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!, g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); gt = new THREE.CanvasTexture(c); gt.userData.shared = true; return gt; }

const MAX_SEG = 640, WALL_H = 1.55;
/** Hardlight wall built as one strip mesh per rider (never one mesh per segment). */
export class WallTrail {
  readonly mesh: THREE.Mesh; private pos = new Float32Array(MAX_SEG * 4 * 3); private uv = new Float32Array(MAX_SEG * 4 * 2); private built = -1; readonly mat: THREE.ShaderMaterial;
  constructor(color: number) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint16Array(MAX_SEG * 6); for (let i = 0; i < MAX_SEG; i++) { const a = i * 4; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); } g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uTime; varying vec2 vUv; void main(){ float top = smoothstep(0.86, 1.0, vUv.y), base = 1.0 - smoothstep(0.0, 0.14, vUv.y); float stripe = 0.5 + 0.5 * sin(vUv.x * 1.6 - uTime * 5.0); float body = 0.56 + 0.16 * vUv.y + 0.06 * stripe; float a = (body + top * 0.6 + base * 0.35) * uOpacity; gl_FragColor = vec4(uColor * (0.9 + top * 2.6 + base * 1.2 + 0.2 * stripe), a); ${TONE} }` });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false;
  }
  private seg(i: number, ax: number, az: number, bx: number, bz: number, u0: number) {
    const o = i * 12, len = Math.hypot(bx - ax, bz - az), p = this.pos, uv = this.uv, q = i * 8;
    p[o] = ax; p[o + 1] = 0; p[o + 2] = az; p[o + 3] = ax; p[o + 4] = WALL_H; p[o + 5] = az; p[o + 6] = bx; p[o + 7] = 0; p[o + 8] = bz; p[o + 9] = bx; p[o + 10] = WALL_H; p[o + 11] = bz;
    uv[q] = u0; uv[q + 1] = 0; uv[q + 2] = u0; uv[q + 3] = 1; uv[q + 4] = u0 + len; uv[q + 5] = 0; uv[q + 6] = u0 + len; uv[q + 7] = 1; return u0 + len;
  }
  /** pts: flat trail vertices; (hx,hz): current head position. Only the live segment is rewritten each frame. */
  update(pts: number[], hx: number, hz: number, t: number) {
    const n = Math.min(MAX_SEG, pts.length / 2); let u = 0;
    if (n !== this.built) { for (let i = 0; i < n - 1; i++) u = this.seg(i, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], u); this.built = n; (this as any)._u = u; } else u = (this as any)._u ?? 0;
    if (n > 0) this.seg(n - 1, pts[(n - 1) * 2], pts[(n - 1) * 2 + 1], hx, hz, u);
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.uv.needsUpdate = true; g.setDrawRange(0, n * 6); this.mat.uniforms.uTime.value = t;
  }
}

/** Speed streaks around the camera: a cheap, bounded way to sell velocity without full-screen blur. */
export class SpeedLines {
  readonly mesh: THREE.LineSegments; private pos: Float32Array; private n = 90; private seeds: Float32Array;
  constructor(color: number) {
    this.pos = new Float32Array(this.n * 6); this.seeds = new Float32Array(this.n * 3); for (let i = 0; i < this.n * 3; i++) this.seeds[i] = Math.random();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); this.mesh.frustumCulled = false;
  }
  update(x: number, y: number, z: number, yaw: number, speed: number, t: number, amount: number) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx; (this.mesh.material as THREE.LineBasicMaterial).opacity = amount * 0.5; if (amount < 0.01) return;
    for (let i = 0; i < this.n; i++) { const s = this.seeds, a = s[i * 3] * 6.283, r = 3 + s[i * 3 + 1] * 9, d = ((s[i * 3 + 2] * 90 - t * speed * 1.4) % 90 + 90) % 90 - 20, len = 1 + speed * 0.07; const ox = Math.cos(a) * r, oy = Math.abs(Math.sin(a)) * r * 0.7 + 0.3, o = i * 6;
      this.pos[o] = x + rx * ox + fx * d; this.pos[o + 1] = y + oy; this.pos[o + 2] = z + rz * ox + fz * d; this.pos[o + 3] = x + rx * ox + fx * (d + len); this.pos[o + 4] = y + oy; this.pos[o + 5] = z + rz * ox + fz * (d + len); }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

/**
 * Start of a cycle event: riders walk to their machines and mount in a burst of light. In a headset the player watches
 * their own rider from beside the machine, then is faded into the seat (the view never moves while it is visible).
 */
export class StartSequence {
  seated: boolean; private seatT = 0; private called = false; private tmp = new THREE.Vector3();
  constructor(private ctx: Ctx, private cv: CycleView[], private colors: number[], private player: number) { this.seated = !ctx.xr.presenting; cv.forEach((v, i) => v.dismount(i === player ? 1 : -1)); }
  /** t: seconds since the intro began. */
  update(t: number, dt: number) { const k = clamp((t - 0.3) / 2.4, 0, 1); this.cv.forEach((v, i) => { if (v.walk(k, dt)) this.onMount(i); }); }
  /** Everyone mounted and the player seated: called when the countdown begins, however the intro ended. */
  finish() { this.cv.forEach((v, i) => { if (v.finishWalk()) this.onMount(i); }); this.seat(); }
  tick(dt: number) { if (this.seatT > 0) { this.seatT -= dt; if (this.seatT <= 0) { this.seated = true; this.ctx.engine.fadeTo(0, 3); } } }
  private seat() { if (this.seated || this.seatT > 0) return; if (this.ctx.xr.presenting) { this.ctx.engine.fadeTo(1, 12); this.seatT = 0.22; } else this.seated = true; }
  private onMount(i: number) {
    const { vfx, audio } = this.ctx, p = this.cv[i].root.position, col = this.colors[i];
    vfx.motes(p.x, p.y, p.z, col, 1.2, 1.8, 30); vfx.ring(p.x, p.y + 0.05, p.z, col, 0.3, 2.2, 0.5);
    if (i === this.player) { audio.sfx('spawn'); this.seat(); }
    else if (!this.called) { this.called = true; audio.vo('jeer_intro', 'Rival: "Prepare yourself."', { x: p.x, y: p.y + 1.4, z: p.z }, 0.9); }
    else audio.sfx('spawn', { x: p.x, y: p.y + 1, z: p.z });
  }
  /** VR, before mounting: stands the viewer behind and beside their machine, facing it. `offset` = head position in rig space. */
  placeBeside(px: number, py: number, pz: number, yaw: number, offset: THREE.Vector3) {
    const rig = this.ctx.engine.rig, fx = Math.sin(yaw), fz = Math.cos(yaw), sx = px + fz * 4.4 - fx * 3, sz = pz - fx * 4.4 - fz * 3;
    rig.rotation.set(0, Math.atan2(-(px - sx), -(pz - sz)), 0); const off = this.tmp.copy(offset).setY(0).applyQuaternion(rig.quaternion); rig.position.set(sx - off.x, py + this.ctx.settings.vr.height, sz - off.z);
  }
}
