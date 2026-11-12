/** Data-driven rival definitions. Difficulty comes from tactics (banking, baiting, coordination), never hidden attacks: every throw keeps a visible wind-up tell. */
export interface Archetype {
  label: string; role: string;
  model: 'ivory' | 'crimson' | 'cobalt' | 'azure'; disc: 'ivory' | 'crimson' | 'azure'; tint: number; scale: number;
  hp: number; speed: number; throwSpeed: number; cooldown: [number, number]; windup: number;
  shieldUse: number; dodgeUse: number; bankShot: number; homing: number; burst: number;
  aimError: number; lead: number; discs: number; hopRate: number;
  special?: 'command' | 'disrupt';
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
