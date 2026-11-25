// Builds low-detail copies of the heaviest runtime models, written next to the originals as `<name>.lod.glb`.
//
// Why: a race grid draws up to ten 35-50k triangle machines, and a headset draws each of them twice (once per eye).
// Past ~30 m a machine covers a few hundred pixels, so a quarter of the triangles is indistinguishable there. The
// game swaps to these copies by distance (CycleView). The disc pedestal is simplified in place: it is a plain round
// deck carrying 20k triangles, and an arena places up to nine of them.
//
//   npm run assets:lod
//
// Node structure, names, materials, textures and animations are kept: only index/vertex data is reduced, so every
// runtime hook (Trim materials, Wheel nodes, canopy clips) still finds what it looks for.
import fs from 'node:fs'; import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplifyPrimitive, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/%20/g, ' ')), '..');
const OUT = path.join(root, 'public', 'game-assets');
// [file under game-assets, ratio of triangles kept, max error (fraction of the mesh radius), source to rebuild from in place]
const JOBS = [
  ['vehicles/enemies/cycle-ember.glb', 0.22, 0.012], ['vehicles/enemies/cycle-jade.glb', 0.2, 0.012],
  ['vehicles/enemies/cycle-wraith.glb', 0.2, 0.012], ['vehicles/enemies/cycle-argon.glb', 0.22, 0.012],
  ['vehicles/enemies/cycle-moto.glb', 0.22, 0.012], ['vehicles/enemies/cycle-agile.glb', 0.2, 0.012],
  ['vehicles/player/cycle-flynn.glb', 0.2, 0.012], ['vehicles/player/cycle-azure.glb', 0.22, 0.012],
  ['vehicles/player/cycle-violet.glb', 0.22, 0.012],
  // riders: a rival on a machine shows a head and shoulders, and a disc rival stands 10-25 m off. Skin weights survive.
  // Their clips are dropped too: the game drives a LOD rider with the full model's clips, which bind by bone name.
  ['characters/player/runner-azure.glb', 0.28, 0.008, null, true], ['characters/player/runner-cobalt.glb', 0.28, 0.008, null, true],
  ['characters/enemies/runner-ivory.glb', 0.28, 0.008, null, true], ['characters/bosses/runner-crimson.glb', 0.28, 0.008, null, true],
  ['environments/disc-arenas/pedestal.glb', 0.18, 0.004, 'Environments/pedestal.glb'],
];

await Promise.all([MeshoptSimplifier.ready, MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const tris = (doc) => { let n = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(), a = p.getAttribute('POSITION'); n += (i ? i.getCount() : a.getCount()) / 3; } return Math.round(n); };

for (const [rel, ratio, error, inPlace, noClips] of JOBS) {
  const src = path.join(OUT, rel); if (!fs.existsSync(src)) { console.warn('missing', rel); continue; }
  // an in-place job always starts from the untouched file in assets/, so re-running the script never compounds the reduction
  const doc = await io.read(inPlace ? path.join(root, 'assets', inPlace) : src); const before = tris(doc);
  // skinned or morphed meshes keep their weights through simplify; welding first lets it collapse shared edges
  await doc.transform(weld());
  // small parts (light strips, trim, bolts) are left at full detail: collapsing them is what makes a distant machine
  // lose its outline, and they hold few triangles anyway. Only the big body shells are reduced.
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); if ((i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3 < 1500) continue; simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }); }
  // LOD copies carry geometry only: at runtime they borrow the full model's (already re-tinted) materials by name, so
  // the textures are not downloaded twice
  if (!inPlace) for (const mat of doc.getRoot().listMaterials()) for (const k of ['BaseColorTexture', 'EmissiveTexture', 'NormalTexture', 'OcclusionTexture', 'MetallicRoughnessTexture']) mat['set' + k](null);
  if (noClips) for (const a of doc.getRoot().listAnimations()) a.dispose();
  await doc.transform(dedup(), prune({ keepAttributes: true, keepLeaves: true }));
  const dst = inPlace ? src : src.replace(/\.glb$/, '.lod.glb'); await io.write(dst, doc);
  console.log(`${rel.padEnd(44)} ${String(before).padStart(6)} → ${String(tris(doc)).padStart(6)} tris  ${(fs.statSync(dst).size / 1024) | 0} KB  ${path.basename(dst)}`);
}
