// ─── gems.ts ──────────────────────────────────────────────────────────────────
// XP gems are dropped by enemies when they die.  The player collects them by
// moving within range, gaining experience points that feed the level-up system.
//
// Key mechanics
// ──────────────
// • Pull radius — gems start flying toward the player when within this radius.
//   The player can expand it via "Tractor Beam" upgrades.
// • Collect radius — once a gem is this close it is immediately collected.
// • Gem compaction — when there are many gems on screen, nearby gems
//   periodically merge to keep the count manageable.  Merged gems sum their XP
//   values and adopt a weighted-average position.
//
// Visual design
// ──────────────
// Gems are diamond shapes (path with 4 points) drawn without image assets.
// Color and size scale with XP value so rare/merged gems look more impressive.
// Gems bob up and down using a per-gem sin oscillation to give life to the field.
// ──────────────────────────────────────────────────────────────────────────────

import { randomRange } from './utils';
import type { Camera } from './camera';
import type { Player } from './player';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Gems begin homing toward the player when within this many world-px. */
const PULL_RADIUS = 60;
const PULL_RADIUS_SQ = PULL_RADIUS * PULL_RADIUS; // squared to avoid sqrt in hot-path

/** Gems are collected (disappear and grant XP) once this close. */
const COLLECT_RADIUS = 30;
const COLLECT_RADIUS_SQ = COLLECT_RADIUS * COLLECT_RADIUS;
/** Pickup collectibles use a slightly larger pickup radius so they feel fair. */
const PICKUP_COLLECT_RADIUS = 34;
const PICKUP_COLLECT_RADIUS_SQ = PICKUP_COLLECT_RADIUS * PICKUP_COLLECT_RADIUS;

/** Gem compaction kicks in above this count (runs every COMPACT_INTERVAL s). */
const COMPACT_THRESHOLD = 80;
const COMPACT_INTERVAL = 0.4;

/** Two gems can merge if their centres are within this squared distance. */
const MERGE_DIST_SQ = 55 * 55;
/** Flat heal amount granted by a repair pickup. */
const HEAL_PICKUP_AMOUNT = 35;
/** Regular-enemy chance to drop a heal pickup. */
const HEAL_PICKUP_DROP_CHANCE = 0.015;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a CSS hex color representing the gem's XP tier.
 * More valuable gems (from high-XP enemies or post-merge) glow warmer colors.
 */
function gemColor(value: number): string {
  if (value >= 25) return '#ffd740'; // gold   — boss / heavily merged
  if (value >= 10) return '#e040fb'; // magenta — splitter / multi-merge
  if (value >= 5)  return '#40c4ff'; // sky blue — tank / large
  if (value >= 2)  return '#00e5ff'; // cyan — medium
  return '#69ffdf';                  // teal-mint — basic grunt
}

/**
 * Returns a visual radius (px) that grows with XP value.
 * Capped at 26 px so even huge merged gems don't cover the screen.
 */
function gemRadius(value: number): number {
  return Math.min(6 + Math.sqrt(value) * 3.5, 26);
}

// ─── Gem ──────────────────────────────────────────────────────────────────────

export class Gem {
  /** False once the gem has been collected or merged into another gem. */
  alive = true;

  /** Visual and collision radius, derived from value. */
  radius: number;

  /** CSS color string, derived from value. */
  color: string;

  /**
   * Per-gem phase offset for the bob animation so all gems don't move in sync.
   * Randomised at construction (0–2π).
   */
  private age: number;

  constructor(
    public x: number,
    public y: number,
    /** XP value granted when the gem is collected. */
    public value: number = 1,
  ) {
    this.radius = gemRadius(value);
    this.color = gemColor(value);
    this.age = randomRange(0, Math.PI * 2); // random start phase
  }

  /**
   * Merges another gem into this one.
   * The resulting gem sits at the weighted-average position of both gems and
   * has their combined XP.  The absorbed gem should be marked dead by the caller.
   */
  absorb(other: Gem): void {
    // Weighted-average position, then update appearance
    const total = this.value + other.value;
    this.x = (this.x * this.value + other.x * other.value) / total;
    this.y = (this.y * this.value + other.y * other.value) / total;
    this.value = total;
    // Recalculate visual properties now that value has increased
    this.radius = gemRadius(this.value);
    this.color = gemColor(this.value);
  }

  /**
   * Per-frame update: advances the bob animation and handles player attraction.
   *
   * Pull logic:
   *   1. If within COLLECT_RADIUS → mark dead (collected this frame).
   *   2. Else if within pull radius → fly toward player at a fixed speed.
   *   3. Otherwise → stay still.
   *
   * The effective pull radius uses the larger of the base constant and the
   * player's (possibly upgraded) pickupRadius.
   */
  update(dt: number, player: Player): void {
    this.age += dt * 2; // bob oscillation speed

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const distSq = dx * dx + dy * dy;

    // Close enough to collect
    if (distSq < COLLECT_RADIUS_SQ) {
      this.alive = false;
      return;
    }

    // Fly toward player if within the pull zone (respects pickup radius upgrades)
    const pullRadiusSq = Math.max(PULL_RADIUS_SQ, player.pickupRadius * player.pickupRadius);
    if (distSq < pullRadiusSq) {
      const dist = Math.sqrt(distSq);
      const speed = 200; // world px/s
      this.x += (dx / dist) * speed * dt;
      this.y += (dy / dist) * speed * dt;
    }
  }

  /**
   * Draws the gem as a diamond (rotated square) with an optional glow and
   * a small triangular highlight in the top-left to simulate a gem facet.
   * Gems that are off-screen are skipped to avoid unnecessary draw calls.
   */
  draw(ctx: CanvasRenderingContext2D, camera: Camera, cw: number, ch: number): void {
    const s = camera.worldToScreen(this.x, this.y);
    const r = this.radius;

    // Frustum cull: skip if the gem's bounding box is entirely off-screen
    if (s.x < -r || s.x > cw + r || s.y < -r || s.y > ch + r) return;

    // Vertical bob: oscillates ±2 px using the per-gem age offset
    const bob = Math.sin(this.age) * 2;

    ctx.save();
    ctx.fillStyle = this.color;

    // Shadow blur is expensive — only pay for it on valuable gems
    if (this.value >= 5) {
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 12;
    }

    // Diamond shape: top → right → bottom → left
    ctx.beginPath();
    ctx.moveTo(s.x,           s.y - r + bob);       // top point
    ctx.lineTo(s.x + r * 0.7, s.y + bob);           // right point
    ctx.lineTo(s.x,           s.y + r * 0.7 + bob); // bottom point
    ctx.lineTo(s.x - r * 0.7, s.y + bob);           // left point
    ctx.closePath();
    ctx.fill();

    // Small triangular highlight in the upper-left facet (skipped for tiny gems)
    if (this.value >= 2) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(s.x - 1,       s.y - r * 0.5 + bob);
      ctx.lineTo(s.x + r * 0.3, s.y + bob * 0.5);
      ctx.lineTo(s.x,           s.y + bob);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

type PickupType = 'heal' | 'magnet';

class Pickup {
  alive = true;
  private age: number;

  constructor(
    public x: number,
    public y: number,
    public type: PickupType,
  ) {
    this.age = randomRange(0, Math.PI * 2);
  }

  update(dt: number, player: Player): PickupType | null {
    this.age += dt * 2.4;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < PICKUP_COLLECT_RADIUS_SQ) {
      this.alive = false;
      return this.type;
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, cw: number, ch: number): void {
    const s = camera.worldToScreen(this.x, this.y);
    const bob = Math.sin(this.age) * 2;
    const size = 10;
    if (s.x < -size || s.x > cw + size || s.y < -size || s.y > ch + size) return;

    ctx.save();
    if (this.type === 'heal') {
      ctx.fillStyle = '#69ff74';
      ctx.shadowColor = '#69ff74';
      ctx.shadowBlur = 12;
      ctx.fillRect(s.x - 3, s.y - 8 + bob, 6, 16);
      ctx.fillRect(s.x - 8, s.y - 3 + bob, 16, 6);
    } else {
      ctx.strokeStyle = '#00e5ff';
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y + bob, 7, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y + bob, 7, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.fillStyle = '#b2ebf2';
      ctx.fillRect(s.x - 6, s.y - 6 + bob, 4, 4);
      ctx.fillRect(s.x + 2, s.y - 6 + bob, 4, 4);
    }
    ctx.restore();
  }
}

// ─── GemManager ───────────────────────────────────────────────────────────────
// Owns the full list of live gems and drives their lifecycle.

export class GemManager {
  gems: Gem[] = [];
  pickups: Pickup[] = [];

  /** Accumulates time between compaction passes. */
  private compactTimer = 0;

  /**
   * Spawns a gem at a slightly randomised offset from the enemy's death position.
   * The offset prevents all gems from stacking at exactly the same point,
   * which would look odd and make the compaction logic too aggressive.
   */
  spawnFromEnemy(enemy: { x: number; y: number; xpValue: number }): void {
    // Scatter offset so gems don't stack exactly on enemy
    const ox = randomRange(-12, 12);
    const oy = randomRange(-12, 12);
    this.gems.push(new Gem(enemy.x + ox, enemy.y + oy, enemy.xpValue));
  }

  spawnDropsFromEnemy(enemy: { x: number; y: number; xpValue: number; isBoss: boolean }): void {
    this.spawnFromEnemy(enemy);
    if (enemy.isBoss) {
      this.spawnPickup(enemy.x - 16, enemy.y, 'heal');
      this.spawnPickup(enemy.x + 16, enemy.y, 'magnet');
      return;
    }
    if (Math.random() < HEAL_PICKUP_DROP_CHANCE) {
      this.spawnPickup(enemy.x, enemy.y, 'heal');
    }
  }

  private spawnPickup(x: number, y: number, type: PickupType): void {
    this.pickups.push(new Pickup(x + randomRange(-10, 10), y + randomRange(-10, 10), type));
  }

  private collectAllGems(): number {
    let xp = 0;
    for (const gem of this.gems) {
      if (!gem.alive) continue;
      xp += gem.value;
      gem.alive = false;
    }
    this.gems = this.gems.filter(g => g.alive);
    return xp;
  }

  /**
   * Merges spatially close gems to keep the total count manageable.
   * O(n²) — only runs when gem count exceeds COMPACT_THRESHOLD and
   * at most once every COMPACT_INTERVAL seconds.
   *
   * Algorithm: for each live gem A, check all gems B after it in the array.
   * If they're close enough, absorb B into A and mark B dead.
   * Dead gems are then filtered out in one pass at the end.
   */
  private compact(): void {
    const gems = this.gems;
    for (let i = 0; i < gems.length; i++) {
      const a = gems[i]!;
      if (!a.alive) continue;
      for (let j = i + 1; j < gems.length; j++) {
        const b = gems[j]!;
        if (!b.alive) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy < MERGE_DIST_SQ) {
          a.absorb(b);
          b.alive = false;
        }
      }
    }
    this.gems = gems.filter(g => g.alive);
  }

  /**
   * Per-frame update for all gems.
   *
   * Returns the total XP collected this frame so main.ts can pass it to the
   * level-up manager.  Collected gems (alive = false after their update) are
   * summed and then removed from the array.
   *
   * Also triggers compaction when the gem count is high.
   */
  update(dt: number, player: Player): number {
    // Rate-limit compaction so it doesn't run every frame
    this.compactTimer += dt;
    if (this.gems.length > COMPACT_THRESHOLD && this.compactTimer >= COMPACT_INTERVAL) {
      this.compactTimer = 0;
      this.compact();
    }

    let xpGained = 0;
    for (const g of this.gems) {
      if (!g.alive) continue;
      g.update(dt, player);
      // If the gem was collected inside update(), sum its value
      if (!g.alive) xpGained += g.value;
    }
    // Remove all dead gems (collected or merged) from the live list
    this.gems = this.gems.filter(g => g.alive);

    for (const pickup of this.pickups) {
      if (!pickup.alive) continue;
      const effect = pickup.update(dt, player);
      if (effect === 'heal') {
        player.hp = Math.min(player.maxHp, player.hp + HEAL_PICKUP_AMOUNT);
      } else if (effect === 'magnet') {
        xpGained += this.collectAllGems();
      }
    }
    this.pickups = this.pickups.filter(pickup => pickup.alive);
    return xpGained;
  }

  /** Draws all live gems to the canvas. */
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    for (const g of this.gems) {
      g.draw(ctx, camera, cw, ch);
    }
    for (const pickup of this.pickups) {
      pickup.draw(ctx, camera, cw, ch);
    }
  }
}
