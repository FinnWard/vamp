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
// ──────────────────────────────────────────────────────────────────────────────

import { circlesOverlap, randomRange } from './utils';
import type { Camera } from './camera';
import type { Player } from './player';

// ─── Type definitions ─────────────────────────────────────────────────────────

/** String literal union of all possible enemy variants. */
type EnemyType = 'grunt' | 'fast' | 'tank' | 'charger' | 'ranged' | 'splitter' | 'splitterlet';

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

/** HP multiplier added linearly per minute of real-time elapsed. */
const HP_SCALE_LINEAR_PER_MIN = 0.25;
/** HP multiplier applied multiplicatively per minute of real-time elapsed. */
const HP_SCALE_MULT_PER_MIN = 1.04;

// ─── Base stat table ──────────────────────────────────────────────────────────

/**
 * Lookup table mapping each EnemyType to its base statistics.
 * HP is scaled at construction time by the EnemySpawner's hpScale() value.
 */
const ENEMY_TYPES: Record<EnemyType, EnemyStats> = {
  grunt:      { radius: 16, speed: 90,  hp: 18, damage: 12, xpValue: 1, color: '#e53935' },
  fast:       { radius: 12, speed: 155, hp: 10, damage: 8,  xpValue: 1, color: '#ff7043' },
  tank:       { radius: 26, speed: 52,  hp: 70, damage: 20, xpValue: 3, color: '#7b1fa2' },
  charger:    { radius: 15, speed: 85,  hp: 25, damage: 18, xpValue: 2, color: '#f57f17' },
  ranged:     { radius: 13, speed: 75,  hp: 12, damage: 10, xpValue: 2, color: '#00897b' },
  splitter:   { radius: 22, speed: 55,  hp: 45, damage: 15, xpValue: 3, color: '#558b2f' },
  splitterlet:{ radius: 9,  speed: 120, hp: 8,  damage: 6,  xpValue: 1, color: '#8bc34a' },
};

// ─── Enemy ────────────────────────────────────────────────────────────────────

export class Enemy {
  // World-space position
  x: number;
  y: number;

  readonly type: EnemyType;

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

  // ── Ranged-specific preferred distance ───────────────────────────────────
  /** The distance (world px) the ranged enemy tries to maintain from the player. */
  private static readonly RANGED_PREF_DIST = 220;

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
    const scaledHp = Math.round(stats.hp * hpMultiplier);
    this.hpMultiplier = hpMultiplier;
    this.maxHp = scaledHp;
    this.hp = scaledHp;
    this.damage = stats.damage;
    this.xpValue = stats.xpValue;
    this.color = stats.color;

    // Stagger the initial charge timer so a group of chargers doesn't all
    // dash at exactly the same moment.
    this._chargeCooldown = type === 'charger' ? 1 + Math.random() * 2 : 0;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Reduces HP; sets alive = false when HP hits zero or below. */
  takeDamage(amount: number): void {
    this.hp -= amount;
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
  update(dt: number, player: Player): void {
    if (!this.alive) return;

    // Slow recovery: creep slowMultiplier back toward 1.0 over time
    if (this.slowMultiplier < 1.0) {
      this.slowMultiplier = Math.min(1.0, this.slowMultiplier + dt * 1.5);
    }

    // Direction vector toward the player (normalised)
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ndx = dist > 0 ? dx / dist : 0;
    const ndy = dist > 0 ? dy / dist : 0;

    // Dispatch to per-type movement logic
    if (this.type === 'charger') {
      this._updateCharger(dt, ndx, ndy);
    } else if (this.type === 'ranged') {
      this._updateRanged(dt, dist, ndx, ndy);
    } else {
      // Standard homing movement (grunt, fast, tank, splitter, splitterlet)
      const effectiveSpeed = Math.min(this.speed, MAX_ENEMY_SPEED) * this.slowMultiplier;
      this.x += ndx * effectiveSpeed * dt;
      this.y += ndy * effectiveSpeed * dt;
    }

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
    } else {
      this._drawTank(ctx);
    }

    // HP bar (drawn in local space, above the sprite)
    const barW = this.radius * 2;
    const barH = 3;
    const bx = -this.radius;             // left edge aligned with collision circle
    const by = -this.radius - 7;         // above the sprite
    ctx.fillStyle = '#1a1a2e';           // dark background track
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = '#ff1744';           // red fill proportional to remaining HP
    ctx.fillRect(bx, by, Math.round(barW * (this.hp / this.maxHp)), barH);

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
}

// ─── EnemySpawner ─────────────────────────────────────────────────────────────
// Manages the wave / spawn system.  Each frame it advances an internal timer
// and spawns batches of enemies when the timer fires.  Both the spawn interval
// and the batch count tighten over time so the game gets harder as it goes on.

export class EnemySpawner {
  /** All currently active (alive) enemies plus enemies that died this frame
   *  (dead ones are removed by collectDead()). */
  enemies: Enemy[] = [];

  /** Total time elapsed since the game started (seconds). */
  elapsed: number = 0;

  /** Accumulator for the next spawn batch. */
  private timer: number = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
  ) {}

  // ── Difficulty curves ──────────────────────────────────────────────────────

  /**
   * Seconds between spawns.  Starts at 0.9 s and floors at 0.2 s.
   * Decreasing linearly over time makes early-game calmer.
   */
  private spawnInterval(): number {
    return Math.max(0.2, 0.9 - this.elapsed * 0.007);
  }

  /**
   * Number of enemies per batch.  Starts at 1 and grows by 1 every 20 seconds.
   * Together with the tightening interval, this creates escalating pressure.
   */
  private spawnCount(): number {
    return Math.floor(1 + this.elapsed / 20);
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
   * Spawns enemies outside the visible screen area.
   * Randomly selects one of the four edges (top / bottom / left / right),
   * then picks a position along that edge so enemies approach from all sides.
   * A margin of 80 px keeps enemies just off-screen at spawn time.
   */
  private spawnPosition(player: Player): { x: number; y: number } {
    const margin = 80;
    const hw = this.canvas.width / 2 + margin;
    const hh = this.canvas.height / 2 + margin;
    const side = Math.floor(Math.random() * 4);
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

  // ── Per-frame logic ────────────────────────────────────────────────────────

  /**
   * Advances elapsed time, fires spawn batches as the timer accumulates, and
   * updates every live enemy.  The while loop handles the edge case where dt
   * is large enough to trigger more than one spawn batch in a single frame.
   */
  update(dt: number, player: Player): void {
    this.elapsed += dt;
    this.timer += dt;

    const interval = this.spawnInterval();
    const scale    = this.hpScale();
    while (this.timer >= interval) {
      this.timer -= interval;
      const count = this.spawnCount();
      for (let i = 0; i < count; i++) {
        const pos = this.spawnPosition(player);
        this.enemies.push(new Enemy(pos.x, pos.y, this.pickType(), scale));
      }
    }

    // Update all enemies (alive or freshly-dead this frame)
    for (const e of this.enemies) {
      e.update(dt, player);
    }
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
