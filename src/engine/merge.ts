import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Collapses the static meshes under `root` into one mesh per material. Set pieces are built from dozens of primitives
 * (a bridge is ~60 legs, hangers and struts on three materials), and every primitive was its own draw call, issued
 * twice in a headset. Transforms are baked into the merged geometry, so the result renders identically.
 *
 * Line segments (edge outlines) merge the same way. Left alone: instanced and skinned meshes, other lines, sprites, anything named (the game may look it up), anything under a
 * node marked `userData.keep`, and meshes whose geometry layout differs from the rest of their material group.
 * Call only on things that never move apart from their root.
 */
export function mergeStatic(root: THREE.Object3D): THREE.Object3D {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4();
  const groups = new Map<string, { mat: THREE.Material; meshes: THREE.Mesh[]; layer: number; order: number; lines: boolean }>();
  const sig = (g: THREE.BufferGeometry) => (g.index ? 'i:' : 'n:') + Object.keys(g.attributes).sort().map((k) => k + g.attributes[k].itemSize).join(',');
  const kept = (o: THREE.Object3D) => { for (let x: THREE.Object3D | null = o; x && x !== root; x = x.parent) if (x.userData.keep) return true; return false; };
  root.traverse((o: any) => {
    const lines = !!o.isLineSegments; if ((!o.isMesh && !lines) || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.name || o.morphTargetInfluences || kept(o)) return;
    const key = (lines ? 'L' : 'M') + o.material.uuid + '|' + sig(o.geometry) + '|' + o.renderOrder + '|' + o.layers.mask;
    let e = groups.get(key); if (!e) groups.set(key, (e = { mat: o.material, meshes: [], layer: o.layers.mask, order: o.renderOrder, lines })); e.meshes.push(o);
  });
  for (const e of groups.values()) {
    if (e.meshes.length < 2) continue;
    const geos = e.meshes.map((o) => { m.multiplyMatrices(inv, o.matrixWorld); const g = o.geometry.clone(); g.applyMatrix4(m); g.morphAttributes = {}; return g; });
    const merged = mergeGeometries(geos, false); for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh: THREE.Mesh | THREE.LineSegments = e.lines ? new THREE.LineSegments(merged, e.mat) : new THREE.Mesh(merged, e.mat); mesh.renderOrder = e.order; mesh.layers.mask = e.layer;
    const first = e.meshes[0]; mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.frustumCulled = first.frustumCulled;
    for (const o of e.meshes) { o.removeFromParent(); o.geometry.dispose(); }
    root.add(mesh);
  }
  // drop the empty groups the merge leaves behind, so traversal stays cheap
  const empty: THREE.Object3D[] = []; root.traverse((o) => { if (o !== root && !(o as any).isMesh && !(o as any).isLine && !o.children.length && o.type === 'Group') empty.push(o); });
  for (const o of empty) o.removeFromParent();
  return root;
}
