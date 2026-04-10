import { shuffle } from './utils';
import type { AnyWeapon } from './weapons';
import type { Player } from './player';

const XP_THRESHOLDS = [0, 5, 12, 22, 35, 52, 75, 105, 145, 200, 280] as const;

function xpForLevel(level: number): number {
  if (level < XP_THRESHOLDS.length) return XP_THRESHOLDS[level] ?? 0;
  return (XP_THRESHOLDS[XP_THRESHOLDS.length - 1] ?? 0) + (level - XP_THRESHOLDS.length + 1) * 120;
}

type AddWeaponFn = (name: string) => void;
type RemoveWeaponFn = (name: string) => void;

export interface Upgrade {
  id: string;
  label: string;
  desc: string;
  apply(weapons: AnyWeapon[], addWeapon: AddWeaponFn, player: Player, removeWeapon: RemoveWeaponFn): void;
  requires(weapons: AnyWeapon[]): boolean;
}

export type ApplyUpgradeFn = (choice: Upgrade) => void;
export type LevelUpCallback = (choices: Upgrade[], apply: ApplyUpgradeFn) => void;

function upgradeWeapon(weapons: AnyWeapon[], name: string, stat: string): void {
  const w = weapons.find(w => w.name === name);
  if (w && 'upgrade' in w) (w as { upgrade(s: string): void }).upgrade(stat);
}

function weaponLevel(weapons: AnyWeapon[], name: string): number {
  return weapons.find(w => w.name === name)?.level ?? 0;
}

const UPGRADE_POOL: Upgrade[] = [
  // ── Magic Bolt ─────────────────────────────────────────────────────────────
  {
    id: 'bolt_damage', label: '⚡ Magic Bolt – Damage Up', desc: '+30% bolt damage',
    apply: (w) => upgradeWeapon(w, 'Magic Bolt', 'damage'),
    requires: (w) => w.some(x => x.name === 'Magic Bolt' && !x.isEvolution),
  },
  {
    id: 'bolt_rate', label: '⚡ Magic Bolt – Fire Rate Up', desc: '+25% fire rate',
    apply: (w) => upgradeWeapon(w, 'Magic Bolt', 'rate'),
    requires: (w) => w.some(x => x.name === 'Magic Bolt' && !x.isEvolution),
  },
  {
    id: 'bolt_pierce', label: '⚡ Magic Bolt – Pierce', desc: 'Bolts pierce through +1 enemy',
    apply: (w) => upgradeWeapon(w, 'Magic Bolt', 'pierce'),
    requires: (w) => w.some(x => x.name === 'Magic Bolt' && !x.isEvolution),
  },
  // ── Whip ───────────────────────────────────────────────────────────────────
  {
    id: 'add_whip', label: '🌀 Unlock Whip', desc: 'New weapon: sweeping arc melee attack',
    apply: (_w, add) => add('Whip'),
    requires: (w) => !w.some(x => x.name === 'Whip') && !w.some(x => x.name === 'Thunder Strike'),
  },
  {
    id: 'whip_damage', label: '🌀 Whip – Damage Up', desc: '+30% whip damage',
    apply: (w) => upgradeWeapon(w, 'Whip', 'damage'),
    requires: (w) => w.some(x => x.name === 'Whip' && !x.isEvolution),
  },
  {
    id: 'whip_range', label: '🌀 Whip – Range Up', desc: '+30px whip range',
    apply: (w) => upgradeWeapon(w, 'Whip', 'range'),
    requires: (w) => w.some(x => x.name === 'Whip' && !x.isEvolution),
  },
  // ── Fireball ───────────────────────────────────────────────────────────────
  {
    id: 'add_fireball', label: '🔥 Unlock Fireball', desc: 'New weapon: slow explosive orb',
    apply: (_w, add) => add('Fireball'),
    requires: (w) => !w.some(x => x.name === 'Fireball') && !w.some(x => x.name === 'Void Orb') && !w.some(x => x.name === 'Inferno'),
  },
  {
    id: 'fireball_damage', label: '🔥 Fireball – Damage Up', desc: '+35% fireball damage',
    apply: (w) => upgradeWeapon(w, 'Fireball', 'damage'),
    requires: (w) => w.some(x => x.name === 'Fireball' && !x.isEvolution),
  },
  {
    id: 'fireball_rate', label: '🔥 Fireball – Fire Rate Up', desc: '+25% fire rate',
    apply: (w) => upgradeWeapon(w, 'Fireball', 'rate'),
    requires: (w) => w.some(x => x.name === 'Fireball' && !x.isEvolution),
  },
  {
    id: 'fireball_radius', label: '🔥 Fireball – Blast Radius Up', desc: '+30px explosion radius',
    apply: (w) => upgradeWeapon(w, 'Fireball', 'radius'),
    requires: (w) => w.some(x => x.name === 'Fireball' && !x.isEvolution),
  },
  // ── Lightning ──────────────────────────────────────────────────────────────
  {
    id: 'add_lightning', label: '🌩 Unlock Lightning', desc: 'New weapon: chain zap hitting multiple enemies',
    apply: (_w, add) => add('Lightning'),
    requires: (w) => !w.some(x => x.name === 'Lightning'),
  },
  {
    id: 'lightning_damage', label: '🌩 Lightning – Damage Up', desc: '+30% lightning damage',
    apply: (w) => upgradeWeapon(w, 'Lightning', 'damage'),
    requires: (w) => w.some(x => x.name === 'Lightning' && !x.isEvolution),
  },
  {
    id: 'lightning_chains', label: '🌩 Lightning – Extra Chain', desc: 'Zap hits +1 more enemy',
    apply: (w) => upgradeWeapon(w, 'Lightning', 'chains'),
    requires: (w) => w.some(x => x.name === 'Lightning' && !x.isEvolution),
  },
  {
    id: 'lightning_rate', label: '🌩 Lightning – Fire Rate Up', desc: '+20% zap rate',
    apply: (w) => upgradeWeapon(w, 'Lightning', 'rate'),
    requires: (w) => w.some(x => x.name === 'Lightning' && !x.isEvolution),
  },
  // ── Aura ───────────────────────────────────────────────────────────────────
  {
    id: 'add_aura', label: '💜 Unlock Aura', desc: 'New weapon: pulsing damage ring around player',
    apply: (_w, add) => add('Aura'),
    requires: (w) => !w.some(x => x.name === 'Aura') && !w.some(x => x.name === 'Inferno'),
  },
  {
    id: 'aura_damage', label: '💜 Aura – Damage Up', desc: '+30% aura damage',
    apply: (w) => upgradeWeapon(w, 'Aura', 'damage'),
    requires: (w) => w.some(x => x.name === 'Aura' && !x.isEvolution),
  },
  {
    id: 'aura_range', label: '💜 Aura – Range Up', desc: '+25px aura range',
    apply: (w) => upgradeWeapon(w, 'Aura', 'range'),
    requires: (w) => w.some(x => x.name === 'Aura' && !x.isEvolution),
  },
  {
    id: 'aura_rate', label: '💜 Aura – Pulse Rate Up', desc: '+25% pulse rate',
    apply: (w) => upgradeWeapon(w, 'Aura', 'rate'),
    requires: (w) => w.some(x => x.name === 'Aura' && !x.isEvolution),
  },
  // ── Player stats ───────────────────────────────────────────────────────────
  {
    id: 'player_speed', label: '👟 Speed Up', desc: '+20% movement speed',
    apply: (_w, _add, player) => { player.speed *= 1.2; },
    requires: () => true,
  },
  {
    id: 'player_hp', label: '❤️ Max HP Up', desc: '+25 max HP and heal 25',
    apply: (_w, _add, player) => { player.maxHp += 25; player.hp = Math.min(player.hp + 25, player.maxHp); },
    requires: () => true,
  },
  // ── Evolutions ─────────────────────────────────────────────────────────────
  {
    id: 'evo_thunder_strike',
    label: '⚡🌀 EVOLVE: Thunder Strike',
    desc: 'Merge Magic Bolt lv3 + Whip lv2 → simultaneous bolt & arc',
    apply: (_w, add, _p, remove) => { remove('Magic Bolt'); remove('Whip'); add('Thunder Strike'); },
    requires: (w) =>
      weaponLevel(w, 'Magic Bolt') >= 3 && weaponLevel(w, 'Whip') >= 2 &&
      !w.some(x => x.name === 'Thunder Strike'),
  },
  {
    id: 'evo_void_orb',
    label: '⚡🔥 EVOLVE: Void Orb',
    desc: 'Merge Magic Bolt lv3 + Fireball lv2 → massive piercing void orb',
    apply: (_w, add, _p, remove) => { remove('Magic Bolt'); remove('Fireball'); add('Void Orb'); },
    requires: (w) =>
      weaponLevel(w, 'Magic Bolt') >= 3 && weaponLevel(w, 'Fireball') >= 2 &&
      !w.some(x => x.name === 'Void Orb'),
  },
  {
    id: 'evo_inferno',
    label: '💜🔥 EVOLVE: Inferno',
    desc: 'Merge Aura lv2 + Fireball lv3 → wide aura + 6-way fireballs',
    apply: (_w, add, _p, remove) => { remove('Aura'); remove('Fireball'); add('Inferno'); },
    requires: (w) =>
      weaponLevel(w, 'Aura') >= 2 && weaponLevel(w, 'Fireball') >= 3 &&
      !w.some(x => x.name === 'Inferno'),
  },
];

export class LevelUpManager {
  level = 1;
  xp = 0;
  xpToNext: number;
  onLevelUp: LevelUpCallback | null = null;

  constructor() {
    this.xpToNext = xpForLevel(1);
  }

  addXp(amount: number, weapons: AnyWeapon[], addWeapon: AddWeaponFn, player: Player, removeWeapon: RemoveWeaponFn): void {
    if (amount <= 0) return;
    this.xp += amount;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = xpForLevel(this.level);
      this.triggerLevelUp(weapons, addWeapon, player, removeWeapon);
    }
  }

  private triggerLevelUp(weapons: AnyWeapon[], addWeapon: AddWeaponFn, player: Player, removeWeapon: RemoveWeaponFn): void {
    const available = UPGRADE_POOL.filter(u => u.requires(weapons));
    const choices = shuffle([...available]).slice(0, 3);
    if (this.onLevelUp) {
      this.onLevelUp(choices, (choice) => {
        choice.apply(weapons, addWeapon, player, removeWeapon);
      });
    }
  }

  get xpFraction(): number {
    return this.xpToNext > 0 ? Math.min(this.xp / this.xpToNext, 1) : 1;
  }
}
