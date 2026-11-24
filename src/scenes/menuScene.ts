import * as THREE from 'three';
import type { Ctx } from '../app/context';
import { gridFloor, lights, skyDome, suppliedSky, theme } from '../engine/env';
import { Ribbon } from '../engine/vfx';
import { CITY_PANO, tuneEmissive, type Instance } from '../engine/assets';
import { lerp, smooth } from '../engine/math';

const COLORS = [0x4fe3ff, 0xff8a3c, 0xb57bff];
/**
 * Command-centre backdrop and the stage for the opening cinematic: a lattice that draws itself outward, architecture
 * rising behind it, cycles laying walls across the frame, and the runner waiting on a platform in the foreground.
 */
export class MenuScene {
  readonly world = new THREE.Group();
  /** 0..1 staging controls driven by the splash; all rest at 1 for the menu. */
  reveal = 1; dolly = 1; cycles = true; discT = -1; passT = -1; passDir = 1;
  /** Menu state: background traffic is parked so nothing competes with the choices on screen. */ calm = false;
  private floor: THREE.Mesh; private sky: THREE.Mesh; private hero = new THREE.Group(); private runner: Instance | null = null;
  private riders: { root: THREE.Object3D; ribbon: Ribbon; s: number; half: number; speed: number; mixer: THREE.AnimationMixer | null }[] = []; private pass: { root: THREE.Object3D; ribbon: Ribbon; mixer: THREE.AnimationMixer | null }[] = [];
  private disc: THREE.Object3D | null = null; private t = 0; private look = new THREE.Vector3();
  static assets = (skin: string) => ['cycle:azure', 'cycle:ember', 'cycle:violet', 'disc:azure', 'pedestal', 'char:' + skin];

  constructor(private ctx: Ctx) {
    const th = theme('classic-grid'), W = this.world;
    // backdrop: the supplied city panorama wraps the horizon; the lattice floor runs out to meet it
    this.sky = suppliedSky(th, ctx.assets, 'menu') ?? skyDome(th, ctx.assets.texture(CITY_PANO.halo), 1500, { lo: -25, hi: 41, gain: 0.95, mix: 1 }); W.add(this.sky); lights(W, th, false);
    this.floor = gridFloor(2400, th, 6, { fade: 420, offset: 3, glow: 0.5 }); W.add(this.floor);
    ['cycle:azure', 'cycle:ember', 'cycle:violet'].forEach((k, i) => {
      const inst = ctx.assets.instance(k); tuneEmissive(inst.root, 1.4); inst.play('DriveFast', 0); const ribbon = new Ribbon(COLORS[i], 110, 1.5, true);
      W.add(inst.root, ribbon.mesh); this.riders.push({ root: inst.root, ribbon, s: i * 130, half: 46 + i * 34, speed: 34 + i * 5, mixer: inst.mixer });
    });
    // close fly-bys for the cinematic
    ['cycle:azure', 'cycle:ember'].forEach((k, i) => { const inst = ctx.assets.instance(k); tuneEmissive(inst.root, 1.6); inst.play('DriveFast', 0); const ribbon = new Ribbon(COLORS[i], 70, 1.5, true); inst.root.visible = ribbon.mesh.visible = false; W.add(inst.root, ribbon.mesh); this.pass.push({ root: inst.root, ribbon, mixer: inst.mixer }); });
    if (ctx.assets.has('disc:azure')) { this.disc = ctx.assets.instance('disc:azure').root; this.disc.scale.setScalar(2.4); this.disc.visible = false; W.add(this.disc); }
    this.buildHero(th.accent, th.accent2); W.add(this.hero);
  }

  /** Foreground vignette built from the supplied art: the runner on a platform with a parked cycle. */
  private buildHero(c1: number, c2: number) {
    const { assets, settings } = this.ctx, H = this.hero, r = 2.3;
    if (assets.has('pedestal')) { const p = assets.instance('pedestal', { cloneMaterials: true }).root; tuneEmissive(p, 0.05); p.traverse((o: any) => { if (o.isMesh) { o.material.color.multiplyScalar(0.25); o.castShadow = false; } }); p.scale.setScalar(r / 12.39); p.position.y = 0.6; H.add(p); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r - 0.06, 0.035, 6, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color(c1).multiplyScalar(0.9) })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.63; H.add(ring);
    const key = 'char:' + settings.skin;
    if (assets.has(key)) { this.runner = assets.instance(key, { cloneMaterials: true }); tuneEmissive(this.runner.root, 1.3); this.runner.play('Idle', 0); const s = this.runner.root.getObjectByName('PropShieldMesh'); if (s) s.visible = false; this.runner.root.position.y = 0.6; this.runner.root.rotation.y = -0.5; H.add(this.runner.root); }
    const cyc = assets.instance('cycle:azure', { cloneMaterials: true }); tuneEmissive(cyc.root, 1.5); cyc.root.position.set(-2.9, 0, -2.6); cyc.root.rotation.y = 1.95; H.add(cyc.root);
    const l1 = new THREE.PointLight(c1, 40, 16, 1.6); l1.position.set(-2.6, 3.2, 2.6); const l2 = new THREE.PointLight(c2, 26, 14, 1.6); l2.position.set(-3.4, 2.2, -4.2); const l3 = new THREE.PointLight(0xffffff, 14, 12, 1.8); l3.position.set(0.5, 4.5, 3.5); H.add(l1, l2, l3);
  }

  update(dt: number) {
    this.t += dt; const t = this.t, cam = this.ctx.engine.camera, r = this.reveal, xr = this.ctx.xr.presenting;
    const su = (this.sky.material as THREE.ShaderMaterial).uniforms; su.uTime.value = t; su.uDim.value = Math.min(1, 0.04 + r * 1.4);
    const fu = (this.floor.material as THREE.ShaderMaterial).uniforms; fu.uTime.value = t; fu.uReveal.value = r >= 1 ? 1e6 : smooth(Math.min(1, r * 1.25)) * 900; (fu.uOrigin.value as THREE.Vector2).set(0, 30);
    // foreground vignette: in VR it stands beside the menu panel instead of in front of the desktop camera
    const hk = smooth(Math.max(0, Math.min(1, (r - 0.55) / 0.4))); this.hero.visible = hk > 0.01; this.hero.scale.setScalar(0.6 + 0.4 * hk);
    if (xr) { this.hero.position.set(3.1, 0, -5.2); this.hero.rotation.y = -0.2; } else { this.hero.position.set(3.0, 0, 53.0); this.hero.rotation.y = 0; }
    this.runner?.mixer?.update(dt);
    for (const c of this.riders) {
      const on = this.cycles && !this.calm; c.root.visible = c.ribbon.mesh.visible = on; if (!on) continue;
      c.s += c.speed * dt; const H = c.half, per = H * 8, s = c.s % per, side = Math.floor(s / (H * 2)), u = s - side * H * 2 - H;
      const p = [[u, -H], [H, u], [-u, H], [-H, -u]][side], yaw = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][side];
      c.root.position.set(p[0], 0, p[1] - 40); c.root.rotation.y = yaw; c.ribbon.push(p[0], 0.75, p[1] - 40); c.mixer?.update(dt);
    }
    // cinematic fly-by: a cycle crosses just ahead of the camera, laying its wall
    this.pass.forEach((p, i) => {
      const on = this.passT >= 0 && this.passT < 1 && (i === 0) === (this.passDir > 0); p.root.visible = on; if (!on) { if (this.passT >= 1.6 || this.passT < 0) p.ribbon.mesh.visible = false; return; }
      const x = lerp(-70, 70, this.passT) * this.passDir, z = 44 - i * 5; p.root.position.set(x, 0, z); p.root.rotation.y = this.passDir * Math.PI / 2; if (this.passT < 0.02) p.ribbon.reset(x, 0.75, z); p.ribbon.mesh.visible = true; p.ribbon.push(x - this.passDir * 1.3, 0.75, z); p.mixer?.update(dt);
    });
    if (this.passT >= 0) this.passT += dt / 1.5;
    if (this.disc) { this.disc.visible = this.discT >= 0 && this.discT < 1; if (this.disc.visible) { this.discT += dt / 1.1; const k = this.discT; this.disc.position.set(cam.position.x + (0.5 - k) * 7, cam.position.y - 0.3 + Math.sin(k * 3.14) * 0.6, cam.position.z - 16 + k * 16.5); this.disc.rotation.set(0.5, t * 26, 0.2); } }
    if (!xr) {
      // the splash dollies in from high above the lattice; the menu holds a slow drift at rider height
      const a = t * 0.05, d = smooth(this.dolly);
      cam.position.set(lerp(0, Math.sin(a) * 1.6 - 0.6, d), lerp(46, 2.5 + Math.sin(t * 0.21) * 0.15, d), lerp(170, 58.4 + Math.cos(a) * 0.6, d));
      this.look.set(lerp(0, 1.4, d), lerp(0, 3.4, d), lerp(20, 0, d)); cam.lookAt(this.look);
      if (Math.abs(cam.fov - 62) > 0.1) { cam.fov = 62; cam.updateProjectionMatrix(); }
    }
  }
}
