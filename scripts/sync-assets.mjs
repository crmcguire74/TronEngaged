// Copies runtime-ready source art from assets/ (left untouched) into public/game-assets/
// using the PRD's proposed layout, and writes the asset manifest/inventory.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/%20/g, ' ')), '..');
const SRC = path.join(root, 'assets'); const OUT = path.join(root, 'public', 'game-assets');
const MAP = [
  // [source, runtime path, category, role, status notes]
  ['Characters/Tron-Blue-Hero.glb', 'characters/player/runner-azure.glb', 'character', 'Player default skin', 'ready'],
  ['Characters/Tron-BlueHero2.glb', 'characters/player/runner-cobalt.glb', 'character', 'Player unlock skin; VR glove hands', 'ready'],
  ['Characters/Tron-White.glb', 'characters/enemies/runner-ivory.glb', 'character', 'Sentinel / Striker / Ricochet enemies', 'ready'],
  ['Characters/Tron-RedGuard.glb', 'characters/bosses/runner-crimson.glb', 'character', 'Guardian / Hunter / boss enemies', 'ready'],
  ['Vehicles/Blue-LightCycle-OK.glb', 'vehicles/player/cycle-azure.glb', 'vehicle', 'Player cycle (canopy)', 'ready'],
  ['Vehicles/Tron-PurpleLightCycle.glb', 'vehicles/player/cycle-violet.glb', 'vehicle', 'Unlock cycle / rival', 'ready'],
  ['Vehicles/Tron-GreenLightCycle.glb', 'vehicles/enemies/cycle-jade.glb', 'vehicle', 'Rival cycle', 'ready'],
  ['Vehicles/Tron-RedLIghtCycle.glb', 'vehicles/enemies/cycle-ember.glb', 'vehicle', 'Rival cycle', 'ready'],
  ['generated/cycle-wraith.glb', 'vehicles/enemies/cycle-wraith.glb', 'vehicle', 'Rival cycle, generated for this game (Tripo text-to-3D via Higgsfield); recoloured per rider at runtime', 'ready'],
  ['generated/cycle-bulwark.glb', 'vehicles/enemies/cycle-bulwark.glb', 'vehicle', 'Rival ring-wheel cycle, original design (scripts/blender/build_cycles.py)', 'ready'],
  ['generated/arena-stand.glb', 'environments/cycle-arenas/stand.glb', 'environment', 'Grandstand module around the cycle grid (scripts/blender/build_arena_kit.py)', 'ready'],
  ['generated/arena-pylon.glb', 'environments/cycle-arenas/pylon.glb', 'environment', 'Corner pylon for the cycle grid (scripts/blender/build_arena_kit.py)', 'ready'],
  ['generated/cockpit-console.glb', 'vehicles/player/cockpit-console.glb', 'vehicle', 'Cockpit console with the rider\'s hands, generated for this game (concept image, then Tripo image-to-3D via Higgsfield)', 'ready'],
  ['generated/patrol-craft.glb', 'vehicles/air/patrol-craft.glb', 'vehicle', 'Patrol skimmer circling above arenas and circuits, original design (scripts/blender/build_craft.py)', 'ready'],
  ['generated/cockpit.glb', 'vehicles/player/cockpit.glb', 'vehicle', 'First-person / VR cockpit (built by scripts/blender/build_cockpit.py)', 'ready'],
  ['Objects/Discs/Tron-BlueHero2_Disc.glb', 'weapons/discs/disc-azure.glb', 'weapon', 'Player disc projectile', 'ready'],
  ['Objects/Discs/Tron-White_Disc.glb', 'weapons/discs/disc-ivory.glb', 'weapon', 'Enemy disc projectile', 'ready'],
  ['Objects/Discs/Tron-RedGuard_Disc.glb', 'weapons/discs/disc-crimson.glb', 'weapon', 'Elite/boss disc projectile', 'ready'],
  ['Objects/glove_hands.glb', 'characters/player/glove-hands.glb', 'character', 'VR hands', 'ready'],
  ['Environments/pedestal.glb', 'environments/disc-arenas/pedestal.glb', 'environment', 'Disc Arena platform visual (collision is analytic)', 'ready'],
  ['Environments/disc_coliseum.glb', 'environments/disc-arenas/coliseum.glb', 'environment', 'Disc Arena outer stadium shell (decor only)', 'ready'],
  ['Environments/cycle_city.glb', 'environments/cycle-arenas/city.glb', 'environment', 'Cycle arena skyline (decor only). "Tron Light cycle Arena" by ImWillows, CC BY 4.0', 'ready'],
  // sky_circuit, bridge and tunnel are not copied: no track uses them (see CREDITS.md)
];
function glbInfo(file) {
  const b = fs.readFileSync(file); const jl = b.readUInt32LE(12); const j = JSON.parse(b.slice(20, 20 + jl).toString());
  let tris = 0; for (const m of j.meshes || []) for (const p of m.primitives) { const pa = j.accessors[p.attributes.POSITION]; tris += (p.indices != null ? j.accessors[p.indices].count : pa.count) / 3; }
  return { triangles: Math.round(tris), meshes: (j.meshes || []).length, materials: (j.materials || []).map(m => m.name), textures: (j.images || []).length,
    rigged: !!(j.skins && j.skins.length), bones: j.skins?.[0]?.joints.length || 0, animations: (j.animations || []).map(a => a.name), extensions: j.extensionsUsed || [], generator: j.asset?.generator };
}
const entries = [];
for (const [src, dst, category, role, status] of MAP) {
  const s = path.join(SRC, src), d = path.join(OUT, dst);
  if (!fs.existsSync(s)) { console.warn('missing', src); continue; }
  fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d);
  entries.push({ name: path.basename(dst, '.glb'), source: 'assets/' + src, runtime: 'game-assets/' + dst, category, format: 'GLB', sizeBytes: fs.statSync(s).size, intendedUsage: role, status, ...glbInfo(s) });
}
// Panorama: keep source PNG untouched, emit an optimised JPEG for the sky dome.
const pano = path.join(SRC, 'Environments/Panoramic Outer Environments/Sample 1/arena_360_equirectangular.png');
const panoOut = path.join(OUT, 'panoramas/disc-arena/arena-360.jpg');
fs.mkdirSync(path.dirname(panoOut), { recursive: true });
try { execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', pano, '--out', panoOut], { stdio: 'ignore' }); }
catch { fs.copyFileSync(pano, panoOut.replace('.jpg', '.png')); }
entries.push({ name: 'arena-360', source: 'assets/Environments/Panoramic Outer Environments/Sample 1/arena_360_equirectangular.png', runtime: 'game-assets/panoramas/disc-arena/arena-360.jpg', category: 'panorama', format: 'JPEG (from PNG 1774x887, equirectangular)', intendedUsage: 'Distant sky dome for arenas; never used for collision', status: 'ready (low resolution: used tinted/blurred behind real 3D geometry)' });
// Recorded audio (voice, crowd, effects, music) brought over from the owner's earlier project; provenance is in voice-manifest.json.
for (const f of fs.readdirSync(path.join(SRC, 'audio'))) if (/\.(m4a|mp3)$/.test(f)) { const d = path.join(OUT, 'audio', f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(SRC, 'audio', f), d); entries.push({ name: f, source: 'assets/audio/' + f, runtime: 'game-assets/audio/' + f, category: 'audio', format: f.split('.').pop(), intendedUsage: 'Recorded audio layer over the synthesised sound', status: 'ready' }); }
// Wrap-around city backdrops: JPEG conversions of the supplied panoramic concept renders (sources stay in Concept Images/New).
for (const f of fs.readdirSync(path.join(SRC, 'generated/panoramas'))) if (f.endsWith('.jpg')) { const d = path.join(OUT, 'panoramas/city', f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(SRC, 'generated/panoramas', f), d); entries.push({ name: f, source: 'assets/generated/panoramas/' + f, runtime: 'game-assets/panoramas/city/' + f, category: 'panorama', format: 'JPEG', intendedUsage: 'Sky-dome city band (mirrored so it wraps without a seam)', status: 'ready' }); }
for (const f of fs.readdirSync(path.join(SRC, 'Concept Images'))) if (f.endsWith('.png')) entries.push({ name: f, source: 'assets/Concept Images/' + f, category: 'concept', format: 'PNG', intendedUsage: 'Art-direction reference only (not shipped)', status: 'reference' });
// A sky wider than 4096 px costs a headset over 150 MB of texture memory for no visible gain, so larger pictures are
// scaled down on the way in (macOS `sips`; anywhere else the file is copied as it is). The original is left untouched.
function fitPano(src, dst) {
  if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs) return;
  try { const w = Number(/pixelWidth: (\d+)/.exec(execFileSync('sips', ['-g', 'pixelWidth', src], { encoding: 'utf8' }))?.[1] ?? 0); if (w > 4096) { execFileSync('sips', ['-Z', '4096', '-s', 'formatOptions', '88', src, '--out', dst], { stdio: 'ignore' }); return; } } catch { /* no sips: copy */ }
  fs.copyFileSync(src, dst);
}
// Drop-ins: any audio file in assets/audio and any picture in assets/panoramas is picked up by name, with no code change.
// See assets/ASSET-GUIDE.md for the names the game looks for.
const dropins = { audio: fs.readdirSync(path.join(SRC, 'audio')).filter((f) => /\.(m4a|mp3|wav|ogg)$/i.test(f)), panoramas: {}, ui: {} };
if (fs.existsSync(path.join(SRC, 'ui'))) for (const f of fs.readdirSync(path.join(SRC, 'ui'))) { const m = /^(logo|key-art)\.(svg|png|jpe?g|webp)$/i.exec(f); if (!m) continue; const d = path.join(OUT, 'ui', f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(SRC, 'ui', f), d); dropins.ui[m[1].toLowerCase()] = 'ui/' + f; }
for (const f of dropins.audio) if (/\.(wav|ogg)$/i.test(f)) { const d = path.join(OUT, 'audio', f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(SRC, 'audio', f), d); }
if (fs.existsSync(path.join(SRC, 'panoramas'))) for (const f of fs.readdirSync(path.join(SRC, 'panoramas'))) if (/\.(jpe?g|png|webp)$/i.test(f)) { const d = path.join(OUT, 'panoramas/env', f); fs.mkdirSync(path.dirname(d), { recursive: true }); fitPano(path.join(SRC, 'panoramas', f), d); dropins.panoramas[f.replace(/\.[^.]+$/, '').toLowerCase()] = 'panoramas/env/' + f; }
fs.writeFileSync(path.join(OUT, 'dropins.json'), JSON.stringify(dropins, null, 2));
fs.mkdirSync(path.join(SRC, 'manifests'), { recursive: true });
fs.writeFileSync(path.join(SRC, 'manifests', 'assets.json'), JSON.stringify({ generated: new Date().toISOString(), note: 'Source files in assets/ are never moved or renamed; runtime copies live in public/game-assets/.', assets: entries }, null, 2));
console.log('synced', entries.length, 'assets');
