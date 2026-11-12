# VANTA ARC — Lattice Protocol

Two arcade games in one browser build, playable on desktop and in VR (WebXR):

- **Disc Arena** — third-person disc duels on suspended platforms: ricochets, shield/parry, platform hops, bosses.
- **Arc Cycles — Combat** — classic 90° turns and permanent hardlight walls.
- **Arc Cycles — Racing** — fluid steering, drifting, boost, checkpoints; six race formats.

30 authored tiers per game (60 total), endless seeded modes, four difficulties, local save.

> Built from `TronPRD.pdf`. Per that document's own IP note, the game ships under an original name, universe and
> terminology; the supplied models in `assets/` are used as the hero art.

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
  wall are destroyed; riding into one of theirs stalls you. From the eighth tier, hitting a rival at super speed shoves
  it sideways, and a rival shoved into a rail is thrown off the road.
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
| `build_cockpit.py` | `cockpit.glb` — first-person / VR cockpit |
| `build_arena_kit.py` | `arena-stand.glb`, `arena-pylon.glb` — the stadium around the cycle grid |
| `build_cycles.py` | `cycle-bulwark.glb` — ring-wheel rival cycle (`cycle-lancer.glb` is also built but no longer shipped) |

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_cycles.py -- "$PWD/assets/generated"
```

(`build_cockpit.py` takes the output file path instead of the folder.)

`cockpit-console.glb` (the dash, display, bars and the rider's hands) and `cycle-wraith.glb` are not scripted:
they were generated with an image-to-3D / text-to-3D service. The console is fitted over the scripted bodywork in
`CycleView.firstPerson`, with the live instrument readout placed on its display glass. The second, `cycle-wraith.glb`,
is not scripted either: it was generated from a written description with a text-to-3D service and is
fitted (scale, facing, per-rider light colour) in `src/games/cycles/view.ts`.

Run `npm run assets:sync` afterwards to copy it into `public/game-assets/`.

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
  games/cycles/         combat sim + AI, track generator, race sim, views
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
