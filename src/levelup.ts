import { shuffle } from './utils';
import type { AnyWeapon } from './weapons';
import type { Player } from './player';

const XP_THRESHOLDS = [0, 5, 12, 22, 35, 52, 75, 105, 145, 200, 280] as const;

function xpForLevel(level: number): number {
  if (level < XP_THRESHOLDS.length) return XP_THRESHOLDS[level] ?? 0;
  return (XP_THRESHOLDS[XP_THRESHOLDS.length - 1] ?? 0) + (level - XP_THRESHOLDS.length + 1) * 120;
}

type AddWeaponFn = (name: string) => void;

export interface Upgrade {
  id: string;
  label: string;
  desc: string;
  apply(weapons: AnyWeapon[], addWeapon: AddWeaponFn, player: Player): void;
  requires(weapons: AnyWeapon[]): boolean;
}

export type ApplyUpgradeFn = (choice: Upgrade) => void;
export type LevelUpCallback = (choices: Upgrade[], apply: ApplyUpgradeFn) => void;

const UPGRADE_POOL: Upgrade[] = [
  {
    id: 'bolt_damage',
    label: '⚡ Magic Bolt – Damage Up',
    desc: '+30% bolt damage',
    apply: (weapons) => {
      const w = weapons.find(w => w.name === 'Magic Bolt');
      if (w && 'upgrade' in w) (w as { upgrade(s: string): void }).upgrade('damage');
    },
    requires: (weapons) => weapons.some(w => w.name === 'Magic Bolt'),
  },
  {
    id: 'bolt_rate',
    label: '⚡ Magic Bolt – Fire Rate Up',
    desc: '+25% fire rate',
    apply: (weapons) => {
      const w = weapons.find(w => w.name === 'Magic Bolt');
      if (w && 'upgrade' in w) (w as { upgrade(s: string): void }).upgrade('rate');
    },
    requires: (weapons) => weapons.some(w => w.name === 'Magic Bolt'),
  },
  {
    id: 'bolt_pierce',
    label: '⚡ Magic Bolt – Pierce',
    desc: 'Bolts pierce through +1 enemy',
    apply: (weapons) => {
      const w = weapons.find(w => w.name === 'Magic Bolt');
      if (w && 'upgrade' in w) (w as { upgrade(s: string): void }).upgrade('pierce');
    },
    requires: (weapons) => weapons.some(w => w.name === 'Magic Bolt'),
  },
  {
    id: 'add_whip',
    label: '🌀 Unlock Whip',
    desc: 'New weapon: sweeping arc melee attack',
    apply: (_weapons, addWeapon) => addWeapon('Whip'),
    requires: (weapons) => !weapons.some(w => w.name === 'Whip'),
  },
  {
    id: 'whip_damage',
    label: '🌀 Whip – Damage Up',
    desc: '+30% whip damage',
    apply: (weapons) => {
      const w = weapons.find(w => w.name === 'Whip');
      if (w && 'upgrade' in w) (w as { upgrade(s: string): void }).upgrade('damage');
    },
    requires: (weapons) => weapons.some(w => w.name === 'Whip'),
  },
  {
    id: 'whip_range',
    label: '🌀 Whip – Range Up',
    desc: '+30px whip range',
    apply: (weapons) => {
      const w = weapons.find(w => w.name === 'Whip');
      if (w && 'upgrade' in w) (w as { upgrade(s: string): void }).upgrade('range');
    },
    requires: (weapons) => weapons.some(w => w.name === 'Whip'),
  },
  {
    id: 'player_speed',
    label: '👟 Speed Up',
    desc: '+20% movement speed',
    apply: (_weapons, _add, player) => { player.speed *= 1.2; },
    requires: () => true,
  },
  {
    id: 'player_hp',
    label: '❤️ Max HP Up',
    desc: '+25 max HP and heal 25',
    apply: (_weapons, _add, player) => {
      player.maxHp += 25;
      player.hp = Math.min(player.hp + 25, player.maxHp);
    },
    requires: () => true,
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

  addXp(amount: number, weapons: AnyWeapon[], addWeapon: AddWeaponFn, player: Player): void {
    if (amount <= 0) return;
    this.xp += amount;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = xpForLevel(this.level);
      this.triggerLevelUp(weapons, addWeapon, player);
    }
  }

  private triggerLevelUp(weapons: AnyWeapon[], addWeapon: AddWeaponFn, player: Player): void {
    const available = UPGRADE_POOL.filter(u => u.requires(weapons));
    const choices = shuffle([...available]).slice(0, 3);
    if (this.onLevelUp) {
      this.onLevelUp(choices, (choice) => {
        choice.apply(weapons, addWeapon, player);
      });
    }
  }

  get xpFraction(): number {
    return this.xpToNext > 0 ? Math.min(this.xp / this.xpToNext, 1) : 1;
  }
}
