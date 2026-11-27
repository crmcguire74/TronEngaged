// Two passes over the runtime models in public/game-assets:
//
// 1. Merge (in place): parts that share a material are joined into one draw. The supplied cycles arrive split into
//    20-54 pieces each, so a grid of ten machines cost a few hundred draw calls before anything else was drawn, and a
//    headset issues every one of them twice. Animated and skinned nodes are left alone (three binds clips by node name,
//    so a moved or renamed node would stop animating), and so are nodes the game looks up by name (KEEP below).
//    Joining an already joined file changes nothing, so the pass is safe to re-run.
//
// 2. LOD: low-detail copies of the heaviest models, written next to the originals as `<name>.lod.glb`, built from the
//    merged files.
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
import { weld, simplifyPrimitive, prune, dedup, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/%20/g, ' ')), '..');
const OUT = path.join(root, 'public', 'game-assets');
// [file under game-assets, ratio of triangles kept, max error (fraction of the mesh radius), source to rebuild from in place]
const JOBS = [
  ['vehicles/enemies/cycle-ember.glb', 0.22, 0.012], ['vehicles/enemies/cycle-jade.glb', 0.2, 0.012],
  ['vehicles/enemies/cycle-wraith.glb', 0.2, 0.012], ['vehicles/enemies/cycle-argon.glb', 0.22, 0.012],
  ['vehicles/enemies/cycle-moto.glb', 0.22, 0.012], ['vehicles/enemies/cycle-agile.glb', 0.2, 0.012],
  ['vehicles/player/cycle-flynn.glb', 0.2, 0.012], ['vehicles/player/cycle-azure.glb', 0.22, 0.012],
  ['vehicles/player/cycle-violet.glb', 0.22, 0.012], ['vehicles/enemies/cycle-monolith.glb', 0.25, 0.012],
  // riders: a rival on a machine shows a head and shoulders, and a disc rival stands 10-25 m off. Skin weights survive.
  // Their clips are dropped too: the game drives a LOD rider with the full model's clips, which bind by bone name.
  ['characters/player/runner-azure.glb', 0.28, 0.008, null, true], ['characters/player/runner-cobalt.glb', 0.28, 0.008, null, true],
  ['characters/enemies/runner-ivory.glb', 0.28, 0.008, null, true], ['characters/bosses/runner-crimson.glb', 0.28, 0.008, null, true],
  ['environments/disc-arenas/pedestal.glb', 0.18, 0.004, 'Environments/pedestal.glb'],
  // far riders: a rival 15-42 m off on its machine is a head and shoulders a few dozen pixels tall. A second, much
  // lighter copy (about 4k triangles against 16-19k) takes over there; small parts are reduced too.
  ['characters/player/runner-azure.glb', 0.08, 0.03, null, true, '.lod2.glb'], ['characters/player/runner-cobalt.glb', 0.08, 0.03, null, true, '.lod2.glb'],
  ['characters/enemies/runner-ivory.glb', 0.08, 0.03, null, true, '.lod2.glb'], ['characters/bosses/runner-crimson.glb', 0.08, 0.03, null, true, '.lod2.glb'],
];

// models whose parts are merged in place, before any LOD is built from them
const MERGE = [
  'vehicles/enemies/cycle-ember.glb', 'vehicles/enemies/cycle-jade.glb', 'vehicles/enemies/cycle-wraith.glb', 'vehicles/enemies/cycle-argon.glb',
  'vehicles/enemies/cycle-moto.glb', 'vehicles/enemies/cycle-agile.glb', 'vehicles/enemies/cycle-bulwark.glb', 'vehicles/player/cycle-flynn.glb',
  'vehicles/player/cycle-azure.glb', 'vehicles/player/cycle-violet.glb', 'vehicles/air/recognizer.glb', 'vehicles/air/patrol-craft.glb',
  'vehicles/air/drone.glb', 'vehicles/air/carrier.glb', 'environments/cycle-arenas/lightcycle-arena.glb', 'environments/cycle-arenas/city.glb',
];
/** Node names the game finds at runtime (spun wheels, the cockpit's moving parts): never merged away. */
const KEEP = /^(Wheel|Yoke|Screen|Dial|Canopy|Prop)/i;

await Promise.all([MeshoptSimplifier.ready, MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const tris = (doc) => { let n = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(), a = p.getAttribute('POSITION'); n += (i ? i.getCount() : a.getCount()) / 3; } return Math.round(n); };

const draws = (doc) => doc.getRoot().listNodes().reduce((n, nd) => n + (nd.getMesh()?.listPrimitives().length ?? 0), 0);
// ONLY=<text>: run just the LOD jobs whose output name contains it, and skip the merge pass (npm run assets:lod -- with ONLY=lod2)
const ONLY = process.env.ONLY;
for (const rel of ONLY ? [] : MERGE) {
  const file = path.join(OUT, rel); if (!fs.existsSync(file)) { console.warn('missing', rel); continue; }
  const doc = await io.read(file), before = draws(doc);
  await doc.transform(dedup(), flatten(), join({ filter: (n) => !KEEP.test(n.getName()) }), prune({ keepAttributes: true, keepLeaves: true }));
  const after = draws(doc); if (after < before) await io.write(file, doc);
  console.log(`merge ${rel.padEnd(48)} ${String(before).padStart(3)} → ${String(after).padStart(3)} draws  ${(fs.statSync(file).size / 1024) | 0} KB`);
}

for (const [rel, ratio, error, inPlace, noClips, suffix = '.lod.glb'] of JOBS) {
  if (ONLY && !(inPlace ? rel : rel.replace(/\.glb$/, suffix)).includes(ONLY)) continue;
  const src = path.join(OUT, rel); if (!fs.existsSync(src)) { console.warn('missing', rel); continue; }
  // an in-place job always starts from the untouched file in assets/, so re-running the script never compounds the reduction
  const doc = await io.read(inPlace ? path.join(root, 'assets', inPlace) : src); const before = tris(doc);
  // skinned or morphed meshes keep their weights through simplify; welding first lets it collapse shared edges
  await doc.transform(weld());
  // small parts (light strips, trim, bolts) are left at full detail: collapsing them is what makes a distant machine
  // lose its outline, and they hold few triangles anyway. Only the big body shells are reduced.
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); if ((i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3 < (suffix === '.lod.glb' ? 1500 : 300)) continue; simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }); }
  // LOD copies carry geometry only: at runtime they borrow the full model's (already re-tinted) materials by name, so
  // the textures are not downloaded twice
  // which materials actually sample a texture: parts of any other material lose their UVs below, so they can merge
  const textured = new Set(doc.getRoot().listMaterials().filter((m) => m.getBaseColorTexture() || m.getEmissiveTexture() || m.getNormalTexture() || m.getMetallicRoughnessTexture() || m.getOcclusionTexture()).map((m) => m.getName()));
  if (!inPlace) for (const mat of doc.getRoot().listMaterials()) for (const k of ['BaseColorTexture', 'EmissiveTexture', 'NormalTexture', 'OcclusionTexture', 'MetallicRoughnessTexture']) mat['set' + k](null);
  if (noClips) for (const a of doc.getRoot().listAnimations()) a.dispose();
  // A distant machine's moving parts are a few pixels: freeze it in its driving pose, drop the clips, and merge every
  // part by material. A supplied cycle goes from 20-odd draws to one per material. Skinned machines keep their rig.
  if (!inPlace && !noClips && !doc.getRoot().listSkins().length && doc.getRoot().listAnimations().length) {
    const clips = doc.getRoot().listAnimations(), pose = clips.find((a) => a.getName() === 'Drive') ?? clips[0];
    for (const ch of pose.listChannels()) {
      const node = ch.getTargetNode(), out = ch.getSampler()?.getOutput(), path = ch.getTargetPath(); if (!node || !out) continue;
      const v = out.getElement(0, []); if (path === 'translation') node.setTranslation(v); else if (path === 'rotation') node.setRotation(v); else if (path === 'scale') node.setScale(v);
    }
    for (const a of clips) a.dispose();
  }
  if (!inPlace && !doc.getRoot().listSkins().length) {
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) if (!textured.has(p.getMaterial()?.getName() ?? '')) for (const sem of p.listSemantics()) if (sem.startsWith('TEXCOORD')) p.setAttribute(sem, null);
    // nothing in a frozen copy moves or is looked up by name, so every part may merge
    await doc.transform(flatten(), join(), prune({ keepAttributes: true, keepLeaves: true }));
  }
  await doc.transform(dedup(), prune({ keepAttributes: true, keepLeaves: true }));
  const dst = inPlace ? src : src.replace(/\.glb$/, suffix); await io.write(dst, doc);
  console.log(`${rel.padEnd(44)} ${String(before).padStart(6)} → ${String(tris(doc)).padStart(6)} tris  ${String(draws(doc)).padStart(3)} draws  ${(fs.statSync(dst).size / 1024) | 0} KB  ${path.basename(dst)}`);
}
