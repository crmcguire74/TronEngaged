import * as THREE from 'three';
import type { Ctx } from './context';
import { CycleView, cycleAssets, RIVAL_MODELS, CYCLE_COLORS } from '../games/cycles/view';

/**
 * QA lineup: every cycle model with its seated rider, in a row on a flat floor, for checking that machines sit on
 * their wheels and riders sit on their machines. Only reached from the `__GAME__.qaLineup()` hook; never in play.
 */
export async function qaLineup(ctx: Ctx, rivals = true) {
  const models = ['blade', 'azure', ...RIVAL_MODELS];
  await ctx.assets.load(cycleAssets(models, 'azure'));
  const W = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 40), new THREE.MeshBasicMaterial({ color: 0x223040 })); floor.rotation.x = -Math.PI / 2; W.add(floor);
  for (let i = -100; i <= 100; i += 1) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 40), new THREE.MeshBasicMaterial({ color: 0x406080 })); l.rotation.x = -Math.PI / 2; l.position.set(i, 0.002, 0); W.add(l); }
  W.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2.2), new THREE.AmbientLight(0xffffff, 0.6));
  const views = models.map((m, i) => { const v = new CycleView(ctx, m, CYCLE_COLORS[m] ?? 0x4fe3ff, rivals || i > 1 ? undefined : 'char:azure'); v.reveal.value = 50; v.pose((i - (models.length - 1) / 2) * 4.2, 0, 0, Math.PI / 2, 1 / 60, 0.5, true); W.add(v.root); return { m, v }; });
  ctx.engine.setWorld(W);
  const info = () => views.map(({ m, v }) => { const a: any = v; const r = a.rider?.root, lo = a.riderLo?.root, box = new THREE.Box3(); const out: any = { m, rider: !!r, vis: r?.visible, lo: lo?.visible, far: a.riderFar, loOn: a.riderLoOn, mounted: v.mounted };
    if (r) { r.updateMatrixWorld(true); box.setFromObject(r, true); out.rY = [+box.min.y.toFixed(2), +box.max.y.toFixed(2)]; out.rZ = [+(box.min.x - v.root.position.x).toFixed(2), +(box.max.x - v.root.position.x).toFixed(2)]; }
    box.setFromObject(a.inst.root, true); out.cY = [+box.min.y.toFixed(2), +box.max.y.toFixed(2)]; out.cZ = [+(box.min.x - v.root.position.x).toFixed(2), +(box.max.x - v.root.position.x).toFixed(2)]; return out; });
  return { models, info, views: views.map((x) => x.v), step: (dt: number) => { for (const { v } of views) v.pose(v.root.position.x, 0, 0, Math.PI / 2, dt, 0.5, true); } };
}
