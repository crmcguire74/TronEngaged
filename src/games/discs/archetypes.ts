/** Data-driven rival definitions. Difficulty comes from tactics (banking, baiting, coordination), never hidden attacks: every throw keeps a visible wind-up tell. */
/**
 * What a fighter throws. `disc` ricochets and can be parried; `lance` is a fast straight bolt that spends itself on
 * the first surface and cannot be parried, but it is slow to wind up and easy to read; `arc` is a slow heavy blade
 * that cuts through barriers and breaks the deck it lands on.
 */
export type Weapon = 'disc' | 'lance' | 'arc';
/** A weapon and stat change a rival escalates to once its health drops past `hpAbove`. */
export interface Upgrade { hpAbove: number; name: string; weapon?: Weapon; over: Partial<Archetype> }

export interface Archetype {
  label: string; role: string;
  model: 'ivory' | 'crimson' | 'cobalt' | 'azure'; disc: 'ivory' | 'crimson' | 'azure'; tint: number; scale: number;
  hp: number; speed: number; throwSpeed: number; cooldown: [number, number]; windup: number;
  shieldUse: number; dodgeUse: number; bankShot: number; homing: number; burst: number;
  aimError: number; lead: number; discs: number; hopRate: number;
  special?: 'command' | 'disrupt';
  weapon?: Weapon;
  /** Escalation ladder, highest hpAbove first. Rivals with one re-arm as the fight wears on. */ upgrades?: Upgrade[];
  boss?: BossDef;
}
export interface BossPhase { hpAbove: number; name: string; over: Partial<Archetype>; onEnter: string[] }
export interface BossDef { title: string; phases: BossPhase[] }

const base: Archetype = { label: 'Sentinel', role: 'Direct shots, basic evasion', model: 'ivory', disc: 'ivory', tint: 0xdfeaff, scale: 1, hp: 60, speed: 3.2, throwSpeed: 19, cooldown: [2.6, 3.8], windup: 0.75, shieldUse: 0.34, dodgeUse: 0.15, bankShot: 0, homing: 0, burst: 1, aimError: 0.075, lead: 0.3, discs: 1, hopRate: 0.08 };

export const ARCHETYPES: Record<string, Archetype> = {
  sentinel: base,
  guardian: { ...base, label: 'Guardian', role: 'Blocks head-on throws — bank it or bait it', model: 'crimson', disc: 'crimson', tint: 0xff7a3c, hp: 90, speed: 2.6, shieldUse: 0.9, dodgeUse: 0.05, cooldown: [3, 4.2], windup: 0.8, aimError: 0.06 },
  striker: { ...base, label: 'Striker', role: 'Fast, dodges, throws in bursts', tint: 0xffe14a, shieldUse: 0.2, hp: 55, speed: 5.4, throwSpeed: 23, cooldown: [2.2, 3.2], windup: 0.6, dodgeUse: 0.75, burst: 2, discs: 2, hopRate: 0.35, aimError: 0.07, lead: 0.55 },
  ricochet: { ...base, label: 'Ricochet Specialist', role: 'Favours angled bank shots', tint: 0x7dffb0, hp: 60, bankShot: 0.85, cooldown: [2.4, 3.4], aimError: 0.05, lead: 0.4, throwSpeed: 21 },
  hunter: { ...base, label: 'Hunter', role: 'Tracking discs — break line of sight or dodge late', model: 'crimson', disc: 'crimson', tint: 0xff4fa0, hp: 65, homing: 1.5, cooldown: [3.2, 4.4], windup: 0.9, throwSpeed: 15, aimError: 0.1 },
  disruptor: { ...base, label: 'Disruptor', role: 'Jams platform systems', tint: 0xb77bff, hp: 55, special: 'disrupt', cooldown: [3, 4], dodgeUse: 0.4, shieldUse: 0.3 },
  // ----- armed rivals: these escalate through weapons as they take damage -----
  lancer: {
    ...base, label: 'Lancer', role: 'Straight bolts that cannot be parried — dodge, do not block', tint: 0x6cc4ff, hp: 65, speed: 3.6,
    weapon: 'lance', throwSpeed: 26, cooldown: [3.0, 4.0], windup: 1.05, aimError: 0.055, dodgeUse: 0.35,
    upgrades: [{ hpAbove: 0.45, name: 'Twin Lance', over: { burst: 2, cooldown: [2.5, 3.4], windup: 0.95 } }],
  },
  breaker: {
    ...base, label: 'Breaker', role: 'Arc blades that cut barriers and break the deck under you', model: 'crimson', disc: 'crimson', tint: 0xff8a3c,
    hp: 85, speed: 2.9, weapon: 'arc', throwSpeed: 15, cooldown: [3.4, 4.6], windup: 1.0, shieldUse: 0.5, aimError: 0.07,
    upgrades: [{ hpAbove: 0.4, name: 'Heavy Arc', over: { burst: 2, cooldown: [2.8, 3.6], throwSpeed: 17 } }],
  },
  vanguard: {
    ...base, label: 'Vanguard', role: 'Re-arms twice: disc, then lance, then arc', model: 'crimson', disc: 'crimson', tint: 0xffd166,
    hp: 120, speed: 3.4, shieldUse: 0.6, cooldown: [2.8, 3.8], aimError: 0.055, discs: 2,
    upgrades: [
      { hpAbove: 0.62, name: 'Lance Array', weapon: 'lance', over: { throwSpeed: 27, windup: 0.95, burst: 2, cooldown: [2.6, 3.4] } },
      { hpAbove: 0.3, name: 'Arc Blades', weapon: 'arc', over: { throwSpeed: 16, windup: 0.95, burst: 2, cooldown: [2.4, 3.2], homing: 0.6 } },
    ],
  },

  commander: { ...base, label: 'Commander', role: 'Calls synchronised volleys', model: 'crimson', disc: 'crimson', tint: 0xffb62e, scale: 1.08, hp: 110, special: 'command', shieldUse: 0.68, cooldown: [2.8, 3.6], aimError: 0.05, lead: 0.6 },

  'boss-guardian': {
    ...base, label: 'First Guardian', role: 'Mini-boss', model: 'crimson', disc: 'crimson', tint: 0xff7a3c, scale: 1.18, hp: 170, speed: 3, shieldUse: 0.95, aimError: 0.055, discs: 2,
    boss: { title: 'FIRST GUARDIAN', phases: [
      { hpAbove: 0.5, name: 'Bulwark', over: {}, onEnter: [] },
      { hpAbove: 0, name: 'Counterstrike', over: { burst: 2, cooldown: [2, 2.8], bankShot: 0.3 }, onEnter: [] },
    ] },
  },
  'boss-enforcer': {
    ...base, label: 'The Enforcer', role: 'Multi-phase boss', model: 'crimson', disc: 'crimson', tint: 0xff3b30, scale: 1.25, hp: 260, speed: 3.6, throwSpeed: 22, shieldUse: 0.6, dodgeUse: 0.3, aimError: 0.05, discs: 3, lead: 0.6, hopRate: 0.2,
    boss: { title: 'THE ENFORCER', phases: [
      { hpAbove: 0.66, name: 'Judgement', over: { burst: 1 }, onEnter: [] },
      { hpAbove: 0.33, name: 'Suppression', over: { burst: 3, cooldown: [2.6, 3.2] }, onEnter: ['summon:sentinel:2'] },
      { hpAbove: 0, name: 'Execution', over: { burst: 2, homing: 1.1, cooldown: [2, 2.6], dodgeUse: 0.6 }, onEnter: ['surge:on'] },
    ] },
  },
  'boss-architect': {
    ...base, label: 'The Architect', role: 'Rewrites the arena', model: 'ivory', disc: 'ivory', tint: 0x9ad8ff, scale: 1.25, hp: 300, speed: 3.4, throwSpeed: 22, bankShot: 0.6, shieldUse: 0.4, aimError: 0.045, discs: 3, lead: 0.7, hopRate: 0.3,
    boss: { title: 'THE ARCHITECT', phases: [
      { hpAbove: 0.7, name: 'Blueprint', over: {}, onEnter: ['orbit:1'] },
      { hpAbove: 0.4, name: 'Restructure', over: { burst: 2 }, onEnter: ['shift', 'orbit:1', 'summon:ricochet:1'] },
      { hpAbove: 0, name: 'Demolition', over: { burst: 3, cooldown: [2.2, 2.8] }, onEnter: ['shift', 'collapse:on', 'summon:striker:1'] },
    ] },
  },
  'boss-overseer': {
    ...base, label: 'The Overseer', role: 'Elite commander', model: 'crimson', disc: 'crimson', tint: 0xff2d55, scale: 1.3, hp: 360, speed: 4, throwSpeed: 24, shieldUse: 0.7, dodgeUse: 0.5, bankShot: 0.4, aimError: 0.04, discs: 3, lead: 0.8, hopRate: 0.3, special: 'command',
    boss: { title: 'THE OVERSEER', phases: [
      { hpAbove: 0.75, name: 'Observation', over: {}, onEnter: ['summon:guardian:1'] },
      { hpAbove: 0.5, name: 'Intervention', over: { burst: 2, homing: 1.2 }, onEnter: ['summon:hunter:2', 'interfere'] },
      { hpAbove: 0.25, name: 'Domination', over: { burst: 3 }, onEnter: ['shift', 'surge:on', 'summon:striker:1'] },
      { hpAbove: 0, name: 'Last Directive', over: { burst: 3, cooldown: [1.9, 2.4], dodgeUse: 0.8 }, onEnter: ['orbit:2'] },
    ] },
  },
  'boss-null': {
    ...base, label: 'Null Kernel', role: 'Post-campaign boss: re-arms through every weapon', model: 'crimson', disc: 'crimson', tint: 0xff6a1f, scale: 1.42,
    hp: 500, speed: 4.2, throwSpeed: 24, shieldUse: 0.7, dodgeUse: 0.6, bankShot: 0.45, aimError: 0.035, discs: 3, lead: 0.9, hopRate: 0.34, special: 'command',
    boss: { title: 'NULL KERNEL', phases: [
      { hpAbove: 0.8, name: 'Cold Start', over: {}, onEnter: ['orbit:1'] },
      { hpAbove: 0.6, name: 'Lance Array', over: { weapon: 'lance', throwSpeed: 28, burst: 2, windup: 0.9, cooldown: [2.4, 3.2] }, onEnter: ['summon:lancer:2'] },
      { hpAbove: 0.4, name: 'Arc Cascade', over: { weapon: 'arc', throwSpeed: 17, burst: 2, cooldown: [2.4, 3.0], homing: 0.8 }, onEnter: ['shift', 'summon:breaker:1'] },
      { hpAbove: 0.2, name: 'Ground Zero', over: { weapon: 'arc', burst: 3, cooldown: [2.0, 2.6], dodgeUse: 0.8 }, onEnter: ['surge:on', 'summon:vanguard:1'] },
      { hpAbove: 0, name: 'Null State', over: { weapon: 'lance', throwSpeed: 30, burst: 4, cooldown: [1.8, 2.3], homing: 0 }, onEnter: ['orbit:2', 'shift'] },
    ] },
  },
  'boss-prime': {
    ...base, label: 'Prime Kernel', role: 'Final authored boss', model: 'crimson', disc: 'crimson', tint: 0xffffff, scale: 1.4, hp: 460, speed: 4.2, throwSpeed: 25, shieldUse: 0.75, dodgeUse: 0.55, bankShot: 0.5, aimError: 0.035, discs: 3, lead: 0.9, hopRate: 0.35, special: 'command',
    boss: { title: 'PRIME KERNEL', phases: [
      { hpAbove: 0.8, name: 'Handshake', over: {}, onEnter: ['orbit:1'] },
      { hpAbove: 0.6, name: 'Escalation', over: { burst: 2 }, onEnter: ['summon:guardian:1', 'summon:ricochet:1'] },
      { hpAbove: 0.4, name: 'Recompile', over: { burst: 2, homing: 1.3 }, onEnter: ['shift', 'surge:on', 'summon:hunter:2'] },
      { hpAbove: 0.2, name: 'Overclock', over: { burst: 3, cooldown: [2, 2.6] }, onEnter: ['shift', 'collapse:on', 'interfere', 'summon:striker:2'] },
      { hpAbove: 0, name: 'Kernel Panic', over: { burst: 4, cooldown: [1.8, 2.3], dodgeUse: 0.85 }, onEnter: ['orbit:2', 'summon:disruptor:1'] },
    ] },
  },
};
