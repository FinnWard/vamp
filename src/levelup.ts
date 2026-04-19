// ─── levelup.ts ───────────────────────────────────────────────────────────────
// Manages the XP → level-up progression and the pool of available upgrades.
//
// How levelling works
// ────────────────────
// 1. The player collects gems, each worth some XP.
// 2. main.ts passes the total XP gained each frame to LevelUpManager.addXp().
// 3. When accumulated XP exceeds the threshold for the next level the manager
//    fires the onLevelUp callback with up to 4 randomly-selected upgrades from
//    the UPGRADE_POOL that are currently available (pass their `requires` check).
// 4. main.ts pauses gameplay and shows the upgrade cards.  When the player
//    picks a card, main.ts calls the upgrade's `apply` function and resumes.
//
// Upgrade pool design
// ────────────────────
// Every upgrade in UPGRADE_POOL has:
//   id       — stable string identifier (used for debugging).
//   label    — display name shown on the upgrade card.
//   desc     — short description text shown below the name.
//   requires — predicate checked before offering the upgrade (prevents offering
//              weapons the player already has, enforces level caps, etc.).
//   apply    — mutates the game state when the upgrade is chosen.
//
// Upgrade categories:
//   • Weapon-specific upgrades (damage, rate, range, etc.)
//   • New weapon unlocks
//   • Evolution upgrades (two weapons must be at required levels)
//   • Generic player powerups (speed, HP, armor, pickup radius, etc.)
//
// Caps
// ─────
// Base weapons cap at MAX_BASE_WEAPON_LEVEL (5) so the upgrade pool doesn't
// offer the same weapon infinitely.  Evolution weapons cap at MAX_EVO_WEAPON_LEVEL
// (5).  Generic powerups each have their own cap via player.xxxUpgrades counter.
// ──────────────────────────────────────────────────────────────────────────────

import { shuffle } from './utils';
import type { AnyWeapon } from './weapons';
import type { Player } from './player';

// ─── XP thresholds ────────────────────────────────────────────────────────────

// XP required per level — tuned for ~5 minute runs.
// Indices 1-9 are hand-tuned early levels; beyond index 9 a formula generates
// thresholds that grow by 75 XP per level to keep mid/late-game pacing smooth.
const XP_THRESHOLDS = [0, 2, 4, 8, 13, 19, 27, 36, 47, 60] as const;

// ─── Upgrade caps ─────────────────────────────────────────────────────────────
// Caps prevent any single upgrade path from being taken infinitely.
export const MAX_WEAPON_UPGRADES   = 4;                           // any weapon: up to 4 upgrades after unlock
export const MAX_BASE_WEAPON_LEVEL = MAX_WEAPON_UPGRADES + 1;     // base weapons: lv1 → lv5
export const MAX_EVO_WEAPON_LEVEL  = MAX_WEAPON_UPGRADES + 1;     // evolved weapons: lv1 → lv5
export const MAX_WEAPON_SLOTS      = 4;                           // player can hold at most 4 weapons at once
export const MAX_GENERIC_UPGRADES  = 3;                           // each generic powerup can stack at most 3 times
const LEVEL_UP_CHOICE_COUNT        = 4;

/**
 * Returns the XP required to reach the given level.
 * For levels within the hand-tuned table, returns the table value directly.
 * For levels beyond the table, continues with a +75 XP / level formula.
 */
function xpForLevel(level: number): number {
  if (level < XP_THRESHOLDS.length) return XP_THRESHOLDS[level] ?? 0;
  return (XP_THRESHOLDS[XP_THRESHOLDS.length - 1] ?? 0) + (level - XP_THRESHOLDS.length + 1) * 75;
}

// ─── Callback type aliases ─────────────────────────────────────────────────────

/** Called when the player unlocks a new weapon by name. */
type AddWeaponFn = (name: string) => void;
/** Called when a weapon is consumed by an evolution upgrade. */
type RemoveWeaponFn = (name: string) => void;

// ─── Upgrade interface ─────────────────────────────────────────────────────────

/**
 * A single entry in the upgrade pool.  Each level-up the manager samples
 * up to 4 available entries from this pool and presents them to the player.
 */
export interface Upgrade {
  /** Unique string identifier for debugging. */
  id: string;
  /** Short display name shown on the upgrade card header. */
  label: string;
  /** One-line description of the effect shown below the label. */
  desc: string;
  /**
   * Sprite lookup key for the upgrade card icon.
   * Matches a weapon name in WEAPON_SPRITE_GRIDS or a powerup key in POWERUP_SPRITE_GRIDS.
   */
  icon?: string;
  /**
   * Mutates game state to apply the upgrade.
   * Called once when the player selects this card.
   */
  apply(weapons: AnyWeapon[], addWeapon: AddWeaponFn, player: Player, removeWeapon: RemoveWeaponFn): void;
  /**
   * Returns true if the upgrade should be included in the current offer pool.
   * Prevents duplicates, enforces caps, and gates evolution upgrades on
   * prerequisite weapon levels.
   */
  requires(weapons: AnyWeapon[], player: Player): boolean;
}

/** Passed to main.ts's onLevelUp callback so it can call the chosen upgrade. */
export type ApplyUpgradeFn = (choice: Upgrade) => void;
/** Signature of the callback registered by main.ts to receive level-up events. */
export type LevelUpCallback = (choices: Upgrade[], apply: ApplyUpgradeFn) => void;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Finds the named weapon in the array and calls its upgrade() method.
 * Uses a type cast because different weapon classes accept different stat keys;
 * callers are responsible for passing a valid stat name.
 */
function upgradeWeapon(weapons: AnyWeapon[], name: string, stat: string): void {
  const w = weapons.find(w => w.name === name);
  if (w && 'upgrade' in w) (w as { upgrade(s: string): void }).upgrade(stat);
}

/** Returns the current level of the named weapon, or 0 if not equipped. */
function weaponLevel(weapons: AnyWeapon[], name: string): number {
  return weapons.find(w => w.name === name)?.level ?? 0;
}

function upgradeOfferWeight(upgrade: Upgrade): number {
  if (!upgrade.id.startsWith('evo_')) return 1;
  return 4;
}

function pickWeightedUpgrades(available: Upgrade[], count: number): Upgrade[] {
  const pool = [...available];
  const picks: Upgrade[] = [];
  while (pool.length > 0 && picks.length < count) {
    const totalWeight = pool.reduce((sum, upgrade) => sum + upgradeOfferWeight(upgrade), 0);
    let roll = Math.random() * totalWeight;
    let pickedIndex = 0;
    for (let i = 0; i < pool.length; i++) {
      roll -= upgradeOfferWeight(pool[i]!);
      if (roll <= 0) {
        pickedIndex = i;
        break;
      }
    }
    const [picked] = pool.splice(pickedIndex, 1);
    if (picked) picks.push(picked);
  }
  return shuffle(picks);
}

const UPGRADE_POOL: Upgrade[] = [
  // ── Laser ──────────────────────────────────────────────────────────────────
  {
    id: 'bolt_damage', label: '🔵 Laser – Damage Up', desc: '+30% laser damage',
    icon: 'Laser',
    apply: (w) => upgradeWeapon(w, 'Laser', 'damage'),
    requires: (w) => w.some(x => x.name === 'Laser' && !x.isEvolution) && weaponLevel(w, 'Laser') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'bolt_rate', label: '🔵 Laser – Fire Rate Up', desc: '+25% fire rate',
    icon: 'Laser',
    apply: (w) => upgradeWeapon(w, 'Laser', 'rate'),
    requires: (w) => w.some(x => x.name === 'Laser' && !x.isEvolution) && weaponLevel(w, 'Laser') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'bolt_pierce', label: '🔵 Laser – Pierce', desc: 'Bolts pierce through +1 enemy',
    icon: 'Laser',
    apply: (w) => upgradeWeapon(w, 'Laser', 'pierce'),
    requires: (w) => w.some(x => x.name === 'Laser' && !x.isEvolution) && weaponLevel(w, 'Laser') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Plasma Whip ────────────────────────────────────────────────────────────
  {
    id: 'add_whip', label: '⚡ Unlock Plasma Whip', desc: 'New weapon: sweeping plasma arc',
    icon: 'Plasma Whip',
    apply: (_w, add) => add('Plasma Whip'),
    requires: (w) =>
      !w.some(x => x.name === 'Plasma Whip') &&
      !w.some(x => x.name === 'Beam Lash') &&
      !w.some(x => x.name === 'Cryo Lash') &&
      w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'whip_damage', label: '⚡ Plasma Whip – Damage Up', desc: '+30% whip damage',
    icon: 'Plasma Whip',
    apply: (w) => upgradeWeapon(w, 'Plasma Whip', 'damage'),
    requires: (w) => w.some(x => x.name === 'Plasma Whip' && !x.isEvolution) && weaponLevel(w, 'Plasma Whip') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'whip_range', label: '⚡ Plasma Whip – Range Up', desc: '+30px whip range',
    icon: 'Plasma Whip',
    apply: (w) => upgradeWeapon(w, 'Plasma Whip', 'range'),
    requires: (w) => w.some(x => x.name === 'Plasma Whip' && !x.isEvolution) && weaponLevel(w, 'Plasma Whip') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Plasma Bomb ────────────────────────────────────────────────────────────
  {
    id: 'add_fireball', label: '💠 Unlock Plasma Bomb', desc: 'New weapon: slow explosive orb',
    icon: 'Plasma Bomb',
    apply: (_w, add) => add('Plasma Bomb'),
    requires: (w) =>
      !w.some(x => x.name === 'Plasma Bomb') &&
      !w.some(x => x.name === 'Dark Matter') &&
      !w.some(x => x.name === 'Nova Burst') &&
      !w.some(x => x.name === 'Cataclysm Core') &&
      w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'fireball_damage', label: '💠 Plasma Bomb – Damage Up', desc: '+35% bomb damage',
    icon: 'Plasma Bomb',
    apply: (w) => upgradeWeapon(w, 'Plasma Bomb', 'damage'),
    requires: (w) => w.some(x => x.name === 'Plasma Bomb' && !x.isEvolution) && weaponLevel(w, 'Plasma Bomb') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'fireball_rate', label: '💠 Plasma Bomb – Fire Rate Up', desc: '+25% fire rate',
    icon: 'Plasma Bomb',
    apply: (w) => upgradeWeapon(w, 'Plasma Bomb', 'rate'),
    requires: (w) => w.some(x => x.name === 'Plasma Bomb' && !x.isEvolution) && weaponLevel(w, 'Plasma Bomb') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'fireball_radius', label: '💠 Plasma Bomb – Blast Radius Up', desc: '+30px explosion radius',
    icon: 'Plasma Bomb',
    apply: (w) => upgradeWeapon(w, 'Plasma Bomb', 'radius'),
    requires: (w) => w.some(x => x.name === 'Plasma Bomb' && !x.isEvolution) && weaponLevel(w, 'Plasma Bomb') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Ion Chain ──────────────────────────────────────────────────────────────
  {
    id: 'add_lightning', label: '🔗 Unlock Ion Chain', desc: 'New weapon: chain zap hitting multiple enemies',
    icon: 'Ion Chain',
    apply: (_w, add) => add('Ion Chain'),
    requires: (w) =>
      !w.some(x => x.name === 'Ion Chain') &&
      !w.some(x => x.name === 'Arc Nova') &&
      !w.some(x => x.name === 'Event Horizon') &&
      w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'lightning_damage', label: '🔗 Ion Chain – Damage Up', desc: '+30% chain damage',
    icon: 'Ion Chain',
    apply: (w) => upgradeWeapon(w, 'Ion Chain', 'damage'),
    requires: (w) => w.some(x => x.name === 'Ion Chain' && !x.isEvolution) && weaponLevel(w, 'Ion Chain') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'lightning_chains', label: '🔗 Ion Chain – Extra Link', desc: 'Zap hits +1 more enemy',
    icon: 'Ion Chain',
    apply: (w) => upgradeWeapon(w, 'Ion Chain', 'chains'),
    requires: (w) => w.some(x => x.name === 'Ion Chain' && !x.isEvolution) && weaponLevel(w, 'Ion Chain') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'lightning_rate', label: '🔗 Ion Chain – Fire Rate Up', desc: '+20% zap rate',
    icon: 'Ion Chain',
    apply: (w) => upgradeWeapon(w, 'Ion Chain', 'rate'),
    requires: (w) => w.some(x => x.name === 'Ion Chain' && !x.isEvolution) && weaponLevel(w, 'Ion Chain') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Force Field ────────────────────────────────────────────────────────────
  {
    id: 'add_aura', label: '🛡 Unlock Force Field', desc: 'New weapon: pulsing damage ring',
    icon: 'Force Field',
    apply: (_w, add) => add('Force Field'),
    requires: (w) =>
      !w.some(x => x.name === 'Force Field') &&
      !w.some(x => x.name === 'Nova Burst') &&
      !w.some(x => x.name === 'Aegis Array') &&
      w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'aura_damage', label: '🛡 Force Field – Damage Up', desc: '+30% field damage',
    icon: 'Force Field',
    apply: (w) => upgradeWeapon(w, 'Force Field', 'damage'),
    requires: (w) => w.some(x => x.name === 'Force Field' && !x.isEvolution) && weaponLevel(w, 'Force Field') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'aura_range', label: '🛡 Force Field – Range Up', desc: '+25px field range',
    icon: 'Force Field',
    apply: (w) => upgradeWeapon(w, 'Force Field', 'range'),
    requires: (w) => w.some(x => x.name === 'Force Field' && !x.isEvolution) && weaponLevel(w, 'Force Field') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'aura_rate', label: '🛡 Force Field – Pulse Rate Up', desc: '+25% pulse rate',
    icon: 'Force Field',
    apply: (w) => upgradeWeapon(w, 'Force Field', 'rate'),
    requires: (w) => w.some(x => x.name === 'Force Field' && !x.isEvolution) && weaponLevel(w, 'Force Field') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Player stats ───────────────────────────────────────────────────────────
  {
    id: 'player_speed', label: '🚀 Thruster Up', desc: '+20% movement speed',
    icon: 'speed',
    apply: (_w, _add, player) => { player.speed *= 1.2; },
    requires: () => true,
  },
  {
    id: 'player_hp', label: '🔋 Shield Capacity Up', desc: '+25 max shield and repair 25',
    icon: 'shield_cap',
    apply: (_w, _add, player) => { player.maxHp += 25; player.hp = Math.min(player.hp + 25, player.maxHp); player.hpUpgrades++; },
    requires: (_w, player) => player.hpUpgrades < MAX_GENERIC_UPGRADES,
  },
  // ── Evolutions ─────────────────────────────────────────────────────────────
  {
    id: 'evo_thunder_strike',
    label: '🔵⚡ EVOLVE: Beam Lash',
    desc: 'Merge Laser lv3 + Plasma Whip lv2 → simultaneous bolt & arc',
    icon: 'Beam Lash',
    apply: (_w, add, _p, remove) => { remove('Laser'); remove('Plasma Whip'); add('Beam Lash'); },
    requires: (w) =>
      weaponLevel(w, 'Laser') >= 3 && weaponLevel(w, 'Plasma Whip') >= 2 &&
      !w.some(x => x.name === 'Beam Lash'),
  },
  {
    id: 'evo_void_orb',
    label: '🔵💠 EVOLVE: Dark Matter',
    desc: 'Merge Laser lv3 + Plasma Bomb lv2 → massive piercing singularity',
    icon: 'Dark Matter',
    apply: (_w, add, _p, remove) => { remove('Laser'); remove('Plasma Bomb'); add('Dark Matter'); },
    requires: (w) =>
      weaponLevel(w, 'Laser') >= 3 && weaponLevel(w, 'Plasma Bomb') >= 2 &&
      !w.some(x => x.name === 'Dark Matter'),
  },
  {
    id: 'evo_inferno',
    label: '🛡💠 EVOLVE: Nova Burst',
    desc: 'Merge Force Field lv2 + Plasma Bomb lv3 → wide field + 6-way bombs',
    icon: 'Nova Burst',
    apply: (_w, add, _p, remove) => { remove('Force Field'); remove('Plasma Bomb'); add('Nova Burst'); },
    requires: (w) =>
      weaponLevel(w, 'Force Field') >= 2 && weaponLevel(w, 'Plasma Bomb') >= 3 &&
      !w.some(x => x.name === 'Nova Burst'),
  },
  {
    id: 'evo_cryo_lash',
    label: '⚡🧊 EVOLVE: Cryo Lash',
    desc: 'Merge Plasma Whip lv2 + Cryo Beam lv2 → freezing sweep arc',
    icon: 'Cryo Lash',
    apply: (_w, add, _p, remove) => { remove('Plasma Whip'); remove('Cryo Beam'); add('Cryo Lash'); },
    requires: (w) =>
      weaponLevel(w, 'Plasma Whip') >= 2 && weaponLevel(w, 'Cryo Beam') >= 2 &&
      !w.some(x => x.name === 'Cryo Lash'),
  },
  {
    id: 'evo_aegis_array',
    label: '🛡💛 EVOLVE: Aegis Array',
    desc: 'Merge Force Field lv2 + Pulse Cannon lv2 → aura pulse plus burst fire',
    icon: 'Aegis Array',
    apply: (_w, add, _p, remove) => { remove('Force Field'); remove('Pulse Cannon'); add('Aegis Array'); },
    requires: (w) =>
      weaponLevel(w, 'Force Field') >= 2 && weaponLevel(w, 'Pulse Cannon') >= 2 &&
      !w.some(x => x.name === 'Aegis Array'),
  },
  {
    id: 'evo_cataclysm_core',
    label: '🌀💠 EVOLVE: Cataclysm Core',
    desc: 'Merge Gravity Well lv2 + Plasma Bomb lv2 → remote pull-core detonation',
    icon: 'Cataclysm Core',
    apply: (_w, add, _p, remove) => { remove('Gravity Well'); remove('Plasma Bomb'); add('Cataclysm Core'); },
    requires: (w) =>
      weaponLevel(w, 'Gravity Well') >= 2 && weaponLevel(w, 'Plasma Bomb') >= 2 &&
      !w.some(x => x.name === 'Cataclysm Core'),
  },
  // ── Missile Barrage ────────────────────────────────────────────────────────
  {
    id: 'add_missile', label: '🚀 Unlock Missile Barrage', desc: 'New weapon: homing explosive missiles',
    icon: 'Missile Barrage',
    apply: (_w, add) => add('Missile Barrage'),
    requires: (w) =>
      !w.some(x => x.name === 'Missile Barrage') &&
      !w.some(x => x.name === 'Quantum Torpedo') &&
      !w.some(x => x.name === 'Frost Barrage') &&
      w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'missile_damage', label: '🚀 Missile Barrage – Damage Up', desc: '+30% missile damage',
    icon: 'Missile Barrage',
    apply: (w) => upgradeWeapon(w, 'Missile Barrage', 'damage'),
    requires: (w) => w.some(x => x.name === 'Missile Barrage' && !x.isEvolution) && weaponLevel(w, 'Missile Barrage') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'missile_rate', label: '🚀 Missile Barrage – Fire Rate Up', desc: '+22% fire rate',
    icon: 'Missile Barrage',
    apply: (w) => upgradeWeapon(w, 'Missile Barrage', 'rate'),
    requires: (w) => w.some(x => x.name === 'Missile Barrage' && !x.isEvolution) && weaponLevel(w, 'Missile Barrage') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'missile_count', label: '🚀 Missile Barrage – Salvo Up', desc: '+1 missile per volley',
    icon: 'Missile Barrage',
    apply: (w) => upgradeWeapon(w, 'Missile Barrage', 'count'),
    requires: (w) => w.some(x => x.name === 'Missile Barrage' && !x.isEvolution) && weaponLevel(w, 'Missile Barrage') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Pulse Cannon ───────────────────────────────────────────────────────────
  {
    id: 'add_pulse', label: '💛 Unlock Pulse Cannon', desc: 'New weapon: multi-directional burst',
    icon: 'Pulse Cannon',
    apply: (_w, add) => add('Pulse Cannon'),
    requires: (w) =>
      !w.some(x => x.name === 'Pulse Cannon') &&
      !w.some(x => x.name === 'Solar Flare') &&
      !w.some(x => x.name === 'Arc Nova') &&
      !w.some(x => x.name === 'Aegis Array') &&
      w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'pulse_damage', label: '💛 Pulse Cannon – Damage Up', desc: '+30% pulse damage',
    icon: 'Pulse Cannon',
    apply: (w) => upgradeWeapon(w, 'Pulse Cannon', 'damage'),
    requires: (w) => w.some(x => x.name === 'Pulse Cannon' && !x.isEvolution) && weaponLevel(w, 'Pulse Cannon') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'pulse_rate', label: '💛 Pulse Cannon – Fire Rate Up', desc: '+20% fire rate',
    icon: 'Pulse Cannon',
    apply: (w) => upgradeWeapon(w, 'Pulse Cannon', 'rate'),
    requires: (w) => w.some(x => x.name === 'Pulse Cannon' && !x.isEvolution) && weaponLevel(w, 'Pulse Cannon') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'pulse_dirs', label: '💛 Pulse Cannon – More Directions', desc: '+2 fire directions',
    icon: 'Pulse Cannon',
    apply: (w) => upgradeWeapon(w, 'Pulse Cannon', 'directions'),
    requires: (w) => w.some(x => x.name === 'Pulse Cannon' && !x.isEvolution) && weaponLevel(w, 'Pulse Cannon') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Cryo Beam ──────────────────────────────────────────────────────────────
  {
    id: 'add_cryo', label: '🧊 Unlock Cryo Beam', desc: 'New weapon: freeze ray that slows enemies',
    icon: 'Cryo Beam',
    apply: (_w, add) => add('Cryo Beam'),
    requires: (w) =>
      !w.some(x => x.name === 'Cryo Beam') &&
      !w.some(x => x.name === 'Glacial Storm') &&
      !w.some(x => x.name === 'Frost Barrage') &&
      !w.some(x => x.name === 'Cryo Lash') &&
      w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'cryo_damage', label: '🧊 Cryo Beam – Damage Up', desc: '+30% cryo damage',
    icon: 'Cryo Beam',
    apply: (w) => upgradeWeapon(w, 'Cryo Beam', 'damage'),
    requires: (w) => w.some(x => x.name === 'Cryo Beam' && !x.isEvolution) && weaponLevel(w, 'Cryo Beam') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'cryo_range', label: '🧊 Cryo Beam – Range Up', desc: '+40px beam range',
    icon: 'Cryo Beam',
    apply: (w) => upgradeWeapon(w, 'Cryo Beam', 'range'),
    requires: (w) => w.some(x => x.name === 'Cryo Beam' && !x.isEvolution) && weaponLevel(w, 'Cryo Beam') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'cryo_rate', label: '🧊 Cryo Beam – Tick Rate Up', desc: '+20% tick rate',
    icon: 'Cryo Beam',
    apply: (w) => upgradeWeapon(w, 'Cryo Beam', 'rate'),
    requires: (w) => w.some(x => x.name === 'Cryo Beam' && !x.isEvolution) && weaponLevel(w, 'Cryo Beam') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── New evolutions ─────────────────────────────────────────────────────────
  {
    id: 'evo_solar_flare',
    label: '🔵💛 EVOLVE: Solar Flare',
    desc: 'Merge Laser lv2 + Pulse Cannon lv2 → 8-way piercing solar bolts',
    icon: 'Solar Flare',
    apply: (_w, add, _p, remove) => { remove('Laser'); remove('Pulse Cannon'); add('Solar Flare'); },
    requires: (w) =>
      weaponLevel(w, 'Laser') >= 2 && weaponLevel(w, 'Pulse Cannon') >= 2 &&
      !w.some(x => x.name === 'Solar Flare'),
  },
  {
    id: 'evo_quantum_torpedo',
    label: '🚀💠 EVOLVE: Quantum Torpedo',
    desc: 'Merge Missile Barrage lv2 + Plasma Bomb lv2 → giant homing bomb',
    icon: 'Quantum Torpedo',
    apply: (_w, add, _p, remove) => { remove('Missile Barrage'); remove('Plasma Bomb'); add('Quantum Torpedo'); },
    requires: (w) =>
      weaponLevel(w, 'Missile Barrage') >= 2 && weaponLevel(w, 'Plasma Bomb') >= 2 &&
      !w.some(x => x.name === 'Quantum Torpedo'),
  },
  {
    id: 'evo_glacial_storm',
    label: '🧊🛡 EVOLVE: Glacial Storm',
    desc: 'Merge Cryo Beam lv2 + Force Field lv2 → freeze field + cryo pulses',
    icon: 'Glacial Storm',
    apply: (_w, add, _p, remove) => { remove('Cryo Beam'); remove('Force Field'); add('Glacial Storm'); },
    requires: (w) =>
      weaponLevel(w, 'Cryo Beam') >= 2 && weaponLevel(w, 'Force Field') >= 2 &&
      !w.some(x => x.name === 'Glacial Storm'),
  },
  {
    id: 'evo_arc_nova',
    label: '🔗💛 EVOLVE: Arc Nova',
    desc: 'Merge Ion Chain lv2 + Pulse Cannon lv2 → burst fire + chain lightning',
    icon: 'Arc Nova',
    apply: (_w, add, _p, remove) => { remove('Ion Chain'); remove('Pulse Cannon'); add('Arc Nova'); },
    requires: (w) =>
      weaponLevel(w, 'Ion Chain') >= 2 && weaponLevel(w, 'Pulse Cannon') >= 2 &&
      !w.some(x => x.name === 'Arc Nova'),
  },
  {
    id: 'evo_event_horizon',
    label: '🔗🌀 EVOLVE: Event Horizon',
    desc: 'Merge Ion Chain lv3 + Gravity Well lv2 → pull field + arc surges',
    icon: 'Event Horizon',
    apply: (_w, add, _p, remove) => { remove('Ion Chain'); remove('Gravity Well'); add('Event Horizon'); },
    requires: (w) =>
      weaponLevel(w, 'Ion Chain') >= 3 && weaponLevel(w, 'Gravity Well') >= 2 &&
      !w.some(x => x.name === 'Event Horizon'),
  },
  {
    id: 'evo_frost_barrage',
    label: '🚀🧊 EVOLVE: Frost Barrage',
    desc: 'Merge Missile Barrage lv2 + Cryo Beam lv2 → homing frost missiles',
    icon: 'Frost Barrage',
    apply: (_w, add, _p, remove) => { remove('Missile Barrage'); remove('Cryo Beam'); add('Frost Barrage'); },
    requires: (w) =>
      weaponLevel(w, 'Missile Barrage') >= 2 && weaponLevel(w, 'Cryo Beam') >= 2 &&
      !w.some(x => x.name === 'Frost Barrage'),
  },
  // ── Evolution upgrades ─────────────────────────────────────────────────────
  {
    id: 'beam_lash_damage', label: '★ Beam Lash – Damage Up', desc: '+30% evolved bolt & arc damage',
    icon: 'Beam Lash',
    apply: (w) => upgradeWeapon(w, 'Beam Lash', 'damage'),
    requires: (w) => w.some(x => x.name === 'Beam Lash') && weaponLevel(w, 'Beam Lash') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'beam_lash_rate', label: '★ Beam Lash – Rate Up', desc: '+20% Beam Lash fire rate',
    icon: 'Beam Lash',
    apply: (w) => upgradeWeapon(w, 'Beam Lash', 'rate'),
    requires: (w) => w.some(x => x.name === 'Beam Lash') && weaponLevel(w, 'Beam Lash') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'dark_matter_damage', label: '★ Dark Matter – Damage Up', desc: '+30% singularity damage',
    icon: 'Dark Matter',
    apply: (w) => upgradeWeapon(w, 'Dark Matter', 'damage'),
    requires: (w) => w.some(x => x.name === 'Dark Matter') && weaponLevel(w, 'Dark Matter') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'dark_matter_rate', label: '★ Dark Matter – Rate Up', desc: '+20% Dark Matter fire rate',
    icon: 'Dark Matter',
    apply: (w) => upgradeWeapon(w, 'Dark Matter', 'rate'),
    requires: (w) => w.some(x => x.name === 'Dark Matter') && weaponLevel(w, 'Dark Matter') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'nova_burst_damage', label: '★ Nova Burst – Damage Up', desc: '+30% field & orb damage',
    icon: 'Nova Burst',
    apply: (w) => upgradeWeapon(w, 'Nova Burst', 'damage'),
    requires: (w) => w.some(x => x.name === 'Nova Burst') && weaponLevel(w, 'Nova Burst') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'nova_burst_range', label: '★ Nova Burst – Range Up', desc: '+25px field range',
    icon: 'Nova Burst',
    apply: (w) => upgradeWeapon(w, 'Nova Burst', 'range'),
    requires: (w) => w.some(x => x.name === 'Nova Burst') && weaponLevel(w, 'Nova Burst') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'solar_flare_damage', label: '★ Solar Flare – Damage Up', desc: '+30% solar bolt damage',
    icon: 'Solar Flare',
    apply: (w) => upgradeWeapon(w, 'Solar Flare', 'damage'),
    requires: (w) => w.some(x => x.name === 'Solar Flare') && weaponLevel(w, 'Solar Flare') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'solar_flare_rate', label: '★ Solar Flare – Rate Up', desc: '+20% Solar Flare fire rate',
    icon: 'Solar Flare',
    apply: (w) => upgradeWeapon(w, 'Solar Flare', 'rate'),
    requires: (w) => w.some(x => x.name === 'Solar Flare') && weaponLevel(w, 'Solar Flare') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'quantum_torpedo_damage', label: '★ Quantum Torpedo – Damage Up', desc: '+30% torpedo damage',
    icon: 'Quantum Torpedo',
    apply: (w) => upgradeWeapon(w, 'Quantum Torpedo', 'damage'),
    requires: (w) => w.some(x => x.name === 'Quantum Torpedo') && weaponLevel(w, 'Quantum Torpedo') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'quantum_torpedo_rate', label: '★ Quantum Torpedo – Rate Up', desc: '+20% torpedo fire rate',
    icon: 'Quantum Torpedo',
    apply: (w) => upgradeWeapon(w, 'Quantum Torpedo', 'rate'),
    requires: (w) => w.some(x => x.name === 'Quantum Torpedo') && weaponLevel(w, 'Quantum Torpedo') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'glacial_storm_damage', label: '★ Glacial Storm – Damage Up', desc: '+30% storm damage',
    icon: 'Glacial Storm',
    apply: (w) => upgradeWeapon(w, 'Glacial Storm', 'damage'),
    requires: (w) => w.some(x => x.name === 'Glacial Storm') && weaponLevel(w, 'Glacial Storm') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'glacial_storm_range', label: '★ Glacial Storm – Range Up', desc: '+30px storm range',
    icon: 'Glacial Storm',
    apply: (w) => upgradeWeapon(w, 'Glacial Storm', 'range'),
    requires: (w) => w.some(x => x.name === 'Glacial Storm') && weaponLevel(w, 'Glacial Storm') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'arc_nova_damage', label: '★ Arc Nova – Damage Up', desc: '+30% burst and chain damage',
    icon: 'Arc Nova',
    apply: (w) => upgradeWeapon(w, 'Arc Nova', 'damage'),
    requires: (w) => w.some(x => x.name === 'Arc Nova') && weaponLevel(w, 'Arc Nova') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'arc_nova_rate', label: '★ Arc Nova – Rate Up', desc: '+18% Arc Nova fire rate',
    icon: 'Arc Nova',
    apply: (w) => upgradeWeapon(w, 'Arc Nova', 'rate'),
    requires: (w) => w.some(x => x.name === 'Arc Nova') && weaponLevel(w, 'Arc Nova') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'event_horizon_damage', label: '★ Event Horizon – Damage Up', desc: '+30% pulse and arc damage',
    icon: 'Event Horizon',
    apply: (w) => upgradeWeapon(w, 'Event Horizon', 'damage'),
    requires: (w) => w.some(x => x.name === 'Event Horizon') && weaponLevel(w, 'Event Horizon') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'event_horizon_range', label: '★ Event Horizon – Range Up', desc: '+30px pull field range',
    icon: 'Event Horizon',
    apply: (w) => upgradeWeapon(w, 'Event Horizon', 'range'),
    requires: (w) => w.some(x => x.name === 'Event Horizon') && weaponLevel(w, 'Event Horizon') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'frost_barrage_damage', label: '★ Frost Barrage – Damage Up', desc: '+30% frost missile damage',
    icon: 'Frost Barrage',
    apply: (w) => upgradeWeapon(w, 'Frost Barrage', 'damage'),
    requires: (w) => w.some(x => x.name === 'Frost Barrage') && weaponLevel(w, 'Frost Barrage') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'frost_barrage_rate', label: '★ Frost Barrage – Rate Up', desc: '+18% frost missile fire rate',
    icon: 'Frost Barrage',
    apply: (w) => upgradeWeapon(w, 'Frost Barrage', 'rate'),
    requires: (w) => w.some(x => x.name === 'Frost Barrage') && weaponLevel(w, 'Frost Barrage') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'cryo_lash_damage', label: '★ Cryo Lash – Damage Up', desc: '+30% lash damage',
    icon: 'Cryo Lash',
    apply: (w) => upgradeWeapon(w, 'Cryo Lash', 'damage'),
    requires: (w) => w.some(x => x.name === 'Cryo Lash') && weaponLevel(w, 'Cryo Lash') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'cryo_lash_range', label: '★ Cryo Lash – Range Up', desc: '+30px lash range',
    icon: 'Cryo Lash',
    apply: (w) => upgradeWeapon(w, 'Cryo Lash', 'range'),
    requires: (w) => w.some(x => x.name === 'Cryo Lash') && weaponLevel(w, 'Cryo Lash') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'aegis_array_damage', label: '★ Aegis Array – Damage Up', desc: '+30% pulse and burst damage',
    icon: 'Aegis Array',
    apply: (w) => upgradeWeapon(w, 'Aegis Array', 'damage'),
    requires: (w) => w.some(x => x.name === 'Aegis Array') && weaponLevel(w, 'Aegis Array') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'aegis_array_range', label: '★ Aegis Array – Range Up', desc: '+25px pulse field range',
    icon: 'Aegis Array',
    apply: (w) => upgradeWeapon(w, 'Aegis Array', 'range'),
    requires: (w) => w.some(x => x.name === 'Aegis Array') && weaponLevel(w, 'Aegis Array') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'cataclysm_core_damage', label: '★ Cataclysm Core – Damage Up', desc: '+30% core detonation damage',
    icon: 'Cataclysm Core',
    apply: (w) => upgradeWeapon(w, 'Cataclysm Core', 'damage'),
    requires: (w) => w.some(x => x.name === 'Cataclysm Core') && weaponLevel(w, 'Cataclysm Core') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'cataclysm_core_range', label: '★ Cataclysm Core – Range Up', desc: '+30px pull radius',
    icon: 'Cataclysm Core',
    apply: (w) => upgradeWeapon(w, 'Cataclysm Core', 'range'),
    requires: (w) => w.some(x => x.name === 'Cataclysm Core') && weaponLevel(w, 'Cataclysm Core') < MAX_EVO_WEAPON_LEVEL,
  },
  // ── Generic powerups ───────────────────────────────────────────────────────
  {
    id: 'gen_atk_speed', label: '⚡ Systems Overclock', desc: 'All weapons fire 15% faster',
    icon: 'atk_speed',
    apply: (w, _add, player) => {
      player.attackSpeedMult *= 0.85;
      player.atkSpeedUpgrades++;
      for (const weapon of w) weapon.scaleStats(0.85, 1.0);
    },
    requires: (_w, player) => player.atkSpeedUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_damage', label: '💥 Weapons Amplifier', desc: 'All weapons deal 20% more damage',
    icon: 'damage_amp',
    apply: (w, _add, player) => {
      player.damageMult *= 1.20;
      player.damageUpgrades++;
      for (const weapon of w) weapon.scaleStats(1.0, 1.20);
    },
    requires: (_w, player) => player.damageUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_pickup', label: '🧲 Tractor Beam', desc: '+30 gem attraction radius',
    icon: 'tractor_beam',
    apply: (_w, _add, player) => { player.pickupRadius += 30; player.pickupUpgrades++; },
    requires: (_w, player) => player.pickupUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_armor', label: '🛡 Titanium Plating', desc: '+4 flat damage reduction',
    icon: 'armor',
    apply: (_w, _add, player) => { player.armor += 4; player.armorUpgrades++; },
    requires: (_w, player) => player.armorUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_repair', label: '🔧 Emergency Repair', desc: 'Restore 40 shield HP',
    icon: 'repair',
    apply: (_w, _add, player) => { player.hp = Math.min(player.hp + 40, player.maxHp); },
    requires: (_w, player) => player.hp < player.maxHp * 0.9,
  },
  // ── Burn Catalyst ──────────────────────────────────────────────────────────
  {
    id: 'gen_burn_1', label: '🔥 Burn Catalyst I', desc: '+30% chance to ignite enemies on hit',
    icon: 'burn',
    apply: (_w, _add, player) => { player.burnChance += 0.30; player.burnUpgrades++; },
    requires: (_w, player) => player.burnUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_burn_2', label: '🔥 Burn Catalyst II', desc: '+30% burn chance (stacks)',
    icon: 'burn',
    apply: (_w, _add, player) => { player.burnChance += 0.30; player.burnUpgrades++; },
    requires: (_w, player) => player.burnUpgrades >= 1 && player.burnUpgrades < MAX_GENERIC_UPGRADES,
  },
  // ── Toxin Core ─────────────────────────────────────────────────────────────
  {
    id: 'gen_poison_1', label: '☠ Toxin Core I', desc: '+30% chance to poison enemies on hit',
    icon: 'poison',
    apply: (_w, _add, player) => { player.poisonChance += 0.30; player.poisonUpgrades++; },
    requires: (_w, player) => player.poisonUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_poison_2', label: '☠ Toxin Core II', desc: '+30% poison chance (stacks)',
    icon: 'poison',
    apply: (_w, _add, player) => { player.poisonChance += 0.30; player.poisonUpgrades++; },
    requires: (_w, player) => player.poisonUpgrades >= 1 && player.poisonUpgrades < MAX_GENERIC_UPGRADES,
  },
  // ── Gravity Well weapon ────────────────────────────────────────────────────
  {
    id: 'add_gravity_well', label: '🌀 Unlock Gravity Well', desc: 'New weapon: pulls & detonates',
    icon: 'Gravity Well',
    apply: (_w, add) => add('Gravity Well'),
    requires: (w) =>
      !w.some(x => x.name === 'Gravity Well') &&
      !w.some(x => x.name === 'Event Horizon') &&
      !w.some(x => x.name === 'Cataclysm Core') &&
      w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'gravity_well_damage', label: '🌀 Gravity Well – Damage Up', desc: '+35% detonation damage',
    icon: 'Gravity Well',
    apply: (w) => upgradeWeapon(w, 'Gravity Well', 'damage'),
    requires: (w) => w.some(x => x.name === 'Gravity Well' && !x.isEvolution) && weaponLevel(w, 'Gravity Well') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'gravity_well_radius', label: '🌀 Gravity Well – Pull Radius', desc: '+40px pull radius',
    icon: 'Gravity Well',
    apply: (w) => upgradeWeapon(w, 'Gravity Well', 'radius'),
    requires: (w) => w.some(x => x.name === 'Gravity Well' && !x.isEvolution) && weaponLevel(w, 'Gravity Well') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'gravity_well_rate', label: '🌀 Gravity Well – Cooldown Down', desc: '−20% cooldown',
    icon: 'Gravity Well',
    apply: (w) => upgradeWeapon(w, 'Gravity Well', 'rate'),
    requires: (w) => w.some(x => x.name === 'Gravity Well' && !x.isEvolution) && weaponLevel(w, 'Gravity Well') < MAX_BASE_WEAPON_LEVEL,
  },
];

export class LevelUpManager {
  /** Current player level (starts at 1). */
  level = 1;

  /** Accumulated XP within the current level (resets on level-up). */
  xp = 0;

  /** XP needed to reach the next level. Recalculated after each level-up. */
  xpToNext: number;

  /**
   * Callback set by main.ts.  Called whenever the player levels up with the
   * list of available upgrade choices and a function to apply the chosen one.
   * Set to null initially; main.ts assigns it immediately after constructing this manager.
   */
  onLevelUp: LevelUpCallback | null = null;

  constructor() {
    // XP needed to reach level 2 (the first real level-up)
    this.xpToNext = xpForLevel(1);
  }

  /**
   * Adds XP to the current total and triggers level-ups until the XP is
   * consumed.  The while loop handles the (rare) case where a single large
   * gem grant causes more than one level-up in a single frame.
   *
   * @param amount      XP gained this frame (usually the value of one gem).
   * @param weapons     Current weapon array — passed to upgrade `apply` / `requires`.
   * @param addWeapon   Callback to equip a new weapon by name.
   * @param player      Player reference for stat upgrades.
   * @param removeWeapon Callback to remove a weapon (used by evolution upgrades).
   */
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

  /**
   * Filters the UPGRADE_POOL to currently available upgrades, then samples up to
   * 4 offers without replacement. Evolution cards get extra weight so once the
   * player has met a merge recipe, that card appears more reliably.
   */
  private triggerLevelUp(weapons: AnyWeapon[], addWeapon: AddWeaponFn, player: Player, removeWeapon: RemoveWeaponFn): void {
    const available = UPGRADE_POOL.filter(u => u.requires(weapons, player));
    const choices = pickWeightedUpgrades(available, LEVEL_UP_CHOICE_COUNT);
    if (this.onLevelUp) {
      this.onLevelUp(choices, (choice) => {
        choice.apply(weapons, addWeapon, player, removeWeapon);
      });
    }
  }

  /**
   * Returns how full the XP bar is as a 0–1 fraction.
   * Capped at 1 to avoid visual overflow if rounding causes xp > xpToNext.
   */
  get xpFraction(): number {
    return this.xpToNext > 0 ? Math.min(this.xp / this.xpToNext, 1) : 1;
  }
}
