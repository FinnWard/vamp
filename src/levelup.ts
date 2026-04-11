// ─── levelup.ts ───────────────────────────────────────────────────────────────
// Manages the XP → level-up progression and the pool of available upgrades.
//
// How levelling works
// ────────────────────
// 1. The player collects gems, each worth some XP.
// 2. main.ts passes the total XP gained each frame to LevelUpManager.addXp().
// 3. When accumulated XP exceeds the threshold for the next level the manager
//    fires the onLevelUp callback with up to 3 randomly-selected upgrades from
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
// (3).  Generic powerups each have their own cap via player.xxxUpgrades counter.
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
const MAX_BASE_WEAPON_LEVEL = 5;   // base weapons: up to 4 upgrades (lv1 → lv5)
const MAX_EVO_WEAPON_LEVEL  = 3;   // evolved weapons: up to 2 upgrades (lv1 → lv3)
const MAX_WEAPON_SLOTS      = 4;   // player can hold at most 4 weapons at once
const MAX_GENERIC_UPGRADES  = 5;   // each generic powerup can stack at most 5 times

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
 * up to 3 available entries from this pool and presents them to the player.
 */
export interface Upgrade {
  /** Unique string identifier for debugging. */
  id: string;
  /** Short display name shown on the upgrade card header. */
  label: string;
  /** One-line description of the effect shown below the label. */
  desc: string;
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

const UPGRADE_POOL: Upgrade[] = [
  // ── Laser ──────────────────────────────────────────────────────────────────
  {
    id: 'bolt_damage', label: '🔵 Laser – Damage Up', desc: '+30% laser damage',
    apply: (w) => upgradeWeapon(w, 'Laser', 'damage'),
    requires: (w) => w.some(x => x.name === 'Laser' && !x.isEvolution) && weaponLevel(w, 'Laser') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'bolt_rate', label: '🔵 Laser – Fire Rate Up', desc: '+25% fire rate',
    apply: (w) => upgradeWeapon(w, 'Laser', 'rate'),
    requires: (w) => w.some(x => x.name === 'Laser' && !x.isEvolution) && weaponLevel(w, 'Laser') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'bolt_pierce', label: '🔵 Laser – Pierce', desc: 'Bolts pierce through +1 enemy',
    apply: (w) => upgradeWeapon(w, 'Laser', 'pierce'),
    requires: (w) => w.some(x => x.name === 'Laser' && !x.isEvolution) && weaponLevel(w, 'Laser') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Plasma Whip ────────────────────────────────────────────────────────────
  {
    id: 'add_whip', label: '⚡ Unlock Plasma Whip', desc: 'New weapon: sweeping plasma arc',
    apply: (_w, add) => add('Plasma Whip'),
    requires: (w) => !w.some(x => x.name === 'Plasma Whip') && !w.some(x => x.name === 'Beam Lash') && w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'whip_damage', label: '⚡ Plasma Whip – Damage Up', desc: '+30% whip damage',
    apply: (w) => upgradeWeapon(w, 'Plasma Whip', 'damage'),
    requires: (w) => w.some(x => x.name === 'Plasma Whip' && !x.isEvolution) && weaponLevel(w, 'Plasma Whip') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'whip_range', label: '⚡ Plasma Whip – Range Up', desc: '+30px whip range',
    apply: (w) => upgradeWeapon(w, 'Plasma Whip', 'range'),
    requires: (w) => w.some(x => x.name === 'Plasma Whip' && !x.isEvolution) && weaponLevel(w, 'Plasma Whip') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Plasma Bomb ────────────────────────────────────────────────────────────
  {
    id: 'add_fireball', label: '💠 Unlock Plasma Bomb', desc: 'New weapon: slow explosive orb',
    apply: (_w, add) => add('Plasma Bomb'),
    requires: (w) => !w.some(x => x.name === 'Plasma Bomb') && !w.some(x => x.name === 'Dark Matter') && !w.some(x => x.name === 'Nova Burst') && w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'fireball_damage', label: '💠 Plasma Bomb – Damage Up', desc: '+35% bomb damage',
    apply: (w) => upgradeWeapon(w, 'Plasma Bomb', 'damage'),
    requires: (w) => w.some(x => x.name === 'Plasma Bomb' && !x.isEvolution) && weaponLevel(w, 'Plasma Bomb') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'fireball_rate', label: '💠 Plasma Bomb – Fire Rate Up', desc: '+25% fire rate',
    apply: (w) => upgradeWeapon(w, 'Plasma Bomb', 'rate'),
    requires: (w) => w.some(x => x.name === 'Plasma Bomb' && !x.isEvolution) && weaponLevel(w, 'Plasma Bomb') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'fireball_radius', label: '💠 Plasma Bomb – Blast Radius Up', desc: '+30px explosion radius',
    apply: (w) => upgradeWeapon(w, 'Plasma Bomb', 'radius'),
    requires: (w) => w.some(x => x.name === 'Plasma Bomb' && !x.isEvolution) && weaponLevel(w, 'Plasma Bomb') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Ion Chain ──────────────────────────────────────────────────────────────
  {
    id: 'add_lightning', label: '🔗 Unlock Ion Chain', desc: 'New weapon: chain zap hitting multiple enemies',
    apply: (_w, add) => add('Ion Chain'),
    requires: (w) => !w.some(x => x.name === 'Ion Chain') && w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'lightning_damage', label: '🔗 Ion Chain – Damage Up', desc: '+30% chain damage',
    apply: (w) => upgradeWeapon(w, 'Ion Chain', 'damage'),
    requires: (w) => w.some(x => x.name === 'Ion Chain' && !x.isEvolution) && weaponLevel(w, 'Ion Chain') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'lightning_chains', label: '🔗 Ion Chain – Extra Link', desc: 'Zap hits +1 more enemy',
    apply: (w) => upgradeWeapon(w, 'Ion Chain', 'chains'),
    requires: (w) => w.some(x => x.name === 'Ion Chain' && !x.isEvolution) && weaponLevel(w, 'Ion Chain') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'lightning_rate', label: '🔗 Ion Chain – Fire Rate Up', desc: '+20% zap rate',
    apply: (w) => upgradeWeapon(w, 'Ion Chain', 'rate'),
    requires: (w) => w.some(x => x.name === 'Ion Chain' && !x.isEvolution) && weaponLevel(w, 'Ion Chain') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Force Field ────────────────────────────────────────────────────────────
  {
    id: 'add_aura', label: '🛡 Unlock Force Field', desc: 'New weapon: pulsing damage ring',
    apply: (_w, add) => add('Force Field'),
    requires: (w) => !w.some(x => x.name === 'Force Field') && !w.some(x => x.name === 'Nova Burst') && w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'aura_damage', label: '🛡 Force Field – Damage Up', desc: '+30% field damage',
    apply: (w) => upgradeWeapon(w, 'Force Field', 'damage'),
    requires: (w) => w.some(x => x.name === 'Force Field' && !x.isEvolution) && weaponLevel(w, 'Force Field') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'aura_range', label: '🛡 Force Field – Range Up', desc: '+25px field range',
    apply: (w) => upgradeWeapon(w, 'Force Field', 'range'),
    requires: (w) => w.some(x => x.name === 'Force Field' && !x.isEvolution) && weaponLevel(w, 'Force Field') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'aura_rate', label: '🛡 Force Field – Pulse Rate Up', desc: '+25% pulse rate',
    apply: (w) => upgradeWeapon(w, 'Force Field', 'rate'),
    requires: (w) => w.some(x => x.name === 'Force Field' && !x.isEvolution) && weaponLevel(w, 'Force Field') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Player stats ───────────────────────────────────────────────────────────
  {
    id: 'player_speed', label: '🚀 Thruster Up', desc: '+20% movement speed',
    apply: (_w, _add, player) => { player.speed *= 1.2; },
    requires: () => true,
  },
  {
    id: 'player_hp', label: '🔋 Shield Capacity Up', desc: '+25 max shield and repair 25',
    apply: (_w, _add, player) => { player.maxHp += 25; player.hp = Math.min(player.hp + 25, player.maxHp); player.hpUpgrades++; },
    requires: (_w, player) => player.hpUpgrades < MAX_GENERIC_UPGRADES,
  },
  // ── Evolutions ─────────────────────────────────────────────────────────────
  {
    id: 'evo_thunder_strike',
    label: '🔵⚡ EVOLVE: Beam Lash',
    desc: 'Merge Laser lv3 + Plasma Whip lv2 → simultaneous bolt & arc',
    apply: (_w, add, _p, remove) => { remove('Laser'); remove('Plasma Whip'); add('Beam Lash'); },
    requires: (w) =>
      weaponLevel(w, 'Laser') >= 3 && weaponLevel(w, 'Plasma Whip') >= 2 &&
      !w.some(x => x.name === 'Beam Lash'),
  },
  {
    id: 'evo_void_orb',
    label: '🔵💠 EVOLVE: Dark Matter',
    desc: 'Merge Laser lv3 + Plasma Bomb lv2 → massive piercing singularity',
    apply: (_w, add, _p, remove) => { remove('Laser'); remove('Plasma Bomb'); add('Dark Matter'); },
    requires: (w) =>
      weaponLevel(w, 'Laser') >= 3 && weaponLevel(w, 'Plasma Bomb') >= 2 &&
      !w.some(x => x.name === 'Dark Matter'),
  },
  {
    id: 'evo_inferno',
    label: '🛡💠 EVOLVE: Nova Burst',
    desc: 'Merge Force Field lv2 + Plasma Bomb lv3 → wide field + 6-way bombs',
    apply: (_w, add, _p, remove) => { remove('Force Field'); remove('Plasma Bomb'); add('Nova Burst'); },
    requires: (w) =>
      weaponLevel(w, 'Force Field') >= 2 && weaponLevel(w, 'Plasma Bomb') >= 3 &&
      !w.some(x => x.name === 'Nova Burst'),
  },
  // ── Missile Barrage ────────────────────────────────────────────────────────
  {
    id: 'add_missile', label: '🚀 Unlock Missile Barrage', desc: 'New weapon: homing explosive missiles',
    apply: (_w, add) => add('Missile Barrage'),
    requires: (w) => !w.some(x => x.name === 'Missile Barrage') && !w.some(x => x.name === 'Quantum Torpedo') && w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'missile_damage', label: '🚀 Missile Barrage – Damage Up', desc: '+30% missile damage',
    apply: (w) => upgradeWeapon(w, 'Missile Barrage', 'damage'),
    requires: (w) => w.some(x => x.name === 'Missile Barrage' && !x.isEvolution) && weaponLevel(w, 'Missile Barrage') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'missile_rate', label: '🚀 Missile Barrage – Fire Rate Up', desc: '+22% fire rate',
    apply: (w) => upgradeWeapon(w, 'Missile Barrage', 'rate'),
    requires: (w) => w.some(x => x.name === 'Missile Barrage' && !x.isEvolution) && weaponLevel(w, 'Missile Barrage') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'missile_count', label: '🚀 Missile Barrage – Salvo Up', desc: '+1 missile per volley',
    apply: (w) => upgradeWeapon(w, 'Missile Barrage', 'count'),
    requires: (w) => w.some(x => x.name === 'Missile Barrage' && !x.isEvolution) && weaponLevel(w, 'Missile Barrage') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Pulse Cannon ───────────────────────────────────────────────────────────
  {
    id: 'add_pulse', label: '💛 Unlock Pulse Cannon', desc: 'New weapon: multi-directional burst',
    apply: (_w, add) => add('Pulse Cannon'),
    requires: (w) => !w.some(x => x.name === 'Pulse Cannon') && !w.some(x => x.name === 'Solar Flare') && w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'pulse_damage', label: '💛 Pulse Cannon – Damage Up', desc: '+30% pulse damage',
    apply: (w) => upgradeWeapon(w, 'Pulse Cannon', 'damage'),
    requires: (w) => w.some(x => x.name === 'Pulse Cannon' && !x.isEvolution) && weaponLevel(w, 'Pulse Cannon') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'pulse_rate', label: '💛 Pulse Cannon – Fire Rate Up', desc: '+20% fire rate',
    apply: (w) => upgradeWeapon(w, 'Pulse Cannon', 'rate'),
    requires: (w) => w.some(x => x.name === 'Pulse Cannon' && !x.isEvolution) && weaponLevel(w, 'Pulse Cannon') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'pulse_dirs', label: '💛 Pulse Cannon – More Directions', desc: '+2 fire directions',
    apply: (w) => upgradeWeapon(w, 'Pulse Cannon', 'directions'),
    requires: (w) => w.some(x => x.name === 'Pulse Cannon' && !x.isEvolution) && weaponLevel(w, 'Pulse Cannon') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── Cryo Beam ──────────────────────────────────────────────────────────────
  {
    id: 'add_cryo', label: '🧊 Unlock Cryo Beam', desc: 'New weapon: freeze ray that slows enemies',
    apply: (_w, add) => add('Cryo Beam'),
    requires: (w) => !w.some(x => x.name === 'Cryo Beam') && !w.some(x => x.name === 'Glacial Storm') && w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'cryo_damage', label: '🧊 Cryo Beam – Damage Up', desc: '+30% cryo damage',
    apply: (w) => upgradeWeapon(w, 'Cryo Beam', 'damage'),
    requires: (w) => w.some(x => x.name === 'Cryo Beam' && !x.isEvolution) && weaponLevel(w, 'Cryo Beam') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'cryo_range', label: '🧊 Cryo Beam – Range Up', desc: '+40px beam range',
    apply: (w) => upgradeWeapon(w, 'Cryo Beam', 'range'),
    requires: (w) => w.some(x => x.name === 'Cryo Beam' && !x.isEvolution) && weaponLevel(w, 'Cryo Beam') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'cryo_rate', label: '🧊 Cryo Beam – Tick Rate Up', desc: '+20% tick rate',
    apply: (w) => upgradeWeapon(w, 'Cryo Beam', 'rate'),
    requires: (w) => w.some(x => x.name === 'Cryo Beam' && !x.isEvolution) && weaponLevel(w, 'Cryo Beam') < MAX_BASE_WEAPON_LEVEL,
  },
  // ── New evolutions ─────────────────────────────────────────────────────────
  {
    id: 'evo_solar_flare',
    label: '🔵💛 EVOLVE: Solar Flare',
    desc: 'Merge Laser lv2 + Pulse Cannon lv2 → 8-way piercing solar bolts',
    apply: (_w, add, _p, remove) => { remove('Laser'); remove('Pulse Cannon'); add('Solar Flare'); },
    requires: (w) =>
      weaponLevel(w, 'Laser') >= 2 && weaponLevel(w, 'Pulse Cannon') >= 2 &&
      !w.some(x => x.name === 'Solar Flare'),
  },
  {
    id: 'evo_quantum_torpedo',
    label: '🚀💠 EVOLVE: Quantum Torpedo',
    desc: 'Merge Missile Barrage lv2 + Plasma Bomb lv2 → giant homing bomb',
    apply: (_w, add, _p, remove) => { remove('Missile Barrage'); remove('Plasma Bomb'); add('Quantum Torpedo'); },
    requires: (w) =>
      weaponLevel(w, 'Missile Barrage') >= 2 && weaponLevel(w, 'Plasma Bomb') >= 2 &&
      !w.some(x => x.name === 'Quantum Torpedo'),
  },
  {
    id: 'evo_glacial_storm',
    label: '🧊🛡 EVOLVE: Glacial Storm',
    desc: 'Merge Cryo Beam lv2 + Force Field lv2 → freeze field + cryo pulses',
    apply: (_w, add, _p, remove) => { remove('Cryo Beam'); remove('Force Field'); add('Glacial Storm'); },
    requires: (w) =>
      weaponLevel(w, 'Cryo Beam') >= 2 && weaponLevel(w, 'Force Field') >= 2 &&
      !w.some(x => x.name === 'Glacial Storm'),
  },
  // ── Evolution upgrades ─────────────────────────────────────────────────────
  {
    id: 'beam_lash_damage', label: '★ Beam Lash – Damage Up', desc: '+30% evolved bolt & arc damage',
    apply: (w) => upgradeWeapon(w, 'Beam Lash', 'damage'),
    requires: (w) => w.some(x => x.name === 'Beam Lash') && weaponLevel(w, 'Beam Lash') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'beam_lash_rate', label: '★ Beam Lash – Rate Up', desc: '+20% Beam Lash fire rate',
    apply: (w) => upgradeWeapon(w, 'Beam Lash', 'rate'),
    requires: (w) => w.some(x => x.name === 'Beam Lash') && weaponLevel(w, 'Beam Lash') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'dark_matter_damage', label: '★ Dark Matter – Damage Up', desc: '+30% singularity damage',
    apply: (w) => upgradeWeapon(w, 'Dark Matter', 'damage'),
    requires: (w) => w.some(x => x.name === 'Dark Matter') && weaponLevel(w, 'Dark Matter') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'dark_matter_rate', label: '★ Dark Matter – Rate Up', desc: '+20% Dark Matter fire rate',
    apply: (w) => upgradeWeapon(w, 'Dark Matter', 'rate'),
    requires: (w) => w.some(x => x.name === 'Dark Matter') && weaponLevel(w, 'Dark Matter') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'nova_burst_damage', label: '★ Nova Burst – Damage Up', desc: '+30% field & orb damage',
    apply: (w) => upgradeWeapon(w, 'Nova Burst', 'damage'),
    requires: (w) => w.some(x => x.name === 'Nova Burst') && weaponLevel(w, 'Nova Burst') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'nova_burst_range', label: '★ Nova Burst – Range Up', desc: '+25px field range',
    apply: (w) => upgradeWeapon(w, 'Nova Burst', 'range'),
    requires: (w) => w.some(x => x.name === 'Nova Burst') && weaponLevel(w, 'Nova Burst') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'solar_flare_damage', label: '★ Solar Flare – Damage Up', desc: '+30% solar bolt damage',
    apply: (w) => upgradeWeapon(w, 'Solar Flare', 'damage'),
    requires: (w) => w.some(x => x.name === 'Solar Flare') && weaponLevel(w, 'Solar Flare') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'solar_flare_rate', label: '★ Solar Flare – Rate Up', desc: '+20% Solar Flare fire rate',
    apply: (w) => upgradeWeapon(w, 'Solar Flare', 'rate'),
    requires: (w) => w.some(x => x.name === 'Solar Flare') && weaponLevel(w, 'Solar Flare') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'quantum_torpedo_damage', label: '★ Quantum Torpedo – Damage Up', desc: '+30% torpedo damage',
    apply: (w) => upgradeWeapon(w, 'Quantum Torpedo', 'damage'),
    requires: (w) => w.some(x => x.name === 'Quantum Torpedo') && weaponLevel(w, 'Quantum Torpedo') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'quantum_torpedo_rate', label: '★ Quantum Torpedo – Rate Up', desc: '+20% torpedo fire rate',
    apply: (w) => upgradeWeapon(w, 'Quantum Torpedo', 'rate'),
    requires: (w) => w.some(x => x.name === 'Quantum Torpedo') && weaponLevel(w, 'Quantum Torpedo') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'glacial_storm_damage', label: '★ Glacial Storm – Damage Up', desc: '+30% storm damage',
    apply: (w) => upgradeWeapon(w, 'Glacial Storm', 'damage'),
    requires: (w) => w.some(x => x.name === 'Glacial Storm') && weaponLevel(w, 'Glacial Storm') < MAX_EVO_WEAPON_LEVEL,
  },
  {
    id: 'glacial_storm_range', label: '★ Glacial Storm – Range Up', desc: '+30px storm range',
    apply: (w) => upgradeWeapon(w, 'Glacial Storm', 'range'),
    requires: (w) => w.some(x => x.name === 'Glacial Storm') && weaponLevel(w, 'Glacial Storm') < MAX_EVO_WEAPON_LEVEL,
  },
  // ── Generic powerups ───────────────────────────────────────────────────────
  {
    id: 'gen_atk_speed', label: '⚡ Systems Overclock', desc: 'All weapons fire 15% faster',
    apply: (w, _add, player) => {
      player.attackSpeedMult *= 0.85;
      player.atkSpeedUpgrades++;
      for (const weapon of w) weapon.scaleStats(0.85, 1.0);
    },
    requires: (_w, player) => player.atkSpeedUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_damage', label: '💥 Weapons Amplifier', desc: 'All weapons deal 20% more damage',
    apply: (w, _add, player) => {
      player.damageMult *= 1.20;
      player.damageUpgrades++;
      for (const weapon of w) weapon.scaleStats(1.0, 1.20);
    },
    requires: (_w, player) => player.damageUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_pickup', label: '🧲 Tractor Beam', desc: '+30 gem attraction radius',
    apply: (_w, _add, player) => { player.pickupRadius += 30; player.pickupUpgrades++; },
    requires: (_w, player) => player.pickupUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_armor', label: '🛡 Titanium Plating', desc: '+4 flat damage reduction',
    apply: (_w, _add, player) => { player.armor += 4; player.armorUpgrades++; },
    requires: (_w, player) => player.armorUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_repair', label: '🔧 Emergency Repair', desc: 'Restore 40 shield HP',
    apply: (_w, _add, player) => { player.hp = Math.min(player.hp + 40, player.maxHp); },
    requires: (_w, player) => player.hp < player.maxHp * 0.9,
  },
  // ── Burn Catalyst ──────────────────────────────────────────────────────────
  {
    id: 'gen_burn_1', label: '🔥 Burn Catalyst I', desc: '+30% chance to ignite enemies on hit',
    apply: (_w, _add, player) => { player.burnChance += 0.30; player.burnUpgrades++; },
    requires: (_w, player) => player.burnUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_burn_2', label: '🔥 Burn Catalyst II', desc: '+30% burn chance (stacks)',
    apply: (_w, _add, player) => { player.burnChance += 0.30; player.burnUpgrades++; },
    requires: (_w, player) => player.burnUpgrades >= 1 && player.burnUpgrades < MAX_GENERIC_UPGRADES,
  },
  // ── Toxin Core ─────────────────────────────────────────────────────────────
  {
    id: 'gen_poison_1', label: '☠ Toxin Core I', desc: '+30% chance to poison enemies on hit',
    apply: (_w, _add, player) => { player.poisonChance += 0.30; player.poisonUpgrades++; },
    requires: (_w, player) => player.poisonUpgrades < MAX_GENERIC_UPGRADES,
  },
  {
    id: 'gen_poison_2', label: '☠ Toxin Core II', desc: '+30% poison chance (stacks)',
    apply: (_w, _add, player) => { player.poisonChance += 0.30; player.poisonUpgrades++; },
    requires: (_w, player) => player.poisonUpgrades >= 1 && player.poisonUpgrades < MAX_GENERIC_UPGRADES,
  },
  // ── Gravity Well weapon ────────────────────────────────────────────────────
  {
    id: 'add_gravity_well', label: '🌀 Unlock Gravity Well', desc: 'New weapon: pulls & detonates',
    apply: (_w, add) => add('Gravity Well'),
    requires: (w) => !w.some(x => x.name === 'Gravity Well') && w.length < MAX_WEAPON_SLOTS,
  },
  {
    id: 'gravity_well_damage', label: '🌀 Gravity Well – Damage Up', desc: '+35% detonation damage',
    apply: (w) => upgradeWeapon(w, 'Gravity Well', 'damage'),
    requires: (w) => w.some(x => x.name === 'Gravity Well' && !x.isEvolution) && weaponLevel(w, 'Gravity Well') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'gravity_well_radius', label: '🌀 Gravity Well – Pull Radius', desc: '+40px pull radius',
    apply: (w) => upgradeWeapon(w, 'Gravity Well', 'radius'),
    requires: (w) => w.some(x => x.name === 'Gravity Well' && !x.isEvolution) && weaponLevel(w, 'Gravity Well') < MAX_BASE_WEAPON_LEVEL,
  },
  {
    id: 'gravity_well_rate', label: '🌀 Gravity Well – Cooldown Down', desc: '−20% cooldown',
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
   * Filters the UPGRADE_POOL to currently available upgrades, shuffles them,
   * takes 3 (or fewer if not enough are available), and fires the onLevelUp
   * callback so main.ts can display the upgrade cards.
   */
  private triggerLevelUp(weapons: AnyWeapon[], addWeapon: AddWeaponFn, player: Player, removeWeapon: RemoveWeaponFn): void {
    const available = UPGRADE_POOL.filter(u => u.requires(weapons, player));
    const choices = shuffle([...available]).slice(0, 3);
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
