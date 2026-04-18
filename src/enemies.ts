// ─── enemies.ts ───────────────────────────────────────────────────────────────
// Defines all enemy types, their base stats, per-type AI behaviour, pixel-art
// sprites, and the EnemySpawner that creates and manages them.
//
// Enemy types
// ────────────
//   grunt       — basic homing enemy, balanced stats
//   fast        — small & quick dart-shaped enemy
//   tank        — large, slow, high HP boss-like enemy
//   charger     — patrols slowly then dashes at the player in bursts
//   ranged      — maintains a preferred distance, strafes at close range
//   splitter    — on death splits into two splitterlets
//   splitterlet — small fast child of the splitter
//   boss        — massive elite enemy spawning every 120 s; has its own HP bar
//
// HP scaling
// ───────────
// Enemy HP scales over time using a combined linear + multiplicative formula
// so later waves are meaningfully tougher without becoming immediately lethal.
//
// Slow mechanic
// ──────────────
// Weapons like Cryo Beam set enemy.slowMultiplier < 1.  The multiplier
// recovers toward 1.0 at a fixed rate each frame (1.5 × dt per second).
// All movement calculations multiply speed by this value.
//
// DoT mechanic
// ─────────────
// Call applyBurn() or applyPoison() to start a damage-over-time effect.
// The DoT ticks every DOT_TICK_INTERVAL seconds for its remaining duration.
// Damage events from DoT ticks are appended to the exported damageEvents array
// so main.ts can spawn floating damage numbers.
//
// Boss spawning
// ─────────────
// EnemySpawner.bossTimer accumulates elapsed seconds.  Every BOSS_SPAWN_INTERVAL
// seconds a boss is spawned at a random off-screen position.  At most one boss
// can be active at a time (additional spawns are skipped while one is alive).
// ──────────────────────────────────────────────────────────────────────────────

import { circlesOverlap, randomRange } from './utils';
import type { Camera } from './camera';
import type { Player } from './player';

// ─── Type definitions ─────────────────────────────────────────────────────────

/** String literal union of all possible enemy variants. */
type EnemyType = 'grunt' | 'fast' | 'tank' | 'charger' | 'ranged' | 'splitter' | 'splitterlet' | 'boss';

/** Base stat block defined once per enemy type. */
interface EnemyStats {
  radius: number;   // collision circle radius (world px)
  speed: number;    // movement speed (world px/s)
  hp: number;       // base HP before time-scaling
  damage: number;   // damage dealt per second of overlap with the player
  xpValue: number;  // XP gems dropped on death
  color: string;    // primary CSS color (also used for fallback drawing)
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard cap on enemy movement speed (px/s) — keeps fast enemies from being extreme. */
const MAX_ENEMY_SPEED = 160;
/** Hard cap on the total number of live enemies (boss excluded). */
const MAX_ENEMIES = 60;

/** Radius (px) within which an enemy repels its neighbours to prevent blob clumping. */
const REPULSION_RADIUS = 60;
/** Fraction of an enemy's base speed applied as a separation force away from nearby enemies. */
const REPULSION_STRENGTH = 0.35;

/** HP multiplier added linearly per minute of real-time elapsed. */
const HP_SCALE_LINEAR_PER_MIN = 0.25;
/** HP multiplier applied multiplicatively per minute of real-time elapsed. */
const HP_SCALE_MULT_PER_MIN = 1.04;

/** Seconds between boss spawns. */
const BOSS_SPAWN_INTERVAL = 120;

/** Seconds between each DoT damage tick. */
const DOT_TICK_INTERVAL = 0.5;

/** Minimum angle (degrees) of the random spawn-direction jitter applied to each enemy. */
const SPAWN_JITTER_MIN_DEG = 15;
/** Maximum angle (degrees) of the random spawn-direction jitter applied to each enemy. */
const SPAWN_JITTER_MAX_DEG = 25;
/** Seconds over which the spawn-direction jitter linearly fades to zero. */
const SPAWN_FAN_DURATION = 2.0;

// ─── Damage event bus ─────────────────────────────────────────────────────────

/** Filled by Enemy.takeDamage() each frame; main.ts drains this for floating numbers. */
export interface DamageEvent {
  x: number;
  y: number;
  amount: number;
  isBoss: boolean;
}

export const damageEvents: DamageEvent[] = [];

// ─── Module-level DoT chance state (set from main.ts each frame) ──────────────

let _burnChance   = 0;
let _poisonChance = 0;

/**
 * Called from main.ts each frame with the player's current DoT chance stats.
 * Enemies use these values in takeDamage() to conditionally apply status effects.
 */
export function setDoTChances(burnChance: number, poisonChance: number): void {
  _burnChance   = burnChance;
  _poisonChance = poisonChance;
}

// ─── Difficulty multiplier (set from main.ts once on game start) ──────────────

let _diffHpMult     = 1.0;
let _diffDamageMult = 1.0;
let _diffSpeedMult  = 1.0;

/** Set enemy HP / damage / spawn-rate multipliers for the chosen difficulty. */
export function setDifficultyMultipliers(hp: number, damage: number, speed: number): void {
  _diffHpMult     = hp;
  _diffDamageMult = damage;
  _diffSpeedMult  = speed;
}

// ─── Base stat table ──────────────────────────────────────────────────────────

/**
 * Lookup table mapping each EnemyType to its base statistics.
 * HP is scaled at construction time by the EnemySpawner's hpScale() value.
 */
const ENEMY_TYPES: Record<EnemyType, EnemyStats> = {
  grunt:      { radius: 16, speed: 90,  hp: 72,  damage: 36, xpValue: 2,  color: '#e53935' },
  fast:       { radius: 12, speed: 155, hp: 40,  damage: 24, xpValue: 2,  color: '#ff7043' },
  tank:       { radius: 26, speed: 52,  hp: 280, damage: 60, xpValue: 6,  color: '#7b1fa2' },
  charger:    { radius: 15, speed: 85,  hp: 100, damage: 54, xpValue: 4,  color: '#f57f17' },
  ranged:     { radius: 13, speed: 75,  hp: 48,  damage: 30, xpValue: 4,  color: '#00897b' },
  splitter:   { radius: 22, speed: 55,  hp: 180, damage: 44, xpValue: 6,  color: '#558b2f' },
  splitterlet:{ radius: 9,  speed: 120, hp: 32,  damage: 18, xpValue: 2,  color: '#8bc34a' },
  boss:       { radius: 42, speed: 40,  hp: 2400,damage: 90, xpValue: 40, color: '#b71c1c' },
};

// ─── Enemy ────────────────────────────────────────────────────────────────────

export class Enemy {
  // World-space position
  x: number;
  y: number;

  readonly type: EnemyType;

  /** True when this enemy is the special boss type. */
  get isBoss(): boolean { return this.type === 'boss'; }

  /** False once HP reaches 0. EnemySpawner.collectDead() removes dead enemies. */
  alive: boolean = true;

  readonly radius: number;
  readonly speed: number;

  /**
   * Speed multiplier applied every frame.
   * Set to < 1 by cryo weapons to slow the enemy.
   * Recovers toward 1.0 at rate 1.5 per second.
   */
  slowMultiplier: number = 1.0;

  readonly maxHp: number;
  hp: number;

  /** Damage per second applied while the enemy overlaps the player. */
  readonly damage: number;

  /** XP value of gems dropped on death. */
  readonly xpValue: number;

  /** Primary CSS color used in all sprite drawing methods. */
  readonly color: string;

  /**
   * Cosmetic sprite variant index (0 = default palette, 1 = alternate palette).
   * Roughly 30% of enemies spawn with variant 1 so the field isn't monotone.
   */
  readonly variant: number;

  /**
   * Stores the HP multiplier used at construction so splitter children can
   * inherit the same scaling as their parent.
   */
  readonly hpMultiplier: number;

  // ── Charger-specific state ────────────────────────────────────────────────
  /** Seconds until the charger's next dash. */
  private _chargeCooldown: number;
  /** Seconds remaining in the current active dash (0 = not charging). */
  private _chargeActive: number = 0;
  /** Normalised direction locked at the start of the charge. */
  private _chargeVelX: number = 0;
  private _chargeVelY: number = 0;

  // ── Spawn-direction jitter ────────────────────────────────────────────────
  /**
   * Random angle offset (radians) applied to the initial movement bearing.
   * Positive or negative with equal probability; zero for the boss type.
   * Fades linearly to zero over SPAWN_FAN_DURATION seconds.
   */
  private readonly _spawnOffsetAngle: number;
  /** Seconds elapsed since this enemy was created; used to fade the jitter. */
  private _spawnAge: number = 0;

  // ── Ranged-specific preferred distance ───────────────────────────────────
  /** The distance (world px) the ranged enemy tries to maintain from the player. */
  private static readonly RANGED_PREF_DIST = 220;

  // ── DoT state ─────────────────────────────────────────────────────────────
  /** Remaining seconds of burn damage. 0 = not burning. */
  burnTimer: number = 0;
  /** Damage-per-second while burning. */
  burnDps: number = 0;
  /** Countdown to next burn tick. */
  private _burnTickTimer: number = 0;

  /** Remaining seconds of poison damage. 0 = not poisoned. */
  poisonTimer: number = 0;
  /** Damage-per-second while poisoned. */
  poisonDps: number = 0;
  /** Countdown to next poison tick. */
  private _poisonTickTimer: number = 0;

  constructor(x: number, y: number, type: EnemyType = 'grunt', hpMultiplier: number = 1) {
    this.x = x;
    this.y = y;
    this.type = type;
    // ~30% chance of alternate visual variant
    this.variant = Math.random() < 0.3 ? 1 : 0;

    const stats = ENEMY_TYPES[type];
    this.radius = stats.radius;
    // Cap speed at MAX_ENEMY_SPEED at construction too (defense in depth)
    this.speed = Math.min(stats.speed, MAX_ENEMY_SPEED);
    const scaledHp = Math.round(stats.hp * hpMultiplier * _diffHpMult);
    this.hpMultiplier = hpMultiplier;
    this.maxHp = scaledHp;
    this.hp = scaledHp;
    this.damage = stats.damage * _diffDamageMult;
    this.xpValue = stats.xpValue;
    this.color = stats.color;

    // Stagger the initial charge timer so a group of chargers doesn't all
    // dash at exactly the same moment.
    this._chargeCooldown = type === 'charger' ? 1 + Math.random() * 2 : 0;

    // Random spawn-direction jitter (±15–25°), absent for the boss so it
    // always charges straight at the player for maximum drama.
    if (type === 'boss') {
      this._spawnOffsetAngle = 0;
    } else {
      const mag = (SPAWN_JITTER_MIN_DEG + Math.random() * (SPAWN_JITTER_MAX_DEG - SPAWN_JITTER_MIN_DEG)) * Math.PI / 180;
      this._spawnOffsetAngle = Math.random() < 0.5 ? mag : -mag;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Apply a burn DoT effect.  Stacks by taking the higher DPS / longer duration.
   *
   * @param dps      Damage per second
   * @param duration Seconds the burn lasts
   */
  applyBurn(dps: number, duration: number): void {
    this.burnDps   = Math.max(this.burnDps, dps);
    this.burnTimer = Math.max(this.burnTimer, duration);
  }

  /**
   * Apply a poison DoT effect.  Stacks by taking the higher DPS / longer duration.
   */
  applyPoison(dps: number, duration: number): void {
    this.poisonDps   = Math.max(this.poisonDps, dps);
    this.poisonTimer = Math.max(this.poisonTimer, duration);
  }

  /** Reduces HP; sets alive = false when HP hits zero or below.
   *  Conditionally applies Burn / Poison based on the global DoT chances. */
  takeDamage(amount: number): void {
    this.hp -= amount;
    damageEvents.push({ x: this.x, y: this.y, amount, isBoss: this.isBoss });
    // Apply DoT status effects based on player's accumulated upgrade stats
    if (_burnChance > 0 && Math.random() < _burnChance) {
      this.applyBurn(12, 3.0);
    }
    if (_poisonChance > 0 && Math.random() < _poisonChance) {
      this.applyPoison(8, 5.0);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  /**
   * Per-frame update.
   *
   * Dispatches to the appropriate AI handler based on type, then checks for
   * player overlap and applies contact damage.  Contact damage is multiplied
   * by dt so it represents "damage per second" even though it's applied every frame.
   */
  update(dt: number, player: Player, allEnemies: Enemy[]): void {
    if (!this.alive) return;

    // ── DoT tick processing ──────────────────────────────────────────────────
    if (this.burnTimer > 0) {
      this.burnTimer -= dt;
      this._burnTickTimer -= dt;
      if (this._burnTickTimer <= 0) {
        this._burnTickTimer = DOT_TICK_INTERVAL;
        const dmg = this.burnDps * DOT_TICK_INTERVAL;
        this.hp -= dmg;
        damageEvents.push({ x: this.x, y: this.y, amount: dmg, isBoss: this.isBoss });
        if (this.hp <= 0) { this.hp = 0; this.alive = false; return; }
      }
      if (this.burnTimer <= 0) { this.burnDps = 0; this._burnTickTimer = 0; }
    }

    if (this.poisonTimer > 0) {
      this.poisonTimer -= dt;
      this._poisonTickTimer -= dt;
      if (this._poisonTickTimer <= 0) {
        this._poisonTickTimer = DOT_TICK_INTERVAL;
        const dmg = this.poisonDps * DOT_TICK_INTERVAL;
        this.hp -= dmg;
        damageEvents.push({ x: this.x, y: this.y, amount: dmg, isBoss: this.isBoss });
        if (this.hp <= 0) { this.hp = 0; this.alive = false; return; }
      }
      if (this.poisonTimer <= 0) { this.poisonDps = 0; this._poisonTickTimer = 0; }
    }

    // Slow recovery: creep slowMultiplier back toward 1.0 over time
    if (this.slowMultiplier < 1.0) {
      this.slowMultiplier = Math.min(1.0, this.slowMultiplier + dt * 1.5);
    }

    // Advance the spawn-age clock (used to fade out the bearing jitter).
    this._spawnAge += dt;

    // Direction vector toward the player (normalised)
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let ndx = dist > 0 ? dx / dist : 0;
    let ndy = dist > 0 ? dy / dist : 0;

    // Apply the spawn-direction jitter, fading linearly to zero over
    // SPAWN_FAN_DURATION seconds so enemies arc outward at first then
    // curve back toward the player.
    if (this._spawnAge < SPAWN_FAN_DURATION) {
      const angle = this._spawnOffsetAngle * (1 - this._spawnAge / SPAWN_FAN_DURATION);
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const rx = ndx * cosA - ndy * sinA;
      const ry = ndx * sinA + ndy * cosA;
      ndx = rx;
      ndy = ry;
    }

    // ── Enemy-enemy separation (boid repulsion) ──────────────────────────────
    // Accumulate a gentle push away from every nearby alive enemy to prevent
    // the pack from collapsing into a single blob.
    let repX = 0;
    let repY = 0;
    for (const other of allEnemies) {
      if (other === this || !other.alive) continue;
      const ox = this.x - other.x;
      const oy = this.y - other.y;
      const d2 = ox * ox + oy * oy;
      if (d2 < REPULSION_RADIUS * REPULSION_RADIUS && d2 > 0) {
        const d = Math.sqrt(d2);
        // Weight by proximity: closer neighbours push harder (linear falloff)
        const weight = 1 - d / REPULSION_RADIUS;
        repX += (ox / d) * weight;
        repY += (oy / d) * weight;
      }
    }
    // Normalise the accumulated repulsion vector (if non-zero)
    const repLen = Math.sqrt(repX * repX + repY * repY);
    const rnx = repLen > 0 ? repX / repLen : 0;
    const rny = repLen > 0 ? repY / repLen : 0;
    const repSpeed = Math.min(this.speed, MAX_ENEMY_SPEED) * REPULSION_STRENGTH * this.slowMultiplier;

    // Dispatch to per-type movement logic
    if (this.type === 'charger') {
      this._updateCharger(dt, ndx, ndy);
    } else if (this.type === 'ranged') {
      this._updateRanged(dt, dist, ndx, ndy);
    } else {
      // Standard homing movement (grunt, fast, tank, splitter, splitterlet, boss)
      const effectiveSpeed = Math.min(this.speed, MAX_ENEMY_SPEED) * this.slowMultiplier;
      this.x += ndx * effectiveSpeed * dt;
      this.y += ndy * effectiveSpeed * dt;
    }

    // Apply the separation nudge on top of whatever movement was applied above
    this.x += rnx * repSpeed * dt;
    this.y += rny * repSpeed * dt;

    // Contact damage: applied as long as the enemy overlaps the player
    if (circlesOverlap(this.x, this.y, this.radius, player.x, player.y, player.radius)) {
      player.takeDamage(this.damage * dt);
    }
  }

  // ── Per-type AI ────────────────────────────────────────────────────────────

  /**
   * Charger AI: two-phase behaviour.
   *   • Patrol phase: move slowly toward player, count down _chargeCooldown.
   *   • Dash phase:   sprint in the locked direction for 0.5 s, then reset.
   *
   * During the dash we intentionally allow the speed to exceed MAX_ENEMY_SPEED
   * (up to 2× the cap) because that burst is the core threat of this enemy type.
   */
  private _updateCharger(dt: number, ndx: number, ndy: number): void {
    if (this._chargeActive > 0) {
      // Intentionally exceeds MAX_ENEMY_SPEED during the burst — the whole point of
      // the charger type is this brief high-speed lunge; capping it would remove the threat.
      const effectiveSpeed = Math.min(this.speed * 3.5, MAX_ENEMY_SPEED * 2) * this.slowMultiplier;
      this.x += this._chargeVelX * effectiveSpeed * dt;
      this.y += this._chargeVelY * effectiveSpeed * dt;
      this._chargeActive -= dt;
    } else {
      // Patrol slowly toward player
      const effectiveSpeed = Math.min(this.speed * 0.6, MAX_ENEMY_SPEED) * this.slowMultiplier;
      this.x += ndx * effectiveSpeed * dt;
      this.y += ndy * effectiveSpeed * dt;
      // Count down to next charge
      this._chargeCooldown -= dt;
      if (this._chargeCooldown <= 0) {
        // Lock direction toward player and start charge
        this._chargeVelX = ndx;
        this._chargeVelY = ndy;
        this._chargeActive = 0.5;                      // dash lasts 0.5 s
        this._chargeCooldown = 2.5 + Math.random() * 1.5; // 2.5–4 s until next
      }
    }
  }

  /**
   * Ranged AI: three zones relative to RANGED_PREF_DIST.
   *   • Too close  (< pref − 30): back away from player.
   *   • Too far    (> pref + 30): advance toward player.
   *   • Comfortable (within ±30): strafe perpendicular to the player direction.
   */
  private _updateRanged(dt: number, dist: number, ndx: number, ndy: number): void {
    const pref = Enemy.RANGED_PREF_DIST;
    let moveMult: number;
    if (dist < pref - 30) {
      // Too close — back away
      moveMult = -1;
    } else if (dist > pref + 30) {
      // Too far — close in
      moveMult = 1;
    } else {
      // In comfortable range — strafe slightly (use perpendicular)
      moveMult = 0;
      const perpX = -ndy; // 90° rotation of the normalised direction
      const perpY = ndx;
      const effectiveSpeed = Math.min(this.speed * 0.4, MAX_ENEMY_SPEED) * this.slowMultiplier;
      this.x += perpX * effectiveSpeed * dt;
      this.y += perpY * effectiveSpeed * dt;
      return; // early out — no forward/backward movement needed
    }
    const effectiveSpeed = Math.min(this.speed, MAX_ENEMY_SPEED) * this.slowMultiplier;
    this.x += ndx * moveMult * effectiveSpeed * dt;
    this.y += ndy * moveMult * effectiveSpeed * dt;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  /**
   * Draws the enemy sprite at its world position then overlays an HP bar.
   * All sprites are built from fillRect() calls — no image assets needed.
   */
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);

    ctx.save();
    ctx.translate(s.x, s.y);

    // Dispatch to the correct sprite drawing method
    if (this.type === 'grunt') {
      this._drawGrunt(ctx);
    } else if (this.type === 'fast') {
      this._drawFast(ctx);
    } else if (this.type === 'charger') {
      this._drawCharger(ctx);
    } else if (this.type === 'ranged') {
      this._drawRanged(ctx);
    } else if (this.type === 'splitter') {
      this._drawSplitter(ctx);
    } else if (this.type === 'splitterlet') {
      this._drawSplitterlet(ctx);
    } else if (this.type === 'boss') {
      this._drawBoss(ctx);
    } else {
      this._drawTank(ctx);
    }

    // HP bar (drawn in local space, above the sprite)
    // Boss uses a thicker bar; regular enemies use a thin 3 px bar
    const barW = this.type === 'boss' ? this.radius * 2.5 : this.radius * 2;
    const barH = this.type === 'boss' ? 6 : 3;
    const bx = -barW / 2;
    const by = -this.radius - (this.type === 'boss' ? 12 : 7);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(bx, by, barW, barH);
    const hpColor = this.type === 'boss' ? '#ff1744' : '#ff1744';
    ctx.fillStyle = hpColor;
    ctx.fillRect(bx, by, Math.round(barW * (this.hp / this.maxHp)), barH);

    // DoT indicators: small colored dots above the HP bar
    if (this.burnTimer > 0 || this.poisonTimer > 0) {
      let dotX = bx;
      if (this.burnTimer > 0) {
        ctx.fillStyle = '#ff6d00';
        ctx.fillRect(dotX, by - 5, 4, 4);
        dotX += 6;
      }
      if (this.poisonTimer > 0) {
        ctx.fillStyle = '#76ff03';
        ctx.fillRect(dotX, by - 5, 4, 4);
      }
    }

    ctx.restore();
  }

  // ── Sprite methods ─────────────────────────────────────────────────────────
  // All draw in local space (0,0 = centre) using ctx.translate applied by draw().
  // Two color variants are used to add visual variety; variant 1 has a slightly
  // different hue chosen from the same family as variant 0.

  private _drawGrunt(ctx: CanvasRenderingContext2D): void {
    // Space invader style grunt — variant 1 uses a blue-red palette
    const main   = this.variant === 1 ? '#c62828' : '#e53935';
    const light  = this.variant === 1 ? '#ef9a9a' : '#ef5350';
    const dark   = this.variant === 1 ? '#7f0000' : '#b71c1c';
    const eyeW   = this.variant === 1 ? '#ffcdd2' : '#ffcdd2';
    // Antennae
    ctx.fillStyle = light;
    ctx.fillRect(-7, -14, 3, 5);
    ctx.fillRect(4, -14, 3, 5);
    // Head / body
    ctx.fillStyle = main;
    ctx.fillRect(-8, -9, 16, 12);
    // Claws
    ctx.fillStyle = light;
    ctx.fillRect(-12, -4, 5, 6);
    ctx.fillRect(7, -4, 5, 6);
    // Feet
    ctx.fillStyle = dark;
    ctx.fillRect(-10, 3, 4, 4);
    ctx.fillRect(-2, 3, 4, 4);
    ctx.fillRect(6, 3, 4, 4);
    // Eyes (white)
    ctx.fillStyle = eyeW;
    ctx.fillRect(-6, -7, 4, 4);
    ctx.fillRect(2, -7, 4, 4);
    // Pupils (dark)
    ctx.fillStyle = '#4a0000';
    ctx.fillRect(-5, -6, 2, 2);
    ctx.fillRect(3, -6, 2, 2);
  }

  private _drawFast(ctx: CanvasRenderingContext2D): void {
    // Dart-shaped fast enemy — variant 1 is a yellow-orange palette
    const main   = this.variant === 1 ? '#ffa000' : '#ff7043';
    const body   = this.variant === 1 ? '#ff8f00' : '#ff5722';
    const fin    = this.variant === 1 ? '#ffca28' : '#ff8a65';
    const engine = this.variant === 1 ? '#e65100' : '#bf360c';
    const eye    = this.variant === 1 ? '#fff9c4' : '#ffccbc';
    ctx.fillStyle = main;
    // Nose
    ctx.fillRect(-2, -11, 4, 4);
    ctx.fillStyle = body;
    ctx.fillRect(-1, -14, 2, 4);
    // Body
    ctx.fillRect(-3, -7, 6, 14);
    // Side fins
    ctx.fillStyle = fin;
    ctx.fillRect(-7, -3, 4, 7);
    ctx.fillRect(3, -3, 4, 7);
    // Engine
    ctx.fillStyle = engine;
    ctx.fillRect(-3, 7, 6, 3);
    // Eye slit
    ctx.fillStyle = eye;
    ctx.fillRect(-2, -5, 4, 2);
  }

  private _drawTank(ctx: CanvasRenderingContext2D): void {
    // Large blocky alien boss — variant 1 is deep blue instead of purple
    const armor  = this.variant === 1 ? '#1565c0' : '#6a1b9a';
    const body   = this.variant === 1 ? '#1976d2' : '#7b1fa2';
    const turret = this.variant === 1 ? '#1e88e5' : '#8e24aa';
    const barrel = this.variant === 1 ? '#42a5f5' : '#ab47bc';
    const core   = this.variant === 1 ? '#40c4ff' : '#e040fb';
    const glow   = this.variant === 1 ? '#e1f5fe' : '#f8bbd0';
    const eyeL   = this.variant === 1 ? '#90caf9' : '#ce93d8';
    const eyeD   = this.variant === 1 ? '#0d47a1' : '#4a148c';
    ctx.fillStyle = armor;
    // Side armor plates
    ctx.fillRect(-14, -6, 5, 10);
    ctx.fillRect(9, -6, 5, 10);
    // Main body
    ctx.fillStyle = body;
    ctx.fillRect(-9, -10, 18, 18);
    // Turret top
    ctx.fillStyle = turret;
    ctx.fillRect(-6, -14, 12, 5);
    ctx.fillStyle = barrel;
    ctx.fillRect(-2, -17, 4, 4);
    // Center core
    ctx.fillStyle = core;
    ctx.fillRect(-4, -4, 8, 8);
    // Core glow pixel
    ctx.fillStyle = glow;
    ctx.fillRect(-2, -2, 4, 4);
    // Eyes
    ctx.fillStyle = eyeL;
    ctx.fillRect(-7, -6, 4, 3);
    ctx.fillRect(3, -6, 4, 3);
    ctx.fillStyle = eyeD;
    ctx.fillRect(-6, -5, 2, 1);
    ctx.fillRect(4, -5, 2, 1);
  }

  private _drawCharger(ctx: CanvasRenderingContext2D): void {
    // Wedge / arrowhead shape — orange with a flared wing and charge indicator
    const main   = this.variant === 1 ? '#e65100' : '#f57f17';
    const wing   = this.variant === 1 ? '#ff8f00' : '#ffa000';
    const tip    = this.variant === 1 ? '#fff3e0' : '#ffe0b2';
    const tail   = this.variant === 1 ? '#bf360c' : '#e65100';
    // Center glow is bright white when actively charging, amber otherwise
    const charge = this._chargeActive > 0 ? '#fff9c4' : '#ff6f00';
    // Wings spread wide
    ctx.fillStyle = wing;
    ctx.fillRect(-13, 0, 6, 5);
    ctx.fillRect(7, 0, 6, 5);
    // Body wedge
    ctx.fillStyle = main;
    ctx.fillRect(-5, -12, 10, 20);
    // Nose tip
    ctx.fillStyle = tip;
    ctx.fillRect(-2, -15, 4, 4);
    // Tail
    ctx.fillStyle = tail;
    ctx.fillRect(-4, 8, 8, 4);
    // Charge glow in center — bright when charging
    ctx.fillStyle = charge;
    ctx.fillRect(-3, -4, 6, 6);
    // Eye
    ctx.fillStyle = '#4e342e';
    ctx.fillRect(-3, -9, 2, 2);
    ctx.fillRect(1, -9, 2, 2);
  }

  private _drawRanged(ctx: CanvasRenderingContext2D): void {
    // Angular / crystalline teal shape
    const main  = this.variant === 1 ? '#004d40' : '#00695c';
    const light = this.variant === 1 ? '#00897b' : '#26a69a';
    const tip   = this.variant === 1 ? '#80cbc4' : '#b2dfdb';
    const core  = this.variant === 1 ? '#e0f2f1' : '#ffffff';
    // Outer hexagon approximated with rects
    ctx.fillStyle = main;
    ctx.fillRect(-4, -13, 8, 4);
    ctx.fillRect(-4, 9, 8, 4);
    ctx.fillStyle = light;
    ctx.fillRect(-11, -7, 22, 14);
    ctx.fillStyle = main;
    ctx.fillRect(-8, -11, 16, 22);
    // Inner diamond
    ctx.fillStyle = light;
    ctx.fillRect(-5, -5, 10, 10);
    // Core crystal
    ctx.fillStyle = core;
    ctx.fillRect(-2, -2, 4, 4);
    // Tip accents
    ctx.fillStyle = tip;
    ctx.fillRect(-2, -12, 4, 2);
    ctx.fillRect(-2, 10, 4, 2);
  }

  private _drawSplitter(ctx: CanvasRenderingContext2D): void {
    // Segmented green blob that looks like it could split
    const main  = this.variant === 1 ? '#33691e' : '#558b2f';
    const light = this.variant === 1 ? '#558b2f' : '#7cb342';
    const dark  = this.variant === 1 ? '#1b5e20' : '#33691e';
    const crack = '#c8e6c9'; // light line down the centre hinting at the split
    // Outer body
    ctx.fillStyle = main;
    ctx.fillRect(-11, -11, 22, 22);
    // Corner bevels (dark)
    ctx.fillStyle = dark;
    ctx.fillRect(-11, -11, 4, 4);
    ctx.fillRect(7, -11, 4, 4);
    ctx.fillRect(-11, 7, 4, 4);
    ctx.fillRect(7, 7, 4, 4);
    // Highlight
    ctx.fillStyle = light;
    ctx.fillRect(-7, -9, 14, 14);
    // Crack line down center (shows it will split)
    ctx.fillStyle = crack;
    ctx.fillRect(-1, -10, 2, 20);
    // Eyes
    ctx.fillStyle = '#f1f8e9';
    ctx.fillRect(-6, -5, 3, 3);
    ctx.fillRect(3, -5, 3, 3);
    ctx.fillStyle = '#1b5e20';
    ctx.fillRect(-5, -4, 1, 1);
    ctx.fillRect(4, -4, 1, 1);
  }

  private _drawSplitterlet(ctx: CanvasRenderingContext2D): void {
    // Small version of the splitter, no crack
    const main  = this.variant === 1 ? '#558b2f' : '#7cb342';
    const light = this.variant === 1 ? '#7cb342' : '#9ccc65';
    const dark  = this.variant === 1 ? '#33691e' : '#558b2f';
    ctx.fillStyle = main;
    ctx.fillRect(-6, -6, 12, 12);
    // Corner bevels
    ctx.fillStyle = dark;
    ctx.fillRect(-6, -6, 2, 2);
    ctx.fillRect(4, -6, 2, 2);
    ctx.fillRect(-6, 4, 2, 2);
    ctx.fillRect(4, 4, 2, 2);
    // Highlight
    ctx.fillStyle = light;
    ctx.fillRect(-4, -4, 8, 8);
    // Single eye
    ctx.fillStyle = '#f1f8e9';
    ctx.fillRect(-2, -3, 4, 3);
    ctx.fillStyle = '#1b5e20';
    ctx.fillRect(-1, -2, 2, 1);
  }

  private _drawBoss(ctx: CanvasRenderingContext2D): void {
    // Massive armored boss — a large menacing ship with layered armor plates
    const armor  = '#7f0000';
    const body   = '#b71c1c';
    const accent = '#e53935';
    const core   = '#ff1744';
    const glow   = '#ff8a80';
    const cannon = '#4e342e';
    const eye    = '#ff6d00';

    // Outer armor ring
    ctx.fillStyle = armor;
    ctx.fillRect(-20, -20, 40, 6);   // top
    ctx.fillRect(-20, 14, 40, 6);    // bottom
    ctx.fillRect(-20, -14, 6, 28);   // left
    ctx.fillRect(14, -14, 6, 28);    // right

    // Main body
    ctx.fillStyle = body;
    ctx.fillRect(-14, -14, 28, 28);

    // Inner accent panels
    ctx.fillStyle = accent;
    ctx.fillRect(-10, -10, 8, 8);
    ctx.fillRect(2, -10, 8, 8);
    ctx.fillRect(-10, 2, 8, 8);
    ctx.fillRect(2, 2, 8, 8);

    // Core pulsing element (bright center)
    ctx.fillStyle = core;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.fillStyle = glow;
    ctx.fillRect(-3, -3, 6, 6);

    // Cannon barrels (top)
    ctx.fillStyle = cannon;
    ctx.fillRect(-18, -28, 6, 14);
    ctx.fillRect(12, -28, 6, 14);
    ctx.fillRect(-3, -30, 6, 16);

    // Glowing eyes
    ctx.fillStyle = eye;
    ctx.fillRect(-12, -7, 5, 4);
    ctx.fillRect(7, -7, 5, 4);

    // Pulsing outer glow (fades based on HP %)
    const hpFrac = this.hp / this.maxHp;
    ctx.globalAlpha = 0.15 + hpFrac * 0.25;
    ctx.fillStyle = '#ff1744';
    ctx.fillRect(-22, -22, 44, 44);
    ctx.globalAlpha = 1;
  }
}

// ─── EnemySpawner ─────────────────────────────────────────────────────────────
// Manages the wave / spawn system.  Each frame it advances an internal timer
// and spawns batches of enemies when the timer fires.  Both the spawn interval
// and the batch count tighten over time so the game gets harder as it goes on.
// Every batch is assigned a single random edge so enemies arrive as a
// directional wave, giving the player a clear threat to react to rather than
// instant encirclement.

export class EnemySpawner {
  /** All currently active (alive) enemies plus enemies that died this frame
   *  (dead ones are removed by collectDead()). */
  enemies: Enemy[] = [];

  /** Total time elapsed since the game started (seconds). */
  elapsed: number = 0;

  /** Accumulator for the next spawn batch. */
  private timer: number = 0;

  /**
   * The screen edge used for the current wave batch (0=top, 1=bottom, 2=left,
   * 3=right).  All enemies in the same batch spawn from this edge, then a new
   * edge is chosen for the next batch so the player can react directionally.
   */
  private currentWaveSide: number = Math.floor(Math.random() * 4);

  /**
   * Boss spawn countdown.  Counts up to BOSS_SPAWN_INTERVAL every frame.
   * Public so main.ts can display it as a warning.
   */
  bossTimer: number = 0;

  /** Reference to the currently-alive boss, or null if no boss is active. */
  get activeBoss(): Enemy | null {
    return this.enemies.find(e => e.isBoss && e.alive) ?? null;
  }

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
  ) {}

  // ── Difficulty curves ──────────────────────────────────────────────────────

  /**
   * Seconds between spawns.  Base starts at 3.6 s and floors at 0.8 s
   * (before difficulty-speed multiplier is applied, which can lower it further).
   * Decreasing linearly over time makes early-game calmer.
   * Enemies spawn half as often compared to the previous rate.
   */
  private spawnInterval(): number {
    const base = Math.max(0.8, 3.6 - this.elapsed * 0.028);
    return base / _diffSpeedMult;
  }

  /**
   * Number of enemies per batch.  Starts at 1 and grows by 1 every 20 seconds.
   * Together with the tightening interval, this creates escalating pressure.
   */
  private spawnCount(): number {
    return Math.min(4, Math.floor(1 + this.elapsed / 30));
  }

  /**
   * Combined HP multiplier used when constructing new enemies.
   * Blends a linear ramp (steady early-game growth) with a per-minute
   * multiplicative factor (compounding late-game difficulty).
   */
  private hpScale(): number {
    const mins = this.elapsed / 60;
    const linear = 1 + mins * HP_SCALE_LINEAR_PER_MIN;
    const mult   = Math.pow(HP_SCALE_MULT_PER_MIN, mins);
    return linear * mult;
  }

  /**
   * Picks an enemy type weighted by elapsed time.
   * Later enemy types unlock at specific time thresholds and have a growing
   * probability of appearing until they reach their target frequency.
   */
  private pickType(): EnemyType {
    const roll = Math.random();
    if (this.elapsed > 120 && roll < 0.08) return 'ranged';
    if (this.elapsed > 90  && roll < 0.12) return 'splitter';
    if (this.elapsed > 60  && roll < 0.18) return 'charger';
    if (this.elapsed > 50  && roll < 0.28) return 'tank';
    if (this.elapsed > 12  && roll < 0.42) return 'fast';
    return 'grunt';
  }

  /**
   * Spawns enemies outside the visible screen area on the given edge.
   * A margin of 80 px keeps enemies just off-screen at spawn time.
   * @param side 0=top, 1=bottom, 2=left, 3=right
   */
  private spawnPosition(player: Player, side: number): { x: number; y: number } {
    const margin = 80;
    const hw = this.canvas.width / 2 + margin;
    const hh = this.canvas.height / 2 + margin;
    let sx: number;
    let sy: number;
    // side 0 = top, 1 = bottom, 2 = left, 3 = right
    if (side === 0)      { sx = randomRange(-hw, hw); sy = -hh; }
    else if (side === 1) { sx = randomRange(-hw, hw); sy = hh; }
    else if (side === 2) { sx = -hw; sy = randomRange(-hh, hh); }
    else                 { sx = hw;  sy = randomRange(-hh, hh); }
    // Offset is in screen space; convert to world space by adding camera (player) position
    return { x: player.x + sx, y: player.y + sy };
  }

  /**
   * Picks a new wave side that is different from the current one.
   * Advances by 1, 2, or 3 positions (each with 33 % probability) so the
   * next batch never comes from the same edge as the previous one, giving
   * varied but non-repetitive directional pressure.
   */
  private advanceWaveSide(): void {
    const next = (this.currentWaveSide + 1 + Math.floor(Math.random() * 3)) % 4;
    this.currentWaveSide = next;
  }

  // ── Per-frame logic ────────────────────────────────────────────────────────

  /**
   * Advances elapsed time, fires spawn batches as the timer accumulates, and
   * updates every live enemy.  The while loop handles the edge case where dt
   * is large enough to trigger more than one spawn batch in a single frame.
   * Also handles boss spawning every BOSS_SPAWN_INTERVAL seconds.
   *
   * Returns true if a new boss was spawned this frame (so main.ts can play sfx).
   */
  update(dt: number, player: Player): boolean {
    this.elapsed += dt;
    this.timer += dt;
    this.bossTimer += dt;

    // ── Boss spawn ──────────────────────────────────────────────────────────
    let bossSpawned = false;
    if (this.bossTimer >= BOSS_SPAWN_INTERVAL && this.activeBoss === null) {
      this.bossTimer = 0;
      const bossSide = Math.floor(Math.random() * 4);
      const pos = this.spawnPosition(player, bossSide);
      this.enemies.push(new Enemy(pos.x, pos.y, 'boss', this.hpScale()));
      bossSpawned = true;
    }

    // ── Regular enemy spawning ──────────────────────────────────────────────
    // Each batch shares a single edge so the player faces a directional wave
    // rather than being encircled from all sides simultaneously.
    const interval = this.spawnInterval();
    const scale    = this.hpScale();
    while (this.timer >= interval) {
      this.timer -= interval;
      const count = this.spawnCount();
      const side = this.currentWaveSide;
      for (let i = 0; i < count; i++) {
        if (this.enemies.filter(e => !e.isBoss).length >= MAX_ENEMIES) break;
        const pos = this.spawnPosition(player, side);
        this.enemies.push(new Enemy(pos.x, pos.y, this.pickType(), scale));
      }
      this.advanceWaveSide();
    }

    // Update all enemies (alive or freshly-dead this frame)
    for (const e of this.enemies) {
      e.update(dt, player, this.enemies);
    }

    return bossSpawned;
  }

  /**
   * Returns enemies killed this frame and removes them from the active list.
   * Splitter enemies spawn two splitterlets near their death position before
   * being returned; the splitterlets are added back to `enemies` so they
   * participate in the next update cycle.
   *
   * Called by main.ts after update() so kills can be counted and gems spawned.
   */
  collectDead(): Enemy[] {
    const dead = this.enemies.filter(e => !e.alive);
    this.enemies = this.enemies.filter(e => e.alive);

    // Splitters spawn two splitterlets on death — inherit the parent's HP scale
    for (const e of dead) {
      if (e.type === 'splitter') {
        const offsets = [{ x: -20, y: 0 }, { x: 20, y: 0 }];
        for (const off of offsets) {
          this.enemies.push(new Enemy(e.x + off.x, e.y + off.y, 'splitterlet', e.hpMultiplier));
        }
      }
    }

    return dead;
  }

  /** Draws every enemy (alive or freshly-dead this frame). */
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    for (const e of this.enemies) {
      e.draw(ctx, camera);
    }
  }
}
