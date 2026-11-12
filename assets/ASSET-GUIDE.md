# Asset guide: what to make, what to call it, where to drop it

This is the one list. It replaces the earlier `WANTED.md` and `PROMPTS.md`.

## How dropping a file in works

1. Save the file with the exact name shown here (lower case, no spaces) into the folder shown.
2. Run `npm run assets:sync`.
3. Reload the game.

| Folder | What goes there | Works with no code change? |
|---|---|---|
| `assets/audio/` | Voice lines, sound effects, loops, music | **Yes**, all of it, by file name |
| `assets/panoramas/` | Sky backdrops | **Yes**, by file name |
| `assets/ui/` | `logo` and `key-art` | **Yes** |
| `assets/ui/` | `icon-*.png` | No. I place these by hand |
| `assets/generated/concepts/` | Pictures to turn into 3D models | No. Each needs converting (credits or a Tripo key) and fitting |
| `assets/textures/` | Surface textures | No. I apply these by hand |
| `assets/` (any sub-folder) | Finished GLB models | No. Tell me the file name and I fit it |

Rules that apply to everything:

- A file you supply always wins over the built-in one with the same name. Any listed extension works, so `vo_ready.wav` replaces the built-in `vo_ready.m4a`.
- Delete your file and run the sync again to go back to the built-in version.
- Anything missing is simply skipped. The game falls back to what it has now.
- Everything should be original or licensed for use in a game. No named film or game designs, characters, logos or music.

---

## 1. Sky backdrops (automatic)

**Folder:** `assets/panoramas/`  **Format:** JPG, quality 85 or higher

Two shapes are accepted. The wide band is the easy one.

| Shape | File name | Size |
|---|---|---|
| Wide band (the game wraps and mirrors it) | `<name>-band.jpg` | 5376 × 2304 (21:9) or 6144 × 2048 (3:1). Minimum 4096 wide. Horizon about 40% up from the bottom |
| True 360° | `<name>.jpg` | 8192 × 4096 (exactly 2:1). Minimum 4096 × 2048. Horizon on the centre line, left and right edges must join |

If the tool gives you a smaller picture, upscale it to the size above before saving.

**Paste this first, then add the line for the picture you are making:**

> Ultra-wide cinematic panorama of a vast digital city at night, seen from the floor of an open arena looking straight at
> the horizon. The horizon line sits about 40% up from the bottom of the frame and is perfectly level. Distant
> architecture only: nothing closer than a few hundred metres, no foreground objects. Monolithic towers of black glass and
> dark metal with thin lines of light tracing their edges, elevated roadways and bridges between them, a faint grid of
> light stretching across the ground toward the horizon, low haze glowing at the skyline, a deep near-black sky with a
> few faint points of light. Dark overall, with the light concentrated in a band along the horizon, and the top and
> bottom thirds of the frame almost black. Hyper-detailed, sharp, photoreal rendering, long-lens compression, no people,
> no vehicles, no text, no logos, no lens flare, no watermark.

For a true 360° picture, replace the first sentence with: "Equirectangular 360 by 180 degree panorama, exactly 2:1, left
and right edges join seamlessly, horizon on the vertical centre line, of a vast digital city at night seen from the
floor of an open arena."

| File name | Where it shows | Add this line to the prompt |
|---|---|---|
| `menu-band.jpg` | Home screen | Colour: electric cyan light with small warm amber accents. Feature: one colossal spire at the exact centre with a thin halo ring of light floating high above the city. Calm and monumental. |
| `classic-stadium-band.jpg` | Disc Arena tiers 1–5 | Colour: electric cyan with warm orange accents. Feature: the inside of an enormous open stadium bowl, tier upon tier of dark stands rising all around, thousands of tiny points of light in the stands. |
| `vertical-chamber-band.jpg` | Disc Arena tiers 6–10 | Colour: pale periwinkle blue with amber accents. Feature: the walls of an immense vertical shaft, ribbed with structural rings and vertical light conduits that vanish upward. |
| `data-core-band.jpg` | Disc Arena tiers 11–15 | Colour: bright mint green with small rose-pink accents. Feature: a gigantic spherical reactor core far in the distance, wrapped in concentric rings, with data conduits converging on it. |
| `fractured-lattice-band.jpg` | Disc Arena tiers 16–20 | Colour: violet with pale gold accents. Feature: the city is broken into drifting slabs and shards hanging at slight angles, with gaps of pure darkness between them. |
| `corruption-zone-band.jpg` | Disc Arena tiers 21–25 | Colour: hot red with amber accents. Feature: towers that are cracked and partly dissolved into blocks, glowing fissures running up them, embers drifting upward. |
| `grand-colosseum-band.jpg` | Disc Arena tiers 26–30 | Colour: warm pale gold with small cyan accents. Feature: a monumental ceremonial arena, colossal arches and colonnades in dark stone and metal, banners of light hanging between them. |
| `classic-grid-band.jpg` | Cycle Combat, early arenas | Colour: electric cyan with orange accents. Feature: a clean, orderly skyline of rectangular towers on an endless flat plain covered in a square grid of light. Minimal and precise. |
| `data-tunnel-band.jpg` | Cycle Combat | Colour: mint green with lime accents. Feature: the inside of a tunnel so large it has its own horizon, with curved walls of machinery and bands of light running along its length. |
| `core-reactor-band.jpg` | Cycle Combat and Racing | Colour: molten orange with cyan accents. Feature: industrial reactor towers and cooling stacks, heat haze, pipelines of light crossing the plain. |
| `fractured-grid-band.jpg` | Cycle Combat | Colour: violet with mint accents. Feature: the ground grid is torn into plates at different heights, towers leaning, bridges snapped mid-span. |
| `championship-band.jpg` | Cycle Combat and Racing finals | Colour: pale gold with cyan accents. Feature: a floodlit championship stadium, vast grandstands glittering with crowd lights, light towers at the corners, searchlight beams. |
| `neon-circuit-band.jpg` | Racing, early circuits | Colour: cornflower blue with magenta accents. Feature: ribbons of elevated race track looping between the towers, lit along both edges. |
| `skyway-band.jpg` | Racing | Colour: icy sky blue with pale gold accents. Feature: seen from very high up, cloud layers below, slender towers rising through them, long suspension bridges between the tower tops. |
| `metropolis-band.jpg` | Racing | Colour: hot pink with sky-blue accents. Feature: a dense street canyon city, far taller and closer-packed than usual, layered roadways stacked many levels deep. |
| `red-sector-band.jpg` | Racing | Colour: crimson with pale cream accents. Feature: a fortified district, blunt armoured towers, watch-lights, long defensive walls along the horizon. |
| `infinite-grid-band.jpg` | Final cycle tiers and endless modes | Colour: almost white ice-blue with cyan accents. Feature: almost nothing. An endless flat grid running to a perfectly empty horizon, with only three or four needle-thin towers impossibly far away. |

---

## 2. Logo and loading art (automatic)

**Folder:** `assets/ui/`

| File name | Size | Where it shows | Prompt |
|---|---|---|---|
| `logo.svg` or `logo.png` | SVG, or PNG 4096 px wide with a transparent background | Replaces the lettered wordmark on the home screen and menus | Wordmark logo reading exactly "VANTA ARC" in wide, geometric, all-capital sans-serif letters with generous letter spacing. The word VANTA in white and ARC in electric cyan. Flat vector style, razor-sharp edges, no glow, no gradient, no icon, no tagline, on a fully transparent background. |
| `key-art.jpg` | 3840 × 2160 (16:9) | Behind the loading bar | 16:9 cinematic key art for a science-fiction arena game. Left: a figure in a black armoured suit with cyan light lines, seen from behind, arm drawn back holding a glowing disc. Right: a low black racing cycle with glowing wheel rims leaving a solid wall of light behind it. Between them a vast dark arena with a grid floor and a city of light on the horizon. Dark, high contrast, cyan with small orange accents, clear empty space across the top third for a title, no text, no logos. |

---

## 3. Voice lines (automatic)

**Folder:** `assets/audio/`  **Format:** WAV (48 kHz, mono) preferred; M4A, MP3 or OGG also work

One line per file. Trim the silence from both ends, keep peaks around −3 dB, and leave out music and reverb (the game adds its own space). Up to about 2 seconds each.

### Announcer: lines that already have a recording

Save a file with the same name to replace it.

| File name | Says | When |
|---|---|---|
| `vo_ready` | "Ready." | Countdown begins |
| `vo_fight` | "Fight." | Disc Arena starts |
| `vo_begin` | "Begin." | Cycle Combat or a race starts |
| `vo_final_round` | "Final round." | A boss tier opens, just after the warning |
| `vo_you_win` | "You win." | Win, when no more specific line below is supplied |
| `vo_winner` | "Winner." | Combat win or first place, when no more specific line is supplied |
| `vo_flawless_victory` | "Flawless victory." | Disc Arena won without taking a hit |
| `vo_you_lose` | "You lose." | Loss, when no more specific line is supplied |
| `vo_game_over` | "Game over." | Cycle Combat loss, when no more specific line is supplied |

### Announcer: new lines

These show as a caption today. Supply the file and the caption is spoken.

| File name | Says | When |
|---|---|---|
| `vo_warning_prime_opponent_detected` | "Warning. Prime opponent detected." | A boss tier opens |
| `vo_reinforcements_inbound` | "Reinforcements inbound." | More rivals arrive |
| `vo_final_opponent_remaining` | "Final opponent remaining." | One rival left, Disc Arena |
| `vo_final_runner_remaining` | "Final runner remaining." | Elimination race, two riders left |
| `vo_boundary_collapsing` | "Boundary collapsing." | The Cycle Combat arena starts to shrink |
| `vo_trap_confirmed` | "Trap confirmed." | A rival hits your wall in Cycle Combat |
| `vo_final_lap` | "Final lap." | Last lap of a race |
| `vo_sector_complete` | "Sector complete." | Disc Arena won |
| `vo_runner_offline` | "Runner offline." | Disc Arena lost |
| `vo_arena_cleared` | "Arena cleared." | Cycle Combat won |
| `vo_ribbon_severed_try_again` | "Ribbon severed. Try again." | Cycle Combat lost, tiers 1–4 |
| `vo_too_slow` | "Too slow." | Cycle Combat lost, later tiers (one of five, picked at random) |
| `vo_flatlined` | "Flatlined." | as above |
| `vo_loser` | "Loser." | as above |
| `vo_boxed_in` | "Boxed in." | as above |
| `vo_recompile_and_return` | "Recompile and return." | as above |
| `vo_first_across_the_line` | "First across the line." | Race won in first place |
| `vo_event_complete` | "Event complete." | Race passed, not in first |
| `vo_event_failed` | "Event failed." | Race lost |

### Rivals

Use a different voice from the announcer. These play from where the rival is standing.

| File name | Suggested line | When |
|---|---|---|
| `jeer_prepare_yourself` | "Prepare yourself." | Any rival steps out, when no line for its type is supplied |
| `jeer_loser` | "Loser." | A rival beats you |
| `jeer_intro_sentinel` | "Unit ready." | A Sentinel steps out |
| `jeer_intro_striker` | "Try to keep up." | Striker |
| `jeer_intro_guardian` | "Nothing gets past me." | Guardian |
| `jeer_intro_hunter` | "I have your scent." | Hunter |
| `jeer_intro_ricochet` | "Watch the walls." | Ricochet Specialist |
| `jeer_intro_disruptor` | "Your signal is mine." | Disruptor |
| `jeer_intro_commander` | "Formation. On my mark." | Commander |
| `jeer_intro_boss-guardian` | "You will not pass." | First boss |
| `jeer_intro_boss-enforcer` | "Sentence: deletion." | Second boss |
| `jeer_intro_boss-architect` | "I built this arena. I decide who leaves." | Third boss |
| `jeer_intro_boss-overseer` | "I see every move before you make it." | Fourth boss |
| `jeer_intro_boss-prime` | "I am the last thing you will face." | Final boss |

The rival lines are suggestions. Any words work, because the game goes by the file name.

---

## 4. Sound effects (automatic)

**Folder:** `assets/audio/`  **Format:** WAV preferred; MP3, M4A or OGG also work

Name the file `sfx_<effect>`. For variety, add more takes as `sfx_<effect>_2`, `sfx_<effect>_3`, and the game picks one at random each time. File names are not case-sensitive. The "Sounds like" column works as a prompt for a sound-effect generator.

### Disc Arena

| File name | Moment | Sounds like | Length |
|---|---|---|---|
| `sfx_throw` | Disc leaves your hand | Sharp energy-disc release: a fast metallic whip-crack with a rising electric whirr | 0.4–0.7 s |
| `sfx_whoosh` | Disc passes close by | Fast airy fly-by with an electric edge | 0.5–1 s |
| `sfx_ricochet` (+ `_2`, `_3`) | Disc bounces off a wall | Hard glassy ping with a short electric zap, like a puck striking tempered glass | under 0.6 s |
| `sfx_clash` | Two discs collide in the air | Two energy blades striking: bright metallic clang with a burst of sparks | under 0.6 s |
| `sfx_hit` | Your disc strikes a rival | Punchy impact with a digital crunch and a short bass thump | under 0.6 s |
| `sfx_hurt` | A disc strikes you | Heavy dull body impact with a distorted electrical jolt, muffled as if heard inside a helmet | under 0.7 s |
| `sfx_catch` | Disc returns to your hand | Magnetic snap-lock: quick suction, then a solid click | under 0.4 s |
| `sfx_recall` | You call the disc back | Reverse whoosh rising in pitch, energy being pulled in | 0.4–0.7 s |
| `sfx_shieldUp` | Shield raised | Energy shield igniting: a quick rising hum that locks into a steady tone | under 0.6 s |
| `sfx_shieldDown` | Shield lowered | Energy shield powering down: falling hum, soft click | under 0.5 s |
| `sfx_block` | Disc strikes a shield | Deep resonant thud on an energy field with a crackle | under 0.6 s |
| `sfx_parry` | Perfectly timed block | Bright, clean crystalline chime over a sharp deflection snap | under 0.8 s |
| `sfx_shieldBreak` | Shield destroyed | Energy shield shattering like a pane of glass, with a falling electrical buzz | 0.8–1.2 s |
| `sfx_explosion` | Volatile disc detonates | Compact energy explosion: sharp crack, deep boom, fizzing tail | 1–1.5 s |
| `sfx_tell` | A rival winds up a throw | Short rising charge-up whine, a warning | about 0.6 s |
| `sfx_tellHoming` | A rival winds up a homing throw | Rising charge-up whine with a pulsing lock-on beep | about 0.6 s |
| `sfx_jump` | You hop to another platform | Short upward energy burst, a soft thruster puff | under 0.4 s |
| `sfx_land` | You land | Boots landing on a metal and glass platform: low thud with a faint ring | under 0.4 s |
| `sfx_dodge` | You sidestep | Quick swish of fabric and air | under 0.3 s |
| `sfx_warn` | Platform about to fail, or a volley is called | Urgent two-tone alarm blip, descending | under 0.8 s |
| `sfx_platformDown` | Platform drops away | Platform losing power: descending hum, then a heavy mechanical drop | 1–1.5 s |
| `sfx_platformUp` | Platform returns | Platform powering up: rising hum ending in a solid lock clunk | 1–1.5 s |
| `sfx_ready` | Your disc is armed and ready to throw again | Soft single synth tone, a gentle confirmation | under 0.5 s |
| `sfx_surge` | A platform surges with energy | Capacitor discharge crackling across a metal deck, with a rising electric whine | under 0.8 s |
| `sfx_shift` | Platforms start to move | Heavy machinery sliding on rails, low servo groan | 0.6–1 s |
| `sfx_interfere` | A Disruptor jams you | Digital glitch burst: stuttering static and bit-crushed warble | 0.5–1 s |
| `sfx_boss` | A boss arrives | Massive low synth hit with a sub-bass drop, ominous | 2–3 s |
| `sfx_scream` | You are destroyed | A short shout of shock, cut off by digital disintegration | 1–1.5 s |

### Cycle Combat and Racing

| File name | Moment | Sounds like | Length |
|---|---|---|---|
| `sfx_turn` | 90° turn | Tight, clipped servo snap with a tiny tyre chirp | under 0.2 s |
| `sfx_boost` | Launch off the line, super speed | Turbine surge: fast rising whoosh into a punchy jet kick | 0.7–1 s |
| `sfx_prox` | Wall close ahead (repeats quickly) | One short, high warning tick | under 0.15 s |
| `sfx_nearMiss` | You skim past a wall | Very fast close fly-by swish with an electric sizzle | under 0.5 s |
| `sfx_crash` | A cycle hits a wall | High-speed impact into an energy wall: hard crunch, electrical burst, debris | 1–1.5 s |
| `sfx_scrape` | Rubbing a rail or a rival (repeats) | Metal grinding on an energy barrier, with sparks | 0.3–0.5 s |
| `sfx_drift` | Sliding through a corner (repeats) | Tyres sliding on a glassy surface, a short hiss-squeal | 0.4–0.6 s |
| `sfx_pad` | Crossing a speed strip, or a drift boost | Bright ascending zip | under 0.5 s |
| `sfx_pickup` | Power-up collected | Sparkling ascending three-note chime | under 0.6 s |
| `sfx_power` | Ability fired | Punchy energy pulse release with a short bass thump | under 0.7 s |
| `sfx_checkpoint` | Checkpoint passed | One clean confirmation tone | under 0.4 s |
| `sfx_lap` | Lap completed | Two-note rising chime, brighter than the checkpoint | under 0.7 s |

### Shared

| File name | Moment | Sounds like | Length |
|---|---|---|---|
| `sfx_spawn` | Anyone materialises | Shimmering particles rising and resolving into a solid tone | 0.6–1 s |
| `sfx_shatter` | A rider or rival breaks apart | A body shattering into glass cubes: bright break, then a cascade of tinkling fragments | 1.5–2 s |
| `sfx_beep` | Countdown 3, 2, 1 | Short clean mid-pitch beep | under 0.25 s |
| `sfx_go` | GO | A longer, higher beep with a punch | 0.4–0.6 s |
| `sfx_win` | Event won | Short triumphant synth fanfare, rising and resolved | 2–4 s |
| `sfx_lose` | Event lost | Descending minor synth phrase, like a system powering down | 2–3 s |
| `sfx_uiMove` | Menu highlight moves | Tiny soft tick | under 0.1 s |
| `sfx_uiSelect` | Menu item chosen | Short bright confirm blip, two quick rising tones | under 0.2 s |
| `sfx_uiBack` | Menu back | Short soft blip, two quick falling tones | under 0.2 s |
| `sfx_boot` | Opening screen text types out (repeats fast) | Tiny terminal blip | under 0.08 s |
| `sfx_motif` | Opening screen logo appears | A signature four-note synth sting, wide and warm | 2–3 s |

Four of these already use a recording (`sfx_disc_throw`, `sfx_ricochet`, `sfx_shatter`, `sfx_crash`). The rest are synthesised until you supply a file.

---

## 5. Loops and crowd (automatic)

**Folder:** `assets/audio/`  All loops must repeat without a click: the end has to flow into the start.

| File name | What it is | Sounds like | Length |
|---|---|---|---|
| `sfx_cycle_engine` | Your engine. The game raises and lowers its pitch with speed | Steady electric turbine hum with a low mechanical throb, at one constant pitch, no revving | 4–8 s loop |
| `crowd_bed_ambience` | Arena crowd, always under the action | A very large indoor crowd murmuring, no single voices, no cheering | 20–40 s loop |
| `crowd_cheer_soft` | Small reaction | A large crowd reacting with brief approval | 4–6 s |
| `crowd_cheer_strong` | Big reaction | A large crowd erupting into a cheer | 5–8 s |
| `crowd_cheer_strong2` | Win | A large crowd in a long, sustained roar with applause | 8–12 s |
| `amb_<environment>` | Background atmosphere for one place | See below | 30–60 s loop |

Ambience is new and optional. Name the file after the place, using the same names as the backdrops:
`amb_menu`, `amb_classic-stadium`, `amb_vertical-chamber`, `amb_data-core`, `amb_fractured-lattice`,
`amb_corruption-zone`, `amb_grand-colosseum`, `amb_classic-grid`, `amb_data-tunnel`, `amb_core-reactor`,
`amb_fractured-grid`, `amb_championship`, `amb_neon-circuit`, `amb_skyway`, `amb_metropolis`, `amb_red-sector`,
`amb_infinite-grid`.

Starting prompt for any of them: "Seamless looping background ambience of a vast, dark, futuristic [place]. Deep
electrical hum, distant machinery, slow air movement, an occasional far-off tone. No music, no voices, no sudden
sounds." Swap in the place: an open stadium, a towering vertical shaft, a reactor core, a windy bridge high above the
clouds, a dense city canyon, an empty plain.

---

## 6. Music (automatic)

**Folder:** `assets/audio/`  **Format:** M4A or MP3, stereo, 192 kbps or higher. Seamless loop, 60–120 seconds, instrumental.

The game opens the music up as the action gets more intense, so a full, steady loop works better than one with a long quiet intro.

| File name | Plays | Describe it as |
|---|---|---|
| `mus_menu` | Home screen and menus | Slow, spacious electronic score. Warm analogue synth pads, a gentle pulsing bass, a simple four-note motif, about 90 BPM. Calm and monumental. |
| `mus_discs` | Disc Arena | Tense, driving electronic duel music. Tight arpeggiated synths, punchy drums, about 120 BPM, building but never resolving. |
| `mus_cycles` | Cycle Combat | Fast, relentless electronic chase music. Hard sequenced bassline, sharp percussion, rising synth stabs, about 132 BPM. |
| `mus_race` | Racing | Bright, propulsive electronic racing music. Soaring lead synth over a rolling bassline and four-on-the-floor drums, about 140 BPM. Exhilarating. |
| `mus_boss` | Boss tiers | Heavy, ominous orchestral and electronic hybrid. Low brass-like synths, pounding drums, a dark repeating motif, about 110 BPM. |

Until these exist, menus use `mus_hub` and everything else uses `mus_combat`. You can replace those two as well.

---

## 7. Things I have to fit by hand

These are still worth making. Drop them in and tell me, and I do the rest.

### Concept pictures for 3D models

**Folder:** `assets/generated/concepts/`  **Size:** 2048 × 2048 PNG

**Start every prompt with:**

> Clean 3D-modelling reference render of one single object, isolated on a plain light grey studio background, whole
> object in frame and centred, nothing cropped. Three-quarter view from slightly above. Premium hard-surface concept
> design in satin black carbon and dark gunmetal alloy, crisp chamfered panels with deep machined panel lines, thin
> glowing cyan light strips inlaid along the seams. Symmetrical, sharp readable silhouette, clear material zones, soft
> even studio lighting, no cast shadows cluttering the ground, no people unless stated, no text, no logos.

| File name | Add this |
|---|---|
| `stadium-stand.png` | The object: one repeating bay of a futuristic grandstand, about 16 m wide and 24 m tall, seen from the arena side. A solid retaining wall at the bottom with a line of light along its top edge, a steeply raked seating deck with light strips on each step, a glazed gallery level above, and a cantilevered roof leaning out over the seats with a lit front edge. A structural fin on each side so copies butt together. |
| `stadium-tower.png` | The object: a tall corner tower for a stadium, about 50 m high on a 10 m square base, stepping in at three levels with a band of light at each step, vertical light seams up each face, and a thin ring of light floating above a pointed cap. |
| `rival-cycle-heavy.png` | The object: an original futuristic racing motorcycle built like a battering ram: short, tall and broad-shouldered, very wide front fairing like a shield, twin thick rear wheels close together, exposed mechanical swingarm, enclosed dark canopy, no rider. Complete vehicle standing on its wheels. |
| `rival-cycle-dart.png` | The object: an original futuristic racing motorcycle built like a dart: extremely long and low, needle nose, small front wheel and one very large rear wheel with a glowing rim, single spine running the whole length, enclosed dark canopy, no rider. Complete vehicle standing on its wheels. |
| `runner-sentinel.png` | The object: a full-body humanoid figure standing in an A-pose, arms held away from the body, hands open and empty, feet shoulder-width apart, facing the camera straight on. Slim athletic build in a sleek black armoured bodysuit, smooth featureless helmet with a dark visor, thin white-blue circuit lines over the chest, limbs and helmet. A foot soldier: plain and uniform. |
| `runner-striker.png` | Same A-pose figure. Lean and light, minimal armour, streamlined helmet with a swept-back crest, gold circuit lines. Built for speed. |
| `runner-guardian.png` | Same A-pose figure. Heavy and broad, thick shoulder and forearm plating, a reinforced collar, helmet with a narrow horizontal visor slit, orange circuit lines. Built to block. |
| `runner-hunter.png` | Same A-pose figure. Predatory: asymmetric armour, one shoulder plated, helmet with a single offset glowing lens, magenta-pink circuit lines. |
| `runner-ricochet.png` | Same A-pose figure. Angular faceted armour like cut crystal, helmet with a prism-shaped visor, green circuit lines. |
| `runner-disruptor.png` | Same A-pose figure. Technical: antenna fins on the helmet and back, small emitter nodes on the forearms, violet circuit lines. |
| `runner-commander.png` | Same A-pose figure. Imposing and formal: a short armoured mantle over the shoulders, tall helmet crest, amber circuit lines. |
| `runner-boss.png` | Same A-pose figure, but a giant: far heavier and taller in proportion, layered plate armour, a crowned helmet with a full dark visor, red circuit lines, a glowing core in the chest. |
| `disc.png` | The object: a throwing disc about 30 cm across, viewed three-quarters so the face and the rim both show. A machined dark alloy ring with a recessed channel of light running round the rim, four small emitter nodes spaced around it, concentric grooves on the face and a bright lens at the centre. |
| `barrier-panel.png` | The object: a free-standing rectangular energy barrier, 10 m wide and 5 m tall, a heavy dark frame with emitter blocks at the four corners holding a pane of translucent hexagon-patterned light. |
| `deflector-panel.png` | The object: a free-standing angled deflector, a tall narrow slab of mirror-smooth dark glass in a wedge-shaped armoured base, tilted like a billboard, with a line of light down each edge. |
| `powerups.png` | Four small separate floating objects in a row, each about 1 m across and each a different shape: a hollow octahedron cage, a thick ring, a jagged lightning-shaped prism, and a forward-pointing arrowhead. Each has a dark alloy frame around a glowing core. |
| `patrol-craft.png` | The object: an original hovering patrol craft about 12 m long, a flat armoured wedge with two downward-angled side pylons ending in glowing emitters, a row of lit sensor slots along the front edge, no cockpit windows, no wings, no wheels. |

For a better model, follow each with: "Now show exactly the same object from the front, the back, the left side and the
right side, as four separate images at the same scale on the same background." Save those as `<name>-front.png`,
`<name>-back.png`, `<name>-left.png`, `<name>-right.png`.

Already made and waiting for conversion: `player-cycle.png`, `disc-platform.png`.

### Textures

**Folder:** `assets/textures/`  **Size:** 2048 × 2048 PNG, tileable

**Start every prompt with:**

> Seamless tileable game texture, perfectly flat top-down orthographic view, no perspective, evenly lit with no shadows
> and no highlights, edges that repeat without a visible seam, sharp detail, no text, no logos.

| File name | Add this |
|---|---|
| `arena-deck.png` | Large square floor plates of very dark graphite metal with fine brushed grain, hairline gaps between plates, tiny recessed fasteners at the plate corners. Almost black, subtle. |
| `platform-deck.png` | Dark machined hexagonal tiles with bevelled edges and a fine anti-slip dot pattern on each tile. Near-black gunmetal. |
| `carbon-weave.png` | Satin black carbon-fibre weave in a tight 2×2 twill, very fine, low contrast. |
| `wall-panel.png` | Tall rectangular wall panels of dark alloy with recessed seams, small vent slots and inset service hatches arranged on a regular grid. |
| `track-surface.png` | Dark fine-grained racing surface, like asphalt made of compressed black glass, with a faint directional grain. No lines or markings. |

A matching bump map helps. Ask: "Now make the matching normal map for this exact texture." Save it as `<name>_normal.png`.

### Icons

**Folder:** `assets/ui/`  **Size:** 512 × 512 PNG, transparent background, pure white

Prompt: "Minimal single-colour icon of [subject]. Pure white flat shape, bold even stroke, no shading, no outline box,
centred, fully transparent background."

| File name | Subject |
|---|---|
| `icon-disc.png` | a throwing disc seen face-on |
| `icon-shield.png` | a hexagonal shield |
| `icon-boost.png` | a forward-pointing double chevron |
| `icon-light-wall.png` | a wall trailing behind a wheel |
| `icon-phase.png` | a hollow diamond |
| `icon-purge.png` | a ring with a slash through it |
| `icon-shock.png` | a lightning bolt |
| `icon-pulse.png` | expanding concentric rings |

### Finished 3D models

GLB, Y up, real-world metres, origin on the floor at the centre, under 60,000 triangles each, textures 2048 px or
smaller. Include the author and licence for anything you did not make yourself.

---

## Checking a result before you save it

Reject any picture that has people (unless the prompt asked for a figure), readable text, a logo, a watermark, or a
design you recognise from a film or another game. If a set of pictures drifts apart in style, add: "Keep exactly the
same style as the previous image."
