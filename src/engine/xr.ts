import * as THREE from 'three';
import type { Engine } from './engine';
import type { Actions } from '../input/input';
import type { Settings } from '../persistence/store';
import type { Assets } from './assets';
import { GloveHand } from './hands';

const MENU_HOLD = 0.4;
interface Hand { ray: THREE.Group; grip: THREE.Group; model: THREE.Group; gamepad: Gamepad | null; prev: boolean[]; hist: THREE.Vector3[]; histT: number[]; vel: THREE.Vector3; line: THREE.Line; source: XRInputSource | null; bias: [number, number]; rest: [number, number]; restT: number }

/**
 * WebXR session handling, tracked controllers and comfort locomotion. Emits the same normalised Actions as
 * desktop input, so both modes drive one shared simulation.
 */
export class XRManager {
  supported = false; presenting = false; readonly hands: Record<'left' | 'right', Hand>;
  readonly actions: Partial<Actions> = {};
  onStart: () => void = () => {}; onEnd: () => void = () => {}; onError: (msg: string) => void = () => {};
  /** World-space aim ray and release velocity of the throwing hand. */
  readonly aimOrigin = new THREE.Vector3(); readonly aimDir = new THREE.Vector3(0, 0, -1); readonly handVel = new THREE.Vector3(); readonly offOrigin = new THREE.Vector3();
  private settings!: Settings; private snapReady = true; private stickPrev = { lx: 0, ly: 0, rx: 0, ry: 0 }; private tmp = new THREE.Vector3(); private q = new THREE.Quaternion(); private q2 = new THREE.Quaternion(); private swing: { t: number; v: THREE.Vector3 }[] = []; private clockT = 0;
  showRays = false; uiTriggerEdge = false; menuEdge = false; private menuHeld = 0;
  /** 0..1 while the menu button is being held down. */ menuProgress = 0;
  /** Right stick up/down, for trimming the seat height on a cycle (+1 = raise). */ dashAdjust = 0;
  /** Tracked glove models. Hidden while the player's hands are shown on a vehicle's controls instead. */
  showHands = true; private gloves: Record<'left' | 'right', GloveHand> | null = null;
  /** Raw stick readings after calibration, for the in-headset input readout. */
  readonly sticks = { lx: 0, ly: 0, rx: 0, ry: 0 };

  constructor(private engine: Engine) {
    const mk = (i: number): Hand => {
      const xr = engine.renderer.xr, ray = xr.getController(i), grip = xr.getControllerGrip(i);
      // simple gauntlet: reads as a hand without depending on a platform controller model
      const model = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.13), new THREE.MeshStandardMaterial({ color: 0x0a0d14, roughness: 0.3, metalness: 0.8 })); body.position.z = 0.02;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 8, 24), new THREE.MeshBasicMaterial({ color: 0x4fe3ff })); band.rotation.x = Math.PI / 2; band.position.z = 0.07; (band.material as THREE.MeshBasicMaterial).color.multiplyScalar(2);
      model.add(body, band); grip.add(model);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x9fefff, transparent: true, opacity: 0.8 })); line.scale.z = 4; line.visible = false; ray.add(line);
      engine.rig.add(ray, grip);
      const h: Hand = { ray, grip, model, gamepad: null, prev: [], hist: [], histT: [], vel: new THREE.Vector3(), line, source: null, bias: [0, 0], rest: [0, 0], restT: 0 };
      // controller index does not imply handedness: map by the input source and swap slots if needed
      ray.addEventListener('connected', (e: any) => { const src = e.data as XRInputSource, side = src.handedness === 'left' ? 'left' : 'right', other = side === 'left' ? 'right' : 'left'; if (this.hands[side] !== h) { const o = this.hands[side]; this.hands[side] = h; this.hands[other] = o; } h.source = src; h.gamepad = src.gamepad ?? null; });
      ray.addEventListener('disconnected', () => { h.source = null; h.gamepad = null; h.bias = [0, 0]; h.restT = 0; });
      return h;
    };
    this.hands = { left: mk(0), right: mk(1) };
    (navigator as any).xr?.isSessionSupported?.('immersive-vr').then((ok: boolean) => { this.supported = ok; this.onSupport(ok); }).catch(() => {});
  }
  onSupport: (ok: boolean) => void = () => {};
  /** Replaces the placeholder gauntlets with the rigged glove model once it has loaded. */
  attachGloves(assets: Assets) {
    if (this.gloves || !assets.has('hands')) return;
    this.gloves = { left: new GloveHand(assets, 'left'), right: new GloveHand(assets, 'right') };
    for (const g of Object.values(this.gloves)) { g.root.position.set(0, -0.025, 0.085); g.root.traverse((o) => (o.userData.shared = true)); }
  }
  /** Where a held object attaches: the palm of that hand's glove (falls back to the grip space). */
  handAnchor(side: 'left' | 'right'): THREE.Object3D { return this.gloves?.[side].root ?? this.hands[side].grip; }
  /** Thumbstick with resting-offset calibration, a radial dead zone and rescaling so output starts at zero. */
  private stick(h: Hand, dt: number): [number, number] {
    const g = h.gamepad; if (!g) return [0, 0];
    const n = g.axes.length, rx = g.axes[n >= 4 ? 2 : 0] ?? 0, ry = g.axes[n >= 4 ? 3 : 1] ?? 0;
    // a stick that sits still slightly off-centre is hardware drift: learn that offset and subtract it
    if (Math.hypot(rx, ry) < 0.32 && Math.hypot(rx - h.rest[0], ry - h.rest[1]) < 0.012) { h.restT += dt; if (h.restT > 0.45) h.bias = [rx, ry]; } else { h.rest = [rx, ry]; h.restT = 0; }
    const x = rx - h.bias[0], y = ry - h.bias[1], m = Math.hypot(x, y), DZ = 0.2;
    if (m < DZ) return [0, 0]; const k = Math.min(1, (m - DZ) / (1 - DZ)) / m; return [x * k, y * k];
  }
  setSettings(s: Settings) { this.settings = s; }

  async enter() {
    const xr = (navigator as any).xr; if (!xr || !this.supported) { this.onError('Immersive VR is not available on this device or browser.'); return; }
    try {
      const session: XRSession = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      const r = this.engine.renderer; r.xr.setReferenceSpaceType('local-floor');
      // native-resolution framebuffer (capped) — the default scale looks pixelated on standalone headsets
      try { const native = (window as any).XRWebGLLayer?.getNativeFramebufferScaleFactor?.(session) ?? 1; r.xr.setFramebufferScaleFactor(Math.min(native, this.settings.quality === 'low' ? 1 : 1.3)); } catch { /* keep default */ }
      session.addEventListener('end', () => { this.presenting = false; this.engine.resize(); this.engine.camera.position.set(0, 0, 0); this.engine.camera.quaternion.identity(); this.onEnd(); });
      await r.xr.setSession(session); try { r.xr.setFoveation(1); } catch { /* fixed foveation unsupported */ } this.presenting = true; this.onStart();
    } catch (e: any) { this.onError(e?.name === 'SecurityError' || e?.name === 'NotAllowedError' ? 'VR permission was denied.' : 'Could not start VR: ' + (e?.message ?? e)); }
  }
  exit() { void this.engine.renderer.xr.getSession()?.end(); }

  pulse(side: 'left' | 'right' | 'both', intensity: number, ms: number) {
    for (const s of side === 'both' ? (['left', 'right'] as const) : [side]) { const gp: any = this.hands[s].gamepad; try { gp?.hapticActuators?.[0]?.pulse?.(Math.min(1, intensity), ms); gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity }); } catch { /* no haptics */ } }
  }
  /** Clears latched button edges (used when a state change skips a controller update for a frame). */
  clearEdges() { const a = this.actions as any; for (const k of ['pause', 'confirm', 'back', 'jump', 'dodge', 'recall', 'ability', 'turnLeft', 'turnRight', 'camera']) a[k] = false; this.uiTriggerEdge = false; this.menuEdge = false; }
  /** Button and stick names as the player holds them, for on-screen instructions. */
  get labels() {
    const l = !!this.settings?.vr.leftHanded;
    return { surge: l ? 'X' : 'A', jump: l ? 'X' : 'A', view: l ? 'Y' : 'B', dodge: l ? 'Y' : 'B', ability: l ? 'A' : 'X', menu: l ? 'RIGHT B' : 'LEFT Y', move: l ? 'RIGHT STICK' : 'LEFT STICK', turn: l ? 'LEFT STICK' : 'RIGHT STICK', throwHand: l ? 'LEFT' : 'RIGHT', shieldHand: l ? 'RIGHT' : 'LEFT' };
  }
  get dominant(): 'left' | 'right' { return this.settings?.vr.leftHanded ? 'left' : 'right'; }
  get offhand(): 'left' | 'right' { return this.settings?.vr.leftHanded ? 'right' : 'left'; }

  /** Head position/yaw in world space. */
  // The viewer pose is read from the XR frame itself (reference space = rig-local) and carried through the rig. three's
  // own cameras are only valid for this at certain points of the frame: its XR camera flips between local and world
  // values, and the rig-parented camera is not written until the first XR render.
  private viewer(): XRRigidTransform | null {
    const xr = this.engine.renderer.xr; if (!xr.isPresenting) return null;
    try { const f = xr.getFrame() as XRFrame | null, rs = xr.getReferenceSpace(); return (f && rs && f.getViewerPose(rs)?.transform) || null; } catch { return null; }
  }
  headWorld(out: THREE.Vector3) {
    const t = this.viewer(); if (!t) return this.engine.camera.getWorldPosition(out);
    const rig = this.engine.rig; rig.updateWorldMatrix(true, false); return out.set(t.position.x, t.position.y, t.position.z).applyMatrix4(rig.matrixWorld);
  }
  private headQuat(out: THREE.Quaternion) {
    const t = this.viewer(); if (!t) return this.engine.camera.getWorldQuaternion(out);
    return this.engine.rig.getWorldQuaternion(out).multiply(this.q2.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w));
  }
  headYaw() { const f = this.tmp.set(0, 0, -1).applyQuaternion(this.headQuat(this.q)); return Math.atan2(f.x, f.z); }
  /** Where the player is looking, in world space. */
  headForward(out: THREE.Vector3) { return out.set(0, 0, -1).applyQuaternion(this.headQuat(this.q)); }
  /** Moves the rig so the tracked head sits over a logical world position: recentring never shifts gameplay collision. */
  placeHead(x: number, floorY: number, z: number) {
    const rig = this.engine.rig, cam = this.engine.camera; this.tmp.copy(cam.position).applyQuaternion(rig.quaternion);
    rig.position.set(x - this.tmp.x, floorY + (this.settings.vr.seated ? 0.45 : 0) + this.settings.vr.height, z - this.tmp.z);
  }
  /** Rotates the rig about the head so turning never translates the player. */
  turn(angle: number) { const rig = this.engine.rig, head = this.headWorld(new THREE.Vector3()); rig.position.sub(head).applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle).add(head); rig.rotateY(angle); }

  update(dt: number, allowTurn: boolean) {
    if (!this.presenting) return; this.clockT += dt;
    const a = this.actions as any, L = this.hands.left, R = this.hands.right, dom = this.hands[this.dominant], off = this.hands[this.offhand];
    const btn = (h: Hand, i: number) => h.gamepad?.buttons[i]?.pressed ?? false, val = (h: Hand, i: number) => h.gamepad?.buttons[i]?.value ?? 0, edge = (h: Hand, i: number) => btn(h, i) && !h.prev[i];
    // Controls are written for a primary (throwing) hand P and a secondary hand S. Left-handed play swaps them, which
    // mirrors everything: sticks, face buttons, throw and shield. 'l*' below is the secondary stick, 'r*' the primary.
    const P = dom, S = off;
    const [lx, ly] = this.stick(S, dt), [rx, ry] = this.stick(P, dt); this.sticks.lx = lx; this.sticks.ly = ly; this.sticks.rx = rx; this.sticks.ry = ry;
    // movement is controller/head relative; the views convert moveX/moveY using head yaw
    const sx = Math.abs(rx) > Math.abs(lx) ? rx : lx; // either stick steers
    a.moveX = lx; a.moveY = -ly; a.steer = Math.sign(sx) * Math.pow(Math.abs(sx), 1.35);
    // cycles: any trigger or grip opens the throttle; pulling the left stick back brakes
    a.accel = Math.max(val(R, 0), val(L, 0), val(R, 1), val(L, 1)); a.brake = ly > 0.55 ? 1 : 0; this.dashAdjust = Math.abs(ry) > 0.35 && Math.abs(rx) < 0.4 ? -ry : 0;
    // the disc is held by closing the throwing hand (trigger or grip) and thrown by opening it
    a.throwHeld = val(dom, 0) > 0.5 || val(dom, 1) > 0.5; a.shieldHeld = val(off, 1) > 0.5 || val(off, 0) > 0.5;
    // Face buttons. Primary hand: lower button (A) = speed surge / jump, upper (B) = cockpit-or-chase view, dodge on foot.
    // Secondary hand: lower (X) = ability / jump, upper (Y) held = menu. Thumbstick clicks are deliberately unused: pressing one mid-run jolts
    // the stick. The menu needs a deliberate hold so a brushed button never interrupts a run.
    a.boost = btn(P, 4); a.ability = edge(S, 4); a.jump = edge(P, 4) || edge(S, 4) || (ry < -0.7 && this.stickPrev.ry >= -0.7); a.dodge = edge(P, 5) || (ry > 0.7 && this.stickPrev.ry <= 0.7); a.recall = edge(dom, 0) || edge(dom, 1);
    a.camera = edge(P, 5);
    const hold = btn(S, 5); this.menuHeld = hold ? this.menuHeld + dt : 0; this.menuEdge = hold && this.menuHeld >= MENU_HOLD && this.menuHeld - dt < MENU_HOLD; a.pause = this.menuEdge; this.menuProgress = hold ? Math.min(1, this.menuHeld / MENU_HOLD) : 0;
    // 90° turns: flick either stick
    const G = 0.55, p = this.stickPrev;
    a.turnLeft = (lx < -G && p.lx >= -G) || (rx < -G && p.rx >= -G); a.turnRight = (lx > G && p.lx <= G) || (rx > G && p.rx <= G);
    // the trigger selects through the panel ray only (mapping it to `confirm` too would activate two screens per press)
    this.uiTriggerEdge = edge(R, 0) || edge(L, 0); a.confirm = edge(P, 4); a.back = edge(P, 5);
    a.navX = 0; a.navY = (ly > 0.6 && this.stickPrev.ly <= 0.6 ? 1 : 0) - (ly < -0.6 && this.stickPrev.ly >= -0.6 ? 1 : 0); a.lookX = 0; a.lookY = 0;
    // comfort turning: snap by default, smooth optional
    if (allowTurn) {
      if (this.settings.vr.snapTurn) { if (Math.abs(rx) > 0.65 && this.snapReady) { this.turn(-Math.sign(rx) * THREE.MathUtils.degToRad(this.settings.vr.snapAngle)); this.snapReady = false; } else if (Math.abs(rx) < 0.3) this.snapReady = true; }
      else if (rx !== 0) this.turn(-rx * 1.6 * dt);
    }
    this.stickPrev.lx = lx; this.stickPrev.ly = ly; this.stickPrev.rx = rx; this.stickPrev.ry = ry;
    for (const h of [L, R]) { h.prev = h.gamepad ? h.gamepad.buttons.map((b) => b.pressed) : []; h.line.visible = this.showRays; }
    // gloves follow their own hand (slots can swap when handedness is reported) and close with the trigger / grip
    for (const side of ['left', 'right'] as const) {
      const h = this.hands[side], g = this.gloves?.[side]; h.model.visible = !g && this.showHands; if (!g) continue;
      if (g.root.parent !== h.ray) h.ray.add(g.root); g.root.visible = this.showHands && !!h.source; g.pose(0.22 + 0.78 * Math.max(val(h, 0), val(h, 1)));
    }
    // throwing hand kinematics
    dom.ray.getWorldPosition(this.aimOrigin); dom.ray.getWorldQuaternion(this.q); this.aimDir.set(0, 0, -1).applyQuaternion(this.q).normalize(); off.grip.getWorldPosition(this.offOrigin);
    // Hand velocity relative to the player's own body (rig motion excluded): the runtime's tracked velocity where it is
    // reported, otherwise finite differences of the controller's rig-local position.
    const g: any = dom.grip, v = new THREE.Vector3();
    if (g.hasLinearVelocity) v.copy(g.linearVelocity); else { dom.hist.push(dom.grip.position.clone()); dom.histT.push(this.clockT); if (dom.hist.length > 4) { dom.hist.shift(); dom.histT.shift(); } const n = dom.hist.length - 1, t = n > 0 ? dom.histT[n] - dom.histT[0] : 0; if (t > 0) v.copy(dom.hist[n]).sub(dom.hist[0]).divideScalar(t); }
    v.applyQuaternion(this.engine.rig.getWorldQuaternion(this.q)); this.handVel.copy(v);
    this.swing.push({ t: this.clockT, v }); while (this.swing.length && this.clockT - this.swing[0].t > 0.25) this.swing.shift();
  }
  /**
   * Velocity of the throwing hand at release: the PEAK of the last 130 ms of the swing (smoothed with its neighbours),
   * not the average. A real throw is already slowing through the follow-through when the hand opens.
   */
  releaseVelocity(out: THREE.Vector3) {
    const r = this.swing.filter((s) => this.clockT - s.t <= 0.13); out.set(0, 0, 0); if (!r.length) return out;
    let best = 0; for (let i = 1; i < r.length; i++) if (r[i].v.lengthSq() > r[best].v.lengthSq()) best = i;
    let n = 0; for (let i = Math.max(0, best - 1); i <= Math.min(r.length - 1, best + 1); i++) { out.add(r[i].v); n++; }
    return out.divideScalar(n);
  }
}
