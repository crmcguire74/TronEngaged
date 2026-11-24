# TRON ENGAGED

A modern 3D Tron experience: web, VR, immersive gaming. Two arcade games in one browser build, playable on desktop
and in VR (WebXR):

- **Disc Arena** — third-person disc duels on suspended platforms: ricochets, shield/parry, platform hops, breakable
  decks, rivals that re-arm through three weapons, bosses.
- **Light Cycles — Combat** — classic 90° turns and permanent hardlight walls.
- **Light Cycles — Racing** — fluid steering, drifting, boost and checkpoints over hills, through bores, across
  suspension spans and down tower canyons; seven race formats and an air interceptor.

36 authored tiers per game (72 total), endless seeded modes, four difficulties, local save.

> Built from `TronPRD.pdf`. This is a personal, non-commercial fan build: it uses the Tron name and the supplied Tron
> models as its hero art. Third-party models and audio, and the licence each one carries, are listed in `CREDITS.md`;
> anything whose licence does not allow redistribution in a build is held in `assets/` and never shipped.

## Where it runs

Production is the Netlify site `tronengaged`, served at **https://tronengaged.paguire.com** (the original
`tronengaged.netlify.app` redirects there once that domain is set primary). `main` is what deploys.

The build sets `base: './'` in `vite.config.ts`, so every asset URL is relative and the game runs from any host or
subpath without a rebuild. Cache headers are in `netlify.toml`.

> Progress is held in IndexedDB under the database `tron-engaged`, which the browser keys to the **origin**. Moving
> the game to a different hostname therefore starts every player from tier 1, and nothing client-side can carry a
> save across origins. Pick one canonical URL and redirect the other to it rather than leaving two live, or players
> end up with two separate save files depending on which link they followed.

## Run

```bash
npm install
npm run dev        # http://localhost:5188
npm test           # unit tests + bot playtests of every authored tier
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ on :5189
```

VR needs a secure context. For a headset on your LAN:

```bash
HTTPS=1 npm run dev
```

Then open `https://<your-machine-ip>:5188` in the headset browser, accept the self-signed certificate, and choose
**Enter VR** on the menu.

## Controls

| | Keyboard / mouse | Gamepad | VR |
|---|---|---|---|
| Disc: move / aim | WASD / mouse | left / right stick | left stick / throwing hand |
| Disc: throw | hold + release LMB | hold + release RT | close the throwing hand (trigger or grip), swing or point, then open it |
| Disc: shield, parry | RMB (raise late to parry) | LT | other hand's trigger or grip; the shield sits on that forearm and blocks where it faces |
| Disc: jump / hop / dodge / recall | Space (+dir) / Shift / R | A / B / RB | A or X (or right stick up) / B / close the empty throwing hand |
| Combat: turn | A D or ← → | stick flick, d-pad | flick either stick |
| Combat: faster / slower / super speed / ability | W / S / Shift / E | RT / LT / A / B | any trigger or grip / left stick back / A / X |
| Race: steer / throttle / brake (drift) | A D / W / S | stick / RT / LT | either stick / any trigger or grip / left stick back |
| Camera view / menu | C / Esc | RB / Start | B (right hand) / hold left Y |

Keys are remappable under **Settings → Controls**. Comfort options (snap turn, seated, vignette) are under **Settings**.

In VR:

- **Left-handed controls** (top of Settings) mirror everything: throwing and shield hands, which stick moves and which
  turns, and the face buttons. On-screen instructions follow the setting.
- **How to play** is on every tier's briefing and in the pause menu: the goal, how the tier is won and lost, the controls
  for the device in your hands, and what that tier's modifiers mean.
- The **overhead map** can sit left, right, far left, far right or top, or be hidden (Settings, or the pause menu while
  riding). The same setting moves the desktop map.
- Each cycle event opens with the riders walking to their machines and mounting. You watch your own rider from beside
  the machine, then are faded into the seat; canopies close on "Ready" and the drives fire on "Begin".
- Cycles are ridden from the cockpit, with the rider's gloves on the bars and an overhead map hanging to the left. B on
  the right hand switches between cockpit and chase view; right stick up / down trims the seat height (remembered).
- In every race against other riders, X lays a light wall behind you for about two seconds. Rivals that ride into your
  wall are destroyed; riding into one of theirs stalls you. From the fourth tier, machines trade real momentum on
  contact: a side-on hit from the faster rider shoves the slower one bodily across the road, and a rival shoved into a
  rail is thrown off it.
- From tier 32 an **air interceptor** shadows whoever is leading and drops a hardlight barrier across part of the lane
  ahead of it. There is always a way past; the HUD says which side.
- In Disc Arena, look at another platform (it lights up) and press A to hop to it.
- A is a timed surge of super speed, drawn from the boost reserve. Thumbstick clicks are not used for anything.
- The menu opens only when left Y is held for 0.4 s, so a brushed button never interrupts a run. It gives **Quit to
  main menu** and shows live stick readings at the foot of the panel.
- A disc throw follows the hand's swing when there is one and the hand's pointing direction when there is not, and is
  steered onto a rival only if it already passes close to one.

Voice, crowd, effects and music loops are recorded clips in `assets/audio/` layered over the runtime synthesiser, which
remains the fallback. Sources and licences are in `CREDITS.md`.

## Generated art

These models are built by Blender scripts (shared helpers in `scripts/blender/kit.py`) and exported to GLB:

| Script | Output in `assets/generated/` |
|---|---|
| `build_cockpit_v4.py` | `cockpit-v4.glb` — the cockpit the game uses: a wrap-around binnacle swept on an arc about the rider, a four-layer instrument stack, raked A-pillars, hex vents, a floor pan with pedal plates, and a yoke on one swept crossbar |
| `build_cockpit.py`, `build_cockpit_v2.py`, `build_cockpit_v3.py` | earlier cockpits, kept as fallbacks |
| `build_hauler.py` | `hauler.glb` — the Overwatch Hauler that stands over the Outlands events |
| `build_arena_kit.py` | `arena-stand.glb`, `arena-pylon.glb` — the stadium around the cycle grid |
| `build_cycles.py` | `cycle-bulwark.glb` — ring-wheel rival cycle (`cycle-lancer.glb` is also built but no longer shipped) |

The scripts run either inside Blender or against the `bpy` module, which is the quicker path in CI:

```bash
pip install bpy
python3 scripts/blender/build_cockpit_v4.py -- assets/generated
# or
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_cycles.py -- "$PWD/assets/generated"
```

(`build_cockpit.py` takes the output file path instead of the folder.)

`cockpit-console.glb` (the dash, display, bars and the rider's hands) and `cycle-wraith.glb` are not scripted:
they were generated with an image-to-3D / text-to-3D service. The console is fitted over the scripted bodywork in
`CycleView.firstPerson`, with the live instrument readout placed on its display glass. The second, `cycle-wraith.glb`,
is not scripted either: it was generated from a written description with a text-to-3D service and is
fitted (scale, facing, per-rider light colour) in `src/games/cycles/view.ts`.

Run `npm run assets:sync` afterwards to copy it into `public/game-assets/`.

Voice, effects, ambience and 360° backdrops the build is ready for but does not yet have are listed with their
generation prompts and durations in `assets/PRODUCTION-BRIEF.md`. Each one drops in by file name with no code change.

The city backdrops are JPEG conversions of four of the supplied panoramic renders (`assets/generated/panoramas/`).
The sky dome maps each one as a band around the horizon, mirrored across the back half so it wraps without a seam.
The VR hands are the supplied rigged glove model, posed in code (`src/engine/hands.ts`).

## Layout

```
assets/                 source art (never modified) + manifests/assets.json inventory
public/game-assets/     runtime copies, written by `npm run assets:sync`
src/
  app/                  bootstrap, state machine, screens, session base
  engine/               renderer + post, assets, audio synth, VFX, environments, WebXR
  input/                keyboard / mouse / gamepad → normalised actions
  games/discs/          arena builder, simulation, AI, archetypes, view
  games/cycles/         combat sim + AI, track generator (terrain, banking, built sections), scenery, race sim, views
  progression/          tier data, sim builders, endless director, scoring, unlocks
  persistence/          IndexedDB save with localStorage mirror
  scenes/               splash cinematic, menu backdrop
  ui/                   HUD, menus (DOM) and in-VR canvas panels
  tests/                Vitest suites and scripted bot players
```

Simulations are pure TypeScript with a fixed 120 Hz step and a seeded RNG; views, audio and HUD only consume their
events. Desktop and VR share the same simulation, scoring and progression.

## QA hooks

- `?play=discs:8`, `?play=combat:5`, `?play=race:6` — jump straight into a tier (tracks: `discs`, `cycles`, `combat`, `race`).
- `?nosplash` — skip the intro. `?qa` — do not auto-pause when the tab is hidden.
- `window.__GAME__.debugAdvance(seconds)` steps the frame loop synchronously; `__GAME__.qaActions = {…}` injects actions.
- `dev/hands.html?m=free` and `?m=cockpit` preview the VR gloves (free, and on the bar grips) without a headset.
- `dev/viewer.html?f=<path under game-assets>&v=front|side|top` inspects any GLB.

## Known gaps

- VR is developed without a headset on this machine and checked on desktop with bloom off; each round is then tested
  on the owner's headset. Changes since the last headset session are unverified on hardware.
- Several supplied models are held back and not shipped; `CREDITS.md` lists each one with its author, licence and reason.
- Not implemented: Modern (curved-trail) combat ruleset, online leaderboards, multiplayer, gamepad button remapping,
  touch controls, Playwright end-to-end tests.
