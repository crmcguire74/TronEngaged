import * as THREE from 'three';
import type { Ctx } from '../../app/context';
import type { Instance } from '../../engine/assets';
import { tuneEmissive } from '../../engine/assets';
import { TONE } from '../../engine/env';
import { angleLerp, clamp, damp } from '../../engine/math';
import { revealMaterials } from '../discs/session';
import { cosmetic } from '../../progression/rewards';
import { GloveHand } from '../../engine/hands';
import { HoloGauge, holoFrame } from './holo';

export const CYCLE_COLORS: Record<string, number> = { azure: 0x4fe3ff, ember: 0xff5a36, jade: 0x45ff9a, violet: 0xb56bff, wraith: 0xffd23c, bulwark: 0xff4fa0, argon: 0x5affd8, moto: 0xff8a3c, agile: 0xc8ff3c, flynn: 0xff2f4f };
/** Every rival model, in the order riders are assigned them. */
export const RIVAL_MODELS = ['ember', 'wraith', 'jade', 'bulwark', 'violet', 'argon', 'moto', 'agile', 'flynn'];
export const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
export const playerTrail = (ctx: Ctx) => cosmetic('trail:' + ctx.settings.trail)?.color ?? 0x4fe3ff;
/**
 * Supplied models arrive at their own scale, facing and origin. `s` is a uniform scale, `y` lifts the model so the
 * tyres sit on the floor (applied before the scale), `turn` faces it down +Z, and `x` / `z` recentre a model whose
 * origin is not under the machine. Everything is measured from the file's bounding box.
 */
const FIT: Record<string, { s: number; y: number; turn: number; x?: number; z?: number }> = {
  wraith: { s: 2.9, y: 0.196, turn: Math.PI },
  // TRON: Uprising ArgonCity cycle: already in metres and already nose-down -Z, so only a half-turn is needed
  argon: { s: 1.06, y: 0, turn: Math.PI },
  // Moto de Tron: eleven metres long down +X, origin off to one side and a metre above the floor
  moto: { s: 0.225, y: -1.21, turn: Math.PI / 2, x: 2.91, z: -3.0 },
  // TE:BG Agile and Flynn's: both already sit on the floor and are centred, they just arrive very small
  agile: { s: 10.4, y: 0, turn: Math.PI },
  flynn: { s: 8.97, y: 0, turn: Math.PI },
};
/** Rider for each machine. The one-wheel 'bulwark' is a sealed pod and runs without a visible rider. */
const RIDER: Record<string, string> = { azure: 'char:azure', violet: 'char:cobalt', jade: 'char:ivory', ember: 'char:crimson', wraith: 'char:cobalt', argon: 'char:ivory', moto: 'char:crimson', agile: 'char:ivory', flynn: 'char:cobalt' };
export const cycleAssets = (models: string[], skin: string) => [...new Set(models.flatMap((m) => ['cycle:' + m, RIDER[m]]).concat(['char:' + skin, 'cockpit', 'cockpit2', 'cockpit3', 'cockpit4', 'console', 'hands']).filter(Boolean))];
/** Rider eye point relative to the cycle origin (metres): x right-handed, y up, z forward. */
export const EYE = { y: 1.27, z: -0.2 };
/**
 * Where each cockpit model puts the inboard and outboard end of a grip, in cockpit space (glTF: x right, y up,
 * z forward). The gloved hands and forearms are placed from these, so a new cockpit only needs a row here.
 */
const GRIPS: Record<string, { a: [number, number, number]; b: [number, number, number]; elbow: [number, number, number] }> = {
  cockpit2: { a: [0.3, 0.99, 0.42], b: [0.39, 0.985, 0.36], elbow: [0.27, 0.9, -0.08] },
  cockpit3: { a: [0.3, 0.99, 0.42], b: [0.39, 0.985, 0.36], elbow: [0.27, 0.9, -0.08] },
  cockpit4: { a: [0.395, 0.988, 0.352], b: [0.452, 0.978, 0.268], elbow: [0.33, 0.9, -0.1] },
};
const WHITE = new THREE.Color(1, 1, 1);
/**
 * How hard the cockpit's neon inlays burn. Held well below 1 on purpose: with bloom on, anything near 2 turns every
 * trim band into a white slab and the bodywork behind it into grey haze. Under 1 the bands keep their colour, read
 * as thin lit lines, and the gloss black around them stays black.
 */
const TRIM_EMISSIVE = 0.9;
// clearcoatRoughness is deliberately not mirror-sharp: at 0.03 a single point light makes a pinpoint highlight that
// bloom then blows into a white disc sitting over the instruments. Spreading it keeps the sheen and loses the blob.
const BLACK_GLASS = () => new THREE.MeshPhysicalMaterial({ name: 'Body', color: 0x010102, metalness: 0, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.11, envMapIntensity: 0.9, specularIntensity: 0.45 });
const ARM = 0.44, CANOPY_OPEN = -1.25, UP = new THREE.Vector3(0, 1, 0), LAMP_DIM = new THREE.Color();

/** A cycle with its rider: supplied vehicle model, materialise effect, wheel/drive animation and cosmetic lean. */
export class CycleView {
  readonly root = new THREE.Group(); readonly body = new THREE.Group(); readonly reveal = { value: 50 }; private inst: Instance; private rider: Instance | null = null; lean = 0; private yaw = 0; glow: THREE.Mesh; private cockpit: THREE.Object3D | null = null; private fp = false; private wheels: { o: THREE.Object3D; r: number }[] = []; private lastX = 0; private lastZ = 0; private placed = false; private trims: THREE.MeshStandardMaterial[] = []; private fireT = 0; private power = { value: 1 }; private riderKey = ''; private walker: Instance | null = null; private walkReveal = { value: -1 }; private walkT = 0; private wFrom = new THREE.Vector3(); private wTo = new THREE.Vector3();
  private yoke: THREE.Object3D | null = null; private canopy: THREE.Object3D | null = null; private canopyK = 0; private canopyTarget = 0; private sealAt = -9; private canopyMoving = false; private lamps: THREE.MeshBasicMaterial[] = []; private lampCol = new THREE.Color();
  private gauges: HoloGauge[] = []; private dialV = [0, 0];
  private gloves: { g: GloveHand; pivot: THREE.Group; wrist: THREE.Object3D; arm: THREE.Mesh; axis: THREE.Vector3; elbow: THREE.Vector3; side: number }[] = []; private steerV = 0; private yokeY = 0; private throttleV = 0; private brakeV = 0; private tv = new THREE.Vector3(); private tv2 = new THREE.Vector3();
  /** False while the rider is still on foot during the start sequence. */ mounted = true;
  /** Before the start: engine idling, canopy open where the model has one. */ parked = false;
  constructor(private ctx: Ctx, model: string, readonly color: number, riderKey?: string) {
    this.inst = ctx.assets.instance('cycle:' + model, { cloneMaterials: true }); tuneEmissive(this.inst.root, 1.5);
    // generated cycles: light lines take the rider's colour (unlit, so they read without bloom) and wheels are spun in code
    this.inst.root.traverse((o: any) => {
      if (o.isMesh && o.material?.name === 'Trim') o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.5) });
      if (o.name.startsWith('Wheel') && o.userData.radius) this.wheels.push({ o, r: o.userData.radius });
    });
    if (!this.inst.missing && !FIT[model]) cleanLines(this.inst.root, color, this.power);
    if (!this.inst.missing) revealMaterials(this.inst.root, this.reveal, new THREE.Color(color).multiplyScalar(0.9));
    const fit = FIT[model];
    if (fit && !this.inst.missing) {
      const r = this.inst.root; r.scale.setScalar(fit.s); r.rotation.y = fit.turn;
      // the offsets are in the model's own units, so they are applied inside the scaled frame
      r.position.set((fit.x ?? 0) * fit.s, fit.y * fit.s, (fit.z ?? 0) * fit.s);
      accentTint(r, color);
    }
    this.body.add(this.inst.root); this.inst.play('Drive', 0);
    const rk = riderKey ?? RIDER[model];
    if (rk && ctx.assets.has(rk)) { this.riderKey = rk; this.rider = ctx.assets.instance(rk, { cloneMaterials: true }); revealMaterials(this.rider.root, this.reveal, new THREE.Color(color)); this.rider.play(this.inst.actions.CanopyClose ? 'RideClosed' : 'Ride', 0); if (this.inst.actions.CanopyClose) this.rider.root.position.set(0, -0.12, -0.21); /* seated inside the canopy line */ this.rider.mixer?.update(0.3); for (const n of ['PropDiscMesh', 'PropShieldMesh']) { const o = this.rider.root.getObjectByName(n); if (o) o.visible = false; } this.body.add(this.rider.root); }
    // rivals: a thin unlit outline in their colour, so a dark rider on a dark machine still reads at a distance (and without bloom)
    if (this.rider && !riderKey) outlineRider(this.rider.root, color);
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
    if (on && !this.cockpit && (this.ctx.assets.has('cockpit4') || this.ctx.assets.has('cockpit3') || this.ctx.assets.has('cockpit2'))) { this.cockpit = this.buildCockpit(); this.root.add(this.cockpit); }
    if (on && !this.cockpit) {
      const assets = this.ctx.assets, c = assets.instance('cockpit', { cloneMaterials: true }).root, sculpted = assets.has('console');
      c.traverse((o: any) => {
        if (!o.isMesh) return; o.castShadow = false; const name = o.material?.name;
        // with the sculpted console fitted, the scripted model only supplies the bodywork around and ahead of it
        if (sculpted && name !== 'Body') { o.visible = false; return; }
        // ...sunk so the console sits on top of it, and darkened so the eye goes to the console and the road
        if (sculpted) { o.position.y -= 0.21; o.material.color.setScalar(0.012); o.material.roughness = 0.55; o.material.metalness = 0.6; o.material.envMapIntensity = 0.35; }
        if (name === 'Screen') o.material = new THREE.MeshBasicMaterial({ map: this.ctx.hud.vrTexture, toneMapped: false });
        else if (name === 'Trim') { o.material.emissive = new THREE.Color(this.color); o.material.emissiveIntensity = TRIM_EMISSIVE; this.trims.push(o.material); }
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
  /**
   * The Blender-built cockpit (scripts/blender/build_cockpit_v4.py, falling back to v3 / v2): a wrap-around binnacle
   * swept on an arc about the rider carrying a four-layer instrument stack and the gauges, raked A-pillars, a floor
   * pan with pedal plates, a yoke on one swept crossbar that rolls with the steering with the rider's gloved hands on
   * its knurled grips, and a glass canopy on a rear hinge.
   */
  private buildCockpit() {
    const assets = this.ctx.assets, key = assets.has('cockpit4') ? 'cockpit4' : assets.has('cockpit3') ? 'cockpit3' : 'cockpit2', c = assets.instance(key, { cloneMaterials: true }).root;
    c.traverse((o: any) => {
      if (!o.isMesh) return; o.castShadow = false; o.frustumCulled = false; const m = o.material, name = m?.name;
      if (name === 'Screen') o.material = new THREE.MeshBasicMaterial({ map: this.ctx.hud.vrTexture, color: 0xb8c4cc, toneMapped: false }); // a little under full, as if seen through the dark glass
      else if (name === 'Trim') { m.color.setScalar(0); m.roughness = 0.6; m.envMapIntensity = 0; m.emissive = new THREE.Color(this.color); m.emissiveIntensity = TRIM_EMISSIVE; this.trims.push(m); }
      else if (name === 'Holo') { o.material = holoFrame(this.color); o.renderOrder = 4; }
      else if (name === 'WallLamp') { o.material = new THREE.MeshBasicMaterial({ color: 0x1a2430, toneMapped: false }); this.lamps.push(o.material); }
      else if (name === 'Glass') { o.material = new THREE.MeshStandardMaterial({ name: 'Glass', color: 0xcfeaff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 3 }); o.renderOrder = 6; }
      // black glass: near-black with a mirror-smooth coat, so the sun lights make small sharp highlights rather than a grey
      // sheen, and only a dim reflection of the sky; chrome stays as the bright accent (cockpit v3)
      else if (name === 'Body') o.material = BLACK_GLASS();
      // roughness well above a mirror finish on purpose: at 0.09 the key light puts a pinpoint specular on the display
      // hood that bloom then paints as a white disc across the instruments
      else if (name === 'Chrome') o.material = new THREE.MeshStandardMaterial({ name, color: 0x8e979f, metalness: 1, roughness: 0.2, envMapIntensity: 1.1 });
      else if (name === 'Lens') o.material = new THREE.MeshPhysicalMaterial({ name, color: 0x000000, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.45, specularIntensity: 0.6 });
      else if (name === 'DisplayGlass') { o.material = new THREE.MeshPhysicalMaterial({ name, color: 0x000000, metalness: 0, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 2.4 }); o.renderOrder = 3; }
      else if (name === 'Needle') o.material = new THREE.MeshBasicMaterial({ color: 0xf4fbff, toneMapped: false });
      else if (name === 'Rubber') { m.roughness = 0.62; m.envMapIntensity = 0.8; }
      else if (name === 'Satin') o.material = new THREE.MeshStandardMaterial({ name, color: 0x020203, metalness: 0.4, roughness: 0.7, envMapIntensity: 0.15 });
      else if (name === 'Alloy') m.envMapIntensity = 1.4;
    });
    c.updateMatrixWorld(true); this.yoke = c.getObjectByName('Yoke') ?? null; this.yokeY = this.yoke?.position.y ?? 0; this.canopy = c.getObjectByName('Canopy') ?? null; // the dial nodes (left: speed, right: drive) carry the black-glass gauges' holographic graphics; the needles are retired
    this.gauges = (['DialL', 'DialR'] as const).flatMap((n, i) => { const d = c.getObjectByName(n); if (!d) return []; d.visible = false;
      const g = new HoloGauge(0.05, this.color, i ? 'DRIVE' : 'KM/H'), at = new THREE.Object3D(); at.position.copy(d.position); at.quaternion.copy(d.quaternion); d.parent!.add(at);
      // node local -Z faces the eye: turn the disc round to face it, and sink it to just in front of the dial face
      g.mesh.rotation.y = Math.PI; g.mesh.position.z = 0.0045; at.add(g.mesh); return [g]; }); this.canopyK = this.canopyTarget === 1 && this.ctx.engine.elapsed - this.sealAt < 0.5 ? 0 : this.canopyTarget; this.poseCanopy();
    if (this.yoke && assets.has('hands')) for (const sx of [1, -1]) {
      // grip ends in cockpit space (glTF: x, y up, z forward), carried into the yoke's frame so the hands roll with it.
      // Each cockpit puts its grips somewhere different, so the anchors come from the model that was actually loaded.
      const G = GRIPS[key] ?? GRIPS.cockpit3;
      const a = new THREE.Vector3(sx * G.a[0], G.a[1], G.a[2]), b = new THREE.Vector3(sx * G.b[0], G.b[1], G.b[2]), mid = this.yoke.worldToLocal(a.clone().lerp(b, 0.5));
      const along = a.clone().sub(b).normalize(), fwd = new THREE.Vector3(0, 0.12, 1).normalize(), fingers = fwd.clone().addScaledVector(along, -fwd.dot(along)).normalize().add(fwd).normalize();
      const pivot = new THREE.Group(); pivot.position.copy(mid); this.yoke.add(pivot);
      const g = new GloveHand(assets, sx > 0 ? 'left' : 'right', this.color); g.gripBar(new THREE.Vector3(), fingers, along); pivot.add(g.root);
      const wrist = new THREE.Object3D(); wrist.position.copy(g.root.position).addScaledVector(fingers, -0.085); pivot.add(wrist);
      // armoured forearm with a lit cuff at the wrist
      // sculpted gauntlet: gloss black, a chrome band, a neon spine along the top and a lit cuff at the wrist
      const prof = [[0.0, -ARM / 2], [0.05, -ARM / 2], [0.058, -0.16], [0.057, -0.04], [0.05, 0.09], [0.041, 0.19], [0.043, ARM / 2 - 0.006], [0.0, ARM / 2]].map(([r, y]) => new THREE.Vector2(r, y));
      const arm = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), BLACK_GLASS());
      const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color).multiplyScalar(1.4) });
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.0045, 6, 32), neon); cuff.rotation.x = Math.PI / 2; cuff.position.y = ARM / 2 - 0.03; arm.add(cuff);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.0515, 0.006, 8, 32), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.09, envMapIntensity: 1 })); band.rotation.x = Math.PI / 2; band.position.y = 0.08; arm.add(band);
      // the forearm's local -Z ends up on top once it is aimed forward from the elbow
      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.008, ARM * 0.55, 0.004), neon); spine.position.set(0, -0.06, -0.0575); arm.add(spine);
      arm.castShadow = false; c.add(arm);
      this.gloves.push({ g, pivot, wrist, arm, axis: along, elbow: new THREE.Vector3(sx * G.elbow[0], G.elbow[1], G.elbow[2]), side: sx });
    }
    this.driveArms(); return c;
  }
  private poseCanopy() { if (this.canopy) { const e = this.canopyK * this.canopyK * (3 - 2 * this.canopyK); this.canopy.rotation.x = (1 - e) * CANOPY_OPEN; } }
  private driveArms() {
    for (const h of this.gloves) {
      const w = this.cockpit ? this.cockpit.worldToLocal(h.wrist.getWorldPosition(this.tv)) : h.wrist.getWorldPosition(this.tv);
      const dir = this.tv2.copy(w).sub(h.elbow).normalize(); h.arm.position.copy(w).addScaledVector(dir, -ARM / 2); h.arm.quaternion.setFromUnitVectors(UP, dir);
    }
  }
  /**
   * First-person controls, every frame: the yoke rolls with the steering, the right grip twists open with the throttle,
   * both hands bear down under braking, and the bars buzz with speed and boost.
   */
  drive(steer: number, throttle: number, brake: number, speed01: number, boosting: boolean, dt: number, kmh = 0) {
    if (!this.fp || !this.yoke) return;
    this.steerV = damp(this.steerV, clamp(steer, -1, 1), 9, dt); this.throttleV = damp(this.throttleV, clamp(throttle, 0, 1), 7, dt); this.brakeV = damp(this.brakeV, clamp(brake, 0, 1), 9, dt);
    const tt = this.ctx.engine.elapsed, buzz = (0.0025 + speed01 * 0.004 + (boosting ? 0.006 : 0)) * Math.sin(tt * 71);
    this.yoke.rotation.z = this.steerV * 0.34 + buzz; this.yoke.position.y = this.yokeY + buzz * 0.4 - this.brakeV * 0.008;
    for (const h of this.gloves) { h.pivot.quaternion.setFromAxisAngle(h.axis, h.side < 0 ? -this.throttleV * 0.3 : 0); h.g.pose(0.88 + this.brakeV * 0.12); }
    this.driveArms();
    // gauges: left reads speed, right reads drive (throttle, pinned while boosting); light arcs fill 270° clockwise from bottom-left
    const target = [clamp(speed01, 0, 1), boosting ? 1 : this.throttleV * 0.8];
    this.gauges.forEach((g, i) => { this.dialV[i] = damp(this.dialV[i], target[i], 6, dt); g.set(this.dialV[i], i ? String(Math.round(this.dialV[i] * 100)).padStart(3, '0') : String(Math.round(kmh)).padStart(3, '0')); });
  }
  /** Light-wall lamps beside the display: off, recharging (k: 0..1), ready, or laying a wall (bright, strobing). */
  setWall(state: 'none' | 'charging' | 'ready' | 'on', k = 0) {
    if (!this.lamps.length) return; const tt = this.ctx.engine.elapsed;
    const col = state === 'on' ? this.lampCol.set(this.color).multiplyScalar(Math.sin(tt * 22) > 0 ? 2.2 : 1.2) : state === 'ready' ? this.lampCol.set(0x2aff8a).multiplyScalar(0.9 + 0.3 * Math.sin(tt * 4)) : state === 'charging' ? this.lampCol.set(0x1a2430).lerp(LAMP_DIM.set(this.color), k * 0.35) : this.lampCol.set(0x1a2430);
    for (const m of this.lamps) m.color.copy(col);
    for (const m of this.trims) m.emissiveIntensity = TRIM_EMISSIVE * this.power.value * (state === 'on' ? 1.7 + 0.6 * Math.sin(tt * 22) : 1);
  }
  /** End of the event: the canopy lifts. */
  unseal() { if (this.canopyTarget !== 0) { this.canopyTarget = 0; if (this.inst.actions.CanopyOpen) { this.inst.play('CanopyOpen', 0.1, true); this.fireT = this.inst.actions.CanopyOpen.getClip().duration; this.parked = true; } } }
  /** Start sequence, step 1: the canopy closes over the rider (models that have one). */
  seal() { if (this.canopyTarget !== 1) { this.canopyTarget = 1; this.sealAt = this.ctx.engine.elapsed; } if (this.inst.actions.CanopyClose) { this.inst.play('CanopyClose', 0.1, true); this.fireT = this.inst.actions.CanopyClose.getClip().duration; } }
  /** Start sequence, step 2: the drive fires and the machine is released. */
  launch() { this.parked = false; if (this.inst.actions.Fire) { this.inst.play('Fire', 0.05, true); this.fireT = Math.min(0.6, this.inst.actions.Fire.getClip().duration); } }
  /** First-person cockpit lighting level, 0..1: the instruments power up during the start sequence. */
  setPower(k: number) { this.power.value = k; for (const m of this.trims) m.emissiveIntensity = TRIM_EMISSIVE * k; }
  /** Overrides the heading for this frame (first-person eases through a turn with the rider). */
  setYaw(yaw: number) { this.yaw = yaw; this.root.rotation.y = yaw; }
  /** yaw: heading (0 = +z). snap=true applies heading instantly (classic 90° turns). */
  pose(x: number, y: number, z: number, yaw: number, dt: number, speed01: number, snap = false, pitch = 0) {
    if (this.wheels.length) { const d = this.placed ? Math.min(3, Math.hypot(x - this.lastX, z - this.lastZ)) : 0; for (const w of this.wheels) w.o.rotation.x += d / w.r; this.lastX = x; this.lastZ = z; this.placed = true; }
    this.root.position.set(x, y, z); this.yaw = snap ? yaw : angleLerp(this.yaw, yaw, 1 - Math.exp(-18 * dt)); this.root.rotation.y = this.yaw;
    this.lean = damp(this.lean, 0, snap ? 7 : 0, dt); this.body.rotation.z = this.lean; this.body.rotation.x = pitch; if (this.cockpit) this.cockpit.rotation.x = pitch;
    this.fireT -= dt;
    if (this.canopy && this.canopyK !== this.canopyTarget) { if (!this.canopyMoving && this.fp) this.ctx.audio.sfx('canopy'); this.canopyMoving = true; this.canopyK = this.canopyTarget > this.canopyK ? Math.min(this.canopyTarget, this.canopyK + dt / 0.9) : Math.max(this.canopyTarget, this.canopyK - dt / 0.9); this.poseCanopy(); } else this.canopyMoving = false;
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

/** Adds a back-face shell, pushed out along the normals, to every skinned body mesh: a crisp neon silhouette that follows the animation. */
function outlineRider(root: THREE.Object3D, color: number) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.15), side: THREE.BackSide });
  mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(objectNormal) * 0.016;'); };
  const meshes: THREE.SkinnedMesh[] = []; root.traverse((o: any) => { if (o.isSkinnedMesh && !/disc|shield|prop/i.test(o.name + (o.material?.name ?? ''))) meshes.push(o); });
  for (const m of meshes) { const sh = new THREE.SkinnedMesh(m.geometry, mat); sh.bind(m.skeleton, m.bindMatrix); sh.position.copy(m.position); sh.quaternion.copy(m.quaternion); sh.scale.copy(m.scale); sh.frustumCulled = false; sh.renderOrder = -1; sh.castShadow = false; m.parent!.add(sh); }
}
