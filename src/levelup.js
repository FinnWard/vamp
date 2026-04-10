import { shuffle } from './utils.js';

const XP_THRESHOLDS = [0, 5, 12, 22, 35, 52, 75, 105, 145, 200, 280];

function xpForLevel(level) {
  if (level < XP_THRESHOLDS.length) return XP_THRESHOLDS[level];
  return XP_THRESHOLDS[XP_THRESHOLDS.length - 1] + (level - XP_THRESHOLDS.length + 1) * 120;
}

// All possible upgrades
const UPGRADE_POOL = [
  {
    id: 'bolt_damage',
    label: '⚡ Magic Bolt – Damage Up',
    desc: '+30% bolt damage',
    apply: (weapons) => {
      const w = weapons.find(w => w.name === 'Magic Bolt');
      if (w) w.upgrade('damage');
    },
    requires: (weapons) => weapons.some(w => w.name === 'Magic Bolt'),
  },
  {
    id: 'bolt_rate',
    label: '⚡ Magic Bolt – Fire Rate Up',
    desc: '+25% fire rate',
    apply: (weapons) => {
      const w = weapons.find(w => w.name === 'Magic Bolt');
      if (w) w.upgrade('rate');
    },
    requires: (weapons) => weapons.some(w => w.name === 'Magic Bolt'),
  },
  {
    id: 'bolt_pierce',
    label: '⚡ Magic Bolt – Pierce',
    desc: 'Bolts pierce through +1 enemy',
    apply: (weapons) => {
      const w = weapons.find(w => w.name === 'Magic Bolt');
      if (w) w.upgrade('pierce');
    },
    requires: (weapons) => weapons.some(w => w.name === 'Magic Bolt'),
  },
  {
    id: 'add_whip',
    label: '🌀 Unlock Whip',
    desc: 'New weapon: sweeping arc melee attack',
    apply: (weapons, addWeapon) => addWeapon('Whip'),
    requires: (weapons) => !weapons.some(w => w.name === 'Whip'),
  },
  {
    id: 'whip_damage',
    label: '🌀 Whip – Damage Up',
    desc: '+30% whip damage',
    apply: (weapons) => {
      const w = weapons.find(w => w.name === 'Whip');
      if (w) w.upgrade('damage');
    },
    requires: (weapons) => weapons.some(w => w.name === 'Whip'),
  },
  {
    id: 'whip_range',
    label: '🌀 Whip – Range Up',
    desc: '+30px whip range',
    apply: (weapons) => {
      const w = weapons.find(w => w.name === 'Whip');
      if (w) w.upgrade('range');
    },
    requires: (weapons) => weapons.some(w => w.name === 'Whip'),
  },
  {
    id: 'player_speed',
    label: '👟 Speed Up',
    desc: '+20% movement speed',
    apply: (weapons, addWeapon, player) => { player.speed *= 1.2; },
    requires: () => true,
  },
  {
    id: 'player_hp',
    label: '❤️ Max HP Up',
    desc: '+25 max HP and heal 25',
    apply: (weapons, addWeapon, player) => {
      player.maxHp += 25;
      player.hp = Math.min(player.hp + 25, player.maxHp);
    },
    requires: () => true,
  },
];

export class LevelUpManager {
  constructor() {
    this.level = 1;
    this.xp = 0;
    this.xpToNext = xpForLevel(1);
    this.pendingLevelUp = false;
    this.onLevelUp = null; // callback(choices, applyFn)
  }

  addXp(amount, weapons, addWeapon, player) {
    if (amount <= 0) return;
    this.xp += amount;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = xpForLevel(this.level);
      this._triggerLevelUp(weapons, addWeapon, player);
    }
  }

  _triggerLevelUp(weapons, addWeapon, player) {
    const available = UPGRADE_POOL.filter(u => u.requires(weapons));
    const choices = shuffle([...available]).slice(0, 3);
    if (this.onLevelUp) this.onLevelUp(choices, (choice) => {
      choice.apply(weapons, addWeapon, player);
    });
  }

  get xpFraction() {
    return this.xpToNext > 0 ? Math.min(this.xp / this.xpToNext, 1) : 1;
  }
}
