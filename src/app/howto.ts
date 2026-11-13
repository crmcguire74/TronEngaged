import type { App } from './app';
import type { Item, Screen } from '../ui/menu';
import type { TierDefinition } from '../progression/types';

type Row = [string, string];
/**
 * "How to play" for a tier: the goal, how it is won and lost, the controls for the device in the player's hands, and
 * what this tier's modifiers mean. One source for the briefing, the pause menu and the home screen.
 */
export function howToScreen(app: App, tier: TierDefinition): Screen {
  const dev = app.xr.presenting ? 'xr' : app.input.lastPad ? 'pad' : 'kbm', L = app.xr.labels, mode = tier.mode, has = (m: string) => tier.modifiers.includes(m);
  const pick = (kbm: string, pad: string, xr: string) => (dev === 'xr' ? xr : dev === 'pad' ? pad : kbm);
  let goal = '', win = '', lose = ''; const controls: Row[] = [], know: Row[] = [];
  if (mode === 'discs') {
    goal = 'Hit every rival with your disc until they break apart.'; win = 'All rivals (and every wave) defeated.'; lose = 'Your integrity reaches zero, or you run out of platforms.';
    controls.push(
      ['Move', pick('W A S D', 'Left stick', L.move)],
      ['Throw', pick('Aim with the mouse, hold then release left click', 'Aim right stick, hold then release RT', `Close your ${L.throwHand} hand (trigger or grip), swing or point, open it`)],
      ['Shield / parry', pick('Hold right click; raise it just before impact to parry', 'Hold LT; raise it late to parry', `Hold the ${L.shieldHand} trigger; the shield is on that forearm and blocks where it faces`)],
      ['Hop to another platform', pick('Space while moving toward it', 'A while pushing toward it', `Look at it and press ${L.jump}`)],
      ['Dodge', pick('Shift', 'B', L.dodge)], ['Recall your discs', pick('R', 'RB', `Close your empty ${L.throwHand} hand`)]);
    know.push(['Shields', 'Nobody can shield while winding up a throw or for a moment after one. That is when to strike.'], ['Discs', 'They bounce off walls, panels and platforms and come back to you.']);
    if (has('collapsing') || tier.params.collapseLater) know.push(['Flashing red platform', 'It is about to drop away. Hop to another one before the ring closes.']);
    if (has('energy-surge')) know.push(['Yellow pulsing platform', 'A surge is coming. Jump as it fires.']);
    if (has('homing')) know.push(['Pink discs', 'They track you. Dodge late or put a barrier between you.']);
    if (has('interference')) know.push(['Violet platform ring', 'Hops are jammed. Defeat the Disruptor first.']);
    if (has('midwall')) know.push(['Centre barrier', 'There is no direct line. Bank your disc off the angled panels or the chamber walls.']);
    if (has('amp')) know.push(['Gold rings', 'Throw through one and your disc speeds up and hits much harder. Rival discs that pass through are amplified too.']);
  } else if (mode === 'cycle-combat') {
    goal = 'Be the last rider running. Every cycle leaves a solid light wall behind it.'; win = 'Every rival has crashed.'; lose = 'You hit a light wall, the arena boundary, an obstacle or a rival head-on.';
    controls.push(['Turn 90°', pick('A / D or ← →', 'Left stick or d-pad ◄ ►', 'Flick either stick ◄ ►')], ['Faster', pick('W', 'RT', 'Any trigger or grip')], ['Slower', pick('S', 'LT', `Pull the ${L.move.toLowerCase()} back`)],
      ['Super speed', pick('Shift', 'A', L.surge)], ['Use a collected power', pick('E', 'B', L.ability)], ['Cockpit / chase view', pick('C', 'RB', L.view)]);
    know.push(['Trapping', 'Cut across a rival so their only way forward is your wall.'], ['Boost reserve', 'Refills slowly, faster when you ride close alongside a wall.'], ['The map', 'Shows every wall and rider from above. Move or hide it under Settings.']);
    if (has('shrink')) know.push(['Closing boundary', 'The arena shrinks. Keep space in the middle.']);
    if (has('ion-lanes')) know.push(['Gold ion lanes', 'Ride along one (not across) for extra speed and a fast boost refill. Rivals get it too.']);
  } else {
    const f = String(tier.params.format ?? 'circuit');
    goal = f === 'timetrial' ? 'Beat the par time.' : f === 'pursuit' ? 'Catch the runner ahead before it finishes.' : f === 'gauntlet' ? 'Reach the finish with integrity left.' : f === 'elimination' ? 'Do not be last when the timer cuts a rider.' : `Finish in the top ${tier.params.passPlace ?? 3}.`;
    win = 'Meet the goal above when you cross the line.'; lose = f === 'elimination' ? 'You are cut in last place.' : 'You finish outside the target, or run out of time or integrity.';
    controls.push(['Steer', pick('A / D', 'Left stick', 'Either stick')], ['Throttle', pick('W', 'RT', 'Any trigger or grip')], ['Brake / drift', pick('S (with steering to drift)', 'LT (with steering to drift)', `Pull the ${L.move.toLowerCase()} back (with steering to drift)`)],
      ['Super speed', pick('Shift', 'A', L.surge)], ['Light wall', pick('E', 'B', L.ability)], ['Cockpit / chase view', pick('C', 'RB', L.view)]);
    if (f !== 'timetrial' && f !== 'gauntlet') know.push(['Light wall', 'Lays a wall behind you for two seconds. Anyone who rides into a light wall, you included, is derezzed and re-forms a few seconds later, behind the pack. The dash shows when yours is on, ready or charging.'], ['Ramming', 'Hit a rival while at super speed to shove them. Shoved into a rail or a light wall, they are destroyed.']);
    know.push(['Drift boost', 'Hold a drift through a corner to bank extra boost.'], ['Slipstream', 'Sit behind a rider to gain speed and boost.']);
    if (has('storm')) know.push(['Storm cells', 'Cut your speed and visibility while you are inside one.']);
    if (has('charge-gates')) know.push(['Gold hoops', 'Charge gates. Ride through the middle of one and your light wall is ready again at once.']);
  }
  const row = (r: Row): Item => ({ kind: 'row', label: r[0], value: r[1] });
  return { id: 'howto', kicker: 'How to play', title: tier.name, wide: true, text: goal,
    items: [{ kind: 'title', label: 'Winning and losing' }, row(['You win when', win]), row(['You lose when', lose]),
      { kind: 'title', label: dev === 'xr' ? 'Controls · headset' : dev === 'pad' ? 'Controls · gamepad' : 'Controls · keyboard and mouse' }, ...controls.map(row),
      ...(dev === 'xr' ? [row(['Menu', `Hold ${L.menu} for a moment`])] : [row(['Menu', pick('Esc', 'Start', '')])]),
      { kind: 'title', label: 'Good to know' }, ...know.map(row)] };
}
