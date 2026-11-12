import * as THREE from 'three';
import type { Assets } from './assets';

type Side = 'left' | 'right';
interface Joint { bone: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3; amount: number }

/**
 * One rigged glove from the supplied hands model, re-centred on its palm and posable.
 *
 * `root` local frame (same for both hands): -Z = fingers, +Y = thumb, palm faces the body's midline. That matches a
 * WebXR target-ray space held naturally, so the glove can be parented straight to a controller.
 */
export class GloveHand {
  readonly root = new THREE.Group(); private joints: Joint[] = []; private curl = -1; private q = new THREE.Quaternion();
  constructor(assets: Assets, readonly side: Side, glow = 0x4fe3ff) {
    const inst = assets.instance('hands', { cloneMaterials: true }), scene = inst.root, mine = side === 'left' ? 'Left' : 'Right';
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3(); let found = false;
    scene.traverse((o: any) => {
      if (!o.isSkinnedMesh) return;
      const own = o.skeleton.bones.some((b: THREE.Bone) => b.name.startsWith(mine));
      o.visible = own; o.frustumCulled = false; o.castShadow = false;
      if (!own) return;
      o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); found = true;
      const m = o.material as THREE.MeshStandardMaterial;
      if (m.name === 'GloveGlow') { m.emissive = new THREE.Color(glow); m.emissiveIntensity = 2.4; m.color.set(glow); } else { m.color.setScalar(0.09); m.roughness = 0.55; m.metalness = 0.35; }
    });
    // model rest pose: fingers -Y, thumb +Z, palm toward the body. Rotate 180° about (0,1,1) so fingers → -Z, thumb → +Y.
    const pivot = new THREE.Group(); pivot.quaternion.set(0, Math.SQRT1_2, Math.SQRT1_2, 0);
    if (found) { const c = box.getCenter(new THREE.Vector3()); c.y += 0.02; scene.position.copy(c).negate(); }
    pivot.add(scene); this.root.add(pivot); this.root.updateMatrixWorld(true);
    // finger joints curl about the knuckle line (model Z); the thumb folds across the palm (model Y)
    const sign = side === 'left' ? -1 : 1, wq = new THREE.Quaternion(), rootQ = pivot.getWorldQuaternion(new THREE.Quaternion());
    scene.traverse((o: any) => {
      if (!o.isBone || !o.name.startsWith(mine + 'Hand') || o.name === mine + 'Hand') return;
      const thumb = o.name.includes('Thumb'), seg = Number(o.name.slice(-1));
      // axis in model space → world → bone-local
      const axis = new THREE.Vector3(0, thumb ? 1 : 0, thumb ? 0 : 1).applyQuaternion(rootQ).applyQuaternion(o.getWorldQuaternion(wq).invert()).normalize();
      this.joints.push({ bone: o, rest: o.quaternion.clone(), axis, amount: sign * (thumb ? [0, 0.55, 0.3, 0.35][seg] : [0, 1.15, 1.25, 0.8][seg]) });
    });
    this.pose(0.25);
  }
  /** 0 = open hand, 1 = closed fist. */
  pose(k: number) {
    k = Math.max(0, Math.min(1, k)); if (Math.abs(k - this.curl) < 0.004) return; this.curl = k;
    for (const j of this.joints) j.bone.quaternion.copy(j.rest).multiply(this.q.setFromAxisAngle(j.axis, j.amount * k));
  }
  /** Closes the glove over a bar: `fingers` = the direction the fingers reach, `thumbHint` = roughly along the bar toward the thumb. */
  gripBar(mid: THREE.Vector3, fingers: THREE.Vector3, thumbHint: THREE.Vector3, lift = 0.034) {
    const f = fingers.clone().normalize(), t = thumbHint.clone().addScaledVector(f, -thumbHint.dot(f)).normalize();
    // root frame: -Z = fingers (f), +Y = thumb (t), +X = Y × Z
    const zAxis = f.clone().negate(), xAxis = new THREE.Vector3().crossVectors(t, zAxis);
    this.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, t, zAxis));
    // palm normal points away from the bar: sit the palm on top of it
    const palm = this.side === 'left' ? xAxis : xAxis.clone().negate();
    this.root.position.copy(mid).addScaledVector(palm, -lift);
    this.pose(0.92);
  }
}
