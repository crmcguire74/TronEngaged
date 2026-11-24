# Credits

## Third-party models used in the game

| Used as | Title | Author | Licence | Changes |
|---|---|---|---|---|
| Skyline around the cycle arenas (`environments/cycle-arenas/city.glb`) | "Tron Light cycle Arena" | ImWillows, via Sketchfab | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Re-exported from Blender, scaled, shadows disabled |
| Rival cycle "Argon Runner" and a player unlock (`vehicles/enemies/cycle-argon.glb`) | "TRON: Uprising — ArgonCity Light Cycle" | TheTinDog, via Sketchfab | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Scaled and turned to the game's axes, light lines recoloured per rider at runtime |
| Rival cycle "Moto Bulk" and a player unlock (`vehicles/enemies/cycle-moto.glb`) | "Moto de Tron" | monkameo, via Sketchfab | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Scaled, recentred on the machine and turned to the game's axes; recoloured per rider |
| Air interceptor in the Outlands races (`vehicles/air/light-jet.glb`) | "One man light jet tron" | f3nix, via Sketchfab | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Scaled, laid nose-forward, emissive detail recoloured |
| Arc-blade projectile thrown by Breakers, Vanguards and the Null Kernel (`weapons/melee/arc-sword.glb`) | "Tron Light Arc Sword" | SpringSociety, via Sketchfab | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Scaled and oriented along the flight path; emissive boosted |
| Unlockable player disc (`weapons/discs/disc-identity.glb`) | "Tron Legacy Identity Disc" | Shriker1, via Sketchfab | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Scaled only |
| Rival cycle "Agile" and a player unlock (`vehicles/enemies/cycle-agile.glb`) | "Agile Lightcycle — Tron Evolution Battle Grids" | Shriker1, via Sketchfab | Sketchfab Standard | Scaled and turned to the game's axes; light lines recoloured per rider at runtime |
| Rival cycle "Flynn's" and a player unlock (`vehicles/player/cycle-flynn.glb`) | "Flynn's Lightcycle — Tron Evolution Battle Grids" | Shriker1, via Sketchfab | Sketchfab Standard | Scaled and turned to the game's axes; recoloured per rider |
| Recognizer standing over the cycle events (`vehicles/air/recognizer.glb`) | "Recognizer — Tron (1982)" | arabinowitz, via Sketchfab | Sketchfab Standard | Scaled up to a seventy-metre gantry, navigation lights recoloured per environment |
| Shell around the cycle-combat grid (`environments/cycle-arenas/lightcycle-arena.glb`) | "Lightcycle Arena Rev 02 — TE:BG" | Shriker1, via Sketchfab | Sketchfab Standard | Scaled to sit outside the playfield, sunk to grid level, darkened; decor only |

The owner confirmed this is the source of `assets/Environments/cycle_city.glb` (the file was re-exported and no longer
carries its Sketchfab metadata).

Four of the models above carry the **Sketchfab Standard** licence rather than Creative Commons. The owner downloaded
them for use in this project and decided they should ship. Note for anyone reusing this repository: that licence
permits use in a project but restricts redistributing the model file on its own, and a web build serves the `.glb`
to every visitor — so check your own terms before reusing those four files elsewhere.

## Third-party audio used in the game

| Used as | Title | Author | Licence | Changes |
|---|---|---|---|---|
| Arena ambience and crowd cheers (`audio/crowd_*.m4a`) | "Free Crowd Cheering Sounds" | Gregor Quendel, via [OpenGameArt](https://opengameart.org/content/free-crowd-cheering-sounds) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Re-encoded to AAC; played in excerpts with fades |
| Announcer and rival voice lines (`audio/vo_*.m4a`, `audio/jeer_*.m4a`) | "Voiceover Pack: Fighter" | Kenney (kenney.nl), via [OpenGameArt](https://opengameart.org/content/voiceover-pack-fighter-40-taunts) | CC0 1.0 | Re-encoded to AAC |

Per-file provenance (source file, hashes, modifications) is in `assets/audio/voice-manifest.json`.

## Made for this game

- Runners, cycles, discs, gloves, platform pedestal and stadium shell: built by the game's author.
- First-person cockpit, cycle-grid stadium and the ring-wheel rival cycle in `assets/generated/`: modelled by script in
  Blender (`scripts/blender/`).
- Overwatch Hauler (`assets/generated/hauler.glb`): an original heavy craft modelled by script
  (`scripts/blender/build_hauler.py`), standing over the Outlands events.
- First-person cockpit v4 (`assets/generated/cockpit-v4.glb`): wrap-around swept binnacle, four-layer instrument stack,
  raked A-pillars, hex vents, floor pan and single-sweep yoke, modelled by script (`scripts/blender/build_cockpit_v4.py`).
- Cockpit console with the rider's hands, `assets/generated/cockpit-console.glb`: generated for this game from a concept
  image made for it (GPT Image, then Tripo image-to-3D, both through the owner's Higgsfield account), then fitted and
  recoloured in code.
- Rival cycle `assets/generated/cycle-wraith.glb`: generated for this game from a written description (Tripo text-to-3D,
  through the owner's Higgsfield account), then scaled and recoloured per rider in code.
- City backdrops (`assets/generated/panoramas/`): AI-generated images made by the game's author with ChatGPT and
  Nano Banana 2, converted to JPEG.
- Effects and music loops (`audio/sfx_*.mp3`, `audio/mus_*.m4a`): generated for the author's earlier project and reused
  here. Everything else is synthesised at runtime, and the synthesiser is the fallback if a clip fails to load.

## Software and type

- [three.js](https://threejs.org) — MIT
- Syncopate — Apache 2.0; Saira Condensed and Share Tech Mono — SIL Open Font License 1.1 (via Fontsource)

## Held in `assets/` but not shipped

These files stay in the source folder and are not copied into the build.

| File | Title | Author | Licence | Why it is not shipped |
|---|---|---|---|---|
| `Environments/bridge.glb` | "Tron Legacy Bridge — 2008 Teaser Version" | Shriker1 | CC BY 4.0 | One fixed 390 m straight span. The circuits build their own bridges, which follow the track's curve and cross-slope; a straight model cannot |
| `Environments/tunnel.glb` | "Tron tunnel" | V | CC BY 4.0 | A straight 80 m bore. The circuits build their own, swept along the ribbon so they bend and bank with it |
| `Environments/sky_circuit.glb` | "Tron Race Arena" | ImWillows | CC BY 4.0 | Its layout does not match any generated circuit; no placement found for it yet |
| `Concept Images/New/cycles/tron_moto_sdc…` (two files) | "TRON MOTO SDC (FREE)" and its low-poly version | SDC PERFORMANCE | CC BY 4.0 | 1.06 million triangles each; far over budget |
| `Concept Images/New/environments/tron_grid_floor.glb` | "Tron Grid Floor" | SpringSociety (per the file's own metadata) | CC BY 4.0 | The game draws its own floor |
| `Concept Images/New/other/helmet_hyper…` | "Helmet Hyper — Tron Evolution Battle Grids" | Shriker1 | CC BY 4.0 | The runners wear their own helmets; nowhere to put a loose one |
| `Concept Images/New/environments/TronRoad.webp` | — | — | — | Reference image, not an asset |

Authors and licences for the Sketchfab files come from the metadata embedded in each download where present, and
otherwise from the owner's records.
