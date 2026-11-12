import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = import.meta.env.BASE_URL + 'game-assets/';
export const ASSET_PATHS: Record<string, string> = {
  'char:azure': 'characters/player/runner-azure.glb', 'char:cobalt': 'characters/player/runner-cobalt.glb', 'char:ivory': 'characters/enemies/runner-ivory.glb', 'char:crimson': 'characters/bosses/runner-crimson.glb',
  'cycle:azure': 'vehicles/player/cycle-azure.glb', 'cycle:violet': 'vehicles/player/cycle-violet.glb', 'cycle:jade': 'vehicles/enemies/cycle-jade.glb', 'cycle:ember': 'vehicles/enemies/cycle-ember.glb',
  'cycle:wraith': 'vehicles/enemies/cycle-wraith.glb', 'cycle:bulwark': 'vehicles/enemies/cycle-bulwark.glb',
  cockpit: 'vehicles/player/cockpit.glb', console: 'vehicles/player/cockpit-console.glb', stand: 'environments/cycle-arenas/stand.glb', pylon: 'environments/cycle-arenas/pylon.glb', craft: 'vehicles/air/patrol-craft.glb',
  'disc:azure': 'weapons/discs/disc-azure.glb', 'disc:ivory': 'weapons/discs/disc-ivory.glb', 'disc:crimson': 'weapons/discs/disc-crimson.glb',
  hands: 'characters/player/glove-hands.glb', pedestal: 'environments/disc-arenas/pedestal.glb', coliseum: 'environments/disc-arenas/coliseum.glb', city: 'environments/cycle-arenas/city.glb',
};
export const PANORAMA = 'panoramas/disc-arena/arena-360.jpg';
/** Supplied city panoramas, used as a mirrored band around the horizon. */
export const CITY_PANO = { halo: 'panoramas/city/city-halo.jpg', arteries: 'panoramas/city/city-arteries.jpg', wire: 'panoramas/city/city-wire.jpg', dome: 'panoramas/city/city-dome.jpg' } as const;

export interface Instance { root: THREE.Object3D; mixer: THREE.AnimationMixer | null; actions: Record<string, THREE.AnimationAction>; current: string; play(name: string, fade?: number, once?: boolean): void; missing: boolean }

/** Loads, caches and instantiates GLB assets. A missing/corrupt file degrades to a visible placeholder instead of failing the scene. */
export class Assets {
  private loader = new GLTFLoader(); private cache = new Map<string, Promise<GLTF | null>>(); private ready = new Map<string, GLTF | null>(); private tex = new Map<string, THREE.Texture>();
  errors: string[] = [];
  /** Owner-supplied files found by the asset sync (see assets/ASSET-GUIDE.md): panoramas by environment name. */
  private panos: Record<string, string> = {}; private uiArt: Record<string, string> = {};
  async loadDropins() { try { const r = await fetch(BASE + 'dropins.json'); if (r.ok) { const d = await r.json(); this.panos = d.panoramas ?? {}; this.uiArt = d.ui ?? {}; } } catch { /* none supplied */ } }
  /** URL of supplied interface art ('logo', 'key-art'), if there is one. */
  ui(name: string): string | null { return this.uiArt[name] ? BASE + this.uiArt[name] : null; }
  /** A supplied 360° picture for an environment ('menu', 'classic-grid', …), if there is one. */
  envPano(env: string): string | null { return this.panos[env] ?? null; }
  constructor() { this.loader.setMeshoptDecoder(MeshoptDecoder); }

  load(keys: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    let done = 0; const uniq = [...new Set(keys)];
    return Promise.all(uniq.map((k) => this.one(k).then(() => onProgress?.(++done, uniq.length)))).then(() => undefined);
  }
  private one(key: string): Promise<GLTF | null> {
    let p = this.cache.get(key);
    if (!p) {
      p = this.loader.loadAsync(BASE + ASSET_PATHS[key]).then((g) => { this.prepare(g); this.ready.set(key, g); return g; }).catch((e) => { this.errors.push(`${key}: ${e?.message ?? e}`); console.warn('[assets] missing', key, e); this.ready.set(key, null); return null; });
      this.cache.set(key, p);
    }
    return p;
  }
  private prepare(g: GLTF) {
    g.scene.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = false; o.frustumCulled = !o.isSkinnedMesh; o.userData.shared = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.userData.shared = true; for (const k of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].userData.shared = true; }
      }
    });
  }
  has(key: string) { return !!this.ready.get(key); }
  texture(path: string): THREE.Texture {
    let t = this.tex.get(path);
    if (!t) { t = new THREE.TextureLoader().load(BASE + path, undefined, undefined, () => console.warn('[assets] missing texture', path)); t.colorSpace = THREE.SRGBColorSpace; t.userData.shared = true; this.tex.set(path, t); }
    return t;
  }

  /** Clones a loaded model (skeleton-safe) with its own materials and an animation controller. */
  instance(key: string, opts: { cloneMaterials?: boolean } = {}): Instance {
    const g = this.ready.get(key);
    if (!g) { const root = new THREE.Group(); const ph = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshBasicMaterial({ color: 0xff00aa, wireframe: true })); ph.position.y = 0.8; root.add(ph); return { root, mixer: null, actions: {}, current: '', play() {}, missing: true }; }
    const root = SkeletonUtils.clone(g.scene);
    if (opts.cloneMaterials) root.traverse((o: any) => { if (o.isMesh) { o.material = Array.isArray(o.material) ? o.material.map((m: any) => m.clone()) : o.material.clone(); o.userData.shared = false; o.geometry.userData = { shared: true }; } });
    root.traverse((o: any) => { if (o.isMesh) { const gd = o.geometry.dispose.bind(o.geometry); void gd; o.geometry.dispose = () => {}; } });
    const mixer = g.animations.length ? new THREE.AnimationMixer(root) : null; const actions: Record<string, THREE.AnimationAction> = {};
    if (mixer) for (const c of g.animations) actions[c.name] = mixer.clipAction(c);
    const inst: Instance = {
      root, mixer, actions, current: '', missing: false,
      play(name, fade = 0.15, once = false) {
        const a = actions[name]; if (!a || (inst.current === name && !once)) return;
        const prev = actions[inst.current]; a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once; a.enabled = true; a.setEffectiveWeight(1);
        if (prev && prev !== a) a.crossFadeFrom(prev, fade, false); a.play(); inst.current = name;
      },
    };
    return inst;
  }
}

/** Scales emissive output of a model so hardlight details read through bloom without washing out. */
export function tuneEmissive(root: THREE.Object3D, k: number) { root.traverse((o: any) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.emissive && (m.emissiveMap || m.emissive.getHex() !== 0)) m.emissiveIntensity = (m.userData.baseEmissive ??= m.emissiveIntensity) * k; }); }
