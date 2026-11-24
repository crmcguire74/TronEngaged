# TRON ENGAGED — asset production brief

Everything this build is ready to use but does not yet have a recording or a picture for. Nothing here blocks play:
the synthesiser covers missing effects, captions print as subtitles with no voice, and environments without a
panorama fall back to the procedural sky. Each row drops straight in — no code change — as long as the file name
matches.

## Where files go

| Kind | Folder | Name | Picked up by |
|---|---|---|---|
| Voice line | `assets/audio/` | `vo_<caption_in_snake_case>.wav` | the caption string, lower-cased, non-alphanumerics to `_` |
| Rival jeer | `assets/audio/` | `jeer_intro_<archetype>.wav` | the archetype id in `src/games/discs/archetypes.ts` |
| Sound effect | `assets/audio/` | `sfx_<key>.wav` (or `sfx_<key>_2.wav` … for variants, picked at random) | the key passed to `audio.sfx(...)` |
| Ambience loop | `assets/audio/` | `amb_<environment>.wav` | the environment id in `src/engine/env.ts` |
| Music bed | `assets/audio/` | `mus_<track>.mp3` | `audio.playMusic(...)` |
| 360° sky | `assets/panoramas/` | `<environment>.jpg` (full equirectangular) or `<environment>-band.jpg` (wide strip, mirrored around the horizon) | the environment id |

Then run `npm run assets:sync`. Source files in `assets/` are never moved or renamed; the sync writes runtime copies
into `public/game-assets/`.

Format: WAV 48 kHz mono for effects and voice, stereo for ambience and music. Normalise to about −3 dBFS peak,
−16 LUFS for voice. Panoramas: JPEG, 4096 px wide maximum (anything larger is scaled on the way in).

---

## 1. Voice lines — announcer

The announcer is the grid's system voice: calm, close-mic'd, slightly processed, no shouting. Every line is already
wired to a moment in play; today it prints as a subtitle and stays silent.

Base prompt for all announcer lines (prepend to each):

> Male/female neutral synthetic announcer voice, calm and clinical, close-mic'd, light vocoder sheen and a short
> plate reverb, as if routed through a stadium PA inside a dark neon arena. No excitement, no shouting. Deliver the
> line flat and final.

| File | Line | Length | Fires when |
|---|---|---|---|
| `vo_rail_impact.wav` | "Rail impact." | 0.8 s | the player is rammed into a rail and survives |
| `vo_barrier_ahead.wav` | "Barrier ahead." | 0.9 s | the interceptor drops a hardlight barrier within 190 m of the player |
| `vo_rider_shunted.wav` | "Rider shunted." | 1.0 s | the player lands a heavy side-on hit on a rival |
| `vo_deck_destroyed.wav` | "Deck destroyed." | 1.0 s | one of the player's own platforms fails in a Null Sector tier |
| `vo_their_footing_is_gone.wav` | "Their footing is gone." | 1.3 s | the player breaks a rival platform |
| `vo_lance_array_online.wav` | "Lance array online." | 1.3 s | a Vanguard or the Null Kernel re-arms to lances |
| `vo_arc_blades_online.wav` | "Arc blades online." | 1.3 s | a Vanguard or the Null Kernel re-arms to arc blades |
| `vo_opponent_re_armed.wav` | "Opponent re-armed." | 1.2 s | any other weapon escalation |

## 2. Voice lines — rival jeers

Spoken by the rival, in character, positional (played from where the rival is standing). Heard once, as the rival
walks up at the start of a Disc Arena tier.

| File | Line | Length | Prompt |
|---|---|---|---|
| `jeer_intro_lancer.wav` | "Put the shield down. It will not help you." | 2.6 s | Dry, precise, almost bored. A marksman who has done this many times. Thin vocoder, close mic, no reverb tail. |
| `jeer_intro_breaker.wav` | "I will take the floor out from under you." | 2.6 s | Heavy, slow, gravel-low male voice, pitched down about three semitones, with a faint mechanical rumble under it. |
| `jeer_intro_vanguard.wav` | "I have three ways to end this. You will see them all." | 3.4 s | Cold, officer-class, clipped consonants. Light harmoniser a fifth below for an inhuman edge. |
| `jeer_intro_boss-null.wav` | "You are a process. I am the system that ends it." | 3.6 s | Layered: a calm human voice and a detuned synthetic double, both at once, with a long dark hall reverb. Final, unhurried, no menace in the delivery — menace in the words. |

## 3. Sound effects

Mono, dry (the engine does its own distance and panning). Transients matter more than tails: most of these are heard
at speed over an engine bed.

| File | Length | Heard when | Prompt |
|---|---|---|---|
| `sfx_barrierDrop.wav` | 0.9 s | the interceptor lays a barrier across the lane | A sheet of hardlight snapping into existence across a road: a fast rising electrical whoosh into a hard glassy *chank*, then a short ringing tail. Clean, synthetic, no debris. |
| `sfx_interceptorPass.wav` | 1.6 s | the same moment, from the jet overhead | A single-seat jet passing low and fast overhead, Doppler shifting down, with a tight electric turbine whine rather than a combustion roar. Starts distant-left, ends distant-right. |
| `sfx_railSlam.wav` | 1.1 s | the player is shoved into an energy rail | A light cycle slamming side-on into a glowing barrier: a heavy metallic impact, a bright electrical flare, and a scraping decay as it drags along. |
| `sfx_tunnelEnter.wav` | 1.2 s | the rider enters a bore | The acoustic flip from open air to an enclosed tube at speed: a sudden low-pass swallow, a pressure thump, and a short slapback that keeps repeating as the tail falls away. |
| `sfx_tunnelExit.wav` | 1.0 s | the rider leaves a bore | The reverse: the slapback opening out into wide air, with a brief rush of wind as the pressure releases. |
| `sfx_deckCrack.wav` | 0.5 s | a disc chips a breakable platform | A hairline fracture running through thick structural glass: a short bright crackle with a glassy ring, no shatter yet. |
| `sfx_deckBreak.wav` | 1.8 s | a platform fails for good | A suspended glass-and-light platform giving way: a deep structural crack, a cascade of hard glass fragments falling into empty space, and a low hum cutting out as its power dies. |
| `sfx_rearm.wav` | 1.0 s | a rival escalates to a new weapon | Hardlight hardware reconfiguring on a fighter's arm: three fast mechanical clicks, a rising charge, and a confident settling tone. |
| `sfx_lanceFire.wav` | 0.6 s | a Lancer or re-armed rival fires a bolt | A straight energy bolt launching: a tight electromagnetic snap with a hard crack on the front and almost no tail. Flat, fast, unmistakably not a thrown disc. |
| `sfx_lanceImpact.wav` | 0.7 s | a lance punches through a raised shield | An energy bolt tearing through a shield: a brittle tearing crack, a flare of static, then a short descending whine. |
| `sfx_arcBlade.wav` | 1.3 s | an arc blade is thrown | A heavy glowing blade thrown end over end: a slow wide whoosh cycling two or three times, with a metallic resonance underneath. Slower and heavier than a disc. |
| `sfx_wall.wav` | 0.8 s | any rider lays a light wall | A hardlight wall extruding behind a cycle: a rising synthetic hiss with a glassy edge, settling into a steady low hum. |

## 4. Ambience loops

Seamless loops, stereo, 30–60 s, no obvious landmark events (they play under everything).

| File | Length | Environment | Prompt |
|---|---|---|---|
| `amb_outlands.wav` | 45 s | The Outlands (Light Cycles tiers 31–36) | Wide empty wasteland beyond a city wall at night: low wind over glass plains, a distant electrical storm, an intermittent deep mechanical groan from something very large and far away. Sparse, cold, almost silent in places. |
| `amb_null-sector.wav` | 45 s | Null Sector (Disc Arena tiers 31–36) | A derelict data hall: a failing power hum that drifts in pitch, irregular capacitor ticks, a faint choir-like resonance far off, and the occasional distant structural crack. Unsettling, never rhythmic. |

## 5. 360° backgrounds

Equirectangular 2:1, 4096 × 2048 JPEG. The grid floor, track and architecture are real geometry — these only fill
the sky and the far horizon, so keep the lower third dark and uncluttered and put the interest at and above the
horizon line. Avoid anything that reads as ground: it will fight the real floor.

| File | Environment | Prompt |
|---|---|---|
| `outlands.jpg` | The Outlands | Equirectangular 360° panorama, 2:1. A black glass desert at night under a starless indigo sky. On the horizon, the silhouette of a vast distant city wall lit by a single cyan line running its whole length. Overhead, slow orange auroral sheets. Lower third almost pure black. Hyper-real, cinematic, deep contrast, no ground detail, no people, no text. |
| `null-sector.jpg` | Null Sector | Equirectangular 360° panorama, 2:1. The inside of a colossal derelict data cathedral: ribbed black structure vaulting overhead, broken light conduits trailing dead cyan tubes, one shaft of pale orange light falling from a fracture far above. Dust in the air. Lower third near black. Hyper-real, cinematic, cold, no people, no text. |
| `infinite-grid.jpg` | Infinite Grid | Equirectangular 360° panorama, 2:1. An endless pale blue-white lattice receding to a vanishing point in every direction, under a sky of the same lattice continuing upward. Almost monochrome, very high key for a Tron scene, clean, geometric, no horizon landmark, no text. |
| `red-sector.jpg` | Red Sector | Equirectangular 360° panorama, 2:1. A canyon of black towers bled through with deep crimson light, heavy smoke between them, and a low red sun sitting exactly on the horizon. Menacing, saturated, cinematic. Lower third dark. No people, no text. |
| `core-reactor.jpg` | Core Reactor | Equirectangular 360° panorama, 2:1. The interior of an enormous reactor chamber: concentric rings of amber hardlight rotating around a blinding core directly overhead, black machinery filling the middle distance. Lower third dark. Hyper-real, cinematic, no people, no text. |

A wide strip rather than a full sphere also works: name it `<environment>-band.jpg` (for example
`outlands-band.jpg`), make it 4096 × 1024, and the game mirrors it around the horizon so it has no seam. Use the
band form for anything that is really a skyline.

## 6. Music

| File | Length | Used for | Prompt |
|---|---|---|---|
| `mus_outlands.mp3` | 2:30 loop | the Outlands block | Sparse, wide, slow-building electronic score. Analogue bass drone, a single sustained brass-like synth line, sub-bass pulse at about 92 BPM, almost no percussion until the last third. Daft-Punk-era Tron scoring, restrained, cold. |
| `mus_null.mp3` | 2:30 loop | Null Sector | Broken, glitching score: a decaying arpeggio that keeps losing its pitch, irregular low percussion, a choir pad sliding out of tune. 88 BPM, unsettling, never resolves. |

To wire a new bed in, add it to the music table in `src/engine/audio.ts` — a drop-in alone covers existing track
names (`menu`, `discs`, `cycles`, `race`, `combat`, `boss`, `hub`) but not new ones.
